import { installPageBridge } from "./page-bridge.js";
import { installPathfinderApp } from "./pathfinder-app.js";
import { repairBrokenCameraHash } from "./startup.js";

repairBrokenCameraHash();
installPageBridge();
installPathfinderApp();
