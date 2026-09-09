import {useSyncExternalStore} from 'react';

export type PickerMapping = {left: number; top: number; width: number; bottom: number; headingTop: number};
let mapping: PickerMapping | null = null;
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };

/** Host provides final CSS viewport bounds after mapping its native dialog. */
export const ColorPickerLayout = Object.freeze({
  version: 1,
  setMapping(next: PickerMapping | null) {
    if (next && (!Object.values(next).every(Number.isFinite) || next.width <= 0 || next.bottom <= next.top)) return;
    if (mapping === next || (mapping && next && mapping.left === next.left && mapping.top === next.top &&
      mapping.width === next.width && mapping.bottom === next.bottom && mapping.headingTop === next.headingTop)) return;
    mapping = next ? {...next} : null;
    listeners.forEach(listener => listener());
  },
});
Object.assign(window.Liko.AEE, {ColorPickerLayout});

export function usePickerMapping(enabled: boolean) {
  const value = useSyncExternalStore(subscribe, () => mapping);
  return enabled ? value : null;
}

export function getBcColorPickerHgroup(): HTMLElement | null {
  return document.getElementById('color-picker-hgroup')
    ?? document.getElementById('color-picker-h1')?.closest('hgroup')
    ?? document.getElementById('color-picker-h1')?.parentElement ?? null;
}
