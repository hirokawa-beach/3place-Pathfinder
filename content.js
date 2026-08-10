(() => {
  "use strict";

  const repairBrokenCameraHash = () => {
    const parts = location.hash.slice(1).split("/");
    if (parts.length < 5) return;
    const cameraValues = parts.slice(0, 5).map(Number);
    if (!cameraValues.every(Number.isFinite) || cameraValues[4] <= 90) return;
    parts[4] = "90";
    const repairedUrl = new URL(location.href);
    repairedUrl.hash = parts.join("/");
    window.history.replaceState(window.history.state, "", repairedUrl.href);
  };

  repairBrokenCameraHash();

  const CONFIG_KEY = "3place-pathfinder-v1";
  const LEGACY_CONFIG_KEY = "3place-minecraft-walk-v1";
  const PANEL_POSITION_KEY = "3place-pathfinder-panel-position-v1";
  const APP_SPEED_KEY = "3place-fly-speed-v1";
  const DEFAULT_SPEED = 5.2;
  const MIN_SPEED = 2;
  const MAX_SPEED = 12;

  const SUPPORTED_LANGUAGES = new Set(["auto", "ja", "en"]);
  const browserLanguage = () =>
    (navigator.languages?.[0] || navigator.language || "en")
      .toLowerCase()
      .startsWith("ja")
      ? "ja"
      : "en";
  const effectiveLanguage = (language) =>
    language === "ja" || language === "en" ? language : browserLanguage();
  const copy = {
    ja: {
      bridgeConnecting: "ライト接続中",
      bridgeReady: "ライト接続済み",
      bridgeError: "ライト接続エラー",
      bridgeWaiting: "ライト接続待ち",
      movePanel: "Pathfinderパネルを移動",
      dragToMove: "ドラッグして移動",
      toggleTitle: "3place PathfinderをON/OFF",
      settingsLabel: "3place Pathfinder設定",
      startWalking: "歩行で開始",
      movementSpeed: "移動速度",
      helmetLights: "ヘルメットライト（全員）",
      lightIntensity: "ライト強度（全員）",
      instructions:
        "一人称は歩行で開始します。WASDで移動、Spaceでジャンプ。開始後はダブルSpaceで自由に飛行できます。",
      lightShortcut: "Alt+T: ライト切替",
      language: "言語",
      autoLanguage: "自動（ブラウザー）",
      japanese: "日本語",
      english: "English",
      reload: "再読み込み",
      reloadNeeded: "速度の反映には再読み込みが必要です",
    },
    en: {
      bridgeConnecting: "Connecting lights",
      bridgeReady: "Lights connected",
      bridgeError: "Light connection error",
      bridgeWaiting: "Waiting for lights",
      movePanel: "Move the Pathfinder panel",
      dragToMove: "Drag to move",
      toggleTitle: "Turn 3place Pathfinder on/off",
      settingsLabel: "3place Pathfinder settings",
      startWalking: "Start in walking mode",
      movementSpeed: "Movement speed",
      helmetLights: "Helmet lights (everyone)",
      lightIntensity: "Light intensity (everyone)",
      instructions:
        "First-person starts in walking mode. Use WASD to move and Space to jump. Double-tap Space to fly after entering.",
      lightShortcut: "Alt+T: Toggle lights",
      language: "Language",
      autoLanguage: "Auto (browser)",
      japanese: "Japanese",
      english: "English",
      reload: "Reload",
      reloadNeeded: "Reload to apply movement speed changes",
    },
  };
  let uiLanguage = "ja";
  const t = (key) => copy[uiLanguage]?.[key] || key;

  const clampSpeed = (value) => {
    const number = Number(value);
    return Number.isFinite(number)
      ? Math.max(MIN_SPEED, Math.min(MAX_SPEED, number))
      : DEFAULT_SPEED;
  };

  const readConfig = () => {
    try {
      const raw =
        localStorage.getItem(CONFIG_KEY) ||
        localStorage.getItem(LEGACY_CONFIG_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        return {
          enabled: parsed.enabled !== false,
          speed: clampSpeed(parsed.speed),
          headlightEnabled:
            parsed.headlightEnabled !== undefined
              ? parsed.headlightEnabled !== false
              : parsed.torchEnabled !== false,
          lightIntensity: Number.isFinite(Number(parsed.lightIntensity))
            ? Math.max(20, Math.min(160, Number(parsed.lightIntensity)))
            : 90,
          previousSpeed:
            typeof parsed.previousSpeed === "string"
              ? parsed.previousSpeed
              : null,
          language: SUPPORTED_LANGUAGES.has(parsed.language)
            ? parsed.language
            : "auto",
        };
      }
    } catch {
      // A malformed saved value should never stop 3place from loading.
    }

    let previousSpeed = null;
    try {
      previousSpeed = localStorage.getItem(APP_SPEED_KEY);
    } catch {
      // Storage can be unavailable in a restricted browsing context.
    }

    return {
      enabled: true,
      speed: DEFAULT_SPEED,
      headlightEnabled: true,
      lightIntensity: 90,
      previousSpeed,
      language: "auto",
    };
  };

  let config = readConfig();
  uiLanguage = effectiveLanguage(config.language);

  const saveConfig = () => {
    try {
      localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
    } catch {
      // Keep the current page functional even when persistence is blocked.
    }
  };

  const applySpeedForNextLoad = () => {
    try {
      if (config.enabled) {
        localStorage.setItem(APP_SPEED_KEY, JSON.stringify(config.speed));
      } else if (config.previousSpeed === null) {
        localStorage.removeItem(APP_SPEED_KEY);
      } else {
        localStorage.setItem(APP_SPEED_KEY, config.previousSpeed);
      }
    } catch {
      // The walking-mode switch still works without the speed preference.
    }
  };

  saveConfig();
  applySpeedForNextLoad();

  let hint = null;
  let touchFlightButton = null;
  let modeObserver = null;
  let forcingWalk = false;
  let forceRetry = 0;
  let firstPersonActive = false;
  let initialModePending = false;
  let widget = null;
  let featureKeysBound = false;
  let bridgeStatusObserver = null;

  const updateBridgeStatus = () => {
    if (!widget?.bridgeStatus) return;
    const status = document.documentElement.dataset.mcwalk3dStatus;
    const labels = {
      connecting: t("bridgeConnecting"),
      ready: t("bridgeReady"),
      "light-unavailable": t("bridgeError"),
    };
    widget.bridgeStatus.textContent = `v1.0.0 · ${labels[status] || t("bridgeWaiting")}`;
  };

  const visibleHintText = () => {
    if (!hint || hint.hidden) return "";
    return (hint.textContent || "").trim();
  };

  const movementMode = () => {
    const text = visibleHintText();
    if (!text) return "idle";

    if (
      /Double-Space to walk|Up \/ Down flies|^Flying\b/.test(text)
    ) {
      return "flying";
    }

    if (
      /Double-Space to fly|Jump is on the right|^Walking\b/.test(text)
    ) {
      return "walking";
    }

    // The touch button is only a fallback. Its dataset can retain an older
    // mode after switching from touch input to pointer-lock input.
    if (touchFlightButton?.dataset.mode === "fly") return "flying";
    if (touchFlightButton?.dataset.mode === "walk") return "walking";

    return "idle";
  };

  const updateWidget = () => {
    if (!widget) return;
    const state = !config.enabled ? "off" : movementMode();
    widget.root.dataset.state = state;
    widget.state.textContent =
      state === "walking"
        ? "WALKING"
        : state === "flying"
          ? "FLYING"
          : state === "off"
            ? "OFF"
            : "READY";
  };

  const updateEffects = () => {
    const root = document.documentElement;
    root.dataset.mcwalkEnabled = String(config.enabled);
    root.dataset.mcwalkActive = String(config.enabled && firstPersonActive);
    root.dataset.mcwalkHeadlight = String(config.headlightEnabled);
    root.dataset.mcwalkLightIntensity = String(config.lightIntensity);
  };

  const dispatchSpaceTap = () => {
    const init = {
      key: " ",
      code: "Space",
      bubbles: true,
      cancelable: true,
    };
    window.dispatchEvent(new KeyboardEvent("keydown", init));
    window.dispatchEvent(new KeyboardEvent("keyup", init));
  };

  const forceWalkingMode = () => {
    updateWidget();
    if (!config.enabled || forcingWalk || movementMode() !== "flying") return;

    forcingWalk = true;
    window.clearTimeout(forceRetry);

    // 3place exposes its fly/walk switch as a double-Space gesture.
    // Synthetic keyboard events keep this extension independent of minified
    // private class names while still using 3place's own collision physics.
    dispatchSpaceTap();
    window.setTimeout(dispatchSpaceTap, 70);
    forceRetry = window.setTimeout(() => {
      forcingWalk = false;
      updateWidget();
    }, 170);
  };

  const syncMovementUi = () => {
    const text = visibleHintText();
    const active =
      text.length > 0 &&
      !/^Loading nearby blocks/.test(text) &&
      !/Mouse capture unavailable.*Orbit paint controls active/.test(text);
    const justEnteredFirstPerson = active && !firstPersonActive;
    if (justEnteredFirstPerson) initialModePending = true;
    if (!active) initialModePending = false;
    firstPersonActive = active;
    updateWidget();
    updateEffects();

    // Start each first-person session on foot. Once it has started, native
    // double-Space fly/walk changes are left completely unrestricted.
    const mode = movementMode();
    if (config.enabled && initialModePending && mode !== "idle") {
      initialModePending = false;
      if (mode === "flying") forceWalkingMode();
    }
  };

  const bindFeatureKeys = () => {
    if (featureKeysBound) return;
    featureKeysBound = true;
    window.addEventListener("keydown", (event) => {
      if (event.altKey && !event.repeat && event.code === "KeyT") {
        event.preventDefault();
        config.headlightEnabled = !config.headlightEnabled;
        if (widget) widget.headlight.checked = config.headlightEnabled;
        saveConfig();
        updateEffects();
      }
    });
    updateEffects();
  };

  const observeMovementUi = () => {
    const nextHint = document.getElementById("firstPersonHint");
    const nextTouchButton = document.getElementById("touchFlightBtn");
    if (!nextHint || nextHint === hint) return;

    hint = nextHint;
    touchFlightButton = nextTouchButton;
    modeObserver?.disconnect();
    modeObserver = new MutationObserver(syncMovementUi);
    modeObserver.observe(hint, {
      attributes: true,
      attributeFilter: ["hidden", "data-locked"],
      childList: true,
      characterData: true,
      subtree: true,
    });
    if (touchFlightButton) {
      modeObserver.observe(touchFlightButton, {
        attributes: true,
        attributeFilter: ["data-mode", "aria-pressed"],
      });
    }
    syncMovementUi();
  };

  const positionPanel = (root) => {
    if (root.dataset.open !== "true") return;
    const panel = root.querySelector(".mcwalk-panel");
    const bounds = root.getBoundingClientRect();
    const panelWidth = Math.min(290, innerWidth - 16);
    root.dataset.panelAlign =
      bounds.left + panelWidth > innerWidth - 8 ? "right" : "left";
    const spaceBelow = innerHeight - bounds.bottom - 8;
    const spaceAbove = bounds.top - 8;
    const openUp = spaceBelow < 260 && spaceAbove > spaceBelow;
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
    } catch {
      // Keep the default left-center position.
    }

    handle.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      const bounds = root.getBoundingClientRect();
      const offsetX = event.clientX - bounds.left;
      const offsetY = event.clientY - bounds.top;
      root.style.right = "auto";
      root.style.transform = "none";
      root.dataset.dragging = "true";
      handle.setPointerCapture(event.pointerId);

      const move = (moveEvent) => {
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
        try {
          localStorage.setItem(
            PANEL_POSITION_KEY,
            JSON.stringify({
              x: Number.parseFloat(root.style.left),
              y: Number.parseFloat(root.style.top),
            }),
          );
        } catch {
          // Dragging still works until the page is closed.
        }
      };

      handle.addEventListener("pointermove", move);
      handle.addEventListener("pointerup", finish);
      handle.addEventListener("pointercancel", finish);
    });
  };

  const createWidget = () => {
    if (widget || !document.body) return;

    const root = document.createElement("aside");
    root.id = "mcwalk-root";
    root.dataset.open = "false";
    root.dataset.state = config.enabled ? "idle" : "off";
    root.innerHTML = `
      <div class="mcwalk-head">
        <button class="mcwalk-drag" type="button" aria-label="${t("movePanel")}" title="${t("dragToMove")}">⠿</button>
        <button class="mcwalk-badge" type="button" aria-pressed="${config.enabled}" title="${t("toggleTitle")}">
          <span class="mcwalk-block" aria-hidden="true">P</span>
          <span class="mcwalk-title">PATHFINDER</span>
          <span class="mcwalk-state">READY</span>
        </button>
        <button class="mcwalk-settings" type="button" aria-label="${t("settingsLabel")}" aria-expanded="false">⚙</button>
      </div>
      <section class="mcwalk-panel" aria-label="${t("settingsLabel")}">
        <label class="mcwalk-switch-row">
          <span>${t("startWalking")}</span>
          <input class="mcwalk-enabled" type="checkbox">
        </label>
        <label class="mcwalk-speed-row">
          <span>${t("movementSpeed")}</span>
          <output class="mcwalk-speed-value"></output>
          <input class="mcwalk-speed" type="range" min="${MIN_SPEED}" max="${MAX_SPEED}" step="0.2">
        </label>
        <label class="mcwalk-option-row">
          <span>${t("helmetLights")}</span>
          <input class="mcwalk-headlight" type="checkbox">
        </label>
        <label class="mcwalk-light-row">
          <span>${t("lightIntensity")}</span>
          <output class="mcwalk-light-value"></output>
          <input class="mcwalk-light-intensity" type="range" min="20" max="160" step="5">
        </label>
        <label class="mcwalk-language-row">
          <span>${t("language")}</span>
          <select class="mcwalk-language">
            <option value="auto">${t("autoLanguage")}</option>
            <option value="ja">${t("japanese")}</option>
            <option value="en">${t("english")}</option>
          </select>
        </label>
        <p>${t("instructions")}</p>
        <p class="mcwalk-shortcuts">${t("lightShortcut")}</p>
        <p class="mcwalk-bridge-status" aria-live="polite">v1.0.0 · ${t("bridgeWaiting")}</p>
        <div class="mcwalk-reload-row">
          <span class="mcwalk-reload-note" aria-live="polite"></span>
          <button class="mcwalk-reload" type="button">${t("reload")}</button>
        </div>
      </section>
    `;

    document.body.append(root);

    const badge = root.querySelector(".mcwalk-badge");
    const drag = root.querySelector(".mcwalk-drag");
    const settings = root.querySelector(".mcwalk-settings");
    const panel = root.querySelector(".mcwalk-panel");
    const enabled = root.querySelector(".mcwalk-enabled");
    const speed = root.querySelector(".mcwalk-speed");
    const speedValue = root.querySelector(".mcwalk-speed-value");
    const reload = root.querySelector(".mcwalk-reload");
    const reloadNote = root.querySelector(".mcwalk-reload-note");
    const state = root.querySelector(".mcwalk-state");
    const headlight = root.querySelector(".mcwalk-headlight");
    const lightIntensity = root.querySelector(".mcwalk-light-intensity");
    const lightValue = root.querySelector(".mcwalk-light-value");
    const bridgeStatus = root.querySelector(".mcwalk-bridge-status");
    const language = root.querySelector(".mcwalk-language");

    widget = {
      root,
      panel,
      enabled,
      speed,
      speedValue,
      reloadNote,
      state,
      headlight,
      lightIntensity,
      bridgeStatus,
      language,
    };
    enabled.checked = config.enabled;
    speed.value = String(config.speed);
    speed.disabled = !config.enabled;
    speedValue.textContent = `${config.speed.toFixed(1)} block/s`;
    headlight.checked = config.headlightEnabled;
    lightIntensity.value = String(config.lightIntensity);
    lightValue.textContent = String(config.lightIntensity);
    language.value = config.language;
    updateBridgeStatus();
    bindPanelDrag(root, drag);

    const applyEnabled = (value) => {
      config.enabled = Boolean(value);
      enabled.checked = config.enabled;
      speed.disabled = !config.enabled;
      badge.setAttribute("aria-pressed", String(config.enabled));
      saveConfig();
      applySpeedForNextLoad();
      reloadNote.textContent = t("reloadNeeded");
      updateWidget();
      updateEffects();
      if (config.enabled) forceWalkingMode();
    };

    badge.addEventListener("click", () => applyEnabled(!config.enabled));
    settings.addEventListener("click", () => {
      const open = root.dataset.open !== "true";
      root.dataset.open = String(open);
      settings.setAttribute("aria-expanded", String(open));
      if (open) {
        requestAnimationFrame(() => positionPanel(root));
      }
    });

    enabled.addEventListener("change", () => applyEnabled(enabled.checked));

    speed.addEventListener("input", () => {
      config.speed = clampSpeed(speed.value);
      speedValue.textContent = `${config.speed.toFixed(1)} block/s`;
      saveConfig();
      applySpeedForNextLoad();
      reloadNote.textContent = t("reloadNeeded");
    });

    headlight.addEventListener("change", () => {
      config.headlightEnabled = headlight.checked;
      saveConfig();
      updateEffects();
    });

    lightIntensity.addEventListener("input", () => {
      config.lightIntensity = Math.max(
        20,
        Math.min(160, Number(lightIntensity.value)),
      );
      lightValue.textContent = String(config.lightIntensity);
      saveConfig();
      updateEffects();
    });

    language.addEventListener("change", () => {
      config.language = SUPPORTED_LANGUAGES.has(language.value)
        ? language.value
        : "auto";
      saveConfig();
      location.reload();
    });

    reload.addEventListener("click", () => location.reload());
    updateWidget();
  };

  const boot = () => {
    bindFeatureKeys();
    createWidget();
    observeMovementUi();
    if (!bridgeStatusObserver) {
      bridgeStatusObserver = new MutationObserver(updateBridgeStatus);
      bridgeStatusObserver.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ["data-mcwalk3d-status"],
      });
    }
    updateBridgeStatus();
    if (!widget || !hint) window.setTimeout(boot, 200);
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    boot();
  }
})();
