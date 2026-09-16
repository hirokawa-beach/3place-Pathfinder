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
  [
    output.includes("discoverThreeModuleUrls") &&
      output.includes('link[rel="modulepreload"][href]') &&
      output.includes('script[type="module"][src]'),
    "split Three.js module discovery is missing",
  ],
  [output.includes("mcwalk-userscript"), "Pathfinder UI is missing"],
  [
    output.includes("workshopCameraBtn") &&
      output.includes("workshopMovementBtn") &&
      output.includes("switch to walking") &&
      output.includes("switch to flying"),
    "Current official first-person controls adapter is missing",
  ],
  [
    output.includes("pathfinderGraphicsProfile") &&
      output.includes("Pathfinder graphics") &&
      output.includes("maxOtherPlayerLights"),
    "Pathfinder graphics settings are missing",
  ],
  [
    output.includes("pathfinderOfficialUiHidden") &&
      output.includes("data-game-ui-hidden") &&
      output.includes("paint-paused") &&
      output.includes("!event.altKey"),
    "Current official UI compatibility handling is missing",
  ],
  [
    !output.includes("Restore official UI and controls from Aug 12") &&
      !output.includes("installPresenceSocketObserver();"),
    "Removed legacy UI or WebSocket interception is still active",
  ],
  [
    output.includes("3place.world") &&
      output.includes("recording by 3place Pathfinder(unofficial)"),
    "capture credits are missing",
  ],
  [
    output.includes(".space-backdrop, #mapWrap canvas") &&
      output.includes("cameraCaptureMetrics"),
    "current-view capture composition is missing",
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
