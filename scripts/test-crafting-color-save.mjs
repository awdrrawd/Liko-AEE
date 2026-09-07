import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const hooks = new Map();
const runtime = {};
const asset = {Name: 'Test', Group: {Name: 'Cloth'}};
const character = {};
let chatUpdates = 0;
const deps = {
  '@/modsdk': {default: {hookFunction: (name, priority, fn) => hooks.set(name, fn)}},
  '@/core/runtime': {runtime},
  '@/core/store': {getState: () => ({colorPicker: {open: false}})},
  '@/core/context': {syncCurrentContext() {}},
  '@/core/appearanceScreenMachine': {observeAppearanceScreenState: value => value, updateAppearanceScreenState() {}},
  '@/controllers/uiController': {applyLscgLayersVisibility() {}},
};
const context = vm.createContext({
  exports: {}, require: name => deps[name] ?? {}, console,
  CurrentScreen: 'Crafting', CraftingPreview: character,
  CraftingSelectedItem: null, CommonCloneDeep: structuredClone,
  ChatRoomCharacterUpdate() { chatUpdates++; },
  window: {setTimeout() {}},
});
function load(file) {
  context.exports = {};
  vm.runInContext(ts.transpileModule(fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'), {
    compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022},
  }).outputText, context);
  return context.exports;
}
deps['@/core/craftingColor'] = load('src/core/craftingColor.ts');
load('src/hooks/itemColorHooks.ts').installItemColorHooks();

function enter() {
  const craft = {Asset: asset, Color: 'Red', ItemProperty: {
    Rotation: 10, ScaleX: 1, TranslationY: 5, LayerRotation: {Front: 20}, OverridePriority: 7,
    Text: 'keep this',
  }};
  context.CurrentScreen = 'Crafting';
  context.CraftingSelectedItem = craft;
  // Simulate the worst case: the preview shares the entire craft property object.
  const item = {Asset: asset, Property: craft.ItemProperty};
  hooks.get('ItemColorLoad')([character, item], () => Promise.resolve());
  assert.notEqual(item.Property, craft.ItemProperty);
  assert.notEqual(item.Property.LayerRotation, craft.ItemProperty.LayerRotation);
  return {craft, item};
}

let {craft, item} = enter();
item.Property.Rotation = 45;
item.Property.ScaleX = 1.5;
item.Property.LayerRotation.Front = 80;
item.Property.LayerTranslationX = {Front: -15};
delete item.Property.TranslationY;
delete item.Property.OverridePriority;
item.Property.LayerOverrides = [{Rotation: 999}];
item.Property.Text = 'do not save';
hooks.get('ItemColorFireExit')([true], () => {
  // BC's native listener rebuilds the preview here, so values must already exist.
  assert.equal(craft.ItemProperty.Rotation, 45);
  assert.equal(craft.ItemProperty.ScaleX, 1.5);
  assert.equal(craft.ItemProperty.LayerRotation.Front, 80);
  assert.equal(craft.ItemProperty.LayerTranslationX.Front, -15);
  assert.equal('TranslationY' in craft.ItemProperty, false);
  assert.equal('OverridePriority' in craft.ItemProperty, false);
  assert.equal(craft.ItemProperty.Text, 'keep this');
  assert.equal(craft.ItemProperty.LayerOverrides, undefined);
  craft.Color = 'Blue'; // Native colour saving remains responsible for colours.
});
item.Property.LayerRotation.Front = -10;
assert.equal(craft.ItemProperty.LayerRotation.Front, 80, 'Saved maps are detached');
assert.equal(craft.Color, 'Blue');
assert.equal(chatUpdates, 0, 'Never broadcast a crafting preview');

({craft, item} = enter());
item.Property.Rotation = 90;
item.Property.LayerRotation.Front = 90;
hooks.get('ItemColorFireExit')([false], () => {});
assert.equal(craft.ItemProperty.Rotation, 10);
assert.equal(craft.ItemProperty.LayerRotation.Front, 20, 'Cancel does not leak nested map edits');

({craft, item} = enter());
item.Property.Rotation = 90;
context.CraftingSelectedItem = {...craft, ItemProperty: {Rotation: 12}};
hooks.get('ItemColorFireExit')([true], () => {});
assert.equal(context.CraftingSelectedItem.ItemProperty.Rotation, 12, 'Stale session cannot overwrite another craft');
assert.equal(craft.ItemProperty.Rotation, 10);

// A failure in AEE's additional write must not swallow the native exit callback.
({craft, item} = enter());
let nativeExitCalled = false;
const clone = context.CommonCloneDeep;
const warnings = [];
context.console = {warn: (...args) => warnings.push(args)};
context.CommonCloneDeep = () => { throw new Error('Simulated clone failure'); };
hooks.get('ItemColorFireExit')([true], () => { nativeExitCalled = true; });
context.CommonCloneDeep = clone;
context.console = console;
assert.equal(nativeExitCalled, true);
assert.equal(warnings.length, 1);
assert.equal(runtime.itemColorItem, null, 'Failure still clears colour runtime');

context.CurrentScreen = 'Appearance';
const normalItem = {Asset: asset, Property: {Rotation: 30}};
hooks.get('ItemColorLoad')([character, normalItem], () => Promise.resolve());
hooks.get('ItemColorFireExit')([true], () => {});
assert.equal(chatUpdates, 1, 'Normal appearance sync remains intact');
assert.equal(context.CraftingSelectedItem.ItemProperty.Rotation, 10);
await Promise.resolve();
console.log('Craft colour save checks passed: commit ordering, transforms, reset, cancel, stale sessions and normal appearance.');
