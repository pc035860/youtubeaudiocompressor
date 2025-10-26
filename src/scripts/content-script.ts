/// <reference types="chrome"/>

const sources: {
	source: MediaElementAudioSourceNode;
	compression: DynamicsCompressorNode;
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

function compressVideoNode(node: HTMLVideoElement) {
	const found = sources.find((x) => x.id === node.id);
	if (found) {
		try {
			found.source.disconnect(found.context.destination);
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

	const source = context.createMediaElementSource(node);
	source.connect(compressNode);
	compressNode.connect(context.destination);

	sources.push({ source, compression: compressNode, id: node.id, context });

	return;
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

// 監聽來自 background script 的訊息
chrome.runtime.onMessage.addListener((message: any, sender: chrome.runtime.MessageSender, sendResponse: (response?: any) => void) => {
	if (message.type === 'TOGGLE_COMPRESSION') {
		updateCompression(message.compress);
	}
	sendResponse({ success: true });
});

async function run() {
	// 初始化壓縮狀態
	updateCompression(await getIfCompress());

	// 鍵盤快捷鍵支援
	window.addEventListener("keypress", (e) => {
		if (
			e.key === "v" &&
			!e.ctrlKey &&
			!e.altKey &&
			!e.shiftKey &&
			!e.metaKey &&
			document.activeElement?.tagName !== "INPUT" &&
			document.activeElement?.id !== "contenteditable-root"
		) {
			toggleCompression();
		}
	});

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

	// 開始觀察 DOM 變化
	observer.observe(document.body, {
		childList: true,
		subtree: true
	});

	// 清理資源
	window.addEventListener("unload", () => {
		observer.disconnect();
	});
}

document.addEventListener("DOMContentLoaded", () => {
	run();
});
