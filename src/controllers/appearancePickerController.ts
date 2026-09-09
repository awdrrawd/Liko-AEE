import {settings} from '@/core/settings';
import {readUiTheme, THEME_PRESETS} from '@/core/theme';
import {runtime} from '@/core/runtime';
import {getState, mutateState} from '@/core/store';
import {getCurrentCharacter, getLayerDisplayName, getLayerGroupMembers} from '@/core/bc';
import {startHoverHighlight, stopHoverHighlight} from '@/controllers/uiController';
import {applyPickerMatrix, invertPickerPoint, type PickerMatrix} from '@/core/pickerTransform';

type DrawAt = {x: number; y: number; zoom: number; heightResize?: boolean};
export type DrawCapture = {
  matrices: PickerMatrix[];
  url: string;
  /** Translation-only fallback when no shader matrix was captured. */
  x: number;
  y: number;
  /** Coordinates passed by CommonDraw to GLDrawImage. */
  drawX: number;
  drawY: number;
  scaleX: number;
  scaleY: number;
  rotation: number;
  translationX: number;
  translationY: number;
  mirror: boolean;
  invert: boolean;
  order: number;
};
type CanvasMap = {ox: number; oy: number; sx: number; sy: number; yStart: number};
type AlphaData = {bounds: {x: number; y: number; w: number; h: number}; mask: Uint8Array; mw: number; mh: number; scale: number};
type PickHit = {asset: Asset; group: AssetGroup; area: number; order: number};
type ScreenRect = {left: number; top: number; right: number; bottom: number};
export type CapturedLayerGeometry = {
  corners: Array<[number, number]>;
  center: [number, number];
  pivot: [number, number];
  /** Every physical BC texture pivot represented by this geometry. */
  pivots: Array<[number, number]>;
  width: number;
  height: number;
};
type LabelRow = {index: number; minX: number; maxX: number; anchorY: number; label: string};
type LabelLayout = LabelRow & {side: 'left' | 'right'; x: number; y: number; w: number; h: number};

const captures = new Map<Asset, DrawCapture[]>();
let frame = new Map<Asset, DrawCapture[]>();
const layerCaptures = new Map<number, DrawCapture[]>();
let layerFrame = new Map<number, DrawCapture[]>();
// Stable, authoritative transform source: one final draw record per physical
// layer, matching Lian's gizmo. Picking/thumbnails keep their multi-capture data.
const layerTransformCaptures = new Map<number, DrawCapture>();
// Last non-transparent render for each worn group. Hover flashing can render a
// layer with Alpha=0, so the current frame alone cannot always draw its outline.
const lastVisibleCaptures = new Map<AssetGroupName, {asset: Asset; list: DrawCapture[]}>();
const alphaCache = new Map<string, AlphaData | null>();
let drawAt: DrawAt | null = null;
let frameDrawAt: DrawAt | null = null;
let hovered: PickHit | null = null;
let lastPick: {x: number; y: number; key: string; groupName: AssetGroupName} | null = null;
let layerLabels: Array<{index: number; x: number; y: number; w: number; h: number}> = [];
let hoveredLayerIndex: number | null = null;
let outlineCanvas: HTMLCanvasElement | null = null;
let layerContentSignature = '';

const OUTLINE_WIDTH = 3;
const OUTLINE_SAMPLES = 20;
const PICK_TOP = 115;

export function appearancePickerEnabled(): boolean {
  return settings.hoverOutlinePanel.get() || settings.appearancePick.get() || layerPickerEnabled();
}

function layerPickerEnabled(): boolean {
  const state = getState();
  return state.visible && !!state.item && !state.activeDrag && !state.transformOverlay.mode && state.editTool !== 'gizmo' && !state.colorPicker.open && state.layerPickerMode !== 'off';
}

function layerCaptureEnabled(): boolean {
  const state = getState();
  return state.visible && !!state.item
    && (state.layerPickerMode !== 'off' || settings.hoverOutlinePanel.get()
      || !!state.activeDrag || !!state.transformOverlay.mode || state.editTool === 'gizmo');
}

/** Active Appearance character, or the ItemColor/Dialog character. */
function pickerCharacter(): Character | null {
  return getCurrentCharacter();
}

function inSupportedAppearanceMode(): boolean {
  if (!appearancePickerEnabled() || CurrentScreen !== 'Appearance' || !CharacterAppearanceSelection) return false;
  if (CharacterAppearanceMode !== '' && CharacterAppearanceMode !== 'Cloth') return false;
  if (DialogFocusItem) return false;
  return true;
}

export function captureAppearanceDraw(character: Character, x: number, y: number, zoom: number, heightResize?: boolean) {
  const captureLayers = layerCaptureEnabled();
  if (!(inSupportedAppearanceMode() || captureLayers) || character !== pickerCharacter() || (!captureLayers && zoom > 2)) return;
  // Use the last visible draw. Crafting paints its closeup first and its
  // full-body preview last; a hidden closeup must never own this mapping.
  frameDrawAt = {x, y, zoom, heightResize};
}

export function captureAppearanceImage(source: unknown, x: number, y: number, options?: DrawOptions) {
  const character = pickerCharacter();
  if (!(inSupportedAppearanceMode() || layerCaptureEnabled()) || runtime.currentRenderChar !== character || typeof source !== 'string') return;
  const state = getState();
  const trackedItem = runtime.currentDrawLayerItem;
  const asset = trackedItem?.Asset ?? matchAsset(source, character);
  // Resolve ownership once, before assigning any image to an editor layer.
  const isEditedItem = state.item && (trackedItem ? trackedItem === state.item : asset === state.item.Asset);
  let layerIndex = -1;
  if (isEditedItem) {
    const trackedIndex = trackedItem ? runtime.currentDrawLayerIndex : null;
    layerIndex = trackedIndex != null && trackedIndex >= 0
      ? trackedIndex : matchCurrentItemLayer(source, state.item);
  }
  const order = asset ? appearanceImageOrder(asset, source, character) : -1;
  // Retain the legacy translation fallback and gizmo inputs. Picking and
  // outlines use final shader matrices populated during the scoped GL draw.
  const transform = options as (DrawOptions & {
    TranslationX?: number;
    TranslationY?: number;
    ScaleX?: number;
    ScaleY?: number;
    Rotation?: number;
  }) | undefined;
  const translationX = transform?.TranslationX ?? 0;
  const translationY = transform?.TranslationY ?? 0;
  const capture: DrawCapture = {
    matrices: [],
    url: source,
    x: x + translationX,
    y: y + translationY,
    drawX: x,
    drawY: y,
    scaleX: transform?.ScaleX ?? 1,
    scaleY: transform?.ScaleY ?? 1,
    rotation: transform?.Rotation ?? 0,
    translationX,
    translationY,
    mirror: !!transform?.Mirror,
    invert: !!transform?.Invert,
    order,
  };
  if (layerCaptureEnabled() && layerIndex >= 0) {
    const layerList = layerFrame.get(layerIndex) ?? [];
    layerList.push(capture);
    layerFrame.set(layerIndex, layerList);
    layerTransformCaptures.set(layerIndex, capture);
  }
  // Keep transparent layers available for thumbnails, but exclude them from
  // whole-item hit testing so invisible pixels never become pick targets.
  if (options?.Alpha === 0) return capture;
  // Whole-item picking needs an asset owner. Per-layer picking can still use
  // CommonDraw's authoritative item/layer context for non-standard URLs.
  if (!asset) return capture;
  const list = frame.get(asset) ?? [];
  list.push(capture);
  frame.set(asset, list);
  return capture;
}

export function commitAppearancePickerFrame() {
  if (!inSupportedAppearanceMode() && !layerCaptureEnabled()) {
    hovered = null;
    return;
  }
  if (frameDrawAt) {
    drawAt = frameDrawAt;
    frameDrawAt = null;
  }
  // BC may draw the target character again without passing its layers through
  // the capture path. Only replace a good frame when a new frame actually has
  // images; otherwise labels/picking disappear until panel hover forces a
  // second full CharacterLoadCanvas render.
  if (frame.size) {
    captures.clear();
    for (const [asset, list] of frame) {
      captures.set(asset, list);
      lastVisibleCaptures.set(asset.Group.Name, {asset, list});
    }
    frame = new Map();
  }
  if (layerFrame.size) {
    layerCaptures.clear();
    for (const [index, list] of layerFrame) layerCaptures.set(index, list);
    layerFrame = new Map();
    const contentSignature = [...layerCaptures.entries()].map(([index, list]) => `${index}:${list.map(cap => cap.url).join(',')}`).join(';');
    const contentChanged = contentSignature !== layerContentSignature;
    if (contentChanged) {
      layerContentSignature = contentSignature;
      const state = getState();
      if (state.partsBrowser.open) {
        mutateState(draft => { draft.layerCaptureRevision += 1; });
      }
    }
  }
  const wornAssets = new Set(pickerCharacter()?.Appearance.map(item => item.Asset) ?? []);
  for (const [groupName, record] of lastVisibleCaptures) {
    if (!wornAssets.has(record.asset)) lastVisibleCaptures.delete(groupName);
  }
  hovered = inSupportedAppearanceMode() ? pickAt(MouseX, MouseY)[0] ?? null : null;
}

export function getCapturedTranslationFactor(): number {
  const gl = (globalThis as typeof globalThis & {GLDrawCanvas?: {GL?: WebGL2RenderingContext}}).GLDrawCanvas;
  return GLVersion !== 'No WebGL' && gl?.GL && !gl.GL.isContextLost() ? 2 : 1;
}

/** Exact transformed quad and the real full-texture rotation pivot. */
export function getCapturedLayerGeometry(index: number): CapturedLayerGeometry | null {
  const cap = layerTransformCaptures.get(index);
  const map = canvasMap();
  if (!cap || !map) return null;
  const image = pickImage(cap.url);
  if (!image) return null;
  const alpha = alphaData(cap.url, image);
  const tw = image.naturalWidth || image.width, th = image.naturalHeight || image.height;
  const bounds = alpha?.bounds ?? {x: 0, y: 0, w: tw, h: th};
  // Reproduce GLDrawImage's matrix from the authoritative arguments captured
  // at its boundary. CommonDraw has already added TranslationX/Y to drawX/Y;
  // GLDrawImage adds them again (three times for mirrored X; see BC's FIXME).
  const gl = (globalThis as typeof globalThis & {GLDrawCanvas?: {GL?: WebGL2RenderingContext}}).GLDrawCanvas?.GL;
  const glHeight = gl?.canvas.height ?? 1100;
  const pivotX = (cap.mirror ? 500 - cap.drawX : cap.drawX)
    + cap.translationX * (cap.mirror ? 3 : 1) + tw / 2;
  const pivotY = (cap.invert ? glHeight - cap.drawY + 550 : cap.drawY)
    + cap.translationY + th / 2;
  const angle = cap.rotation * Math.PI / 180;
  const cos = Math.cos(angle), sin = Math.sin(angle);
  const transformPoint = (u: number, v: number): [number, number] => {
    const dx = (u - tw / 2) * cap.scaleX * (cap.mirror ? -1 : 1);
    const dy = (v - th / 2) * cap.scaleY * (cap.invert ? -1 : 1);
    const point = canvasToScreen(pivotX + dx * cos - dy * sin, pivotY + dx * sin + dy * cos, map);
    return [point.x, point.y];
  };
  const x2 = bounds.x + bounds.w, y2 = bounds.y + bounds.h;
  const corners = [transformPoint(bounds.x, bounds.y), transformPoint(x2, bounds.y), transformPoint(x2, y2), transformPoint(bounds.x, y2)];
  const center = transformPoint(bounds.x + bounds.w / 2, bounds.y + bounds.h / 2);
  const pivotPoint = canvasToScreen(pivotX, pivotY, map);
  const pivot: [number, number] = [pivotPoint.x, pivotPoint.y];
  return {corners, center, pivot, pivots: [pivot], width: Math.abs(bounds.w * cap.scaleX * map.sx), height: Math.abs(bounds.h * cap.scaleY * map.sy)};
}

export function getCapturedLayerImages(index: number | 'all'): Array<{url: string; capture: DrawCapture; image: HTMLImageElement; bounds: {x: number; y: number; w: number; h: number}}> {
  const list = index === 'all' ? [...layerCaptures.values()].flat() : layerCaptures.get(index);
  if (!list?.length) return [];
  const drawable: Array<{url: string; capture: DrawCapture; image: HTMLImageElement; bounds: {x: number; y: number; w: number; h: number}}> = [];
  for (const cap of list) {
    const image = pickImage(cap.url);
    if (!image) continue;
    const alpha = alphaData(cap.url, image);
    const bounds = alpha?.bounds ?? {x: 0, y: 0, w: image.naturalWidth || image.width, h: image.naturalHeight || image.height};
    drawable.push({url: cap.url, capture: cap, image, bounds});
  }
  return drawable;
}

export function invalidateAppearancePicker() {
  captures.clear();
  frame.clear();
  layerCaptures.clear();
  layerFrame.clear();
  layerTransformCaptures.clear();
  // Keep the hit boxes for labels that are still visible on MainCanvas until
  // the next picker draw replaces them. Hover highlighting rebuilds the
  // character canvas repeatedly; clearing the boxes here created a window in
  // which a visible label could not be clicked and made selection feel random.
  hovered = null;
}

export function drawAppearancePickerOutline() {
  drawDetailedLayerPicker();
  const state = getState();
  if (layerPickerEnabled() && state.layerPickerMode === 'normal') {
    const index = pickLayerAt(MouseX, MouseY)[0];
    if (index != null) drawLayerOutline(index);
  }
  if (settings.hoverOutlinePanel.get() && state.visible && state.item && !state.activeDrag && !state.transformOverlay.mode && state.editTool !== 'gizmo' && runtime.panelHoverLayerIdx !== null) {
    const indices = runtime.panelHoverLayerIdx === 'all'
      ? [...layerCaptures.keys()]
      : getLayerGroupMembers(state.item, Number.parseInt(runtime.panelHoverLayerIdx, 10));
    indices.forEach(index => drawLayerOutline(index));
  }
  if (!inSupportedAppearanceMode()) return;
  const hit = (settings.appearancePick.get() ? hovered : null)
    ?? (settings.hoverOutlinePanel.get() ? findGroupHover() : null);
  if (!hit) return;
  const list = captures.get(hit.asset) ?? lastVisibleCaptures.get(hit.group.Name)?.list;
  const map = canvasMap();
  if (!list?.length || !map) return;

  drawCaptureOutline(list, map);
}

export function handleAppearancePickerClick(x = MouseX, y = MouseY): boolean {
  if (handleLayerPickerClick(x, y)) return true;
  if (!settings.appearancePick.get() || !inSupportedAppearanceMode()) return false;
  const hits = pickAt(x, y);
  if (!hits.length) return false;
  const key = hits.map(hit => hit.group.Name).join(',');
  const same = lastPick && Math.hypot(x - lastPick.x, y - lastPick.y) <= 18 && lastPick.key === key;
  const previous = same ? hits.findIndex(hit => hit.group.Name === lastPick?.groupName) : -1;
  const hit = hits[previous < 0 ? 0 : (previous + 1) % hits.length];
  lastPick = {x, y, key, groupName: hit.group.Name};
  return openItemEditor(hit.group);
}

/** Canvas labels have no DOM node of their own, so callers use this to keep
 * hover/click handling from falling through to BC's controls behind them. */
export function isLayerPickerLabelPoint(x = MouseX, y = MouseY): boolean {
  return layerPickerEnabled() && getState().layerPickerMode === 'detail'
    && layerLabels.some(label => x >= label.x && x <= label.x + label.w && y >= label.y && y <= label.y + label.h);
}

export function setLayerPanelHover(layerId: string | null): void {
  if (runtime.panelHoverLayerIdx === layerId) return;
  runtime.panelHoverLayerIdx = layerId;
  if (!settings.hoverOutlinePanel.get()) return;
  const character = pickerCharacter();
  if (character) CharacterLoadCanvas(character);
}

function handleLayerPickerClick(x: number, y: number): boolean {
  const state = getState();
  if (!layerPickerEnabled()) return false;
  let index = state.layerPickerMode === 'detail'
    ? layerLabels.find(label => x >= label.x && x <= label.x + label.w && y >= label.y && y <= label.y + label.h)?.index
    : undefined;
  if (index == null) index = pickLayerAt(x, y)[0];
  if (index == null) return false;
  mutateState(draft => {
    draft.selectedLayer = String(index);
  });
  return true;
}

function pickLayerAt(x: number, y: number): number[] {
  const map = canvasMap();
  if (!map || !layerPickerEnabled()) return [];
  const point = screenToCanvas(x, y, map);
  const hits: Array<{index: number; order: number; area: number}> = [];
  for (const [index, list] of layerCaptures) {
    let opaque = false, area = 0;
    for (const cap of list) {
      const image = pickImage(cap.url);
      const alpha = image ? alphaData(cap.url, image) : null;
      const width = image?.naturalWidth || image?.width || 0;
      const height = image?.naturalHeight || image?.height || 0;
      const bounds = alpha?.bounds ?? (width && height ? {x: 0, y: 0, w: width, h: height} : null);
      if (!bounds) continue;
      area += bounds.w * bounds.h;
      if (captureOpaqueAt(cap, width, height, bounds, alpha, point)) opaque = true;
    }
    if (opaque) hits.push({index, order: layerOrder(index), area});
  }
  return hits.sort((a, b) => (b.order - a.order) || (a.area - b.area)).map(hit => hit.index);
}

function layerOrder(index: number, character: Character | null = pickerCharacter()): number {
  const state = getState();
  const layerName = state.layers[index]?.Name ?? '';
  let order = index;
  character?.AppearanceLayers?.forEach((layer, position) => {
    if (layer.Asset === state.item?.Asset && (layer.Name ?? '') === layerName) order = position;
  });
  return order;
}

function drawDetailedLayerPicker() {
  const state = getState();
  layerLabels = [];
  if (!layerPickerEnabled() || state.layerPickerMode !== 'detail') {
    syncLabelHover(null);
    return;
  }
  const map = canvasMap();
  if (!map || !layerCaptures.size) {
    syncLabelHover(null);
    return;
  }
  const rows: LabelRow[] = [];
  for (const [index, list] of layerCaptures) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const cap of list) {
      const image = pickImage(cap.url);
      const alpha = image ? alphaData(cap.url, image) : null;
      const width = image?.naturalWidth || image?.width || 0;
      const height = image?.naturalHeight || image?.height || 0;
      const bounds = alpha?.bounds ?? (width && height ? {x: 0, y: 0, w: width, h: height} : null);
      if (!bounds) continue;
      const rect = captureScreenBounds(cap, width, height, bounds, map);
      minX = Math.min(minX, rect.left); minY = Math.min(minY, rect.top);
      maxX = Math.max(maxX, rect.right); maxY = Math.max(maxY, rect.bottom);
    }
    if (!Number.isFinite(minX)) continue;
    rows.push({index, minX, maxX, anchorY: (minY + maxY) / 2, label: getLayerDisplayName(state.layers[index], String(index))});
  }
  rows.sort((a, b) => a.anchorY - b.anchorY);
  const accent = readUiTheme().accent;
  const personCenter = map.ox + 250 * map.sx;
  MainCanvas.save();
  MainCanvas.font = 'bold 22px Arial';
  MainCanvas.textBaseline = 'middle';
  const labelWidth = Math.min(300, Math.max(130, ...rows.map(row => MainCanvas.measureText(row.label).width + 28)));
  // Mirror the two equal-width columns around the character: the left
  // column ends at -300, while the right one begins at +300.
  const leftX = Math.max(12, personCenter - 300 - labelWidth);
  const rightX = Math.min(1990 - labelWidth, personCenter + 300);
  const left: LabelRow[] = [];
  const right: LabelRow[] = [];
  distributeLabelRows(rows, left, right, leftX, rightX, labelWidth, aeeControlRects());
  const labels = [
    ...layoutLabelSide(left, 'left', leftX, labelWidth),
    ...layoutLabelSide(right, 'right', rightX, labelWidth),
  ];
  layerLabels = labels.map(label => ({index: label.index, x: label.x, y: label.y, w: label.w, h: label.h}));
  const labelHover = labels.find(label => MouseX >= label.x && MouseX <= label.x + label.w && MouseY >= label.y && MouseY <= label.y + label.h)?.index ?? null;
  // Paint every connector first so no later row can draw a line over a label.
  labels.forEach(label => drawLabelConnector(label, accent, label.index === labelHover));
  labels.forEach(label => drawLayerLabel(label, accent, label.index === labelHover));
  MainCanvas.restore();
  syncLabelHover(labelHover);
  if (labelHover != null) drawLayerOutline(labelHover);
}

function layoutLabelSide(
  rows: LabelRow[],
  side: 'left' | 'right',
  columnX: number,
  width: number,
): LabelLayout[] {
  const positions = layoutLabelRows(rows);
  return rows.map((row, index) => ({...row, side, x: Math.min(1990 - width, columnX), y: positions[index], w: width, h: 38}));
}

function drawLabelConnector(label: LabelLayout, accent: string, highlighted: boolean) {
  const edgeX = label.side === 'left' ? label.minX : label.maxX;
  const labelEdgeX = label.side === 'left' ? label.x + label.w : label.x;
  const labelY = label.y + label.h / 2;
  const gap = labelEdgeX - edgeX;
  MainCanvas.save();
  MainCanvas.strokeStyle = accent;
  MainCanvas.lineWidth = highlighted ? 6 : 3;
  if (highlighted) {
    MainCanvas.shadowColor = accent;
    MainCanvas.shadowBlur = 14;
  }
  MainCanvas.beginPath();
  MainCanvas.moveTo(edgeX, label.anchorY);
  if (Math.abs(gap) < 120 || Math.abs(label.anchorY - labelY) < 10) {
    MainCanvas.lineTo(labelEdgeX, labelY);
  } else {
    const landing = Math.min(70, Math.abs(gap) * 0.22);
    const elbowX = labelEdgeX - Math.sign(gap) * landing;
    MainCanvas.lineTo(elbowX, labelY);
    MainCanvas.lineTo(labelEdgeX, labelY);
  }
  MainCanvas.stroke();
  MainCanvas.restore();
}

function drawLayerLabel(label: LabelLayout, accent: string, highlighted: boolean) {
  MainCanvas.save();
  MainCanvas.fillStyle = highlighted ? 'rgba(28,20,45,0.96)' : 'rgba(9,9,15,0.88)';
  MainCanvas.fillRect(label.x, label.y, label.w, label.h);
  MainCanvas.strokeStyle = accent;
  MainCanvas.lineWidth = highlighted ? 5 : 3;
  if (highlighted) {
    MainCanvas.shadowColor = accent;
    MainCanvas.shadowBlur = 14;
  }
  MainCanvas.strokeRect(label.x, label.y, label.w, label.h);
  MainCanvas.shadowBlur = 0;
  MainCanvas.fillStyle = '#FFFFFF';
  MainCanvas.textAlign = 'left';
  MainCanvas.fillText(label.label, label.x + 12, label.y + label.h / 2);
  MainCanvas.restore();
}

function distributeLabelRows(
  rows: LabelRow[],
  left: LabelRow[],
  right: LabelRow[],
  leftX: number,
  rightX: number,
  width: number,
  obstacles: ScreenRect[],
) {
  const nextY = {left: 50, right: 50};
  const characterCenter = (leftX + width + rightX) / 2;
  const leftRoom = characterCenter;
  const rightRoom = 2000 - characterCenter;
  for (const row of rows) {
    const center = (row.minX + row.maxX) / 2;
    const preferred: 'left' | 'right' = rightRoom < width + 360
      ? 'left'
      : leftRoom < width + 360
        ? 'right'
        : center < characterCenter ? 'left' : 'right';
    const scores = {
      left: labelCollisionScore(labelCandidate(row, leftX, width, nextY.left), obstacles),
      right: labelCollisionScore(labelCandidate(row, rightX, width, nextY.right), obstacles),
    };
    const side: 'left' | 'right' = scores[preferred] <= scores[preferred === 'left' ? 'right' : 'left']
      ? preferred
      : preferred === 'left' ? 'right' : 'left';
    const destination = side === 'left' ? left : right;
    destination.push(row);
    nextY[side] = labelCandidate(row, side === 'left' ? leftX : rightX, width, nextY[side]).bottom + 8;
  }
}

function labelCandidate(row: LabelRow, x: number, width: number, nextY: number): ScreenRect {
  const height = 38;
  const top = Math.max(nextY, Math.min(950 - height, row.anchorY - height / 2));
  return {left: x, top, right: x + width, bottom: top + height};
}

/** Keep every label fully inside y=50..950. A backward pass moves earlier
 * labels upward when the bottom of a dense column would otherwise overflow. */
function layoutLabelRows(rows: LabelRow[]): number[] {
  if (!rows.length) return [];
  const height = 38;
  const gap = rows.length > 1 ? Math.max(0, Math.min(8, (900 - rows.length * height) / (rows.length - 1))) : 0;
  const result: number[] = [];
  let next = 50;
  for (const row of rows) {
    const y = Math.max(next, Math.min(950 - height, row.anchorY - height / 2));
    result.push(y);
    next = y + height + gap;
  }
  result[result.length - 1] = Math.min(result[result.length - 1], 950 - height);
  for (let index = result.length - 2; index >= 0; index--) {
    result[index] = Math.min(result[index], result[index + 1] - height - gap);
  }
  if (result[0] < 50) {
    const shift = 50 - result[0];
    for (let index = 0; index < result.length; index++) result[index] += shift;
  }
  return result;
}

function labelCollisionScore(label: ScreenRect, obstacles: ScreenRect[]): number {
  return obstacles.reduce((score, obstacle) => {
    const width = Math.max(0, Math.min(label.right, obstacle.right) - Math.max(label.left, obstacle.left));
    const height = Math.max(0, Math.min(label.bottom, obstacle.bottom) - Math.max(label.top, obstacle.top));
    return score + width * height;
  }, 0);
}

/** Convert the visible AEE panels (including floating color/transform panels)
 * from DOM pixels to MainCanvas coordinates. Transformed/collapsed controls
 * report their actual on-screen bounds, so the freed space is reusable. */
function aeeControlRects(): ScreenRect[] {
  const canvas = document.getElementById('MainCanvas') as HTMLCanvasElement | null;
  const canvasRect = canvas?.getBoundingClientRect();
  if (!canvas || !canvasRect || canvasRect.width <= 0 || canvasRect.height <= 0) return [];
  const roots: ShadowRoot[] = [];
  for (const element of document.body.children) if (element.shadowRoot?.querySelector('[data-aee-root]')) roots.push(element.shadowRoot);
  const scaleX = canvas.width / canvasRect.width;
  const scaleY = canvas.height / canvasRect.height;
  const result: ScreenRect[] = [];
  for (const root of roots) for (const control of root.querySelectorAll<HTMLElement>('.aee-control')) {
    const style = getComputedStyle(control);
    const rect = control.getBoundingClientRect();
    if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0 || rect.width <= 0 || rect.height <= 0) continue;
    const converted = {
      left: (rect.left - canvasRect.left) * scaleX,
      top: (rect.top - canvasRect.top) * scaleY,
      right: (rect.right - canvasRect.left) * scaleX,
      bottom: (rect.bottom - canvasRect.top) * scaleY,
    };
    if (converted.right > 0 && converted.left < canvas.width && converted.bottom > 0 && converted.top < canvas.height) result.push(converted);
  }
  return result;
}

function syncLabelHover(index: number | null) {
  if (hoveredLayerIndex === index) return;
  if (hoveredLayerIndex !== null && settings.hoverHighlight.get()) stopHoverHighlight(true);
  hoveredLayerIndex = index;
  const item = getState().item;
  if (index !== null && item && settings.hoverHighlight.get()) startHoverHighlight(item, String(index));
}

function drawLayerOutline(index: number) {
  const list = layerCaptures.get(index);
  const map = canvasMap();
  if (list?.length && map) drawCaptureOutline(list, map);
}

function captureMatrices(cap: DrawCapture, width: number, height: number): PickerMatrix[] {
  if (!width || !height) return [];
  return cap.matrices.length
    ? cap.matrices.map(m => [m[0] / width, m[1] / width, m[2] / height, m[3] / height, m[4], m[5]])
    : [[1, 0, 0, 1, cap.x, cap.y]];
}

function captureScreenBounds(cap: DrawCapture, width: number, height: number,
  bounds: AlphaData['bounds'], map: CanvasMap) {
  const points = captureMatrices(cap, width, height).flatMap(matrix =>
    [[bounds.x, bounds.y], [bounds.x + bounds.w, bounds.y],
      [bounds.x + bounds.w, bounds.y + bounds.h], [bounds.x, bounds.y + bounds.h]].map(([x, y]) => {
      const point = applyPickerMatrix(matrix, x, y);
      return canvasToScreen(point.x, point.y, map);
    }));
  return {left: Math.min(...points.map(p => p.x)), top: Math.min(...points.map(p => p.y)),
    right: Math.max(...points.map(p => p.x)), bottom: Math.max(...points.map(p => p.y))};
}

function captureOpaqueAt(cap: DrawCapture, width: number, height: number,
  bounds: AlphaData['bounds'], alpha: AlphaData | null, point: {x: number; y: number}) {
  return captureMatrices(cap, width, height).some(matrix => {
    const p = invertPickerPoint(matrix, point.x, point.y);
    return p !== null && p.x >= bounds.x && p.y >= bounds.y
      && p.x < bounds.x + bounds.w && p.y < bounds.y + bounds.h && opaqueAt(alpha, p.x, p.y);
  });
}

/** Outline, labels and hit testing share the same final draw matrices. */
function drawCaptureOutline(list: DrawCapture[], map: CanvasMap) {
  const drawable: Array<{matrix: PickerMatrix; image: HTMLImageElement}> = [];
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const cap of list) {
    const image = pickImage(cap.url);
    if (!image) continue;
    const width = image.naturalWidth || image.width, height = image.naturalHeight || image.height;
    const bounds = alphaData(cap.url, image)?.bounds ?? {x: 0, y: 0, w: width, h: height};
    const rect = captureScreenBounds(cap, width, height, bounds, map);
    minX = Math.min(minX, rect.left); minY = Math.min(minY, rect.top);
    maxX = Math.max(maxX, rect.right); maxY = Math.max(maxY, rect.bottom);
    for (const matrix of captureMatrices(cap, width, height)) drawable.push({matrix, image});
  }
  if (!drawable.length || !Number.isFinite(minX)) return;
  const pad = OUTLINE_WIDTH + 2;
  const bx = Math.max(0, Math.floor(minX - pad)), by = Math.max(0, Math.floor(minY - pad));
  const bw = Math.min(2000, Math.ceil(maxX + pad)) - bx, bh = Math.min(1000, Math.ceil(maxY + pad)) - by;
  const off = getOutlineCanvas(bw, bh);
  if (!off) return;
  const blit = (dx: number, dy: number) => {
    for (const {matrix: m, image} of drawable) {
      const origin = canvasToScreen(m[4], m[5], map);
      off.ctx.setTransform(m[0] * map.sx, m[1] * map.sy, m[2] * map.sx, m[3] * map.sy,
        origin.x - bx + dx, origin.y - by + dy);
      off.ctx.drawImage(image, 0, 0);
    }
    off.ctx.resetTransform();
  };
  off.ctx.globalCompositeOperation = 'lighter';
  for (let sample = 0; sample < OUTLINE_SAMPLES; sample++) {
    const angle = sample / OUTLINE_SAMPLES * Math.PI * 2;
    blit(Math.cos(angle) * OUTLINE_WIDTH, Math.sin(angle) * OUTLINE_WIDTH);
  }
  off.ctx.globalCompositeOperation = 'destination-out';
  blit(0, 0);
  off.ctx.globalCompositeOperation = 'source-in';
  off.ctx.fillStyle = outlineColor();
  off.ctx.fillRect(0, 0, bw, bh);
  MainCanvas.save();
  MainCanvas.globalAlpha = 0.9;
  MainCanvas.drawImage(off.canvas, 0, 0, bw, bh, bx, by, bw, bh);
  MainCanvas.restore();
}

function openItemEditor(group: AssetGroup): boolean {
  const character = CharacterAppearanceSelection;
  if (!character || typeof AppearanceItemColor !== 'function') return false;
  const item = InventoryGet(character, group.Name);
  if (!item || !item.Asset.Layer?.some(layer => !layer.CopyLayerColor && layer.AllowColorize && !layer.HideColoring)) return false;
  character.FocusGroup = group as AssetItemGroup;
  const mode = CharacterAppearanceMode;
  AppearanceItemColor(character, item, group.Name, mode === 'Cloth' || mode === 'Color' ? mode : '');
  hovered = null;
  return true;
}

function pickAt(x: number, y: number): PickHit[] {
  const map = canvasMap();
  if (!map || !inSupportedAppearanceMode() || captures.size === 0 || y < PICK_TOP) return [];
  const rightLimit = CharacterAppearanceMode === 'Cloth' ? 1246 : 1026;
  if (x < map.ox || x > Math.min(map.ox + 500 * map.sx, rightLimit)) return [];
  const point = screenToCanvas(x, y, map);
  const hits: PickHit[] = [];
  for (const [asset, list] of captures) {
    const group = pickableGroup(asset);
    if (!group) continue;
    let area = 0, hitOrder = -1;
    let opaque = false;
    for (const cap of list) {
      const image = pickImage(cap.url);
      const alpha = image ? alphaData(cap.url, image) : null;
      const width = image?.naturalWidth || image?.width || 0;
      const height = image?.naturalHeight || image?.height || 0;
      const bounds = alpha?.bounds ?? (width && height ? {x: 0, y: 0, w: width, h: height} : null);
      if (!bounds) continue;
      area += bounds.w * bounds.h;
      if (captureOpaqueAt(cap, width, height, bounds, alpha, point)) {
        opaque = true;
        hitOrder = Math.max(hitOrder, cap.order);
      }
    }
    if (opaque) hits.push({asset, group, area, order: hitOrder >= 0 ? hitOrder : stackOrder(asset)});
  }
  return hits.sort((a, b) => (b.order - a.order) || (a.area - b.area));
}

function pickableGroup(asset: Asset): AssetGroup | null {
  const group = asset.Group;
  if (!CharacterAppearanceGroups?.some(candidate => candidate.Name === group.Name)) return null;
  if (typeof AppearanceGroupAllowed === 'function' && !AppearanceGroupAllowed(CharacterAppearanceSelection!, group.Name)) return null;
  return group;
}

function findGroupHover(): PickHit | null {
  const groupName = runtimeGroupHover();
  if (!groupName) return null;
  const record = lastVisibleCaptures.get(groupName);
  const worn = pickerCharacter()?.Appearance.find(item => item.Asset.Group.Name === groupName)?.Asset;
  return record && worn === record.asset ? {asset: record.asset, group: record.asset.Group, area: 0, order: 0} : null;
}

function runtimeGroupHover(): AssetGroupName | null {
  return runtime.hoverCharGroup as AssetGroupName | null;
}

function matchAsset(url: string, character: Character | null = pickerCharacter()): Asset | null {
  const file = imageFileName(url);
  const candidates = new Set<Asset>();
  for (const layer of character?.AppearanceLayers ?? []) {
    const asset = layer.Asset;
    if (asset?.Name && file.startsWith(asset.Name)) candidates.add(asset);
  }
  // Shared textures (including copied slots) cannot identify their owner by
  // filename. Without render context, only accept an unambiguous match.
  const longest = Math.max(0, ...[...candidates].map(asset => asset.Name.length));
  const best = [...candidates].filter(asset => asset.Name.length === longest);
  return best.length === 1 ? best[0] : null;
}

function matchCurrentItemLayer(url: string, item: Item | null): number {
  const asset = item?.Asset;
  const layers = asset?.Layer;
  if (!asset || !layers?.length) return -1;
  const file = imageFileName(url);
  if (!file.startsWith(asset.Name)) return -1;
  const named = layers.filter(layer => layer.Name).map(layer => layer.Name!);
  return layers.findIndex(layer => layer.Name
    ? file.endsWith(`_${layer.Name}`) || file === layer.Name
    : !named.some(name => file.endsWith(`_${name}`) || file === name));
}

function appearanceImageOrder(asset: Asset, url: string, character: Character | null = pickerCharacter()): number {
  const file = imageFileName(url);
  const named = (asset.Layer ?? []).filter(layer => layer.Name).map(layer => layer.Name!);
  let best = -1;
  character?.AppearanceLayers?.forEach((layer, index) => {
    if (layer.Asset !== asset) return;
    const name = layer.Name ?? '';
    const matches = name
      ? file.endsWith(`_${name}`) || file === name
      : !named.some(candidate => file.endsWith(`_${candidate}`) || file === candidate);
    if (matches) best = Math.max(best, index);
  });
  return best >= 0 ? best : stackOrder(asset, character);
}

function imageFileName(url: string): string {
  return url.slice(url.lastIndexOf('/') + 1).split(/[?#]/, 1)[0].replace(/\.png$/i, '');
}

function canvasMap(): CanvasMap | null {
  const character = pickerCharacter();
  if (!character || !drawAt) return null;
  const heightRatio = drawAt.heightResize === false ? 1 : (character.HeightRatio ?? 1);
  const xOffset = CharacterAppearanceXOffset?.(character, heightRatio) ?? 0;
  const yOffset = CharacterAppearanceYOffset?.(character, heightRatio) ?? 0;
  const yCutOff = yOffset >= 0 || ServerPlayerIsInChatRoom();
  const yStart = CanvasUpperOverflow + (yCutOff ? -yOffset / heightRatio : 0);
  const sourceHeight = 1000 / heightRatio + (yCutOff ? 0 : -yOffset / heightRatio);
  const destinationY = yCutOff ? 0 : yOffset;
  return {
    ox: drawAt.x + xOffset * drawAt.zoom,
    oy: drawAt.y + destinationY * drawAt.zoom,
    sx: 500 * heightRatio * drawAt.zoom / 500,
    sy: (1000 - destinationY) * drawAt.zoom / sourceHeight,
    yStart,
  };
}

function canvasToScreen(x: number, y: number, map: CanvasMap) {
  return {x: map.ox + x * map.sx, y: map.oy + (y - map.yStart) * map.sy};
}

function screenToCanvas(x: number, y: number, map: CanvasMap) {
  return {x: (x - map.ox) / map.sx, y: (y - map.oy) / map.sy + map.yStart};
}

function pickImage(url: string): HTMLImageElement | null {
  const image = GLDrawImageCache.get(url) ?? DrawCacheImage.get(url);
  return image && (image.naturalWidth || image.width) > 1 ? image : null;
}

function alphaData(url: string, image: HTMLImageElement): AlphaData | null {
  if (alphaCache.has(url)) return alphaCache.get(url) ?? null;
  const width = image.naturalWidth || image.width;
  const height = image.naturalHeight || image.height;
  if (!width || !height || width * height > 4_000_000) return null;
  let result: AlphaData | null = null;
  try {
    const canvas = document.createElement('canvas');
    canvas.width = width; canvas.height = height;
    const context = canvas.getContext('2d', {willReadFrequently: true});
    if (!context) return null;
    context.drawImage(image, 0, 0);
    const pixels = context.getImageData(0, 0, width, height).data;
    const scale = 4, mw = Math.ceil(width / scale), mh = Math.ceil(height / scale);
    const mask = new Uint8Array(mw * mh);
    let minX = width, minY = height, maxX = -1, maxY = -1;
    for (let py = 0; py < height; py++) for (let px = 0; px < width; px++) {
      if (pixels[(py * width + px) * 4 + 3] <= 8) continue;
      mask[Math.floor(py / scale) * mw + Math.floor(px / scale)] = 1;
      minX = Math.min(minX, px); minY = Math.min(minY, py);
      maxX = Math.max(maxX, px); maxY = Math.max(maxY, py);
    }
    if (maxX >= minX) result = {bounds: {x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1}, mask, mw, mh, scale};
  } catch { result = null; }
  alphaCache.set(url, result);
  if (alphaCache.size > 300) alphaCache.delete(alphaCache.keys().next().value!);
  return result;
}

function opaqueAt(alpha: AlphaData | null, x: number, y: number): boolean {
  if (!alpha) return true;
  const mx = Math.floor(x / alpha.scale), my = Math.floor(y / alpha.scale);
  return mx >= 0 && my >= 0 && mx < alpha.mw && my < alpha.mh && alpha.mask[my * alpha.mw + mx] === 1;
}

function stackOrder(asset: Asset, character: Character | null = pickerCharacter()): number {
  let result = -1;
  character?.AppearanceLayers?.forEach((layer, index) => { if (layer.Asset === asset) result = index; });
  return result;
}

function getOutlineCanvas(width: number, height: number) {
  if (width <= 0 || height <= 0) return null;
  outlineCanvas ??= document.createElement('canvas');
  if (outlineCanvas.width < width) outlineCanvas.width = Math.ceil(width);
  if (outlineCanvas.height < height) outlineCanvas.height = Math.ceil(height);
  const context = outlineCanvas.getContext('2d');
  if (!context) return null;
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.globalCompositeOperation = 'source-over';
  context.globalAlpha = 1;
  context.clearRect(0, 0, width, height);
  return {canvas: outlineCanvas, ctx: context};
}

function outlineColor(): string {
  const selected = settings.hoverOutlineColor.get();
  if (selected === 'theme') return readUiTheme().accent;
  if (selected === 'custom') return settings.hoverOutlineCustomColor.get();
  return THEME_PRESETS.find(preset => preset.id === selected)?.accent ?? readUiTheme().accent;
}
