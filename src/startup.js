export const repairBrokenCameraHash = () => {
  const parts = location.hash.slice(1).split("/");
  if (parts.length < 5) return;
  const cameraValues = parts.slice(0, 5).map(Number);
  if (!cameraValues.every(Number.isFinite) || cameraValues[4] <= 90) return;
  parts[4] = "90";
  const repairedUrl = new URL(location.href);
  repairedUrl.hash = parts.join("/");
  window.history.replaceState(window.history.state, "", repairedUrl.href);
};
