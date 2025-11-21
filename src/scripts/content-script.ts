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

// 追蹤處理中的 video 元素，防止競態條件
const pendingVideos = new WeakSet<HTMLVideoElement>();

// 元素層級標記 key，用於標記已被 createMediaElementSource 連接過的 video
const SOURCE_CONNECTED_KEY = "__yacSourceConnected__";

// 延遲清理機制：追蹤待清理的 video 和計時器 ID
const pendingCleanup = new Map<HTMLVideoElement, number>();
const CLEANUP_DELAY_MS = 30000; // 30 秒後清理

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
	// 取消所有延遲清理計時器
	for (const [, timerId] of pendingCleanup) {
		clearTimeout(timerId);
	}
	pendingCleanup.clear();

	for (const [video] of videoAudioMap) {
		cleanupVideoAudio(video);
	}
	videoAudioMap.clear();
}

// 排程延遲清理（video 被移除時呼叫）
function scheduleCleanup(video: HTMLVideoElement) {
	// 如果已有計時器，不重複排程
	if (pendingCleanup.has(video)) {
		return;
	}

	const timerId = window.setTimeout(() => {
		pendingCleanup.delete(video);
		// 確認 video 仍不在 DOM 中才清理
		if (!document.contains(video)) {
			cleanupVideoAudio(video);
		}
	}, CLEANUP_DELAY_MS);

	pendingCleanup.set(video, timerId);
}

// 取消延遲清理（video 被重新加入時呼叫）
function cancelCleanup(video: HTMLVideoElement) {
	const timerId = pendingCleanup.get(video);
	if (timerId !== undefined) {
		clearTimeout(timerId);
		pendingCleanup.delete(video);
	}
}

async function compressVideoNode(node: HTMLVideoElement) {
	// 取消延遲清理（video 可能被重新加入）
	cancelCleanup(node);

	// 檢查是否已經處理過這個 video 元素（使用 Map）
	const existingEntry = videoAudioMap.get(node);
	if (existingEntry) {
		connectCompressionChain(existingEntry);
		return;
	}

	// 檢查是否正在處理中（防止競態條件）
	if (pendingVideos.has(node)) {
		return;
	}

	// 檢查元素是否已被 createMediaElementSource 連接過
	// （video 元素一生只能被連接一次，即使 AudioContext 已關閉）
	if ((node as unknown as Record<string, boolean>)[SOURCE_CONNECTED_KEY]) {
		console.warn(
			"[Audio Compressor] Video element already connected to MediaElementSourceNode, skipping",
		);
		return;
	}

	// 標記為處理中（必須在任何 await 之前）
	pendingVideos.add(node);

	try {
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

		let source: MediaElementAudioSourceNode;
		try {
			source = context.createMediaElementSource(node);
		} catch (error) {
			// 連接失敗（可能已被其他腳本連接）
			console.warn(
				"[Audio Compressor] Failed to create MediaElementSource:",
				error,
			);
			context.close().catch(() => undefined);
			return;
		}

		const entry: AudioEntry = {
			source,
			compression: compressNode,
			gainNode,
			context,
			isActive: true,
		};

		connectCompressionChain(entry);

		// 確保 AudioContext 處於 running 狀態（防止自動播放政策導致靜音）
		context.resume().catch(() => undefined);

		// 儲存到 Map
		videoAudioMap.set(node, entry);

		// 標記元素已被連接（防止未來重複連接）
		// 放在最後確保只有完全成功時才標記
		(node as unknown as Record<string, boolean>)[SOURCE_CONNECTED_KEY] = true;
	} finally {
		// 無論成功或失敗都要移除 pending 標記
		pendingVideos.delete(node);
	}
}

function getGain(): Promise<number> {
	return new Promise((resolve) => {
		chrome.storage.local.get(["gain"], (result: { gain?: number }) => {
			// 值域保護：確保舊版寫入的異常值也會被修正
			const gain = result.gain ?? 1.0;
			resolve(Math.min(Math.max(gain, 0.0), 2.0));
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

async function updateCompression(compress: boolean) {
	if (compress) {
		// 開啟壓縮：重新連接已存在的 entry，並處理新的 video 元素
		for (const [, entry] of videoAudioMap) {
			// 恢復 AudioContext
			entry.context.resume().catch(() => undefined);
			if (!entry.isActive) {
				connectCompressionChain(entry);
			}
		}
		processExistingVideos(true);
	} else {
		// 關閉壓縮：旁路所有音訊處理（保留資源）
		disableCompression();
	}
}

function disableCompression() {
	// 旁路策略：保留 AudioContext 和 SourceNode，只斷開壓縮鏈
	// 原因：HTMLMediaElement 只能被 createMediaElementSource 連接一次
	// 即使 context.close() 後仍無法重新連接，所以必須保留資源
	for (const [, entry] of videoAudioMap) {
		bypassCompressionChain(entry);
	}
}

// 更新所有音頻源的 gain 值
async function updateGain(gain: number) {
	// 值域保護：限制在 0.0-2.0 之間
	const clampedGain = Math.min(Math.max(gain, 0.0), 2.0);
	for (const [, entry] of videoAudioMap) {
		const { gainNode, context } = entry;
		gainNode.gain.setValueAtTime(clampedGain, context.currentTime);
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
	// 單例守門：防止 SPA 導航時重複注入
	const win = window as unknown as { __yacInjected?: boolean };
	if (win.__yacInjected) {
		return;
	}
	win.__yacInjected = true;

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

			// 處理移除的節點（延遲清理）
			for (let j = 0; j < mutation.removedNodes.length; j++) {
				const node = mutation.removedNodes[j] as Node;
				// 檢查移除的節點本身是否是 video
				if (
					node instanceof HTMLVideoElement &&
					node.matches(currentRule.selector)
				) {
					// 排程延遲清理，給 YouTube 重複使用的機會
					scheduleCleanup(node);
				}

				// 檢查移除節點的子元素中的 video
				if (node instanceof Element) {
					const videos = node.querySelectorAll(currentRule.selector);
					for (let k = 0; k < videos.length; k++) {
						const video = videos[k] as HTMLVideoElement;
						if (video instanceof HTMLVideoElement) {
							scheduleCleanup(video);
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
