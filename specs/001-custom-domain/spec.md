# Technical Specification: 自訂網域與 Video Selector 功能

## 📋 背景與動機

目前 YouTube Audio Compressor 僅支援三個硬編碼的平台（YouTube, Twitch, Bilibili），無法讓使用者自行擴展到其他影音網站。當使用者想在其他串流平台（如 Netflix, Disney+, 或小眾影音網站）使用音訊壓縮功能時，需要修改原始碼並重新建置。

## 🎯 目標

讓使用者能夠：
1. 自訂適用 audio compressor 的網域（支援 wildcard 匹配）
2. 為不同網域指定對應的 video element selector

## 🔍 技術分析

### 現有架構

**content-script.ts**
- `getCurrentPlatform()`: 偵測當前網域並返回平台名稱（src/content-script.ts:18-26）
- `getVideoSelector()`: 根據平台返回對應的 video selector（src/content-script.ts:28-38）
- 硬編碼三組平台規則

**Manifest 限制**
- Manifest V3 的 `content_scripts.matches` 為靜態設定，無法在 runtime 動態修改
- 目前 matches: `["*://*.youtube.com/*", "*://*.twitch.tv/*", "*://*.bilibili.com/*"]`（src/manifest.json:18-22）

### 解決方案設計

#### Storage Schema

```typescript
interface DomainRule {
  id: string;              // UUID
  domain: string;          // 支援 wildcard，如 "*.netflix.com"
  selector: string;        // Video element selector，如 "video"
  enabled: boolean;        // 是否啟用此規則
  createdAt: number;       // 建立時間戳
}

interface CustomDomainsConfig {
  rules: DomainRule[];
  version: number;         // Schema 版本號
}
```

儲存在 `chrome.storage.local` 的 key: `customDomains`

#### 匹配策略

**Phase 1: 簡單 Wildcard**
- 支援 `*` 作為 wildcard（匹配任意字串）
- 範例：`*.youtube.com` 匹配 `www.youtube.com`, `m.youtube.com`
- 實作：將 wildcard pattern 轉換為 RegExp

**Phase 2: 進階 Glob** *(Optional)*
- 支援 `**`, `?`, `[]` 等 glob 語法
- 可考慮使用 [minimatch](https://github.com/isaacs/minimatch) 或 [picomatch](https://github.com/micromatch/picomatch)

#### Manifest Matches 處理

**選項 A: 使用 `<all_urls>`** ✅ *推薦*
- 優點：支援所有網域，使用者設定完全自由
- 缺點：需要更廣泛的權限聲明

**選項 B: 動態 Content Script 注入**
- 使用 `chrome.scripting.executeScript()` 在符合規則的 tab 中注入
- 優點：權限範圍較小
- 缺點：需要 activeTab 權限，實作較複雜

**決策：Phase 1 採用選項 A**（簡單可用 > 複雜優雅）

## 📐 功能設計

### Phase 1: 基礎自訂功能 (MVP)

#### 1.1 UI 架構設計

使用 Chrome Extension 的 **options_ui** 機制分離快速控制與進階設定：

**popup.html** - 快速控制介面
```
[壓縮開關]  ON/OFF
[Gain Slider] ━━●━━ 1.0
[⚙️ 擴充功能選項]  ← 點擊開啟 options 頁面
```

**options.html** - 獨立設定頁面（新開分頁）
```
┌─────────────────────────────┐
│ YouTube Audio Compressor    │
│ 網域規則管理                 │
├─────────────────────────────┤
│ [+ 新增規則]                │
│                              │
│ ☑ *.youtube.com              │
│   Selector: video            │
│   [編輯] [刪除]              │
│                              │
│ ☑ *.twitch.tv                │
│   Selector: video[...]       │
│   [編輯] [刪除]              │
│                              │
│ ☐ *.bilibili.com             │
│   Selector: video            │
│   [編輯] [刪除]              │
└─────────────────────────────┘
```

**開啟方式：**
- Popup 點擊「擴充功能選項」按鈕 → `chrome.runtime.openOptionsPage()`
- chrome://extensions 頁面點擊「選項」/「Details → Extension options」

#### 1.2 規則管理功能

**新增規則**
- 輸入 domain pattern（如 `*.netflix.com`）
- 輸入 video selector（如 `video`）
- 驗證格式並儲存到 chrome.storage.local

**編輯規則**
- 修改 domain pattern 或 selector
- 即時生效（需要重新載入頁面）

**刪除規則**
- 移除指定規則
- 需要確認對話框

**啟用/停用規則**
- Toggle checkbox 快速啟用/停用

#### 1.3 預設規則

初始化時自動建立三組預設規則：
```typescript
const DEFAULT_RULES: DomainRule[] = [
  {
    id: 'default-youtube',
    domain: '*.youtube.com',
    selector: 'video',
    enabled: true,
    createdAt: Date.now()
  },
  {
    id: 'default-twitch',
    domain: '*.twitch.tv',
    selector: 'video[data-a-player-type], video',
    enabled: true,
    createdAt: Date.now()
  },
  {
    id: 'default-bilibili',
    domain: '*.bilibili.com',
    selector: 'video',
    enabled: true,
    createdAt: Date.now()
  }
];
```

#### 1.4 Content Script 改寫

**改寫 `getCurrentPlatform()` 和 `getVideoSelector()`**

```typescript
// 移除硬編碼，改為從 storage 讀取規則
async function getMatchedRule(): Promise<DomainRule | null> {
  const config = await chrome.storage.local.get('customDomains');
  const rules = config.customDomains?.rules || DEFAULT_RULES;

  const hostname = window.location.hostname;

  // 依序匹配規則（enabled 的優先）
  for (const rule of rules.filter(r => r.enabled)) {
    if (matchDomain(hostname, rule.domain)) {
      return rule;
    }
  }

  return null;
}

function matchDomain(hostname: string, pattern: string): boolean {
  // 將 wildcard pattern 轉為 RegExp
  const regexPattern = pattern
    .replace(/\./g, '\\.')  // escape dots
    .replace(/\*/g, '.*');   // * -> .*

  const regex = new RegExp(`^${regexPattern}$`, 'i');
  return regex.test(hostname);
}
```

**更新 video 元素偵測邏輯**

```typescript
async function initializeCompressor() {
  const rule = await getMatchedRule();

  if (!rule) {
    console.log('No matching domain rule found');
    return;
  }

  const videoSelector = rule.selector;
  // 後續邏輯不變...
}
```

#### 1.5 Manifest 更新

```json
{
  "content_scripts": [
    {
      "matches": ["<all_urls>"],  // 改為支援所有網域
      "js": ["content-script.js"],
      "run_at": "document_start"
    }
  ],
  "host_permissions": [
    "<all_urls>"  // 新增 host permissions（用於 <all_urls> 匹配）
  ],
  "options_ui": {
    "page": "options.html",
    "open_in_tab": true  // 在新分頁開啟，提供更大空間
  }
}
```

**新增檔案：**
- `src/options.html` - 設定頁面 UI
- `src/options.ts` - 設定頁面邏輯（規則的 CRUD 操作）

**Popup 按鈕實作：**
```typescript
// popup.ts
document.getElementById('optionsBtn')?.addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
});
```

### Phase 2: 進階功能 *(Optional - 確認需求後再做)*

#### 2.1 匯入/匯出規則
- JSON 格式匯出所有規則
- 支援匯入規則（合併或覆蓋）
- 分享規則檔案給其他使用者

#### 2.2 規則測試工具
- 輸入網址測試會匹配哪條規則
- 顯示匹配結果和對應的 selector

#### 2.3 進階 Glob 語法
- 支援 `?` (單一字元)
- 支援 `[abc]` (字元集)
- 支援 `**` (遞迴匹配)

#### 2.4 Selector 測試工具
- 在當前頁面測試 selector 是否有效
- 顯示找到的 video 元素數量

### Phase 3: 優化完善 *(Optional)*

#### 3.1 規則優先序調整
- 拖曳排序規則優先權
- 更精確的規則優先匹配

#### 3.2 預設模板庫
- 提供常見串流平台的預設模板
- 使用者可一鍵套用

#### 3.3 效能優化
- 快取規則匹配結果
- 減少 storage 讀取次數

## 🚧 技術限制與風險

### Manifest V3 權限聲明
使用 `<all_urls>` 會在安裝時顯示「讀取和變更所有網站資料」的權限警告，可能降低使用者信任度。

**緩解策略：**
- 在 extension 描述和 README 清楚說明權限用途
- 強調所有資料處理都在本地進行，不會傳送到外部伺服器

### Selector 錯誤處理
使用者可能輸入無效的 CSS selector，導致 `document.querySelector()` 拋出異常。

**緩解策略：**
- 在儲存規則前驗證 selector 語法
- Content script 使用 try-catch 包裹 querySelector 呼叫
- 顯示友善的錯誤訊息

### 規則衝突
多個規則匹配同一網域時，可能產生預期外的行為。

**緩解策略：**
- 採用「第一個匹配的規則優先」策略
- UI 顯示規則優先序
- Phase 3 可加入拖曳排序功能

## ✅ 驗收標準

### Phase 1 (MVP)

- [ ] Popup 有「擴充功能選項」按鈕，點擊開啟 options 頁面
- [ ] Options 頁面可新增自訂網域規則（domain pattern + selector）
- [ ] Options 頁面可編輯和刪除規則
- [ ] Options 頁面可啟用/停用規則（checkbox）
- [ ] 支援簡單 wildcard 匹配（`*`）
- [ ] 預設包含三組現有平台規則（YouTube, Twitch, Bilibili）
- [ ] 在符合規則的網域中，audio compressor 正常運作
- [ ] 不符合任何規則的網域，不載入 compressor
- [ ] 規則儲存在 chrome.storage.local，跨 session 保持
- [ ] Manifest 權限正確設定（`<all_urls>` + `options_ui`）

### Phase 2 (Optional)

- [ ] 支援匯出規則為 JSON 檔案
- [ ] 支援匯入 JSON 格式的規則檔案
- [ ] 提供規則測試工具
- [ ] 支援進階 glob 語法（`?`, `[]`, `**`）

### Phase 3 (Optional)

- [ ] 支援拖曳調整規則優先序
- [ ] 提供常見平台的預設模板
- [ ] 規則匹配結果快取

## 📊 成功指標

- 使用者可在 5 分鐘內完成一個自訂網域的設定
- 減少「希望支援 XXX 平台」的功能請求數量
- 不增加明顯的效能負擔（< 50ms 初始化延遲）

## 🗓️ 開發排程建議

- **Week 1**: Storage schema + 基礎 wildcard 匹配邏輯 + Content script 改寫
- **Week 2**: Options 頁面 UI 與 CRUD 邏輯實作
- **Week 3**: Popup 整合 + 整合測試
- **Week 4**: Bug 修復 + 文件撰寫

*Phase 2/3 依實際使用者需求和時間決定是否開發*

---

**Spec 版本**: v1.1
**最後更新**: 2025-11-12
**變更記錄**:
- v1.1: 改用 Chrome Extension options_ui 機制取代展開式面板
- v1.0: 初始版本
**撰寫者**: Ruru (Claude Code)
