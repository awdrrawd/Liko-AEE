# AEE 拾取與懸停實作說明

本文件描述 AEE 目前的服裝／道具拾取、部件標籤、懸停閃爍與外框流程。它記錄完成後的架構，不記錄試錯過程；未完成項目另見 [未完成事項](../代改進/unfinished-items.md)。

## 功能邊界

AEE 有三種相關但不同的行為：

1. 整件拾取：在 Appearance 普通模式中，點擊角色上的服裝並開啟該群組編輯器。
2. 部件拾取：編輯單一物品時，以像素命中或詳細標籤選取 Asset Layer。
3. 懸停提示：滑過服裝列或部件列時，讓目標閃爍並繪製外框。

拾取與外框需要知道圖片的實際像素、畫面座標與疊放順序；閃爍則是在 BC 建立角色 Canvas 時暫時覆寫 layer opacity。兩者共享角色、物品與部件辨識，但不應合併成同一個渲染實作。

## 主要模組

- `src/controllers/appearancePickerController.ts`
  - 收集繪圖資料、提交 frame、像素命中、標籤配置、外框與點擊處理。
- `src/hooks/drawingHooks.ts`
  - 在 `GLDrawImage` 捕捉 WebGL 圖片；這是一般 BC 圖層的主要來源。
- `src/hooks/appearanceHooks.ts`
  - 捕捉 `DrawCharacter` 的角色位置。
  - 在 `AppearanceRun` 與 `DialogDraw` 結尾提交資料並畫 overlay。
  - 攔截 Appearance、Common 與 Dialog 點擊。
  - `DrawImageCanvas` 是動態／2D Canvas 圖層的補充來源，不是 `GLDrawImage` 的重複 hook。
- `src/hooks/renderHooks.ts`
  - 透過 `CommonDrawResolveLayerColor` 保存正在渲染的 item 與 layer index。
  - 透過 BeforeDraw 結果套用懸停 opacity。
- `src/controllers/uiController.ts`
  - 管理部件閃爍 animation frame 與整件服裝閃爍。
- `src/components/layers/LayerButtonRow.tsx`
  - 將面板列的 enter／leave 同時送往閃爍與外框。

## 角色與畫面生命週期

`pickerCharacter()` 統一呼叫 `getCurrentCharacter()`：

- Appearance 服裝畫面使用 `CharacterAppearanceSelection`。
- Item／拘束道具的 Dialog 染色畫面使用 `runtime.itemColorChar`。

整件服裝拾取只允許在 Appearance 的服裝列表模式。部件拾取則同時支援 Appearance 與 Dialog。

每個畫面更新依序執行：

1. `DrawCharacter` 記錄角色在 MainCanvas 上的 `x/y/zoom/heightResize`。
2. BC 建立角色 Canvas 時，AEE 從 `CommonDrawResolveLayerColor` 取得目前 item／layer。
3. `GLDrawImage` 或必要的 `DrawImageCanvas` 將 URL、最終位置與 drawing order 放入暫存 frame。
4. `AppearanceRun` 或 `DialogDraw` 結尾提交非空 frame。
5. 使用提交後的資料執行滑鼠命中、詳細標籤與外框繪製。

BC 同一畫面更新可能額外呼叫 `DrawCharacter`，卻沒有產生可捕捉圖層。因此提交時不能用「有 DrawCharacter」作為清空舊 frame 的依據；只有取得新的圖片資料時才替換有效 capture。

## Capture 與快取

- `captures`：目前角色 frame 中，以 Asset 分組的圖片，用於整件拾取。
- `layerCaptures`：目前編輯物品中，以 layer index 分組的圖片，用於部件拾取、標籤與外框。
- `frame`／`layerFrame`：尚未提交的當前繪製資料。
- `lastVisibleCaptures`：每個穿戴群組最後一次非透明圖片。懸停閃爍可能把當前 layer 畫成 `Alpha=0`，此快取讓外框仍可持續顯示。

圖片歸屬優先使用渲染中的 `currentDrawLayerItem.Asset`，不以物品名稱或共用圖片 URL 合併同名槽位。部件 capture 只接受目前編輯的 Item；已知正在繪製其他 Item 時，不得退回檔名配對。缺少渲染身分時，檔名 fallback 只接受唯一 Asset，避免把同名物品猜成第一個槽位。`node scripts/test-picker-item-identity.mjs` 涵蓋同名、共用 URL、切換編輯槽位與模糊 fallback。

`lastVisibleCaptures` 只能供目前仍穿戴的相同 Asset 使用。每次提交都會根據角色 `Appearance` 剔除已移除物品，使用前也再次比對目前群組的 Asset，避免脫下物品後留下外框。

`CharacterLoadCanvas` 會讓目前 frame 失效，但詳細標籤的點擊框保留到下一次 overlay 繪製。這可避免畫面仍看得到標籤、點擊框卻被提前清除的短暫狀態。

## 座標與像素命中

圖片座標來自 BC 的實際繪圖邊界。BC 目前在 `CommonDraw` 先把 `TranslationX/Y` 加進傳入座標，`GLDrawImage` 建立矩陣時又套用一次，因此 AEE 保存位置時也必須加入第二次 translation，才能和畫面一致。

角色局部 Canvas 與 MainCanvas 之間由 `canvasMap()` 轉換，包含角色位置、縮放、HeightRatio、overflow 與 Appearance offset。

每張圖片第一次使用時會建立低解析度 alpha mask：

- alpha 大於門檻的像素視為可命中。
- mask 以 4×4 像素取樣降低記憶體與每幀成本。
- 命中重疊圖層時，先依 Appearance drawing order，再依可見面積排序。

## 詳細標籤

詳細模式從每個 layer 的 alpha bounds 建立錨點，並執行以下配置：

- 標籤完整限制在 MainCanvas 的 Y=50–950。
- 底部不足時由後往前回擠並縮小列間距。
- 人物靠近畫布邊緣時優先使用空間較大的一側。
- 讀取 AEE Shadow DOM 中可見 `.aee-control` 的實際邊界；候選標籤碰到控制面板或調色盤時換邊。
- 所有連線先畫，再畫所有標籤，確保連線永遠位於標籤下層。
- 懸停標籤時同步加亮標籤外框、連線與物件外框，並可依設定啟動 opacity 閃爍。

標籤的完整矩形會寫入 `layerLabels`。點擊和事件攔截都使用同一份矩形，因此文字區與空白區的行為一致。

## 拖曳與狀態規則

- `activeDrag` 存在時，拾取暫停，但按鈕保留顯示。
- 拖曳結束後依原本的 `layerPickerMode` 自動恢復。
- `off`：不做部件拾取，也不建立標籤點擊區。
- `normal`：直接在角色像素上選取部件。
- `detail`：顯示標籤，同時允許標籤與角色像素選取。
- Item Dialog 目前循環為 `off → detail → off`，因為 BC 的 Dialog 點擊分派會讓角色區的一般拾取不夠可靠。

## 懸停閃爍與外框

部件列懸停有兩個獨立輸出：

- `startHoverHighlight()` 建立週期性 opacity overrides，呼叫 `CharacterLoadCanvas()` 重建角色 Canvas。
- `setLayerPanelHover()` 保存需要畫外框的 layer id；外框使用 picker capture 的 alpha 圖形。

設定可以只啟用外框、不啟用閃爍，因此兩個輸出不能互相作為啟用條件。群組 layer 使用 `getLayerGroupMembers()` 展開，讓閃爍與外框選取相同的一組部件。

整件服裝列表的懸停使用另一組 `hoverChar*` runtime 狀態，因為它以 AssetGroup 為單位，不是正在編輯物品中的 layer id。

右側面板的懸停外框由 `hoverOutlinePanel` 獨立控制，閃爍由 `hoverHighlightChar` 控制；任一啟用時追蹤 `hoverCharGroup`，只有閃爍啟用才啟動 opacity 動畫。拾取外框由拾取功能控制，不受面板外框開關影響。`hoverOutlineColor` 只決定共用顏色，預設跟隨主題，不含「關閉」。舊版 off 遷移為主題色且面板外框關閉，既有選色則保留並啟用面板外框。切換閃爍設定時重新判定目前列，避免游標未移動時無法啟動動畫。`node scripts/test-panel-hover-outline.mjs` 驗證四種開關組合與懸停目標清除。

## 已知限制與後續風險

1. 2026-09-02 起，GLDrawImage 的 capture 會收集最終 shader matrix，包含 AEE skew／flip 與 mirror-copy 的額外繪製。像素點擊反算至原圖 alpha mask；外框與詳細標籤使用相同矩陣。自動回歸通過，使用者已確認遊戲內修復。
2. BC 原始 `GLDrawImage` 對 Mirror + Translation 有官方 FIXME；拾取直接使用最終矩陣，不再自行猜測倍數。矩陣擷取只在當次 GLDrawImage 呼叫內有效，以免混入其他角色或後處理。缺少矩陣時保留原有位移 fallback；此 fallback 不保證非標準繪製的完整變形。
   BC 將正常／眨眼畫面並排放在 WebGL 畫布；擷取矩陣後必須扣除 `GLDrawImage` 第六參數 `offsetX`，才是角色座標。回歸測試涵蓋 1000px 畫布的兩個區域、未旋轉與旋轉，以及 drawing hook 的參數傳遞。
3. 動態 AfterDraw canvas、模組化物品及第三方 mod 可能不使用標準 URL 或標準 GL 路徑；`DrawImageCanvas` 與 current layer context 是必要 fallback。
4. `Alpha=0` 的閃爍 frame 不可覆蓋最後可見 capture，否則外框會跟著消失。
5. 不應在每次 requestAnimationFrame 重建 alpha mask；目前 `alphaCache` 以 URL 快取並限制數量。

## 回歸測試

- Appearance 普通模式：開關整件拾取後，游標狀態與點擊行為同步停止／恢復。
- 服裝編輯：normal／detail 都能選到正確 layer。
- Item Dialog：detail 標籤持續顯示，文字與空白區均可點擊。
- 編輯他人道具：先開過自己的外觀頁再進入對方的 ItemColor，任意變形外框應出現；刷新自己不可清除對方的圖層快取。`getCurrentCharacter()` 優先使用目前編輯物件的 ItemColor 擁有者，避免殘留的 `CharacterAppearanceSelection` 指向自己。可執行 `node scripts/test-editor-character.mjs` 驗證角色選擇與刷新目標。
- 啟用位移後：物件、標籤錨點、外框與命中區同步移動。
- Crafting：只記錄通過顯示判斷且套用視圖偏移後的 DrawCharacter 座標；雙預覽以最後繪製的全身預覽為編輯目標，不以倍率大小選取。隱藏近景時不可擷取其位置；只顯示近景時使用近景位置。`node scripts/test-crafting-preview.mjs` 涵蓋預覽顯示組合、偏移與縮放，使用者已確認 Crafting 對齊。DrawCharacter 的顯示與偏移處理共用單一擷取出口，避免各分支再加入提前擷取的補丁。
- 旋轉、非等比縮放、翻轉與斜切後：可見像素可選取、透明區域與舊位置不誤判；紫色外框跟隨圖案。
- 鏡像複製：原圖與副本皆可命中同一物件／圖層，外框涵蓋兩者。
- 開始拖曳：拾取暫停；結束拖曳：原模式恢復。
- 面板列懸停：外框與可選閃爍指向相同 layer group。
- 移除或更換物品：舊外框、標籤及點擊框不殘留。
- 人物靠左右邊界、控制面板展開／收合、調色盤移動時：標籤避讓正確。
- 關閉外框或閃爍設定時：另一項功能仍可獨立運作。
