import {useLayoutEffect, useState} from 'react';

type DialogRect = {left: number; top: number; width: number; height: number};
type VerticalApi = {getState(): {mode: string | null; dialogRect: DialogRect | null}};
type Bounds = {left: number; top: number; width: number; bottom: number; headingTop: number};

export function getBcColorPickerHgroup(): HTMLElement | null {
  return document.getElementById('color-picker-hgroup')
    ?? document.getElementById('color-picker-h1')?.closest('hgroup')
    ?? document.getElementById('color-picker-h1')?.parentElement ?? null;
}

function measureBounds(): Bounds | null {
  const api = (window as unknown as {Liko?: {LCE?: {Vertical?: VerticalApi}}}).Liko?.LCE?.Vertical;
  const state = api?.getState();
  const area = state?.mode === 'dialog' ? state.dialogRect : null;
  if (!area) return null;
  const menu = document.getElementById('color-picker-menu')?.getBoundingClientRect();
  const heading = getBcColorPickerHgroup()?.getBoundingClientRect();
  const headingTop = Math.max(area.top, menu?.bottom ?? area.top) + 4;
  return {
    left: area.left + 24, width: Math.max(1, area.width - 32), headingTop,
    top: headingTop + (heading?.height ?? 30) + 4,
    bottom: Math.min(window.innerHeight, area.top + area.height),
  };
}

/** BC moves existing DOM without resizing it; sample position at 10 Hz rather
 * than causing layout reads and React state updates on every animation frame. */
export function useVerticalPickerBounds(enabled: boolean) {
  const [bounds, setBounds] = useState<Bounds | null>(null);
  useLayoutEffect(() => {
    if (!enabled) { setBounds(null); return; }
    const update = () => {
      const next = measureBounds();
      setBounds(old => old === next || (old && next &&
        old.left === next.left && old.top === next.top && old.width === next.width &&
        old.bottom === next.bottom && old.headingTop === next.headingTop) ? old : next);
    };
    update();
    const timer = window.setInterval(update, 100);
    window.addEventListener('resize', update);
    return () => { window.clearInterval(timer); window.removeEventListener('resize', update); };
  }, [enabled]);
  return bounds;
}
