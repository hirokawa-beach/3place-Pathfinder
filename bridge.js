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

  if (window.__mcwalk3dBridgeInstalled) return;
  window.__mcwalk3dBridgeInstalled = true;

  const observedRenderers = new Set();
  let streetRenderer = null;
  let streetScene = null;
  let headlight = null;
  let headlightScene = null;
  let headlightPromise = null;
  let selfUserId = undefined;
  const otherHeadlights = new Map();
  const MAX_OTHER_HEADLIGHTS = 12;

  const devtools =
    window.__THREE_DEVTOOLS__ instanceof EventTarget
      ? window.__THREE_DEVTOOLS__
      : new EventTarget();
  window.__THREE_DEVTOOLS__ = devtools;

  const setStatus = (status) => {
    document.documentElement.dataset.mcwalk3dStatus = status;
  };

  const setting = (name, fallback = false) => {
    const value = document.documentElement.dataset[name];
    return value === undefined ? fallback : value === "true";
  };

  const firstPersonIsActuallyActive = () => {
    const hint = document.getElementById("firstPersonHint");
    if (!hint || hint.hidden) return false;
    const text = (hint.textContent || "").trim();
    return Boolean(
      text &&
        !/^Loading nearby blocks/.test(text) &&
        !/Mouse capture unavailable.*Orbit paint controls active/.test(text),
    );
  };

  const lightIntensity = () => {
    const value = Number(document.documentElement.dataset.mcwalkLightIntensity);
    return Number.isFinite(value) ? Math.max(20, Math.min(160, value)) : 90;
  };

  const mainModuleUrl = () => {
    const preload = document.querySelector(
      'link[rel="modulepreload"][href*="/assets/main-"][href$=".js"]',
    );
    if (preload?.href) return preload.href;
    const entry = performance
      .getEntriesByType("resource")
      .find((item) => /\/assets\/main-[^/]+\.js(?:$|\?)/.test(item.name));
    return entry?.name ?? null;
  };

  const loadSpotLight = async () => {
    const started = performance.now();
    let url = mainModuleUrl();
    while (!url && performance.now() - started < 15000) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      url = mainModuleUrl();
    }
    if (!url) throw new Error("3place main module was not found");
    const module = await import(url);
    const SpotLight = module.c;
    if (typeof SpotLight !== "function") {
      throw new Error("3place SpotLight export was not found");
    }
    const probe = new SpotLight(0xffffff, 1, 1, Math.PI / 4, 0.5, 1);
    if (!probe.isSpotLight) throw new Error("3place light export changed");
    probe.dispose?.();
    return SpotLight;
  };

  const ensureHeadlight = (scene) => {
    if (headlight && headlightScene === scene) return Promise.resolve(headlight);
    if (headlightPromise) return headlightPromise;
    headlightPromise = loadSpotLight()
      .then((SpotLight) => {
        if (headlight && headlightScene) {
          headlightScene.remove(headlight, headlight.target);
          headlight.dispose?.();
        }
        headlight = new SpotLight(
          0xfff3d2,
          lightIntensity(),
          32,
          Math.PI / 5,
          0.58,
          1.25,
        );
        headlight.name = "mcwalk-helmet-light";
        headlight.castShadow = false;
        headlight.visible = false;
        headlight.target.name = "mcwalk-helmet-light-target";
        scene.add(headlight, headlight.target);
        headlightScene = scene;
        setStatus("ready");
        return headlight;
      })
      .catch((error) => {
        console.warn("3place Pathfinder headlight unavailable", error);
        setStatus("light-unavailable");
        return null;
      })
      .finally(() => {
        headlightPromise = null;
      });
    return headlightPromise;
  };

  const syncHeadlight = (scene, camera) => {
    const enabled =
      setting("mcwalkEnabled", setting("mcwalkActive")) &&
      firstPersonIsActuallyActive() &&
      setting("mcwalkHeadlight", true);
    if (!enabled) {
      if (headlight) headlight.visible = false;
      return;
    }
    if (!headlight || headlightScene !== scene) {
      void ensureHeadlight(scene);
      return;
    }
    const forward = camera.getWorldDirection(camera.position.clone());
    headlight.visible = true;
    headlight.intensity = lightIntensity();
    headlight.position.copy(camera.position).addScaledVector(forward, 0.12);
    headlight.target.position
      .copy(camera.position)
      .addScaledVector(forward, 14);
    headlight.target.updateMatrixWorld(true);
    headlight.updateMatrixWorld(true);
  };

  const loadSelfUserId = () => {
    if (selfUserId !== undefined) return;
    selfUserId = null;
    fetch("/api/me", {
      headers: { accept: "application/json" },
      credentials: "same-origin",
    })
      .then((response) => (response.ok ? response.json() : null))
      .then((account) => {
        selfUserId = Number.isSafeInteger(account?.userId)
          ? account.userId
          : null;
      })
      .catch(() => {
        selfUserId = null;
      });
  };

  const hideOtherHeadlights = () => {
    for (const record of otherHeadlights.values()) record.light.visible = false;
  };

  const removeOtherHeadlight = (key, record) => {
    record.scene.remove(record.light, record.light.target);
    record.light.dispose?.();
    otherHeadlights.delete(key);
  };

  const ensureOtherHeadlight = (scene, key) => {
    const current = otherHeadlights.get(key);
    if (current?.scene === scene) return current;
    if (current) removeOtherHeadlight(key, current);
    if (!headlight?.isSpotLight) return null;
    const light = new headlight.constructor(
      0xfff3d2,
      Math.max(15, lightIntensity() * 0.65),
      26,
      Math.PI / 6,
      0.65,
      1.3,
    );
    light.name = `mcwalk-player-light-${key}`;
    light.target.name = `mcwalk-player-light-target-${key}`;
    light.castShadow = false;
    light.visible = false;
    scene.add(light, light.target);
    const record = { light, scene, lastSeen: performance.now() };
    otherHeadlights.set(key, record);
    return record;
  };

  const syncOtherHeadlights = (scene, camera) => {
    const enabled =
      setting("mcwalkEnabled", setting("mcwalkActive")) &&
      setting("mcwalkHeadlight", true);
    if (!enabled) {
      hideOtherHeadlights();
      return;
    }
    if (!headlight || headlightScene !== scene) {
      hideOtherHeadlights();
      void ensureHeadlight(scene);
      return;
    }

    loadSelfUserId();
    const root = scene.getObjectByName("presence-avatars");
    if (!root) {
      hideOtherHeadlights();
      return;
    }

    root.updateMatrixWorld(true);
    const cameraPosition = camera.getWorldPosition(camera.position.clone());
    const exactSelfName = Number.isSafeInteger(selfUserId)
      ? `presence-avatar-${selfUserId}`
      : null;
    let fallbackSelf = null;
    let fallbackScore = 1.6;
    const candidates = [];

    for (const avatar of root.children) {
      if (!avatar.visible || !avatar.name?.startsWith("presence-avatar-")) {
        continue;
      }
      const position = avatar.getWorldPosition(camera.position.clone());
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
        activeCount >= MAX_OTHER_HEADLIGHTS ||
        avatar.name === exactSelfName ||
        avatar === fallbackSelf
      ) {
        continue;
      }
      const gaze = avatar.getObjectByName("presence-gaze");
      if (!gaze) continue;
      const origin = gaze.getWorldPosition(camera.position.clone());
      const worldQuaternion = gaze.getWorldQuaternion(camera.quaternion.clone());
      const direction = camera.position
        .clone()
        .set(0, 0, 1)
        .applyQuaternion(worldQuaternion)
        .normalize();
      if (
        ![origin.x, origin.y, origin.z, direction.x, direction.y, direction.z]
          .every(Number.isFinite)
      ) {
        continue;
      }
      const record = ensureOtherHeadlight(scene, avatar.name);
      if (!record) continue;
      record.lastSeen = performance.now();
      record.light.visible = true;
      record.light.intensity = Math.max(15, lightIntensity() * 0.65);
      record.light.position.copy(origin).addScaledVector(direction, 0.18);
      record.light.target.position.copy(origin).addScaledVector(direction, 12);
      record.light.target.updateMatrixWorld(true);
      record.light.updateMatrixWorld(true);
      activeKeys.add(avatar.name);
      activeCount += 1;
    }

    const now = performance.now();
    for (const [key, record] of otherHeadlights) {
      if (activeKeys.has(key)) continue;
      record.light.visible = false;
      if (now - record.lastSeen > 10000) removeOtherHeadlight(key, record);
    }
  };

  const attachRenderer = (renderer) => {
    if (renderer.__mcwalkWrapped) return;
    renderer.__mcwalkWrapped = true;
    const originalRender = renderer.render;
    renderer.render = function (scene, camera) {
      const isStreet =
        renderer === streetRenderer ||
        Boolean(renderer.domElement?.closest?.("#streetWrap"));
      if (!isStreet || !scene?.isScene || !camera?.isCamera) {
        return originalRender.call(this, scene, camera);
      }
      streetRenderer = renderer;
      streetScene = scene;
      syncHeadlight(scene, camera);
      syncOtherHeadlights(scene, camera);
      return originalRender.call(this, scene, camera);
    };
  };

  devtools.addEventListener("observe", (event) => {
    const object = event.detail;
    if (object?.isWebGLRenderer) {
      observedRenderers.add(object);
      attachRenderer(object);
    }
  });

  const attachTimer = setInterval(() => {
    for (const renderer of observedRenderers) attachRenderer(renderer);
    if (streetRenderer && streetScene) {
      document.documentElement.dataset.mcwalk3dHooked = "true";
      clearInterval(attachTimer);
    }
  }, 100);

  addEventListener("pagehide", () => {
    clearInterval(attachTimer);
    if (headlight && headlightScene) {
      headlightScene.remove(headlight, headlight.target);
      headlight.dispose?.();
    }
    for (const [key, record] of otherHeadlights) {
      removeOtherHeadlight(key, record);
    }
  });

  setStatus("connecting");
})();
