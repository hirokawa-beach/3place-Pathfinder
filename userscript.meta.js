// ==UserScript==
// @name         3place Pathfinder
// @name:ja      3place Pathfinder
// @name:en      3place Pathfinder
// @namespace    https://hirokawa-beach.github.io/
// @version      __VERSION__
// @description  3place標準の歩行モードを自動選択し、三人称視点、照明、ライブ撮影を追加します。自分のユーザーID確認と三人称アバター表示のため、3place内のアカウント情報、アバターデータ、マニフェストを同一オリジンAPIから読み取ります。取得内容を外部へ送信しません。
// @description:ja 3place標準の歩行モードを自動選択し、三人称視点、照明、ライブ撮影を追加します。自分のユーザーID確認と三人称アバター表示のため、3place内のアカウント情報、アバターデータ、マニフェストを同一オリジンAPIから読み取ります。取得内容を外部へ送信しません。
// @description:en Builds on 3place's native movement with automatic walking-mode entry, third-person views, lighting, and live capture. It reads same-origin 3place account, avatar, and manifest data to identify your user and render your third-person avatar. No data is sent externally.
// @author       ひろかわびーち
// @match        https://3place.world/*
// @run-at       document-start
// @grant        none
// ==/UserScript==
