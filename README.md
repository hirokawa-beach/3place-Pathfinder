<div align="center">

# 3place Pathfinder

**Camera controls, dynamic lighting, capture tools, and first-person conveniences for [3place](https://3place.world/).**

[![Userscript v1.4.0](https://img.shields.io/badge/userscript-v1.4.0-2ea44f)](https://raw.githubusercontent.com/hirokawa-beach/3place-Pathfinder/main/dist/3place-pathfinder-v1.4.0.user.js)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)

[Install userscript](https://raw.githubusercontent.com/hirokawa-beach/3place-Pathfinder/main/dist/3place-pathfinder-v1.4.0.user.js) · [Features](#features) · [Third-person](#third-person-view) · [Controls](#controls) · [Development](#development) · [日本語](#日本語の概要)

</div>

> [!IMPORTANT]
> 3place Pathfinder is an unofficial community project. It is not affiliated with or endorsed by 3place.

## Overview

3place Pathfinder builds on the current 3place experience rather than replacing it. Walking, gravity, collision detection, jumping, and the walking/flight toggle are all native 3place features. Pathfinder automatically selects native walking mode on entry, then adds camera, lighting, live capture, and compatibility conveniences around it.

3place also provides its own movement-speed setting, Nearby panel, Showcase photo workflow, Replay video export, dynamic sky, and pointer-lock recovery. Pathfinder leaves those official controls intact. Its capture tools are designed for quick captures of the current Pathfinder view and live, player-controlled recording.

Pathfinder is distributed as a single Tampermonkey-compatible userscript.

## Features

### First-person convenience

- Automatically start each first-person session in 3place's native walking mode
- Keep the native `Space` jump and double-`Space` walking/flight toggle unchanged

### Camera and view controls

- Switch between first-person, rear third-person, and front third-person views
- Adjust third-person camera distance with `Alt` + mouse wheel
- Reconstruct and display your local avatar in third-person mode
- Automatically use the official first-person view while Paint is active

### Lighting

- Add a real Three.js helmet spotlight aligned with your view
- Add direction-aware helmet lights to nearby players
- Limit nearby lights to the closest 4 players in quality mode and 2 in balanced mode
- Disable 3place's nighttime visibility correction with **Dark Night** mode

### Photo and video capture

- Quick-save the current Pathfinder view, including third-person views, as a composited PNG without controls
- Record the live, player-controlled current view as silent 30 fps MP4/H.264 or WebM when supported
- Select a custom capture region directly on the 3D view
- Include an optional unofficial recording credit

### Interface

- Movable on-screen launcher and settings panel
- Follow 3place's official UI visibility toggle, including the `H` shortcut
- Leave the current official Nearby roster and area view unmodified
- Quality, balanced, and performance profiles for Pathfinder-only rendering costs without changing 3place's official graphics settings
- Japanese and English Pathfinder UI with automatic browser-language detection
- Built-in compatibility diagnostics for 3place updates
- Persistent settings stored locally in the browser

## Third-person view

Pathfinder's third-person camera runs on top of an active 3place first-person session. Enter first-person mode normally, then press `V` or `Alt+V` to cycle through **first-person → rear → front**. Movement, collision detection, jumping, and flying continue to use 3place's native controls and physics.

- **Rear view** follows your avatar from behind for movement and exploration.
- **Front view** faces your avatar and is useful for portraits and live capture.
- Pathfinder uses your existing presence avatar when available, or reconstructs your local avatar from same-origin 3place account and avatar data.
- Camera distance can be adjusted from the settings panel or with `Alt` + mouse wheel while third-person is active.
- Pathfinder temporarily renders the official first-person view while Paint is active so the current official paint ray and wheel controls remain authoritative.
- Pathfinder photos and live video recordings can use either rear or front third-person view, including the displayed local avatar.

## Installation

1. Install [Tampermonkey](https://www.tampermonkey.net/) in Chrome, Edge, or Firefox.
2. Click **[Install 3place Pathfinder](https://raw.githubusercontent.com/hirokawa-beach/3place-Pathfinder/main/dist/3place-pathfinder-v1.4.0.user.js)**.
3. Confirm the installation in Tampermonkey.
4. Reload [3place](https://3place.world/).

Alternatively, open [`dist/3place-pathfinder-v1.4.0.user.js`](./dist/3place-pathfinder-v1.4.0.user.js), copy its contents into a new Tampermonkey script, and save it.

## Controls

The movement inputs below are native 3place controls. Pathfinder preserves them and adds the view, lighting, and capture shortcuts.

| Input | Action |
| --- | --- |
| `F` or the native first-person button | Enter first-person mode |
| `W` `A` `S` `D` | Move |
| `Space` | Jump while walking |
| Double-tap `Space` | Switch between walking and flying |
| `V` or `Alt+V` | Cycle first-person → rear → front view |
| `Alt` + mouse wheel | Adjust third-person distance |
| `F8` | Save a screenshot |
| `F9` | Start or stop video recording |
| `Alt+T` | Toggle helmet lights |
| `Alt+N` | Toggle Dark Night mode |

Movement speed remains available through 3place's own settings. Language changes reload the page so the complete Pathfinder interface updates consistently.

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
├─ page-bridge.js      Three.js, lighting, third-person, and capture logic
├─ pathfinder-app.js   Configuration, interface, and input controls
└─ main.js             Module startup order
```

The userscript version is defined in [`package.json`](./package.json) and injected automatically into the metadata and interface during the build. Generated `.user.js` files live in [`dist/`](./dist/); edit files in `src/`, not the generated bundle.

## Compatibility notes

Pathfinder integrates with implementation details of 3place and its Three.js scene. A 3place update may temporarily break lighting, avatar reconstruction, camera controls, or capture until the compatibility adapters are updated.

If something stops working, please open an issue with:

- Browser name and version
- Pathfinder version
- The affected feature
- Any message shown under **Compatibility** in the Pathfinder settings

## Contributing

Bug reports and pull requests are welcome. Please keep changes focused, run `npm run check`, and avoid committing `node_modules`, release archives, private keys, or generated source maps.

## License

Released under the [MIT License](./LICENSE).

## 日本語の概要

<details>
<summary>日本語で表示</summary>

3place Pathfinderは、3place標準の一人称モードを歩行で開始し、三人称視点、ヘルメットライト、ダークナイト、静止画・動画撮影などを追加する非公式ツールです。歩行・重力・ジャンプ・飛行切り替えは3place本体の機能をそのまま利用し、移動速度も3place標準設定に任せます。

静止画・動画機能は、3place標準のShowcase撮影やReplay書き出しを置き換えるものではありません。Pathfinderで表示している一人称・三人称視点のクイック撮影と、現在の操作をそのまま記録するライブ録画を目的としています。

### 三人称視点

3place標準の一人称モードへ入った状態で、`V`または`Alt+V`を押すと「一人称 → 三人称・後方 → 三人称・正面」の順に切り替わります。移動・衝突判定・ジャンプ・飛行は引き続き3place本体の機能を利用します。

- 後方視点は移動や探索向け、正面視点はアバター撮影向けです。
- 自分のアバターが3D空間に存在しない場合は、3place内のアカウント・アバターデータからローカル表示を再構築します。
- 三人称中は設定画面またはマウスホイールでカメラ距離を変更できます。
- 建物がカメラとの間に入ると自動的に距離を縮め、障害物がなくなると滑らかに元の距離へ戻します。
- 後方視点では画面上のカーソル位置を使ってペイントでき、ペイント終了後は一人称の視点操作へ復帰します。このペイント補助は現在、後方視点のみ対応です。
- 後方・正面視点は、Pathfinderの静止画撮影とライブ録画にもそのまま使用できます。

Tampermonkeyへ上部の **Install userscript** からインストールして利用します。

主な操作（移動関連は3place標準）：

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
