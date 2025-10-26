/// <reference types="chrome"/>

// 完整域名列表（用於 manifest.json 和 chrome.tabs.query）
export const SUPPORTED_DOMAINS: string[] = [
	"https://www.youtube.com/*",
	"https://youtu.be/*",
	"https://www.twitch.tv/*",
	"https://clips.twitch.tv/*",
	"https://www.bilibili.com/*",
	"https://live.bilibili.com/*",
];

// 平台類型
export type Platform = "youtube" | "twitch" | "bilibili" | "unknown";

// 平台檢測用的 hostname 關鍵字
export const PLATFORM_HOSTNAMES = {
	youtube: ["youtube.com", "youtu.be"],
	twitch: ["twitch.tv"],
	bilibili: ["bilibili.com"],
} as const;

// 根據平台獲取影片選擇器
export function getVideoSelector(platform: Platform): string {
	switch (platform) {
		case "youtube":
			return "video";
		case "twitch":
			return "video[data-a-player-type], video";
		case "bilibili":
			return "video";
		default:
			return "video";
	}
}

// 檢測當前平台
export function getCurrentPlatform(): Platform {
	const hostname = window.location.hostname;

	if (PLATFORM_HOSTNAMES.youtube.some((h) => hostname.includes(h)))
		return "youtube";
	if (PLATFORM_HOSTNAMES.twitch.some((h) => hostname.includes(h)))
		return "twitch";
	if (PLATFORM_HOSTNAMES.bilibili.some((h) => hostname.includes(h)))
		return "bilibili";

	return "unknown";
}
