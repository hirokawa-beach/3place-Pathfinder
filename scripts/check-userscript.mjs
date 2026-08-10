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
  [output.includes('new Set(["auto", "ja", "en"])'), "languages are missing"],
];

const failures = requirements.filter(([passed]) => !passed);
if (failures.length) {
  throw new Error(failures.map(([, message]) => message).join("\n"));
}

console.log(`Userscript check passed: ${path.relative(root, outputPath)}`);
