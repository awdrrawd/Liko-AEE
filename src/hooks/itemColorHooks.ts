import bcAeeModSdk from '@/modsdk';
import {runtime} from '@/core/runtime';
import {beginCraftingColorSession, saveCraftingColorSession, type CraftingColorSession} from '@/core/craftingColor';
import {getState} from '@/core/store';
import {syncCurrentContext} from '@/core/context';
import {getCanvasRect, getCurrentItem, getEditableParts, getLayerColor, getLayerDisplayName, getLayerGroupMembers, getOpacity} from '@/core/bc';
import {observeAppearanceScreenState, updateAppearanceScreenState} from '@/core/appearanceScreenMachine';
import {
  applyLscgLayersVisibility,
  closeColorPicker,
  openColorPicker,
  startHoverHighlight,
  stopHoverHighlight
} from '@/controllers/uiController';
import {settings} from '@/core/settings';
import {commitAppearancePickerFrame, drawAppearancePickerOutline, handleAppearancePickerClick} from '@/controllers/appearancePickerController';
import {drawAboveGridIfNeeded} from '@/controllers/backgroundController';

export function installItemColorHooks() {
  let craftingColorSession: CraftingColorSession | null = null;
  installLayerDiagnostics();

  bcAeeModSdk.hookFunction('ItemColorDraw', 0, (args, next) => {
    if (args[0]) runtime.itemColorChar = args[0];
    if (args[0] && args[1]) runtime.itemColorItem = InventoryGet(args[0], args[1]);
    // R131 ItemColorLoad is asynchronous. Another screen-state update can run
    // while it awaits translation/color-picker resources and clear AEE's
    // context. ItemColorDraw is the authoritative point where the colour UI is
    // actually active, so repair the panel once when its item/context is stale.
    const state = getState();
    if (runtime.itemColorItem && (!state.visible || state.item !== runtime.itemColorItem)) syncCurrentContext();
    handleItemColorHover();
    const result = next(args);
    drawAboveGridIfNeeded();
    commitAppearancePickerFrame();
    drawAppearancePickerOutline();
    return result;
  });

  // ItemColor has its own click dispatcher and does not consistently pass
  // canvas clicks through AppearanceClick/CommonClick. Handle the layer
  // picker at this screen boundary so both normal and detailed modes work.
  bcAeeModSdk.hookFunction('ItemColorClick', 100, (args, next) => {
    if (handleAppearancePickerClick()) return;
    return next(args);
  });

  bcAeeModSdk.hookFunction('ItemColorLoad', 0, (args, next) => {
    craftingColorSession = beginCraftingColorSession(args[0], args[1]);
    runtime.itemColorChar = args[0];
    runtime.itemColorItem = args[1];
    runtime.itemColorDirty = false;
    const result = observeAppearanceScreenState(next(args));
    syncCurrentContext();
    Promise.resolve(result).then(() => {
      updateAppearanceScreenState();
      applyLscgLayersVisibility();
      window.setTimeout(syncCurrentContext, 300);
    });
    return result;
  });

  bcAeeModSdk.hookFunction('ItemColorOpenPicker', 0, (args, next) => {
    const item = ItemColorItem ?? runtime.itemColorItem;
    const indices = ItemColorPickerIndices ? [...ItemColorPickerIndices] : null;
    const pickerLayers = ItemColorPickerLayers ? [...ItemColorPickerLayers.values()] : null;
    runtime.pickerContext = {item, indices, pickerLayers};
    return observeAppearanceScreenState(next(args));
  });

  bcAeeModSdk.hookFunction('ItemColorCloseColorPicker', 0, (args, next) => {
    return observeAppearanceScreenState(next(args));
  });

  bcAeeModSdk.hookFunction('ColorPickerUnload', 0, (args, next) => {
    closeAeeBcColorPicker();
    return next(args);
  });

  bcAeeModSdk.hookFunction('ItemColorFireExit', 0, (args, next) => {
    const dirtyChar = runtime.itemColorChar;
    const isCraftingPreview = craftingColorSession !== null;
    let result;
    try {
      // The native Craft colour listener saves only Color, then immediately
      // rebuilds the preview. Commit native layering properties BEFORE it runs.
      try {
        saveCraftingColorSession(craftingColorSession, args[0] === true);
      } catch (error: unknown) {
        // A failed AEE write must not prevent BC from saving colour and exiting.
        console.warn('[AEE] Failed to save Craft layering properties:', error);
      }
      result = next(args);
    } catch (error: unknown) {
      console.warn('[AEE] ItemColorFireExit chain error (suppressed):',
        error instanceof Error ? error.message : String(error));
      result = undefined;
    } finally {
      craftingColorSession = null;
      runtime.itemColorChar = null;
      runtime.itemColorItem = null;
      runtime.itemColorDirty = false;
      closeAeeBcColorPicker();
      updateAppearanceScreenState();
    }
    if (args[0] === true && dirtyChar && !isCraftingPreview) {
      try {
        ChatRoomCharacterUpdate(dirtyChar);
      } catch {
        // Ignore failed chat-room sync while leaving the color picker.
      }
    }
    syncCurrentContext();
    updateAppearanceScreenState();
    return result;
  });

  bcAeeModSdk.hookFunction('ColorPickerInit', 0, async (args, next) => {
    if (!settings.useAeeColorPicker.get()) return await next(args);
    if (args[0]?.dispatch === false) return await next(args);

    closeAeeBcColorPicker();

    const result = await next(args);
    const main = document.getElementById('color-picker-main');
    if (!main) return result;
    const originalFieldset = main.querySelector('fieldset[name="color-picker"]') as HTMLElement | null;
    if (!originalFieldset) return result;
    originalFieldset.style.display = 'none';

    const bcItem = ItemColorItem ?? runtime.itemColorItem;
    const selectedLayer = getState().selectedLayer ?? 'all';
    const hexInput = main.querySelector('input[name="output"]') as HTMLInputElement | null;
    const domHex6 = hexInput?.value?.match(/^#[0-9a-fA-F]{6}$/) ? hexInput.value
      : hexInput?.value?.match(/^#[0-9a-fA-F]{8}$/) ? hexInput.value.slice(0, 7) : null;
    const storedColor = bcItem ? getLayerColor(bcItem, selectedLayer) : null;
    const isDefault = !storedColor || storedColor === 'Default';
    const cachedHex = domHex6 || (storedColor && storedColor !== 'Default' ? storedColor : null) || '#FFFFFF';

    const h1 = document.getElementById('color-picker-h1');
    const fullName = h1?.querySelector('q')?.textContent;
    const layerName = fullName?.includes('/') ? fullName.split('/').pop() : fullName;
    let pickerLayerIdx = -1;
    if (layerName && runtime.pickerContext?.item) {
      const layers = runtime.pickerContext.item.Asset?.Layer;
      pickerLayerIdx = layers?.findIndex((layer: AssetLayer, index: number) =>
        getLayerDisplayName(layer, index) === layerName || layer.Name === layerName || layerName.includes(layer.Name)
      ) ?? -1;
    }

    let currentOpacityPct = 100;
    if (hexInput?.value?.match(/^#[0-9a-fA-F]{8}$/)) {
      currentOpacityPct = Math.round(parseInt(hexInput.value.slice(7, 9), 16) / 255 * 100);
    } else if (runtime.pickerContext?.indices?.length === 1 && runtime.pickerContext?.item) {
      const layerIndex = pickerLayerIdx >= 0 ? pickerLayerIdx : runtime.pickerContext.indices[0];
      const opacity = getOpacity(runtime.pickerContext.item, String(layerIndex));
      if (opacity != null) currentOpacityPct = Math.round(opacity * 100);
    }

    openColorPicker(cachedHex, hex => {
      const cpRoot = document.getElementById('color-picker');
      if (!cpRoot) return;
      const opInput = cpRoot.querySelector('input[name="opacity"]') as HTMLInputElement | null;
      const outputInput = cpRoot.querySelector('input[name="output"]') as HTMLInputElement | null;
      if (outputInput) {
        outputInput.value = hex;
        outputInput.dispatchEvent(new Event('input', {bubbles: true}));
        outputInput.dispatchEvent(new Event('change', {bubbles: true}));
      }
      if (opInput) {
        opInput.value = String(runtime.colorPickerAlpha ?? 255);
        opInput.dispatchEvent(new Event('input', {bubbles: true}));
        opInput.dispatchEvent(new Event('change', {bubbles: true}));
      }
    }, true, currentOpacityPct, isDefault);
    return result;
  });
}

function installLayerDiagnostics() {
  (window as unknown as Record<string, unknown>).likoAeeDumpLayers = () => {
    const item = runtime.itemColorItem
      || (CharacterAppearanceSelection && CharacterAppearanceColorPickerGroupName
        ? InventoryGet(CharacterAppearanceSelection, CharacterAppearanceColorPickerGroupName)
        : null);
    if (!item?.Asset?.Layer) {
      console.warn('[AEE] No coloured item active - open the item/restraint colour screen first.');
      return;
    }
    const layers = item.Asset.Layer;
    const rows = layers.map((layer, index) => ({
      i: index,
      Name: layer.Name ?? '(null)',
      ColorGroup: layer.ColorGroup ?? '',
      ColorIndex: layer.ColorIndex,
      CopyLayerColor: layer.CopyLayerColor ?? '',
      AllowColorize: layer.AllowColorize,
      HideColoring: layer.HideColoring,
      aeeName: getLayerDisplayName(layer, index),
    }));
    console.log(`[AEE] Asset: ${item.Asset.Group?.Name}/${item.Asset.Name} (DynamicGroupName=${item.Asset.DynamicGroupName}) - ${layers.length} layers`);
    console.table(rows);
    const state = ItemColorState;
    if (state?.colorGroups) {
      console.log('[AEE] ItemColorState.colorGroups:');
      console.table(state.colorGroups.map(group => ({
        name: group.name ?? '(WholeItem)',
        layerIndices: group.layers.map(l => layers.indexOf(l)).join(','),
        layerNames: group.layers.map(l => l.Name ?? '(null)').join(','),
      })));
    }
    const aeeState = getState();
    console.log(`[AEE] AEE rows (selectedLayer=${String(aeeState.selectedLayer)}, getCurrentItem===itemColorItem: ${getCurrentItem() === item}):`);
    console.table(getEditableParts(item).map(part => ({
      layerId: part.layerId,
      name: part.name,
      groupMembers: getLayerGroupMembers(item, parseInt(part.layerId, 10)).join(','),
    })));
    if (aeeState.selectedLayer != null && aeeState.selectedLayer !== 'all') {
      console.log(`[AEE] selected part '${aeeState.selectedLayer}' -> members: ${getLayerGroupMembers(item, parseInt(aeeState.selectedLayer, 10)).join(',')}`);
    }
    return rows;
  };
}

function handleItemColorHover() {
  const state = getState();
  if (!state.visible || !(settings.hoverHighlight.get() || settings.hoverHighlightChar.get())) return;
  const item = runtime.itemColorItem;
  if (!item) return;
  let foundIdx: string | null = null;
  const rect = getCanvasRect();
  if (rect) {
    const canvas = document.getElementById('MainCanvas') as HTMLCanvasElement | null;
    const clientX = rect.left + (MouseX / (canvas?.width || 2000)) * rect.width;
    const clientY = rect.top + (MouseY / (canvas?.height || 1000)) * rect.height;
    document.querySelectorAll('[data-aee-layer-button]').forEach(button => {
      const buttonRect = button.getBoundingClientRect();
      if (clientX >= buttonRect.left && clientX <= buttonRect.right && clientY >= buttonRect.top && clientY <= buttonRect.bottom) {
        foundIdx = (button as HTMLElement).dataset.selectLayer ?? null;
      }
    });
  }

  const layeringOpen = !!document.getElementById('layering');
  if (Date.now() < runtime.hoverCooldownUntil || layeringOpen) {
    if (runtime.hoverLayerIdx !== null) {
      stopHoverHighlight(true);
      runtime.hoverLayerIdx = null;
    }
  } else if (foundIdx !== runtime.hoverLayerIdx) {
    if (runtime.hoverLayerIdx !== null) stopHoverHighlight(true);
    runtime.hoverLayerIdx = foundIdx;
    if (foundIdx !== null) startHoverHighlight(item, foundIdx);
  }
}

function closeAeeBcColorPicker() {
  if (!getState().colorPicker.open) return;
  closeColorPicker(true);
  const main = document.getElementById('color-picker-main');
  const originalFieldset = main?.querySelector('fieldset[name="color-picker"]') as HTMLElement | null;
  if (originalFieldset) originalFieldset.style.display = '';
}
