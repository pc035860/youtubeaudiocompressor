/// <reference types="chrome"/>

const sources: {
	source: MediaElementAudioSourceNode;
	compression: DynamicsCompressorNode;
	gainNode: GainNode;
	id: string;
	context: AudioContext;
}[] = [];

// 平台檢測
function getCurrentPlatform(): 'youtube' | 'twitch' | 'bilibili' | 'unknown' {
	const hostname = window.location.hostname;
	if (hostname.includes('youtube.com')) return 'youtube';
	if (hostname.includes('twitch.tv')) return 'twitch';
	if (hostname.includes('bilibili.com')) return 'bilibili';
	return 'unknown';
}

// 根據平台獲取影片選擇器
function getVideoSelector(): string {
	const platform = getCurrentPlatform();
	switch (platform) {
		case 'youtube':
			return 'video';
		case 'twitch':
			return 'video[data-a-player-type], video';
		case 'bilibili':
			return 'video';
		default:
			return 'video';
	}
}

async function compressVideoNode(node: HTMLVideoElement) {
	const found = sources.find((x) => x.id === node.id);
	if (found) {
		try {
			found.source.disconnect(found.gainNode);
		} catch {
			// ignore this error
		}
		return found.source.connect(found.compression);
	}

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
	source.connect(compressNode);
	compressNode.connect(gainNode);
	gainNode.connect(context.destination);

	sources.push({ source, compression: compressNode, gainNode, id: node.id, context });

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
		document.querySelectorAll(getVideoSelector()).forEach((video) => {
			if (video instanceof HTMLVideoElement) {
				compressVideoNode(video);
			}
		});
	} else {
		for (const { source, compression, context } of sources) {
			source.disconnect(compression);
			source.connect(context.destination);
		}
	}
}

async function toggleCompression() {
	const compress = await getIfCompress();
	await setCompression(!compress);
	updateCompression(!compress);
	
	// 通知 background script 狀態變更
	chrome.runtime.sendMessage({
		type: 'TOGGLE_COMPRESSION',
		compress: !compress
	});
}

// 更新所有音頻源的 gain 值
async function updateGain(gain: number) {
	for (const { gainNode, context } of sources) {
		gainNode.gain.setValueAtTime(gain, context.currentTime);
	}
}

// 監聽來自 background script 和 popup 的訊息
chrome.runtime.onMessage.addListener((message: any, sender: chrome.runtime.MessageSender, sendResponse: (response?: any) => void) => {
	if (message.type === 'TOGGLE_COMPRESSION') {
		updateCompression(message.compress);
	} else if (message.type === 'UPDATE_GAIN') {
		updateGain(message.gain);
	}
	sendResponse({ success: true });
});

async function run() {
	// 初始化壓縮狀態
	const shouldCompress = await getIfCompress();
	updateCompression(shouldCompress);

	// 鍵盤快捷鍵支援已移除，改用 popup UI

	// 監聽新影片元素的出現
	const observer = new MutationObserver((mutations) => {
		mutations.forEach((mutation) => {
			mutation.addedNodes.forEach((node) => {
				if (node instanceof Element) {
					const videos = node.querySelectorAll(getVideoSelector());
					videos.forEach((video) => {
						if (video instanceof HTMLVideoElement) {
							// 檢查是否需要壓縮
							getIfCompress().then((compress) => {
								if (compress) {
									compressVideoNode(video);
								}
							});
						}
					});
				}
			});
		});
	});

	// 開始觀察 DOM 變化 - 使用 document.documentElement 確保覆蓋整個頁面
	const targetNode = document.documentElement || document.body;
	observer.observe(targetNode, {
		childList: true,
		subtree: true
	});

	// 清理資源
	window.addEventListener("unload", () => {
		observer.disconnect();
	});
}

// 立即執行初始化，不等待 DOMContentLoaded
// 這樣可以確保在頁面載入過程中就能處理已存在的 video 元素
run();

// 同時也監聽 DOMContentLoaded 作為備用
document.addEventListener("DOMContentLoaded", () => {
	// 再次檢查是否有遺漏的 video 元素
	const existingVideos = document.querySelectorAll(getVideoSelector());
	existingVideos.forEach((video) => {
		if (video instanceof HTMLVideoElement) {
			getIfCompress().then((compress) => {
				if (compress) {
					compressVideoNode(video);
				}
			});
		}
	});
});

// 額外的安全機制：監聽頁面完全載入後再次檢查
window.addEventListener("load", () => {
	// 延遲一點時間確保所有動態內容都已載入
	setTimeout(() => {
		const existingVideos = document.querySelectorAll(getVideoSelector());
		existingVideos.forEach((video) => {
			if (video instanceof HTMLVideoElement) {
				getIfCompress().then((compress) => {
					if (compress) {
						compressVideoNode(video);
					}
				});
			}
		});
	}, 1000); // 1秒後再次檢查
});
