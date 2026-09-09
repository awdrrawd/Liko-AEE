import {useSyncExternalStore} from 'react';
import type {UiStyle} from '@/core/theme';
import type {LayerPickerMode, WardrobeSlotMeta, WardrobeSourceId} from '@/core/types';

const STORAGE_KEY = 'liko-aee-settings';

export interface CtrlPos {
  left: number;
  top: number;
}

export type HoverOutlineColor = 'theme' | 'gold' | 'sapphire' | 'emerald' | 'rose' | 'amethyst' | 'iris' | 'crimson' | 'cyan' | 'custom';

class SettingsStore {
  private values: Record<string, unknown>;

  constructor(private readonly storageKey: string) {
    this.values = SettingsStore.load(storageKey);
    // Split the legacy color/enable setting without changing existing hover preferences.
    const legacyColor = this.values.hoverOutlineColor;
    if (this.values.hoverOutlinePanel == null && legacyColor != null) {
      this.values.hoverOutlinePanel = legacyColor !== 'off';
    }
    if (legacyColor === 'off') this.values.hoverOutlineColor = 'theme';
  }

  private static load(storageKey: string): Record<string, unknown> {
    try {
      const parsed: unknown = JSON.parse(localStorage.getItem(storageKey) || '{}');
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
    } catch {
      return {};
    }
  }

  read<T>(key: string, fallback: T): T {
    return (this.values[key] as T | undefined) ?? fallback;
  }

  write<T>(key: string, value: T, persist: boolean) {
    this.values[key] = value;
    if (!persist) return;
    try {
      localStorage.setItem(this.storageKey, JSON.stringify(this.values));
    } catch {
      // localStorage can be unavailable in private or embedded contexts.
    }
  }
}

const store = new SettingsStore(STORAGE_KEY);

export class Setting<T> {
  private readonly watchers = new Set<() => void>();

  constructor(readonly key: string, readonly fallback: T) {}

  get(): T {
    return store.read(this.key, this.fallback);
  }

  set(value: T, persist = true) {
    if (Object.is(value, this.get())) return;
    store.write(this.key, value, persist);
    this.watchers.forEach(notify => notify());
  }

  subscribe = (notify: () => void): (() => void) => {
    this.watchers.add(notify);
    return () => this.watchers.delete(notify);
  };

  getSnapshot = (): T => this.get();

  onChange(listener: (value: T) => void) {
    this.watchers.add(() => listener(this.get()));
  }
}

export class BooleanSetting extends Setting<boolean> {
  toggle(): boolean {
    const next = !this.get();
    this.set(next);
    return next;
  }
}

export function useSetting<T>(setting: Setting<T>): T {
  return useSyncExternalStore(setting.subscribe, setting.getSnapshot);
}

function bool(key: string, fallback: boolean) {
  return new BooleanSetting(key, fallback);
}

function value<T>(key: string, fallback: T) {
  return new Setting<T>(key, fallback);
}

export const settings = {
  toolbarAlwaysVisible: bool('toolbarAlwaysVisible', true),
  rightClickExitDrag: bool('rightClickExitDrag', false),
  hoverHighlight: bool('hoverHighlight', false),
  hoverHighlightChar: bool('hoverHighlightChar', false),
  hoverOutlinePanel: bool('hoverOutlinePanel', false),
  hoverOutlineColor: value<HoverOutlineColor>('hoverOutlineColor', 'theme'),
  hoverOutlineCustomColor: value('hoverOutlineCustomColor', '#a78bfa'),
  appearancePick: bool('appearancePick', false),
  layerPickerMode: value<LayerPickerMode>('layerPickerMode', 'off'),
  itemLayerPickerMode: value<LayerPickerMode>('itemLayerPickerMode', 'off'),
  craftingLayerPickerMode: value<LayerPickerMode>('craftingLayerPickerMode', 'off'),
  hoverTryOn: bool('hoverTryOn', false),
  // Master switch: when ON, the character-preview toggle button is shown next
  // to hover-try-on. The in-game button toggles `characterPreviewActive`.
  hairCharacterPreview: bool('hairCharacterPreview', false),
  // Actual preview on/off state, flipped by the in-game toggle button so the
  // button can stay visible (and re-enabled) regardless of the preview state.
  characterPreviewActive: bool('characterPreviewActive', true),
  enableCopyPaste: bool('enableCopyPaste', false),
  hideLscgLayers: bool('hideLscgLayers', false),
  hideArousalUi: bool('hideArousalUi', false),
  enableAeeMenu: bool('enableAeeMenu', false),
  hideUnnecessaryAppearanceButtons: bool('hideUnnecessaryAppearanceButtons', false),
  useAeeColorPicker: bool('useAeeColorPicker', false),
  pasteImport: bool('pasteImport', false),
  bcWheelScroll: bool('bcWheelScroll', false),
  enablePartsFilter: bool('enablePartsFilter', false),
  enableLayerManager: bool('enableLayerManager', false),
  enableHideRestraints: bool('enableHideRestraints', false),
  enableWardrobe: bool('enableWardrobe', false),
  enableFreeDraw: bool('enableFreeDraw', true),
  // Item (TextItem) font: 'default' = no override, otherwise a fonts.ts font id.
  itemFont: value('itemFont', 'default'),
  // Apply other players' shared item-font choices (needs the font locally). Off by default.
  loadOthersFont: bool('loadOthersFont', false),

  showCharCtrl: bool('showCharCtrl', false),
  hideCloseup: bool('hideCloseup', false),
  hideFullbody: bool('hideFullbody', false),
  fullbodyOffsetX: value('fullbodyOffsetX', 0),
  charCtrlPos: value<CtrlPos | null>('charCtrlPos', null),
  ctrlExpandUp: bool('ctrlExpandUp', true),
  ctrlSubLeft: bool('ctrlSubLeft', true),

  charOffsetX: value('charOffsetX', 0),
  charOffsetY: value('charOffsetY', 0),
  charScale: value('charScale', 1),
  itemHideCloseup: bool('itemHideCloseup', false),
  itemHideFullbody: bool('itemHideFullbody', false),
  itemCharOffsetX: value('itemCharOffsetX', 0),
  itemCharOffsetY: value('itemCharOffsetY', 0),
  itemCharScale: value('itemCharScale', 1),
  craftingHideCloseup: bool('craftingHideCloseup', false),
  craftingHideFullbody: bool('craftingHideFullbody', false),
  craftingCharOffsetX: value('craftingCharOffsetX', 0),
  craftingCharOffsetY: value('craftingCharOffsetY', 0),
  craftingCharScale: value('craftingCharScale', 1),

  bgEnabled: bool('bgEnabled', false),
  bgColor: value('bgColor', '#87CEEB'),
  bgGridEnabled: bool('bgGridEnabled', false),
  bgGridMode: value<'line' | 'checker'>('bgGridMode', 'line'),
  bgGridPx: value('bgGridPx', 35),
  bgGridColor: value('bgGridColor', '#ffffff'),
  bgGridOpacity: value('bgGridOpacity', 0.25),
  bgGridLayer: value<'below' | 'above'>('bgGridLayer', 'below'),
  bgImgEnabled: bool('bgImgEnabled', false),
  bgImgUrl: value('bgImgUrl', ''),
  craftingBgEnabled: bool('craftingBgEnabled', false),
  craftingBgColor: value('craftingBgColor', '#87CEEB'),
  craftingBgGridEnabled: bool('craftingBgGridEnabled', false),
  craftingBgGridMode: value<'line' | 'checker'>('craftingBgGridMode', 'line'),
  craftingBgGridPx: value('craftingBgGridPx', 35),
  craftingBgGridColor: value('craftingBgGridColor', '#ffffff'),
  craftingBgGridOpacity: value('craftingBgGridOpacity', 0.25),
  craftingBgGridLayer: value<'below' | 'above'>('craftingBgGridLayer', 'below'),
  craftingBgImgEnabled: bool('craftingBgImgEnabled', false),
  craftingBgImgUrl: value('craftingBgImgUrl', ''),

  wardrobeExtended: bool('wardrobeExtended', true),
  wardrobeShared: bool('wardrobeSharedAcrossAccounts', false),
  wardrobeSpsEnabled: bool('wardrobeSpsEnabled', false),
  wardrobeSource: value<WardrobeSourceId>('wardrobeSource', 'online'),
  wardrobeMetaMigrated: bool('wardrobeMetaMigrated', false),
  wardrobeFbcMigrated: bool('wardrobeFbcMigrated', false),
  wardrobeCategoriesEnabled: bool('wardrobeCategoriesEnabled', false),
  wardrobeZoom: bool('wardrobeZoomEnabled', false),
  wardrobeCancelTryOn: bool('wardrobeCancelTryOn', false),
  wardrobeIncludeBody: bool('wardrobeIncludeBody', true),
  wardrobeIncludeItems: bool('wardrobeIncludeItems', true),
  wardrobeIncludeLock: bool('wardrobeIncludeLock', false),
  wardrobeConfirmSave: bool('wardrobeConfirmSave', true),
  wardrobeCategories: value<string[]>('wardrobeCategories', ['Category 1', 'Category 2', 'Category 3']),
  wardrobeCategoryIcons: value<Record<string, string>>('wardrobeCategoryIcons', {}),
  wardrobeBgImage: value('wardrobeBgImage', 'Backgrounds/Private.jpg'),
  wardrobeSlotMeta: value<Record<string, WardrobeSlotMeta>>('wardrobeSlotMeta', {}),
  wardrobePanelLayout: value<string[]>('wardrobePanelLayout', ['list', 'grid', 'manage', 'preview']),
  wardrobeListCollapsed: bool('wardrobeListCollapsed', false),
  // Reflow the wardrobe into the vertical DC/B layout when the viewport is taller than wide.
  wardrobePortrait: bool('wardrobePortrait', true),

  uiLanguage: value('uiLanguage', ''),
  themePreset: value('wardrobeThemePreset', ''),
  themeAccent: value('wardrobeThemeAccent', ''),
  themeUiStyle: value<UiStyle | ''>('wardrobeThemeUiStyle', ''),
  themeBase: value('wardrobeThemeBase', ''),
  themeBaseOpacity: value('wardrobeThemeBaseOpacity', 0.5),
  themeCardOpacity: value('wardrobeThemeCardOpacity', 0.5),
};
