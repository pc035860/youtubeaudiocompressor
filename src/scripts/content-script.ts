/// <reference types="chrome"/>

import { getCurrentPlatform, getVideoSelector } from "./constants";

const sources: {
	source: MediaElementAudioSourceNode;
	compression: DynamicsCompressorNode;
	gainNode: GainNode;
	id: string;
	context: AudioContext;
	isActive: boolean;
}[] = [];

// 用於生成唯一 ID 的計數器
let uniqueVideoCounter = 0;

// 為 video 元素生成或獲取唯一 ID
function getOrGenerateVideoId(video: HTMLVideoElement): string {
	if (!video.id) {
		video.id = `audiocomp-${Date.now()}-${++uniqueVideoCounter}`;
	}
	return video.id;
}

// 檢查 video 元素是否已經被處理過
function isVideoProcessed(video: HTMLVideoElement): boolean {
	return sources.some((source) => source.id === video.id);
}

function connectCompressionChain(entry: (typeof sources)[number]) {
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

function bypassCompressionChain(entry: (typeof sources)[number]) {
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
	const platform = getCurrentPlatform();
	const existingVideos = document.querySelectorAll(getVideoSelector(platform));
	for (let i = 0; i < existingVideos.length; i++) {
		const video = existingVideos[i] as HTMLVideoElement;
		if (video instanceof HTMLVideoElement) {
			if (compress) {
				compressVideoNode(video);
			}
		}
	}
}

// 清理音訊資源
function cleanupAudioResources() {
	for (const entry of sources) {
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
	}
	sources.length = 0; // 清空陣列
}

async function compressVideoNode(node: HTMLVideoElement) {
	// 確保 video 元素有唯一 ID
	const videoId = getOrGenerateVideoId(node);

	// 檢查是否已經處理過這個 video 元素
	const found = sources.find((x) => x.id === videoId);
	if (found) {
		connectCompressionChain(found);
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
	const entry = {
		source,
		compression: compressNode,
		gainNode,
		id: videoId,
		context,
		isActive: true,
	};

	connectCompressionChain(entry);

	sources.push(entry);

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
	for (const entry of sources) {
		if (entry.isActive) {
			bypassCompressionChain(entry);
		}
	}
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
	for (const { gainNode, context } of sources) {
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
			updateCompression(!!message.compress);
		} else if (message.type === "UPDATE_GAIN") {
			updateGain(message.gain ?? 1.0);
		}
		sendResponse({ success: true });
	},
);

async function run() {
	// 初始化壓縮狀態
	const shouldCompress = await getIfCompress();
	updateCompression(shouldCompress);

	// 鍵盤快捷鍵支援已移除，改用 popup UI

	// 監聽新影片元素的出現
	const observer = new MutationObserver((mutations) => {
		for (let i = 0; i < mutations.length; i++) {
			const mutation = mutations[i];
			for (let j = 0; j < mutation.addedNodes.length; j++) {
				const node = mutation.addedNodes[j] as Node;
				const platform = getCurrentPlatform();
				// 檢查新增的節點本身是否是 video
				if (
					node instanceof HTMLVideoElement &&
					node.matches(getVideoSelector(platform))
				) {
					// 檢查是否需要壓縮且是否已處理過
					getIfCompress().then((compress) => {
						if (compress && !isVideoProcessed(node)) {
							compressVideoNode(node);
						}
					});
				}

				// 檢查新增節點的子元素中的 video
				if (node instanceof Element) {
					const videos = node.querySelectorAll(getVideoSelector(platform));
					for (let k = 0; k < videos.length; k++) {
						const video = videos[k] as HTMLVideoElement;
						if (video instanceof HTMLVideoElement) {
							// 檢查是否需要壓縮且是否已處理過
							getIfCompress().then((compress) => {
								if (compress && !isVideoProcessed(video)) {
									compressVideoNode(video);
								}
							});
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
		cleanupAudioResources();
	});
}

// 立即執行初始化，不等待 DOMContentLoaded
// 這樣可以確保在頁面載入過程中就能處理已存在的 video 元素
run();

// DOMContentLoaded 事件監聽：檢查頁面載入時可能存在的 video
document.addEventListener("DOMContentLoaded", () => {
	// 使用防重複機制處理現有的 video 元素
	getIfCompress().then((compress) => {
		if (compress) {
			processExistingVideos(true);
		}
	});
});
