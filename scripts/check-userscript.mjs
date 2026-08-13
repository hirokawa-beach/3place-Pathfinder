import { readFile } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const packageJson = JSON.parse(
  await readFile(path.join(root, "package.json"), "utf8"),
);
const outputPath = path.join(
  root,
  "dist",
  `3place-pathfinder-v${packageJson.version}.user.js`,
);
const output = await readFile(outputPath, "utf8");

const requirements = [
  [output.startsWith("// ==UserScript=="), "metadata header must be first"],
  [output.includes(`// @version      ${packageJson.version}`), "version must match"],
  [output.includes("// @grant        none"), "grant metadata is required"],
  [output.includes("https://3place.world/*"), "3place match rule is required"],
  [output.includes("__mcwalk3dBridgeInstalled"), "3D bridge is missing"],
  [output.includes("mcwalk-userscript"), "Pathfinder UI is missing"],
  [
    output.includes("pathfinder-nearby-state") &&
      output.includes("pathfinder-presence-snapshot") &&
      output.includes("nearbyPlayers") &&
      output.includes("pathfinder-nearby-detail") &&
      output.includes("pathfinder-nearby-navigation") &&
      output.includes("pathfinder-nav-compass") &&
      output.includes("pathfinder-nav-alt-marker") &&
      output.includes("nearbyCompactMedia") &&
      output.includes("compactNearbyUi") &&
      output.includes("PRESENCE_SNAPSHOT_INSPECT_INTERVAL_MS") &&
      output.includes("MAX_NEARBY_ROWS = 16"),
    "Official Nearby list and navigation enhancements are missing",
  ],
  [
    output.includes("pathfinderGraphicsProfile") &&
      output.includes("Pathfinder graphics") &&
      output.includes("maxOtherPlayerLights"),
    "Pathfinder graphics settings are missing",
  ],
  [
    output.includes("pathfinder-official-legacy-change") &&
      output.includes("3place-paint-controls-v1") &&
      output.includes("pathfinder-legacy-paint-dock") &&
      output.includes("Touch uses Orbit controls") &&
      output.includes("grid-template-columns: 44px repeat(3") &&
      output.includes("Restore official UI and controls from Aug 12"),
    "Official Aug 12 legacy UI and controls are missing",
  ],
  [
    output.includes("3place.world") &&
      output.includes("recording by 3place Pathfinder(unofficial)"),
    "capture credits are missing",
  ],
  [
    output.includes(".space-backdrop, #mapWrap canvas") &&
      output.includes("basemap.triggerRepaint()") &&
      output.includes("CAMERA_BASEMAP_RENDER_TIMEOUT_MS"),
    "ocean/sky capture synchronization is missing",
  ],
  [
    output.includes("#pathfinder-camera-crop .crop-box") &&
      output.includes("#pathfinder-camera-crop .crop-resize"),
    "capture-area selector styles are missing",
  ],
  [
    !output.includes("3place-fly-speed-v1"),
    "removed movement-speed adapter is still present",
  ],
  [output.includes('new Set(["auto", "ja", "en"])'), "languages are missing"],
];

const failures = requirements.filter(([passed]) => !passed);
if (failures.length) {
  throw new Error(failures.map(([, message]) => message).join("\n"));
}

console.log(`Userscript check passed: ${path.relative(root, outputPath)}`);
