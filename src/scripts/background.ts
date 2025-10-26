/// <reference types="chrome"/>

// Background service worker for Multi-Platform Audio Compressor

interface CompressionMessage {
	type: 'TOGGLE_COMPRESSION';
	compress: boolean;
}

interface StorageResult {
	compress?: boolean;
}

// 獲取當前壓縮狀態
function getCompressionState(): Promise<boolean> {
	return new Promise((resolve) => {
		chrome.storage.local.get(['compress'], (result: StorageResult) => {
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
	// 設定 badge 來顯示狀態
	chrome.action.setBadgeText({
		text: compress ? 'ON' : 'OFF'
	});
	chrome.action.setBadgeBackgroundColor({
		color: compress ? '#4CAF50' : '#9E9E9E'
	});
	
	// 設定標題
	chrome.action.setTitle({
		title: compress ? 'Audio Compression: ON' : 'Audio Compression: OFF'
	});
}

// 向所有支援的 tab 發送狀態變更訊息
async function notifyAllTabs(compress: boolean): Promise<void> {
	const tabs = await chrome.tabs.query({
		url: [
			'https://www.youtube.com/*',
			'https://www.twitch.tv/*',
			'https://www.bilibili.com/*'
		]
	});

	const message: CompressionMessage = {
		type: 'TOGGLE_COMPRESSION',
		compress
	};

	for (const tab of tabs) {
		if (tab.id) {
			try {
				await chrome.tabs.sendMessage(tab.id, message);
			} catch (error) {
				// 忽略無法發送訊息的 tab（可能是頁面未載入 content script）
				console.debug('Failed to send message to tab:', tab.id, error);
			}
		}
	}
}

// 監聽 ActionButton 點擊事件
chrome.action.onClicked.addListener(async (tab) => {
	try {
		const currentState = await getCompressionState();
		const newState = !currentState;
		
		await setCompressionState(newState);
		updateActionButtonIcon(newState);
		await notifyAllTabs(newState);
	} catch (error) {
		console.error('Error toggling compression:', error);
	}
});

// 初始化：設定正確的圖示狀態
async function initializeActionButton() {
	try {
		const compress = await getCompressionState();
		updateActionButtonIcon(compress);
	} catch (error) {
		console.error('Error initializing action button:', error);
	}
}

// 擴充功能載入時初始化
chrome.runtime.onStartup.addListener(initializeActionButton);
chrome.runtime.onInstalled.addListener(initializeActionButton);

// 立即初始化（如果擴充功能已經載入）
initializeActionButton();

// 處理來自 content script 的訊息
chrome.runtime.onMessage.addListener((message: CompressionMessage, sender, sendResponse) => {
	if (message.type === 'TOGGLE_COMPRESSION') {
		// 同步狀態到 storage 並更新 UI
		setCompressionState(message.compress).then(() => {
			updateActionButtonIcon(message.compress);
			notifyAllTabs(message.compress);
		});
	}
	sendResponse({ success: true });
});
