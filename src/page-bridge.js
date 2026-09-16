import { tr } from "./i18n.js";

export const installPageBridge = () => {
  if (window.__mcwalk3dBridgeInstalled) return;
  window.__mcwalk3dBridgeInstalled = true;
  
  // 02a. Shared state and compatibility limits
  const renderers = new Set();
  let streetRenderer = null;
  let streetScene = null;
  let streetCamera = null;
  let light = null;
  let lightScene = null;
  let lightPromise = null;
  let selfUserId = undefined;
  let selfAccount = undefined;
  let thirdPersonCamera = null;
  let thirdPersonErrorLogged = false;
  let thirdPersonCollisionProbe = null;
  let thirdPersonCollisionScene = null;
  let thirdPersonCollisionCandidates = [];
  let thirdPersonCollisionSceneChildCount = -1;
  let thirdPersonCollisionScannedAt = -Infinity;
  let thirdPersonCollisionDistance = null;
  let thirdPersonCollisionView = "off";
  let thirdPersonCollisionUpdatedAt = 0;
  let localAvatar = null;
  let localAvatarPromise = null;
  let localAvatarFailedAt = 0;
  let avatarToolkitPromise = null;
  let lastDarkNightScan = -Infinity;
  let lastOtherLightSync = -Infinity;
  let lastNearbySync = -Infinity;
  let lastPresenceInspectAt = -Infinity;
  let lastPresenceSnapshotKey = "";
  let rearCursorCanvas = null;
  let rearCursorCamera = null;
  let rearCursorX = Number.NaN;
  let rearCursorY = Number.NaN;
  let rearCursorRayPatched = false;
  let rearCursorPickMatrix = null;
  let rearCursorAwaitingRelock = false;
  let rearCursorRenderQueued = false;
  let rearCursorRelockCanvas = null;
  let rearCursorRecoveryCanvas = null;
  let rearCursorRelockPending = false;
  let rearCursorRelockStartedAt = 0;
  let rearCursorRelockGeneration = 0;
  let rearCursorExitProbeGeneration = 0;
  let rearCursorExitObserver = null;
  let pointerLockSpoofInstalled = false;
  let pointerLockSpoofCanvas = null;
  let pointerLockSpoofGetter = null;
  let pointerLockSpoofAvailable = true;
  let cameraRecorder = null;
  let cameraStream = null;
  let cameraChunks = [];
  let cameraRecordingStartedAt = 0;
  let cameraPumpFrame = 0;
  let cameraPumpLast = 0;
  let cameraDownloadOnStop = true;
  let cameraStopResolve = null;
  let cameraFailure = "";
  let cameraStatus = "waiting";
  let cameraOutputCanvas = null;
  let cameraOutputContext = null;
  let cameraRecordingExtension = "webm";
  let cameraRecordingMimeType = "video/webm";
  let basemap = null;
  let basemapFovState = null;
  let basemapCaptureCleanup = null;
  const rearCursorRectPatched = new WeakSet();
  const darkNightMaterials = new WeakSet();
  const darkNightUniforms = new WeakSet();
  const thirdPersonCollisionIntersections = [];
  const otherLights = new Map();
  const threeResolution = new Map();
  const moduleConstructorCache = new WeakMap();
  const firstPersonFovStates = new Map();
  const nearbyPositionPool = [];
  const otherAvatarPositionPool = [];
  const otherLightOriginPool = [];
  const otherLightQuaternionPool = [];
  const otherLightDirectionPool = [];
  // Compatibility-sensitive limits and timeouts. Keep these values named so
  // changes in 3place's loading or pointer-lock behavior are easy to audit.
  const HOOK_LIMITS = Object.freeze({
    MAX_OTHER_PLAYER_LIGHTS: 12,
    MAX_NEARBY_PLAYERS: 16,
    MAX_THREE_PROBE_CANDIDATES: 48,
  });
  const HOOK_TIMING = Object.freeze({
    POINTER_RELOCK_WATCHDOG_MS: 5000,
    MODULE_DISCOVERY_TIMEOUT_MS: 15000,
    MODULE_DISCOVERY_POLL_MS: 100,
    AVATAR_RETRY_COOLDOWN_MS: 5000,
    OTHER_PLAYER_STALE_MS: 10000,
    RENDERER_ATTACH_POLL_MS: 100,
    REAR_CURSOR_SYNC_POLL_MS: 100,
    DOWNLOAD_URL_REVOKE_MS: 30000,
    BASEMAP_CAPTURE_TIMEOUT_MS: 30000,
    BASEMAP_FOV_VERIFY_INTERVAL_MS: 1000,
    CAMERA_BASEMAP_RENDER_TIMEOUT_MS: 250,
    THIRD_PERSON_COLLISION_SCAN_INTERVAL_MS: 1000,
    NEARBY_SYNC_INTERVAL_MS: 400,
    PRESENCE_SNAPSHOT_INSPECT_INTERVAL_MS: 1000,
  });
  const THIRD_PERSON_COLLISION = Object.freeze({
    MIN_DISTANCE: 0.08,
    MIN_GROUND_DISTANCE: 0.8,
    RAY_START_OFFSET: 0.02,
    SURFACE_CLEARANCE: 0.12,
    RETURN_SPEED_BLOCKS_PER_SECOND: 10,
    CAMERA_NEAR_PLANE: 0.02,
  });

  // Observe the official presence snapshots without changing messages or the
  // socket lifecycle. The official Nearby panel only renders a short prefix;
  // the snapshot lets the userscript extend that same list with real names.
  const publishPresenceSnapshot = (message) => {
    if (
      (message?.t ?? message?.type) !== "players" ||
      !Array.isArray(message.players)
    ) {
      return;
    }
    const players = message.players.flatMap((player) => {
      const id = Number(player?.id);
      if (!Number.isSafeInteger(id)) return [];
      const handle =
        typeof player.handle === "string" && player.handle.trim()
          ? player.handle.trim().slice(0, 80)
          : null;
      return [{
        id,
        handle,
        signedOut: player.signedOut === true,
        staff: player.staff === true,
      }];
    });
    const snapshotKey = JSON.stringify(players);
    if (snapshotKey === lastPresenceSnapshotKey) return;
    lastPresenceSnapshotKey = snapshotKey;
    dispatchEvent(
      new CustomEvent("pathfinder-presence-snapshot", {
        detail: { players },
      }),
    );
  };
  const inspectPresenceMessage = (data) => {
    try {
      if (typeof data !== "string") return;
      if (
        !data.includes('"t":"players"') &&
        !data.includes('"type":"players"')
      ) {
        return;
      }
      const inspectNow = performance.now();
      if (
        inspectNow - lastPresenceInspectAt <
        HOOK_TIMING.PRESENCE_SNAPSHOT_INSPECT_INTERVAL_MS
      ) {
        return;
      }
      lastPresenceInspectAt = inspectNow;
      publishPresenceSnapshot(JSON.parse(data));
    } catch {}
  };
  const installPresenceSocketObserver = () => {
    const NativeWebSocket = window.WebSocket;
    if (typeof NativeWebSocket !== "function") return;
    try {
      window.WebSocket = new Proxy(NativeWebSocket, {
        construct(target, args) {
          const socket = Reflect.construct(target, args, target);
          socket.addEventListener("message", (event) => {
            inspectPresenceMessage(event.data);
          });
          return socket;
        },
      });
    } catch {}
  };

  const GRAPHICS_PROFILES = Object.freeze({
    quality: Object.freeze({
      maxOtherPlayerLights: 4,
      otherLightIntervalMs: 50,
      thirdPersonCollision: true,
    }),
    balanced: Object.freeze({
      maxOtherPlayerLights: 2,
      otherLightIntervalMs: 100,
      thirdPersonCollision: true,
    }),
    performance: Object.freeze({
      maxOtherPlayerLights: 0,
      otherLightIntervalMs: Number.POSITIVE_INFINITY,
      thirdPersonCollision: false,
    }),
  });
  
  // 02b. Pointer-lock and first-person FOV adapters
  const devtools =
    window.__THREE_DEVTOOLS__ instanceof EventTarget
      ? window.__THREE_DEVTOOLS__
      : new EventTarget();
  window.__THREE_DEVTOOLS__ = devtools;
  
  let pointerLockOwner = document;
  let pointerLockDescriptor = null;
  while (pointerLockOwner && !pointerLockDescriptor) {
    pointerLockDescriptor = Object.getOwnPropertyDescriptor(
      pointerLockOwner,
      "pointerLockElement",
    );
    pointerLockOwner = Object.getPrototypeOf(pointerLockOwner);
  }
  const nativePointerLockElement = () => {
    try {
      return pointerLockDescriptor?.get?.call(document) ?? null;
    } catch {
      return null;
    }
  };
  pointerLockSpoofAvailable =
    typeof pointerLockDescriptor?.get === "function" &&
    Object.isExtensible(document);
  const publishPointerLockStatus = (status) => {
    if (document.documentElement) {
      document.documentElement.dataset.pathfinderPointerLock = status;
    }
  };
  const uninstallPointerLockSpoof = () => {
    pointerLockSpoofCanvas = null;
    if (!pointerLockSpoofInstalled) return;
    const own = Object.getOwnPropertyDescriptor(
      document,
      "pointerLockElement",
    );
    if (own?.get === pointerLockSpoofGetter) {
      try {
        if (!delete document.pointerLockElement) return;
      } catch {
        return;
      }
    }
    pointerLockSpoofInstalled = false;
    pointerLockSpoofGetter = null;
  };
  const installPointerLockSpoof = (canvas) => {
    if (!pointerLockSpoofAvailable || !canvas?.isConnected) return false;
    pointerLockSpoofCanvas = canvas;
    if (pointerLockSpoofInstalled) {
      publishPointerLockStatus("cursor");
      return true;
    }
    const getter = () =>
      pointerLockSpoofCanvas?.isConnected
        ? pointerLockSpoofCanvas
        : nativePointerLockElement();
    try {
      Object.defineProperty(document, "pointerLockElement", {
        configurable: true,
        enumerable: pointerLockDescriptor?.enumerable ?? true,
        get: getter,
      });
      pointerLockSpoofGetter = getter;
      pointerLockSpoofInstalled = true;
      publishPointerLockStatus("cursor");
      return true;
    } catch {
      pointerLockSpoofCanvas = null;
      pointerLockSpoofAvailable = false;
      publishPointerLockStatus("unsupported");
      return false;
    }
  };
  const finishRearCursorRelock = (success) => {
    rearCursorRelockGeneration += 1;
    const canvas = rearCursorRelockCanvas;
    rearCursorRelockCanvas = null;
    rearCursorRelockPending = false;
    rearCursorRelockStartedAt = 0;
    if (success) {
      rearCursorRecoveryCanvas = null;
      rearCursorAwaitingRelock = false;
      publishPointerLockStatus("ready");
    } else {
      rearCursorRecoveryCanvas = canvas?.isConnected ? canvas : null;
      rearCursorAwaitingRelock = Boolean(rearCursorRecoveryCanvas);
      publishPointerLockStatus(
        rearCursorAwaitingRelock ? "relock-error" : "idle",
      );
    }
  };
  document.addEventListener(
    "pointerlockchange",
    () => {
      if (!rearCursorRelockPending || !rearCursorRelockCanvas) return;
      const locked = nativePointerLockElement();
      if (locked === rearCursorRelockCanvas) {
        finishRearCursorRelock(true);
      } else if (locked !== null) {
        finishRearCursorRelock(false);
      }
    },
    true,
  );
  document.addEventListener(
    "pointerlockerror",
    () => {
      if (rearCursorRelockPending) finishRearCursorRelock(false);
    },
    true,
  );
  
  const setStatus = (value) => {
    if (document.documentElement) {
      document.documentElement.dataset.mcwalk3dStatus = value;
    }
  };
  const setThirdPersonStatus = (value) => {
    if (
      document.documentElement &&
      document.documentElement.dataset.pathfinderThirdPersonStatus !== value
    ) {
      document.documentElement.dataset.pathfinderThirdPersonStatus = value;
    }
  };
  const enabled = (key, fallback = false) => {
    const value = document.documentElement?.dataset[key];
    return value === undefined ? fallback : value === "true";
  };
  const graphicsSettings = () => {
    const profile =
      document.documentElement?.dataset.pathfinderGraphicsProfile;
    return GRAPHICS_PROFILES[profile] || GRAPHICS_PROFILES.quality;
  };
  const thirdPersonView = () => {
    const value =
      document.documentElement?.dataset.pathfinderThirdPersonView;
    return value === "rear" || value === "front" ? value : "off";
  };
  const thirdPersonDistance = () => {
    const value = Number(
      document.documentElement?.dataset.pathfinderThirdPersonDistance,
    );
    return Number.isFinite(value)
      ? Math.max(1.6, Math.min(30, value))
      : 4.25;
  };
  const requestedFirstPersonFov = () => {
    const raw = document.documentElement?.dataset.pathfinderFirstPersonFov;
    if (!raw || raw === "native") return null;
    const value = Number(raw);
    return Number.isFinite(value)
      ? Math.max(35, Math.min(110, value))
      : null;
  };
  const publishFovValue = (key, value) => {
    if (!document.documentElement) return;
    const text = String(value);
    if (document.documentElement.dataset[key] !== text) {
      document.documentElement.dataset[key] = text;
    }
  };
  const installBasemapCapture = () => {
    // 3place keeps its MapLibre instance inside the main-module closure. Its
    // one-time ID assignment is intercepted only during startup; the hook
    // removes itself as soon as #mapWrap is identified (or on timeout).
    const owner = Object.prototype;
    const property = "_mapId";
    if (Object.getOwnPropertyDescriptor(owner, property)) {
      publishFovValue("pathfinderBasemapFovStatus", "unavailable");
      return;
    }
    let active = true;
    let timeout = 0;
    let setter = null;
    const cleanup = () => {
      if (!active) return;
      active = false;
      if (timeout) clearTimeout(timeout);
      timeout = 0;
      const descriptor = Object.getOwnPropertyDescriptor(owner, property);
      if (descriptor?.set === setter) delete owner[property];
      if (basemapCaptureCleanup === cleanup) basemapCaptureCleanup = null;
    };
    setter = function (value) {
      // Match normal assignment semantics before inspecting the candidate.
      Object.defineProperty(this, property, {
        value,
        writable: true,
        enumerable: true,
        configurable: true,
      });
      if (
        typeof this?.getContainer !== "function" ||
        typeof this?.getVerticalFieldOfView !== "function" ||
        typeof this?.setVerticalFieldOfView !== "function"
      ) {
        return;
      }
      const candidate = this;
      queueMicrotask(() => {
        if (!active || basemap) return;
        try {
          if (candidate.getContainer()?.id !== "mapWrap") return;
          const native = Number(candidate.getVerticalFieldOfView());
          if (!Number.isFinite(native)) return;
          basemap = candidate;
          basemapFovState = {
            native,
            applied: null,
            desired: null,
            desiredActive: false,
            synced: true,
            lastCheckedAt: 0,
          };
          publishFovValue("pathfinderBasemapNativeFov", native.toFixed(2));
          publishFovValue("pathfinderBasemapFovStatus", "ready");
          cleanup();
        } catch {}
      });
    };
    try {
      Object.defineProperty(owner, property, {
        configurable: true,
        get: () => undefined,
        set: setter,
      });
      basemapCaptureCleanup = cleanup;
      publishFovValue("pathfinderBasemapFovStatus", "waiting");
      timeout = window.setTimeout(() => {
        cleanup();
        if (!basemap) {
          publishFovValue("pathfinderBasemapFovStatus", "unavailable");
        }
      }, HOOK_TIMING.BASEMAP_CAPTURE_TIMEOUT_MS);
    } catch {
      cleanup();
      publishFovValue("pathfinderBasemapFovStatus", "unavailable");
    }
  };
  const restoreBasemapFov = () => {
    if (!basemap || !basemapFovState) return;
    try {
      const current = Number(basemap.getVerticalFieldOfView());
      if (
        basemapFovState.applied !== null &&
        Number.isFinite(basemapFovState.native) &&
        Math.abs(current - basemapFovState.native) > 0.001
      ) {
        basemap.setVerticalFieldOfView(basemapFovState.native);
      }
      basemapFovState.applied = null;
      basemapFovState.desired = null;
      basemapFovState.desiredActive = false;
      basemapFovState.synced = true;
      basemapFovState.lastCheckedAt = performance.now();
      publishFovValue(
        "pathfinderBasemapEffectiveFov",
        Number(basemap.getVerticalFieldOfView()).toFixed(2),
      );
      publishFovValue("pathfinderBasemapFovStatus", "ready");
    } catch {
      publishFovValue("pathfinderBasemapFovStatus", "unavailable");
    }
  };
  const syncBasemapFov = (requested, shouldApply) => {
    if (!basemap || !basemapFovState) return !shouldApply;
    const now = performance.now();
    const desiredChanged =
      basemapFovState.desiredActive !== shouldApply ||
      (shouldApply &&
        (!Number.isFinite(basemapFovState.desired) ||
          Math.abs(basemapFovState.desired - requested) > 0.001));
    if (
      !shouldApply &&
      !desiredChanged &&
      basemapFovState.applied === null
    ) {
      return true;
    }
    if (
      !desiredChanged &&
      now - basemapFovState.lastCheckedAt <
        HOOK_TIMING.BASEMAP_FOV_VERIFY_INTERVAL_MS
    ) {
      return shouldApply ? basemapFovState.synced : true;
    }
    basemapFovState.desired = shouldApply ? requested : null;
    basemapFovState.desiredActive = shouldApply;
    basemapFovState.lastCheckedAt = now;
    try {
      let current = Number(basemap.getVerticalFieldOfView());
      if (!Number.isFinite(current)) throw new Error("Invalid basemap FOV");
      if (basemapFovState.applied === null) {
        basemapFovState.native = current;
      } else if (Math.abs(current - basemapFovState.applied) > 0.001) {
        // Keep a newer official value as the restoration target.
        basemapFovState.native = current;
        basemapFovState.applied = null;
      }
      if (!shouldApply) {
        restoreBasemapFov();
        return true;
      }
      if (!Number.isFinite(requested)) return false;
      if (Math.abs(current - requested) > 0.001) {
        basemap.setVerticalFieldOfView(requested);
        current = Number(basemap.getVerticalFieldOfView());
      }
      if (!Number.isFinite(current) || Math.abs(current - requested) > 0.01) {
        throw new Error("Basemap FOV did not update");
      }
      basemapFovState.applied = requested;
      basemapFovState.synced = true;
      publishFovValue(
        "pathfinderBasemapNativeFov",
        basemapFovState.native.toFixed(2),
      );
      publishFovValue(
        "pathfinderBasemapEffectiveFov",
        current.toFixed(2),
      );
      publishFovValue("pathfinderBasemapFovStatus", "custom");
      return true;
    } catch {
      restoreBasemapFov();
      basemapFovState.desired = shouldApply ? requested : null;
      basemapFovState.desiredActive = shouldApply;
      basemapFovState.synced = false;
      basemapFovState.lastCheckedAt = now;
      publishFovValue("pathfinderBasemapFovStatus", "unavailable");
      return false;
    }
  };
  const restoreFirstPersonFov = (camera) => {
    const state = firstPersonFovStates.get(camera);
    if (!state || state.applied === null) return;
    if (Number.isFinite(state.native) && camera.fov !== state.native) {
      camera.fov = state.native;
      camera.updateProjectionMatrix?.();
    }
    state.applied = null;
  };
  const syncFirstPersonFov = (camera) => {
    if (!camera?.isPerspectiveCamera || !Number.isFinite(camera.fov)) {
      publishFovValue("pathfinderFovStatus", "unavailable");
      return;
    }
    let state = firstPersonFovStates.get(camera);
    if (!state) {
      state = { native: camera.fov, applied: null };
      firstPersonFovStates.set(camera, state);
    } else if (state.applied === null) {
      state.native = camera.fov;
    } else if (Math.abs(camera.fov - state.applied) > 0.001) {
      // Preserve a newer value if 3place changed its own FOV while active.
      state.native = camera.fov;
      state.applied = null;
    }
    const requested = requestedFirstPersonFov();
    const shouldApply =
      requested !== null &&
      enabled("mcwalkEnabled", enabled("mcwalkActive")) &&
      firstPersonIsActuallyActive() &&
      thirdPersonView() === "off";
    const basemapSynced = syncBasemapFov(requested, shouldApply);
    const applyCustom = shouldApply && basemapSynced;
    if (applyCustom) {
      if (Math.abs(camera.fov - requested) > 0.001) {
        camera.fov = requested;
        camera.updateProjectionMatrix?.();
      }
      state.applied = requested;
    } else {
      restoreFirstPersonFov(camera);
    }
    publishFovValue("pathfinderNativeFov", state.native.toFixed(2));
    publishFovValue("pathfinderEffectiveFov", camera.fov.toFixed(2));
    publishFovValue(
      "pathfinderFovStatus",
      applyCustom
        ? "custom"
        : shouldApply &&
            document.documentElement?.dataset.pathfinderBasemapFovStatus ===
              "unavailable"
          ? "unavailable"
          : shouldApply
            ? "waiting"
            : "native",
    );
  };
  const firstPersonIsActuallyActive = () => {
    const declared =
      document.documentElement?.dataset.pathfinderFirstPersonActive;
    if (declared !== undefined) return declared === "true";
    // Bootstrap fallback until the outer UI adapter publishes its state.
    const hint = document.getElementById("firstPersonHint");
    return Boolean(hint && !hint.hidden && hint.dataset.locked === "true");
  };
  // The current official paint engine owns its pointer ray. Do not spoof it:
  // third-person rendering pauses while Paint is active instead.
  const rearCursorWanted = () => false;
  const rearCursorActive = () =>
    rearCursorCanvas !== null && rearCursorWanted();
  const rearCursorWorldTarget = (event, canvas) => {
    if (!canvas) return false;
    const target = event.target;
    if (target === canvas) return true;
    const streetWrap = canvas.closest?.("#streetWrap");
    return target instanceof Node && Boolean(streetWrap?.contains(target));
  };
  const requestRearCursorRelock = (canvas) => {
    if (!canvas?.isConnected || rearCursorRelockPending) {
      return;
    }
    if (nativePointerLockElement() === canvas) {
      rearCursorRecoveryCanvas = null;
      rearCursorAwaitingRelock = false;
      publishPointerLockStatus("ready");
      return;
    }
    uninstallPointerLockSpoof();
    rearCursorRelockCanvas = canvas;
    rearCursorRecoveryCanvas = canvas;
    rearCursorRelockPending = true;
    rearCursorRelockStartedAt = performance.now();
    const generation = ++rearCursorRelockGeneration;
    rearCursorCanvas = null;
    rearCursorCamera = null;
    rearCursorPickMatrix = null;
    rearCursorAwaitingRelock = true;
    document.documentElement.dataset.pathfinderRearCursor = "false";
    publishPointerLockStatus("relocking");
    try {
      canvas.focus({ preventScroll: true });
    } catch {
      canvas.focus?.();
    }
    const failed = () => {
      if (
        generation === rearCursorRelockGeneration &&
        rearCursorRelockPending &&
        rearCursorRelockCanvas === canvas
      ) {
        finishRearCursorRelock(nativePointerLockElement() === canvas);
      }
    };
    try {
      const pending = canvas.requestPointerLock();
      pending?.then?.(
        () => queueMicrotask(failed),
        failed,
      );
    } catch {
      finishRearCursorRelock(false);
    }
  };
  const cancelRearCursorExitObserver = () => {
    rearCursorExitProbeGeneration += 1;
    rearCursorExitObserver?.disconnect();
    rearCursorExitObserver = null;
  };
  const scheduleRearCursorRelock = () => {
    const canvas = rearCursorCanvas;
    if (!canvas || rearCursorRelockPending) return;
    cancelRearCursorExitObserver();
    const generation = rearCursorExitProbeGeneration;
    const dock = document.getElementById("dock");
    const probe = () => {
      if (
        generation !== rearCursorExitProbeGeneration ||
        rearCursorRelockPending ||
        !canvas.isConnected
      ) {
        cancelRearCursorExitObserver();
        return;
      }
      if (dock?.dataset.state !== "paint") {
        cancelRearCursorExitObserver();
        requestRearCursorRelock(canvas);
      }
    };
    if (dock) {
      rearCursorExitObserver = new MutationObserver(probe);
      rearCursorExitObserver.observe(dock, {
        attributes: true,
        attributeFilter: ["data-state"],
      });
    }
    queueMicrotask(probe);
  };
  addEventListener(
    "keydown",
    (event) => {
      if (
        event.code !== "Escape" ||
        event.repeat ||
        !rearCursorActive()
      ) {
        return;
      }
      const target =
        event.target instanceof Element ? event.target : null;
      if (
        target?.closest(
          '.modal,input,textarea,select,[contenteditable="true"]',
        )
      ) {
        return;
      }
      scheduleRearCursorRelock();
    },
    true,
  );
  addEventListener(
    "pointerdown",
    (event) => {
      const target =
        event.target instanceof Element ? event.target : null;
      if (rearCursorActive() && target?.closest("#exitPaintBtn")) {
        scheduleRearCursorRelock();
        return;
      }
      if (
        rearCursorAwaitingRelock &&
        !rearCursorRelockPending &&
        rearCursorRecoveryCanvas &&
        rearCursorWorldTarget(event, rearCursorRecoveryCanvas)
      ) {
        requestRearCursorRelock(rearCursorRecoveryCanvas);
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    },
    true,
  );
  addEventListener(
    "click",
    (event) => {
      const target =
        event.target instanceof Element ? event.target : null;
      if (rearCursorActive() && target?.closest(".modal button")) {
        scheduleRearCursorRelock();
      }
    },
    true,
  );
  const requestRearCursorRender = () => {
    if (rearCursorRenderQueued) return;
    rearCursorRenderQueued = true;
    requestAnimationFrame(() => {
      rearCursorRenderQueued = false;
      if (
        rearCursorActive() &&
        streetRenderer &&
        streetScene &&
        streetCamera
      ) {
        streetRenderer.render(streetScene, streetCamera);
      }
    });
  };
  const turnRearCursorCamera = (movementX, movementY) => {
    if (!rearCursorCamera || !rearCursorCanvas) return;
    const rect = rearCursorCanvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const rotation = rearCursorCamera.rotation;
    if (rotation.order !== "YXZ") rotation.reorder("YXZ");
    const horizontal = Math.max(-80, Math.min(80, movementX));
    const vertical = Math.max(-80, Math.min(80, movementY));
    rotation.y -= horizontal * ((Math.PI * 2) / rect.width);
    rotation.x = Math.max(
      -Math.PI / 2 + 0.02,
      Math.min(
        Math.PI / 2 - 0.02,
        rotation.x - vertical * (Math.PI / rect.height),
      ),
    );
    rotation.z = 0;
    rearCursorCamera.updateMatrixWorld(true);
    requestRearCursorRender();
  };
  addEventListener(
    "mousemove",
    (event) => {
      if (rearCursorActive()) {
        if (!rearCursorWorldTarget(event, rearCursorCanvas)) return;
        const previousX = rearCursorX;
        const previousY = rearCursorY;
        if (Number.isFinite(event.clientX)) rearCursorX = event.clientX;
        if (Number.isFinite(event.clientY)) rearCursorY = event.clientY;
        const coordinateX = Number.isFinite(previousX)
          ? rearCursorX - previousX
          : 0;
        const coordinateY = Number.isFinite(previousY)
          ? rearCursorY - previousY
          : 0;
        const movementX =
          Number.isFinite(event.movementX) && event.movementX !== 0
            ? event.movementX
            : coordinateX;
        const movementY =
          Number.isFinite(event.movementY) && event.movementY !== 0
            ? event.movementY
            : coordinateY;
        if (movementX !== 0 || movementY !== 0) {
          turnRearCursorCamera(movementX, movementY);
        }
        event.stopImmediatePropagation();
        return;
      }
      if (!rearCursorAwaitingRelock) return;
      const locked = nativePointerLockElement();
      if (locked === rearCursorRecoveryCanvas) {
        rearCursorRecoveryCanvas = null;
        rearCursorAwaitingRelock = false;
        publishPointerLockStatus("ready");
      } else if (
        locked === null &&
        rearCursorWorldTarget(
          event,
          rearCursorRelockCanvas || rearCursorRecoveryCanvas,
        )
      ) {
        event.stopImmediatePropagation();
      }
    },
    true,
  );
  const intensity = () => {
    const value = Number(
      document.documentElement?.dataset.mcwalkLightIntensity,
    );
    return Number.isFinite(value)
      ? Math.max(20, Math.min(160, value))
      : 90;
  };
  // 02c. Three.js constructor resolution
  const publishThreeResolution = () => {
    if (!document.documentElement) return;
    const entries = [...threeResolution.entries()];
    const failures = entries.filter(([, result]) => result.strategy === "error");
    const successes = entries.filter(([, result]) => result.strategy !== "error");
    let status = "pending";
    if (failures.length) {
      status = "error";
    } else if (successes.some(([, result]) => result.strategy === "source-fallback")) {
      status = "source-fallback";
    } else {
      const strategies = new Set(successes.map(([, result]) => result.strategy));
      status = strategies.size > 1 ? "mixed" : strategies.values().next().value || "pending";
    }
    document.documentElement.dataset.pathfinderThreeResolver = status;
    document.documentElement.dataset.pathfinderThreeDetails = entries
      .map(([name, result]) => `${name}:${result.strategy}`)
      .join(",");
    const errorCodes = failures
      .map(([name, result]) => `${name}:${result.errorCode || "unknown"}`)
      .join(",");
    if (errorCodes) {
      document.documentElement.dataset.pathfinderThreeError = errorCodes;
    } else {
      delete document.documentElement.dataset.pathfinderThreeError;
    }
  };
  const recordThreeResolution = (name, strategy, errorCode = "") => {
    threeResolution.set(name, { strategy, errorCode });
    publishThreeResolution();
  };
  const clearThreeResolution = (name) => {
    if (threeResolution.delete(name)) publishThreeResolution();
  };
  const resolutionError = (code, message, cause = null) => {
    const error = new Error(message);
    error.code = code;
    if (cause) error.cause = cause;
    return error;
  };
  const addThreeModuleUrl = (urls, value) => {
    if (!value) return;
    try {
      const url = new URL(value, location.href);
      if (
        url.origin === location.origin &&
        /^\/assets\/[^/]+\.js$/.test(url.pathname)
      ) {
        urls.add(url.href);
      }
    } catch {}
  };
  const discoverThreeModuleUrls = () => {
    const urls = new Set();
    document
      .querySelectorAll(
        'link[rel="modulepreload"][href], script[type="module"][src]',
      )
      .forEach((element) =>
        addThreeModuleUrl(urls, element.href || element.src),
      );
    performance
      .getEntriesByType("resource")
      .forEach((item) => addThreeModuleUrl(urls, item.name));
    return [...urls];
  };
  const waitForThreeModuleUrls = async () => {
    const started = performance.now();
    let urls = discoverThreeModuleUrls();
    while (
      urls.length === 0 &&
      performance.now() - started < HOOK_TIMING.MODULE_DISCOVERY_TIMEOUT_MS
    ) {
      await new Promise((resolve) =>
        setTimeout(resolve, HOOK_TIMING.MODULE_DISCOVERY_POLL_MS),
      );
      urls = discoverThreeModuleUrls();
    }
    if (urls.length === 0) {
      throw resolutionError(
        "module-url-timeout",
        "3place module assets were not found",
      );
    }
    return urls;
  };
  const loadThreeModules = async () => {
    const urls = await waitForThreeModuleUrls();
    const results = await Promise.allSettled(
      urls.map((url) => import(url)),
    );
    const modules = results.flatMap((result) =>
      result.status === "fulfilled" ? [result.value] : [],
    );
    if (modules.length === 0) {
      throw resolutionError(
        "module-import-failed",
        "3place modules could not be imported",
        results.find((result) => result.status === "rejected")?.reason,
      );
    }
    return modules;
  };
  // Function source inspection is retained only as the last compatibility
  // fallback. Runtime constructors and behavioral probes are preferred.
  const functionSource = (value) => {
    if (typeof value !== "function") return "";
    try {
      return Function.prototype.toString.call(value);
    } catch {
      return "";
    }
  };
  const isConstructable = (value) => {
    if (typeof value !== "function" || !value.prototype) return false;
    try {
      Reflect.construct(Object, [], value);
      return true;
    } catch {
      return false;
    }
  };
  const prototypeHasMethods = (constructor, methods) =>
    methods.every((method) => {
      try {
        return typeof constructor.prototype?.[method] === "function";
      } catch {
        return false;
      }
    });
  const validateConstructor = (constructor, spec) => {
    if (!isConstructable(constructor)) return false;
    let probe = null;
    let args = [];
    try {
      args = spec.args();
      probe = Reflect.construct(constructor, args);
      return Boolean(spec.validate(probe));
    } catch {
      return false;
    } finally {
      try {
        probe?.dispose?.();
      } catch {}
      try {
        spec.disposeArgs?.(args);
      } catch {}
    }
  };
  const moduleConstructors = (module) => {
    const cached = moduleConstructorCache.get(module);
    if (cached) return cached;
    const constructors = [
      ...new Set(Object.values(module).filter(isConstructable)),
    ];
    moduleConstructorCache.set(module, constructors);
    return constructors;
  };
  const findSingleModuleThreeConstructor = (module, spec) => {
    const candidates = moduleConstructors(module);
    const expectedNames = new Set(spec.names.map((name) => name.toLowerCase()));
    const named = [
      ...new Set(
        Object.entries(module)
          .filter(
            ([exportName, constructor]) =>
              isConstructable(constructor) &&
              (expectedNames.has(exportName.toLowerCase()) ||
                expectedNames.has(
                  String(constructor.name || "").toLowerCase(),
                )),
          )
          .map(([, constructor]) => constructor),
      ),
    ];
    for (const constructor of named) {
      if (validateConstructor(constructor, spec)) {
        return { constructor, strategy: "module-name" };
      }
    }
    let probedCandidates = 0;
    for (const constructor of candidates) {
      if (
        spec.allowModuleProbe !== false &&
        prototypeHasMethods(constructor, spec.prototypeMethods)
      ) {
        probedCandidates += 1;
        if (
          probedCandidates <= HOOK_LIMITS.MAX_THREE_PROBE_CANDIDATES &&
          validateConstructor(constructor, spec)
        ) {
          return { constructor, strategy: "module-probe" };
        }
      }
    }
    if (spec.sourceFallback) {
      for (const constructor of candidates) {
        if (
          spec.sourceFallback(functionSource(constructor)) &&
          validateConstructor(constructor, spec)
        ) {
          return { constructor, strategy: "source-fallback" };
        }
      }
    }
    return null;
  };
  const findModuleThreeConstructor = (modules, spec) => {
    for (const module of modules || []) {
      const resolved = findSingleModuleThreeConstructor(module, spec);
      if (resolved) return resolved;
    }
    return null;
  };
  const findRuntimeThreeConstructor = (constructors, spec) => {
    for (const constructor of constructors || []) {
      if (validateConstructor(constructor, spec)) return constructor;
    }
    return null;
  };
  const resolveThreeConstructor = (
    name,
    runtimeConstructors,
    modules,
    spec,
  ) => {
    const runtimeConstructor = findRuntimeThreeConstructor(
      runtimeConstructors,
      spec,
    );
    if (runtimeConstructor) {
      recordThreeResolution(name, "runtime");
      return runtimeConstructor;
    }
    if (!modules) return null;
    const resolved = findModuleThreeConstructor(modules, spec);
    if (!resolved) return null;
    recordThreeResolution(name, resolved.strategy);
    return resolved.constructor;
  };
  const addConstructorChain = (target, value) => {
    let prototype = value ? Object.getPrototypeOf(value) : null;
    while (prototype && prototype !== Object.prototype) {
      if (isConstructable(prototype.constructor)) {
        target.add(prototype.constructor);
      }
      prototype = Object.getPrototypeOf(prototype);
    }
  };
  const collectRuntimeThreeConstructors = (scene) => {
    const result = {
      SpotLight: new Set(),
      Group: new Set(),
      Mesh: new Set(),
      BufferGeometry: new Set(),
      Float32BufferAttribute: new Set(),
      MeshStandardMaterial: new Set(),
      MeshBasicMaterial: new Set(),
    };
    if (!scene?.traverse) return result;
    scene.traverse((object) => {
      if (object?.isSpotLight) addConstructorChain(result.SpotLight, object);
      if (object?.isGroup) addConstructorChain(result.Group, object);
      if (object?.isMesh) addConstructorChain(result.Mesh, object);
      if (object?.geometry?.isBufferGeometry) {
        addConstructorChain(result.BufferGeometry, object.geometry);
        const position = object.geometry.getAttribute?.("position");
        if (position?.array instanceof Float32Array) {
          addConstructorChain(result.Float32BufferAttribute, position);
        }
      }
      const materials = Array.isArray(object?.material)
        ? object.material
        : object?.material
          ? [object.material]
          : [];
      for (const material of materials) {
        if (material?.isMeshStandardMaterial) {
          addConstructorChain(result.MeshStandardMaterial, material);
        }
        if (material?.isMeshBasicMaterial) {
          addConstructorChain(result.MeshBasicMaterial, material);
        }
      }
    });
    return result;
  };
  // 02d. Helmet lights and avatar reconstruction
  const SPOT_LIGHT_SPEC = Object.freeze({
    names: ["SpotLight"],
    prototypeMethods: ["copy", "updateMatrixWorld"],
    args: () => [0xffffff, 1, 1, Math.PI / 4, 0.5, 1],
    validate: (value) =>
      value?.isSpotLight &&
      value?.type === "SpotLight" &&
      value?.target?.isObject3D,
    sourceFallback: (source) => /this\.isSpotLight\s*=/.test(source),
  });
  const loadSpotLight = async () => {
    try {
      const runtime = collectRuntimeThreeConstructors(streetScene);
      let SpotLight = resolveThreeConstructor(
        "SpotLight",
        runtime.SpotLight,
        null,
        SPOT_LIGHT_SPEC,
      );
      if (!SpotLight) {
        const modules = await loadThreeModules();
        SpotLight = resolveThreeConstructor(
          "SpotLight",
          runtime.SpotLight,
          modules,
          SPOT_LIGHT_SPEC,
        );
      }
      if (!SpotLight) {
        throw resolutionError(
          "spotlight-unresolved",
          "3place SpotLight class was not found",
        );
      }
      return SpotLight;
    } catch (error) {
      recordThreeResolution(
        "SpotLight",
        "error",
        error?.code || "spotlight-unresolved",
      );
      throw error;
    }
  };
  const ensureLight = (scene) => {
    if (light && lightScene === scene) return Promise.resolve(light);
    if (lightPromise) return lightPromise;
    lightPromise = loadSpotLight()
      .then((SpotLight) => {
        if (light && lightScene) {
          lightScene.remove(light, light.target);
          light.dispose?.();
        }
        light = new SpotLight(
          0xfff3d2,
          intensity(),
          32,
          Math.PI / 5,
          0.58,
          1.25,
        );
        light.name = "mcwalk-helmet-light";
        light.castShadow = false;
        light.visible = false;
        light.target.name = "mcwalk-helmet-light-target";
        scene.add(light, light.target);
        lightScene = scene;
        setStatus("ready");
        return light;
      })
      .catch((error) => {
        console.warn("3place Pathfinder headlight unavailable", error);
        setStatus("light-unavailable");
        return null;
      })
      .finally(() => {
        lightPromise = null;
      });
    return lightPromise;
  };
  const syncLight = (scene, camera) => {
    const on =
      enabled("mcwalkEnabled", enabled("mcwalkActive")) &&
      firstPersonIsActuallyActive() &&
      enabled("mcwalkHeadlight", true);
    if (!on) {
      if (light) light.visible = false;
      return;
    }
    if (!light || lightScene !== scene) {
      void ensureLight(scene);
      return;
    }
    const forward = camera.getWorldDirection(camera.position.clone());
    light.visible = true;
    light.intensity = intensity();
    light.position.copy(camera.position).addScaledVector(forward, 0.12);
    light.target.position
      .copy(camera.position)
      .addScaledVector(forward, 14);
    light.target.updateMatrixWorld(true);
    light.updateMatrixWorld(true);
  };
  const loadSelfUserId = () => {
    if (selfUserId !== undefined) return;
    selfUserId = null;
    selfAccount = null;
    fetch("/api/me", {
      headers: { accept: "application/json" },
      credentials: "same-origin",
    })
      .then((response) => (response.ok ? response.json() : null))
      .then((account) => {
        selfAccount = account;
        selfUserId = Number.isSafeInteger(account?.userId)
          ? account.userId
          : null;
      })
      .catch(() => {
        selfAccount = null;
        selfUserId = null;
      });
  };
  const PRESENCE_COLORS = Object.freeze([
    "#e0565f",
    "#4f8fe0",
    "#4fc98d",
    "#d9a441",
    "#9a6fe0",
    "#e07bb1",
    "#54c2cf",
    "#8b95a7",
  ]);
  const publishNearbyPlayers = (players, status = "ready") => {
    dispatchEvent(
      new CustomEvent("pathfinder-nearby-state", {
        detail: { players, status },
      }),
    );
  };
  const syncNearbyPlayers = (scene, camera) => {
    const syncNow = performance.now();
    if (syncNow - lastNearbySync < HOOK_TIMING.NEARBY_SYNC_INTERVAL_MS) {
      return;
    }
    lastNearbySync = syncNow;
    if (
      !enabled("mcwalkEnabled", enabled("mcwalkActive")) ||
      !document.getElementById("nearbyPlayers")
    ) {
      return;
    }
    loadSelfUserId();
    const root = scene.getObjectByName("presence-avatars");
    if (!root) {
      publishNearbyPlayers([], "waiting");
      return;
    }
    const cameraPosition = camera.getWorldPosition(camera.position.clone());
    const cameraForward = camera
      .getWorldDirection(camera.position.clone())
      .setY(0);
    if (
      cameraForward.lengthSq() <= Number.EPSILON ||
      ![cameraForward.x, cameraForward.z, cameraPosition.x, cameraPosition.z].every(
        Number.isFinite,
      )
    ) {
      publishNearbyPlayers([], "unavailable");
      return;
    }
    cameraForward.normalize();
    const exactSelfName = Number.isSafeInteger(selfUserId)
      ? `presence-avatar-${selfUserId}`
      : null;
    let fallbackSelf = null;
    let fallbackScore = 1.6;
    const candidates = [];
    let nearbyPositionIndex = 0;
    for (const avatar of root.children) {
      if (!avatar.visible || !avatar.name?.startsWith("presence-avatar-")) {
        continue;
      }
      const position = avatar.getWorldPosition(
        (nearbyPositionPool[nearbyPositionIndex] ||= camera.position.clone()),
      );
      nearbyPositionIndex += 1;
      const dx = position.x - cameraPosition.x;
      const dz = position.z - cameraPosition.z;
      const eyeDelta = position.y + 1.62 - cameraPosition.y;
      const selfScore = dx * dx + dz * dz + eyeDelta * eyeDelta * 0.35;
      if (!exactSelfName && selfScore < fallbackScore) {
        fallbackScore = selfScore;
        fallbackSelf = avatar;
      }
      candidates.push({
        avatar,
        distanceSq: dx * dx + eyeDelta * eyeDelta + dz * dz,
        horizontalDistanceSq: dx * dx + dz * dz,
        dx,
        dy: eyeDelta,
        dz,
      });
    }
    const players = [];
    for (const {
      avatar,
      distanceSq,
      horizontalDistanceSq,
      dx,
      dy,
      dz,
    } of candidates) {
      const userIdText = avatar.name.slice("presence-avatar-".length);
      const parsedUserId = /^\d+$/.test(userIdText) ? Number(userIdText) : null;
      const userId = Number.isSafeInteger(parsedUserId) ? parsedUserId : null;
      if (
        players.length >= HOOK_LIMITS.MAX_NEARBY_PLAYERS ||
        avatar.name === exactSelfName ||
        avatar === fallbackSelf ||
        !Number.isSafeInteger(userId) ||
        userId <= 0 ||
        distanceSq <= Number.EPSILON
      ) {
        continue;
      }
      const distance = Math.sqrt(distanceSq);
      const horizontalDistance = Math.sqrt(horizontalDistanceSq);
      if (horizontalDistance <= Number.EPSILON) continue;
      const targetX = dx / horizontalDistance;
      const targetZ = dz / horizontalDistance;
      const dot = cameraForward.x * targetX + cameraForward.z * targetZ;
      const cross = cameraForward.x * targetZ - cameraForward.z * targetX;
      const bearing = (Math.atan2(cross, dot) * 180) / Math.PI;
      const elevation = (Math.atan2(dy, horizontalDistance) * 180) / Math.PI;
      players.push({
        key: avatar.name,
        userId,
        color: PRESENCE_COLORS[
          ((userId % PRESENCE_COLORS.length) + PRESENCE_COLORS.length) %
            PRESENCE_COLORS.length
        ],
        distance,
        bearing,
        elevation,
      });
    }
    publishNearbyPlayers(players);
  };
  const hideOtherLights = () => {
    for (const record of otherLights.values()) record.light.visible = false;
  };
  const removeOtherLight = (key, record) => {
    record.scene.remove(record.light, record.light.target);
    record.light.dispose?.();
    otherLights.delete(key);
  };
  const removeOtherLights = () => {
    for (const [key, record] of [...otherLights]) {
      removeOtherLight(key, record);
    }
  };
  const ensureOtherLight = (scene, key) => {
    const current = otherLights.get(key);
    if (current?.scene === scene) return current;
    if (current) removeOtherLight(key, current);
    if (!light?.isSpotLight) return null;
    const playerLight = new light.constructor(
      0xfff3d2,
      Math.max(15, intensity() * 0.65),
      26,
      Math.PI / 6,
      0.65,
      1.3,
    );
    playerLight.name = `mcwalk-player-light-${key}`;
    playerLight.target.name = `mcwalk-player-light-target-${key}`;
    playerLight.castShadow = false;
    playerLight.visible = false;
    scene.add(playerLight, playerLight.target);
    const record = {
      light: playerLight,
      scene,
      lastSeen: performance.now(),
    };
    otherLights.set(key, record);
    return record;
  };
  const syncOtherLights = (scene, camera) => {
    const syncNow = performance.now();
    const graphics = graphicsSettings();
    if (
      syncNow - lastOtherLightSync <
      Math.max(50, graphics.otherLightIntervalMs)
    ) {
      return;
    }
    lastOtherLightSync = syncNow;
    if (graphics.maxOtherPlayerLights <= 0) {
      removeOtherLights();
      return;
    }
    const on =
      enabled("mcwalkEnabled", enabled("mcwalkActive")) &&
      enabled("mcwalkHeadlight", true);
    if (!on) {
      hideOtherLights();
      return;
    }
    if (!light || lightScene !== scene) {
      hideOtherLights();
      void ensureLight(scene);
      return;
    }
    loadSelfUserId();
    const root = scene.getObjectByName("presence-avatars");
    if (!root) {
      hideOtherLights();
      return;
    }
    const cameraPosition = camera.getWorldPosition(camera.position.clone());
    const exactSelfName = Number.isSafeInteger(selfUserId)
      ? `presence-avatar-${selfUserId}`
      : null;
    let fallbackSelf = null;
    let fallbackScore = 1.6;
    const candidates = [];
    let otherAvatarPositionIndex = 0;
    for (const avatar of root.children) {
      if (!avatar.visible || !avatar.name?.startsWith("presence-avatar-")) {
        continue;
      }
      const position = avatar.getWorldPosition(
        (otherAvatarPositionPool[otherAvatarPositionIndex] ||=
          camera.position.clone()),
      );
      otherAvatarPositionIndex += 1;
      const dx = position.x - cameraPosition.x;
      const dz = position.z - cameraPosition.z;
      const eyeDelta = position.y + 1.62 - cameraPosition.y;
      const selfScore = dx * dx + dz * dz + eyeDelta * eyeDelta * 0.35;
      if (!exactSelfName && selfScore < fallbackScore) {
        fallbackScore = selfScore;
        fallbackSelf = avatar;
      }
      candidates.push({ avatar, distanceSq: dx * dx + dz * dz });
    }
    candidates.sort((a, b) => a.distanceSq - b.distanceSq);
    const activeKeys = new Set();
    let activeCount = 0;
    for (const { avatar } of candidates) {
      if (
        activeCount >=
          Math.min(
            HOOK_LIMITS.MAX_OTHER_PLAYER_LIGHTS,
            graphics.maxOtherPlayerLights,
          ) ||
        avatar.name === exactSelfName ||
        avatar === fallbackSelf
      ) {
        continue;
      }
      const gaze = avatar.getObjectByName("presence-gaze");
      if (!gaze) continue;
      const origin = gaze.getWorldPosition(
        (otherLightOriginPool[activeCount] ||= camera.position.clone()),
      );
      const worldQuaternion = gaze.getWorldQuaternion(
        (otherLightQuaternionPool[activeCount] ||= camera.quaternion.clone()),
      );
      const direction = (
        otherLightDirectionPool[activeCount] ||= camera.position.clone()
      )
        .set(0, 0, 1)
        .applyQuaternion(worldQuaternion)
        .normalize();
      if (
        ![
          origin.x,
          origin.y,
          origin.z,
          direction.x,
          direction.y,
          direction.z,
        ].every(Number.isFinite)
      ) {
        continue;
      }
      const record = ensureOtherLight(scene, avatar.name);
      if (!record) continue;
      record.lastSeen = syncNow;
      record.light.visible = true;
      record.light.intensity = Math.max(15, intensity() * 0.65);
      record.light.position.copy(origin).addScaledVector(direction, 0.18);
      record.light.target.position.copy(origin).addScaledVector(direction, 12);
      record.light.target.updateMatrixWorld(true);
      record.light.updateMatrixWorld(true);
      activeKeys.add(avatar.name);
      activeCount += 1;
    }
    const now = performance.now();
    for (const [key, record] of otherLights) {
      if (activeKeys.has(key)) continue;
      record.light.visible = false;
      if (now - record.lastSeen > HOOK_TIMING.OTHER_PLAYER_STALE_MS) {
        removeOtherLight(key, record);
      }
    }
  };
  const AVATAR_THREE_SPECS = Object.freeze({
    Group: Object.freeze({
      names: ["Group"],
      prototypeMethods: ["add", "traverse", "updateMatrixWorld"],
      // Group adds no distinctive public methods of its own. Runtime
      // constructor chains are safe; broad construction of every Object3D
      // export is not, so the module tier goes from a named export directly
      // to the validated source fallback for this one class.
      allowModuleProbe: false,
      args: () => [],
      validate: (value) =>
        value?.isGroup && value?.isObject3D && value?.type === "Group",
      sourceFallback: (source) => /this\.isGroup\s*=/.test(source),
    }),
    BufferGeometry: Object.freeze({
      names: ["BufferGeometry"],
      prototypeMethods: ["setAttribute", "computeBoundingSphere", "dispose"],
      args: () => [],
      validate: (value) =>
        value?.isBufferGeometry && value?.type === "BufferGeometry",
      sourceFallback: (source) => /this\.isBufferGeometry\s*=/.test(source),
    }),
    Float32BufferAttribute: Object.freeze({
      names: ["Float32BufferAttribute"],
      prototypeMethods: ["setXYZ", "copyArray"],
      args: () => [[0, 0, 0], 3],
      validate: (value) =>
        value?.isBufferAttribute &&
        value?.array instanceof Float32Array &&
        value.itemSize === 3 &&
        value.count === 1,
      sourceFallback: (source) => /super\(\s*new Float32Array\(/.test(source),
    }),
    MeshStandardMaterial: Object.freeze({
      names: ["MeshStandardMaterial"],
      prototypeMethods: ["setValues", "dispose", "toJSON"],
      args: () => [],
      validate: (value) =>
        value?.isMeshStandardMaterial &&
        value?.type === "MeshStandardMaterial",
      sourceFallback: (source) =>
        /this\.isMeshStandardMaterial\s*=/.test(source),
    }),
    MeshBasicMaterial: Object.freeze({
      names: ["MeshBasicMaterial"],
      prototypeMethods: ["setValues", "dispose", "toJSON"],
      args: () => [],
      validate: (value) =>
        value?.isMeshBasicMaterial && value?.type === "MeshBasicMaterial",
      sourceFallback: (source) => /this\.isMeshBasicMaterial\s*=/.test(source),
    }),
  });
  const meshThreeSpec = (toolkit) => ({
    names: ["Mesh"],
    prototypeMethods: ["add", "raycast", "updateMatrixWorld"],
    args: () => [
      new toolkit.BufferGeometry(),
      new toolkit.MeshStandardMaterial(),
    ],
    disposeArgs: (args) => {
      args[0]?.dispose?.();
      args[1]?.dispose?.();
    },
    validate: (value) =>
      value?.isMesh && value?.isObject3D && value?.type === "Mesh",
    sourceFallback: (source) => /this\.isMesh\s*=/.test(source),
  });
  const loadAvatarToolkit = () => {
    if (avatarToolkitPromise) return avatarToolkitPromise;
    avatarToolkitPromise = (async () => {
      const runtime = collectRuntimeThreeConstructors(streetScene);
      let modules = null;
      const resolveComponent = async (name, spec) => {
        let constructor = resolveThreeConstructor(
          name,
          runtime[name],
          null,
          spec,
        );
        if (constructor) return constructor;
        modules ||= await loadThreeModules();
        constructor = resolveThreeConstructor(
          name,
          runtime[name],
          modules,
          spec,
        );
        if (!constructor) {
          throw resolutionError(
            "avatar-toolkit-unresolved",
            `3place ${name} class was not found`,
          );
        }
        return constructor;
      };
      const toolkit = {};
      toolkit.Group = await resolveComponent(
        "Group",
        AVATAR_THREE_SPECS.Group,
      );
      toolkit.BufferGeometry = await resolveComponent(
        "BufferGeometry",
        AVATAR_THREE_SPECS.BufferGeometry,
      );
      toolkit.Float32BufferAttribute = await resolveComponent(
        "Float32BufferAttribute",
        AVATAR_THREE_SPECS.Float32BufferAttribute,
      );
      toolkit.MeshStandardMaterial = await resolveComponent(
        "MeshStandardMaterial",
        AVATAR_THREE_SPECS.MeshStandardMaterial,
      );
      toolkit.MeshBasicMaterial = await resolveComponent(
        "MeshBasicMaterial",
        AVATAR_THREE_SPECS.MeshBasicMaterial,
      );
      toolkit.Mesh = await resolveComponent("Mesh", meshThreeSpec(toolkit));
      const group = new toolkit.Group();
      const geometry = new toolkit.BufferGeometry();
      const material = new toolkit.MeshStandardMaterial();
      const basicMaterial = new toolkit.MeshBasicMaterial();
      const mesh = new toolkit.Mesh(geometry, material);
      const valid =
        group.isGroup &&
        geometry.isBufferGeometry &&
        material.isMeshStandardMaterial &&
        basicMaterial.isMeshBasicMaterial &&
        mesh.isMesh &&
        typeof toolkit.Float32BufferAttribute === "function";
      geometry.dispose();
      material.dispose();
      basicMaterial.dispose();
      if (!valid) throw new Error("3place avatar exports changed");
      clearThreeResolution("AvatarToolkit");
      return toolkit;
    })().catch((error) => {
      recordThreeResolution(
        "AvatarToolkit",
        "error",
        error?.code || "avatar-toolkit-unresolved",
      );
      avatarToolkitPromise = null;
      throw error;
    });
    return avatarToolkitPromise;
  };
  const geometryFromTriangles = (
    toolkit,
    positions,
    normals,
    colors = null,
  ) => {
    const geometry = new toolkit.BufferGeometry();
    geometry.setAttribute(
      "position",
      new toolkit.Float32BufferAttribute(positions, 3),
    );
    geometry.setAttribute(
      "normal",
      new toolkit.Float32BufferAttribute(normals, 3),
    );
    if (colors) {
      geometry.setAttribute(
        "color",
        new toolkit.Float32BufferAttribute(colors, 3),
      );
    }
    geometry.computeBoundingSphere();
    return geometry;
  };
  const boxGeometry = (toolkit, width, height, depth) => {
    const x = width / 2;
    const y = height / 2;
    const z = depth / 2;
    const points = {
      nnn: [-x, -y, -z],
      nnp: [-x, -y, z],
      npn: [-x, y, -z],
      npp: [-x, y, z],
      pnn: [x, -y, -z],
      pnp: [x, -y, z],
      ppn: [x, y, -z],
      ppp: [x, y, z],
    };
    const faces = [
      [[1, 0, 0], ["pnn", "ppn", "ppp", "pnp"]],
      [[-1, 0, 0], ["nnn", "nnp", "npp", "npn"]],
      [[0, 1, 0], ["npn", "npp", "ppp", "ppn"]],
      [[0, -1, 0], ["nnn", "pnn", "pnp", "nnp"]],
      [[0, 0, 1], ["nnp", "pnp", "ppp", "npp"]],
      [[0, 0, -1], ["nnn", "npn", "ppn", "pnn"]],
    ];
    const positions = [];
    const normals = [];
    for (const [normal, corners] of faces) {
      for (const index of [0, 1, 2, 0, 2, 3]) {
        positions.push(...points[corners[index]]);
        normals.push(...normal);
      }
    }
    return geometryFromTriangles(toolkit, positions, normals);
  };
  const colorComponents = (entry) => {
    const source =
      typeof entry === "string"
        ? entry
        : typeof entry?.hex === "string"
          ? entry.hex
          : "#888888";
    let hex = source.replace(/^#/, "");
    if (/^[0-9a-f]{3}$/i.test(hex)) {
      hex = [...hex].map((digit) => digit + digit).join("");
    }
    if (!/^[0-9a-f]{6}$/i.test(hex)) hex = "888888";
    const value = Number.parseInt(hex, 16);
    const srgb = [
      ((value >> 16) & 255) / 255,
      ((value >> 8) & 255) / 255,
      (value & 255) / 255,
    ];
    return srgb.map((channel) =>
      channel <= 0.04045
        ? channel / 12.92
        : ((channel + 0.055) / 1.055) ** 2.4,
    );
  };
  const customAvatarGeometry = (toolkit, grid, palette, head) => {
    const sizeX = 12;
    const sizeY = 12;
    const sizeZ = 24;
    const headStart = 16;
    const scale = 1.8 / sizeZ;
    const indexOf = (x, y, z) => x + sizeX * (y + sizeY * z);
    const filled = (x, y, z) =>
      x >= 0 &&
      x < sizeX &&
      y >= 0 &&
      y < sizeY &&
      z >= 0 &&
      z < sizeZ &&
      grid[indexOf(x, y, z)] > 0;
    const faces = [
      { delta: [1, 0, 0], normal: [1, 0, 0], corners: [[1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0, 1]] },
      { delta: [-1, 0, 0], normal: [-1, 0, 0], corners: [[0, 0, 1], [0, 1, 1], [0, 1, 0], [0, 0, 0]] },
      { delta: [0, 1, 0], normal: [0, 0, -1], corners: [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]] },
      { delta: [0, -1, 0], normal: [0, 0, 1], corners: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]] },
      { delta: [0, 0, 1], normal: [0, 1, 0], corners: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]] },
      { delta: [0, 0, -1], normal: [0, -1, 0], corners: [[0, 1, 0], [1, 1, 0], [1, 0, 0], [0, 0, 0]] },
    ];
    const positions = [];
    const normals = [];
    const colors = [];
    const startZ = head ? headStart : 0;
    const endZ = head ? sizeZ : headStart;
    for (let z = startZ; z < endZ; z += 1) {
      for (let y = 0; y < sizeY; y += 1) {
        for (let x = 0; x < sizeX; x += 1) {
          const colorIndex = grid[indexOf(x, y, z)];
          if (colorIndex === 0) continue;
          const color = colorComponents(palette[colorIndex - 1]);
          for (const face of faces) {
            if (
              filled(
                x + face.delta[0],
                y + face.delta[1],
                z + face.delta[2],
              )
            ) {
              continue;
            }
            const corners = face.corners.map((corner) => [
              (x + corner[0] - sizeX / 2) * scale,
              (z + corner[2] - startZ) * scale,
              (sizeY / 2 - (y + corner[1])) * scale,
            ]);
            for (const cornerIndex of [0, 1, 2, 0, 2, 3]) {
              positions.push(...corners[cornerIndex]);
              normals.push(...face.normal);
              colors.push(...color);
            }
          }
        }
      }
    }
    return positions.length
      ? geometryFromTriangles(toolkit, positions, normals, colors)
      : null;
  };
  const fetchCustomAvatar = async (account) => {
    const revision = account?.avatar?.rev;
    if (!Number.isSafeInteger(revision) || revision < 1) return null;
    const [avatarResponse, manifestResponse] = await Promise.all([
      fetch(`/api/avatar/${account.userId}?rev=${revision}`, {
        headers: { accept: "application/json" },
        credentials: "same-origin",
      }),
      fetch("/api/manifest", {
        headers: { accept: "application/json" },
        credentials: "same-origin",
      }),
    ]);
    if (!avatarResponse.ok || !manifestResponse.ok) {
      throw new Error("self avatar data could not be loaded");
    }
    const [avatarData, manifest] = await Promise.all([
      avatarResponse.json(),
      manifestResponse.json(),
    ]);
    if (typeof avatarData?.grid !== "string") {
      throw new Error("self avatar grid is missing");
    }
    const binary = atob(avatarData.grid);
    if (binary.length !== 12 * 12 * 24) {
      throw new Error("self avatar grid has an invalid size");
    }
    const grid = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      grid[index] = binary.charCodeAt(index);
    }
    return { grid, palette: Array.isArray(manifest?.palette) ? manifest.palette : [] };
  };
  const createLocalAvatar = async (scene, account) => {
    const toolkit = await loadAvatarToolkit();
    const group = new toolkit.Group();
    group.name = "pathfinder-self-avatar";
    group.scale.setScalar(1.4);
    group.visible = false;
    const geometries = [];
    const materials = [];
    let head = null;
    const custom = await fetchCustomAvatar(account);
    if (custom) {
      const material = new toolkit.MeshStandardMaterial({
        vertexColors: true,
        emissive: "#000000",
        emissiveIntensity: 0,
        roughness: 0.85,
        metalness: 0,
      });
      materials.push(material);
      const bodyGeometry = customAvatarGeometry(
        toolkit,
        custom.grid,
        custom.palette,
        false,
      );
      const headGeometry = customAvatarGeometry(
        toolkit,
        custom.grid,
        custom.palette,
        true,
      );
      if (bodyGeometry) {
        geometries.push(bodyGeometry);
        group.add(new toolkit.Mesh(bodyGeometry, material));
      }
      head = new toolkit.Group();
      head.position.y = 16 * (1.8 / 24);
      if (headGeometry) {
        geometries.push(headGeometry);
        head.add(new toolkit.Mesh(headGeometry, material));
      }
      group.add(head);
    } else {
      const colors = [
        "#e0565f",
        "#4f8fe0",
        "#4fc98d",
        "#d9a441",
        "#9a6fe0",
        "#e07bb1",
        "#54c2cf",
        "#8b95a7",
      ];
      const color = colors[((account.userId % colors.length) + colors.length) % colors.length];
      const bodyMaterial = new toolkit.MeshStandardMaterial({
        color,
        emissive: color,
        emissiveIntensity: 0.35,
        roughness: 0.85,
        metalness: 0,
      });
      const headMaterial = new toolkit.MeshStandardMaterial({
        color: "#cfd6df",
        emissive: "#cfd6df",
        emissiveIntensity: 0.2,
        roughness: 0.85,
        metalness: 0,
      });
      const outlineMaterial = new toolkit.MeshBasicMaterial({
        color: "#f4f7fa",
        side: 1,
        toneMapped: false,
      });
      materials.push(bodyMaterial, headMaterial, outlineMaterial);
      const bodyGeometry = boxGeometry(toolkit, 0.6, 1.25, 0.36);
      const headGeometry = boxGeometry(toolkit, 0.55, 0.55, 0.55);
      geometries.push(bodyGeometry, headGeometry);
      const body = new toolkit.Mesh(bodyGeometry, bodyMaterial);
      body.position.y = 1.25 / 2;
      const bodyOutline = new toolkit.Mesh(bodyGeometry, outlineMaterial);
      bodyOutline.name = "presence-outline";
      bodyOutline.scale.setScalar(1.08);
      body.add(bodyOutline);
      head = new toolkit.Mesh(headGeometry, headMaterial);
      head.position.y = 1.25 + 0.275;
      const headOutline = new toolkit.Mesh(headGeometry, outlineMaterial);
      headOutline.name = "presence-outline";
      headOutline.scale.setScalar(1.08);
      head.add(headOutline);
      group.add(body, head);
    }
    scene.add(group);
    return { scene, group, head, geometries, materials };
  };
  const disposeLocalAvatar = () => {
    if (!localAvatar) return;
    localAvatar.group.parent?.remove(localAvatar.group);
    for (const geometry of localAvatar.geometries) geometry.dispose();
    for (const material of localAvatar.materials) material.dispose();
    localAvatar = null;
  };
  const ensureLocalAvatar = (scene) => {
    if (localAvatar?.scene === scene) return;
    if (localAvatar && localAvatar.scene !== scene) disposeLocalAvatar();
    if (
      localAvatarPromise ||
      !Number.isSafeInteger(selfAccount?.userId) ||
      (localAvatarFailedAt > 0 &&
        performance.now() - localAvatarFailedAt <
          HOOK_TIMING.AVATAR_RETRY_COOLDOWN_MS)
    ) {
      return;
    }
    const targetScene = scene;
    localAvatarPromise = createLocalAvatar(targetScene, selfAccount)
      .then((record) => {
        if (streetScene !== targetScene) {
          record.group.parent?.remove(record.group);
          for (const geometry of record.geometries) geometry.dispose();
          for (const material of record.materials) material.dispose();
          return;
        }
        localAvatar = record;
        localAvatarFailedAt = 0;
      })
      .catch((error) => {
        localAvatarFailedAt = performance.now();
        console.warn("3place Pathfinder self avatar unavailable", error);
      })
      .finally(() => {
        localAvatarPromise = null;
      });
  };
  const syncLocalAvatarPose = (record, camera) => {
    const position = camera.getWorldPosition(camera.position.clone());
    const forward = camera.getWorldDirection(camera.position.clone());
    if (!finiteVector(position) || !finiteVector(forward)) return false;
    record.group.position.copy(position);
    record.group.position.y -= 1.62;
    record.group.rotation.y = Math.atan2(forward.x, forward.z);
    record.head.rotation.x = -Math.asin(Math.max(-1, Math.min(1, forward.y)));
    record.group.updateMatrixWorld(true);
    return true;
  };
  // 02e. Dark night, third-person camera, and paint cursor
  const finiteVector = (vector) =>
    [vector?.x, vector?.y, vector?.z].every(Number.isFinite);
  const hookDarkNightUniform = (uniform) => {
    if (!uniform || darkNightUniforms.has(uniform)) return;
    let officialValue = Number(uniform.value) || 0;
    try {
      Object.defineProperty(uniform, "value", {
        configurable: true,
        enumerable: true,
        get() {
          return enabled("pathfinderDarkNight") ? 0 : officialValue;
        },
        set(value) {
          officialValue = Number(value) || 0;
        },
      });
      darkNightUniforms.add(uniform);
    } catch {}
  };
  const hookDarkNightMaterial = (material) => {
    if (!material || darkNightMaterials.has(material)) return;
    let cacheKey = "";
    try {
      cacheKey = material.customProgramCacheKey?.() || "";
    } catch {}
    if (
      typeof cacheKey !== "string" ||
      !cacheKey.startsWith("3place-voxel-night-light")
    ) {
      return;
    }
    const original = material.onBeforeCompile;
    material.onBeforeCompile = function (shader, renderer) {
      original?.call(this, shader, renderer);
      hookDarkNightUniform(shader?.uniforms?.voxelNightStrength);
    };
    darkNightMaterials.add(material);
    material.needsUpdate = true;
  };
  const syncDarkNightMaterials = (scene) => {
    const now = performance.now();
    if (now - lastDarkNightScan < 1000) return;
    lastDarkNightScan = now;
    scene.traverse((object) => {
      const materials = Array.isArray(object.material)
        ? object.material
        : [object.material];
      for (const material of materials) hookDarkNightMaterial(material);
    });
  };
  const patchRearCursorCanvas = (canvas) => {
    if (!canvas || rearCursorRectPatched.has(canvas)) return;
    const original = canvas.getBoundingClientRect;
    canvas.getBoundingClientRect = function (...args) {
      const rect = original.apply(this, args);
      if (!rearCursorActive()) return rect;
      const stack = String(new Error().stack || "");
      if (!stack.includes("setAimToCenter")) return rect;
      const x = Math.max(
        rect.left,
        Math.min(rect.right, Number.isFinite(rearCursorX) ? rearCursorX : rect.left + rect.width / 2),
      );
      const y = Math.max(
        rect.top,
        Math.min(rect.bottom, Number.isFinite(rearCursorY) ? rearCursorY : rect.top + rect.height / 2),
      );
      return new DOMRect(
        x - rect.width / 2,
        y - rect.height / 2,
        rect.width,
        rect.height,
      );
    };
    rearCursorRectPatched.add(canvas);
  };
  const patchRearCursorRay = (camera) => {
    if (rearCursorRayPatched || !camera?.position) return;
    const vectorPrototype = Object.getPrototypeOf(camera.position);
    const originalSetFromMatrixPosition =
      vectorPrototype?.setFromMatrixPosition;
    const originalUnproject = vectorPrototype?.unproject;
    if (
      typeof originalSetFromMatrixPosition !== "function" ||
      typeof originalUnproject !== "function"
    ) {
      return;
    }
    vectorPrototype.setFromMatrixPosition = function (matrix) {
      let source = matrix;
      if (
        rearCursorActive() &&
        rearCursorCamera &&
        thirdPersonCamera &&
        matrix === rearCursorCamera.matrixWorld &&
        String(new Error().stack || "").includes("setFromCamera")
      ) {
        const rect = rearCursorCanvas.getBoundingClientRect();
        const ndcX =
          ((rearCursorX - rect.left) / Math.max(1, rect.width)) * 2 - 1;
        const ndcY =
          -((rearCursorY - rect.top) / Math.max(1, rect.height)) * 2 + 1;
        const point = rearCursorCamera.position
          .clone()
          .set(ndcX, ndcY, 0.5);
        originalUnproject.call(point, thirdPersonCamera);
        const direction = point
          .sub(thirdPersonCamera.position)
          .normalize();
        const cameraForward = thirdPersonCamera.getWorldDirection(
          rearCursorCamera.position.clone(),
        );
        const playerPlaneDistance = rearCursorCamera.position
          .clone()
          .sub(thirdPersonCamera.position)
          .dot(cameraForward);
        const rayForward = Math.max(0.05, direction.dot(cameraForward));
        const distanceToPlayerPlane = playerPlaneDistance / rayForward;
        const origin = thirdPersonCamera.position
          .clone()
          .addScaledVector(
            direction,
            Math.max(0, distanceToPlayerPlane - 2),
          );
        rearCursorPickMatrix = thirdPersonCamera.matrixWorld.clone();
        rearCursorPickMatrix.setPosition(origin);
        source = rearCursorPickMatrix;
      }
      return originalSetFromMatrixPosition.call(this, source);
    };
    vectorPrototype.unproject = function (cameraToUse) {
      if (
        rearCursorActive() &&
        rearCursorCamera &&
        thirdPersonCamera &&
        cameraToUse === rearCursorCamera
      ) {
        const matrix = rearCursorPickMatrix || thirdPersonCamera.matrixWorld;
        const result = this.applyMatrix4(cameraToUse.projectionMatrixInverse)
          .applyMatrix4(matrix);
        rearCursorPickMatrix = null;
        return result;
      }
      return originalUnproject.call(this, cameraToUse);
    };
    rearCursorRayPatched = true;
  };
  const syncRearCursorMode = (renderer, camera) => {
    const canvas = renderer?.domElement;
    const wanted = Boolean(canvas && camera && rearCursorWanted());
    if (!wanted) {
      if (rearCursorCanvas === canvas || !canvas) {
        const activeCanvas = rearCursorCanvas;
        const wasActive = activeCanvas !== null;
        rearCursorCanvas = null;
        rearCursorCamera = null;
        rearCursorPickMatrix = null;
        uninstallPointerLockSpoof();
        document.documentElement.dataset.pathfinderRearCursor = "false";
        if (
          wasActive &&
          activeCanvas?.isConnected &&
          firstPersonIsActuallyActive()
        ) {
          cancelRearCursorExitObserver();
          requestRearCursorRelock(activeCanvas);
        } else if (!rearCursorRelockPending) {
          rearCursorRecoveryCanvas = null;
          rearCursorAwaitingRelock = false;
          if (pointerLockSpoofAvailable) publishPointerLockStatus("idle");
        }
      }
      return;
    }
    const entering = rearCursorCanvas !== canvas;
    if (entering && !installPointerLockSpoof(canvas)) {
      document.documentElement.dataset.pathfinderRearCursor = "false";
      return;
    }
    rearCursorCanvas = canvas;
    rearCursorCamera = camera;
    rearCursorRecoveryCanvas = null;
    rearCursorAwaitingRelock = false;
    patchRearCursorCanvas(canvas);
    patchRearCursorRay(camera);
    document.documentElement.dataset.pathfinderRearCursor = "true";
    if (entering) {
      const rect = canvas.getBoundingClientRect();
      rearCursorX = rect.left + rect.width / 2;
      rearCursorY = rect.top + rect.height / 2;
    }
    if (nativePointerLockElement() === canvas) {
      try {
        document.exitPointerLock();
      } catch {}
    }
  };
  const findSelfAvatar = (scene) => {
    const root = scene.getObjectByName("presence-avatars");
    if (!root) return null;
    root.updateMatrixWorld(true);
    const exactName = Number.isSafeInteger(selfUserId)
      ? `presence-avatar-${selfUserId}`
      : null;
    if (!exactName) return null;
    const exact = root.getObjectByName(exactName);
    return exact?.parent && exact.visible ? exact : null;
  };
  const hideSelfAvatarDecorations = (avatar) => {
    const hidden = [];
    const hide = (object) => {
      if (!object?.visible) return;
      hidden.push(object);
      object.visible = false;
    };
    avatar.traverse((object) => {
      const decoration =
        object !== avatar &&
        (object.isSprite ||
          object.name === "presence-gaze" ||
          object.name === "presence-ring" ||
          object.name?.startsWith("presence-mark-"));
      if (decoration) hide(object);
    });
    const id = avatar.name.slice("presence-avatar-".length);
    hide(avatar.parent?.getObjectByName(`presence-mark-${id}`));
    return () => {
      for (const object of hidden) object.visible = true;
    };
  };
  // Third-person building collision avoidance
  const setThirdPersonCollisionStatus = (value) => {
    if (
      document.documentElement &&
      document.documentElement.dataset.pathfinderThirdPersonCollision !== value
    ) {
      document.documentElement.dataset.pathfinderThirdPersonCollision = value;
    }
  };
  const resetThirdPersonCollisionDistance = () => {
    thirdPersonCollisionDistance = null;
    thirdPersonCollisionView = "off";
    thirdPersonCollisionUpdatedAt = 0;
    setThirdPersonCollisionStatus("idle");
  };
  const refreshThirdPersonCollisionCandidates = (scene, now) => {
    const childCount = scene?.children?.length ?? 0;
    if (
      scene === thirdPersonCollisionScene &&
      childCount === thirdPersonCollisionSceneChildCount &&
      now - thirdPersonCollisionScannedAt <
        HOOK_TIMING.THIRD_PERSON_COLLISION_SCAN_INTERVAL_MS
    ) {
      return thirdPersonCollisionCandidates;
    }
    const candidates = [];
    scene?.traverse?.((object) => {
      // 3place's solid voxel chunks are InstancedMeshes with a capacity
      // marker. Restricting the list avoids raycasting avatars, helpers,
      // lights, the sky, and UI decoration meshes.
      if (
        object?.isInstancedMesh &&
        Number.isFinite(object.userData?.capacity) &&
        typeof object.raycast === "function"
      ) {
        candidates.push(object);
      }
    });
    thirdPersonCollisionScene = scene;
    thirdPersonCollisionCandidates = candidates;
    thirdPersonCollisionSceneChildCount = childCount;
    thirdPersonCollisionScannedAt = now;
    return candidates;
  };
  const thirdPersonObstacleDistance = (
    scene,
    camera,
    focus,
    viewDirection,
    desiredDistance,
  ) => {
    if (desiredDistance <= THIRD_PERSON_COLLISION.MIN_DISTANCE) {
      return desiredDistance;
    }
    const now = performance.now();
    const candidates = refreshThirdPersonCollisionCandidates(scene, now);
    if (!candidates.length) {
      setThirdPersonCollisionStatus("waiting");
      return desiredDistance;
    }
    const direction = viewDirection.clone().multiplyScalar(-1).normalize();
    const originOffset = Math.min(
      THIRD_PERSON_COLLISION.RAY_START_OFFSET,
      desiredDistance * 0.5,
    );
    const origin = focus.clone().addScaledVector(direction, originOffset);
    const far = Math.max(0, desiredDistance - originOffset);
    if (!thirdPersonCollisionProbe) {
      const scratch = origin.clone();
      thirdPersonCollisionProbe = {
        ray: {
          origin: origin.clone(),
          direction: direction.clone(),
          intersectsSphere(sphere) {
            if (!sphere || sphere.radius < 0) return false;
            const projected = scratch
              .subVectors(sphere.center, this.origin)
              .dot(this.direction);
            if (projected < 0) {
              return (
                this.origin.distanceToSquared(sphere.center) <=
                sphere.radius * sphere.radius
              );
            }
            scratch
              .copy(this.origin)
              .addScaledVector(this.direction, projected);
            return (
              scratch.distanceToSquared(sphere.center) <=
              sphere.radius * sphere.radius
            );
          },
        },
        near: 0,
        far,
        camera,
        params: { Mesh: {} },
      };
    } else {
      thirdPersonCollisionProbe.ray.origin.copy(origin);
      thirdPersonCollisionProbe.ray.direction.copy(direction);
      thirdPersonCollisionProbe.near = 0;
      thirdPersonCollisionProbe.far = far;
      thirdPersonCollisionProbe.camera = camera;
    }
    const intersections = thirdPersonCollisionIntersections;
    intersections.length = 0;
    for (const object of candidates) {
      if (
        !object.visible ||
        object.count <= 0 ||
        object.material?.visible === false
      ) {
        continue;
      }
      try {
        object.raycast(thirdPersonCollisionProbe, intersections);
      } catch {}
    }
    let nearest = Number.POSITIVE_INFINITY;
    for (const intersection of intersections) {
      if (
        Number.isFinite(intersection?.distance) &&
        intersection.distance >= 0 &&
        intersection.distance <= far
      ) {
        nearest = Math.min(nearest, intersection.distance);
      }
    }
    if (!Number.isFinite(nearest)) {
      setThirdPersonCollisionStatus("clear");
      return desiredDistance;
    }
    setThirdPersonCollisionStatus("blocked");
    return Math.min(
      desiredDistance,
      Math.max(
        THIRD_PERSON_COLLISION.MIN_DISTANCE,
        originOffset + nearest - THIRD_PERSON_COLLISION.SURFACE_CLEARANCE,
      ),
    );
  };
  const settleThirdPersonCollisionDistance = (target, view) => {
    const now = performance.now();
    if (
      thirdPersonCollisionDistance === null ||
      thirdPersonCollisionView !== view ||
      target < thirdPersonCollisionDistance
    ) {
      thirdPersonCollisionDistance = target;
    } else {
      const elapsed = Math.max(0, now - thirdPersonCollisionUpdatedAt) / 1000;
      thirdPersonCollisionDistance = Math.min(
        target,
        thirdPersonCollisionDistance +
          elapsed * THIRD_PERSON_COLLISION.RETURN_SPEED_BLOCKS_PER_SECOND,
      );
    }
    thirdPersonCollisionView = view;
    thirdPersonCollisionUpdatedAt = now;
    return thirdPersonCollisionDistance;
  };
  const renderThirdPerson = (renderer, original, scene, camera) => {
    if (document.getElementById("dock")?.dataset.state === "paint") {
      setThirdPersonStatus("paint-paused");
      return original.call(renderer, scene, camera);
    }
    const view = thirdPersonView();
    const on =
      enabled("mcwalkEnabled", enabled("mcwalkActive")) &&
      view !== "off";
    if (!on) {
      resetThirdPersonCollisionDistance();
      setThirdPersonStatus("off");
      return original.call(renderer, scene, camera);
    }
    if (!firstPersonIsActuallyActive()) {
      resetThirdPersonCollisionDistance();
      setThirdPersonStatus("standby");
      return original.call(renderer, scene, camera);
    }
    loadSelfUserId();
    let avatar = findSelfAvatar(scene);
    if (!avatar) {
      ensureLocalAvatar(scene);
      if (localAvatar?.scene === scene) {
        if (!syncLocalAvatarPose(localAvatar, camera)) {
          setThirdPersonStatus("error");
          return original.call(renderer, scene, camera);
        }
        avatar = localAvatar.group;
      }
    }
    if (!avatar) {
      resetThirdPersonCollisionDistance();
      setThirdPersonStatus(
        localAvatarFailedAt > 0 &&
          performance.now() - localAvatarFailedAt <
            HOOK_TIMING.AVATAR_RETRY_COOLDOWN_MS
          ? "avatar-error"
          : "avatar-wait",
      );
      return original.call(renderer, scene, camera);
    }
  
    let restoreDecorations = null;
    const wasVisible = avatar.visible;
    try {
      const avatarPosition = avatar.getWorldPosition(camera.position.clone());
      const forward = camera.getWorldDirection(camera.position.clone());
      if (!finiteVector(avatarPosition) || !finiteVector(forward)) {
        throw new Error("invalid third-person transform");
      }
      if (forward.lengthSq() < 0.0001) forward.set(0, 0, -1);
      forward.normalize();
      const focus = avatarPosition.clone();
      focus.y += 1.25;
      const distance = thirdPersonDistance();
      const viewDirection = forward.clone();
      if (view === "front") {
        viewDirection.x *= -1;
        viewDirection.z *= -1;
        viewDirection.normalize();
      }
      let effectiveDistance = distance;
      if (viewDirection.y > 0.001) {
        const minimumCameraY = avatarPosition.y + 0.22;
        const distanceBeforeGround =
          (focus.y - minimumCameraY) / viewDirection.y;
        effectiveDistance = Math.min(
          effectiveDistance,
          Math.max(
            THIRD_PERSON_COLLISION.MIN_GROUND_DISTANCE,
            distanceBeforeGround,
          ),
        );
      }
      if (graphicsSettings().thirdPersonCollision) {
        effectiveDistance = settleThirdPersonCollisionDistance(
          thirdPersonObstacleDistance(
            scene,
            camera,
            focus,
            viewDirection,
            effectiveDistance,
          ),
          view,
        );
      } else {
        resetThirdPersonCollisionDistance();
      }
  
      if (
        !thirdPersonCamera ||
        thirdPersonCamera.constructor !== camera.constructor
      ) {
        thirdPersonCamera = camera.clone(false);
      } else {
        thirdPersonCamera.copy(camera, false);
      }
      if (
        Number.isFinite(thirdPersonCamera.near) &&
        thirdPersonCamera.near > THIRD_PERSON_COLLISION.CAMERA_NEAR_PLANE
      ) {
        thirdPersonCamera.near = THIRD_PERSON_COLLISION.CAMERA_NEAR_PLANE;
        thirdPersonCamera.updateProjectionMatrix?.();
      }
      thirdPersonCamera.position
        .copy(focus)
        .addScaledVector(viewDirection, -effectiveDistance);
      thirdPersonCamera.lookAt(focus);
      thirdPersonCamera.updateMatrix();
      thirdPersonCamera.updateMatrixWorld(true);
  
      avatar.visible = true;
      restoreDecorations = hideSelfAvatarDecorations(avatar);
      setThirdPersonStatus(view === "front" ? "active-front" : "active-rear");
      const result = original.call(renderer, scene, thirdPersonCamera);
      thirdPersonErrorLogged = false;
      return result;
    } catch (error) {
      setThirdPersonStatus("error");
      if (!thirdPersonErrorLogged) {
        thirdPersonErrorLogged = true;
        console.warn("3place Pathfinder third person unavailable", error);
      }
      restoreDecorations?.();
      restoreDecorations = null;
      avatar.visible = wasVisible;
      return original.call(renderer, scene, camera);
    } finally {
      restoreDecorations?.();
      avatar.visible = wasVisible;
    }
  };
  // 02f. Photo/video capture
  const cameraCanvas = () => {
    const canvas = streetRenderer?.domElement;
    return canvas instanceof HTMLCanvasElement ? canvas : null;
  };
  const cameraLayerCanvases = () => {
    const streetCanvas = cameraCanvas();
    const layers = [
      ...document.querySelectorAll(".space-backdrop, #mapWrap canvas"),
      streetCanvas,
    ];
    return [...new Set(layers)].filter(
      (canvas) =>
        canvas instanceof HTMLCanvasElement &&
        canvas.isConnected &&
        canvas.width > 0 &&
        canvas.height > 0,
    );
  };
  const cameraLayerOpacity = (canvas) => {
    let opacity = 1;
    for (
      let element = canvas;
      element instanceof HTMLElement;
      element = element.parentElement
    ) {
      const style = getComputedStyle(element);
      if (style.display === "none" || style.visibility === "hidden") return 0;
      const value = Number.parseFloat(style.opacity);
      if (Number.isFinite(value)) opacity *= value;
      if (element === document.body) break;
    }
    return opacity;
  };
  const readCameraCrop = () => {
    try {
      const value = JSON.parse(
        document.documentElement?.dataset.pathfinderCameraCrop || "null",
      );
      const x = Number(value?.x);
      const y = Number(value?.y);
      const width = Number(value?.width);
      const height = Number(value?.height);
      if (
        Number.isFinite(x) &&
        Number.isFinite(y) &&
        Number.isFinite(width) &&
        Number.isFinite(height) &&
        width >= 0.05 &&
        height >= 0.05
      ) {
        const safeX = Math.max(0, Math.min(0.95, x));
        const safeY = Math.max(0, Math.min(0.95, y));
        return {
          x: safeX,
          y: safeY,
          width: Math.max(0.05, Math.min(1 - safeX, width)),
          height: Math.max(0.05, Math.min(1 - safeY, height)),
        };
      }
    } catch {}
    return { x: 0, y: 0, width: 1, height: 1 };
  };
  const cameraCaptureMetrics = () => {
    const source = cameraCanvas();
    if (!source) return null;
    const crop = readCameraCrop();
    const left = Math.round(source.width * crop.x);
    const top = Math.round(source.height * crop.y);
    const right = Math.round(source.width * (crop.x + crop.width));
    const bottom = Math.round(source.height * (crop.y + crop.height));
    const width = Math.max(2, Math.floor((right - left) / 2) * 2);
    const height = Math.max(2, Math.floor((bottom - top) / 2) * 2);
    return {
      crop,
      left,
      top,
      width,
      height,
      sourceWidth: source.width,
      sourceHeight: source.height,
    };
  };
  const mediaRecorderSupports = (type) =>
    typeof MediaRecorder === "function" &&
    typeof MediaRecorder.isTypeSupported === "function" &&
    MediaRecorder.isTypeSupported(type);
  const cameraFormatSupport = () => ({
    mp4: [
      "video/mp4;codecs=avc1.42E01E",
      "video/mp4;codecs=avc1.424028",
      "video/mp4;codecs=avc3.42E01E",
      "video/mp4",
    ].some(mediaRecorderSupports),
    webm: [
      "video/webm;codecs=vp9",
      "video/webm;codecs=vp8",
      "video/webm",
    ].some(mediaRecorderSupports),
  });
  const cameraPreferredFormat = () => {
    const value = document.documentElement?.dataset.pathfinderCameraFormat;
    return value === "mp4" || value === "webm" ? value : "auto";
  };
  const cameraRecorderFormat = () => {
    const mp4Choices = [
      "video/mp4;codecs=avc1.42E01E",
      "video/mp4;codecs=avc1.424028",
      "video/mp4;codecs=avc3.42E01E",
      "video/mp4",
    ];
    const webmChoices = [
      "video/webm;codecs=vp9",
      "video/webm;codecs=vp8",
      "video/webm",
    ];
    const preference = cameraPreferredFormat();
    const firstSupported = (choices) =>
      choices.find(mediaRecorderSupports) || "";
    if (preference !== "webm") {
      const mimeType = firstSupported(mp4Choices);
      if (mimeType) return { mimeType, extension: "mp4" };
      if (preference === "mp4") {
        throw new Error(
          tr(
            "このブラウザではMP4録画を利用できません",
            "MP4 recording is not available in this browser.",
          ),
        );
      }
    }
    const mimeType = firstSupported(webmChoices);
    if (mimeType) return { mimeType, extension: "webm" };
    if (preference === "webm") {
      throw new Error(
        tr(
          "このブラウザではWebM録画を利用できません",
          "WebM recording is not available in this browser.",
        ),
      );
    }
    return { mimeType: "", extension: "webm" };
  };
  const ensureCameraOutputCanvas = () => {
    const metrics = cameraCaptureMetrics();
    if (!metrics) return null;
    if (!cameraOutputCanvas) {
      cameraOutputCanvas = document.createElement("canvas");
      cameraOutputContext = cameraOutputCanvas.getContext("2d", {
        alpha: false,
      });
    }
    if (!cameraOutputContext) {
      throw new Error(
        tr(
          "撮影用キャンバスを作成できませんでした",
          "Could not create the capture canvas.",
        ),
      );
    }
    if (
      cameraOutputCanvas.width !== metrics.width ||
      cameraOutputCanvas.height !== metrics.height
    ) {
      cameraOutputCanvas.width = metrics.width;
      cameraOutputCanvas.height = metrics.height;
    }
    return cameraOutputCanvas;
  };
  const cameraMapAttribution = () => {
    const text = document
      .querySelector("#mapWrap .maplibregl-ctrl-attrib-inner")
      ?.textContent?.replace(/\s+/g, " ")
      .trim();
    return (
      text ||
      "OpenFreeMap © OpenMapTiles · OpenStreetMap contributors"
    );
  };
  const fitCameraCreditText = (context, text, maxWidth) => {
    if (context.measureText(text).width <= maxWidth) return text;
    let fitted = text;
    while (fitted.length > 1) {
      fitted = `${fitted.slice(0, -2).trimEnd()}…`;
      if (context.measureText(fitted).width <= maxWidth) return fitted;
    }
    return "…";
  };
  const drawCameraCredits = (context, width, height) => {
    const scale = Math.max(1, Math.min(width / 1280, height / 720));
    const fontSize = Math.round(11 * scale);
    const padX = Math.round(6 * scale);
    const padY = Math.round(4 * scale);
    const margin = Math.round(12 * scale);
    const gap = Math.round(8 * scale);
    const pillHeight = fontSize + padY * 2;
    const y = height - margin - pillHeight;
    const brand = "3place.world";
    const unofficialCredit =
      "recording by 3place Pathfinder(unofficial)";
    const showUnofficialCredit =
      document.documentElement?.dataset
        .pathfinderCameraUnofficialCredit !== "false";
    context.save();
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.globalAlpha = 1;
    context.globalCompositeOperation = "source-over";
    context.textAlign = "left";
    context.textBaseline = "middle";
    context.font = `600 ${fontSize}px system-ui, sans-serif`;
    const brandWidth = Math.ceil(context.measureText(brand).width) + padX * 2;
    const creditMaxWidth = Math.max(
      80,
      width - margin * 2 - brandWidth - gap,
    );
    const credit = fitCameraCreditText(
      context,
      cameraMapAttribution(),
      creditMaxWidth - padX * 2,
    );
    const creditWidth =
      Math.ceil(context.measureText(credit).width) + padX * 2;
    const fittedUnofficialCredit = fitCameraCreditText(
      context,
      unofficialCredit,
      Math.max(20, width - margin * 2 - padX * 2),
    );
    const unofficialWidth =
      Math.ceil(context.measureText(fittedUnofficialCredit).width) +
      padX * 2;
    context.fillStyle = "rgba(4, 6, 11, 0.72)";
    context.fillRect(margin, y, brandWidth, pillHeight);
    context.fillRect(
      width - margin - creditWidth,
      y,
      creditWidth,
      pillHeight,
    );
    if (showUnofficialCredit) {
      context.fillRect(
        margin,
        y - gap - pillHeight,
        unofficialWidth,
        pillHeight,
      );
    }
    context.fillStyle = "#ffffff";
    context.fillText(brand, margin + padX, y + pillHeight / 2);
    context.fillText(
      credit,
      width - margin - creditWidth + padX,
      y + pillHeight / 2,
    );
    if (showUnofficialCredit) {
      context.fillText(
        fittedUnofficialCredit,
        margin + padX,
        y - gap - pillHeight / 2,
      );
    }
    context.restore();
  };
  const composeCameraFrame = () => {
    const streetCanvas = cameraCanvas();
    const metrics = cameraCaptureMetrics();
    const output = ensureCameraOutputCanvas();
    if (!streetCanvas || !metrics || !output || !cameraOutputContext) {
      throw new Error(
        tr(
          "撮影する3D画面が見つかりませんでした",
          "Could not find a 3D view to capture.",
        ),
      );
    }
    const context = cameraOutputContext;
    context.save();
    try {
      context.setTransform(1, 0, 0, 1, 0, 0);
      context.globalAlpha = 1;
      context.globalCompositeOperation = "source-over";
      context.fillStyle = "#04060b";
      context.fillRect(0, 0, output.width, output.height);
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = "high";
      for (const layer of cameraLayerCanvases()) {
        const opacity = cameraLayerOpacity(layer);
        if (opacity <= 0.001) continue;
        // Every capture layer covers the same viewport, but 3place may give
        // each canvas a different backing resolution and CSS rectangle. In
        // particular, the high-DPI space backdrop reports its intrinsic size
        // as its layout size. Crop each backing buffer by the shared viewport
        // ratios instead of projecting those incompatible CSS rectangles.
        const sourceX =
          (metrics.left / metrics.sourceWidth) * layer.width;
        const sourceY =
          (metrics.top / metrics.sourceHeight) * layer.height;
        const sourceWidth =
          (metrics.width / metrics.sourceWidth) * layer.width;
        const sourceHeight =
          (metrics.height / metrics.sourceHeight) * layer.height;
        context.globalAlpha = Math.min(1, opacity);
        context.drawImage(
          layer,
          sourceX,
          sourceY,
          sourceWidth,
          sourceHeight,
          0,
          0,
          output.width,
          output.height,
        );
      }
      drawCameraCredits(context, output.width, output.height);
    } finally {
      context.restore();
    }
    return output;
  };
  const cameraAvailable = () => {
    const canvas = cameraCanvas();
    if (
      !canvas?.isConnected ||
      !streetScene?.isScene ||
      !streetCamera?.isCamera
    ) {
      return false;
    }
    const wrap = canvas.closest("#streetWrap");
    if (!wrap) return false;
    const opacity = Number.parseFloat(getComputedStyle(wrap).opacity);
    return !Number.isFinite(opacity) || opacity > 0.05;
  };
  const cameraState = () => {
    const metrics = cameraCaptureMetrics();
    const support = cameraFormatSupport();
    const preference = cameraPreferredFormat();
    const nextVideoExtension =
      preference === "webm"
        ? "webm"
        : support.mp4
          ? "mp4"
          : "webm";
    return {
      status: cameraStatus,
      available: cameraAvailable(),
      recording: cameraRecorder?.state === "recording",
      startedAt: cameraRecordingStartedAt,
      error: cameraFailure,
      fps: 30,
      width: metrics?.width || 0,
      height: metrics?.height || 0,
      crop: metrics?.crop || readCameraCrop(),
      layers: cameraLayerCanvases().length,
      mp4Supported: support.mp4,
      webmSupported: support.webm,
      nextVideoExtension:
        cameraRecorder?.state === "recording"
          ? cameraRecordingExtension
          : nextVideoExtension,
    };
  };
  const announceCameraState = (status, error = "") => {
    cameraStatus = status;
    cameraFailure = error;
    if (document.documentElement) {
      document.documentElement.dataset.pathfinderCameraStatus = status;
    }
    dispatchEvent(
      new CustomEvent("pathfinder-camera-state", {
        detail: cameraState(),
      }),
    );
  };
  const cameraTimestamp = () => {
    const date = new Date();
    const pad = (value) => String(value).padStart(2, "0");
    return [
      date.getFullYear(),
      pad(date.getMonth() + 1),
      pad(date.getDate()),
      "-",
      pad(date.getHours()),
      pad(date.getMinutes()),
      pad(date.getSeconds()),
    ].join("");
  };
  const downloadCameraBlob = (blob, extension) => {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `3place-pathfinder-${cameraTimestamp()}.${extension}`;
    anchor.hidden = true;
    (document.body || document.documentElement).append(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(
      () => URL.revokeObjectURL(url),
      HOOK_TIMING.DOWNLOAD_URL_REVOKE_MS,
    );
  };
  const renderStreetCameraFrame = () => {
    streetRenderer.render(streetScene, streetCamera);
    return composeCameraFrame();
  };
  const renderCameraFrame = () => {
    if (!cameraAvailable()) {
      throw new Error(
        tr(
          "3D表示を開いてから撮影してください",
          "Open the 3D view before capturing.",
        ),
      );
    }
    // MapLibre clears its WebGL drawing buffer after presenting a frame.
    // Compose inside its next render event so the ocean/sky pixels are still
    // readable, then refresh Three.js immediately before drawing that layer.
    if (
      typeof basemap?.once !== "function" ||
      typeof basemap?.triggerRepaint !== "function"
    ) {
      return Promise.resolve(renderStreetCameraFrame());
    }
    return new Promise((resolve, reject) => {
      let settled = false;
      let timeout = 0;
      const finish = () => {
        if (settled) return;
        settled = true;
        if (timeout) clearTimeout(timeout);
        try {
          resolve(renderStreetCameraFrame());
        } catch (error) {
          reject(error);
        }
      };
      const onRender = () => finish();
      basemap.once("render", onRender);
      timeout = window.setTimeout(() => {
        basemap?.off?.("render", onRender);
        finish();
      }, HOOK_TIMING.CAMERA_BASEMAP_RENDER_TIMEOUT_MS);
      try {
        basemap.triggerRepaint();
      } catch {
        basemap?.off?.("render", onRender);
        finish();
      }
    });
  };
  const captureCameraPhoto = async () => {
    if (cameraRecorder) {
      throw new Error(
        tr(
          "動画の録画中は静止画を撮影できません",
          "Photos cannot be captured while recording video.",
        ),
      );
    }
    announceCameraState("photo");
    try {
      const canvas = await renderCameraFrame();
      const blob = await new Promise((resolve, reject) => {
        canvas.toBlob(
          (result) =>
            result
              ? resolve(result)
              : reject(
                  new Error(
                    tr(
                      "画像を作成できませんでした",
                      "Could not create the image.",
                    ),
                  ),
                ),
          "image/png",
        );
      });
      downloadCameraBlob(blob, "png");
      announceCameraState("ready");
      return { size: blob.size, type: blob.type };
    } catch (error) {
      announceCameraState(
        "error",
        error instanceof Error
          ? error.message
          : tr("静止画の保存に失敗しました", "Could not save the photo."),
      );
      throw error;
    }
  };
  const releaseCameraStream = () => {
    for (const track of cameraStream?.getTracks?.() || []) track.stop();
    cameraStream = null;
  };
  const stopCameraPump = () => {
    if (cameraPumpFrame) cancelAnimationFrame(cameraPumpFrame);
    cameraPumpFrame = 0;
    cameraPumpLast = 0;
  };
  const pumpCameraRecording = async (time) => {
    cameraPumpFrame = 0;
    if (cameraRecorder?.state !== "recording") {
      stopCameraPump();
      return;
    }
    if (time - cameraPumpLast >= 1000 / 30 - 1) {
      cameraPumpLast = time;
      try {
        await renderCameraFrame();
      } catch (error) {
        cameraFailure =
          error instanceof Error
            ? error.message
            : tr(
                "録画を継続できませんでした",
                "Could not continue recording.",
              );
        cameraDownloadOnStop = false;
        cameraRecorder.stop();
        return;
      }
    }
    if (cameraRecorder?.state === "recording") {
      cameraPumpFrame = requestAnimationFrame(pumpCameraRecording);
    }
  };
  const startCameraRecording = async () => {
    if (cameraRecorder) return cameraState();
    if (typeof MediaRecorder !== "function") {
      const error = new Error(
        tr(
          "このブラウザは動画録画に対応していません",
          "This browser does not support video recording.",
        ),
      );
      announceCameraState("error", error.message);
      throw error;
    }
    try {
      const canvas = await renderCameraFrame();
      if (typeof canvas.captureStream !== "function") {
        throw new Error(
          tr(
            "このブラウザは画面録画に対応していません",
            "This browser does not support canvas recording.",
          ),
        );
      }
      cameraStream = canvas.captureStream(30);
      const format = cameraRecorderFormat();
      const options = { videoBitsPerSecond: 10000000 };
      if (format.mimeType) options.mimeType = format.mimeType;
      cameraChunks = [];
      cameraDownloadOnStop = true;
      cameraFailure = "";
      cameraRecorder = new MediaRecorder(cameraStream, options);
      cameraRecordingMimeType =
        cameraRecorder.mimeType || format.mimeType || "video/webm";
      cameraRecordingExtension = cameraRecordingMimeType.includes("mp4")
        ? "mp4"
        : format.extension;
      cameraRecorder.addEventListener("dataavailable", (event) => {
        if (event.data?.size > 0) cameraChunks.push(event.data);
      });
      cameraRecorder.addEventListener("error", (event) => {
        cameraFailure =
          event.error?.message ||
          tr(
            "動画の録画中にエラーが発生しました",
            "An error occurred while recording video.",
          );
        cameraDownloadOnStop = false;
      });
      cameraRecorder.addEventListener(
        "stop",
        () => {
          stopCameraPump();
          const recorder = cameraRecorder;
          const chunks = cameraChunks;
          const shouldDownload = cameraDownloadOnStop && !cameraFailure;
          const resolve = cameraStopResolve;
          const extension = cameraRecordingExtension;
          const recordedMimeType =
            recorder?.mimeType || cameraRecordingMimeType || "video/webm";
          cameraStopResolve = null;
          cameraRecorder = null;
          cameraChunks = [];
          cameraRecordingStartedAt = 0;
          cameraRecordingExtension = "webm";
          cameraRecordingMimeType = "video/webm";
          releaseCameraStream();
          if (shouldDownload && chunks.length) {
            const blob = new Blob(chunks, {
              type: recordedMimeType,
            });
            downloadCameraBlob(blob, extension);
            announceCameraState("ready");
            resolve?.({ size: blob.size, type: blob.type });
            return;
          }
          if (!cameraDownloadOnStop && !cameraFailure) {
            announceCameraState("ready");
            resolve?.(null);
            return;
          }
          const message =
            cameraFailure ||
            tr(
              "動画データを作成できませんでした",
              "Could not create the video data.",
            );
          announceCameraState("error", message);
          resolve?.(null);
        },
        { once: true },
      );
      cameraRecorder.start(1000);
      cameraRecordingStartedAt = Date.now();
      announceCameraState("recording");
      cameraPumpFrame = requestAnimationFrame(pumpCameraRecording);
      return cameraState();
    } catch (error) {
      stopCameraPump();
      cameraRecorder = null;
      cameraChunks = [];
      cameraRecordingStartedAt = 0;
      cameraRecordingExtension = "webm";
      cameraRecordingMimeType = "video/webm";
      releaseCameraStream();
      const message =
        error instanceof Error
          ? error.message
          : tr(
              "動画の録画を開始できませんでした",
              "Could not start video recording.",
            );
      announceCameraState("error", message);
      throw error;
    }
  };
  const stopCameraRecording = (download = true) => {
    if (!cameraRecorder) return Promise.resolve(null);
    if (cameraRecorder.state === "inactive") return Promise.resolve(null);
    cameraDownloadOnStop = download;
    if (download) announceCameraState("processing");
    return new Promise((resolve) => {
      cameraStopResolve = resolve;
      cameraRecorder.stop();
    });
  };
  const cameraApi = Object.freeze({
    capturePhoto: captureCameraPhoto,
    startRecording: startCameraRecording,
    stopRecording: () => stopCameraRecording(true),
    getState: cameraState,
  });
  try {
    Object.defineProperty(window, "__pathfinderCamera", {
      configurable: true,
      value: cameraApi,
    });
  } catch {
    window.__pathfinderCamera = cameraApi;
  }
  // 02g. Renderer hook and teardown
  const attach = (renderer) => {
    if (renderer.__mcwalkWrapped) return;
    renderer.__mcwalkWrapped = true;
    const original = renderer.render;
    renderer.render = function (scene, camera) {
      const street =
        renderer === streetRenderer ||
        Boolean(renderer.domElement?.closest?.("#streetWrap"));
      if (!street || !scene?.isScene || !camera?.isCamera) {
        return original.call(this, scene, camera);
      }
      streetRenderer = renderer;
      streetScene = scene;
      if (streetCamera && streetCamera !== camera) {
        restoreFirstPersonFov(streetCamera);
      }
      streetCamera = camera;
      if (cameraStatus === "waiting" && cameraAvailable()) {
        announceCameraState("ready");
      }
      syncFirstPersonFov(camera);
      syncRearCursorMode(renderer, camera);
      if (enabled("pathfinderDarkNight")) {
        syncDarkNightMaterials(scene);
      }
      syncLight(scene, camera);
      syncOtherLights(scene, camera);
      return renderThirdPerson(this, original, scene, camera);
    };
  };
  devtools.addEventListener("observe", (event) => {
    if (event.detail?.isWebGLRenderer) {
      renderers.add(event.detail);
      attach(event.detail);
    }
  });
  const timer = setInterval(() => {
    for (const renderer of renderers) attach(renderer);
    if (streetRenderer && streetScene) {
      document.documentElement.dataset.mcwalk3dHooked = "true";
      clearInterval(timer);
    }
  }, HOOK_TIMING.RENDERER_ATTACH_POLL_MS);
  const rearCursorTimer = setInterval(() => {
    if (
      rearCursorRelockPending &&
      rearCursorRelockStartedAt > 0 &&
      performance.now() - rearCursorRelockStartedAt >=
        HOOK_TIMING.POINTER_RELOCK_WATCHDOG_MS
    ) {
      finishRearCursorRelock(
        nativePointerLockElement() === rearCursorRelockCanvas,
      );
    }
    if (
      rearCursorAwaitingRelock &&
      !rearCursorRecoveryCanvas?.isConnected
    ) {
      rearCursorRecoveryCanvas = null;
      rearCursorAwaitingRelock = false;
      publishPointerLockStatus("idle");
    }
    if (streetRenderer && streetCamera) {
      syncRearCursorMode(streetRenderer, streetCamera);
    }
  }, HOOK_TIMING.REAR_CURSOR_SYNC_POLL_MS);
  addEventListener("pagehide", () => {
    clearInterval(timer);
    clearInterval(rearCursorTimer);
    void stopCameraRecording(false);
    cancelRearCursorExitObserver();
    rearCursorCanvas = null;
    rearCursorCamera = null;
    rearCursorRelockCanvas = null;
    rearCursorRecoveryCanvas = null;
    rearCursorRelockPending = false;
    uninstallPointerLockSpoof();
    for (const camera of firstPersonFovStates.keys()) {
      restoreFirstPersonFov(camera);
    }
    firstPersonFovStates.clear();
    restoreBasemapFov();
    basemapCaptureCleanup?.();
    basemapCaptureCleanup = null;
    basemap = null;
    basemapFovState = null;
    thirdPersonCollisionProbe = null;
    thirdPersonCollisionScene = null;
    thirdPersonCollisionCandidates = [];
    thirdPersonCollisionIntersections.length = 0;
    resetThirdPersonCollisionDistance();
    if (light && lightScene) {
      lightScene.remove(light, light.target);
      light.dispose?.();
    }
    for (const [key, record] of otherLights) {
      removeOtherLight(key, record);
    }
    disposeLocalAvatar();
    cameraOutputCanvas = null;
    cameraOutputContext = null;
    try {
      delete window.__pathfinderCamera;
    } catch {}
  });
  setStatus("connecting");
  setThirdPersonStatus("off");
  publishPointerLockStatus(
    pointerLockSpoofAvailable ? "idle" : "unsupported",
  );
  announceCameraState("waiting");
};
