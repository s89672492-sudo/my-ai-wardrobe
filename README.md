# My AI Wardrobe 智慧衣櫥（手機完全本地運算版）

在手機瀏覽器中執行的 AI 衣櫥與虛擬試穿 PWA。**所有照片與 AI 推論都只在手機本機處理**，不使用任何雲端 AI API、不需要電腦或伺服器。

線上版本：<https://s89672492-sudo.github.io/my-ai-wardrobe/>

## 功能

- 衣櫥管理：拍照或選照片，AI 去背（MediaPipe MagicTouch）、分類、顏色、季節、風格
- AI 試穿：MoveNet 人體關鍵點 + Selfie Segmenter 人體輪廓 + Multiclass 人體部位（頭髮／皮膚／衣服），以 TPS 變形把衣服貼合到全身照，可多件疊穿；頭髮自然蓋在衣服前、手臂遮擋依真實皮膚範圍，並套用照片原本的明暗與色調
- 穿搭推薦：本機規則引擎（顏色搭配、季節、場合、正式程度）
- 資料：IndexedDB 本機儲存、zip 備份與還原、儲存空間管理
- 情侶衣櫥：衣服可標記是「她／他／共用」，衣櫥與穿搭推薦可分開看；可自訂兩人的暱稱與頭像
- 可愛主題：App 原創吉祥物：三花小貓（她）與橘虎斑小貓（他），向量繪製

> 自訂頭像只存在手機的 IndexedDB，不會上傳，也不會提交到 GitHub 或部署到網站。若使用他人創作的角色圖片，請只作個人用途。

> 試穿是「圖像變形與合成」，不是生成式 AI，不會重建布料皺褶、光影或被遮住的部分。

## 隱私

| 保證 | 實作方式 |
|---|---|
| 照片不離開手機 | 正式版加入 CSP `connect-src 'self'`，頁面在技術上無法連線到其他網域 |
| 不使用雲端 AI | AI 模型在瀏覽器 Web Worker 以 LiteRT.js 執行（WebGPU 或 WASM CPU） |
| 不提交私人照片 | `.gitignore` 排除圖片；CI 的 `npm run check-repo` 發現圖片或權重就失敗 |
| 部署內容無私人圖片 | `npm run verify-dist` 檢查 dist 中除 App 圖示外沒有任何圖片 |

## AI 模型（不提交到 Git）

建置時由 `npm run fetch-models` 從官方、版本固定的網址下載，並驗證 SHA-256（清單見 `tools/models.mjs`）：

| 模型 | 用途 | 大小 | 授權 |
|---|---|---|---|
| MoveNet SinglePose Lightning float16 v4 | 人體關鍵點 | 4.5 MB | Apache-2.0 |
| MediaPipe Selfie Segmenter v1 | 人體輪廓 | 0.2 MB | Apache-2.0 |
| MediaPipe Selfie Multiclass 256×256 v1 | 頭髮、皮膚、衣服 | 15.6 MB | Apache-2.0 |
| MediaPipe Interactive Segmenter (MagicTouch) v1 | 衣服去背 | 5.9 MB | Apache-2.0 |

LiteRT.js 執行環境來自 npm 套件 `@litertjs/core`（`package-lock.json` 鎖定版本與完整性雜湊）。

模型與 wasm 不放進 Service Worker 預先快取（避免安裝 App 就耗用 50 MB 流量），而是第一次使用 AI 時由 AI Worker 下載並存入 Cache Storage，之後可離線使用。

## 開發

需要 Node.js 22。

```bash
npm ci
npm run fetch-models
npm run dev
```

| 指令 | 用途 |
|---|---|
| `npm test` | 單元測試（vitest） |
| `npm run build` | 型別檢查 + 正式版建置（base path 預設 `/my-ai-wardrobe/`，可用 `BASE_PATH` 覆寫） |
| `npm run verify-dist` | 部署前檢查 dist |
| `npm run check-repo` | 檢查儲存庫沒有私人照片、模型權重 |
| `node tools/serve-pages.mjs` | 模擬 GitHub Pages 的本機伺服器（含 404.html 行為） |

## 部署到 GitHub Pages

1. 儲存庫 **Settings → Pages → Build and deployment → Source** 選 **GitHub Actions**
2. 推送到 `main`，`Deploy to GitHub Pages` workflow 會：
   1. 檢查儲存庫（check-repo）→ 單元測試 → 下載並驗證模型 → 建置（base path 自動依儲存庫名稱）
   2. 部署前檢查（verify-dist）→ 部署
   3. **部署後驗收**（verify-live）：在線上網站以模擬 iPhone 實際檢查 HTTPS、各頁面重新整理、沒有 `#` 的網址、模型 SHA-256、Service Worker、離線開啟
3. Fork 後改名也可以使用：base path 由儲存庫名稱決定；`<user>.github.io` 儲存庫則為 `/`

### 路由與重新整理

App 使用 hash 路由（`#/wardrobe`），GitHub Pages 上重新整理任何頁面都不會 404。若有人開啟沒有 `#` 的網址（例如 `/my-ai-wardrobe/wardrobe`），GitHub Pages 回傳的 `404.html` 會轉到 `#/wardrobe`；App 已安裝時則由 Service Worker 回應並在 App 內轉換。

### 更新

新版本部署後，App 在回到前景時與每小時檢查一次，有新版會顯示「有新版本可以使用」，按「更新」即可。設定頁底部顯示版本與部署代號（commit 前 7 碼），可確認手機上是否為最新版。

## 授權

第三方程式碼與模型授權見 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
