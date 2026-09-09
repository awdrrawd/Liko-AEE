import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const character = {};
const runtime = {itemColorChar: character, inAppearanceRun: false};
const state = {visible: true, item: {}, editTool: 'gizmo', transformOverlay: {}, colorPicker: {}, layerPickerMode: 'off'};
const options = {hideCloseup: true, hideFullbody: false, charOffsetX: 0, charOffsetY: 0, charScale: 1};
const view = Object.fromEntries(Object.keys(options).map(key => [key, {get: () => options[key]}]));
const hooks = new Map();
const globals = {
  CurrentScreen: 'Crafting', CraftingPreview: character, CharacterAppearanceSelection: character,
  document: {addEventListener: () => {}},
};
function load(file, dependencies, extra = '') {
  const exports = {};
  const context = vm.createContext({...globals, exports, require: name => dependencies[name] ?? {}});
  vm.runInContext(ts.transpileModule(fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8') + extra, {
    compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022},
  }).outputText, context);
  return {exports, context};
}
const picker = load('src/controllers/appearancePickerController.ts', {
  '@/core/runtime': {runtime}, '@/core/store': {getState: () => state},
  '@/core/bc': {getCurrentCharacter: () => character},
  '@/core/settings': {settings: {hoverOutlinePanel: {get: () => false}, appearancePick: {get: () => false}}},
}, '\nexport function capturedDraw() { return frameDrawAt; }\nexport function resetDraw() { frameDrawAt = null; }');
const appearance = load('src/hooks/appearanceHooks.ts', {
  '@/modsdk': {default: {hookFunction: (name, priority, fn) => hooks.set(name, fn)}},
  '@/core/runtime': {runtime}, '@/core/viewSettings': {getViewSettings: () => view},
  '@/core/appearanceScreenMachine': {onAppearanceScreenTransition: () => {}},
  '@/controllers/appearancePickerController': picker.exports,
});
appearance.exports.installAppearanceHooks();
const draw = hooks.get('DrawCharacter');
function run(closeup, fullbody) {
  options.hideCloseup = !closeup;
  options.hideFullbody = !fullbody;
  picker.exports.resetDraw();
  const rendered = [];
  const next = args => rendered.push(args);
  draw([character, -100, 100, 2, false], next);
  draw([character, 700, 100, 0.9, false], next);
  return rendered;
}
function expectMap(x, y, zoom) {
  const actual = picker.exports.capturedDraw();
  assert.equal(actual?.x, x);
  assert.equal(actual?.y, y);
  assert.equal(actual?.zoom, zoom);
  assert.equal(actual?.heightResize, false);
}
assert.equal(run(false, true).length, 1);
expectMap(700, 100, 0.9);
assert.equal(run(true, true).length, 2);
expectMap(700, 100, 0.9);
assert.equal(run(true, false).length, 1);
expectMap(-100, 100, 2);
assert.equal(run(false, false).length, 0);
assert.equal(picker.exports.capturedDraw(), null, 'hidden previews must not be captured');
options.charOffsetX = 40; options.charOffsetY = -20; options.charScale = 1.5;
run(false, true);
expectMap(740, 80, 1.35);
// Another character cannot replace the edited preview's draw rectangle.
draw([{}, 0, 0, 1, false], () => {});
expectMap(740, 80, 1.35);
// Dialogs with arbitrary zoom retain their draw rectangle after moving the
// capture below the visibility branches.
appearance.context.CurrentScreen = 'ChatRoom';
picker.context.CurrentScreen = 'ChatRoom';
picker.exports.resetDraw();
draw([character, 500, 50, 0.65, false], () => {});
expectMap(500, 50, 0.65);
console.log('Crafting preview regression checks passed.');
