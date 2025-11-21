/**
 * Domain Rules Module
 * 處理自訂網域規則的核心邏輯
 */

// ============================================================================
// Type Definitions
// ============================================================================

export interface DomainRule {
	id: string; // UUID
	domain: string; // 支援 wildcard，如 "*.netflix.com"
	selector: string; // Video element selector，如 "video"
	enabled: boolean; // 是否啟用此規則
	createdAt: number; // 建立時間戳
}

export interface CustomDomainsConfig {
	rules: DomainRule[];
	version: number; // Schema 版本號
}

// ============================================================================
// Constants
// ============================================================================

export const STORAGE_KEY = "customDomains";
export const CONFIG_VERSION = 1;

/**
 * 預設規則（對應原本硬編碼的三個平台）
 *
 * 注意：*.example.com 只匹配子域，不匹配根域
 * 因此需要分別為根域和子域建立規則
 */
export const DEFAULT_RULES: DomainRule[] = [
	{
		id: "default-youtube",
		domain: "*.youtube.com",
		selector: "video",
		enabled: true,
		createdAt: Date.now(),
	},
	{
		id: "default-youtu-be-wildcard",
		domain: "*.youtu.be",
		selector: "video",
		enabled: true,
		createdAt: Date.now(),
	},
	{
		id: "default-youtu-be-root",
		domain: "youtu.be",
		selector: "video",
		enabled: true,
		createdAt: Date.now(),
	},
	{
		id: "default-twitch",
		domain: "*.twitch.tv",
		selector: "video[data-a-player-type], video",
		enabled: true,
		createdAt: Date.now(),
	},
	{
		id: "default-bilibili",
		domain: "*.bilibili.com",
		selector: "video",
		enabled: true,
		createdAt: Date.now(),
	},
];

// ============================================================================
// Wildcard Matching
// ============================================================================

/**
 * 將 wildcard pattern 轉換為正則表達式並匹配 hostname
 *
 * 支援的 wildcard 語法（對齊 Chrome Extension manifest match patterns）：
 * - `*`: 匹配任意字串（包含空字串）
 * - `*.example.com`: 匹配 example.com 的所有子域（不包含根域 example.com）
 * - `example.com`: 精確匹配根域
 *
 * @example
 * matchDomain("www.youtube.com", "*.youtube.com") // true
 * matchDomain("m.youtube.com", "*.youtube.com")   // true
 * matchDomain("youtube.com", "*.youtube.com")     // false (需要子網域)
 * matchDomain("youtube.com", "youtube.com")       // true (exact match)
 */
export function matchDomain(hostname: string, pattern: string): boolean {
	// 先轉義所有正則保留字（除了 * 之外）
	// 正則保留字：\ ^ $ + ? . ( ) [ ] { } |
	const escapedPattern = pattern.replace(/[-/\\^$+?.()|[\]{}]/g, "\\$&");

	// 將 * 轉換為 .* （匹配任意字串）
	const regexPattern = escapedPattern.replace(/\*/g, ".*");

	const regex = new RegExp(`^${regexPattern}$`, "i");
	return regex.test(hostname);
}

// ============================================================================
// Storage Operations
// ============================================================================

/**
 * 從 chrome.storage.local 讀取自訂網域配置
 * 如果不存在，返回預設規則
 */
export async function loadCustomDomainsConfig(): Promise<CustomDomainsConfig> {
	const result = await chrome.storage.local.get(STORAGE_KEY);
	const config = result[STORAGE_KEY] as CustomDomainsConfig | undefined;

	// 如果沒有配置，使用預設規則
	if (!config) {
		return {
			rules: DEFAULT_RULES,
			version: CONFIG_VERSION,
		};
	}

	return config;
}

/**
 * 儲存自訂網域配置到 chrome.storage.local
 */
export async function saveCustomDomainsConfig(
	config: CustomDomainsConfig,
): Promise<void> {
	await chrome.storage.local.set({ [STORAGE_KEY]: config });
}

/**
 * 初始化自訂網域配置（首次使用時寫入預設規則）
 */
export async function initializeCustomDomainsConfig(): Promise<void> {
	const result = await chrome.storage.local.get(STORAGE_KEY);

	// 如果已經有配置，不覆寫
	if (result[STORAGE_KEY]) {
		return;
	}

	// 寫入預設規則
	const defaultConfig: CustomDomainsConfig = {
		rules: DEFAULT_RULES,
		version: CONFIG_VERSION,
	};

	await saveCustomDomainsConfig(defaultConfig);
}

// ============================================================================
// Rule Matching
// ============================================================================

/**
 * 根據當前 hostname 查詢匹配的規則
 *
 * 匹配策略：
 * - 只考慮 enabled 為 true 的規則
 * - 依序匹配，返回第一個匹配的規則
 * - 如果沒有匹配，返回 null
 *
 * @param hostname 當前網域的 hostname（如 "www.youtube.com"）
 * @returns 匹配的規則，或 null
 */
export async function getMatchedRule(
	hostname: string,
): Promise<DomainRule | null> {
	const config = await loadCustomDomainsConfig();
	const enabledRules = config.rules.filter((r) => r.enabled);

	// 依序匹配規則
	for (const rule of enabledRules) {
		if (matchDomain(hostname, rule.domain)) {
			return rule;
		}
	}

	return null;
}

// ============================================================================
// CRUD Operations (for Options Page)
// ============================================================================

/**
 * 產生唯一的 rule ID（使用簡單的 UUID v4）
 */
export function generateRuleId(): string {
	return `rule-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * 新增規則
 */
export async function addRule(
	domain: string,
	selector: string,
): Promise<DomainRule> {
	const config = await loadCustomDomainsConfig();

	const newRule: DomainRule = {
		id: generateRuleId(),
		domain,
		selector,
		enabled: true,
		createdAt: Date.now(),
	};

	config.rules.push(newRule);
	await saveCustomDomainsConfig(config);

	return newRule;
}

/**
 * 更新規則
 */
export async function updateRule(
	id: string,
	updates: Partial<Omit<DomainRule, "id" | "createdAt">>,
): Promise<boolean> {
	const config = await loadCustomDomainsConfig();
	const ruleIndex = config.rules.findIndex((r) => r.id === id);

	if (ruleIndex === -1) {
		return false;
	}

	config.rules[ruleIndex] = {
		...config.rules[ruleIndex],
		...updates,
	};

	await saveCustomDomainsConfig(config);
	return true;
}

/**
 * 刪除規則
 */
export async function deleteRule(id: string): Promise<boolean> {
	const config = await loadCustomDomainsConfig();
	const originalLength = config.rules.length;

	config.rules = config.rules.filter((r) => r.id !== id);

	if (config.rules.length === originalLength) {
		return false; // 沒有刪除任何規則
	}

	await saveCustomDomainsConfig(config);
	return true;
}

/**
 * 取得所有規則
 */
export async function getAllRules(): Promise<DomainRule[]> {
	const config = await loadCustomDomainsConfig();
	return config.rules;
}
