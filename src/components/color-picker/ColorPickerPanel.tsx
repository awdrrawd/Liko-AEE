import {getBcColorPickerHgroup, usePickerMapping} from './pickerMapping';
import {type PointerEvent as ReactPointerEvent, useEffect, useLayoutEffect, useMemo, useRef, useState} from 'react';
import type {AeeState} from '@/core/types';
import {t} from '@/i18n/i18n';
import {
  closeColorPicker,
  previewColorPickerValue,
  setColorPickerCollapsed,
  setColorPickerValue,
  setEyedropperActive
} from '@/controllers/uiController';
import {runtime} from '@/core/runtime';
import {hexToHsv, hsvaString, hsvToHex, hsvToRgb} from '@/components/color-picker/colorMath';
import {clamp} from '@/util/math';
import {ColorSwatch} from '@/components/ui/Fields';
import {EyedropperOverlay} from '@/components/color-picker/EyedropperOverlay';
import {HarmonyRuleButton} from '@/components/color-picker/HarmonyRuleButton';
import {SavedCell} from '@/components/color-picker/SavedCell';
import {ToolButton} from '@/components/color-picker/ToolButton';
import {Track} from '@/components/color-picker/Track';
import {Button, IconButton} from '@/components/ui/Button';
import {Panel} from '@/components/ui/Panel';
import {ChevronRight, Clipboard, Copy, Pipette} from '@/components/main-panel/icons/Icons';
import type {SavedColor} from '@/components/color-picker/types';

const PANEL_WIDTH = 750;
const RECENT_COLORS_KEY = 'liko-aee-recent-colors';
const DEFAULT_QUICK_COLORS: SavedColor[] = [
  '#FFFFFF', '#000000', '#FF3B30', '#FF9500', '#FFCC00',
  '#34C759', '#00C7BE', '#007AFF', '#5856D6', '#AF52DE',
  '#8E8E93', '#A2845E',
].map(hex => ({...hexToHsv(hex), a: 255}));

function loadRecentColors(): (SavedColor | null)[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(RECENT_COLORS_KEY) || '[]') as SavedColor[];
    return [...parsed.slice(0, 12), ...Array<SavedColor | null>(12).fill(null)].slice(0, 12);
  } catch {
    return Array<SavedColor | null>(12).fill(null);
  }
}

const BC_HEADING_GAP = 4;
const BC_HEADING_VIEWPORT_MARGIN = 8;
const BC_HGROUP_STYLE_KEYS = [
  'alignItems',
  'bottom',
  'boxSizing',
  'display',
  'height',
  'justifyContent',
  'left',
  'margin',
  'maxWidth',
  'minHeight',
  'overflow',
  'padding',
  'pointerEvents',
  'position',
  'right',
  'textAlign',
  'top',
  'transform',
  'visibility',
  'width',
  'zIndex',
] as const;

type BcHgroupStyleKey = typeof BC_HGROUP_STYLE_KEYS[number];
type BcHgroupStyleSnapshot = Record<BcHgroupStyleKey, string>;

function readInlineStyles(element: HTMLElement) {
  const snapshot = {} as BcHgroupStyleSnapshot;
  BC_HGROUP_STYLE_KEYS.forEach(key => {
    snapshot[key] = element.style[key];
  });
  return snapshot;
}

function restoreInlineStyles(element: HTMLElement, snapshot: BcHgroupStyleSnapshot) {
  BC_HGROUP_STYLE_KEYS.forEach(key => {
    element.style[key] = snapshot[key];
  });
}


export function ColorPickerPanel({state}: { state: AeeState }) {
  const picker = state.colorPicker;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const svDragRef = useRef<number | null>(null);
  const svThumbRef = useRef<HTMLDivElement>(null);
  const hsvRef = useRef(hexToHsv(picker.hex));
  const pendingHsvRef = useRef<{ h: number; s: number; v: number } | null>(null);
  const latestPreviewHsvRef = useRef<{ h: number; s: number; v: number } | null>(null);
  const hsvFrameRef = useRef<number | null>(null);
  const bcHgroupRestoreRef = useRef<{ element: HTMLElement; styles: BcHgroupStyleSnapshot } | null>(null);
  const [hsv, setHsvState] = useState(() => hsvRef.current);
  const [alpha, setAlpha] = useState(Math.round(picker.opacityPct / 100 * 255));
  const [rule, setRule] = useState('complementary');
  const [recent, setRecent] = useState<(SavedColor | null)[]>(loadRecentColors);
  const [naturalHeight, setNaturalHeight] = useState(PANEL_WIDTH);
  const previewOnlyRef = useRef(false);
  const lastAppliedColorRef = useRef<{ hex: string; opacityPct: number; preview: boolean } | null>(null);


  const firstRunRef = useRef(true);
  const initialHsvRef = useRef(hsvRef.current);
  const initialAlphaRef = useRef(Math.round(picker.opacityPct / 100 * 255));

  const hex = hsvToHex(hsv.h, hsv.s, hsv.v);
  const alphaPct = Math.round(alpha / 255 * 100);
  const rgb = hsvToRgb(hsv.h, hsv.s, hsv.v);

  const isAtDefault = picker.isDefault
    && hsv.h === initialHsvRef.current.h
    && hsv.s === initialHsvRef.current.s
    && hsv.v === initialHsvRef.current.v
    && alpha === initialAlphaRef.current;
  const rect = state.canvasRect;
  const mappedBounds = usePickerMapping(picker.bcMode);
  const isMapped = mappedBounds !== null;
  const defaultLeft = rect ? rect.left + rect.width * 0.65 : window.innerWidth * 0.65;
  const defaultTop = rect ? rect.top + rect.height * 0.2 : window.innerHeight * 0.2;

  const availableWidth = mappedBounds?.width ?? Math.max(1, (rect?.right ?? window.innerWidth) - defaultLeft);
  const top = mappedBounds?.top ?? picker.top ?? defaultTop;
  const availableHeight = mappedBounds ? Math.max(1, mappedBounds.bottom - top) : null;
  // Fit the natural panel in both dimensions of the split viewport. Measuring
  // unzoomed layout height avoids feeding the scaled size back into the scale.
  const scale = availableHeight === null ? availableWidth / PANEL_WIDTH
    : Math.min(1, availableWidth / PANEL_WIDTH, availableHeight / naturalHeight);
  const toggleW = 24;
  const fw = PANEL_WIDTH * scale;
  const fh = naturalHeight * scale;
  const collapsed = picker.bcMode && picker.collapsed;
  const dockRight = mappedBounds ? mappedBounds.left + mappedBounds.width : rect?.right ?? window.innerWidth;
  const left = mappedBounds ? dockRight - fw : picker.left ?? defaultLeft;
  const panelLeft = mappedBounds ? left : left - toggleW;
  // Move the whole wrapper (including its toggle and shadow) beyond the actual
  // viewport edge, even when a saved position or a smaller scale leaves a gap.
  const collapsedOffset = Math.max(0, window.innerWidth - panelLeft) + 16;

  const eyedropping = picker.eyedropperActive;
  const dimStyle = {
    opacity: eyedropping ? 0.12 : 1,
    pointerEvents: eyedropping ? ('none' as const) : undefined,
    transition: 'opacity 0.15s ease',
  };
  const eyedropperLayer = eyedropping ? <EyedropperOverlay
    onPick={picked => {
      previewOnlyRef.current = false;
      setHsv(hexToHsv(picked));
      setEyedropperActive(false);
    }}
    onCancel={() => setEyedropperActive(false)}
  /> : null;

  const setHsv = (next: { h: number; s: number; v: number } | ((current: { h: number; s: number; v: number }) => {
    h: number;
    s: number;
    v: number
  })) => {
    setHsvState(current => {
      const value = typeof next === 'function' ? next(current) : next;
      hsvRef.current = value;
      return value;
    });
  };

  useEffect(() => () => {
    if (hsvFrameRef.current !== null) cancelAnimationFrame(hsvFrameRef.current);
  }, []);

  useEffect(() => {
    runtime.colorPickerAlpha = alpha;
    if (!picker.open) return;
    if (firstRunRef.current) {
      firstRunRef.current = false;
      return;
    }
    if (previewOnlyRef.current) {
      const last = lastAppliedColorRef.current;
      if (last?.hex === hex && last.opacityPct === alphaPct && last.preview) return;
      previewColorPickerValue(hex, alphaPct);
      lastAppliedColorRef.current = {hex, opacityPct: alphaPct, preview: true};
      return;
    }
    if (picker.hex === hex && picker.opacityPct === alphaPct) return;
    setColorPickerValue(hex, alphaPct);
    lastAppliedColorRef.current = {hex, opacityPct: alphaPct, preview: false};
  }, [hex, alphaPct, alpha, picker.open, picker.hex, picker.opacityPct]);

  useLayoutEffect(() => {
    const el = cardRef.current;
    if (!el || !isMapped) return;
    const measure = () => {
      // CSS transform does not affect layout dimensions. Never feed zoomed or
      // constrained viewport height back into the natural-height measurement.
      if (el.offsetHeight > 0) setNaturalHeight(el.offsetHeight);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [isMapped]);

  useLayoutEffect(() => {
    if (!picker.bcMode) {
      const restore = bcHgroupRestoreRef.current;
      if (restore) {
        restoreInlineStyles(restore.element, restore.styles);
        bcHgroupRestoreRef.current = null;
      }
      return;
    }

    const hgroup = getBcColorPickerHgroup();
    if (!hgroup) return;

    const restore = bcHgroupRestoreRef.current;
    if (!restore || restore.element !== hgroup) {
      if (restore) restoreInlineStyles(restore.element, restore.styles);
      bcHgroupRestoreRef.current = {element: hgroup, styles: readInlineStyles(hgroup)};
    }

    const maxWidth = Math.max(0, window.innerWidth - BC_HEADING_VIEWPORT_MARGIN * 2);
    const headingWidth = Math.min(maxWidth, mappedBounds?.width ?? fw);
    const minCenter = headingWidth / 2 + BC_HEADING_VIEWPORT_MARGIN;
    const maxCenter = window.innerWidth - headingWidth / 2 - BC_HEADING_VIEWPORT_MARGIN;
    const centerX = minCenter <= maxCenter ? clamp(left + fw / 2, minCenter, maxCenter) : window.innerWidth / 2;

    hgroup.style.alignItems = 'center';
    hgroup.style.boxSizing = 'border-box';
    hgroup.style.display = 'block';
    hgroup.style.height = 'auto';
    hgroup.style.justifyContent = 'center';
    hgroup.style.margin = '0';
    hgroup.style.minHeight = '0';
    hgroup.style.overflow = 'visible';
    hgroup.style.padding = '0';
    hgroup.style.position = 'fixed';
    hgroup.style.left = `${centerX}px`;
    hgroup.style.right = 'auto';
    hgroup.style.bottom = 'auto';
    hgroup.style.width = `${headingWidth}px`;
    hgroup.style.maxWidth = `${maxWidth}px`;
    hgroup.style.transform = mappedBounds ? 'translateX(-50%)' : 'translate(-50%, -100%)';
    hgroup.style.zIndex = '999999';
    hgroup.style.pointerEvents = collapsed ? 'none' : 'auto';
    hgroup.style.visibility = collapsed ? 'hidden' : 'visible';
    hgroup.style.textAlign = 'center';

    const hgroupHeight = hgroup.getBoundingClientRect().height || 0;
    hgroup.style.top = `${mappedBounds?.headingTop ?? Math.max(hgroupHeight, top - BC_HEADING_GAP)}px`;
  }, [picker.bcMode, collapsed, left, top, fw, mappedBounds]);

  useEffect(() => {
    return () => {
      const restore = bcHgroupRestoreRef.current;
      if (!restore) return;
      restoreInlineStyles(restore.element, restore.styles);
      bcHgroupRestoreRef.current = null;
    };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const base = hsvToHex(hsv.h, 100, 100);
    const gh = ctx.createLinearGradient(0, 0, canvas.width, 0);
    gh.addColorStop(0, '#fff');
    gh.addColorStop(1, base);
    ctx.fillStyle = gh;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const gv = ctx.createLinearGradient(0, 0, 0, canvas.height);
    gv.addColorStop(0, 'rgba(0,0,0,0)');
    gv.addColorStop(1, '#000');
    ctx.fillStyle = gv;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }, [hsv.h]);

  const harmony = useMemo(() => {
    const h = hsv.h, s = hsv.s, v = hsv.v;
    const map: Record<string, number[][]> = {
      complementary: [[h, s, v], [(h + 180) % 360, s, v]],
      triadic: [[h, s, v], [(h + 120) % 360, s, v], [(h + 240) % 360, s, v]],
      analogous: [[h, s, v], [(h + 30) % 360, s, v], [(h + 330) % 360, s, v], [(h + 60) % 360, s, v]],
      split: [[h, s, v], [(h + 150) % 360, s, v], [(h + 210) % 360, s, v]],
      tetradic: [[h, s, v], [(h + 90) % 360, s, v], [(h + 180) % 360, s, v], [(h + 270) % 360, s, v]],
    };
    return map[rule] || map.complementary;
  }, [hsv, rule]);

  const shades = useMemo(() => [
    [hsv.h, clamp(hsv.s - 35, 0, 100), clamp(hsv.v + 15, 0, 100)],
    [hsv.h, clamp(hsv.s - 15, 0, 100), clamp(hsv.v + 7, 0, 100)],
    [hsv.h, hsv.s, hsv.v],
    [hsv.h, clamp(hsv.s + 12, 0, 100), clamp(hsv.v - 20, 0, 100)],
    [hsv.h, clamp(hsv.s + 22, 0, 100), clamp(hsv.v - 38, 0, 100)],
  ], [hsv]);

  const pickSv = (clientX: number, clientY: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const r = canvas.getBoundingClientRect();
    const s = Math.round(clamp((clientX - r.left) / r.width, 0, 1) * 100);
    const v = Math.round((1 - clamp((clientY - r.top) / r.height, 0, 1)) * 100);
    previewOnlyRef.current = true;
    const thumb = svThumbRef.current;
    if (thumb) {
      thumb.style.left = `${s}%`;
      thumb.style.top = `${100 - v}%`;
    }
    const next = {h: hsvRef.current.h, s, v};
    pendingHsvRef.current = next;
    latestPreviewHsvRef.current = next;
    if (hsvFrameRef.current !== null) return;
    hsvFrameRef.current = requestAnimationFrame(() => {
      hsvFrameRef.current = null;
      const next = pendingHsvRef.current;
      pendingHsvRef.current = null;
      if (next) setHsv(next);
    });
  };

  const flushSvPick = () => {
    if (hsvFrameRef.current !== null) {
      cancelAnimationFrame(hsvFrameRef.current);
      hsvFrameRef.current = null;
    }
    const next = pendingHsvRef.current ?? latestPreviewHsvRef.current;
    pendingHsvRef.current = null;
    latestPreviewHsvRef.current = null;
    if (next) {
      setHsv(next);
      setColorPickerValue(hsvToHex(next.h, next.s, next.v), alphaPct);
    }
    previewOnlyRef.current = false;
  };

  const startSvPick = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    svDragRef.current = event.pointerId;
    pickSv(event.clientX, event.clientY);
  };

  const moveSvPick = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (svDragRef.current !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    pickSv(event.clientX, event.clientY);
  };

  const stopSvPick = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (svDragRef.current !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    svDragRef.current = null;
    flushSvPick();
  };

  const cancelSvPick = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (svDragRef.current === event.pointerId) {
      svDragRef.current = null;
      flushSvPick();
    }
  };

  const setTrackValue = (label: string, value: number) => {
    if (label === 'H') setHsv(current => ({...current, h: clamp(value, 0, 360)}));
    if (label === 'S') setHsv(current => ({...current, s: clamp(value, 0, 100)}));
    if (label === 'V') setHsv(current => ({...current, v: clamp(value, 0, 100)}));
    if (label === 'A') setAlpha(Math.round(clamp(value, 0, 100) / 100 * 255));
  };

  const panelHeight = mappedBounds ? undefined
    : rect ? Math.max(1, rect.bottom - top) * 0.97 / scale : undefined;
  const cardEl = (
    <div ref={cardRef} style={mappedBounds
      ? {width: PANEL_WIDTH, flexShrink: 0, transform: `scale(${scale})`, transformOrigin: 'top left'}
      : {zoom: scale, width: PANEL_WIDTH, flexShrink: 0}}>
      <Panel className="aee-scroll justify-between gap-3 overflow-y-auto p-4 text-lg" style={{width: PANEL_WIDTH, minWidth: 0, boxSizing: 'border-box', height: panelHeight, borderWidth: '2px'}}>
        <div className="flex items-start gap-3">
          <div className="flex shrink-0 flex-col gap-2 pt-1">
            <ToolButton title={t('color-picker-tool-copy-title')}
                        onClick={() => navigator.clipboard?.writeText(hex + (alpha < 255 ? alpha.toString(16).padStart(2, '0') : ''))}><Copy className="h-6 w-6"/></ToolButton>
            <ToolButton title={t('color-picker-tool-paste-title')}
                        onClick={() => navigator.clipboard?.readText().then(text => {
                          const trimmed = text.trim();
                          if (/^#[0-9a-fA-F]{6,8}$/.test(trimmed)) {
                            setHsv(hexToHsv(trimmed.slice(0, 7)));
                            if (trimmed.length === 9) setAlpha(parseInt(trimmed.slice(7), 16));
                          }
                        })}><Clipboard className="h-6 w-6"/></ToolButton>
            <ToolButton title={t('color-picker-tool-eyedropper-title')}
                        onClick={() => setEyedropperActive(true)}><Pipette
                                                                        className="h-6 w-6"/></ToolButton>
          </div>
          <div className="flex shrink-0 flex-col items-center gap-1">
            <div
              className="relative h-[120px] w-[120px] overflow-hidden rounded-lg border border-zinc-700 bg-[repeating-conic-gradient(#333_0%_25%,#222_0%_50%)] bg-size-[10px_10px]">
              <span className="absolute inset-0" style={{background: hsvaString(hsv.h, hsv.s, hsv.v, alpha)}}/>
            </div>
            <div className="font-mono text-[17px] text-zinc-400">{isAtDefault ? 'Default' : hex}</div>
            <div className="flex gap-1">
              <input
                className="h-9 w-[78px] rounded border border-zinc-700 bg-transparent px-2 font-mono text-[17px] text-zinc-100 outline-none focus:border-(--aee-accent)"
                value={hex} onChange={event => {
                const value = event.target.value.trim();
                if (/^#[0-9a-fA-F]{6}$/.test(value)) setHsv(hexToHsv(value));
              }}/>
              <input
                className="h-9 w-[54px] rounded border border-zinc-700 bg-transparent px-2 font-mono text-[17px] text-zinc-100 outline-none focus:border-(--aee-accent)"
                value={`${alphaPct}%`} onChange={event => {
                const n = parseInt(event.target.value.replace('%', ''), 10);
                if (!Number.isNaN(n)) setAlpha(Math.round(clamp(n, 0, 100) / 100 * 255));
              }}/>
            </div>
            <div className="flex items-center gap-1 text-[15px] text-zinc-400">
              <span>R</span><span className="w-6 font-mono text-zinc-100">{String(rgb[0]).padStart(3, '0')}</span>
              <span>G</span><span className="w-6 font-mono text-zinc-100">{String(rgb[1]).padStart(3, '0')}</span>
              <span>B</span><span className="w-6 font-mono text-zinc-100">{String(rgb[2]).padStart(3, '0')}</span>
            </div>
          </div>
          <div className="relative ml-0.5 h-[180px] w-[500px] shrink-0">
            <canvas
              ref={canvasRef}
              className="block h-full w-full cursor-crosshair select-none touch-none rounded-lg border border-zinc-700 [-webkit-user-drag:none]"
              width={500}
              height={180}
              draggable={false}
              onDragStart={event => event.preventDefault()}
              onPointerDown={startSvPick}
              onPointerMove={moveSvPick}
              onPointerUp={stopSvPick}
              onPointerCancel={cancelSvPick}
              onLostPointerCapture={cancelSvPick}
            />
            <div
              ref={svThumbRef}
              className="pointer-events-none absolute h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-transparent"
              style={{
                left: `${hsv.s}%`,
                top: `${100 - hsv.v}%`,
                border: '3px solid #fff',
                outline: '1px solid rgba(0,0,0,.7)',
                boxShadow: '0 1px 4px rgba(0,0,0,.55)',
              }}
            />
          </div>
        </div>
        <Track label="H" value={hsv.h} max={360} bg="linear-gradient(to right,#f00,#ff0,#0f0,#0ff,#00f,#f0f,#f00)"
               inputValue={Math.round(hsv.h)}
               onPick={(pct, preview) => {
                 previewOnlyRef.current = !!preview;
                 setHsv(current => ({...current, h: Math.round(pct * 360)}));
               }}
               onInput={value => setTrackValue('H', value)}/>
        <Track label="S" value={hsv.s} max={100}
               bg={`linear-gradient(to right,${hsvToHex(hsv.h, 0, hsv.v)},${hsvToHex(hsv.h, 100, hsv.v)})`}
               inputValue={Math.round(hsv.s)}
               onPick={(pct, preview) => {
                 previewOnlyRef.current = !!preview;
                 setHsv(current => ({...current, s: Math.round(pct * 100)}));
               }}
               onInput={value => setTrackValue('S', value)}/>
        <Track label="V" value={hsv.v} max={100}
               bg={`linear-gradient(to right,${hsvToHex(hsv.h, hsv.s, 0)},${hsvToHex(hsv.h, hsv.s, 100)})`}
               inputValue={Math.round(hsv.v)}
               onPick={(pct, preview) => {
                 previewOnlyRef.current = !!preview;
                 setHsv(current => ({...current, v: Math.round(pct * 100)}));
               }}
               onInput={value => setTrackValue('V', value)}/>
        <Track label="A" value={alpha} max={255} bg="repeating-conic-gradient(#444 0% 25%,#222 0% 50%) 0 0/8px 8px"
               overlay={`linear-gradient(to right,transparent,${hex})`} inputValue={`${alphaPct}%`}
               onPick={(pct, preview) => {
                 previewOnlyRef.current = !!preview;
                 setAlpha(Math.round(pct * 255));
               }} onInput={value => setTrackValue('A', value)}/>
        <div className="h-px bg-zinc-800"/>
        <div className="flex items-center gap-2">
          <span
            className="shrink-0 text-[17px] uppercase tracking-wide text-zinc-400">{t('color-picker-harmony-section-label')}</span>
          <div className="flex flex-1 gap-1 overflow-x-auto">
            {['complementary', 'triadic', 'analogous', 'split', 'tetradic'].map(name =>
              <HarmonyRuleButton key={name} name={name} active={rule === name} onClick={() => setRule(name)}/>
            )}
          </div>
        </div>
        <div className="flex h-12 gap-2">
          {harmony.map(([h, s, v]) => {
            const sw = hsvToHex(h, s, v);
            return <ColorSwatch key={`${h}-${s}-${v}`} color={sw}
                                className="group relative flex-1 rounded border border-zinc-700 hover:border-teal-300"
                                label={sw} onClick={() => setHsv({h, s, v})}/>;
          })}
        </div>
        <div className="flex items-center gap-1">
          <span
            className="w-16 shrink-0 text-[17px] uppercase tracking-wide text-zinc-400">{t('color-picker-shades-section-label')}</span>
          {shades.map(([h, s, v]) =>
            <ColorSwatch key={`${h}-${s}-${v}`} color={hsvToHex(h, s, v)}
                         className="h-10 flex-1 rounded border border-zinc-700 hover:border-teal-300"
                         onClick={() => setHsv({h, s, v})}/>
          )}
        </div>
        <div className="h-px bg-zinc-800"/>
        <div className="flex items-center gap-2">
          <span
            className="text-[17px] uppercase tracking-wide text-zinc-400">{t('color-picker-saved-section-label')}</span>
          <span className="flex-1"/>
          <Button className="min-h-9 rounded-full px-4 py-1 text-[17px]"
                  onClick={() => setRecent(items => {
                    const nextColor = {...hsv, a: alpha};
                    const next = [nextColor, ...items.filter(item => item && hsvaString(item.h, item.s, item.v, item.a) !== hsvaString(nextColor.h, nextColor.s, nextColor.v, nextColor.a))].slice(0, 12) as (SavedColor | null)[];
                    while (next.length < 12) next.push(null);
                    localStorage.setItem(RECENT_COLORS_KEY, JSON.stringify(next.filter(Boolean)));
                    return next;
                  })}>
            {t('color-picker-save-button')}
          </Button>
          <Button className="min-h-9 rounded-full px-4 py-1 text-[17px]"
                  onClick={() => {
                    const empty = Array<SavedColor | null>(12).fill(null);
                    setRecent(empty);
                    localStorage.removeItem(RECENT_COLORS_KEY);
                  }}>
            {t('color-picker-clear-button')}
          </Button>
        </div>
        <div className="flex gap-1">{DEFAULT_QUICK_COLORS.map((item, index) =>
          <SavedCell key={index} item={item} onClick={() => {
            setHsv({h: item.h, s: item.s, v: item.v});
            setAlpha(item.a);
          }}/>
        )}</div>
        <div className="flex gap-1">{recent.map((item, index) =>
          <SavedCell key={index} item={item} onClick={() => {
            if (!item) return;
            setHsv({h: item.h, s: item.s, v: item.v});
            setAlpha(item.a);
          }}/>
        )}</div>
        {!picker.bcMode ? <div className="flex gap-2 border-t border-zinc-800 pt-2">
          <Button className="flex-1 py-2 text-sm font-bold" tone="primary"
                  onClick={() => closeColorPicker(true)}>{t('color-picker-confirm-button')}</Button>
          <Button className="flex-1 py-2 text-sm font-bold"
                  onClick={() => closeColorPicker(false)}>{t('color-picker-cancel-button')}</Button>
        </div> : null}
      </Panel>
    </div>
  );

  if (!picker.bcMode) {
    return <>
      {eyedropperLayer}
      <div className="fixed z-[999999]" style={{left, top, ...dimStyle}}>
        <div className="fixed inset-0" onClick={() => closeColorPicker(false)}/>
        <div className="relative">{cardEl}</div>
      </div>
    </>;
  }

  return <>
    {eyedropperLayer}
    <div className="pointer-events-none fixed z-[999999]"
         style={{top, left: panelLeft, width: mappedBounds ? fw : toggleW + fw, transform: collapsed ? `translateX(${collapsedOffset}px)` : 'translateX(0)', opacity: dimStyle.opacity, pointerEvents: dimStyle.pointerEvents, transition: 'transform .35s ease-in-out, opacity .15s ease'}}>
      <div className="flex items-center">
        <IconButton className={`pointer-events-auto h-12 w-6 rounded-l-md rounded-r-none border-r-0 ${mappedBounds ? 'absolute right-0 top-0 z-10' : 'shrink-0'}`}
                    icon={<ChevronRight className="h-4 w-4"/>} aria-label={t('color-picker-panel-title')}
                    onClick={() => setColorPickerCollapsed(true)}/>
        <div className="pointer-events-auto shrink-0" style={mappedBounds ? {width: fw, height: fh, overflow: 'hidden'} : undefined}>{cardEl}</div>
      </div>
    </div>
    <button type="button"
      className={`pointer-events-auto fixed z-[999999] w-[10px] border-0 p-0 transition-opacity duration-200 ${collapsed ? 'aee-toolbar-glow opacity-100' : 'pointer-events-none opacity-0'}`}
      style={{top, left: dockRight - 10, height: Math.min(rect?.height ? rect.height * 0.9 : 500, fh || 500)}}
      onPointerEnter={() => setColorPickerCollapsed(false)}
      onClick={() => setColorPickerCollapsed(false)}
      aria-label={t('color-picker-panel-title')}/>
  </>;
}
