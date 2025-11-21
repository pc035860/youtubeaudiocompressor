/// <reference types="chrome"/>

import { getMatchedRule } from "./domain-rules";
import type { DomainRule } from "./domain-rules";

// 當前匹配的網域規則
let currentRule: DomainRule | null = null;

// 快取壓縮狀態，避免 Observer 頻繁讀取 storage
let compressState = false;

// 使用 Map 管理 video 元素與音訊處理鏈的對應關係
// 優勢：1) 不修改 DOM 屬性 2) 可遍歷（用於 disable/updateGain）3) 可主動清理
interface AudioEntry {
	source: MediaElementAudioSourceNode;
	compression: DynamicsCompressorNode;
	gainNode: GainNode;
	context: AudioContext;
	isActive: boolean;
}

const videoAudioMap = new Map<HTMLVideoElement, AudioEntry>();

function connectCompressionChain(entry: AudioEntry) {
	const { source, compression, gainNode, context } = entry;
	try {
		source.disconnect();
	} catch (error) {
		// 忽略斷開錯誤
	}
	try {
		compression.disconnect();
	} catch (error) {
		// 忽略斷開錯誤
	}
	try {
		gainNode.disconnect();
	} catch (error) {
		// 忽略斷開錯誤
	}

	source.connect(compression);
	compression.connect(gainNode);
	gainNode.connect(context.destination);
	entry.isActive = true;
}

function bypassCompressionChain(entry: AudioEntry) {
	const { source, compression, gainNode, context } = entry;
	try {
		source.disconnect();
	} catch (error) {
		// 忽略斷開錯誤
	}
	try {
		compression.disconnect();
	} catch (error) {
		// 忽略斷開錯誤
	}
	try {
		gainNode.disconnect();
	} catch (error) {
		// 忽略斷開錯誤
	}

	source.connect(context.destination);
	entry.isActive = false;
}

// 統一處理現有的 video 元素（防重複）
function processExistingVideos(compress: boolean) {
	if (!currentRule) {
		return; // 沒有匹配的規則，不處理
	}

	const existingVideos = document.querySelectorAll(currentRule.selector);
	for (let i = 0; i < existingVideos.length; i++) {
		const video = existingVideos[i] as HTMLVideoElement;
		if (video instanceof HTMLVideoElement) {
			if (compress) {
				// 檢查是否已處理過（使用 Map）
				if (!videoAudioMap.has(video)) {
					compressVideoNode(video);
				}
			}
		}
	}
}

// 清理單個 video 元素的音訊資源
function cleanupVideoAudio(video: HTMLVideoElement) {
	const entry = videoAudioMap.get(video);
	if (!entry) return;

	const { source, compression, gainNode, context } = entry;
	try {
		source.disconnect();
	} catch (error) {
		// 忽略清理錯誤
	}
	try {
		compression.disconnect();
	} catch (error) {
		// 忽略清理錯誤
	}
	try {
		gainNode.disconnect();
	} catch (error) {
		// 忽略清理錯誤
	}

	context.close().catch(() => undefined);
	videoAudioMap.delete(video);
}

// 清理所有音訊資源
function cleanupAllAudioResources() {
	for (const [video, entry] of videoAudioMap) {
		cleanupVideoAudio(video);
	}
	videoAudioMap.clear();
}

async function compressVideoNode(node: HTMLVideoElement) {
	// 檢查是否已經處理過這個 video 元素（使用 Map）
	const existingEntry = videoAudioMap.get(node);
	if (existingEntry) {
		connectCompressionChain(existingEntry);
		return;
	}

	// 創建新的音訊上下文和節點
	const context = new AudioContext();

	const compressNode = context.createDynamicsCompressor();
	compressNode.threshold.setValueAtTime(-50, context.currentTime);
	compressNode.knee.setValueAtTime(40, context.currentTime);
	compressNode.ratio.setValueAtTime(12, context.currentTime);
	compressNode.attack.setValueAtTime(0, context.currentTime);
	compressNode.release.setValueAtTime(0.25, context.currentTime);

	const gainNode = context.createGain();
	const currentGain = await getGain();
	gainNode.gain.setValueAtTime(currentGain, context.currentTime);

	const source = context.createMediaElementSource(node);
	const entry: AudioEntry = {
		source,
		compression: compressNode,
		gainNode,
		context,
		isActive: true,
	};

	connectCompressionChain(entry);

	// 儲存到 Map
	videoAudioMap.set(node, entry);

	return;
}

function getGain(): Promise<number> {
	return new Promise((resolve) => {
		chrome.storage.local.get(["gain"], (result: { gain?: number }) => {
			resolve(result.gain ?? 1.0);
		});
	});
}

function getIfCompress(): Promise<boolean> {
	return new Promise((resolve) => {
		chrome.storage.local.get(["compress"], (result: { compress?: boolean }) => {
			resolve(result.compress ?? false);
		});
	});
}

function setCompression(value: boolean): Promise<boolean> {
	return new Promise((resolve) => {
		chrome.storage.local.set({ compress: value }, () => {
			resolve(value);
		});
	});
}

function setGain(value: number): Promise<number> {
	return new Promise((resolve) => {
		chrome.storage.local.set({ gain: value }, () => {
			resolve(value);
		});
	});
}

async function updateCompression(compress: boolean) {
	if (compress) {
		// 開啟壓縮：為所有 video 元素創建音訊處理
		processExistingVideos(true);
	} else {
		// 關閉壓縮：清理所有音訊資源
		disableCompression();
	}
}

function disableCompression() {
	// MVP 策略：立即釋放所有 AudioContext 資源
	// 優點：節省記憶體，缺點：重新開啟需要重建
	cleanupAllAudioResources();
}

async function toggleCompression() {
	const compress = await getIfCompress();
	await setCompression(!compress);
	updateCompression(!compress);

	// 通知 background script 狀態變更
	chrome.runtime.sendMessage({
		type: "TOGGLE_COMPRESSION",
		compress: !compress,
	});
}

// 更新所有音頻源的 gain 值
async function updateGain(gain: number) {
	for (const [video, entry] of videoAudioMap) {
		const { gainNode, context } = entry;
		gainNode.gain.setValueAtTime(gain, context.currentTime);
	}
}

// 監聽來自 background script 和 popup 的訊息
chrome.runtime.onMessage.addListener(
	(
		message: { type: string; compress?: boolean; gain?: number },
		sender: chrome.runtime.MessageSender,
		sendResponse: (response?: { success: boolean }) => void,
	) => {
		if (message.type === "TOGGLE_COMPRESSION") {
			// 更新快取狀態
			compressState = !!message.compress;
			updateCompression(compressState);
		} else if (message.type === "UPDATE_GAIN") {
			updateGain(message.gain ?? 1.0);
		}
		sendResponse({ success: true });
	},
);

async function run() {
	// 取得當前網域的匹配規則
	currentRule = await getMatchedRule(window.location.hostname);

	// 如果沒有匹配的規則，不處理這個網域
	if (!currentRule) {
		console.log(
			"[Audio Compressor] No matching rule for:",
			window.location.hostname,
		);
		return;
	}

	console.log("[Audio Compressor] Using rule:", currentRule);

	// 初始化壓縮狀態並快取
	compressState = await getIfCompress();
	updateCompression(compressState);

	// 鍵盤快捷鍵支援已移除，改用 popup UI

	// 監聽新影片元素的出現與移除
	const observer = new MutationObserver((mutations) => {
		if (!currentRule) {
			return; // 沒有匹配的規則，不處理
		}

		for (let i = 0; i < mutations.length; i++) {
			const mutation = mutations[i];

			// 處理新增的節點
			for (let j = 0; j < mutation.addedNodes.length; j++) {
				const node = mutation.addedNodes[j] as Node;
				// 檢查新增的節點本身是否是 video
				if (
					node instanceof HTMLVideoElement &&
					node.matches(currentRule.selector)
				) {
					// 使用快取的壓縮狀態，避免頻繁讀取 storage
					if (compressState && !videoAudioMap.has(node)) {
						compressVideoNode(node);
					}
				}

				// 檢查新增節點的子元素中的 video
				if (node instanceof Element) {
					const videos = node.querySelectorAll(currentRule.selector);
					for (let k = 0; k < videos.length; k++) {
						const video = videos[k] as HTMLVideoElement;
						if (video instanceof HTMLVideoElement) {
							// 使用快取的壓縮狀態，避免頻繁讀取 storage
							if (compressState && !videoAudioMap.has(video)) {
								compressVideoNode(video);
							}
						}
					}
				}
			}

			// 處理移除的節點（資源回收）
			for (let j = 0; j < mutation.removedNodes.length; j++) {
				const node = mutation.removedNodes[j] as Node;
				// 檢查移除的節點本身是否是 video
				if (
					node instanceof HTMLVideoElement &&
					node.matches(currentRule.selector)
				) {
					cleanupVideoAudio(node);
				}

				// 檢查移除節點的子元素中的 video
				if (node instanceof Element) {
					const videos = node.querySelectorAll(currentRule.selector);
					for (let k = 0; k < videos.length; k++) {
						const video = videos[k] as HTMLVideoElement;
						if (video instanceof HTMLVideoElement) {
							cleanupVideoAudio(video);
						}
					}
				}
			}
		}
	});

	// 開始觀察 DOM 變化 - 使用 document.documentElement 確保覆蓋整個頁面
	const targetNode = document.documentElement || document.body;
	observer.observe(targetNode, {
		childList: true,
		subtree: true,
	});

	// 清理資源
	window.addEventListener("unload", () => {
		observer.disconnect();
		cleanupAllAudioResources();
	});
}

// 立即執行初始化，不等待 DOMContentLoaded
// 這樣可以確保在頁面載入過程中就能處理已存在的 video 元素
run();

// DOMContentLoaded 事件監聽：檢查頁面載入時可能存在的 video
document.addEventListener("DOMContentLoaded", () => {
	// 使用快取的狀態，避免頻繁讀取 storage
	if (compressState) {
		processExistingVideos(true);
	}
});
