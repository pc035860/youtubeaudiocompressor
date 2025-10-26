# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 專案概述

這是一個跨平台音訊壓縮瀏覽器擴充功能，支援 YouTube、Twitch 和 Bilibili。使用 Web Audio API 的 DynamicsCompressor 進行即時音訊處理，並提供 popup UI 控制壓縮開關和 gain 調整。

## 建置與開發指令

```bash
# 開發模式（啟用 live reload）
yarn start

# 建置開發版本
yarn build

# 建置生產版本（包含壓縮和打包）
yarn build:prod

# Linting
yarn lint
```

## 核心架構

### 三個主要 Script 模組

1. **content-script.ts** - 音訊處理核心
   - 偵測平台並選擇正確的 video selector
   - 使用 Web Audio API 建立 AudioContext、DynamicsCompressor 和 GainNode
   - 管理多個 video 元素的音訊源（sources 陣列）
   - 透過 MutationObserver 監聽新增的 video 元素
   - 接收來自 popup 和 background 的訊息以更新狀態

2. **background.ts** - Service Worker（狀態管理與圖示更新）
   - 管理全域壓縮狀態（chrome.storage.local）
   - 根據狀態更新 ActionButton 圖示（支援 ON/OFF 兩組圖示）
   - 向所有符合條件的 tab 廣播狀態變更
   - 處理來自 content-script 和 popup 的訊息

3. **popup.ts** - Popup UI 控制介面
   - 提供開關按鈕切換壓縮狀態
   - 提供 slider 控制 gain 值（0.0 到 2.0）
   - 同步狀態到 storage 並通知 background 和 content-scripts

### 訊息傳遞架構

- **TOGGLE_COMPRESSION**: 切換壓縮開關（popup → background → content-script）
- **UPDATE_GAIN**: 更新 gain 值（popup → content-script）
- **UPDATE_ICON**: 更新圖示狀態（content-script/popup → background）

### 平台支援機制

使用 `getCurrentPlatform()` 和 `getVideoSelector()` 識別平台並返回對應的 video selector：
- YouTube: `'video'`
- Twitch: `'video[data-a-player-type], video'`
- Bilibili: `'video'`

### 音訊處理參數

DynamicsCompressor 預設值（content-script.ts:49-53）：
- threshold: -50dB
- knee: 40dB
- ratio: 12:1
- attack: 0s
- release: 0.25s

## 建置工具鏈

- **Rollup** - 打包工具（entry: src/manifest.json）
- **TypeScript** - 語言
- **Biome** - Linting 工具
- **rollup-plugin-chrome-extension** - 處理 manifest.json 和擴充功能資源

## 圖示管理

專案包含兩組圖示：
- 預設圖示（16.png, 24.png, ..., 512.png）- 壓縮開啟狀態
- Off 狀態圖示（16-off.png, 24-off.png, ..., 512-off.png）- 壓縮關閉狀態

background.ts 根據 compress 狀態動態切換圖示。

## 多平台支援注意事項

此專案同時支援 Chrome 和 Firefox：
- Manifest V3 格式
- 包含 `browser_specific_settings.gecko` 設定 Firefox extension ID
- 使用標準 Chrome Extension APIs（chrome.storage, chrome.runtime, chrome.tabs, chrome.action）

## 重要技術細節

1. **Content Script 注入時機**: `run_at: "document_start"` 確保在頁面載入早期注入
2. **初始化策略**: 使用三重機制（立即執行、DOMContentLoaded、window.load）確保不遺漏 video 元素
3. **音訊源管理**: 每個 video 元素對應一個 AudioContext 和相關節點，儲存在 sources 陣列中
4. **狀態同步**: 使用 chrome.storage.local 作為真實來源，確保多個 component 間狀態一致
