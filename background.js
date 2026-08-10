"use strict";

const repair3placeUrl = (urlText) => {
  try {
    const url = new URL(urlText);
    if (url.protocol !== "https:" || url.hostname !== "3place.world") {
      return null;
    }
    const parts = url.hash.slice(1).split("/");
    if (parts.length < 5) return null;
    const cameraValues = parts.slice(0, 5).map(Number);
    if (!cameraValues.every(Number.isFinite) || cameraValues[4] <= 90) {
      return null;
    }
    parts[4] = "90";
    url.hash = parts.join("/");
    return url.href;
  } catch {
    return null;
  }
};

chrome.webNavigation.onBeforeNavigate.addListener(
  (details) => {
    if (details.frameId !== 0) return;
    const repairedUrl = repair3placeUrl(details.url);
    if (repairedUrl) {
      void chrome.tabs.update(details.tabId, { url: repairedUrl });
    }
  },
  {
    url: [{ schemes: ["https"], hostEquals: "3place.world" }],
  },
);
