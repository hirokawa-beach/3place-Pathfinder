<div align="center">

# 3place Pathfinder

**Enhanced movement, flexible camera controls, dynamic lighting, and media capture for [3place](https://3place.world/).**

[![Userscript v1.2.1](https://img.shields.io/badge/userscript-v1.2.1-2ea44f)](https://raw.githubusercontent.com/hirokawa-beach/3place-Pathfinder/main/dist/3place-pathfinder-v1.2.1.user.js)
![Manifest V3](https://img.shields.io/badge/Chrome-Manifest%20V3-4285F4?logo=googlechrome&logoColor=white)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)

[Install userscript](https://raw.githubusercontent.com/hirokawa-beach/3place-Pathfinder/main/dist/3place-pathfinder-v1.2.1.user.js) · [Features](#features) · [Controls](#controls) · [Development](#development) · [日本語](#日本語の概要)

</div>

> [!IMPORTANT]
> 3place Pathfinder is an unofficial community project. It is not affiliated with or endorsed by 3place.

## Overview

3place Pathfinder enhances the first-person experience on 3place without replacing its native movement physics. Walking, gravity, collision detection, and jumping continue to use 3place's own systems, while Pathfinder adds camera, lighting, capture, and convenience controls around them.

Two editions are included:

- **Userscript — recommended:** the complete feature set, distributed as a single Tampermonkey-compatible file.
- **Chrome/Edge extension:** a smaller Manifest V3 edition focused on walking, helmet lights, speed settings, and URL repair.

Do not enable both editions at the same time.

## Features

### Movement

- Start each first-person session in walking mode
- Use `Space` as a normal jump instead of vertical flight
- Double-tap `Space` to switch freely between walking and flying
- Configure movement speed from 2 to 12 blocks per second
- Automatically repair saved camera URLs whose tilt exceeds 90 degrees

### Camera and view controls

- Adjust first-person field of view
- Switch between first-person, rear third-person, and front third-person views
- Adjust third-person camera distance with the mouse wheel
- Reconstruct and display your local avatar in third-person mode
- Recover pointer-lock controls after using the paint cursor

### Lighting

- Add a real Three.js helmet spotlight aligned with your view
- Add direction-aware helmet lights to nearby players
- Limit nearby lights to the 12 closest players to reduce rendering cost
- Restore the darker nighttime appearance with **Dark Night** mode

### Photo and video capture

- Save composited PNG screenshots without the Pathfinder controls
- Record silent 30 fps video as MP4/H.264 or WebM when supported
- Select a custom capture region directly on the 3D view
- Include an optional unofficial recording credit

### Interface

- Movable on-screen launcher and settings panel
- Japanese and English UI with automatic browser-language detection
- Built-in compatibility diagnostics for 3place updates
- Persistent settings stored locally in the browser

## Edition comparison

| Feature | Userscript | Chrome/Edge extension |
| --- | :---: | :---: |
| Walking mode and jump controls | ✓ | ✓ |
| Configurable movement speed | ✓ | ✓ |
| Local and nearby-player helmet lights | ✓ | ✓ |
| Broken camera URL repair | ✓ | ✓ |
| Japanese and English UI | ✓ | ✓ |
| First-person FOV controls | ✓ | — |
| Rear/front third-person views | ✓ | — |
| Dark Night mode | ✓ | — |
| Photo and video capture | ✓ | — |
| Compatibility diagnostics | ✓ | — |

## Installation

### Userscript — recommended

1. Install [Tampermonkey](https://www.tampermonkey.net/) in Chrome, Edge, or Firefox.
2. Click **[Install 3place Pathfinder](https://raw.githubusercontent.com/hirokawa-beach/3place-Pathfinder/main/dist/3place-pathfinder-v1.2.1.user.js)**.
3. Confirm the installation in Tampermonkey.
4. Reload [3place](https://3place.world/).

Alternatively, open [`dist/3place-pathfinder-v1.2.1.user.js`](./dist/3place-pathfinder-v1.2.1.user.js), copy its contents into a new Tampermonkey script, and save it.

### Chrome/Edge extension

1. Clone or download this repository.
2. Open `chrome://extensions` in Chrome or `edge://extensions` in Edge.
3. Enable **Developer mode**.
4. Select **Load unpacked** and choose the repository folder.
5. Reload 3place.

The unpacked extension is intended for development and manual installation. Chrome Web Store distribution is not currently provided.

## Controls

| Input | Action |
| --- | --- |
| `F` or the native first-person button | Enter first-person mode |
| `W` `A` `S` `D` | Move |
| `Space` | Jump while walking |
| Double-tap `Space` | Switch between walking and flying |
| `V` or `Alt+V` | Cycle first-person → rear → front view |
| Mouse wheel | Adjust FOV or third-person distance |
| `F8` | Save a screenshot |
| `F9` | Start or stop video recording |
| `Alt+T` | Toggle helmet lights |
| `Alt+N` | Toggle Dark Night mode |

Movement-speed changes take effect after reloading the page. Language changes also reload the page so the complete interface updates consistently.

## Data and privacy

Pathfinder reads only the same-origin 3place data required for its user-facing features, including account identity, avatar information, and the 3place manifest. This is used to identify the local player, reconstruct the third-person avatar, and keep compatibility settings aligned with 3place.

- No Pathfinder analytics or tracking are included.
- No account, avatar, or capture data is sent to the developer or another external service.
- Preferences are stored locally in the browser.
- Photos and videos are created locally and saved only when requested by the user.

## Development

Requirements: [Node.js](https://nodejs.org/) 18 or newer and npm.

```powershell
npm install
npm run build
```

Useful commands:

| Command | Purpose |
| --- | --- |
| `npm run build` | Bundle the modular source into one installable userscript |
| `npm run watch` | Rebuild whenever a source file changes |
| `npm run check` | Build and validate metadata and required feature markers |

Source layout:

```text
src/
├─ i18n.js             Language detection and translations
├─ startup.js          Startup URL repair
├─ page-bridge.js      Three.js, lighting, third-person, and capture logic
├─ pathfinder-app.js   Configuration, interface, and input controls
└─ main.js             Module startup order
```

The userscript version is defined in [`package.json`](./package.json) and injected automatically into the metadata and interface during the build. Generated `.user.js` files live in [`dist/`](./dist/); edit files in `src/`, not the generated bundle.

The extension edition is maintained separately in `manifest.json`, `background.js`, `bridge.js`, `content.js`, and `styles.css`.

## Compatibility notes

Pathfinder integrates with implementation details of 3place and its Three.js scene. A 3place update may temporarily break lighting, avatar reconstruction, camera controls, or capture until the compatibility adapters are updated.

If something stops working, please open an issue with:

- Browser name and version
- Pathfinder version
- The affected feature
- Any message shown under **Compatibility** in the Pathfinder settings

## Contributing

Bug reports and pull requests are welcome. Please keep changes focused, run `npm run check`, and avoid committing `node_modules`, extension packages, private keys, or generated source maps.

## License

Released under the [MIT License](./LICENSE).

## 日本語の概要

<details>
<summary>日本語で表示</summary>

3place Pathfinderは、3placeへ歩行機能、三人称視点、ヘルメットライト、ダークナイト、静止画・動画撮影などを追加する非公式ツールです。

通常はTampermonkey版を推奨します。上部の **Install userscript** からインストールできます。Chrome/Edge拡張版とuserscript版は同時に有効化しないでください。

主な操作：

- `Space`: ジャンプ
- `Space`を素早く2回: 歩行・飛行を切り替え
- `V` / `Alt+V`: 視点切り替え
- ホイール: 視野角・三人称距離を調整
- `F8`: 静止画を保存
- `F9`: 録画開始・終了
- `Alt+T`: ライト切り替え
- `Alt+N`: ダークナイト切り替え

このプロジェクトは3place公式ではなく、3placeとの提携・承認関係もありません。

</details>
