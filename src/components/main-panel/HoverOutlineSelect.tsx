import {Select} from '@/components/ui/Fields';
import {settings, type HoverOutlineColor, useSetting} from '@/core/settings';
import {THEME_PRESETS} from '@/core/theme';
import {readUiTheme} from '@/core/theme';
import {t} from '@/i18n/i18n';

const QUICK_PRESETS = new Set(['gold', 'sapphire', 'emerald', 'rose', 'amethyst', 'iris', 'crimson', 'cyan']);

export function HoverOutlineSelect() {
  const value = useSetting(settings.hoverOutlineColor);
  const custom = useSetting(settings.hoverOutlineCustomColor);
  return <div className="flex min-h-11 items-center justify-between gap-2 border-b border-zinc-800 px-1 py-2 transition-colors hover:border-(--aee-accent-55) hover:bg-(--aee-accent-16)"
              data-aee-tooltip={t('settings-hover-outline')}>
    <span className="min-w-0 text-xs text-zinc-300">{t('settings-hover-outline')}</span>
    <div className="flex min-w-0 max-w-[65%] items-center gap-2">
      <Select value={value} ariaLabel={t('settings-hover-outline')} onValueChange={next => settings.hoverOutlineColor.set(next as HoverOutlineColor)}>
        <option value="theme" data-color={readUiTheme().accent}>{t('settings-hover-outline-theme')}</option>
        {THEME_PRESETS.filter(preset => QUICK_PRESETS.has(preset.id)).map(preset =>
          <option key={preset.id} value={preset.id} data-color={preset.accent}>{t(preset.name)}</option>)}
        <option value="custom" data-color={custom}>{t('wardrobe-custom-accent')}</option>
      </Select>
      {value === 'custom' ? <input type="color" value={custom}
        aria-label={t('wardrobe-custom-accent')}
        onChange={event => settings.hoverOutlineCustomColor.set(event.target.value)}
        className="h-8 w-10 shrink-0 cursor-pointer rounded border border-(--aee-accent-55) bg-transparent p-0.5"/> : null}
    </div>
  </div>;
}
