/// <reference types="chrome"/>

import { SUPPORTED_DOMAINS } from "./constants";

interface StorageData {
	compress?: boolean;
	gain?: number;
}

interface CompressionMessage {
	type: "TOGGLE_COMPRESSION";
	compress: boolean;
}

interface GainMessage {
	type: "UPDATE_GAIN";
	gain: number;
}

interface IconMessage {
	type: "UPDATE_ICON";
	compress: boolean;
}

// DOM 元素
const toggleBtn = document.getElementById("toggleBtn") as HTMLButtonElement;
const toggleText = toggleBtn.querySelector(".toggle-text") as HTMLSpanElement;
const gainSlider = document.getElementById("gainSlider") as HTMLInputElement;
const gainValue = document.getElementById("gainValue") as HTMLSpanElement;
const statusText = document.getElementById("statusText") as HTMLSpanElement;

// 從 storage 讀取設定
async function getSettings(): Promise<{ compress: boolean; gain: number }> {
	return new Promise((resolve) => {
		chrome.storage.local.get(["compress", "gain"], (result: StorageData) => {
			resolve({
				compress: result.compress ?? false,
				gain: result.gain ?? 1.0,
			});
		});
	});
}

// 儲存設定到 storage
async function setSettings(compress: boolean, gain: number): Promise<void> {
	return new Promise((resolve) => {
		chrome.storage.local.set({ compress, gain }, () => {
			resolve();
		});
	});
}

// 更新 UI 狀態
function updateUI(compress: boolean, gain: number): void {
	// 更新開關按鈕
	toggleBtn.classList.toggle("active", compress);
	toggleText.textContent = compress ? "ON" : "OFF";

	// 更新 gain slider
	gainSlider.value = gain.toString();
	gainValue.textContent = gain.toFixed(1);

	// 更新狀態文字
	statusText.textContent = compress
		? `Compression ON (Gain: ${gain.toFixed(1)})`
		: "Compression OFF";
}

// 通知 background script 更新圖示狀態
async function notifyBackground(compress: boolean): Promise<void> {
	try {
		const message: IconMessage = {
			type: "UPDATE_ICON",
			compress: compress,
		};
		await chrome.runtime.sendMessage(message);
	} catch (error) {
		console.error("Error notifying background:", error);
	}
}

// 通知所有支援的 tab
async function notifyTabs(
	message: CompressionMessage | GainMessage,
): Promise<void> {
	try {
		const tabs = await chrome.tabs.query({
			url: SUPPORTED_DOMAINS,
		});

		for (const tab of tabs) {
			if (tab.id) {
				try {
					await chrome.tabs.sendMessage(tab.id, message);
				} catch (error) {
					// 忽略無法發送訊息的 tab
					console.debug("Failed to send message to tab:", tab.id, error);
				}
			}
		}
	} catch (error) {
		console.error("Error notifying tabs:", error);
	}
}

// 處理開關按鈕點擊
async function handleToggleClick(): Promise<void> {
	try {
		const settings = await getSettings();
		const newCompress = !settings.compress;

		await setSettings(newCompress, settings.gain);
		updateUI(newCompress, settings.gain);

		// 通知 background script 更新圖示
		await notifyBackground(newCompress);

		// 通知 content scripts
		await notifyTabs({
			type: "TOGGLE_COMPRESSION",
			compress: newCompress,
		});

		statusText.textContent = newCompress
			? "Compression enabled"
			: "Compression disabled";
	} catch (error) {
		console.error("Error toggling compression:", error);
		statusText.textContent = "Error occurred";
	}
}

// 處理 gain slider 變更
async function handleGainChange(): Promise<void> {
	try {
		const gain = Number.parseFloat(gainSlider.value);
		const settings = await getSettings();

		await setSettings(settings.compress, gain);
		updateUI(settings.compress, gain);

		// 通知 content scripts
		await notifyTabs({
			type: "UPDATE_GAIN",
			gain: gain,
		});

		statusText.textContent = `Gain updated to ${gain.toFixed(1)}`;
	} catch (error) {
		console.error("Error updating gain:", error);
		statusText.textContent = "Error updating gain";
	}
}

// 初始化
async function initialize(): Promise<void> {
	try {
		const settings = await getSettings();
		updateUI(settings.compress, settings.gain);
		statusText.textContent = "Ready";
	} catch (error) {
		console.error("Error initializing popup:", error);
		statusText.textContent = "Initialization error";
	}
}

// 事件監聽器
toggleBtn.addEventListener("click", handleToggleClick);
gainSlider.addEventListener("input", handleGainChange);

// 初始化
document.addEventListener("DOMContentLoaded", initialize);
