/// <reference types="chrome"/>

// Background service worker for Multi-Platform Audio Compressor

interface CompressionMessage {
	type: "TOGGLE_COMPRESSION";
	compress: boolean;
}

interface IconMessage {
	type: "UPDATE_ICON";
	compress: boolean;
}

interface StorageResult {
	compress?: boolean;
}

// 獲取當前壓縮狀態
function getCompressionState(): Promise<boolean> {
	return new Promise((resolve) => {
		chrome.storage.local.get(["compress"], (result: StorageResult) => {
			resolve(result.compress ?? false);
		});
	});
}

// 設定壓縮狀態
function setCompressionState(compress: boolean): Promise<void> {
	return new Promise((resolve) => {
		chrome.storage.local.set({ compress }, () => {
			resolve();
		});
	});
}

// 更新 ActionButton 圖示狀態
function updateActionButtonIcon(compress: boolean): void {
	// 根據命名邏輯：compress=true 時使用無後綴，compress=false 時使用 -off 後綴
	const iconSuffix = compress ? "" : "-off";

	// 設定圖示狀態 - 使用 chrome.runtime.getURL 獲取正確的 URL
	const iconPaths = {
		16: chrome.runtime.getURL(`assets/icons/16${iconSuffix}.png`),
		24: chrome.runtime.getURL(`assets/icons/24${iconSuffix}.png`),
		32: chrome.runtime.getURL(`assets/icons/32${iconSuffix}.png`),
		48: chrome.runtime.getURL(`assets/icons/48${iconSuffix}.png`),
		64: chrome.runtime.getURL(`assets/icons/64${iconSuffix}.png`),
		128: chrome.runtime.getURL(`assets/icons/128${iconSuffix}.png`),
		256: chrome.runtime.getURL(`assets/icons/256${iconSuffix}.png`),
		512: chrome.runtime.getURL(`assets/icons/512${iconSuffix}.png`),
	};

	chrome.action.setIcon({
		path: iconPaths,
	});

	// 移除 badge，改用圖示表示狀態
	chrome.action.setBadgeText({ text: "" });

	// 設定標題
	chrome.action.setTitle({
		title: compress ? "Audio Compression: ON" : "Audio Compression: OFF",
	});
}

// 向所有 tab 發送狀態變更訊息（全域廣播）
// content-script 會根據規則匹配自行決定是否處理
async function notifyAllTabs(compress: boolean): Promise<void> {
	const tabs = await chrome.tabs.query({});

	const message: CompressionMessage = {
		type: "TOGGLE_COMPRESSION",
		compress,
	};

	for (const tab of tabs) {
		if (tab.id) {
			try {
				await chrome.tabs.sendMessage(tab.id, message);
			} catch (error) {
				// 忽略無法發送訊息的 tab（可能是頁面未載入 content script）
				console.debug("Failed to send message to tab:", tab.id, error);
			}
		}
	}
}

// ActionButton 點擊事件已移除，改用 popup UI

// 初始化：設定正確的圖示狀態
async function initializeActionButton() {
	try {
		const compress = await getCompressionState();
		updateActionButtonIcon(compress);
	} catch (error) {
		console.error("Error initializing action button:", error);
	}
}

// 擴充功能載入時初始化
chrome.runtime.onStartup.addListener(initializeActionButton);
chrome.runtime.onInstalled.addListener(initializeActionButton);

// 立即初始化（如果擴充功能已經載入）
initializeActionButton();

// 處理來自 content script 和 popup 的訊息
chrome.runtime.onMessage.addListener(
	(message: CompressionMessage | IconMessage, sender, sendResponse) => {
		if (message.type === "TOGGLE_COMPRESSION") {
			// 同步狀態到 storage 並更新 UI
			setCompressionState(message.compress).then(() => {
				updateActionButtonIcon(message.compress);
				notifyAllTabs(message.compress);
			});
		} else if (message.type === "UPDATE_ICON") {
			// 只更新圖示狀態
			updateActionButtonIcon(message.compress);
		}
		sendResponse({ success: true });
	},
);
