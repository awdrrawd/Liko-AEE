import bcAeeModSdk from '@/modsdk';
import {runtime} from '@/core/runtime';
import {
  applyHoverTryOn,
  isHoverTryOnEnabled,
  setCharControlVisible,
  startHoverCharHighlight,
  stopHoverCharHighlight,
  stopHoverTryOn,
  syncAfterBcRender
} from '@/controllers/uiController';
import {getState} from '@/core/store';
import {isCanvasGestureActive} from '@/core/editorToolState';
import {drawAboveGridIfNeeded, removeBgHook, saveBgAndRefresh, syncViewBackground} from '@/controllers/backgroundController';
import {closeImportDialog} from '@/controllers/importExportController';
import {drawGroupCopyPasteButtons, handleGroupCopyPasteClick} from '@/controllers/copyPasteController';
import {resetPartsFilterMode, withFilteredGroups} from '@/controllers/partsFilterController';
import {clearHideRestraints} from '@/controllers/hideRestraintsController';
import {closeLayerManagerPanel} from '@/controllers/layerManagerController';
import {restoreWceOverrides} from '@/controllers/layeringHideController';
import {
  isAppearanceGroupsPhase,
  markAppearanceRunEnd,
  markAppearanceRunStart,
  observeAppearanceScreenState,
  onAppearanceScreenTransition,
  shouldShowAppearanceViewControl,
  updateAppearanceScreenState,
} from '@/core/appearanceScreenMachine';
import {settings} from '@/core/settings';
import {syncCurrentContext} from '@/core/context';
import {getViewSettings} from '@/core/viewSettings';
import {
  captureAppearanceDraw,
  captureAppearanceImage,
  commitAppearancePickerFrame,
  drawAppearancePickerOutline,
  handleAppearancePickerClick,
  isLayerPickerLabelPoint,
} from '@/controllers/appearancePickerController';

const EDIT_BUTTON_SCALE = 0.7;
let compactBackNextDepth = 0;
let compactEditButtons: Array<{x: number; y: number; w: number; h: number; originalX: number}> = [];

function compactEditButtonRect(x: number, y: number, width: number) {
  if (!getState().visible || y < 120
    || x < 1000 || x + width > 2000 || width < 250) return null;
  const nextWidth = width * EDIT_BUTTON_SCALE;
  return {x: x + width - nextWidth, width: nextWidth};
}

function expandedEditButtonMouseX(x: number, y: number) {
  if (!getState().visible || y < 120) return x;
  const hit = compactEditButtons.find(rect => x >= rect.x && x <= rect.x + rect.w && y >= rect.y && y <= rect.y + rect.h);
  return hit ? hit.originalX + (x - hit.x) / EDIT_BUTTON_SCALE : x;
}

function withExpandedEditMouseX<T>(fn: () => T): T {
  const original = MouseX;
  MouseX = expandedEditButtonMouseX(MouseX, MouseY);
  try { return fn(); } finally { MouseX = original; }
}

function pointerEventCanvasPoint(event: PointerEvent | undefined): {x: number; y: number} | null {
  if (!event) return null;
  const canvas = document.getElementById('MainCanvas') as HTMLCanvasElement | null;
  const rect = canvas?.getBoundingClientRect();
  if (!canvas || !rect || rect.width <= 0 || rect.height <= 0) return null;
  return {
    x: (event.clientX - rect.left) * canvas.width / rect.width,
    y: (event.clientY - rect.top) * canvas.height / rect.height,
  };
}

function captureDrawImageArgs(args: readonly [unknown, unknown, number, number, DrawOptions?, ...unknown[]]) {
  captureAppearanceImage(args[0], args[2], args[3], args[4]);
}

export function installAppearanceHooks() {
  installDialogHoverTryOnHandlers();
  onAppearanceScreenTransition(transition => {
    if (shouldShowAppearanceViewControl()) setCharControlVisible(true);
    else setCharControlVisible(false);

    if (transition.leftAppearance) {
      removeBgHook();
      stopHoverCharHighlight();
      stopHoverTryOn(false);
      closeImportDialog();
      closeLayerManagerPanel();
      // Leaving the screen is the only automatic way hiding turns off — refresh
      // the character we were editing so its restraints draw again.
      clearHideRestraints(transition.previous.selection);
    }

    if (transition.enteredAppearance) {
      saveBgAndRefresh();
      resetPartsFilterMode();
      clearHideRestraints(transition.current.selection);
    }

    if (transition.phaseChanged && transition.current.phase !== 'groups') {
      stopHoverCharHighlight();
    }

    if (transition.phaseChanged && transition.current.phase !== 'cloth') {
      stopHoverTryOn();
    }

    syncAfterBcRender();
  });

  bcAeeModSdk.hookFunction('CharacterAppearanceVisible', 1, (args, next) => {
    const character = args[0];
    const groupName = args[2];
    if (settings.hoverHighlightChar.get()) {
      const isAppearanceChar = CharacterAppearanceSelection === character;
      if (isAppearanceChar && runtime.hoverCharGroup && groupName === runtime.hoverCharGroup && runtime.hoverCharHiddenGroup.has(groupName)) return false;
    }

    // CharacterAppearanceVisible reads Asset.Hide internally. Temporarily expose
    // each item's persisted override to the native calculation, then restore the
    // shared asset definitions before returning.
    const changed = new Map<Asset, readonly AssetGroupName[] | undefined>();
    for (const item of character?.Appearance ?? []) {
      if (!Array.isArray(item.Property?.wceOverrideHide) || changed.has(item.Asset)) continue;
      changed.set(item.Asset, item.Asset.Hide);
      (item.Asset as unknown as {Hide?: readonly AssetGroupName[]}).Hide = item.Property.wceOverrideHide;
    }
    try {
      return next(args);
    } finally {
      for (const [asset, hide] of changed) (asset as unknown as {Hide?: readonly AssetGroupName[]}).Hide = hide;
    }
  });

  bcAeeModSdk.hookFunction('ServerAppearanceLoadFromBundle', 1, (args, next) => {
    const result = next(args);
    if (restoreWceOverrides(args[0])) CharacterRefresh(args[0], false, false);
    return result;
  });

  // Detailed labels are painted on MainCanvas, above BC's own group buttons.
  // Consume them at the dispatcher boundary so no lower screen handler or
  // third-party AppearanceClick hook can act on the button underneath.
  bcAeeModSdk.hookFunction('GameClick', 200, (args, next) => {
    const point = pointerEventCanvasPoint(args[0]);
    const x = point?.x ?? MouseX;
    const y = point?.y ?? MouseY;
    if (isLayerPickerLabelPoint(x, y) && handleAppearancePickerClick(x, y)) return;
    return next(args);
  });

  // Only compact BC controls while an item is actively being edited/dyed.
  // The normal Appearance group/replacement list is deliberately untouched.
  bcAeeModSdk.hookFunction('DrawBackNextButton', 50, (args, next) => {
    const compact = compactEditButtonRect(args[0], args[1], args[2]);
    if (!compact) return next(args);
    const nextArgs = [...args] as typeof args;
    nextArgs[0] = compact.x;
    nextArgs[2] = compact.width;
    compactEditButtons.push({x: compact.x, y: args[1], w: compact.width, h: args[3], originalX: args[0]});
    compactBackNextDepth++;
    try {
      return next(nextArgs);
    } finally {
      compactBackNextDepth--;
    }
  });
  bcAeeModSdk.hookFunction('DrawButton', 50, (args, next) => {
    if (compactBackNextDepth) return next(args);
    const compact = compactEditButtonRect(args[0], args[1], args[2]);
    if (!compact) return next(args);
    const nextArgs = [...args] as typeof args;
    nextArgs[0] = compact.x;
    nextArgs[2] = compact.width;
    compactEditButtons.push({x: compact.x, y: args[1], w: compact.width, h: args[3], originalX: args[0]});
    return next(nextArgs);
  });

  bcAeeModSdk.hookFunction('AppearanceRun', 1, (args, next) => {
    compactEditButtons = [];
    updateAppearanceScreenState();
    if (shouldShowAppearanceViewControl()) setCharControlVisible(true);
    syncAfterBcRender();

    return withFilteredGroups(() => {
      handleHoverCharHighlight(isAppearanceGroupsPhase());
      handleHoverTryOn();

      markAppearanceRunStart();
      let result: ReturnType<typeof next>;
      try {
        result = next(args);
      } catch (error) {
        // Third-party mods (e.g. character-segment art hooks from other
        // scripts) can throw while drawing a per-item character-grid preview
        // — most commonly for groups AEE force-enables previews on, like
        // Decals, that those mods don't expect to be segment-drawn this way.
        // Without this guard the throw escapes AppearanceRun entirely and
        // the whole appearance screen dies with an unhandled-error overlay.
        // Swallow it and just skip the rest of this frame's draw instead.
        console.warn('[AEE] AppearanceRun draw chain threw (suppressed):',
          error instanceof Error ? error.message : String(error));
        result = undefined;
      } finally {
        markAppearanceRunEnd();
      }
      updateAppearanceScreenState();
      drawAboveGridIfNeeded();
      drawGroupCopyPasteButtons();
      commitAppearancePickerFrame();
      drawAppearancePickerOutline();
      return result;
    });
  });

  bcAeeModSdk.hookFunction('DrawCharacter', 1, (args, next) => {
    const character = args[0];
    const scale = args[3];
    const craftingTarget = CurrentScreen === 'Crafting' && character === CraftingPreview;
    const itemColorTarget = !runtime.inAppearanceRun && character === runtime.itemColorChar;
    const controlsActive = runtime.inAppearanceRun || craftingTarget || itemColorTarget;
    const isTarget = character && (character === CharacterAppearanceSelection || craftingTarget || itemColorTarget);
    let drawArgs = args;
    let capture = true;

    if (controlsActive && isTarget) {
      const view = getViewSettings();
      const closeup = scale === 4 || (craftingTarget && Math.abs(scale - 2) < 0.05);
      if (closeup) {
        if (view.hideCloseup.get()) return;
        // Wardrobe closeups are secondary; ItemColor/Crafting can use a
        // closeup when it is the only visible preview of the edited item.
        capture = itemColorTarget || craftingTarget;
      } else if (Math.abs(scale - 1) < 0.1 || Math.abs(scale - 0.95) < 0.05) {
        if (view.hideFullbody.get()) return;
        const offsetX = runtime.offsetPreview?.x ?? view.charOffsetX.get();
        const offsetY = runtime.offsetPreview?.y ?? view.charOffsetY.get();
        const charScale = view.charScale.get();
        if (offsetX !== 0 || offsetY !== 0 || charScale !== 1) {
          drawArgs = [...args];
          drawArgs[1] += offsetX;
          drawArgs[2] += offsetY;
          drawArgs[3] *= charScale;
        }
      }
    }

    // One capture point, after visibility and offsets. The picker validates
    // the edited character and accepts arbitrary ItemColor/Dialog zooms.
    if (capture) captureAppearanceDraw(character, drawArgs[1], drawArgs[2], drawArgs[3], drawArgs[4]);
    return next(drawArgs);
  });

  bcAeeModSdk.hookFunction('DrawImageCanvas', 2, (args, next) => {
    captureDrawImageArgs(args);
    return next(args);
  });

  bcAeeModSdk.hookFunction('AppearanceLoad', 1, (args, next) => {
    return observeAppearanceScreenState(next(args));
  });

  bcAeeModSdk.hookFunction('AppearanceExit', 1, (args, next) => {
    return observeAppearanceScreenState(next(args));
  });

  bcAeeModSdk.hookFunction('CharacterAppearanceExit', 1, (args, next) => {
    return observeAppearanceScreenState(next(args));
  });

  bcAeeModSdk.hookFunction('CharacterAppearanceReady', 1, (args, next) => {
    // Discard any active preview before the appearance is committed on Accept.
    stopHoverTryOn(false);
    return observeAppearanceScreenState(next(args));
  });

  bcAeeModSdk.hookFunction('CharacterAppearanceWardrobeLoad', 1, (args, next) => {
    return observeAppearanceScreenState(next(args));
  });

  bcAeeModSdk.hookFunction('AppearanceItemColor', 1, (args, next) => {
    return observeAppearanceScreenState(next(args));
  });

  bcAeeModSdk.hookFunction('CommonSetScreen', 1, (args, next) => {
    updateAppearanceScreenState();
    const result = observeAppearanceScreenState(next(args));
    syncViewBackground();
    return result;
  });

  // Non-colourable modular assets (BC Plushie, ECHO 玩偶) never call
  // ItemColor. Their extended dialog is therefore their only safe AEE entry
  // point. Normal panel display no longer intercepts BC/ECHO clicks; only an
  // explicitly active drag/rotation/eyedropper gesture does that.
  bcAeeModSdk.hookFunction('DialogDraw', 0, (args, next) => {
    if (DialogMenuMode === 'extended' && DialogFocusItem) syncCurrentContext();
    compactEditButtons = [];
    const result = next(args);
    // Item/restraint dyeing normally happens here (ChatRoom, Crafting, Shop2,
    // SlaveCollar, ...), not on the standalone Appearance screen. The layer
    // picker's per-frame commit/draw used to only run inside AppearanceRun's
    // hook below, so layerCaptures/layerLabels were never populated for a
    // Dialog-based item colour session - detailed-pick labels never appeared,
    // and there was nothing for a click to hit. Mirror AppearanceRun's tail
    // call here so the same capture/commit/draw pipeline runs on this screen
    // too. Both no-op harmlessly when the picker isn't actually enabled.
    commitAppearancePickerFrame();
    drawAppearancePickerOutline();
    return result;
  });

  bcAeeModSdk.hookFunction('DialogLeaveFocusItem', 0, (args, next) => {
    const result = next(args);
    syncCurrentContext();
    return result;
  });

  bcAeeModSdk.hookFunction('AppearanceClick', 100, (args, next) => {
    // Clear the group-row flash while CharacterAppearanceSelection still points
    // at the edited character. Restraint dialogs may replace it during next().
    if (runtime.hoverCharGroup !== null) stopHoverCharHighlight();
    // Drop the hover try-on preview before BC handles the click, so its commit
    // logic (equip a cell / Accept / cancel) always acts on the real worn item
    // and a preview is never accidentally committed.
    // Restraints also need their pose/effects rebuilt before an extended dialog opens.
    stopHoverTryOn(runtime.hoverTryOnRestraint);
    if (handleAppearancePickerClick()) return;
    return withExpandedEditMouseX(() => withFilteredGroups(() => {
        // Our copy/paste column lives left of BC's row buttons; if it was clicked,
        // handle it and stop BC from also processing the click.
        if (handleGroupCopyPasteClick()) return;
        if (isEditingBody()) {
          const mode = CharacterAppearanceMode ?? '';
          if (mode === 'Color' || mode === 'Cloth' || mode === 'Permissions') return next(args);
          if (MouseY > 90) return;
        }
        return next(args);
      }));
  });

  bcAeeModSdk.hookFunction('CommonClick', 100, (args, next) => {
    if (handleAppearancePickerClick()) return;
    if (isEditingBody() && isBodyClick()) return;
    return withExpandedEditMouseX(() => next(args));
  });

  bcAeeModSdk.hookFunction('DialogClick', 0, (args, next) => {
    if (runtime.hoverTryOnActive && runtime.hoverTryOnRestraint) stopHoverTryOn(true);
    // Detailed picker labels occupy the same canvas area as Dialog controls.
    // Consume their complete rectangle (including the painted text), before
    // BC can dispatch the click to the button underneath.
    if (isLayerPickerLabelPoint() && handleAppearancePickerClick()) return;
    if (isEditingBody() && isBodyClick()) return;
    return withExpandedEditMouseX(() => next(args));
  });

  bcAeeModSdk.hookFunction('AppearancePreviewCleanup', 0, (args, next) => {
    try {
      return next(args);
    } catch {
      AppearancePreviews = [];
      try {
        Character
          .filter(character => character?.CharacterID?.startsWith?.('AppearancePreview-'))
          .forEach(character => {
            try {
              CharacterDelete(character);
            } catch {
              // Continue deleting other preview characters.
            }
          });
      } catch {
        // Ignore preview list cleanup failures.
      }
    }
  });
}

function installDialogHoverTryOnHandlers() {
  const getButton = (target: EventTarget | null): HTMLElement | null => {
    if (!(target instanceof Element)) return null;
    return target.closest<HTMLElement>('#dialog-inventory-grid .dialog-grid-button[data-index]');
  };

  document.addEventListener('pointerover', event => {
    if (!isHoverTryOnEnabled('item') || CommonIsMobile) return;
    const button = getButton(event.target);
    if (!button || (event.relatedTarget instanceof Node && button.contains(event.relatedTarget))) return;
    if (button.getAttribute('aria-checked') === 'true') {
      if (runtime.hoverTryOnActive && runtime.hoverTryOnRestraint) stopHoverTryOn(true);
      return;
    }
    if (button.getAttribute('aria-disabled') === 'true') return;
    const index = Number.parseInt(button.dataset.index ?? '', 10);
    const item = Number.isInteger(index) ? DialogInventory?.[index] : null;
    let character: Character | null = null;
    try {
      character = typeof CurrentCharacter !== 'undefined' ? CurrentCharacter : null;
    } catch {
      return;
    }
    if (!item || !character || item.Asset?.Group?.Category !== 'Item') return;
    applyHoverTryOn(item, character, true);
  }, true);

  document.addEventListener('pointerout', event => {
    const button = getButton(event.target);
    if (!button || (event.relatedTarget instanceof Node && button.contains(event.relatedTarget))) return;
    if (runtime.hoverTryOnActive && runtime.hoverTryOnRestraint) stopHoverTryOn(true);
  }, true);

  document.addEventListener('pointerdown', event => {
    if (!getButton(event.target)) return;
    if (runtime.hoverTryOnActive && runtime.hoverTryOnRestraint) stopHoverTryOn(true);
  }, true);
}

function handleHoverCharHighlight(isAppearance: boolean) {
  if (isLayerPickerLabelPoint()) {
    if (runtime.hoverCharGroup !== null) stopHoverCharHighlight();
    return;
  }
  const flashEnabled = settings.hoverHighlightChar.get();
  const outlineEnabled = settings.hoverOutlinePanel.get();
  if ((flashEnabled || outlineEnabled) && isAppearance && CharacterAppearanceMode === '') {
    let hoveredGroup: AssetGroupName | null = null;
    const mouseX = MouseX;
    const mouseY = MouseY;
    if (mouseX >= 1120 && mouseX < 1975 && mouseY >= 145 && mouseY < 980) {
      const offset = CharacterAppearanceOffset;
      const groups = CharacterAppearanceGroups;
      const numPerPage = CharacterAppearanceNumGroupPerPage;
      for (let index = offset; index < groups.length && index < offset + numPerPage; index++) {
        const itemY = 145 + (index - offset) * 95;
        if (mouseY >= itemY && mouseY < itemY + 65) {
          hoveredGroup = groups[index].Name;
          break;
        }
      }
    }
    if (hoveredGroup !== runtime.hoverCharGroup) {
      stopHoverCharHighlight();
      runtime.hoverCharGroup = hoveredGroup;
      if (hoveredGroup && flashEnabled) startHoverCharHighlight(hoveredGroup);
    }
  } else if (runtime.hoverCharGroup !== null) {
    stopHoverCharHighlight();
  }
}

function handleHoverTryOn() {
  if (!isHoverTryOnEnabled('clothing')
    || CharacterAppearanceMode !== 'Cloth'
    || !CharacterAppearanceSelection
    || CommonIsMobile
    || !DialogInventory) {
    stopHoverTryOn();
    return;
  }
  const hovered = findHoveredClothItem();
  if (!hovered) {
    stopHoverTryOn();
    return;
  }
  applyHoverTryOn(hovered);
}

// Mirror BC's Cloth-mode grid layout (Appearance.js): cells are 225x275, laid
// out from (1250, 125) stepping +250 across and wrapping to a new row (+300)
// once past x=1800, over the DialogInventory page window.
function findHoveredClothItem(): DialogInventoryItem | null {
  let x = 1250;
  let y = 125;
  const end = Math.min(DialogInventory.length, DialogInventoryOffset + CharacterAppearanceNumClothPerPage);
  for (let index = DialogInventoryOffset; index < end; index++) {
    if (MouseX >= x && MouseX < x + 225 && MouseY >= y && MouseY < y + 275) {
      return DialogInventory[index];
    }
    x += 250;
    if (x > 1800) {
      x = 1250;
      y += 300;
    }
  }
  return null;
}

function isEditingBody() {
  const state = getState();
  return !!(state.visible && isCanvasGestureActive(state));
}

function isBodyClick() {
  const mouseX = MouseX;
  const mouseY = MouseY;
  if (mouseY < 90) return false;
  const mode = CharacterAppearanceMode ?? '';
  if (mode === 'Color') return false;
  const screen = CurrentScreen ?? '';
  if (screen === 'ChatRoom' || screen === 'ChatSearch' || screen === 'Appearance') return mouseX < 1000;
  return false;
}
