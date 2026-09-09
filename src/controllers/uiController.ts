import type {AeeLayerOverride, AeeState, AeeTab, DragMode, EditToolMode, LayerId, ToolbarLayoutMode, TransformOverlayMode} from '@/core/types';
import {getState, mutateState} from '@/core/store';
import {settings} from '@/core/settings';
import {
  applyPriority,
  batchLayerEdits,
  clampPriority,
  ensureLayerOverrides,
  ensureOpacityArray,
  getAssetBaseXY,
  getCurrentCharacter,
  getCurrentItem,
  getLayerColor,
  getLayerGroupMembers,
  getLayerOverride,
  getOpacity,
  isGroupLocked,
  refreshAfterLayerEdit,
  refreshCurrentCharacter,
  setLayerColor,
  setLayerOpacityAtIndex,
  setLayerOverride,
} from '@/core/bc';
import {runtime} from '@/core/runtime';
import {forceUiUpdate, syncCanvasRect, syncCurrentContext} from '@/core/context';
import {clearCopyBuffer} from '@/controllers/copyPasteController';
import {loadAppearanceQuickSettings, saveAppearanceQuickSetting} from '@/core/appearanceQuickSettings';
import {getLayerPickerSetting} from '@/core/viewSettings';
import {
  clampPanelPosition,
  getAnchoredPanelPosition,
  type OverlayAnchor,
  PARTS_PANEL_MIN_HEIGHT,
  PARTS_PANEL_WIDTH,
  TOOL_PANEL_MIN_HEIGHT,
  TOOL_PANEL_WIDTH,
} from '@/core/overlay';
import {alignTouchBlocker, hideTouchBlocker, showTouchBlocker} from '@/controllers/dragController';
import {clamp} from '@/util/math';
import {clearCanvasGesture, isCanvasGestureActive} from '@/core/editorToolState';

type AssetPriority = Asset & { DrawingPriority?: number };

export function setTab(tab: AeeTab) {
  stopHoverHighlight(true);
  mutateState(draft => {
    draft.tab = tab;
  });
}

export function selectLayer(layerId: LayerId) {
  stopHoverHighlight(true);
  mutateState(draft => {
    draft.selectedLayer = layerId;
  });
}

export function deselectLayer() {
  stopHoverHighlight(true);
  mutateState(draft => {
    draft.selectedLayer = null;
  });
}

export function toggleCollapse() {
  mutateState(draft => {
    draft.collapsed = !draft.collapsed;
  });
}

function clearCanvasToolState(draft: AeeState) {
  clearCanvasGesture(draft);
  draft.transformOverlay.mode = null;
  draft.opacityOverlay.open = false;
  draft.layersOverlay.open = false;
}

function finishCanvasToolTransition(active: boolean) {
  runtime.panelHoverLayerIdx = null;
  stopHoverHighlight(true);
  if (active) showTouchBlocker();
  else hideTouchBlocker();
  refreshCurrentCharacter();
}

export function togglePartsBrowser(open?: boolean) {
  mutateState(draft => {
    draft.partsBrowser.open = open ?? !draft.partsBrowser.open;
  });
}

function getClampedCurrentPanelPosition(left: number, top: number, panelWidth = TOOL_PANEL_WIDTH, panelMinHeight = TOOL_PANEL_MIN_HEIGHT) {
  const rect = getState().canvasRect;
  return rect ? clampPanelPosition(left, top, rect, panelWidth, panelMinHeight) : {left, top};
}

export function togglePartsOpen(open?: boolean, anchor?: OverlayAnchor) {
  syncCanvasRect();
  const current = getState();
  const nextOpen = open ?? !current.partsOpen;
  mutateState(draft => {
    draft.partsOpen = nextOpen;
    if (nextOpen && draft.canvasRect) {
      const scale = draft.canvasRect.width / 2000;
      if (draft.toolbarLayout === 'neat') {
        draft.partsLeft = (80 + 350 + 12) * scale;
        draft.partsTop = 80 * scale;
      } else if (anchor) {
        const pos = getAnchoredPanelPosition(draft.canvasRect, anchor, PARTS_PANEL_WIDTH, PARTS_PANEL_MIN_HEIGHT);
        draft.partsLeft = pos.left;
        draft.partsTop = pos.top;
      } else {
        draft.partsLeft = Math.max(8, (draft.canvasRect.width - PARTS_PANEL_WIDTH * scale) / 2);
        draft.partsTop = Math.max(8, (draft.canvasRect.height - PARTS_PANEL_MIN_HEIGHT * scale) / 2);
      }
    }
  });
}

export function movePartsPanel(left: number, top: number) {
  const pos = getClampedCurrentPanelPosition(left, top, PARTS_PANEL_WIDTH, PARTS_PANEL_MIN_HEIGHT);
  mutateState(draft => {
    draft.partsLeft = pos.left;
    draft.partsTop = pos.top;
  });
}

export function toggleTransformOverlay(mode: TransformOverlayMode, anchor?: OverlayAnchor) {
  const item = getCurrentItem();
  if (!item) return;
  // Locked body parts (official FixedPosition) must not expose transform tools.
  if (isGroupLocked(getState().selectedLayer)) return;
  syncCanvasRect();
  const current = getState();
  const nextMode = current.transformOverlay.mode === mode ? null : mode;
  if (nextMode) {
    runtime.panelHoverLayerIdx = null;
    stopHoverHighlight(true);
  }
  mutateState(draft => {
    clearCanvasToolState(draft);
    draft.editTool = nextMode ? mode : null;
    draft.transformOverlay.mode = nextMode;
    if (nextMode) {
      if (draft.selectedLayer === null) draft.selectedLayer = 'all';
      if (anchor && draft.canvasRect) {
        const pos = getAnchoredPanelPosition(draft.canvasRect, anchor);
        draft.transformOverlay.left = pos.left;
        draft.transformOverlay.top = pos.top;
      }
    }
  });
  finishCanvasToolTransition(false);
}

export function closeTransformOverlay() {
  mutateState(draft => {
    draft.transformOverlay.mode = null;
    if (draft.toolbarLayout === 'free' && (draft.editTool === 'xy' || draft.editTool === 'rot' || draft.editTool === 'scale' || draft.editTool === 'skew' || draft.editTool === 'mirror')) draft.editTool = null;
  });
  finishCanvasToolTransition(false);
}

export function moveTransformOverlay(left: number, top: number) {
  const pos = getClampedCurrentPanelPosition(left, top);
  mutateState(draft => {
    draft.transformOverlay.left = pos.left;
    draft.transformOverlay.top = pos.top;
  });
}

export function setActiveDrag(mode: DragMode) {
  // Locked body parts (official FixedPosition) must not start canvas drags.
  if (mode && isGroupLocked(getState().selectedLayer)) return;
  const next = getState().activeDrag === mode ? null : mode;
  mutateState(draft => {
    if (next) {
      clearCanvasToolState(draft);
      draft.editTool = mode;
    }
    draft.activeDrag = next;
    draft.rotationOverlayOpen = next === 'rot';
  });
  finishCanvasToolTransition(!!next);
}

export function openLayersOverlay(anchor?: OverlayAnchor) {
  const item = getCurrentItem();
  if (!item) return;
  syncCanvasRect();
  mutateState(draft => {
    const opening = !draft.layersOverlay.open;
    clearCanvasToolState(draft);
    draft.editTool = opening ? 'layers' : null;
    if (!opening) return;
    draft.layersOverlay.open = true;
    if (draft.selectedLayer === null) draft.selectedLayer = 'all';
    if (anchor && draft.canvasRect) {
      const pos = getAnchoredPanelPosition(draft.canvasRect, anchor);
      draft.layersOverlay.left = pos.left;
      draft.layersOverlay.top = pos.top;
    }
  });
  finishCanvasToolTransition(false);
}

export function closeLayersOverlay() {
  mutateState(draft => { draft.layersOverlay.open = false; if (draft.editTool === 'layers') draft.editTool = null; });
  finishCanvasToolTransition(false);
}

export function moveLayersOverlay(left: number, top: number) {
  const pos = getClampedCurrentPanelPosition(left, top);
  mutateState(draft => { draft.layersOverlay.left = pos.left; draft.layersOverlay.top = pos.top; });
}

export function setScaleLock(value?: boolean) {
  mutateState(draft => {
    draft.scaleLock = value ?? !draft.scaleLock;
  });
}

export function openColorPicker(initialHex: string, onLiveChange: (hex: string, preview?: boolean) => void, bcMode = false, opacityPct = 100, isDefault = false) {
  runtime.colorPickerLiveChange = onLiveChange;
  runtime.colorPickerInitialHex = initialHex || '#FFFFFF';
  syncCanvasRect();
  mutateState(draft => {
    draft.colorPicker.sessionId += 1;
    draft.colorPicker.open = true;
    draft.colorPicker.bcMode = bcMode;
    draft.colorPicker.collapsed = false;
    draft.colorPicker.hex = initialHex || '#FFFFFF';
    draft.colorPicker.initialHex = initialHex || '#FFFFFF';
    draft.colorPicker.opacityPct = opacityPct;
    draft.colorPicker.isDefault = isDefault;
    draft.colorPicker.eyedropperActive = false;
  });
}

export function closeColorPicker(commit = true) {
  const state = getState();
  if (!commit && runtime.colorPickerLiveChange) {
    safeCallLiveChange(state.colorPicker.initialHex, false);
  }
  mutateState(draft => {
    draft.colorPicker.open = false;
    draft.colorPicker.bcMode = false;
    draft.colorPicker.collapsed = false;
    draft.colorPicker.eyedropperActive = false;
  });
  runtime.colorPickerLiveChange = null;
}

export function setEyedropperActive(active: boolean) {
  mutateState(draft => {
    draft.colorPicker.eyedropperActive = active;
  });
}

function safeCallLiveChange(hex: string, preview: boolean) {
  if (!runtime.colorPickerLiveChange) return;
  try {
    runtime.colorPickerLiveChange(hex, preview);
  } catch (err) {
    console.warn('[AEE] colorPickerLiveChange threw, closing picker:', err);
    runtime.colorPickerLiveChange = null;
    mutateState(draft => { draft.colorPicker.open = false; draft.colorPicker.bcMode = false; });
  }
}

export function previewColorPickerValue(hex: string, opacityPct?: number) {
  const state = getState();
  const nextOpacityPct = opacityPct ?? state.colorPicker.opacityPct;
  runtime.colorPickerAlpha = Math.round((nextOpacityPct / 100) * 255);
  safeCallLiveChange(hex, true);
}

export function setColorPickerValue(hex: string, opacityPct?: number) {
  const state = getState();
  const nextOpacityPct = opacityPct ?? state.colorPicker.opacityPct;
  runtime.colorPickerAlpha = Math.round((nextOpacityPct / 100) * 255);
  if (state.colorPicker.hex === hex && state.colorPicker.opacityPct === nextOpacityPct) {
    safeCallLiveChange(hex, false);
    return;
  }
  mutateState(draft => {
    draft.colorPicker.hex = hex;
    if (opacityPct !== undefined) draft.colorPicker.opacityPct = opacityPct;
  });
  safeCallLiveChange(hex, false);
}

export function setColorPickerCollapsed(collapsed: boolean) {
  mutateState(draft => {
    draft.colorPicker.collapsed = collapsed;
  });
}

export function moveColorPicker(left: number, top: number) {
  mutateState(draft => {
    draft.colorPicker.left = left;
    draft.colorPicker.top = top;
  });
}

export function openLayerColorPicker(layerId: LayerId) {
  const item = getCurrentItem();
  const storedColor = getLayerColor(item, layerId);
  const isDefault = !storedColor || storedColor === 'Default';
  const currentColor = (storedColor && storedColor !== 'Default' ? storedColor : null) || '#FFFFFF';
  openColorPicker(currentColor, (hex, preview) => {
    const currentItem = getCurrentItem();
    if (!currentItem) return;
    setLayerColor(currentItem, layerId, hex);
    if (!preview) forceUiUpdate();
  }, false, 100, isDefault);
}

export function openSelectedLayerColorPicker() {
  const state = getState();
  openLayerColorPicker(state.selectedLayer ?? 'all');
}

export function openOpacityOverlay(anchor?: OverlayAnchor) {
  const item = getCurrentItem();
  const selected = getState().selectedLayer;
  if (!item) return;
  syncCanvasRect();
  mutateState(draft => {
    clearCanvasToolState(draft);
    draft.editTool = 'opacity';
    draft.opacityOverlay.open = true;
    if (selected === null) draft.selectedLayer = 'all';
    if (anchor && draft.canvasRect) {
      const pos = getAnchoredPanelPosition(draft.canvasRect, anchor);
      draft.opacityOverlay.left = pos.left;
      draft.opacityOverlay.top = pos.top;
    }
  });
  finishCanvasToolTransition(false);
}

export function closeOpacityOverlay() {
  mutateState(draft => {
    draft.opacityOverlay.open = false;
    if (draft.toolbarLayout === 'free' && draft.editTool === 'opacity') draft.editTool = null;
  });
  finishCanvasToolTransition(false);
}

export function moveOpacityOverlay(left: number, top: number) {
  const pos = getClampedCurrentPanelPosition(left, top);
  mutateState(draft => {
    draft.opacityOverlay.left = pos.left;
    draft.opacityOverlay.top = pos.top;
  });
}

export function setOpacity(layerId: LayerId, pct: number) {
  const item = getCurrentItem();
  if (!item) return;
  setLayerOverride(item, layerId, 'Opacity', clamp(pct, 0, 100) / 100);
  forceUiUpdate();
}

export function stepOpacity(layerId: LayerId, delta: number) {
  const item = getCurrentItem();
  if (!item) return;
  const current = getLayerOverride(item, layerId);
  const next = clamp(Math.round((current.Opacity ?? 1) * 100) + delta, 0, 100);
  setOpacity(layerId, next);
}

type EditPropertyKey = 'x' | 'y' | 'sx' | 'sy' | 'rot' | 'skx' | 'sky' | 'fcx' | 'fcy';

interface EditPropertyDef {
  /** 讀出目前值，作為 stepEditProperty 的 delta 起點 */
  get(layerOverride: AeeLayerOverride, bx: number, by: number): number;
  /** 套用格式化/夾範圍後的新值到 layer override */
  apply(item: Item, idx: LayerId, value: number): void;
}

const EDIT_PROPERTIES: Record<EditPropertyKey, EditPropertyDef> = {
  x: {
    get: (lo, bx) => lo.DrawingLeft?.[''] ?? bx,
    apply: (item, idx, v) => setLayerOverride(item, idx, 'DrawingLeft', {'': Math.round(v)}),
  },
  y: {
    get: (lo, _bx, by) => lo.DrawingTop?.[''] ?? by,
    apply: (item, idx, v) => setLayerOverride(item, idx, 'DrawingTop', {'': Math.round(v)}),
  },
  sx: {
    get: lo => lo.ScaleX ?? 1,
    apply: (item, idx, v) => setLayerOverride(item, idx, 'ScaleX', Math.max(0.05, +v.toFixed(2))),
  },
  sy: {
    get: lo => lo.ScaleY ?? 1,
    apply: (item, idx, v) => setLayerOverride(item, idx, 'ScaleY', Math.max(0.05, +v.toFixed(2))),
  },
  rot: {
    get: lo => lo.Rotation ?? 0,
    // BC native Rotation is [-180, 180] with hard clamping (not wrapping), so a
    // naive [0, 360) mapping makes 181..359 all clamp to 180. Normalize to the
    // [-180, 180] range instead: 181 -> -179, 359 -> -1, giving full 360° spin.
    apply: (item, idx, v) => {
      const n = ((Math.round(v) % 360) + 360) % 360;
      setLayerOverride(item, idx, 'Rotation', n > 180 ? n - 360 : n);
    },
  },
  skx: {
    get: lo => lo.SkewX ?? 0,
    apply: (item, idx, v) => setLayerOverride(item, idx, 'SkewX', +v.toFixed(1)),
  },
  sky: {
    get: lo => lo.SkewY ?? 0,
    apply: (item, idx, v) => setLayerOverride(item, idx, 'SkewY', +v.toFixed(1)),
  },
  fcx: {
    get: lo => lo.MirrorCopyAxisX ?? 0.5,
    apply: (item, idx, v) => setLayerOverride(item, idx, 'MirrorCopyAxisX', clamp(+v.toFixed(2), -10, 10)),
  },
  fcy: {
    get: lo => lo.MirrorCopyAxisY ?? 0.5,
    apply: (item, idx, v) => setLayerOverride(item, idx, 'MirrorCopyAxisY', clamp(+v.toFixed(2), -10, 10)),
  },
};

function isEditPropertyKey(ctrl: string): ctrl is EditPropertyKey {
  return Object.prototype.hasOwnProperty.call(EDIT_PROPERTIES, ctrl);
}

export function setEditProperty(ctrl: string, rawValue: number) {
  setEditProperties({[ctrl]: rawValue});
}

export function setEditProperties(values: Record<string, number>) {
  const state = getState();
  const item = getCurrentItem();
  const idx = state.selectedLayer;
  if (!item || idx === null) return;
  // Locked body parts (official FixedPosition) must not be transformed.
  if (isGroupLocked(idx)) return;
  batchLayerEdits(() => {
    for (const [ctrl, rawValue] of Object.entries(values)) {
      if (Number.isNaN(rawValue) || !isEditPropertyKey(ctrl)) continue;
      EDIT_PROPERTIES[ctrl].apply(item, idx, rawValue);
    }
  });
  forceUiUpdate();
}

export function stepEditProperty(ctrl: string, delta: number) {
  const state = getState();
  const item = getCurrentItem();
  const idx = state.selectedLayer;
  if (!item || idx === null || !isEditPropertyKey(ctrl)) return;
  // Locked body parts (official FixedPosition) must not be transformed.
  if (isGroupLocked(idx)) return;
  const def = EDIT_PROPERTIES[ctrl];
  const layerOverride = getLayerOverride(item, idx);
  const {bx, by} = getAssetBaseXY(item, idx);
  def.apply(item, idx, def.get(layerOverride, bx, by) + delta);
  forceUiUpdate();
}

export function resetEditProperty(ctrl: string, notify = true) {
  const state = getState();
  const item = getCurrentItem();
  const idx = state.selectedLayer;
  if (!item || idx === null) return;
  // Locked body parts (official FixedPosition) must not be transformed; opacity
  // ('op') stays editable everywhere.
  if (ctrl !== 'op' && isGroupLocked(idx)) return;
  ensureLayerOverrides(item);
  const count = item.Asset?.Layer?.length || 1;
  const indices = idx === 'all' ? Array.from({length: count}, (_, index) => index) : getLayerGroupMembers(item, parseInt(idx, 10));

  if (ctrl === 'x' || ctrl === 'y') {
    // Reset position back to the asset base. Delete BOTH the private
    // LayerOverrides entry and the native R131 TranslationX/TranslationY (stored
    // per layer as Property.LayerTranslationX[layerName] or at item level as
    // Property.TranslationX when the whole item was dragged). Deleting only the
    // private override left the native offset in place after a canvas drag
    // (which now writes the native property), making the reset/undo button
    // appear to do nothing.
    const key = ctrl === 'x' ? 'DrawingLeft' : 'DrawingTop';
    const nativeKey = ctrl === 'x' ? 'TranslationX' : 'TranslationY';
    const property = item.Property as (ItemProperties & Record<string, unknown>) | undefined;
    if (property) {
      if (idx === 'all') {
        delete property[nativeKey];
      } else {
        indices.forEach(index => {
          const layerName = item.Asset?.Layer?.[index]?.Name;
          if (item.Property?.LayerOverrides?.[index]) delete item.Property.LayerOverrides[index][key];
          if (layerName) {
            const layerValues = property[`Layer${nativeKey}`];
            if (layerValues && typeof layerValues === 'object') delete (layerValues as Record<string, number>)[layerName];
          }
        });
      }
    }
    refreshAfterLayerEdit();
  } else if (ctrl === 'op') {
    ensureOpacityArray(item);
    indices.forEach(index => {
      const def = item.Asset?.Layer?.[index]?.Opacity ?? 1;
      setLayerOpacityAtIndex(item, index, def);
    });
    refreshCurrentCharacter(true);
  } else if (ctrl === 'sx') setLayerOverride(item, idx, 'ScaleX', 1);
  else if (ctrl === 'sy') setLayerOverride(item, idx, 'ScaleY', 1);
  else if (ctrl === 'rot') setLayerOverride(item, idx, 'Rotation', 0);
  else if (ctrl === 'skx') setLayerOverride(item, idx, 'SkewX', 0);
  else if (ctrl === 'sky') setLayerOverride(item, idx, 'SkewY', 0);
  else if (ctrl === 'fcx') setLayerOverride(item, idx, 'MirrorCopyAxisX', 0.5);
  else if (ctrl === 'fcy') setLayerOverride(item, idx, 'MirrorCopyAxisY', 0.5);
  else if (ctrl === 'mc') {
    setLayerOverride(item, idx, 'MirrorCopyAxisX', 0.5);
    setLayerOverride(item, idx, 'MirrorCopyAxisY', 0.5);
  }
  if (notify) forceUiUpdate();
}

export function toggleMirror(key: 'FlipX' | 'FlipY' | 'MirrorCopy' | 'MirrorCopyV') {
  const state = getState();
  const item = getCurrentItem();
  if (!item || state.selectedLayer === null) return;
  // Locked body parts (official FixedPosition) must not be mirrored.
  if (isGroupLocked(state.selectedLayer)) return;
  const layerOverride = getLayerOverride(item, state.selectedLayer);
  setLayerOverride(item, state.selectedLayer, key, !layerOverride[key]);
  forceUiUpdate();
}

export function resetSelectedTransforms() {
  const state = getState();
  const item = getCurrentItem();
  if (!item || state.selectedLayer === null) return;
  // Locked body parts (official FixedPosition) must not reset transforms.
  if (isGroupLocked(state.selectedLayer)) return;
  batchLayerEdits(() => {
    resetEditProperty('x', false);
    resetEditProperty('y', false);
    setLayerOverride(item, state.selectedLayer!, 'ScaleX', 1);
    setLayerOverride(item, state.selectedLayer!, 'ScaleY', 1);
    setLayerOverride(item, state.selectedLayer!, 'Rotation', 0);
    setLayerOverride(item, state.selectedLayer!, 'SkewX', 0);
    setLayerOverride(item, state.selectedLayer!, 'SkewY', 0);
  });
  forceUiUpdate();
}

export function stepPriority(layerId: LayerId, delta: number) {
  const item = getCurrentItem();
  if (!item) return;
  const layers = item.Asset?.Layer || [];
  let current: number;
  if (layerId === 'all') {
    const override = item.Property?.OverridePriority;
    current = typeof override === 'number' ? override : getAssetDrawingPriority(item.Asset);
  } else {
    const index = parseInt(layerId, 10);
    const layerName = layers[index]?.Name ?? '';
    const override = item.Property?.OverridePriority;
    current = typeof override === 'object' && override?.[layerName] != null ? override[layerName] : (layers[index]?.Priority ?? 0);
  }
  applyPriority(item, layerId, current + delta);
  forceUiUpdate();
}

export function setPriority(layerId: LayerId, value: number) {
  const item = getCurrentItem();
  if (!item) return;
  applyPriority(item, layerId, value);
  forceUiUpdate();
}

export function resetPriority(layerId: LayerId) {
  const item = getCurrentItem();
  if (!item) return;
  const layers = item.Asset?.Layer || [];
  if (layerId === 'all') {
    if (item.Property) delete item.Property.OverridePriority;
  } else if (typeof item.Property?.OverridePriority === 'object') {
    getLayerGroupMembers(item, parseInt(layerId, 10)).forEach(index => {
      if (!layers[index]) return;
      const layerName = layers[index].Name ?? '';
      delete (item.Property!.OverridePriority as Record<string, number>)[layerName];
    });
    if (Object.keys(item.Property.OverridePriority).length === 0) delete item.Property.OverridePriority;
  }
  refreshAfterLayerEdit();
  forceUiUpdate();
}

export function installSettingEffects() {
  loadAppearanceQuickSettings();
  settings.hoverHighlight.onChange(enabled => {
    if (!enabled) stopHoverHighlight(true);
  });
  settings.hoverHighlightChar.onChange(() => {
    // Re-evaluate the current row even when flashing is enabled while an
    // outline-only hover already owns the group.
    stopHoverCharHighlight();
  });
  settings.hoverOutlinePanel.onChange(enabled => {
    // Capture geometry immediately when outlines are enabled after the
    // character canvas was already built with all picking features disabled.
    const character = getCurrentCharacter();
    if (enabled && character) CharacterLoadCanvas(character);
  });
  settings.hoverTryOn.onChange(enabled => {
    if (!enabled) stopHoverTryOn();
    try {
      if (typeof AppearanceMenuBuild === 'function' && CharacterAppearanceSelection) {
        AppearanceMenuBuild(CharacterAppearanceSelection);
      }
    } catch {
      // The appearance menu may not exist while settings are changed elsewhere.
    }
  });
  settings.hairCharacterPreview.onChange(enabled => {
    // Enabling the master switch re-activates the preview so the button shows
    // up in the "on" state; disabling it just hides the toggle button.
    if (enabled) settings.characterPreviewActive.set(true);
    try {
      if (typeof AppearanceMenuBuild === 'function' && CharacterAppearanceSelection) {
        AppearanceMenuBuild(CharacterAppearanceSelection);
      }
    } catch {
      // The appearance menu may not exist while settings are changed elsewhere.
    }
  });
  settings.characterPreviewActive.onChange(() => {
    try {
      if (typeof AppearanceMenuBuild === 'function' && CharacterAppearanceSelection) {
        AppearanceMenuBuild(CharacterAppearanceSelection);
      }
      // AppearancePreviewUseCharacter() is hooked and now reflects the new
      // toggle state, but AppearancePreviews[] is a cache that BC only
      // rebuilds on cloth-mode entry, page turns, or permission-mode entry.
      // Without this, flipping the toggle while already looking at the Cloth
      // grid has no visible effect until the next of those events fires.
      if (
        typeof AppearancePreviewBuild === 'function' &&
        CharacterAppearanceMode === 'Cloth' &&
        CharacterAppearanceSelection?.FocusGroup
      ) {
        AppearancePreviewBuild(CharacterAppearanceSelection, true);
      }
    } catch {
      // The appearance menu may not exist while settings are changed elsewhere.
    }
  });
  settings.enableCopyPaste.onChange(enabled => {
    if (!enabled) clearCopyBuffer();
  });
  settings.hideLscgLayers.onChange(() => applyLscgLayersVisibility());
  installLscgLayersObserver();
  applyLscgLayersVisibility();
}

let lscgLayersObserver: MutationObserver | null = null;

function installLscgLayersObserver() {
  if (lscgLayersObserver || !document.body) return;
  lscgLayersObserver = new MutationObserver(records => {
    const panelAdded = records.some(record => Array.from(record.addedNodes).some(node =>
      node instanceof Element && (node.id === 'lscg-layers' || !!node.querySelector('#lscg-layers'))
    ));
    if (panelAdded) applyLscgLayersVisibility();
  });
  lscgLayersObserver.observe(document.body, {childList: true, subtree: true});
}

export function cycleLayerPickerMode() {
  // Item/restraint colour editing happens inside a Dialog (ChatRoom, Crafting,
  // Shop2, SlaveCollar, ...). A plain click there can land on BC's own
  // interactive body-zone cells outside the colour panel instead of being
  // routed to AEE, so "normal" single-click picking is unreliable for Item
  // assets. "detail" draws its own labelled hit boxes off to the side and
  // does not have that problem, so items cycle straight between off/detail.
  const isItem = getCurrentItem()?.Asset?.Group?.Category === 'Item';
  const order = isItem ? (['off', 'detail'] as const) : (['off', 'normal', 'detail'] as const);
  const pickerSetting = getLayerPickerSetting();
  let nextMode = pickerSetting.get();
  mutateState(draft => {
    const currentIndex = order.indexOf(draft.layerPickerMode as typeof order[number]);
    nextMode = order[(Math.max(currentIndex, 0) + 1) % order.length];
    draft.layerPickerMode = nextMode;
  });
  pickerSetting.set(nextMode);
}

export function applyLscgLayersVisibility() {
  const item = getCurrentItem();
  const lscg = (Player as PlayerCharacter & {
    LSCG?: {GlobalModule?: {enabled?: boolean}; OpacityModule?: {enabled?: boolean}};
  })?.LSCG;
  const hasLscgOpacityTool = window.LSCG_Loaded === true
    && lscg?.GlobalModule?.enabled === true
    && (lscg?.OpacityModule?.enabled ?? true);
  const hasAeeReplacement = getState().visible && !!item?.Asset?.Layer?.length;
  const el = document.getElementById('lscg-layers');
  if (!el) return;
  el.style.display = settings.hideLscgLayers.get() && hasLscgOpacityTool && hasAeeReplacement ? 'none' : '';
}

export function startHoverHighlight(item: Item, layerIdx: LayerId) {
  if (!item) return;
  stopHoverHighlight(false);
  const indices = layerIdx === 'all'
    ? Array.from({length: item.Asset?.Layer?.length || 1}, (_, index) => index)
    : getLayerGroupMembers(item, parseInt(layerIdx, 10));
  runtime.hoverHighlightStartTime = performance.now();

  const animate = () => {
    if (runtime.hoverHighlightAnimFrame === null) return;
    const t = ((performance.now() - runtime.hoverHighlightStartTime!) % 1500) / 1500;
    const opacity = 0.5 + 0.5 * Math.cos(t * Math.PI * 2);
    const overrides = new Map<number, number>();
    indices.forEach(index => overrides.set(index, opacity));
    runtime.hoverFlashData = {item, overrides};
    try {
      const primary = CharacterAppearanceSelection || runtime.itemColorChar;
      if (primary) CharacterLoadCanvas?.(primary);
      if (runtime.itemColorChar && runtime.itemColorChar !== primary) CharacterLoadCanvas?.(runtime.itemColorChar);
    } catch {
      // Ignore transient render errors.
    }
    runtime.hoverHighlightAnimFrame = requestAnimationFrame(animate);
  };

  runtime.hoverHighlightAnimFrame = requestAnimationFrame(animate);
}

export function stopHoverHighlight(refresh = false) {
  if (runtime.hoverHighlightAnimFrame !== null) {
    cancelAnimationFrame(runtime.hoverHighlightAnimFrame);
    runtime.hoverHighlightAnimFrame = null;
  }
  runtime.hoverFlashData = null;
  runtime.hoverHighlightStartTime = null;
  if (refresh) {
    try {
      CharacterLoadCanvas?.(CharacterAppearanceSelection || runtime.itemColorChar);
    } catch {
      // Ignore transient render errors.
    }
  }
}

export function startHoverCharHighlight(groupName: AssetGroupName) {
  const character = CharacterAppearanceSelection;
  if (!character) return;
  runtime.hoverCharCharacter = character;
  runtime.hoverCharStartTime = performance.now();
  const item = InventoryGet(character, groupName);
  if (!item) {
    startHoverCharFallback(groupName);
    return;
  }
  const layerCount = item.Asset?.Layer?.length || 1;
  runtime.hoverCharActive = true;
  const animate = () => {
    if (!runtime.hoverCharActive || runtime.hoverCharGroup !== groupName) return;
    const t = ((performance.now() - runtime.hoverCharStartTime!) % 1500) / 1500;
    const opacity = 0.2 + 0.8 * Math.abs(Math.cos(t * Math.PI));
    const overrides = new Map<number, number>();
    for (let i = 0; i < layerCount; i++) overrides.set(i, opacity);
    runtime.hoverCharFlashData = {item, overrides};
    CharacterLoadCanvas(character);
    runtime.hoverCharAnimFrame = requestAnimationFrame(animate);
  };
  runtime.hoverCharAnimFrame = requestAnimationFrame(animate);
}

function startHoverCharFallback(groupName: string) {
  const character = CharacterAppearanceSelection;
  const blink = () => {
    if (runtime.hoverCharGroup !== groupName) return;
    if (runtime.hoverCharHiddenGroup.has(groupName)) runtime.hoverCharHiddenGroup.delete(groupName);
    else runtime.hoverCharHiddenGroup.add(groupName);
    if (character) CharacterLoadCanvas(character);
    runtime.hoverCharTimer = window.setTimeout(blink, runtime.hoverCharHiddenGroup.has(groupName) ? 200 : 800);
  };
  runtime.hoverCharHiddenGroup.add(groupName);
  if (character) CharacterLoadCanvas(character);
  runtime.hoverCharTimer = window.setTimeout(blink, 200);
}

export function stopHoverCharHighlight() {
  // Extended-item/restraint dialogs can clear CharacterAppearanceSelection before
  // the hover ends. Keep the original target so its cached flashing canvas is rebuilt.
  const character = runtime.hoverCharCharacter || CharacterAppearanceSelection;
  runtime.hoverCharActive = false;
  runtime.hoverCharFlashData = null;
  runtime.hoverCharCharacter = null;
  runtime.hoverCharGroup = null;
  runtime.hoverCharStartTime = null;
  runtime.hoverCharHiddenGroup.clear();
  if (runtime.hoverCharAnimFrame !== null) {
    cancelAnimationFrame(runtime.hoverCharAnimFrame);
    runtime.hoverCharAnimFrame = null;
  }
  if (runtime.hoverCharTimer !== null) {
    clearTimeout(runtime.hoverCharTimer);
    runtime.hoverCharTimer = null;
  }
  if (character) CharacterLoadCanvas?.(character);
}

export function applyHoverTryOn(
  item: DialogInventoryItem,
  character: Character | null = CharacterAppearanceSelection,
  copyItemData = false,
) {
  const asset = item?.Asset;
  if (!character || !asset?.Group?.Name) return;
  const group = asset.Group.Name;
  const assetName = asset.Name;
  const restraint = asset.Group.Category === 'Item';
  if (runtime.hoverTryOnActive && runtime.hoverTryOnCharacter && runtime.hoverTryOnCharacter !== character) {
    stopHoverTryOn(true);
  }
  if (runtime.hoverTryOnActive && runtime.hoverTryOnGroup === group && runtime.hoverTryOnAsset === assetName) return;

  if (runtime.hoverTryOnActive && runtime.hoverTryOnGroup && runtime.hoverTryOnGroup !== group) {
    restoreTryOnGroup(character, runtime.hoverTryOnGroup, runtime.hoverTryOnBackup);
    // The group we're leaving may have forced an active pose (e.g. a suspension
    // restraint's SetPose). Restoring the item alone doesn't recompute pose state —
    // only a full CharacterRefresh does — so without this the forced pose sticks
    // around even though the previewed item is gone.
    if (runtime.hoverTryOnRestraint) {
      try {
        CharacterRefresh(character, false, false);
      } catch {
        // Ignore transient render errors; the item swap above already succeeded.
      }
    }
    runtime.hoverTryOnActive = false;
    runtime.hoverTryOnGroup = null;
    runtime.hoverTryOnAsset = null;
    runtime.hoverTryOnBackup = null;
    runtime.hoverTryOnRestraint = false;
  }

  if (!runtime.hoverTryOnActive || runtime.hoverTryOnGroup !== group) {
    runtime.hoverTryOnBackup = InventoryGet(character, group);
    runtime.hoverTryOnGroup = group;
  }

  try {
    const preserveWornColor = group === 'HairFront' || group === 'HairBack';
    const sourceColor = copyItemData
      ? (item.Color ?? asset.DefaultColor)
      : preserveWornColor
        ? (runtime.hoverTryOnBackup?.Color ?? asset.DefaultColor)
        : asset.DefaultColor;
    const previewColor: ItemColor | null = typeof sourceColor === 'string'
      ? sourceColor
      : sourceColor ? [...sourceColor] : null;
    const preview = CharacterAppearanceSetItem(
      character,
      group,
      asset,
      previewColor,
    );
    if (!preview) {
      restoreTryOnGroup(character, group, runtime.hoverTryOnBackup);
      // Nothing was actually previewed for this group, so leave no dangling
      // "active for this group" state behind — otherwise a later call can see
      // hoverTryOnActive === false but a stale hoverTryOnGroup/Backup pointing
      // at a group whose item was never touched this round.
      runtime.hoverTryOnGroup = null;
      runtime.hoverTryOnBackup = null;
      return;
    }
    if (copyItemData && item.Property) preview.Property = CommonCloneDeep(item.Property);
    if (copyItemData && item.Craft) preview.Craft = CommonCloneDeep(item.Craft);
    runtime.hoverTryOnActive = true;
    runtime.hoverTryOnAsset = assetName;
    runtime.hoverTryOnRestraint = restraint;
    runtime.hoverTryOnCharacter = character;
    if (restraint) CharacterRefresh(character, false, false);
    else CharacterLoadCanvas(character);
  } catch (error) {
    console.warn('[AEE] Hover try-on preview failed:', {group, asset: assetName, error});
    restoreTryOnGroup(character, group, runtime.hoverTryOnBackup);
    runtime.hoverTryOnActive = false;
    runtime.hoverTryOnGroup = null;
    runtime.hoverTryOnAsset = null;
    runtime.hoverTryOnBackup = null;
    runtime.hoverTryOnRestraint = false;
    runtime.hoverTryOnCharacter = null;
  }
}

export function stopHoverTryOn(redraw = true) {
  if (!runtime.hoverTryOnActive) return;
  const character = runtime.hoverTryOnCharacter || CharacterAppearanceSelection;
  if (character && runtime.hoverTryOnGroup) {
    restoreTryOnGroup(character, runtime.hoverTryOnGroup, runtime.hoverTryOnBackup);
    if (redraw) {
      try {
        if (runtime.hoverTryOnRestraint) CharacterRefresh(character, false, false);
        else CharacterLoadCanvas(character);
      } catch {
        // Ignore transient render errors.
      }
    }
  }
  runtime.hoverTryOnActive = false;
  runtime.hoverTryOnGroup = null;
  runtime.hoverTryOnAsset = null;
  runtime.hoverTryOnBackup = null;
  runtime.hoverTryOnRestraint = false;
  runtime.hoverTryOnCharacter = null;
}

export type HoverTryOnScope = 'clothing' | 'item';

export function isHoverTryOnEnabled(scope: HoverTryOnScope): boolean {
  const active = scope === 'clothing'
    ? runtime.hoverTryOnClothingEnabled
    : runtime.hoverTryOnItemEnabled;
  return settings.hoverTryOn.get() && active;
}

export function toggleHoverTryOn(scope: HoverTryOnScope): void {
  const clothing = scope === 'clothing';
  const active = clothing
    ? !runtime.hoverTryOnClothingEnabled
    : !runtime.hoverTryOnItemEnabled;
  if (clothing) {
    runtime.hoverTryOnClothingEnabled = active;
    saveAppearanceQuickSetting('hoverTryOnClothingEnabled', active);
  } else {
    runtime.hoverTryOnItemEnabled = active;
    saveAppearanceQuickSetting('hoverTryOnItemEnabled', active);
  }
  const activeScope: HoverTryOnScope = runtime.hoverTryOnRestraint ? 'item' : 'clothing';
  if (!active && runtime.hoverTryOnActive && activeScope === scope) stopHoverTryOn();
}

export function toggleCharacterPreviewActive(): void {
  const active = !settings.characterPreviewActive.get();
  settings.characterPreviewActive.set(active);
  saveAppearanceQuickSetting('characterPreviewActive', active);
}

function restoreTryOnGroup(character: Character, group: AssetGroupName, backup: Item | null) {
  CharacterAppearanceSetItem(character, group, null);
  if (backup) character.Appearance.push(backup);
}

export function setCharControlVisible(visible: boolean) {
  mutateState(draft => {
    draft.charControl.visible = visible;
    if (!visible) {
      draft.charControl.open = false;
      draft.charControl.bgSubOpen = false;
      draft.charControl.hideSubOpen = false;
      draft.offset.open = false;
      draft.pose.open = false;
      draft.bg.settingsOpen = false;
    }
  });
}

export function syncAfterBcRender() {
  syncCurrentContext();
  if (getState().activeDrag) alignTouchBlocker();
}

export function getPriorityValue(item: Item, layerId: LayerId) {
  const layers = item.Asset?.Layer || [];
  if (layerId === 'all') {
    const base = getAssetDrawingPriority(item.Asset);
    const override = item.Property?.OverridePriority;
    return {
      base,
      current: typeof override === 'number' ? override : base,
      overridden: typeof override === 'number',
    };
  }
  const index = parseInt(layerId, 10);
  const base = typeof layers[index]?.Priority === 'number' ? layers[index].Priority : 0;
  const layerName = layers[index]?.Name ?? '';
  const override = item.Property?.OverridePriority;
  const current = typeof override === 'object' && override?.[layerName] != null ? override[layerName] : base;
  return {
    base,
    current: clampPriority(current),
    overridden: typeof override === 'object' && override?.[layerName] != null,
  };
}

export function readOpacityPct(item: Item, layerId: LayerId) {
  const opacity = getOpacity(item, layerId);
  return opacity === null ? null : Math.round(opacity * 100);
}

function getAssetDrawingPriority(asset: Asset | undefined) {
  const value = (asset as AssetPriority | undefined)?.DrawingPriority;
  return typeof value === 'number' ? value : 0;
}

export function setToolbarHovered(hovered: boolean) {
  mutateState(draft => { draft.toolbarHovered = hovered; });
}

export function setToolbarPinned(pinned: boolean) {
  mutateState(draft => { draft.toolbarPinned = pinned; });
}

export function setToolbarLayout(layout: ToolbarLayoutMode) {
  const hadCanvasGesture = isCanvasGestureActive(getState());
  mutateState(draft => {
    draft.toolbarLayout = layout;
    clearCanvasToolState(draft);
    if (hadCanvasGesture) draft.editTool = null;
    if (layout === 'neat' && !draft.editTool) draft.editTool = 'xy';
  });
  if (hadCanvasGesture) finishCanvasToolTransition(false);
}

export function selectEditTool(tool: EditToolMode, anchor?: OverlayAnchor) {
  const state = getState();
  if (tool === 'parts') {
    togglePartsOpen(undefined, anchor);
    return;
  }
  if (tool === 'opacity') {
    if (state.toolbarLayout === 'free') {
      if (state.opacityOverlay.open) {
        mutateState(draft => { clearCanvasToolState(draft); draft.editTool = null; });
        finishCanvasToolTransition(false);
      } else openOpacityOverlay(anchor);
    }
    else mutateState(draft => { draft.editTool = draft.editTool === 'opacity' ? null : 'opacity'; });
    return;
  }
  if (tool === 'layers' && state.toolbarLayout === 'free') {
    openLayersOverlay(anchor);
    return;
  }
  if (tool === 'layers' || tool === 'settings' || tool === 'gizmo') {
    if (tool === 'gizmo') {
      const opening = state.editTool !== 'gizmo';
      mutateState(draft => {
        clearCanvasToolState(draft);
        draft.editTool = opening ? 'gizmo' : null;
        if (opening && draft.selectedLayer === null) draft.selectedLayer = 'all';
      });
      finishCanvasToolTransition(opening);
      return;
    }
    mutateState(draft => { draft.editTool = draft.editTool === tool ? null : tool; });
    return;
  }
  if (tool === 'xy' || tool === 'rot' || tool === 'scale' || tool === 'skew' || tool === 'mirror') {
    if (state.toolbarLayout === 'free') {
      toggleTransformOverlay(tool, anchor);
    }
    else toggleNeatTool(tool);
    return;
  }
  mutateState(draft => { draft.editTool = draft.editTool === tool ? null : tool; });
}

function toggleNeatTool(tool: EditToolMode) {
  if (!tool) return;
  mutateState(draft => {
    const index = draft.editTools.indexOf(tool);
    if (index >= 0) draft.editTools.splice(index, 1);
    else draft.editTools.push(tool);
    draft.editTool = tool;
  });
}

export function leaveSelectedPart() {
  stopHoverHighlight(true);
  mutateState(draft => {
    draft.selectedLayer = null;
    draft.editTool = null;
    draft.activeDrag = null;
    draft.rotationOverlayOpen = false;
    draft.transformOverlay.mode = null;
    draft.opacityOverlay.open = false;
  });
  hideTouchBlocker();
}
