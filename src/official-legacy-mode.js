const PATHFINDER_CONFIG_KEY = "3place-pathfinder-v1";
const OFFICIAL_PAINT_CONTROLS_KEY = "3place-paint-controls-v1";
const SYNTHETIC_EVENT_FLAG = "__pathfinderLegacySynthetic";

const readInitialEnabled = () => {
  try {
    const config = JSON.parse(
      localStorage.getItem(PATHFINDER_CONFIG_KEY) || "null",
    );
    return config?.officialLegacyMode === true;
  } catch {
    return false;
  }
};

const isEditableTarget = (target) =>
  target instanceof Element &&
  Boolean(target.closest("input, textarea, select, [contenteditable=true]"));

const visibleOfficialModal = () =>
  Array.from(document.querySelectorAll(".modal")).some((modal) => {
    if (modal.id === "pathfinder-legacy-exit") return false;
    return getComputedStyle(modal).display !== "none";
  });

const makeSyntheticKeyboardEvent = (code, key = code) => {
  const event = new KeyboardEvent("keydown", {
    key,
    code,
    bubbles: true,
    cancelable: true,
  });
  Object.defineProperty(event, SYNTHETIC_EVENT_FLAG, { value: true });
  return event;
};

const makeSyntheticPointerCancel = (source) => {
  const event = new PointerEvent("pointercancel", {
    pointerId: source.pointerId,
    pointerType: source.pointerType,
    isPrimary: source.isPrimary,
    button: source.button,
    buttons: 0,
    clientX: source.clientX,
    clientY: source.clientY,
    bubbles: true,
    cancelable: true,
  });
  Object.defineProperty(event, SYNTHETIC_EVENT_FLAG, { value: true });
  return event;
};

const makeSyntheticPointerMove = (source) => {
  const event = new PointerEvent("pointermove", {
    pointerId: source.pointerId,
    pointerType: "mouse",
    isPrimary: true,
    button: -1,
    buttons: 0,
    clientX: source.clientX,
    clientY: source.clientY,
    bubbles: true,
    cancelable: true,
  });
  Object.defineProperty(event, SYNTHETIC_EVENT_FLAG, { value: true });
  return event;
};

export const installOfficialLegacyMode = () => {
  if (window.__pathfinderOfficialLegacyInstalled) return;
  window.__pathfinderOfficialLegacyInstalled = true;

  let enabled = readInitialEnabled();
  let paintSessionRequested = false;
  let trackedPointer = null;
  let syncQueued = false;
  let lastFirstPerson = null;
  let lastPainting = null;
  let commitPending = false;
  const coarsePointerMedia = matchMedia(
    "(pointer: coarse), (max-width: 720px)",
  );

  const setText = (element, value) => {
    if (element && element.textContent !== value) element.textContent = value;
  };
  const setAttribute = (element, name, value) => {
    if (element?.getAttribute(name) !== value) {
      element?.setAttribute(name, value);
    }
  };
  const setDisabled = (element, value) => {
    if (element && element.disabled !== value) element.disabled = value;
  };
  const setChecked = (element, value) => {
    if (element && element.checked !== value) element.checked = value;
  };
  const setDataset = (element, name, value) => {
    if (element && element.dataset[name] !== value) {
      element.dataset[name] = value;
    }
  };

  const coarsePointerActive = () => coarsePointerMedia.matches;

  const officialPaintControlsMode = () => {
    if (coarsePointerActive()) return "orbit";
    try {
      const saved = localStorage.getItem(OFFICIAL_PAINT_CONTROLS_KEY);
      if (saved === "orbit" || saved === "first-person") return saved;
    } catch {}
    return "first-person";
  };

  const saveOfficialPaintControlsMode = (mode) => {
    if (mode !== "orbit" && mode !== "first-person") return;
    try {
      localStorage.setItem(OFFICIAL_PAINT_CONTROLS_KEY, mode);
    } catch {}
  };

  const inStreetView = () => document.body?.dataset.viewMode === "street";
  const firstPersonActive = () => {
    const cameraButton = document.getElementById("enterFirstPersonBtn");
    const reticle = document.getElementById("paintReticle");
    const touchControls = document.getElementById("touchFirstPersonControls");
    return (
      /^Orbital\b/i.test(cameraButton?.textContent?.trim() || "") ||
      Boolean(reticle && !reticle.hidden) ||
      Boolean(touchControls && !touchControls.hidden)
    );
  };
  const officialBrowsePillVisible = () => {
    const pill = document.getElementById("focusPill");
    return Boolean(
      pill &&
        !pill.hidden &&
        pill.classList.contains("teach") &&
        /^Click to paint$/i.test(pill.textContent.trim()),
    );
  };
  const officialDraftIsActive = () => {
    const pill = document.getElementById("focusPill");
    const discard = document.getElementById("focusDiscard");
    return Boolean(
      pill &&
        (/^(Paint|Placing)/i.test(pill.textContent.trim()) ||
          (discard && !discard.hidden)),
    );
  };
  const paintingActive = () =>
    inStreetView() && (paintSessionRequested || officialDraftIsActive());

  const ensureStyle = () => {
    if (document.getElementById("pathfinder-official-legacy-style")) return;
    const style = document.createElement("style");
    style.id = "pathfinder-official-legacy-style";
    style.textContent = `
      html[data-pathfinder-official-legacy=true] #voxelHover,
      html[data-pathfinder-official-legacy=true] #focusPill,
      html[data-pathfinder-official-legacy=true] #focusDiscard {
        display: none !important;
      }
      html[data-pathfinder-official-legacy=true] #paintHotbar {
        display: none !important;
      }
      html[data-pathfinder-official-legacy=true][data-pathfinder-official-first-person=true] #paintHotbar {
        display: flex !important;
      }
      html[data-pathfinder-official-legacy=true] #paintHotbar > div:last-child > div:nth-child(n + 11) {
        display: none !important;
      }
      html[data-pathfinder-official-legacy=true][data-pathfinder-official-first-person=false] #focusInventory,
      html[data-pathfinder-official-legacy=true][data-pathfinder-official-painting=true] #enterFirstPersonBtn,
      html[data-pathfinder-official-legacy=true][data-pathfinder-official-first-person=true] #enterFirstPersonBtn {
        display: none !important;
      }
      #pathfinder-legacy-paint-button {
        display: none;
        min-width: 78px;
        min-height: 34px;
        margin-inline: 4px;
        padding: 0 14px;
        border: 0;
        border-radius: 999px;
        color: var(--accent-contrast, #fff);
        background: var(--accent, #149f91);
        font: 700 13px/1 system-ui, sans-serif;
        cursor: pointer;
        white-space: nowrap;
      }
      html[data-pathfinder-official-legacy=true] #pathfinder-legacy-paint-button {
        display: inline-flex;
        align-items: center;
        justify-content: center;
      }
      #pathfinder-legacy-paint-button:hover { filter: brightness(.96); }
      #pathfinder-legacy-paint-button:active { transform: translateY(1px); }
      #pathfinder-legacy-paint-button:disabled { opacity: .45; cursor: default; }
      #pathfinder-legacy-paint-dock {
        position: fixed;
        z-index: 32;
        bottom: max(16px, env(safe-area-inset-bottom));
        left: 50%;
        display: none;
        align-items: center;
        gap: 7px;
        max-width: calc(100vw - 24px);
        padding: 8px;
        border: 1px solid rgba(20, 28, 38, .15);
        border-radius: 14px;
        color: #1d2530;
        background: rgba(247, 249, 251, .96);
        box-shadow: 0 8px 28px rgba(21, 34, 48, .18);
        transform: translateX(-50%);
        font: 600 13px/1 system-ui, sans-serif;
      }
      html[data-pathfinder-official-legacy=true][data-pathfinder-official-painting=true][data-pathfinder-official-first-person=false] #pathfinder-legacy-paint-dock {
        display: flex;
      }
      #pathfinder-legacy-paint-dock .legacy-color {
        display: flex;
        align-items: center;
        gap: 7px;
        min-width: 104px;
        padding: 0 7px 0 2px;
      }
      #pathfinder-legacy-paint-dock .legacy-swatch {
        width: 28px;
        height: 28px;
        border: 1px solid rgba(20, 28, 38, .2);
        border-radius: 8px;
        background: #000;
      }
      #pathfinder-legacy-paint-dock button {
        min-width: 36px;
        min-height: 36px;
        padding: 0 10px;
        border: 1px solid rgba(20, 28, 38, .15);
        border-radius: 10px;
        color: #26313e;
        background: #fff;
        font: inherit;
        cursor: pointer;
      }
      #pathfinder-legacy-paint-dock button:hover { background: #f0f3f6; }
      #pathfinder-legacy-paint-dock button:disabled { opacity: .42; cursor: default; }
      #pathfinder-legacy-paint-dock .legacy-commit {
        min-width: 96px;
        border-color: transparent;
        color: var(--accent-contrast, #fff);
        background: var(--accent, #149f91);
      }
      #pathfinder-legacy-paint-dock .legacy-exit { font-size: 18px; }
      #pathfinder-legacy-exit[hidden] { display: none !important; }
      #pathfinder-legacy-exit {
        position: fixed;
        z-index: 2147483400;
        inset: 0;
        display: grid;
        place-items: center;
        padding: 20px;
        background: rgba(12, 18, 26, .5);
      }
      #pathfinder-legacy-exit .legacy-exit-card {
        width: min(360px, 100%);
        padding: 22px;
        border-radius: 18px;
        color: #202936;
        background: #f7f8fa;
        box-shadow: 0 20px 60px rgba(10, 18, 28, .3);
        font-family: system-ui, sans-serif;
      }
      #pathfinder-legacy-exit h2 { margin: 0 0 8px; font-size: 20px; }
      #pathfinder-legacy-exit p { margin: 0 0 18px; color: #5b6572; line-height: 1.45; }
      #pathfinder-legacy-exit .legacy-exit-actions { display: grid; gap: 8px; }
      #pathfinder-legacy-exit button {
        min-height: 42px;
        border: 1px solid rgba(20, 28, 38, .14);
        border-radius: 11px;
        background: #fff;
        font: 650 14px/1 system-ui, sans-serif;
        cursor: pointer;
      }
      #pathfinder-legacy-exit .legacy-discard { color: #a52d35; }
      #pathfinder-legacy-paint-controls { display: none; }
      html[data-pathfinder-official-legacy=true] #pathfinder-legacy-paint-controls { display: flex; }
      @media (max-width: 720px) {
        #pathfinder-legacy-paint-button { min-height: 44px; padding-inline: 15px; }
        #pathfinder-legacy-paint-dock {
          grid-template-columns: 44px repeat(3, minmax(44px, 1fr)) 44px;
          gap: 6px; width: calc(100vw - 16px); max-width: 420px;
          padding: 8px; box-sizing: border-box;
          bottom: max(8px, env(safe-area-inset-bottom));
        }
        html[data-pathfinder-official-legacy=true][data-pathfinder-official-painting=true][data-pathfinder-official-first-person=false] #pathfinder-legacy-paint-dock {
          display: grid;
        }
        #pathfinder-legacy-paint-dock .legacy-color { min-width: 0; padding: 0; justify-content: center; }
        #pathfinder-legacy-paint-dock .legacy-color-name { display: none; }
        #pathfinder-legacy-paint-dock .legacy-swatch { width: 34px; height: 34px; }
        #pathfinder-legacy-paint-dock button { min-width: 44px; min-height: 44px; padding-inline: 5px; }
        #pathfinder-legacy-paint-dock .legacy-commit {
          grid-column: 1 / -1; grid-row: 2; width: 100%; min-width: 0;
        }
        #pathfinder-legacy-paint-dock .legacy-exit { grid-column: 5; grid-row: 1; }
        #pathfinder-legacy-exit { align-items: end; padding: 8px; }
        #pathfinder-legacy-exit .legacy-exit-card {
          width: min(420px, 100%); box-sizing: border-box;
          padding: 20px 18px max(18px, env(safe-area-inset-bottom));
        }
        #pathfinder-legacy-exit button { min-height: 48px; }
      }
      @media (prefers-reduced-motion: reduce) {
        #pathfinder-legacy-paint-button:active { transform: none; }
      }
    `;
    (document.head || document.documentElement).append(style);
  };

  const showExitConfirmation = () => {
    const overlay = ensureExitConfirmation();
    overlay.hidden = false;
    overlay.querySelector(".legacy-keep")?.focus({ preventScroll: true });
  };
  const closeExitConfirmation = () => {
    const overlay = document.getElementById("pathfinder-legacy-exit");
    if (overlay) overlay.hidden = true;
  };
  const finishLegacyPaint = () => {
    const discard = document.getElementById("focusDiscard");
    if (discard && !discard.hidden) discard.click();
    paintSessionRequested = false;
    commitPending = false;
    closeExitConfirmation();
    queueSync();
  };
  function ensureExitConfirmation() {
    let overlay = document.getElementById("pathfinder-legacy-exit");
    if (overlay) return overlay;
    overlay = document.createElement("div");
    overlay.id = "pathfinder-legacy-exit";
    overlay.hidden = true;
    overlay.setAttribute("role", "alertdialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-labelledby", "pathfinder-legacy-exit-title");
    overlay.innerHTML = `
      <div class="legacy-exit-card">
        <h2 id="pathfinder-legacy-exit-title">Stop painting?</h2>
        <p>Your staged voxel changes will be discarded.</p>
        <div class="legacy-exit-actions">
          <button class="legacy-keep" type="button">Keep painting</button>
          <button class="legacy-discard" type="button">Discard changes and stop</button>
        </div>
      </div>
    `;
    overlay.querySelector(".legacy-keep").onclick = closeExitConfirmation;
    overlay.querySelector(".legacy-discard").onclick = finishLegacyPaint;
    overlay.addEventListener("pointerdown", (event) => {
      if (event.target === overlay) closeExitConfirmation();
    });
    document.body.append(overlay);
    return overlay;
  }

  const startLegacyPaint = () => {
    if (!enabled || !inStreetView()) return;
    const exactCell = document.getElementById("dockCoordsBtn");
    if (!exactCell || exactCell.disabled) return;
    paintSessionRequested = true;
    commitPending = false;
    const pill = document.getElementById("focusPill");
    if (officialBrowsePillVisible()) pill?.click();
    if (officialPaintControlsMode() === "first-person") {
      setTimeout(() => {
        if (!enabled || firstPersonActive()) return;
        document.getElementById("enterFirstPersonBtn")?.click();
      }, 0);
    }
    queueSync();
  };

  const ensureLegacyPaintButton = () => {
    const tools = document.getElementById("dockSelectTools");
    if (!tools || document.getElementById("pathfinder-legacy-paint-button")) {
      return;
    }
    const button = document.createElement("button");
    button.id = "pathfinder-legacy-paint-button";
    button.type = "button";
    button.textContent = "Paint (E)";
    button.addEventListener("click", (event) => {
      event.preventDefault();
      startLegacyPaint();
    });
    tools.prepend(button);
  };

  const ensureLegacyPaintDock = () => {
    if (!document.body || document.getElementById("pathfinder-legacy-paint-dock")) {
      return;
    }
    const dock = document.createElement("aside");
    dock.id = "pathfinder-legacy-paint-dock";
    dock.setAttribute("aria-label", "Paint controls");
    dock.innerHTML = `
      <span class="legacy-color"><span class="legacy-swatch" aria-hidden="true"></span><span class="legacy-color-name">Color</span></span>
      <button class="legacy-undo" type="button" title="Undo">Undo</button>
      <button class="legacy-redo" type="button" title="Redo">Redo</button>
      <button class="legacy-eraser" type="button" title="Eraser">Erase</button>
      <button class="legacy-commit" type="button">Paint 0</button>
      <button class="legacy-exit" type="button" aria-label="Stop painting" title="Stop painting">×</button>
    `;
    dock.querySelector(".legacy-undo").onclick = () =>
      document.getElementById("focusInvUndo")?.click();
    dock.querySelector(".legacy-redo").onclick = () =>
      document.getElementById("focusInvRedo")?.click();
    dock.querySelector(".legacy-eraser").onclick = () =>
      dispatchEvent(makeSyntheticKeyboardEvent("KeyX", "x"));
    dock.querySelector(".legacy-commit").onclick = () => {
      commitPending = true;
      document.getElementById("focusInvCommit")?.click();
      queueSync();
    };
    dock.querySelector(".legacy-exit").onclick = showExitConfirmation;
    document.body.append(dock);
  };

  const ensureOfficialPaintControlsSetting = () => {
    const clickLayout = document.getElementById("settingsClickLayout");
    if (
      !clickLayout ||
      document.getElementById("pathfinder-legacy-paint-controls")
    ) {
      return;
    }
    const fieldset = document.createElement("fieldset");
    fieldset.id = "pathfinder-legacy-paint-controls";
    fieldset.className = "settingsSegment";
    fieldset.setAttribute("aria-label", "Paint controls");
    fieldset.innerHTML = `
      <span class="settingsSegmentCopy">
        <span class="settingsSegmentLabel">Paint controls</span>
        <span class="settingsSegmentHelp">Camera used while painting</span>
      </span>
      <span class="settingsSegmentTrack">
        <label><input id="pathfinderLegacyPaintOrbit" type="radio" name="pathfinderLegacyPaintControls" value="orbit" aria-label="Orbit"><span>Orbit</span></label>
        <label><input id="pathfinderLegacyPaintFirstPerson" type="radio" name="pathfinderLegacyPaintControls" value="first-person" aria-label="First-person" data-segment-position="second"><span>First-person</span></label>
      </span>
    `;
    for (const input of fieldset.querySelectorAll("input")) {
      input.addEventListener("change", () => {
        if (input.checked) saveOfficialPaintControlsMode(input.value);
      });
    }
    clickLayout.before(fieldset);
  };

  const syncLegacyUi = () => {
    syncQueued = false;
    ensureStyle();
    if (document.body) {
      ensureLegacyPaintButton();
      ensureLegacyPaintDock();
      ensureExitConfirmation();
      ensureOfficialPaintControlsSetting();
    }
    const firstPerson = firstPersonActive();
    if (!inStreetView()) {
      paintSessionRequested = false;
      commitPending = false;
    }
    if (
      commitPending &&
      officialBrowsePillVisible() &&
      officialDraftIsActive() === false
    ) {
      paintSessionRequested = false;
      commitPending = false;
    }
    const painting = paintingActive();
    const root = document.documentElement;
    if (root) {
      setDataset(root, "pathfinderOfficialLegacy", String(enabled));
      setDataset(root, "pathfinderOfficialFirstPerson", String(firstPerson));
      setDataset(root, "pathfinderOfficialPainting", String(painting));
    }
    const cameraButton = document.getElementById("enterFirstPersonBtn");
    if (enabled && cameraButton && !firstPerson) {
      setText(cameraButton, "Enter first person");
      setAttribute(cameraButton, "aria-label", "Enter first person");
      setAttribute(cameraButton, "title", "Enter first person (F)");
    } else if (!enabled && cameraButton && !firstPerson) {
      if (cameraButton.textContent === "Enter first person") {
        setText(cameraButton, "First-person (F)");
      }
      if (cameraButton.getAttribute("aria-label") === "Enter first person") {
        cameraButton.removeAttribute("aria-label");
      }
      if (cameraButton.getAttribute("title") === "Enter first person (F)") {
        cameraButton.removeAttribute("title");
      }
    }
    const paintButton = document.getElementById("pathfinder-legacy-paint-button");
    if (paintButton) {
      const exactCell = document.getElementById("dockCoordsBtn");
      setDisabled(paintButton, Boolean(exactCell?.disabled));
    }
    const selectedSlot = Array.from(
      document.querySelectorAll("#paintHotbar > div:last-child > div"),
    ).find((cell) => cell.style.borderColor === "rgb(255, 255, 255)");
    const legacyDock = document.getElementById("pathfinder-legacy-paint-dock");
    if (legacyDock) {
      const swatch = legacyDock.querySelector(".legacy-swatch");
      if (swatch && selectedSlot?.style.background) {
        const background = selectedSlot.style.background;
        if (swatch.style.background !== background) {
          swatch.style.background = background;
        }
      }
      const pillText = document.getElementById("focusPill")?.textContent?.trim();
      setText(
        legacyDock.querySelector(".legacy-commit"),
        pillText && /^(Paint|Placing)/i.test(pillText) ? pillText : "Paint 0",
      );
      const undo = document.getElementById("focusInvUndo");
      const redo = document.getElementById("focusInvRedo");
      setDisabled(
        legacyDock.querySelector(".legacy-undo"),
        undo?.disabled ?? true,
      );
      setDisabled(
        legacyDock.querySelector(".legacy-redo"),
        redo?.disabled ?? true,
      );
      setDisabled(
        legacyDock.querySelector(".legacy-commit"),
        document.getElementById("focusInvCommit")?.disabled ?? true,
      );
    }
    const mode = officialPaintControlsMode();
    const orbit = document.getElementById("pathfinderLegacyPaintOrbit");
    const first = document.getElementById("pathfinderLegacyPaintFirstPerson");
    const touchOrbit = coarsePointerActive();
    setChecked(orbit, mode === "orbit");
    setChecked(first, mode === "first-person");
    setDisabled(first, touchOrbit);
    const settingHelp = document.querySelector(
      "#pathfinder-legacy-paint-controls .settingsSegmentHelp",
    );
    setText(
      settingHelp,
      touchOrbit ? "Touch uses Orbit controls" : "Camera used while painting",
    );
    if (lastFirstPerson !== firstPerson || lastPainting !== painting) {
      lastFirstPerson = firstPerson;
      lastPainting = painting;
      dispatchEvent(
        new CustomEvent("pathfinder-official-legacy-state", {
          detail: { enabled, firstPerson, painting },
        }),
      );
    }
  };

  function queueSync() {
    if (syncQueued) return;
    syncQueued = true;
    queueMicrotask(syncLegacyUi);
  }

  const cancelOfficialBrowseTap = (event, canvas, openSelection) => {
    event.preventDefault();
    event.stopImmediatePropagation();
    queueMicrotask(() => {
      try {
        if (canvas.hasPointerCapture(event.pointerId)) {
          canvas.releasePointerCapture(event.pointerId);
        }
      } catch {}
      canvas.dispatchEvent(makeSyntheticPointerCancel(event));
      if (openSelection && event.button === 0) {
        canvas.dispatchEvent(makeSyntheticPointerMove(event));
        dispatchEvent(makeSyntheticKeyboardEvent("KeyV", "v"));
      }
      queueSync();
    });
  };

  addEventListener(
    "pointerdown",
    (event) => {
      if (!enabled || event[SYNTHETIC_EVENT_FLAG]) return;
      const canvas = event.composedPath().find(
        (node) =>
          node instanceof HTMLCanvasElement && node.closest("#streetWrap"),
      );
      if (
        !canvas ||
        firstPersonActive() ||
        paintingActive() ||
        ![0, 2].includes(event.button)
      ) {
        trackedPointer = null;
        return;
      }
      trackedPointer = {
        id: event.pointerId,
        canvas,
        x: event.clientX,
        y: event.clientY,
        pointerType: event.pointerType,
        startedAt: performance.now(),
        moved: false,
      };
    },
    true,
  );
  addEventListener(
    "pointermove",
    (event) => {
      if (!trackedPointer || trackedPointer.id !== event.pointerId) return;
      if (
        Math.hypot(
          event.clientX - trackedPointer.x,
          event.clientY - trackedPointer.y,
        ) > (trackedPointer.pointerType === "touch" ? 12 : 6)
      ) {
        trackedPointer.moved = true;
      }
    },
    true,
  );
  addEventListener(
    "pointerup",
    (event) => {
      if (!trackedPointer || trackedPointer.id !== event.pointerId) return;
      const pointer = trackedPointer;
      trackedPointer = null;
      if (
        enabled &&
        !pointer.moved &&
        !firstPersonActive() &&
        !paintingActive()
      ) {
        const tapDuration = performance.now() - pointer.startedAt;
        cancelOfficialBrowseTap(
          event,
          pointer.canvas,
          pointer.pointerType !== "touch" || tapDuration <= 650,
        );
      }
    },
    true,
  );
  for (const type of ["pointercancel", "blur"]) {
    addEventListener(type, () => {
      trackedPointer = null;
    }, true);
  }

  addEventListener(
    "keydown",
    (event) => {
      if (!enabled || event[SYNTHETIC_EVENT_FLAG] || isEditableTarget(event.target)) {
        return;
      }
      const exitOverlay = document.getElementById("pathfinder-legacy-exit");
      if (exitOverlay && !exitOverlay.hidden) {
        if (event.code === "Escape") {
          event.preventDefault();
          event.stopImmediatePropagation();
          closeExitConfirmation();
        }
        return;
      }
      if (visibleOfficialModal()) return;
      const firstPerson = firstPersonActive();
      const painting = paintingActive();
      if (event.code === "KeyF" && (firstPerson || painting)) {
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }
      const currentOnlyShortcut =
        ["Delete", "NumpadDecimal", "KeyX", "Minus", "NumpadSubtract"].includes(
          event.code,
        ) ||
        (event.code === "KeyV" &&
          !event.altKey &&
          !event.ctrlKey &&
          !event.metaKey);
      if (currentOnlyShortcut) {
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }
      if (event.code === "Tab" && !(firstPerson && painting)) {
        event.stopImmediatePropagation();
        return;
      }
      if (event.code === "KeyE" && !event.ctrlKey && !event.metaKey && !event.altKey) {
        if (!painting) {
          event.preventDefault();
          event.stopImmediatePropagation();
          startLegacyPaint();
        } else if (!firstPerson) {
          event.preventDefault();
          event.stopImmediatePropagation();
        }
        return;
      }
      if (event.code === "Enter" && painting) {
        commitPending = true;
        queueSync();
        return;
      }
      if (
        event.code === "Escape" &&
        painting &&
        document.pointerLockElement === null
      ) {
        event.preventDefault();
        event.stopImmediatePropagation();
        showExitConfirmation();
      }
    },
    true,
  );

  addEventListener("pathfinder-official-legacy-change", (event) => {
    enabled = event.detail?.enabled === true;
    if (!enabled) {
      paintSessionRequested = false;
      commitPending = false;
      closeExitConfirmation();
    }
    queueSync();
  });
  addEventListener("pointerlockchange", queueSync, true);
  coarsePointerMedia.addEventListener("change", queueSync);
  addEventListener(
    "pagehide",
    () => {
      observer.disconnect();
      coarsePointerMedia.removeEventListener("change", queueSync);
    },
    { once: true },
  );

  const observer = new MutationObserver(queueSync);
  observer.observe(document.documentElement, {
    attributes: true,
    childList: true,
    subtree: true,
    characterData: true,
  });
  queueSync();
};
