import {t} from '@/i18n/i18n';
import {AboutAee} from '@/components/main-panel/AboutAee';
import {LanguageSelect} from '@/components/main-panel/LanguageSelect';
import {ItemFontSelect} from '@/components/main-panel/ItemFontSelect';
import {SettingRow} from '@/components/ui/SettingRow';
import {settings} from '@/core/settings';
import {HoverOutlineSelect} from '@/components/main-panel/HoverOutlineSelect';

export function SettingsTab() {
  return <>
    <section className="border-b border-zinc-700 px-3 py-2">
      <LanguageSelect/>
      <ItemFontSelect/>
      <SettingRow label={t('settings-load-others-font-label')} setting={settings.loadOthersFont}
                  tooltip={t('settings-load-others-font-tooltip')}/>
      <SettingRow label={t('settings-toolbar-always-visible')} setting={settings.toolbarAlwaysVisible}/>
      <SettingRow label={t('settings-right-click-exit-drag')} setting={settings.rightClickExitDrag}/>
      <SettingRow label={t('settings-replace-bc-color-picker')} setting={settings.useAeeColorPicker}/>
      <SettingRow label={t('settings-enable-wardrobe')} setting={settings.enableWardrobe}/>
      <SettingRow label={t('settings-enable-free-draw')} setting={settings.enableFreeDraw}
                  tooltip={t('settings-enable-free-draw-tooltip')}/>
      <SettingRow label={t('settings-paste-import')} setting={settings.pasteImport}/>
      <SettingRow label={t('settings-enable-copy-paste')} setting={settings.enableCopyPaste}/>
      <SettingRow label={t('settings-bc-wheel-scroll')} setting={settings.bcWheelScroll}/>
      <SettingRow label={t('settings-hover-item-highlight')} setting={settings.hoverHighlightChar}/>
      <SettingRow label={t('settings-hover-panel-outline')} setting={settings.hoverOutlinePanel}/>
      <HoverOutlineSelect/>
      <SettingRow label={t('settings-hover-layer-highlight')} setting={settings.hoverHighlight}/>
      <SettingRow label={t('settings-hover-tryon')} setting={settings.hoverTryOn}
                  tooltip={t('settings-hover-tryon-tooltip')}/>
      <SettingRow label={t('settings-hair-character-preview')} setting={settings.hairCharacterPreview}
                  tooltip={t('settings-hair-character-preview-tooltip')}/>
      <SettingRow label={t('settings-hide-unnecessary-appearance-buttons')} setting={settings.hideUnnecessaryAppearanceButtons}
                  tooltip={t('settings-hide-unnecessary-appearance-buttons-tooltip')}/>
      <SettingRow label={t('settings-hide-lscg-layers-panel')} setting={settings.hideLscgLayers}/>
      <SettingRow label={t('settings-hide-arousal-ui')} setting={settings.hideArousalUi}/>
    </section>
    <AboutAee/>
  </>;
}
