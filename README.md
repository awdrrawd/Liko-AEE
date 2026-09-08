<h1 align="center">🐈‍⬛ Liko-AEE — Appearance Editing Extension</h1>
<h3 align="center">外觀編輯拓展</h3>

<div align="center">

![Version](https://img.shields.io/badge/version-0.9.4-purple.svg)
![License](https://img.shields.io/badge/License-Custom%20(Copyleft)-purple.svg)
![BondageClub](https://img.shields.io/badge/BondageClub-Compatible-pink.svg)

</div>

一個 BondageClub UserScript 插件，為更衣室提供現代化的外觀編輯介面與獨立的專屬衣櫃系統。  
A BondageClub UserScript plugin that brings a modern appearance-editing interface and a dedicated wardrobe system to the dressing room.

---

## ✨ 主要功能 · Features

**🎨 外觀編輯 · Appearance Editing**

逐圖層或整件衣服調整位移、旋轉、縮放、繪製優先度，可直接在畫布上拖曳操作；另附進階調色盤（HSV、色彩和諧、滴管取色、已存色票）。  
Per-layer or whole-item control over offset, rotation, scale, and draw priority, adjustable by dragging directly on the canvas — plus an advanced color picker (HSV, harmony rules, eyedropper, saved swatches).

**👗 專屬衣櫃 · Dedicated Wardrobe**

獨立於遊戲原生存檔的服裝管理介面，支援線上／本地／SPS 三種儲存來源，並提供搜尋、標籤、最愛，以及 BCX 相容的匯出／匯入。  
An outfit-management UI separate from the game's native save slots — with online / local / SPS storage, search, tags, favorites, and BCX-compatible export/import.

**🖱 操作輔助 · Workflow Aids**

懸停高亮、懸停試穿、服裝複製／貼上、部件搜尋器，以及獨立的檢視控制面板（人物位移縮放、背景、姿勢快選）等，加快換裝與比對流程。部件搜尋器可依原始名稱、目前語言譯名、類型與部位尋找衣服或道具，並預覽其所有部件及出現部位。

Hover highlight, hover try-on, item copy/paste, an asset-parts searcher, and a standalone view-control panel (character offset/zoom, background, quick poses) speed up outfit iteration. The searcher finds clothing and items by original name, localized description, type, or slot, then previews every part and all matching slots.

**🧪 實驗性功能 · Experimental Features**

變形（傾斜等進階調整）、鏡射與鏡射複製、自由繪圖（含遮罩、單手套等預設工具）。這些效果皆由 AEE 本地渲染，只有同樣安裝 AEE 的人才看得到；其中僅自由繪圖可在設定中獨立開關，變形與鏡射目前沒有獨立開關。  
Advanced transforms (e.g. skew), mirror / mirror-copy, and free drawing (including masking presets such as single-glove). These effects are rendered locally by AEE, so only other AEE users can see them; only free drawing can be toggled independently in Settings — transform and mirror currently have no individual on/off switch.

---

## 📦 安裝方式 · Installation

### 透過插件管理器（推薦） · Via a plugin manager (Recommended)

- **FUSAM**：安裝 [FUSAM](https://sidiousious.gitlab.io/bc-addon-loader/) 後，於 BC 設定頁的 **ADD-ON** 分頁找到 **Liko-AEE** 並啟用。
- **Liko PCM**：若已安裝 [Liko PCM](https://awdrrawd.github.io/liko-Plugin-Repository/)，可直接在插件列表啟用 AEE。
- **BC Mod Manager**：若已安裝 [BC Mod Manager](https://inkerbot.github.io/bc-mod-manager/)，可直接在插件列表啟用 AEE。

Install [FUSAM](https://sidiousious.gitlab.io/bc-addon-loader/) and enable **Liko-AEE** from the **ADD-ON** tab, or enable it directly from the plugin list if you already use [Liko PCM](https://awdrrawd.github.io/liko-Plugin-Repository/) or [BC Mod Manager](https://inkerbot.github.io/bc-mod-manager/).

### 手動安裝 · Manual installation

<details>
<summary>Tampermonkey / Violentmonkey</summary>

👉 **[Install Liko-AEE.user.js](https://raw.githubusercontent.com/awdrrawd/BC-AEE/main/loader.user.js)**

</details>

<details>
<summary>書籤安裝 · Bookmarklet</summary>

```javascript
javascript:(function(){
  var s=document.createElement('script');
  s.src="https://github.com/awdrrawd/liko-Plugin-Repository/raw/refs/heads/main/Plugins/Liko-AEE.user.js?"+Date.now();
  s.type="text/javascript";
  s.crossOrigin="anonymous";
  document.head.appendChild(s);
})();
```

</details>

<details>
<summary>瀏覽器控制台 · Browser Console</summary>

```javascript
import(`https://github.com/awdrrawd/liko-Plugin-Repository/raw/refs/heads/main/Plugins/Liko-AEE.user.js?v=${(Date.now()/10000).toFixed(0)}`);
```

</details>

---

## ⚠️ 注意事項 · Notes

實驗性功能（變形、鏡射、自由繪圖）皆由 AEE 本地渲染，沒有安裝 AEE 的人看不到效果；可能與部分物品不完全相容。目前僅自由繪圖能在設定中停用，變形與鏡射沒有獨立開關。  
Experimental features (transform, mirror, free draw) are rendered locally by AEE — anyone without AEE installed won't see the effect — and may not be fully compatible with every item. Only free draw can currently be disabled in Settings; transform and mirror have no individual toggle.

---

## 🙏 技術來源 · Credits

懸停外框、畫布拾取與任意變形功能（alpha 遮罩、像素命中、重疊部件輪換、拖移／縮放／旋轉控制框等）參考並改寫自 **星漣 XinLian132243 / BCMod**：<https://github.com/XinLian132243/BCMod>

The hover outline, canvas picking, and free-transform controls were adapted from **XinLian132243 (星漣) / BCMod**: <https://github.com/XinLian132243/BCMod>

---

## 🧭 開發文件 · Developer Documentation

- [AEE 架構與擴充指南](./docs/說明/architecture.md)
- [文件分類與未完成事項](./docs/README.md)
- [互動式功能分支圖](./docs/說明/aee-architecture.html)

---

## 📄 授權 · License

本專案採用自訂授權條款（借鑑 GPLv3 的著佐權精神，並附加商業使用之實質修改門檻），並非 MIT、也非官方 GPLv3，完整條文請見 [LICENSE](./LICENSE)。散布或修改本專案時，請保留授權聲明並標示原作者與協力者。  
This project uses a custom license (GPLv3-inspired copyleft, plus a substantial-modification clause for commercial use) — it is neither MIT nor official GPLv3. See [LICENSE](./LICENSE) for the full text. Any redistribution or modification must retain the license notice and credit the original author and contributors.

Copyright © 2026 Likolisu · Contributors: InkerBot, Tao MUSE

---

🐾 Made with 🐾 by **Likolisu**
