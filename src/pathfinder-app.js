import {
  SUPPORTED_LANGUAGES,
  browserLanguage,
  setUiLanguage,
  tr,
  uiLanguage,
} from "./i18n.js";

export const installPathfinderApp = () => {
  const CONFIG_KEY = "3place-pathfinder-v1";
  const LEGACY_CONFIG_KEY = "3place-minecraft-walk-v1";
  const PANEL_POSITION_KEY = "3place-pathfinder-panel-position-v1";
  const VERSION = __PATHFINDER_VERSION__;
  const DEFAULT_THIRD_PERSON_DISTANCE = 4.25;
  const GRAPHICS_PROFILES = new Set([
    "quality",
    "balanced",
    "performance",
  ]);
  const UI_TIMING = Object.freeze({
    WALK_DOUBLE_TAP_DELAY_MS: 70,
    WALK_MODE_SETTLE_MS: 170,
    DISTANCE_SAVE_DEBOUNCE_MS: 180,
    CAMERA_STATUS_REFRESH_MS: 250,
    BOOT_RETRY_MS: 200,
  });
  const clampThirdPersonDistance = (value) => {
    const number = Number(value);
    return Number.isFinite(number)
      ? Math.max(1.6, Math.min(30, number))
      : DEFAULT_THIRD_PERSON_DISTANCE;
  };
  const normalizeCameraCrop = (value) => {
    const x = Number(value?.x);
    const y = Number(value?.y);
    const width = Number(value?.width);
    const height = Number(value?.height);
    if (
      !Number.isFinite(x) ||
      !Number.isFinite(y) ||
      !Number.isFinite(width) ||
      !Number.isFinite(height) ||
      width < 0.05 ||
      height < 0.05
    ) {
      return null;
    }
    const safeX = Math.max(0, Math.min(0.95, x));
    const safeY = Math.max(0, Math.min(0.95, y));
    const normalized = {
      x: safeX,
      y: safeY,
      width: Math.max(0.05, Math.min(1 - safeX, width)),
      height: Math.max(0.05, Math.min(1 - safeY, height)),
    };
    if (
      normalized.x < 0.001 &&
      normalized.y < 0.001 &&
      normalized.width > 0.999 &&
      normalized.height > 0.999
    ) {
      return null;
    }
    return normalized;
  };
  const readConfig = () => {
    try {
      const parsed = JSON.parse(
        localStorage.getItem(CONFIG_KEY) ||
          localStorage.getItem(LEGACY_CONFIG_KEY) ||
          "null",
      );
      if (parsed) {
        return {
          enabled: parsed.enabled !== false,
          headlightEnabled:
            parsed.headlightEnabled !== undefined
              ? parsed.headlightEnabled !== false
              : parsed.torchEnabled !== false,
          lightIntensity: Number.isFinite(Number(parsed.lightIntensity))
            ? Math.max(20, Math.min(160, Number(parsed.lightIntensity)))
            : 90,
          darkNight: parsed.darkNight === true,
          graphicsProfile: GRAPHICS_PROFILES.has(parsed.graphicsProfile)
            ? parsed.graphicsProfile
            : "quality",
          thirdPersonView:
            parsed.thirdPersonView === "rear" ||
            parsed.thirdPersonView === "front"
              ? parsed.thirdPersonView
              : parsed.thirdPerson === true
                ? "rear"
                : "off",
          thirdPersonDistance: clampThirdPersonDistance(
            parsed.thirdPersonDistance,
          ),
          cameraVideoFormat:
            parsed.cameraVideoFormat === "mp4" ||
            parsed.cameraVideoFormat === "webm"
              ? parsed.cameraVideoFormat
              : "auto",
          cameraCrop: normalizeCameraCrop(parsed.cameraCrop),
          cameraUnofficialCredit:
            parsed.cameraUnofficialCredit !== false,
          language: SUPPORTED_LANGUAGES.has(parsed.language)
            ? parsed.language
            : "auto",
        };
      }
    } catch {}
    return {
      enabled: true,
      headlightEnabled: true,
      lightIntensity: 90,
      darkNight: false,
      graphicsProfile: "quality",
      thirdPersonView: "off",
      thirdPersonDistance: DEFAULT_THIRD_PERSON_DISTANCE,
      cameraVideoFormat: "auto",
      cameraCrop: null,
      cameraUnofficialCredit: true,
      language: "auto",
    };
  };
  let config = readConfig();
  setUiLanguage(config.language);
  let hint = null;
  let touchFlightButton = null;
  let touchFirstPersonControls = null;
  let workshopCameraButton = null;
  let workshopMovementButton = null;
  let observer = null;
  let modeEventsBound = false;
  let forcing = false;
  let firstPersonActive = false;
  let initialModePending = false;
  let widget = null;
  let keysBound = false;
  let bridgeStatusObserver = null;
  let distanceSaveTimer = null;
  let cameraUiTimer = 0;
  let officialUiObserver = null;
  let officialControlDiscoveryObserver = null;
  let cameraCropOverlay = null;
  let lastKnownMovementMode = "idle";
  let officialNearbyObserver = null;
  let officialNearbyRoot = null;
  let officialNearbyPlayers = [];
  let officialNearbyAccounts = new Map();
  let officialNearbyOrder = [];
  let officialNearbyExtraKey = "";
  let selectedNearbyUserId = null;
  let selectedNearbyName = "";
  let nearbyNavigationHud = null;
  const MAX_NEARBY_ROWS = 16;
  const nearbyCompactMedia = matchMedia(
    "(max-width: 720px), (pointer: coarse)",
  );
  const compactNearbyUi = () => nearbyCompactMedia.matches;
  
  // 3place currently exposes a reliable fly/walk attribute only for touch
  // controls. Desktop mode remains text-only, so wording checks are isolated
  // here as a final compatibility fallback instead of being spread through
  // movement, lighting, and third-person code.
  const MODE_TEXT_FALLBACKS = Object.freeze({
    inactive: [
      /^Loading nearby blocks/i,
      /Mouse capture unavailable.*Orbit paint controls active/i,
    ],
    flying: [
      /Double-Space to walk/i,
      /Up\s*\/\s*Down flies/i,
      /^Flying\b/i,
    ],
    walking: [
      /Double-Space to fly/i,
      /Jump is on the right/i,
      /^Walking\b/i,
    ],
  });
  const hintText = () => (!hint || hint.hidden ? "" : (hint.textContent || "").trim());
  const textMatchesAny = (text, patterns) =>
    patterns.some((pattern) => pattern.test(text));
  const publishModeSource = (source) => {
    if (
      document.documentElement &&
      document.documentElement.dataset.pathfinderModeSource !== source
    ) {
      document.documentElement.dataset.pathfinderModeSource = source;
    }
  };
  const firstPersonUi = Object.freeze({
    isActive: () => {
      if (/return to orbit/i.test(workshopCameraButton?.getAttribute("aria-label") || "")) {
        return true;
      }
      if (!hint || hint.hidden) return false;
      if (touchFirstPersonControls && !touchFirstPersonControls.hidden) {
        return true;
      }
      if (hint.dataset.locked === "true") return true;
      try {
        if (document.pointerLockElement?.closest?.("#streetWrap")) return true;
      } catch {}
      const text = hintText();
      return (
        text.length > 0 &&
        !textMatchesAny(text, MODE_TEXT_FALLBACKS.inactive)
      );
    },
    mode: () => {
      if (!firstPersonUi.isActive()) {
        lastKnownMovementMode = "idle";
        publishModeSource("inactive");
        return "idle";
      }
      if (touchFirstPersonControls && !touchFirstPersonControls.hidden) {
        const touchMode = touchFlightButton?.dataset.mode;
        if (touchMode === "fly" || touchMode === "walk") {
          lastKnownMovementMode = touchMode === "fly" ? "flying" : "walking";
          publishModeSource("dom");
          return lastKnownMovementMode;
        }
      }
      const movementLabel =
        workshopMovementButton?.getAttribute("aria-label") || "";
      if (/switch to walking/i.test(movementLabel)) {
        lastKnownMovementMode = "flying";
        publishModeSource("dom");
        return lastKnownMovementMode;
      }
      if (/switch to flying/i.test(movementLabel)) {
        lastKnownMovementMode = "walking";
        publishModeSource("dom");
        return lastKnownMovementMode;
      }
      const text = hintText();
      if (textMatchesAny(text, MODE_TEXT_FALLBACKS.flying)) {
        lastKnownMovementMode = "flying";
        publishModeSource("text-fallback");
      } else if (textMatchesAny(text, MODE_TEXT_FALLBACKS.walking)) {
        lastKnownMovementMode = "walking";
        publishModeSource("text-fallback");
      } else {
        publishModeSource(
          lastKnownMovementMode === "idle" ? "unknown" : "memory",
        );
      }
      return lastKnownMovementMode;
    },
  });
  
  // -------------------------------------------------------------------------
  // 04. Status/compatibility UI and camera controls
  // -------------------------------------------------------------------------
  const updateBridgeStatus = () => {
    if (!widget?.bridgeStatus) return;
    const status = document.documentElement?.dataset.mcwalk3dStatus;
    const labels = {
      connecting: tr("接続中", "Connecting"),
      ready: tr("利用可能", "Available"),
      "light-unavailable": tr("利用不可", "Unavailable"),
    };
    widget.bridgeStatus.textContent =
      labels[status] || tr("接続待ち", "Waiting to connect");
    widget.bridgeStatus.dataset.level =
      status === "light-unavailable"
        ? "error"
        : status === "ready"
          ? "ok"
          : "waiting";
    updateCompatibilityStatus();
  };
  const updateThirdPersonStatus = () => {
    if (!widget?.thirdPersonStatus) return;
    const status =
      document.documentElement?.dataset.pathfinderThirdPersonStatus;
    const labels = {
      off: "OFF",
      standby: tr("一人称開始待ち", "Waiting for first-person"),
      "avatar-wait": tr("自分モデル待ち", "Waiting for your avatar"),
      "avatar-error": tr(
        "モデル読込エラー（再試行中）",
        "Avatar load error (retrying)",
      ),
      "active-rear": tr("動作中（後方）", "Active (rear)"),
      "active-front": tr("動作中（前方）", "Active (front)"),
      "paint-paused": tr("ペイント中は一人称", "First-person while painting"),
      error: tr("エラー", "Error"),
    };
    widget.thirdPersonStatus.textContent =
      labels[status] || tr("準備中", "Preparing");
    widget.thirdPersonStatus.dataset.level =
      status === "error" || status === "avatar-error"
        ? "error"
        : status?.startsWith("active-") || status === "off"
          ? "ok"
          : "waiting";
    updateCompatibilityStatus();
  };
  const updateCompatibilityStatus = () => {
    if (!widget?.compatSummary) return;
    const root = document.documentElement;
    const hooked = root?.dataset.mcwalk3dHooked === "true";
    const lightStatus = root?.dataset.mcwalk3dStatus;
    const thirdStatus = root?.dataset.pathfinderThirdPersonStatus;
    const resolverStatus = root?.dataset.pathfinderThreeResolver || "pending";
    const resolverErrors = root?.dataset.pathfinderThreeError || "";
    const pointerStatus = root?.dataset.pathfinderPointerLock || "pending";
    const cameraApi = window.__pathfinderCamera;
    const cameraState = cameraApi?.getState?.();
    widget.compatHook.textContent = hooked
      ? tr("利用可能", "Available")
      : tr("3D表示待ち", "Waiting for 3D view");
    widget.compatHook.dataset.level = hooked ? "ok" : "waiting";
    const resolverLabels = {
      pending: tr("未使用", "Not used"),
      runtime: tr("実行時構造", "Runtime structure"),
      "module-name": tr("公開名", "Public name"),
      "module-probe": tr("構造判定", "Structure probe"),
      mixed: tr("複合判定", "Combined probe"),
      "source-fallback": tr("互換方式", "Compatibility mode"),
      error: tr("識別エラー", "Detection error"),
    };
    widget.compatResolver.textContent =
      resolverLabels[resolverStatus] || tr("確認中", "Checking");
    widget.compatResolver.dataset.level =
      resolverStatus === "error"
        ? "error"
        : resolverStatus === "pending" || resolverStatus === "source-fallback"
          ? "waiting"
          : "ok";
    const pointerLabels = {
      pending: tr("未確認", "Not checked"),
      idle: tr("待機", "Standby"),
      cursor: tr("カーソル操作中", "Using cursor"),
      relocking: tr("復帰中", "Restoring view"),
      ready: tr("利用可能", "Available"),
      "relock-error": tr("復帰待ち", "Waiting to restore"),
      unsupported: tr("利用不可", "Unavailable"),
    };
    const pointerHasError = ["relock-error", "unsupported"].includes(
      pointerStatus,
    );
    widget.compatPointer.textContent =
      pointerLabels[pointerStatus] || tr("確認中", "Checking");
    widget.compatPointer.dataset.level = pointerHasError
      ? "error"
      : pointerStatus === "pending" ||
          pointerStatus === "idle" ||
          pointerStatus === "relocking"
        ? "waiting"
        : "ok";
    widget.compatCamera.textContent = !cameraApi
      ? tr("接続待ち", "Waiting to connect")
      : cameraState?.status === "error"
        ? tr("要確認", "Needs attention")
        : cameraState?.available
          ? tr("利用可能", "Available")
          : tr("3D表示待ち", "Waiting for 3D view");
    widget.compatCamera.dataset.level = !cameraApi
      ? "waiting"
      : cameraState?.status === "error"
        ? "error"
        : cameraState?.available
          ? "ok"
          : "waiting";
    const unavailable = [];
    if (lightStatus === "light-unavailable") {
      unavailable.push(tr("ライト", "Lights"));
    }
    if (thirdStatus === "error" || thirdStatus === "avatar-error") {
      unavailable.push(tr("三人称", "Third-person"));
    }
    if (pointerStatus === "unsupported") {
      unavailable.push(tr("三人称ペイント", "Third-person painting"));
    }
    const hasCompatibilityIssue =
      unavailable.length > 0 || Boolean(resolverErrors) || pointerHasError;
    widget.compatSummary.textContent = !hooked
      ? `v${VERSION} · ${tr("確認中", "Checking")}`
      : hasCompatibilityIssue
        ? `v${VERSION} · ${tr("一部制限", "Limited")}`
        : `v${VERSION} · ${tr("問題なし", "All good")}`;
    widget.compatSummary.dataset.level = hasCompatibilityIssue
      ? "error"
      : hooked
        ? "ok"
        : "waiting";
    const resolverErrorLabels = {
      "module-url-timeout": tr(
        "3Dモジュールを検出できませんでした",
        "Could not detect the 3D module",
      ),
      "module-import-failed": tr(
        "3Dモジュールを読み込めませんでした",
        "Could not load the 3D module",
      ),
      "spotlight-unresolved": tr(
        "ライト部品を識別できませんでした",
        "Could not identify the light components",
      ),
      "avatar-toolkit-unresolved": tr(
        "アバター部品を識別できませんでした",
        "Could not identify the avatar components",
      ),
      unknown: tr(
        "3D部品の識別に失敗しました",
        "Could not identify the 3D components",
      ),
    };
    const errorCodes = resolverErrors
      .split(",")
      .map((entry) => entry.split(":").at(-1))
      .filter(Boolean);
    const errorReasons = [...new Set(errorCodes)]
      .map((code) => resolverErrorLabels[code] || resolverErrorLabels.unknown)
      .join(uiLanguage === "en" ? ", " : "、");
    const alerts = [];
    if (unavailable.length) {
      alerts.push(
        `${tr("利用できない機能", "Unavailable features")}: ${unavailable.join(uiLanguage === "en" ? ", " : "、")}`,
      );
    }
    if (errorReasons) alerts.push(`${tr("原因", "Reason")}: ${errorReasons}`);
    if (pointerStatus === "relock-error") {
      alerts.push(
        tr(
          "3D画面を1回クリックすると視点操作へ戻れます",
          "Click the 3D view once to restore camera controls",
        ),
      );
    } else if (pointerStatus === "unsupported") {
      alerts.push(
        tr(
          "原因: この環境では三人称ペイントのカーソル制御を利用できません",
          "Reason: Cursor control for third-person painting is unavailable in this environment",
        ),
      );
    }
    if (alerts.length) {
      alerts.push(
        tr(
          "ほかの機能は引き続き使用できます",
          "Other features remain available",
        ),
      );
    }
    widget.compatAlert.hidden = alerts.length === 0;
    const sentenceEnd = uiLanguage === "en" ? ". " : "。";
    widget.compatAlert.textContent =
      alerts.join(sentenceEnd) + (alerts.length ? sentenceEnd.trimStart() : "");
  };
  const formatCameraDuration = (startedAt) => {
    const seconds = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
    const minutes = Math.floor(seconds / 60);
    return `${String(minutes).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
  };
  const updateCameraStatus = () => {
    if (!widget?.cameraState) return;
    const api = window.__pathfinderCamera;
    const state = api?.getState?.() || {
      status: "waiting",
      available: false,
      recording: false,
      startedAt: 0,
      error: "",
      mp4Supported: false,
      webmSupported: false,
      nextVideoExtension: "webm",
    };
    const mp4Option = widget.cameraFormat.querySelector('option[value="mp4"]');
    const webmOption = widget.cameraFormat.querySelector(
      'option[value="webm"]',
    );
    if (mp4Option) mp4Option.disabled = Boolean(api) && !state.mp4Supported;
    if (webmOption) webmOption.disabled = Boolean(api) && !state.webmSupported;
    widget.root.dataset.cameraRecording = String(state.recording);
    widget.camera.textContent = state.recording ? "REC" : "CAM";
    widget.cameraPhoto.disabled =
      !state.available ||
      state.recording ||
      state.status === "photo" ||
      state.status === "processing";
    widget.cameraRecord.disabled =
      (!state.available && !state.recording) ||
      state.status === "photo" ||
      state.status === "processing";
    widget.cameraFormat.disabled =
      state.recording ||
      state.status === "photo" ||
      state.status === "processing";
    widget.cameraCrop.disabled =
      !state.available ||
      state.recording ||
      state.status === "photo" ||
      state.status === "processing";
    widget.cameraUnofficialCredit.disabled =
      state.recording ||
      state.status === "photo" ||
      state.status === "processing";
    widget.cameraRecord.textContent = state.recording
      ? tr("録画を停止して保存", "Stop and save recording")
      : state.status === "processing"
        ? tr("動画を保存中", "Saving video")
        : tr("動画を録画", "Record video");
    let label = tr("3D表示待ち", "Waiting for 3D view");
    if (state.recording) {
      label = `${tr("録画中", "Recording")} ${formatCameraDuration(state.startedAt)}`;
    } else if (state.status === "photo") {
      label = tr("静止画を保存中", "Saving photo");
    } else if (state.status === "processing") {
      label = tr("動画を保存中", "Saving video");
    } else if (state.status === "error") {
      label = tr("撮影エラー", "Capture error");
    } else if (state.available) {
      label = tr("撮影できます", "Ready to capture");
    }
    widget.cameraState.textContent = label;
    widget.cameraMessage.textContent =
      state.status === "error" && state.error
        ? state.error
        : state.available
          ? `${state.width} × ${state.height} · PNG / ${String(state.nextVideoExtension || "webm").toUpperCase()} 30fps`
          : tr(
              "3D表示を開くと撮影できます",
              "Open the 3D view to enable capture",
            );
    updateCompatibilityStatus();
  };
  const nearbyDirection = (bearing) => {
    const directions = [
      ["前", "Ahead", "↑"],
      ["右前", "Ahead right", "↗"],
      ["右", "Right", "→"],
      ["右後ろ", "Behind right", "↘"],
      ["後ろ", "Behind", "↓"],
      ["左後ろ", "Behind left", "↙"],
      ["左", "Left", "←"],
      ["左前", "Ahead left", "↖"],
    ];
    const normalized = ((Number(bearing) || 0) + 360) % 360;
    const index = Math.round(normalized / 45) % directions.length;
    const [ja, en, arrow] = directions[index];
    return { arrow, label: tr(ja, en) };
  };
  const nearbyDistanceLabel = (distance) => {
    const value = Number(distance);
    if (!Number.isFinite(value)) return "";
    const rounded = value < 10 ? Math.round(value * 10) / 10 : Math.round(value);
    return tr(`約${rounded} voxels`, `~${rounded} voxels`);
  };
  const nearbyCompactDistanceLabel = (distance) => {
    const value = Number(distance);
    if (!Number.isFinite(value)) return "";
    const rounded = value < 10 ? Math.round(value * 10) / 10 : Math.round(value);
    return tr(`約${rounded} vox`, `~${rounded} vox`);
  };
  const nearbyElevationLabel = (elevation) => {
    const value = Number(elevation);
    if (!Number.isFinite(value) || Math.abs(value) < 3) {
      return tr("ほぼ水平", "Level");
    }
    const degrees = Math.round(Math.abs(value));
    return value > 0
      ? tr(`上 ${degrees}°`, `${degrees}° up`)
      : tr(`下 ${degrees}°`, `${degrees}° down`);
  };
  const nearbyAccountLabel = (account) =>
    account?.handle ||
    tr(`アカウント #${account?.id}・名前なし`, `Account #${account?.id} · no handle`);
  const NEARBY_COLORS = Object.freeze([
    "#e0565f",
    "#4f8fe0",
    "#4fc98d",
    "#d9a441",
    "#9a6fe0",
    "#e07bb1",
    "#54c2cf",
    "#8b95a7",
  ]);
  const ensureNearbyNavigationHud = () => {
    if (nearbyNavigationHud?.root?.isConnected) return nearbyNavigationHud;
    const root = document.createElement("aside");
    root.id = "pathfinder-nearby-navigation";
    root.hidden = true;
    root.setAttribute("aria-live", "polite");
    root.innerHTML = `
      <div class="pathfinder-nav-compass" aria-hidden="true">
        <span class="pathfinder-nav-cardinal pathfinder-nav-front">${tr("前", "FWD")}</span>
        <span class="pathfinder-nav-cardinal pathfinder-nav-right">${tr("右", "R")}</span>
        <span class="pathfinder-nav-cardinal pathfinder-nav-back">${tr("後", "BACK")}</span>
        <span class="pathfinder-nav-cardinal pathfinder-nav-left">${tr("左", "L")}</span>
        <span class="pathfinder-nav-needle"></span>
        <span class="pathfinder-nav-center"></span>
      </div>
      <div class="pathfinder-nav-copy">
        <strong></strong>
        <div class="pathfinder-nav-readings">
          <span class="pathfinder-nav-reading">
            <small>${tr("水平方向", "HORIZONTAL")}</small>
            <b class="pathfinder-nav-direction"></b>
          </span>
          <span class="pathfinder-nav-reading">
            <small>${tr("上下方向", "VERTICAL")}</small>
            <b class="pathfinder-nav-elevation"></b>
          </span>
        </div>
        <span class="pathfinder-nav-distance-wrap">
          <small>${tr("3D距離", "3D DISTANCE")}</small>
          <b class="pathfinder-nav-distance"></b>
        </span>
      </div>
      <div class="pathfinder-nav-altimeter" aria-hidden="true">
        <span class="pathfinder-nav-alt-up">${tr("上", "UP")}</span>
        <span class="pathfinder-nav-alt-track">
          <span class="pathfinder-nav-alt-marker"></span>
        </span>
        <span class="pathfinder-nav-alt-down">${tr("下", "DOWN")}</span>
      </div>
      <button type="button" aria-label="${tr("ナビを閉じる", "Close navigation")}" title="${tr("ナビを閉じる", "Close navigation")}">×</button>
    `;
    root.querySelector("button").onclick = () => selectNearbyUser(null);
    (document.body || document.documentElement).append(root);
    nearbyNavigationHud = {
      root,
      needle: root.querySelector(".pathfinder-nav-needle"),
      altitudeMarker: root.querySelector(".pathfinder-nav-alt-marker"),
      name: root.querySelector("strong"),
      direction: root.querySelector(".pathfinder-nav-direction"),
      elevation: root.querySelector(".pathfinder-nav-elevation"),
      distance: root.querySelector(".pathfinder-nav-distance"),
    };
    return nearbyNavigationHud;
  };
  const updateNearbyNavigationHud = () => {
    const hud = ensureNearbyNavigationHud();
    if (!Number.isSafeInteger(selectedNearbyUserId)) {
      hud.root.hidden = true;
      return;
    }
    hud.root.hidden = false;
    const account = officialNearbyAccounts.get(selectedNearbyUserId);
    const player = officialNearbyPlayers.find(
      (candidate) => candidate?.userId === selectedNearbyUserId,
    );
    const name = account ? nearbyAccountLabel(account) : selectedNearbyName;
    hud.name.textContent = name || `#${selectedNearbyUserId}`;
    if (!player) {
      hud.root.dataset.available = "false";
      hud.needle.style.setProperty("--pathfinder-bearing", "0deg");
      hud.altitudeMarker.style.setProperty("--pathfinder-altitude", "0px");
      hud.direction.textContent = tr(
        "位置不明",
        "Unknown",
      );
      hud.elevation.textContent = tr("位置不明", "Unknown");
      hud.distance.textContent = "-";
      return;
    }
    hud.root.dataset.available = "true";
    const direction = nearbyDirection(player.bearing);
    const elevationDegrees = Math.max(
      -89,
      Math.min(89, Number(player.elevation) || 0),
    );
    const elevation = (elevationDegrees * Math.PI) / 180;
    hud.needle.style.setProperty(
      "--pathfinder-bearing",
      `${Number(player.bearing) || 0}deg`,
    );
    hud.altitudeMarker.style.setProperty(
      "--pathfinder-altitude",
      `${-Math.sin(elevation) * 35}px`,
    );
    hud.direction.textContent = direction.label;
    hud.elevation.textContent = nearbyElevationLabel(player.elevation);
    hud.distance.textContent = nearbyDistanceLabel(player.distance);
  };
  function selectNearbyUser(userId, name = "") {
    const nextId = Number(userId);
    if (!Number.isSafeInteger(nextId) || nextId <= 0) {
      selectedNearbyUserId = null;
      selectedNearbyName = "";
    } else if (selectedNearbyUserId === nextId) {
      selectedNearbyUserId = null;
      selectedNearbyName = "";
    } else {
      selectedNearbyUserId = nextId;
      selectedNearbyName = name;
    }
    syncOfficialNearbyRows();
    updateNearbyNavigationHud();
  }
  const renderExtendedNearbyRows = () => {
    if (!officialNearbyRoot?.isConnected) return;
    if (officialNearbyOrder.length === 0) {
      officialNearbyRoot
        .querySelectorAll(".pathfinder-nearby-extra")
        .forEach((row) => row.remove());
      officialNearbyExtraKey = "";
      return;
    }
    const nativeRows = Array.from(
      officialNearbyRoot.querySelectorAll(
        ".nearbyRow:not(.pathfinder-nearby-extra)",
      ),
    );
    if (compactNearbyUi()) {
      officialNearbyRoot
        .querySelectorAll(".pathfinder-nearby-extra")
        .forEach((row) => row.remove());
      officialNearbyExtraKey = "compact";
      const overflow = Array.from(
        officialNearbyRoot.querySelectorAll(".nearbyMuted"),
      ).find((node) => /^\+\d+\s+more$/i.test(node.textContent.trim()));
      if (overflow) {
        const remaining = Math.max(
          0,
          officialNearbyOrder.length - nativeRows.length,
        );
        const text = `+${remaining} more`;
        if (overflow.textContent !== text) overflow.textContent = text;
        overflow.hidden = remaining === 0;
      }
      return;
    }
    const extraAccounts = officialNearbyOrder
      .slice(nativeRows.length, MAX_NEARBY_ROWS)
      .map((id) => officialNearbyAccounts.get(id))
      .filter(Boolean);
    const key = `${nativeRows.length}|${extraAccounts
      .map((account) => `${account.id}:${account.handle || ""}:${account.staff ? 1 : 0}`)
      .join("|")}`;
    const renderedIds = Array.from(
      officialNearbyRoot.querySelectorAll(".pathfinder-nearby-extra"),
      (row) => Number(row.dataset.pathfinderUserId),
    );
    const expectedIds = extraAccounts.map((account) => account.id);
    if (
      key !== officialNearbyExtraKey ||
      renderedIds.length !== expectedIds.length ||
      renderedIds.some((id, index) => id !== expectedIds[index])
    ) {
      officialNearbyRoot
        .querySelectorAll(".pathfinder-nearby-extra")
        .forEach((row) => row.remove());
      const fragment = document.createDocumentFragment();
      for (const account of extraAccounts) {
        const row = document.createElement("div");
        row.className = "nearbyRow pathfinder-nearby-extra";
        row.dataset.pathfinderUserId = String(account.id);
        const dot = document.createElement("span");
        dot.className = "nearbyDot";
        dot.style.backgroundColor =
          NEARBY_COLORS[((account.id % NEARBY_COLORS.length) + NEARBY_COLORS.length) % NEARBY_COLORS.length];
        const name = document.createElement("span");
        name.className = "nearbyName";
        name.textContent = nearbyAccountLabel(account);
        row.append(dot, name);
        if (account.staff) {
          const badge = document.createElement("span");
          badge.className = "nearbyStaffBadge";
          badge.textContent = tr("スタッフ", "Staff");
          row.append(badge);
        }
        fragment.append(row);
      }
      const muted = Array.from(
        officialNearbyRoot.querySelectorAll(".nearbyMuted"),
      ).find((node) => /^\+\d+\s+more$/i.test(node.textContent.trim()));
      officialNearbyRoot.insertBefore(fragment, muted || null);
      officialNearbyExtraKey = key;
    }
    const overflow = Array.from(
      officialNearbyRoot.querySelectorAll(".nearbyMuted"),
    ).find((node) => /^\+\d+\s+more$/i.test(node.textContent.trim()));
    if (overflow) {
      const remaining = Math.max(0, officialNearbyOrder.length - MAX_NEARBY_ROWS);
      const text = `+${remaining} more`;
      if (overflow.textContent !== text) overflow.textContent = text;
      overflow.hidden = remaining === 0;
    }
  };
  const syncOfficialNearbyRows = () => {
    if (!officialNearbyRoot?.isConnected) return;
    renderExtendedNearbyRows();
    const rows = Array.from(officialNearbyRoot.querySelectorAll(".nearbyRow"));
    const nativeRows = rows.filter(
      (row) => !row.classList.contains("pathfinder-nearby-extra"),
    );
    for (const row of rows) {
      let account = null;
      if (row.classList.contains("pathfinder-nearby-extra")) {
        account = officialNearbyAccounts.get(
          Number(row.dataset.pathfinderUserId),
        );
      } else {
        const nativeIndex = nativeRows.indexOf(row);
        account = officialNearbyAccounts.get(officialNearbyOrder[nativeIndex]);
        if (account) {
          row.dataset.pathfinderUserId = String(account.id);
        } else {
          delete row.dataset.pathfinderUserId;
        }
      }
      const existing = row.querySelector(".pathfinder-nearby-detail");
      const player = account
        ? officialNearbyPlayers.find((candidate) => candidate?.userId === account.id)
        : null;
      if (!player || compactNearbyUi()) {
        existing?.remove();
      } else {
        const direction = nearbyDirection(player.bearing);
        const description = `${direction.label}, ${nearbyElevationLabel(player.elevation)}, ${nearbyDistanceLabel(player.distance)}`;
        const detail = existing || document.createElement("span");
        detail.className = "pathfinder-nearby-detail";
        detail.dataset.playerKey = player.key;
        let arrow = detail.querySelector(".pathfinder-nearby-arrow");
        let distance = detail.querySelector(".pathfinder-nearby-distance");
        if (!arrow || !distance) {
          detail.replaceChildren();
          arrow = document.createElement("span");
          arrow.className = "pathfinder-nearby-arrow";
          arrow.setAttribute("aria-hidden", "true");
          distance = document.createElement("span");
          distance.className = "pathfinder-nearby-distance";
          detail.append(arrow, distance);
        }
        if (arrow.textContent !== direction.arrow) {
          arrow.textContent = direction.arrow;
        }
        const distanceText = nearbyCompactDistanceLabel(player.distance);
        if (distance.textContent !== distanceText) distance.textContent = distanceText;
        detail.title = description;
        detail.setAttribute("aria-label", description);
        if (!existing) row.insertBefore(detail, row.querySelector(".nearbyReport"));
      }
      const userId = Number(
        row.dataset.pathfinderUserId || account?.id || player?.userId,
      );
      const name = row.querySelector(".nearbyName");
      if (name && Number.isSafeInteger(userId) && userId > 0) {
        row.dataset.pathfinderUserId = String(userId);
        name.dataset.pathfinderNavigate = "true";
        name.tabIndex = 0;
        name.setAttribute("role", "button");
        name.title = tr(
          `${name.textContent}へのナビを開始`,
          `Navigate to ${name.textContent}`,
        );
        name.setAttribute(
          "aria-label",
          tr(`${name.textContent}へナビ`, `Navigate to ${name.textContent}`),
        );
        name.setAttribute(
          "aria-pressed",
          String(selectedNearbyUserId === userId),
        );
        row.dataset.pathfinderSelected = String(selectedNearbyUserId === userId);
      } else if (name) {
        delete name.dataset.pathfinderNavigate;
        name.removeAttribute("tabindex");
        name.removeAttribute("role");
        name.removeAttribute("aria-label");
        name.removeAttribute("aria-pressed");
        name.removeAttribute("title");
        delete row.dataset.pathfinderSelected;
      }
    }
    updateNearbyNavigationHud();
  };
  const installOfficialNearbyEnhancer = () => {
    const root = document.getElementById("nearbyPlayers");
    if (!root || root === officialNearbyRoot) return;
    officialNearbyObserver?.disconnect();
    officialNearbyRoot = root;
    officialNearbyExtraKey = "";
    root.addEventListener("click", (event) => {
      const name = event.target.closest?.(".nearbyName[data-pathfinder-navigate=true]");
      if (!name || !root.contains(name)) return;
      const row = name.closest(".nearbyRow");
      selectNearbyUser(Number(row?.dataset.pathfinderUserId), name.textContent.trim());
    });
    root.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      const name = event.target.closest?.(".nearbyName[data-pathfinder-navigate=true]");
      if (!name || !root.contains(name)) return;
      event.preventDefault();
      const row = name.closest(".nearbyRow");
      selectNearbyUser(Number(row?.dataset.pathfinderUserId), name.textContent.trim());
    });
    officialNearbyObserver = new MutationObserver(syncOfficialNearbyRows);
    officialNearbyObserver.observe(root, { childList: true, subtree: true });
    syncOfficialNearbyRows();
  };
  const updateOfficialNearbyState = (event) => {
    const players = event?.detail?.players;
    officialNearbyPlayers = Array.isArray(players) ? players : [];
    installOfficialNearbyEnhancer();
    syncOfficialNearbyRows();
  };
  const updateOfficialPresenceSnapshot = (event) => {
    const players = Array.isArray(event?.detail?.players)
      ? event.detail.players.filter(
          (player) => Number.isSafeInteger(player?.id) && player.id > 0,
        )
      : [];
    const nextAccounts = new Map(players.map((player) => [player.id, player]));
    const present = new Set(nextAccounts.keys());
    officialNearbyOrder = officialNearbyOrder.filter((id) => present.has(id));
    for (const player of players) {
      if (!officialNearbyOrder.includes(player.id)) officialNearbyOrder.push(player.id);
    }
    officialNearbyAccounts = nextAccounts;
    installOfficialNearbyEnhancer();
    syncOfficialNearbyRows();
  };
  const capturePathfinderPhoto = async () => {
    const api = window.__pathfinderCamera;
    if (!api?.capturePhoto) return;
    try {
      await api.capturePhoto();
    } catch (error) {
      console.warn("3place Pathfinder photo failed", error);
    }
    updateCameraStatus();
  };
  const togglePathfinderRecording = async () => {
    const api = window.__pathfinderCamera;
    if (!api) return;
    try {
      if (api.getState().recording) {
        await api.stopRecording();
      } else {
        await api.startRecording();
      }
    } catch (error) {
      console.warn("3place Pathfinder video failed", error);
    }
    updateCameraStatus();
  };
  const closeCameraCropSelector = () => {
    cameraCropOverlay?.close?.();
    cameraCropOverlay = null;
  };
  const openCameraCropSelector = () => {
    if (cameraCropOverlay) return;
    const streetCanvas = [...document.querySelectorAll("#streetWrap canvas")]
      .map((canvas) => ({ canvas, rect: canvas.getBoundingClientRect() }))
      .filter(({ rect }) => rect.width > 0 && rect.height > 0)
      .sort((a, b) => b.rect.width * b.rect.height - a.rect.width * a.rect.height)[0];
    if (!streetCanvas) {
      if (widget?.cameraMessage) {
        widget.cameraMessage.textContent = tr(
          "3D表示を開いてから範囲を選んでください",
          "Open the 3D view before selecting an area.",
        );
      }
      return;
    }
    const root = document.createElement("div");
    root.id = "pathfinder-camera-crop";
    root.setAttribute("role", "dialog");
    root.setAttribute("aria-modal", "true");
    root.setAttribute("aria-label", tr("撮影範囲を選択", "Select capture area"));
    root.innerHTML = `<div class="crop-box"><div class="crop-toolbar"><span>${tr("撮影範囲", "Capture area")}</span><button class="crop-apply" type="button">${tr("決定", "Apply")}</button><button class="crop-full" type="button">${tr("全画面", "Full screen")}</button><button class="crop-cancel" type="button">${tr("取消", "Cancel")}</button></div><span class="crop-resize" aria-hidden="true"></span></div>`;
    document.body.append(root);
    const restoreCameraDialog =
      widget.root.dataset.open === "true" &&
      widget.root.dataset.panelSection === "camera";
    widget.root.dataset.open = "false";
    widget.camera.setAttribute("aria-expanded", "false");
    const box = root.querySelector(".crop-box");
    const bounds = streetCanvas.rect;
    const crop = config.cameraCrop || { x: 0, y: 0, width: 1, height: 1 };
    const geometry = {
      left: bounds.left + crop.x * bounds.width,
      top: bounds.top + crop.y * bounds.height,
      width: crop.width * bounds.width,
      height: crop.height * bounds.height,
    };
    const paint = () => {
      box.style.left = `${Math.round(geometry.left)}px`;
      box.style.top = `${Math.round(geometry.top)}px`;
      box.style.width = `${Math.round(geometry.width)}px`;
      box.style.height = `${Math.round(geometry.height)}px`;
    };
    paint();
    let pointer = null;
    const finishPointer = (event) => {
      if (!pointer || event.pointerId !== pointer.id) return;
      box.releasePointerCapture?.(event.pointerId);
      pointer = null;
    };
    box.addEventListener("pointerdown", (event) => {
      if (event.button !== 0 || event.target.closest("button")) return;
      event.preventDefault();
      event.stopPropagation();
      pointer = {
        id: event.pointerId,
        mode: event.target.closest(".crop-resize") ? "resize" : "move",
        x: event.clientX,
        y: event.clientY,
        left: geometry.left,
        top: geometry.top,
        width: geometry.width,
        height: geometry.height,
      };
      box.setPointerCapture(event.pointerId);
    });
    box.addEventListener("pointermove", (event) => {
      if (!pointer || event.pointerId !== pointer.id) return;
      event.preventDefault();
      const dx = event.clientX - pointer.x;
      const dy = event.clientY - pointer.y;
      if (pointer.mode === "move") {
        geometry.left = Math.max(
          bounds.left,
          Math.min(bounds.right - pointer.width, pointer.left + dx),
        );
        geometry.top = Math.max(
          bounds.top,
          Math.min(bounds.bottom - pointer.height, pointer.top + dy),
        );
      } else {
        const minWidth = Math.min(160, bounds.width);
        const minHeight = Math.min(90, bounds.height);
        geometry.width = Math.max(
          minWidth,
          Math.min(bounds.right - pointer.left, pointer.width + dx),
        );
        geometry.height = Math.max(
          minHeight,
          Math.min(bounds.bottom - pointer.top, pointer.height + dy),
        );
      }
      paint();
    });
    box.addEventListener("pointerup", finishPointer);
    box.addEventListener("pointercancel", finishPointer);
    const close = () => {
      root.remove();
      removeEventListener("keydown", onKeyDown, true);
      removeEventListener("resize", onViewportChange);
      if (restoreCameraDialog && widget?.root?.isConnected) {
        widget.root.dataset.panelSection = "camera";
        widget.root.dataset.open = "true";
        widget.camera.setAttribute("aria-expanded", "true");
        widget.settings.setAttribute("aria-expanded", "false");
        requestAnimationFrame(() => positionPanel(widget.root));
      }
    };
    const apply = () => {
      config.cameraCrop = normalizeCameraCrop({
        x: (geometry.left - bounds.left) / bounds.width,
        y: (geometry.top - bounds.top) / bounds.height,
        width: geometry.width / bounds.width,
        height: geometry.height / bounds.height,
      });
      save();
      sync3d();
      updateWidget();
      updateCameraStatus();
      closeCameraCropSelector();
    };
    const useFullScreen = () => {
      config.cameraCrop = null;
      save();
      sync3d();
      updateWidget();
      updateCameraStatus();
      closeCameraCropSelector();
    };
    const onKeyDown = (event) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      closeCameraCropSelector();
    };
    const onViewportChange = () => closeCameraCropSelector();
    root.querySelector(".crop-apply").onclick = apply;
    root.querySelector(".crop-full").onclick = useFullScreen;
    root.querySelector(".crop-cancel").onclick = closeCameraCropSelector;
    addEventListener("keydown", onKeyDown, true);
    addEventListener("resize", onViewportChange);
    cameraCropOverlay = { root, close };
  };
  
  const save = () => {
    try {
      localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
    } catch {}
  };
  const mode = () => firstPersonUi.mode();
  const sync3d = () => {
    const root = document.documentElement;
    if (!root) return;
    root.dataset.mcwalkEnabled = String(config.enabled);
    root.dataset.mcwalkActive = String(config.enabled && firstPersonActive);
    root.dataset.pathfinderFirstPersonActive = String(firstPersonActive);
    root.dataset.mcwalkHeadlight = String(config.headlightEnabled);
    root.dataset.mcwalkLightIntensity = String(config.lightIntensity);
    root.dataset.pathfinderDarkNight = String(
      config.enabled && config.darkNight,
    );
    root.dataset.pathfinderGraphicsProfile = config.graphicsProfile;
    root.dataset.pathfinderThirdPerson = String(
      config.thirdPersonView !== "off",
    );
    root.dataset.pathfinderThirdPersonView = config.thirdPersonView;
    root.dataset.pathfinderThirdPersonDistance = String(
      config.thirdPersonDistance,
    );
    root.dataset.pathfinderCameraFormat = config.cameraVideoFormat;
    root.dataset.pathfinderCameraCrop = config.cameraCrop
      ? JSON.stringify(config.cameraCrop)
      : "full";
    root.dataset.pathfinderCameraUnofficialCredit = String(
      config.cameraUnofficialCredit,
    );
  };
  const updateWidget = () => {
    if (!widget) return;
    const state = !config.enabled ? "off" : mode();
    widget.root.dataset.state = state;
    widget.toggle.setAttribute("aria-pressed", String(config.enabled));
    widget.onOff.textContent = config.enabled ? "ON" : "OFF";
    widget.enabled.checked = config.enabled;
    widget.darkNight.checked = config.darkNight;
    widget.darkNight.disabled = !config.enabled;
    widget.graphicsProfile.value = config.graphicsProfile;
    widget.graphicsProfile.disabled = !config.enabled;
    widget.thirdPersonView.value = config.thirdPersonView;
    widget.cameraView.value = config.thirdPersonView;
    widget.cameraFormat.value = config.cameraVideoFormat;
    widget.cameraCropValue.textContent = config.cameraCrop
      ? `${Math.round(config.cameraCrop.width * 100)}% × ${Math.round(config.cameraCrop.height * 100)}%`
      : tr("全画面", "Full screen");
    widget.cameraUnofficialCredit.checked = config.cameraUnofficialCredit;
    updateFirstPersonFovControl();
    widget.thirdPersonDistance.disabled =
      !config.enabled || config.thirdPersonView === "off";
    widget.state.textContent =
      state === "walking"
        ? "WALKING"
        : state === "flying"
          ? "FLYING"
          : state === "off"
            ? tr("停止中", "STOPPED")
            : "READY";
  };
  const spaceTap = () => {
    const init = {
      key: " ",
      code: "Space",
      bubbles: true,
      cancelable: true,
    };
    dispatchEvent(new KeyboardEvent("keydown", init));
    dispatchEvent(new KeyboardEvent("keyup", init));
  };
  const startWalking = () => {
    if (!config.enabled || forcing || mode() !== "flying") return;
    forcing = true;
    if (
      workshopMovementButton?.isConnected &&
      /switch to walking/i.test(
        workshopMovementButton.getAttribute("aria-label") || "",
      )
    ) {
      workshopMovementButton.click();
    } else {
      spaceTap();
      setTimeout(spaceTap, UI_TIMING.WALK_DOUBLE_TAP_DELAY_MS);
    }
    setTimeout(() => {
      forcing = false;
      updateWidget();
    }, UI_TIMING.WALK_MODE_SETTLE_MS);
  };
  const syncMode = () => {
    const active = firstPersonUi.isActive();
    if (active && !firstPersonActive) initialModePending = true;
    if (!active) initialModePending = false;
    firstPersonActive = active;
    updateWidget();
    sync3d();
    const current = mode();
    if (config.enabled && initialModePending && current !== "idle") {
      initialModePending = false;
      if (current === "flying") startWalking();
    }
  };
  const setEnabled = (value) => {
    config.enabled = Boolean(value);
    save();
    updateWidget();
    sync3d();
    if (config.enabled) startWalking();
  };
  const observeMode = () => {
    const next = document.getElementById("firstPersonHint");
    const nextCamera = document.getElementById("workshopCameraBtn");
    const nextMovement = document.getElementById("workshopMovementBtn");
    if (
      !next ||
      (next === hint &&
        nextCamera === workshopCameraButton &&
        nextMovement === workshopMovementButton)
    ) return;
    hint = next;
    workshopCameraButton = nextCamera;
    workshopMovementButton = nextMovement;
    touchFlightButton = document.getElementById("touchFlightBtn");
    touchFirstPersonControls = document.getElementById(
      "touchFirstPersonControls",
    );
    observer?.disconnect();
    observer = new MutationObserver(syncMode);
    observer.observe(hint, {
      attributes: true,
      attributeFilter: ["hidden", "data-locked"],
      childList: true,
      characterData: true,
      subtree: true,
    });
    if (touchFlightButton) {
      observer.observe(touchFlightButton, {
        attributes: true,
        attributeFilter: ["data-mode", "aria-pressed"],
      });
    }
    if (touchFirstPersonControls) {
      observer.observe(touchFirstPersonControls, {
        attributes: true,
        attributeFilter: ["hidden", "inert"],
      });
    }
    for (const button of [workshopCameraButton, workshopMovementButton]) {
      if (button) {
        observer.observe(button, {
          attributes: true,
          attributeFilter: ["aria-label", "hidden", "disabled"],
        });
      }
    }
    if (!modeEventsBound) {
      addEventListener("pointerlockchange", syncMode, true);
      modeEventsBound = true;
    }
    syncMode();
  };
  const observeOfficialUiVisibility = () => {
    const appRoot = document.getElementById("appRoot");
    if (!appRoot) return;
    const syncVisibility = () => {
      document.documentElement.dataset.pathfinderOfficialUiHidden = String(
        appRoot.dataset.gameUiHidden === "true",
      );
    };
    officialUiObserver?.disconnect();
    officialUiObserver = new MutationObserver(syncVisibility);
    officialUiObserver.observe(appRoot, {
      attributes: true,
      attributeFilter: ["data-game-ui-hidden"],
    });
    syncVisibility();
  };
  
  const positionLauncherMenu = (root) => {
    if (root.dataset.menuOpen !== "true") return;
    const bounds = root.getBoundingClientRect();
    const actions = root.querySelector(".quick-actions");
    const actionsWidth = actions?.scrollWidth || 286;
    root.dataset.menuAlign =
      bounds.right + 8 + actionsWidth > innerWidth - 8 ? "left" : "right";
  };
  
  const positionPanel = (root) => {
    positionLauncherMenu(root);
    if (root.dataset.open !== "true") return;
    const panel = root.querySelector(".panel");
    const bounds = root.getBoundingClientRect();
    const panelWidth = Math.min(340, innerWidth - 16);
    root.dataset.panelAlign =
      bounds.left + panelWidth > innerWidth - 8 ? "right" : "left";
    const spaceBelow = innerHeight - bounds.bottom - 8;
    const spaceAbove = bounds.top - 8;
    const desiredHeight = Math.min(420, Math.max(260, panel.scrollHeight));
    const openUp = spaceBelow < desiredHeight && spaceAbove > spaceBelow;
    root.dataset.panelVertical = openUp ? "up" : "down";
    panel.style.maxHeight = `${Math.max(120, openUp ? spaceAbove - 7 : spaceBelow - 7)}px`;
  };
  
  const bindPanelDrag = (root, handle) => {
    try {
      const saved = JSON.parse(localStorage.getItem(PANEL_POSITION_KEY) || "null");
      if (Number.isFinite(saved?.x) && Number.isFinite(saved?.y)) {
        const x = Math.max(
          8,
          Math.min(Math.max(8, innerWidth - root.offsetWidth - 8), saved.x),
        );
        const y = Math.max(
          8,
          Math.min(Math.max(8, innerHeight - root.offsetHeight - 8), saved.y),
        );
        root.style.left = `${x}px`;
        root.style.top = `${y}px`;
        root.style.right = "auto";
        root.style.transform = "none";
      }
    } catch {}
    handle.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      const bounds = root.getBoundingClientRect();
      const startX = event.clientX;
      const startY = event.clientY;
      const offsetX = event.clientX - bounds.left;
      const offsetY = event.clientY - bounds.top;
      let moved = false;
      handle.setPointerCapture(event.pointerId);
      const move = (moveEvent) => {
        if (
          !moved &&
          Math.hypot(moveEvent.clientX - startX, moveEvent.clientY - startY) < 4
        ) {
          return;
        }
        moved = true;
        root.dataset.dragging = "true";
        root.style.right = "auto";
        root.style.transform = "none";
        const maxX = Math.max(8, innerWidth - root.offsetWidth - 8);
        const maxY = Math.max(8, innerHeight - root.offsetHeight - 8);
        const x = Math.max(8, Math.min(maxX, moveEvent.clientX - offsetX));
        const y = Math.max(8, Math.min(maxY, moveEvent.clientY - offsetY));
        root.style.left = `${Math.round(x)}px`;
        root.style.top = `${Math.round(y)}px`;
        positionPanel(root);
      };
      const finish = () => {
        handle.removeEventListener("pointermove", move);
        handle.removeEventListener("pointerup", finish);
        handle.removeEventListener("pointercancel", finish);
        delete root.dataset.dragging;
        if (!moved) return;
        root.dataset.suppressLauncherClick = "true";
        setTimeout(() => {
          delete root.dataset.suppressLauncherClick;
        }, 0);
        try {
          localStorage.setItem(
            PANEL_POSITION_KEY,
            JSON.stringify({
              x: Number.parseFloat(root.style.left),
              y: Number.parseFloat(root.style.top),
            }),
          );
        } catch {}
      };
      handle.addEventListener("pointermove", move);
      handle.addEventListener("pointerup", finish);
      handle.addEventListener("pointercancel", finish);
    });
  };
  
  // -------------------------------------------------------------------------
  // 05. Pathfinder widget, input bindings, and startup
  // -------------------------------------------------------------------------
  const PATHFINDER_ICON_RGBA_BASE64 =
    "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";
  const drawPathfinderLauncherIcon = (canvas) => {
    const context = canvas?.getContext?.("2d");
    if (!context) return;
    try {
      const binary = atob(PATHFINDER_ICON_RGBA_BASE64);
      if (binary.length !== 40 * 40 * 4) throw new Error("invalid icon data");
      const bytes = new Uint8ClampedArray(binary.length);
      for (let index = 0; index < binary.length; index += 1) {
        bytes[index] = binary.charCodeAt(index);
      }
      context.putImageData(new ImageData(bytes, 40, 40), 0, 0);
    } catch (error) {
      console.warn("[3place Pathfinder] launcher icon draw failed", error);
    }
  };
  // Compact launcher UI. The supplied icon is embedded so the userscript
  // remains self-contained when installed from GitHub or Tampermonkey.
  const CSS = `
    html[data-pathfinder-official-ui-hidden="true"] #mcwalk-userscript,
    html[data-pathfinder-official-ui-hidden="true"] #pathfinder-camera-crop {
      display: none !important;
    }
    #mcwalk-userscript {
      --pf-accent: var(--accent, #0d9488);
      --pf-accent-ink: var(--accent-ink, #0b6e66);
      --pf-accent-tint: var(--accent-tint, rgba(13, 148, 136, .14));
      --pf-glass-border: var(--glass-border, rgba(255, 255, 255, .7));
      --pf-glass-fill: var(--glass-fill, rgba(255, 255, 255, .74));
      --pf-glass-hover: var(--glass-fill-hover, rgba(255, 255, 255, .9));
      --pf-panel-fill: rgba(255, 255, 255, .94);
      --pf-control-fill: rgba(255, 255, 255, .78);
      --pf-control-border: rgba(20, 30, 50, .16);
      --pf-row-hover: rgba(255, 255, 255, .52);
      --pf-divider: rgba(32, 41, 58, .11);
      --pf-text: var(--text, #20293a);
      --pf-text-2: var(--text-2, #5a6572);
      --pf-text-3: #606a79;
      --pf-text-3: color-mix(in srgb, var(--text-3, #8a93a3) 60%, var(--text, #20293a));
      --pf-shadow-chrome: var(--shadow-chrome, 0 8px 22px rgba(25, 35, 55, .18));
      --pf-shadow-modal: var(--shadow-modal, 0 24px 60px rgba(20, 30, 55, .32));
      --pf-shadow-pressed: var(--shadow-chrome-pressed, 0 4px 12px rgba(25, 35, 55, .16));
      --pf-warn: #9a570f; --pf-bad: #c43d3d;
      position: fixed; top: 50%; left: auto; right: max(16px, env(safe-area-inset-right));
      transform: translateY(-50%); z-index: 2147483600; width: max-content; max-width: calc(100vw - 32px);
      color: var(--pf-text); font: 500 13px/1.45 "Space Grotesk", system-ui, sans-serif;
    }
    #mcwalk-userscript, #mcwalk-userscript * { box-sizing: border-box; }
    /* アイコン入口とサブボタン */
    #mcwalk-userscript .launcher { position: relative; width: 56px; height: 56px; }
    #mcwalk-userscript button { font: inherit; border: 0; }
    #mcwalk-userscript .app-icon {
      display: block; width: 56px; height: 56px; padding: 0; overflow: hidden;
      border: 1px solid var(--pf-glass-border); border-radius: 13px; background: #071426;
      box-shadow: var(--pf-shadow-chrome); cursor: grab; touch-action: none;
      transition: box-shadow .16s ease, border-color .16s ease;
    }
    #mcwalk-userscript .app-icon:hover { border-color: var(--pf-accent); }
    #mcwalk-userscript .app-icon:active { box-shadow: var(--pf-shadow-pressed); }
    #mcwalk-userscript .app-icon canvas { display: block; width: 100%; height: 100%; pointer-events: none; user-select: none; }
    #mcwalk-userscript[data-state=off] .app-icon canvas { filter: grayscale(.65) brightness(.72); }
    #mcwalk-userscript[data-dragging=true] .app-icon { cursor: grabbing; }
    #mcwalk-userscript .quick-actions {
      display: none; position: absolute; top: 50%; left: calc(100% + 8px);
      align-items: center; gap: 2px; padding: 4px; border: 1px solid var(--pf-glass-border); border-radius: 999px;
      background: rgba(255, 255, 255, .5); box-shadow: var(--pf-shadow-chrome);
      -webkit-backdrop-filter: blur(12px) saturate(1.6); backdrop-filter: blur(12px) saturate(1.6);
      transform: translateY(-50%); white-space: nowrap;
    }
    #mcwalk-userscript[data-menu-open=true] .quick-actions { display: flex; animation: pf-quick-in .18s cubic-bezier(.2, .8, .2, 1) both; }
    #mcwalk-userscript[data-menu-align=left] .quick-actions { right: calc(100% + 8px); left: auto; }
    #mcwalk-userscript[data-menu-open=true][data-menu-align=left] .quick-actions { animation-name: pf-quick-in-left; }
    #mcwalk-userscript .quick-action {
      min-height: 32px; padding: 0 12px; border: 1px solid transparent;
      border-radius: 999px; background: transparent; color: var(--pf-text-2);
      box-shadow: none; cursor: pointer;
      transition: background .16s ease, color .16s ease, box-shadow .16s ease;
    }
    #mcwalk-userscript .quick-action:hover { color: var(--pf-text); background: rgba(255, 255, 255, .58); }
    #mcwalk-userscript .quick-action[aria-expanded=true] {
      color: var(--pf-accent-ink); background: #fff; box-shadow: 0 2px 6px rgba(25, 35, 55, .14);
    }
    #mcwalk-userscript .quick-action:active { background: rgba(255, 255, 255, .72); box-shadow: var(--pf-shadow-pressed); }
    #mcwalk-userscript .toggle { display: flex; align-items: center; gap: 7px; }
    #mcwalk-userscript .onoff { min-width: 28px; color: var(--pf-accent-ink); font: 700 11px/1 ui-monospace, Consolas, monospace; }
    #mcwalk-userscript[data-state=off] .onoff { color: var(--pf-text-3); }
    #mcwalk-userscript .camera, #mcwalk-userscript .settings { font-size: 13px; font-weight: 600; }
    #mcwalk-userscript[data-camera-recording=true] .camera { color: #fff; background: var(--pf-bad); }
  
    /* パネル（ポップアップ） */
    #mcwalk-userscript .panel {
      --pf-panel-pad: 20px; --pf-panel-radius: 18px;
      display: none; position: absolute; top: calc(100% + 10px); left: 0; width: min(420px, calc(100vw - 32px));
      max-height: calc(100dvh - 32px); overflow: auto; isolation: isolate; margin: 0; padding: var(--pf-panel-pad); border: 1px solid rgba(255, 255, 255, .8);
      border-radius: var(--pf-panel-radius); background: var(--pf-panel-fill); color: var(--pf-text); box-shadow: var(--pf-shadow-modal);
      -webkit-backdrop-filter: blur(12px) saturate(1.6); backdrop-filter: blur(12px) saturate(1.6);
      scrollbar-color: rgba(32, 41, 58, .24) transparent; scrollbar-width: thin;
    }
    #mcwalk-userscript[data-open=true] .panel { display: block; animation: pf-panel-down-in .2s cubic-bezier(.2, .8, .2, 1) both; }
    #mcwalk-userscript[data-panel-align=right] .panel { right: 0; left: auto; }
    #mcwalk-userscript[data-panel-vertical=up] .panel { top: auto; bottom: calc(100% + 12px); animation-name: pf-panel-up-in; }
    #mcwalk-userscript[data-panel-section=camera] .settings-view, #mcwalk-userscript[data-panel-section=settings] .camera-view { display: none; }
    #mcwalk-userscript[data-panel-section=camera] .camera-view, #mcwalk-userscript[data-panel-section=settings] .settings-view { animation: pf-content-in .16s ease-out both; }
    #mcwalk-userscript .sep { margin: 14px 0; height: 1px; background: var(--pf-divider); border: 0; }
    /* フォーム要素のレイアウト */
    #mcwalk-userscript label, #mcwalk-userscript .state-row {
      display: flex; justify-content: space-between; align-items: center; min-height: 40px;
      margin: 0 0 2px; padding: 0 11px; border-radius: 10px;
      transition: background .16s ease;
    }
    #mcwalk-userscript label:hover { background: var(--pf-row-hover); }
    #mcwalk-userscript label:last-child { margin-bottom: 0; }
    #mcwalk-userscript label > span:first-child { color: var(--pf-text); font-size: 13px; font-weight: 500; }
    #mcwalk-userscript .state-row {
      position: sticky; top: calc(-1 * var(--pf-panel-pad)); z-index: 2; min-height: 66px;
      margin: calc(-1 * var(--pf-panel-pad)) calc(-1 * var(--pf-panel-pad)) 12px;
      padding: 14px var(--pf-panel-pad) 11px; border-bottom: 1px solid var(--pf-divider);
      border-radius: var(--pf-panel-radius) var(--pf-panel-radius) 0 0; background: rgba(255, 255, 255, .96);
    }
    #mcwalk-userscript .state-row > span:first-child { color: var(--pf-text); font-size: 16px; font-weight: 700; letter-spacing: -.02em; }
    #mcwalk-userscript .state, #mcwalk-userscript .camera-state { color: var(--pf-accent-ink); font-size: 11px; font-weight: 700; }
    #mcwalk-userscript[data-state=flying] .state { color: var(--pf-warn); }
    #nearbyPlayers .nearbyName[data-pathfinder-navigate=true] {
      border-radius: 4px; cursor: pointer; outline: none;
    }
    #nearbyPlayers .nearbyName[data-pathfinder-navigate=true]:hover {
      color: #fff; background: rgba(255, 255, 255, .07);
    }
    #nearbyPlayers .nearbyName[data-pathfinder-navigate=true]:focus-visible {
      box-shadow: 0 0 0 2px #6ee7d2;
    }
    #nearbyPlayers .nearbyRow[data-pathfinder-selected=true] {
      margin-inline: -5px; padding-inline: 5px; border-radius: 5px;
      background: rgba(65, 214, 186, .16);
    }
    #nearbyPlayers .pathfinder-nearby-detail {
      display: inline-flex; flex: 0 0 auto; align-items: center; gap: 5px;
      margin-left: auto; color: #d8e0e9;
      font: 700 11px/1.2 ui-monospace, Consolas, monospace; white-space: nowrap;
    }
    #nearbyPlayers .pathfinder-nearby-arrow {
      display: inline-grid; width: 18px; height: 20px; place-items: center;
      color: #8ce6d4; text-shadow: 0 1px 2px rgba(4, 9, 13, .8);
      font: 850 18px/1 system-ui, sans-serif;
    }
    #nearbyPlayers .pathfinder-nearby-detail + .nearbyReport { margin-left: 2px; }
    #pathfinder-nearby-navigation[hidden] { display: none !important; }
    #pathfinder-nearby-navigation {
      position: fixed; z-index: 2147483500; top: max(18px, env(safe-area-inset-top)); left: 50%;
      display: grid; grid-template-columns: 126px minmax(232px, 1fr) 48px 28px; align-items: center; gap: 15px;
      width: min(540px, calc(100vw - 28px)); min-height: 144px; padding: 14px 12px 14px 15px;
      border: 1px solid rgba(255, 255, 255, .24); border-radius: 12px;
      color: #f7fafc; background: rgba(15, 20, 27, .94);
      box-shadow: 0 4px 12px rgba(0, 0, 0, .28);
      transform: translateX(-50%); animation: pf-nearby-nav-in .18s ease-out both;
      font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
    }
    #pathfinder-nearby-navigation .pathfinder-nav-compass {
      position: relative; width: 122px; height: 122px; border: 1px solid rgba(190, 206, 218, .35);
      border-radius: 50%; background:
        linear-gradient(rgba(190, 206, 218, .11) 1px, transparent 1px) center / 100% 50%,
        linear-gradient(90deg, rgba(190, 206, 218, .11) 1px, transparent 1px) center / 50% 100%,
        rgba(8, 13, 19, .7);
      box-shadow: inset 0 0 0 7px rgba(216, 224, 233, .035), inset 0 0 18px rgba(4, 9, 13, .7);
    }
    #pathfinder-nearby-navigation .pathfinder-nav-cardinal {
      position: absolute; z-index: 2; color: #aeb9c5; font: 750 10px/1 ui-monospace, Consolas, monospace;
    }
    #pathfinder-nearby-navigation .pathfinder-nav-front { top: 8px; left: 50%; transform: translateX(-50%); color: #f0f4f8; }
    #pathfinder-nearby-navigation .pathfinder-nav-right { right: 9px; top: 50%; transform: translateY(-50%); }
    #pathfinder-nearby-navigation .pathfinder-nav-back { bottom: 8px; left: 50%; transform: translateX(-50%); }
    #pathfinder-nearby-navigation .pathfinder-nav-left { left: 9px; top: 50%; transform: translateY(-50%); }
    #pathfinder-nearby-navigation .pathfinder-nav-center {
      position: absolute; z-index: 4; left: 50%; top: 50%; width: 10px; height: 10px;
      border: 2px solid #dce4eb; border-radius: 50%; background: #17212a;
      box-shadow: 0 2px 4px rgba(4, 9, 13, .7); transform: translate(-50%, -50%);
    }
    #pathfinder-nearby-navigation .pathfinder-nav-needle {
      position: absolute; z-index: 3; left: calc(50% - 4px); top: 21px; width: 8px; height: 40px;
      border-radius: 5px 5px 2px 2px; background: linear-gradient(90deg, #087f70 0 40%, #8ce6d4 45% 100%);
      box-shadow: 2px 2px 4px rgba(4, 9, 13, .7);
      clip-path: polygon(50% 0, 100% 25%, 74% 100%, 26% 100%, 0 25%);
      transform: rotate(var(--pathfinder-bearing, 0deg)); transform-origin: 50% 40px;
      transition: transform .18s ease-out;
    }
    #pathfinder-nearby-navigation .pathfinder-nav-copy { min-width: 0; }
    #pathfinder-nearby-navigation strong {
      display: block; overflow: hidden; margin-bottom: 9px; color: #fff; font-size: 15px; line-height: 1.3;
      text-overflow: ellipsis; white-space: nowrap;
    }
    #pathfinder-nearby-navigation .pathfinder-nav-readings {
      display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 9px;
    }
    #pathfinder-nearby-navigation .pathfinder-nav-reading,
    #pathfinder-nearby-navigation .pathfinder-nav-distance-wrap { display: block; min-width: 0; }
    #pathfinder-nearby-navigation small {
      display: block; margin-bottom: 3px; color: #93a3b1; font: 700 9px/1.2 ui-monospace, Consolas, monospace;
    }
    #pathfinder-nearby-navigation .pathfinder-nav-direction,
    #pathfinder-nearby-navigation .pathfinder-nav-elevation {
      display: block; overflow: hidden; color: #eef3f7; font-size: 18px; line-height: 1.1;
      text-overflow: ellipsis; white-space: nowrap;
    }
    #pathfinder-nearby-navigation .pathfinder-nav-elevation { color: #8ce6d4; }
    #pathfinder-nearby-navigation .pathfinder-nav-distance {
      display: block; color: #fff; font: 850 29px/1 ui-monospace, Consolas, monospace;
      letter-spacing: -.045em; white-space: nowrap;
    }
    #pathfinder-nearby-navigation .pathfinder-nav-altimeter {
      display: grid; grid-template-rows: 18px 84px 18px; justify-items: center; align-items: center;
      height: 120px; color: #aeb9c5; font: 750 10px/1 ui-monospace, Consolas, monospace;
    }
    #pathfinder-nearby-navigation .pathfinder-nav-alt-track {
      position: relative; display: block; width: 7px; height: 76px; border-radius: 4px;
      background: rgba(190, 206, 218, .28);
    }
    #pathfinder-nearby-navigation .pathfinder-nav-alt-track::after {
      content: ""; position: absolute; left: -5px; top: 50%; width: 17px; border-top: 1px solid rgba(216, 224, 233, .45);
    }
    #pathfinder-nearby-navigation .pathfinder-nav-alt-marker {
      position: absolute; z-index: 2; left: -6px; top: calc(50% - 6px); width: 19px; height: 12px;
      border: 2px solid #c5fff3; border-radius: 4px; background: #087f70;
      box-shadow: 0 2px 4px rgba(4, 9, 13, .7);
      transform: translateY(var(--pathfinder-altitude, 0px)); transition: transform .18s ease-out;
    }
    #pathfinder-nearby-navigation[data-available=false] .pathfinder-nav-needle,
    #pathfinder-nearby-navigation[data-available=false] .pathfinder-nav-alt-marker {
      background: #64727f; opacity: .65;
    }
    #pathfinder-nearby-navigation > button {
      align-self: start; width: 28px; height: 28px; padding: 0; border: 0; border-radius: 6px;
      color: #cbd3dc; background: transparent; font: 24px/1 system-ui, sans-serif; cursor: pointer;
    }
    #pathfinder-nearby-navigation > button:hover,
    #pathfinder-nearby-navigation > button:focus-visible {
      color: #fff; background: rgba(255, 255, 255, .12); outline: none;
    }
    /* 3place本体と同じピル型スイッチ */
    #mcwalk-userscript input[type=checkbox] {
      position: relative; appearance: none; -webkit-appearance: none; width: 34px; height: 20px;
      flex: 0 0 34px; margin: 0; border: 0; border-radius: 999px;
      background: rgba(32, 41, 58, .18); cursor: pointer; transition: background .16s ease;
    }
    #mcwalk-userscript input[type=checkbox]::before {
      content: ""; position: absolute; top: 2px; left: 2px; width: 16px; height: 16px;
      border-radius: 50%; background: #fff; box-shadow: 0 1px 3px rgba(20, 30, 55, .24);
      transition: transform .16s ease;
    }
    #mcwalk-userscript input[type=checkbox]:checked { background: var(--pf-accent); }
    #mcwalk-userscript input[type=checkbox]:checked::before { transform: translateX(14px); }
  
    /* セレクトボックス */
    #mcwalk-userscript select {
      min-width: 122px; height: 30px; padding: 0 28px 0 9px; border: 1px solid var(--pf-control-border); border-radius: 9px;
      color: var(--pf-text); background: #fff; font: 500 13px/1 "Space Grotesk", system-ui, sans-serif; cursor: pointer; outline: none;
    }
    #mcwalk-userscript select:hover { border-color: color-mix(in srgb, var(--pf-accent) 55%, transparent); }
  
    /* スライダー（Range） */
    #mcwalk-userscript .range {
      display: grid; grid-template-columns: 1fr auto; gap: 7px 8px; min-height: 52px;
      margin: 0 0 2px; padding: 8px 11px; border-radius: 10px; transition: background .16s ease;
    }
    #mcwalk-userscript .range:hover { background: var(--pf-row-hover); }
    #mcwalk-userscript .range span { grid-column: 1 / 2; }
    #mcwalk-userscript output { grid-column: 2 / 3; color: var(--pf-accent-ink); font: 700 11px ui-monospace, Consolas, monospace; text-align: right; }
    #mcwalk-userscript input[type=range] {
      grid-column: 1 / -1; appearance: none; -webkit-appearance: none; width: 100%; height: 4px;
      background: rgba(32, 41, 58, .18); border-radius: 999px; outline: none; margin: 2px 0 0;
    }
    #mcwalk-userscript input[type=range]::-webkit-slider-thumb {
      -webkit-appearance: none; width: 16px; height: 16px; border: 2px solid #fff; border-radius: 50%;
      background: var(--pf-accent); box-shadow: 0 1px 4px rgba(20, 30, 55, .24); cursor: pointer;
    }
    #mcwalk-userscript input[type=range]::-moz-range-thumb { width: 12px; height: 12px; border: 2px solid #fff; border-radius: 50%; background: var(--pf-accent); cursor: pointer; }
  
    /* 各種ボタン */
    #mcwalk-userscript .reload, #mcwalk-userscript .camera-crop-row button, #mcwalk-userscript .camera-actions button, #mcwalk-userscript .fov-reset {
      min-height: 36px; border: 1px solid var(--pf-control-border); border-radius: 10px; color: var(--pf-text); background: #fff;
      box-shadow: 0 2px 6px rgba(25, 35, 55, .08); cursor: pointer; padding: 0 13px; font-size: 13px; font-weight: 600;
      transition: border-color .16s ease, background .16s ease, box-shadow .16s ease;
    }
    #mcwalk-userscript .reload:hover, #mcwalk-userscript .camera-crop-row button:hover:not(:disabled), #mcwalk-userscript .camera-actions button:hover:not(:disabled), #mcwalk-userscript .fov-reset:hover:not(:disabled) {
      border-color: color-mix(in srgb, var(--pf-accent) 45%, transparent); color: var(--pf-accent-ink); background: var(--pf-glass-hover);
    }
    #mcwalk-userscript .reload:active, #mcwalk-userscript .camera-crop-row button:active:not(:disabled), #mcwalk-userscript .camera-actions button:active:not(:disabled), #mcwalk-userscript .fov-reset:active:not(:disabled) { background: #f2f5f6; box-shadow: none; }
    #mcwalk-userscript .camera-crop-row {
      display: grid; grid-template-columns: 1fr auto; align-items: center; gap: 8px;
      margin: 0 0 10px; padding: 8px 11px; border-radius: 10px; transition: background .16s ease;
    }
    #mcwalk-userscript .camera-crop-row:hover { background: var(--pf-row-hover); }
    #mcwalk-userscript .camera-crop-row button { grid-column: 1 / -1; }
    #mcwalk-userscript .camera-actions { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 16px; }
    #mcwalk-userscript .camera-photo { border-color: transparent !important; color: #fff !important; background: var(--pf-accent-ink) !important; }
    #mcwalk-userscript .camera-photo:hover:not(:disabled) { color: #fff !important; filter: brightness(.96); }
    #mcwalk-userscript[data-camera-recording=true] .camera-record { border-color: var(--pf-bad); color: #fff; background: var(--pf-bad); }
  
    /* その他テキスト、折りたたみメニュー */
    #mcwalk-userscript p { margin: 10px 0 0; color: var(--pf-text-2); font-size: 11px; line-height: 1.55; }
    #mcwalk-userscript details { margin-top: 14px; padding-top: 12px; border-top: 1px solid var(--pf-divider); }
    #mcwalk-userscript summary { display: flex; align-items: center; justify-content: space-between; min-height: 32px; color: var(--pf-text-2); font-size: 13px; font-weight: 600; cursor: pointer; list-style: none; user-select: none; }
    #mcwalk-userscript summary::-webkit-details-marker { display: none; }
    #mcwalk-userscript summary::after { content: "+"; font-size: 16px; font-weight: 400; color: var(--pf-text-3); }
    #mcwalk-userscript details[open] summary::after { content: "−"; }
    #mcwalk-userscript summary:hover { color: var(--pf-accent-ink); }
    #mcwalk-userscript .compat-summary { margin-left: auto; margin-right: 8px; color: var(--pf-text-3); font: 600 11px/1 ui-monospace, Consolas, monospace; }
    #mcwalk-userscript .compat-grid { display: grid; grid-template-columns: 1fr auto; gap: 8px 12px; margin-top: 12px; font-size: 11px; }
    #mcwalk-userscript .compat-grid span:nth-child(odd) { color: var(--pf-text-2); }
    #mcwalk-userscript .compat-grid span:nth-child(even) { font-family: ui-monospace, Consolas, monospace; font-size: 11px; text-align: right; }
    #mcwalk-userscript [data-level=ok] { color: var(--pf-accent-ink) !important; }
    #mcwalk-userscript [data-level=error] { color: var(--pf-bad) !important; }
    #mcwalk-userscript .reload-row { display: flex; align-items: center; justify-content: space-between; margin-top: 14px; padding-top: 14px; border-top: 1px solid var(--pf-divider); }
    #mcwalk-userscript .note { color: var(--pf-warn); font-size: 11px; font-weight: 600; }
    #mcwalk-userscript button:focus-visible, #mcwalk-userscript select:focus-visible, #mcwalk-userscript input:focus-visible, #mcwalk-userscript summary:focus-visible {
      outline: 2px solid var(--pf-accent); outline-offset: 2px;
    }
    #mcwalk-userscript button:disabled, #mcwalk-userscript select:disabled, #mcwalk-userscript input:disabled {
      opacity: .46; cursor: not-allowed; transform: none !important; box-shadow: none;
    }

    /* Capture-area selector. It lives outside #mcwalk-userscript so it needs
       its own complete positioning and control styles. */
    #pathfinder-camera-crop, #pathfinder-camera-crop * { box-sizing: border-box; }
    #pathfinder-camera-crop {
      position: fixed; inset: 0; z-index: 2147483646; overflow: hidden;
      color: var(--text, #20293a); font: 600 13px/1.4 "Space Grotesk", system-ui, sans-serif;
      user-select: none; touch-action: none;
    }
    #pathfinder-camera-crop .crop-box {
      position: fixed; min-width: 1px; min-height: 1px; border: 2px solid var(--accent, #0d9488);
      background: var(--accent-tint, rgba(13, 148, 136, .08));
      box-shadow: 0 0 0 9999px rgba(16, 19, 24, .58), 0 0 0 4px var(--accent-tint, rgba(13, 148, 136, .14));
      cursor: move; touch-action: none;
    }
    #pathfinder-camera-crop .crop-box::before {
      content: ""; position: absolute; inset: 5px; border: 1px dashed rgba(255, 255, 255, .7);
      pointer-events: none;
    }
    #pathfinder-camera-crop .crop-toolbar {
      position: fixed; top: max(12px, env(safe-area-inset-top)); left: 50%;
      display: flex; align-items: center; gap: 6px; max-width: calc(100vw - 24px);
      padding: 6px; border: 1px solid var(--glass-border, rgba(255, 255, 255, .7)); border-radius: 18px;
      background: rgba(255, 255, 255, .94); box-shadow: var(--shadow-raised, 0 14px 34px rgba(25, 35, 55, .26));
      -webkit-backdrop-filter: blur(12px) saturate(1.6); backdrop-filter: blur(12px) saturate(1.6);
      transform: translateX(-50%); cursor: default; white-space: nowrap;
    }
    #pathfinder-camera-crop .crop-toolbar span { margin: 0 6px; color: var(--accent-ink, #0b6e66); }
    #pathfinder-camera-crop .crop-toolbar button {
      min-height: 32px; padding: 0 12px; border: 1px solid rgba(20, 30, 50, .16); border-radius: 10px;
      color: var(--text, #20293a); background: #fff; font: inherit; cursor: pointer;
    }
    #pathfinder-camera-crop .crop-toolbar button:hover,
    #pathfinder-camera-crop .crop-toolbar button:focus-visible {
      border-color: var(--accent, #0d9488); color: var(--accent-ink, #0b6e66); background: var(--glass-fill-hover, rgba(255, 255, 255, .9)); outline: none;
    }
    #pathfinder-camera-crop .crop-toolbar button:focus-visible { outline: 2px solid var(--accent, #0d9488); outline-offset: 2px; }
    #pathfinder-camera-crop .crop-resize {
      position: absolute; right: 6px; bottom: 6px; width: 24px; height: 24px;
      border-right: 5px solid var(--accent, #0d9488); border-bottom: 5px solid var(--accent, #0d9488);
      filter: drop-shadow(0 1px 2px rgba(20, 30, 55, .34)); cursor: nwse-resize; touch-action: none;
    }

    @media (max-width: 720px), (pointer: coarse) {
      #nearbyPlayers .pathfinder-nearby-detail { display: none !important; }
      #nearbyPlayers .nearbyName[data-pathfinder-navigate=true] {
        display: flex; align-items: center; min-width: 0; min-height: 36px;
        padding-inline: 4px; touch-action: manipulation;
      }
      #nearbyPlayers .nearbyRow[data-pathfinder-selected=true] {
        margin-inline: 0; padding-inline: 0;
        box-shadow: inset 3px 0 0 #6ee7d2;
      }
      #pathfinder-nearby-navigation {
        top: auto; bottom: calc(max(12px, env(safe-area-inset-bottom)) + 72px);
        grid-template-columns: minmax(0, 1fr) 44px; gap: 8px;
        width: min(420px, calc(100vw - 20px)); min-height: 0;
        padding: 10px 8px 10px 12px; animation: none;
      }
      #pathfinder-nearby-navigation .pathfinder-nav-compass,
      #pathfinder-nearby-navigation .pathfinder-nav-altimeter { display: none; }
      #pathfinder-nearby-navigation .pathfinder-nav-copy {
        display: grid; grid-template-columns: minmax(0, 1fr) auto;
        align-items: end; gap: 6px 10px;
      }
      #pathfinder-nearby-navigation strong {
        grid-column: 1 / -1; margin-bottom: 0; font-size: 13px;
      }
      #pathfinder-nearby-navigation .pathfinder-nav-readings {
        display: grid; grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 8px; margin-bottom: 0;
      }
      #pathfinder-nearby-navigation small { margin-bottom: 2px; font-size: 8px; }
      #pathfinder-nearby-navigation .pathfinder-nav-direction,
      #pathfinder-nearby-navigation .pathfinder-nav-elevation { font-size: 13px; }
      #pathfinder-nearby-navigation .pathfinder-nav-distance-wrap { text-align: right; }
      #pathfinder-nearby-navigation .pathfinder-nav-distance { font-size: 20px; }
      #pathfinder-nearby-navigation > button {
        align-self: center; width: 44px; height: 44px; font-size: 22px;
        touch-action: manipulation;
      }
      #mcwalk-userscript label, #mcwalk-userscript .state-row { min-height: 48px; }
      #mcwalk-userscript .quick-action { min-height: 44px; }
      #mcwalk-userscript .reload,
      #mcwalk-userscript .camera-crop-row button,
      #mcwalk-userscript .camera-actions button,
      #mcwalk-userscript .fov-reset { min-height: 44px; }
    }

    @media (max-width: 520px) {
      #pathfinder-camera-crop .crop-toolbar { flex-wrap: wrap; justify-content: center; white-space: normal; }
      #pathfinder-camera-crop .crop-toolbar span { flex-basis: 100%; text-align: center; }
      #mcwalk-userscript .panel {
        --pf-panel-pad: 16px; --pf-panel-radius: 16px;
        width: calc(100vw - 24px); max-height: min(72dvh, 620px);
      }
      #mcwalk-userscript .camera-actions { grid-template-columns: 1fr; }
      #mcwalk-userscript .quick-action { padding: 0 11px; }
    }
  
    /* 一般設定: 装飾カードではなく区切り線中心のツール画面 */
    #mcwalk-userscript .settings-header {
      position: sticky; top: calc(-1 * var(--pf-panel-pad)); z-index: 2;
      display: flex; align-items: center; justify-content: space-between; min-height: 66px;
      margin: calc(-1 * var(--pf-panel-pad)) calc(-1 * var(--pf-panel-pad)) 12px;
      padding: 14px var(--pf-panel-pad) 11px; border-bottom: 1px solid var(--pf-divider);
      border-radius: var(--pf-panel-radius) var(--pf-panel-radius) 0 0; background: rgba(255, 255, 255, .96);
    }
    #mcwalk-userscript .settings-header strong { display: block; color: var(--pf-text); font-size: 16px; font-weight: 700; letter-spacing: -.02em; }
    #mcwalk-userscript .settings-header small { display: block; margin-top: 2px; color: var(--pf-text-3); font: 11px/1.3 ui-monospace, Consolas, monospace; }
    #mcwalk-userscript .settings-group { margin: 0; padding: 0 0 4px; }
    #mcwalk-userscript .settings-group + .settings-group { margin-top: 10px; padding-top: 12px; border-top: 1px solid var(--pf-divider); }
    #mcwalk-userscript .settings-group h3 {
      margin: 0 11px 5px; color: var(--pf-text-3); font-size: 11px; font-weight: 650;
      letter-spacing: 0;
    }
    #mcwalk-userscript .settings-view label { min-height: 40px; margin-bottom: 2px; }
    #mcwalk-userscript .settings-view .range { margin-bottom: 2px; }
    #mcwalk-userscript .settings-view .range:last-child { margin-bottom: 0; }
    #mcwalk-userscript .setting-action-row { grid-column: 1 / -1; display: flex; justify-content: flex-end; margin-top: 2px; }
    #mcwalk-userscript .setting-action-row .fov-reset { min-height: 30px; }
    #mcwalk-userscript .setting-note { margin: 3px 11px 6px; color: var(--pf-text-3); }
    #mcwalk-userscript .settings-help, #mcwalk-userscript .settings-view .compatibility { margin-top: 12px; padding-top: 10px; }
    #mcwalk-userscript .shortcut-grid { display: grid; grid-template-columns: auto 1fr; gap: 7px 10px; margin-top: 10px; color: var(--pf-text-2); font-size: 11px; }
    #mcwalk-userscript .shortcut-grid kbd {
      min-width: 66px; padding: 3px 6px; border: 1px solid var(--pf-control-border); border-radius: 7px;
      color: var(--pf-text); background: #fff; box-shadow: 0 1px 2px rgba(25, 35, 55, .08); font: 11px/1.4 ui-monospace, Consolas, monospace; text-align: center;
    }
    @media (max-width: 720px), (pointer: coarse) {
      #mcwalk-userscript .settings-view label,
      #mcwalk-userscript summary { min-height: 48px; }
      #mcwalk-userscript .setting-action-row .fov-reset { min-height: 44px; }
    }
    @keyframes pf-quick-in { from { opacity: 0; transform: translate(-6px, -50%); } to { opacity: 1; transform: translate(0, -50%); } }
    @keyframes pf-quick-in-left { from { opacity: 0; transform: translate(6px, -50%); } to { opacity: 1; transform: translate(0, -50%); } }
    @keyframes pf-panel-down-in { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
    @keyframes pf-panel-up-in { from { opacity: 0; transform: translateY(-8px); } to { opacity: 1; transform: translateY(0); } }
    @keyframes pf-content-in { from { opacity: 0; transform: translateY(5px); } to { opacity: 1; transform: translateY(0); } }
    @keyframes pf-nearby-nav-in { from { opacity: 0; transform: translate(-50%, -8px); } to { opacity: 1; transform: translate(-50%, 0); } }
    @media (prefers-reduced-motion: reduce) {
      #mcwalk-userscript *, #pathfinder-camera-crop *, #pathfinder-nearby-navigation * { scroll-behavior: auto !important; transition-duration: .01ms !important; animation-duration: .01ms !important; animation-iteration-count: 1 !important; }
    }
  `;
  const addStyle = () => {
    const style = document.createElement("style");
    style.textContent = CSS;
    (document.head || document.documentElement).append(style);
  };
  const setThirdPersonDistance = (value, persistImmediately = true) => {
    config.thirdPersonDistance = clampThirdPersonDistance(value);
    if (widget) {
      widget.thirdPersonDistance.value = String(config.thirdPersonDistance);
      widget.thirdPersonDistanceValue.textContent =
        `${config.thirdPersonDistance.toFixed(1)} block`;
    }
    sync3d();
    if (persistImmediately) {
      save();
      return;
    }
    clearTimeout(distanceSaveTimer);
    distanceSaveTimer = setTimeout(
      save,
      UI_TIMING.DISTANCE_SAVE_DEBOUNCE_MS,
    );
  };
  const setThirdPersonView = (value) => {
    config.thirdPersonView =
      value === "rear" || value === "front" ? value : "off";
    save();
    sync3d();
    updateWidget();
  };
  const cycleThirdPersonView = () => {
    const views = ["off", "rear", "front"];
    const index = views.indexOf(config.thirdPersonView);
    setThirdPersonView(views[(index + 1) % views.length]);
  };
  const eventTargetsStreetWorld = (event) => {
    const target = event.target;
    const streetWrap = document.getElementById("streetWrap");
    return target instanceof Node && Boolean(streetWrap?.contains(target));
  };
  const bindKeys = () => {
    if (keysBound) return;
    keysBound = true;
    addEventListener("keydown", (event) => {
      const target = event.target;
      const editing =
        target instanceof HTMLElement &&
        (target.isContentEditable ||
          /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));
      if (
        !editing &&
        !cameraCropOverlay &&
        !event.repeat &&
        !event.altKey &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.shiftKey &&
        (event.code === "F8" || event.code === "F9")
      ) {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (event.code === "F8") {
          void capturePathfinderPhoto();
        } else {
          void togglePathfinderRecording();
        }
        return;
      }
      if (
        !editing &&
        !event.repeat &&
        event.code === "KeyV" &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.shiftKey
      ) {
        event.preventDefault();
        cycleThirdPersonView();
      }
      if (event.altKey && !event.repeat && event.code === "KeyT") {
        event.preventDefault();
        config.headlightEnabled = !config.headlightEnabled;
        if (widget) widget.headlight.checked = config.headlightEnabled;
        save();
        sync3d();
      }
      if (event.altKey && !event.repeat && event.code === "KeyN") {
        event.preventDefault();
        config.darkNight = !config.darkNight;
        if (widget) widget.darkNight.checked = config.darkNight;
        save();
        sync3d();
      }
    }, true);
    addEventListener(
      "wheel",
      (event) => {
        if (
          !config.enabled ||
          !firstPersonActive ||
          !event.altKey ||
          config.thirdPersonView === "off" ||
          !eventTargetsStreetWorld(event) ||
          widget?.root.contains(event.target)
        ) {
          return;
        }
        const pixels =
          event.deltaMode === WheelEvent.DOM_DELTA_LINE
            ? event.deltaY * 16
            : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
              ? event.deltaY * innerHeight
              : event.deltaY;
        if (!Number.isFinite(pixels) || pixels === 0) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        const direction = Math.sign(pixels);
        const strength = Math.min(1.5, Math.max(0.35, Math.abs(pixels) / 100));
        setThirdPersonDistance(
          config.thirdPersonDistance + direction * strength * 0.55,
          false,
        );
      },
      { capture: true, passive: false },
    );
  };
  const createWidget = () => {
    if (widget || !document.body) return;
    const root = document.createElement("aside");
    root.id = "mcwalk-userscript";
    root.dataset.menuOpen = "false";
    root.dataset.open = "false";
    root.dataset.panelSection = "settings";
    root.innerHTML = `
      <div class="launcher">
        <button class="app-icon drag" type="button" aria-label="${tr("3place Pathfinderメニュー", "3place Pathfinder menu")}" aria-controls="pathfinder-quick-actions" aria-expanded="false" title="${tr("クリック: メニュー / ドラッグ: 移動", "Click: menu / Drag: move")}">
          <canvas width="40" height="40" aria-hidden="true"></canvas>
        </button>
        <div id="pathfinder-quick-actions" class="quick-actions" aria-hidden="true">
          <button class="quick-action toggle" type="button" title="${tr("3place PathfinderをON/OFF", "Turn 3place Pathfinder on/off")}">
            <span>${tr("機能", "Features")}</span><span class="onoff">ON</span>
          </button>
          <button class="quick-action camera" type="button" aria-controls="pathfinder-panel" aria-expanded="false">${tr("カメラ設定", "Camera")}</button>
          <button class="quick-action settings" type="button" aria-controls="pathfinder-panel" aria-expanded="false">${tr("一般設定", "General")}</button>
        </div>
      </div>
  
      <section id="pathfinder-panel" class="panel" role="region" aria-label="3place Pathfinder">
        <!-- カメラビュー -->
        <div class="camera-view">
          <div class="state-row">
            <span>PATHFINDER CAMERA</span>
            <span class="camera-state">${tr("3D表示待ち", "Waiting for 3D view")}</span>
          </div>
          <label><span>${tr("撮影視点", "Capture view")}</span><select class="camera-view-select"><option value="off">${tr("一人称", "First-person")}</option><option value="rear">${tr("三人称・後方", "Third-person · Rear")}</option><option value="front">${tr("三人称・前方", "Third-person · Front")}</option></select></label>
          <label><span>${tr("動画形式", "Video format")}</span><select class="camera-format"><option value="auto">${tr("自動（MP4優先）", "Auto (prefer MP4)")}</option><option value="mp4">MP4 (H.264)</option><option value="webm">WebM</option></select></label>
          <div class="camera-crop-row">
            <span>${tr("撮影範囲", "Capture area")}</span><output class="camera-crop-value">${tr("全画面", "Full screen")}</output>
            <button class="camera-crop" type="button">${tr("画面上で範囲を選択", "Select area on screen")}</button>
          </div>
          <label><span>Unofficial Credit</span><input class="camera-unofficial-credit" type="checkbox"></label>
          <div class="sep"></div>
          <div class="camera-actions">
            <button class="camera-photo" type="button">${tr("静止画を保存", "Save photo")}</button>
            <button class="camera-record" type="button">${tr("動画を録画", "Record video")}</button>
          </div>
          <p class="camera-message">${tr("3D表示を開くと撮影できます", "Open the 3D view to enable capture")}</p>
          <details>
            <summary>${tr("ヘルプ", "Help")}</summary>
            <p>${tr("F8: 静止画 F9: 録画開始／終了", "F8: Photo  F9: Start/stop recording")}<br>${tr("枠の内側へ海・背景と3D表示を合成し、クレジットを付けて保存します。操作UIは入りません。動画は無音・30fpsです。", "Composites the ocean, background, and 3D view inside the frame, then saves it with a credit. Controls are excluded. Videos are silent at 30 fps.")}</p>
          </details>
        </div>
  
        <!-- 設定ビュー -->
        <div class="settings-view">
          <header class="settings-header">
            <div><strong>${tr("一般設定", "General settings")}</strong><small>3place Pathfinder v${VERSION}</small></div>
            <span class="state">READY</span>
          </header>
  
          <section class="settings-group" aria-labelledby="pathfinder-basic-settings">
            <h3 id="pathfinder-basic-settings">${tr("基本", "General")}</h3>
            <label><span>${tr("機能を有効にする", "Enable features")}</span><input class="enabled" type="checkbox"></label>
            <label><span>${tr("言語(Language)", "Language(言語)")}</span><select class="language"><option value="auto">${tr("自動（ブラウザー）", "Auto (browser)")}</option><option value="ja">${tr("日本語", "Japanese")}</option><option value="en">English</option></select></label>
          </section>
  
          <section class="settings-group" aria-labelledby="pathfinder-view-settings">
            <h3 id="pathfinder-view-settings">${tr("視点", "View")}</h3>
            <label><span>${tr("三人称視点", "Third-person view")}</span><select class="third-person-view"><option value="off">OFF</option><option value="rear">${tr("後方", "Rear")}</option><option value="front">${tr("前方", "Front")}</option></select></label>
            <div class="range">
              <span>${tr("三人称表示距離", "Third-person distance")}</span><output class="third-person-distance-value"></output>
              <input class="third-person-distance" type="range" min="1.6" max="30" step=".1">
            </div>
          </section>
  
          <section class="settings-group" aria-labelledby="pathfinder-light-settings">
            <h3 id="pathfinder-light-settings">${tr("照明", "Lighting")}</h3>
            <label><span>${tr("ヘルメットライト", "Helmet lights")}</span><input class="headlight" type="checkbox"></label>
            <div class="range">
              <span>${tr("ライト強度", "Light intensity")}</span><output class="light-value"></output>
              <input class="light" type="range" min="20" max="160" step="5">
            </div>
            <label><span>${tr("ダークナイト", "Dark night")}</span><input class="dark-night" type="checkbox"></label>
            <p class="setting-note">${tr("3placeの夜間視認性補正を止め、以前の暗い夜に戻します。", "Disables 3place's nighttime visibility correction and restores the darker night appearance.")}</p>
          </section>

          <section class="settings-group" aria-labelledby="pathfinder-graphics-settings">
            <h3 id="pathfinder-graphics-settings">${tr("Pathfinderグラフィック", "Pathfinder graphics")}</h3>
            <label><span>${tr("負荷設定", "Performance profile")}</span><select class="graphics-profile"><option value="quality">${tr("画質優先", "Quality")}</option><option value="balanced">${tr("バランス", "Balanced")}</option><option value="performance">${tr("軽量", "Performance")}</option></select></label>
            <p class="setting-note">${tr("公式のグラフィック設定には影響しません。画質優先: 周囲4人のライトを20fps更新。バランス: 2人を10fps更新。軽量: 周囲のライトと三人称衝突回避を停止します。", "Does not change official graphics settings. Quality: 4 nearby lights updated at 20 fps. Balanced: 2 lights at 10 fps. Performance: disables nearby lights and third-person collision avoidance.")}</p>
          </section>
  
          <details class="settings-help">
            <summary>${tr("操作方法", "Controls")}</summary>
            <div class="shortcut-grid">
              <kbd>V / Alt+V</kbd><span>${tr("視点を切り替える", "Switch view")}</span>
              <kbd>Alt + ${tr("ホイール", "Wheel")}</kbd><span>${tr("三人称の表示距離を調整", "Adjust third-person distance")}</span>
              <kbd>F8</kbd><span>${tr("静止画を保存", "Save photo")}</span>
              <kbd>F9</kbd><span>${tr("録画を開始・終了", "Start/stop recording")}</span>
              <kbd>Alt+T</kbd><span>${tr("ライトを切り替える", "Toggle lights")}</span>
              <kbd>Alt+N</kbd><span>${tr("ダークナイトを切り替える", "Toggle dark night")}</span>
            </div>
          </details>
  
          <details class="compatibility">
            <summary>${tr("互換性情報", "Compatibility")} <span class="compat-summary">v${VERSION}</span></summary>
            <div class="compat-grid">
              <span>${tr("3D接続", "3D connection")}</span><span class="compat-hook">${tr("3D表示待ち", "Waiting for 3D view")}</span>
              <span>${tr("3D部品", "3D components")}</span><span class="compat-resolver">${tr("未使用", "Not used")}</span>
              <span>${tr("三人称操作", "Third-person controls")}</span><span class="compat-pointer">${tr("未確認", "Not checked")}</span>
              <span>${tr("ライト", "Lights")}</span><span class="bridge-status">${tr("接続待ち", "Waiting to connect")}</span>
              <span>${tr("三人称", "Third-person")}</span><span class="third-person-status">${tr("準備中", "Preparing")}</span>
              <span>${tr("カメラ", "Camera")}</span><span class="compat-camera">${tr("接続待ち", "Waiting to connect")}</span>
            </div>
          </details>
          <p class="compat-alert" hidden></p>
  
          <div class="reload-row">
            <span class="note"></span>
            <button class="reload" type="button">${tr("再読み込み", "Reload")}</button>
          </div>
        </div>
      </section>`;
    document.body.append(root);
    const get = (selector) => root.querySelector(selector);
    drawPathfinderLauncherIcon(get(".app-icon canvas"));
    widget = {
      root,
      launcher: get(".app-icon"),
      quickActions: get(".quick-actions"),
      drag: get(".drag"),
      toggle: get(".toggle"),
      camera: get(".camera"),
      settings: get(".settings"),
      onOff: get(".onoff"),
      state: get(".state"),
      enabled: get(".enabled"),
      language: get(".language"),
      thirdPersonView: get(".third-person-view"),
      cameraView: get(".camera-view-select"),
      cameraFormat: get(".camera-format"),
      cameraCrop: get(".camera-crop"),
      cameraCropValue: get(".camera-crop-value"),
      cameraUnofficialCredit: get(".camera-unofficial-credit"),
      thirdPersonDistance: get(".third-person-distance"),
      thirdPersonDistanceValue: get(".third-person-distance-value"),
      headlight: get(".headlight"),
      light: get(".light"),
      lightValue: get(".light-value"),
      darkNight: get(".dark-night"),
      graphicsProfile: get(".graphics-profile"),
      note: get(".note"),
      compatSummary: get(".compat-summary"),
      compatHook: get(".compat-hook"),
      compatResolver: get(".compat-resolver"),
      compatPointer: get(".compat-pointer"),
      compatCamera: get(".compat-camera"),
      compatAlert: get(".compat-alert"),
      thirdPersonStatus: get(".third-person-status"),
      bridgeStatus: get(".bridge-status"),
      cameraState: get(".camera-state"),
      cameraMessage: get(".camera-message"),
      cameraPhoto: get(".camera-photo"),
      cameraRecord: get(".camera-record"),
    };
    widget.enabled.checked = config.enabled;
    widget.language.value = config.language;
    widget.thirdPersonView.value = config.thirdPersonView;
    widget.cameraView.value = config.thirdPersonView;
    widget.cameraFormat.value = config.cameraVideoFormat;
    widget.cameraCropValue.textContent = config.cameraCrop
      ? `${Math.round(config.cameraCrop.width * 100)}% × ${Math.round(config.cameraCrop.height * 100)}%`
      : tr("全画面", "Full screen");
    widget.cameraUnofficialCredit.checked = config.cameraUnofficialCredit;
    widget.thirdPersonDistance.value = String(config.thirdPersonDistance);
    widget.thirdPersonDistanceValue.textContent =
      `${config.thirdPersonDistance.toFixed(1)} block`;
    widget.headlight.checked = config.headlightEnabled;
    widget.light.value = String(config.lightIntensity);
    widget.lightValue.textContent = String(config.lightIntensity);
    widget.darkNight.checked = config.darkNight;
    widget.graphicsProfile.value = config.graphicsProfile;
    updateBridgeStatus();
    updateThirdPersonStatus();
    updateCameraStatus();
    bindPanelDrag(root, widget.drag);
    widget.toggle.onclick = () => setEnabled(!config.enabled);
    const setLauncherMenu = (open) => {
      root.dataset.menuOpen = String(open);
      widget.launcher.setAttribute("aria-expanded", String(open));
      widget.quickActions.setAttribute("aria-hidden", String(!open));
      if (!open) {
        root.dataset.open = "false";
        widget.camera.setAttribute("aria-expanded", "false");
        widget.settings.setAttribute("aria-expanded", "false");
        return;
      }
      requestAnimationFrame(() => positionLauncherMenu(root));
    };
    widget.launcher.onclick = () => {
      if (root.dataset.suppressLauncherClick === "true") {
        delete root.dataset.suppressLauncherClick;
        return;
      }
      setLauncherMenu(root.dataset.menuOpen !== "true");
    };
    const togglePanel = (section) => {
      const open =
        root.dataset.open !== "true" ||
        root.dataset.panelSection !== section;
      root.dataset.panelSection = section;
      root.dataset.open = String(open);
      widget.camera.setAttribute(
        "aria-expanded",
        String(open && section === "camera"),
      );
      widget.settings.setAttribute(
        "aria-expanded",
        String(open && section === "settings"),
      );
      if (open) {
        requestAnimationFrame(() => positionPanel(root));
      }
    };
    widget.camera.onclick = () => togglePanel("camera");
    widget.settings.onclick = () => togglePanel("settings");
    addEventListener(
      "pointerdown",
      (event) => {
        if (
          root.dataset.menuOpen === "true" &&
          event.target instanceof Node &&
          !root.contains(event.target) &&
          !cameraCropOverlay
        ) {
          setLauncherMenu(false);
        }
      },
      true,
    );
    addEventListener(
      "keydown",
      (event) => {
        if (
          event.key === "Escape" &&
          root.dataset.menuOpen === "true" &&
          !cameraCropOverlay
        ) {
          setLauncherMenu(false);
          widget.launcher.focus({ preventScroll: true });
        }
      },
      true,
    );
    widget.enabled.onchange = () => setEnabled(widget.enabled.checked);
    widget.language.onchange = () => {
      config.language = SUPPORTED_LANGUAGES.has(widget.language.value)
        ? widget.language.value
        : "auto";
      save();
      location.reload();
    };
    widget.thirdPersonView.onchange = () => {
      setThirdPersonView(widget.thirdPersonView.value);
    };
    widget.cameraView.onchange = () => {
      setThirdPersonView(widget.cameraView.value);
    };
    widget.cameraFormat.onchange = () => {
      config.cameraVideoFormat =
        widget.cameraFormat.value === "mp4" ||
        widget.cameraFormat.value === "webm"
          ? widget.cameraFormat.value
          : "auto";
      save();
      sync3d();
      updateCameraStatus();
    };
    widget.cameraCrop.onclick = openCameraCropSelector;
    widget.cameraUnofficialCredit.onchange = () => {
      config.cameraUnofficialCredit =
        widget.cameraUnofficialCredit.checked;
      save();
      sync3d();
    };
    widget.thirdPersonDistance.oninput = () => {
      setThirdPersonDistance(widget.thirdPersonDistance.value);
    };
    widget.headlight.onchange = () => {
      config.headlightEnabled = widget.headlight.checked;
      save();
      sync3d();
    };
    widget.light.oninput = () => {
      config.lightIntensity = Number(widget.light.value);
      widget.lightValue.textContent = String(config.lightIntensity);
      save();
      sync3d();
    };
    widget.darkNight.onchange = () => {
      config.darkNight = widget.darkNight.checked;
      save();
      sync3d();
    };
    widget.graphicsProfile.onchange = () => {
      config.graphicsProfile = GRAPHICS_PROFILES.has(
        widget.graphicsProfile.value,
      )
        ? widget.graphicsProfile.value
        : "quality";
      save();
      sync3d();
      updateWidget();
    };
    widget.cameraPhoto.onclick = capturePathfinderPhoto;
    widget.cameraRecord.onclick = togglePathfinderRecording;
    get(".reload").onclick = () => location.reload();
    addEventListener("pathfinder-camera-state", updateCameraStatus);
    if (!cameraUiTimer) {
      cameraUiTimer = window.setInterval(
        updateCameraStatus,
        UI_TIMING.CAMERA_STATUS_REFRESH_MS,
      );
      addEventListener(
        "pagehide",
        () => {
          closeCameraCropSelector();
          officialUiObserver?.disconnect();
          officialUiObserver = null;
          officialControlDiscoveryObserver?.disconnect();
          officialControlDiscoveryObserver = null;
          if (cameraUiTimer) clearInterval(cameraUiTimer);
          cameraUiTimer = 0;
        },
        { once: true },
      );
    }
    updateWidget();
    updateCameraStatus();
  };
  // Startup orchestration
  const boot = () => {
    bindKeys();
    createWidget();
    observeMode();
    observeOfficialUiVisibility();
    if (!officialControlDiscoveryObserver && document.body) {
      officialControlDiscoveryObserver = new MutationObserver(() => {
        observeMode();
        if (!officialUiObserver) observeOfficialUiVisibility();
      });
      officialControlDiscoveryObserver.observe(document.body, {
        childList: true,
        subtree: true,
      });
    }
    sync3d();
    if (!bridgeStatusObserver && document.documentElement) {
      bridgeStatusObserver = new MutationObserver(() => {
        updateBridgeStatus();
        updateThirdPersonStatus();
      });
      bridgeStatusObserver.observe(document.documentElement, {
        attributes: true,
        attributeFilter: [
          "data-mcwalk3d-hooked",
          "data-mcwalk3d-status",
          "data-pathfinder-three-resolver",
          "data-pathfinder-three-error",
          "data-pathfinder-three-details",
          "data-pathfinder-pointer-lock",
          "data-pathfinder-third-person-status",
        ],
      });
    }
    updateBridgeStatus();
    updateThirdPersonStatus();
    updateCameraStatus();
    if (!widget || !hint) setTimeout(boot, UI_TIMING.BOOT_RETRY_MS);
  };
  
  save();
  bindKeys();
  addStyle();
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    boot();
  }
};
