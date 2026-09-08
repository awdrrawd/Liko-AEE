import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const makeItem = group => {
  const Asset = {Name: 'Ribbon', Group: {Name: group}};
  Asset.Layer = [{Name: 'Bow', Asset}];
  return {Asset};
};
const first = makeItem('HairAccessory1'), second = makeItem('HairAccessory2');
const character = {Appearance: [first, second], AppearanceLayers: [...first.Asset.Layer, ...second.Asset.Layer]};
const state = {visible: true, item: first, layers: first.Asset.Layer, colorPicker: {}, transformOverlay: {}, layerPickerMode: 'detail'};
const runtime = {currentRenderChar: character, currentDrawLayerIndex: 0};
const dependencies = {
  '@/core/runtime': {runtime},
  '@/core/store': {getState: () => state},
  '@/core/settings': {settings: {hoverOutlineColor: {get: () => 'theme'}, appearancePick: {get: () => true}}},
  '@/core/bc': {getCurrentCharacter: () => character},
};
const exports = {};
const source = fs.readFileSync(new URL('../src/controllers/appearancePickerController.ts', import.meta.url), 'utf8')
  + '\nexport {frame, layerFrame, matchAsset};';
vm.runInNewContext(ts.transpileModule(source, {
  compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022},
}).outputText, {exports, require: name => dependencies[name] ?? {},
  CurrentScreen: 'Appearance', CharacterAppearanceSelection: character,
  CharacterAppearanceMode: '', DialogFocusItem: null});

const url = 'Assets/Female3DCG/HairAccessory1/Ribbon_Bow.png';
runtime.currentDrawLayerItem = first;
exports.captureAppearanceImage(url, 10, 20);
runtime.currentDrawLayerItem = second;
exports.captureAppearanceImage(url, 200, 300);
assert.equal(exports.frame.get(first.Asset).length, 1, 'first slot only owns its own draw');
assert.equal(exports.frame.get(second.Asset).length, 1, 'shared URL retains second slot identity');
assert.equal(exports.layerFrame.get(0).length, 1, 'other slot cannot contaminate labels or layer hits');
assert.equal(exports.layerFrame.get(0)[0].x, 10);

state.item = second;
state.layers = second.Asset.Layer;
exports.layerFrame.clear();
runtime.currentDrawLayerItem = first;
exports.captureAppearanceImage(url, 10, 20);
assert.equal(exports.layerFrame.size, 0, 'selection works independently of appearance order');
runtime.currentDrawLayerItem = second;
exports.captureAppearanceImage(url, 200, 300);
assert.equal(exports.layerFrame.get(0)[0].x, 200);

runtime.currentDrawLayerItem = null;
assert.equal(exports.matchAsset(url, character), null, 'ambiguous filename must not choose first slot');
exports.layerFrame.clear();
exports.captureAppearanceImage(url, 500, 500);
assert.equal(exports.layerFrame.size, 0, 'ambiguous fallback cannot create a ghost label');
character.AppearanceLayers = first.Asset.Layer;
assert.equal(exports.matchAsset(url, character), first.Asset, 'unique legacy URL fallback still works');
state.item = first;
exports.captureAppearanceImage(url, 30, 40);
assert.equal(exports.layerFrame.get(0)[0].x, 30, 'unique fallback supplies editor layers without render context');

exports.layerFrame.clear();
runtime.currentDrawLayerItem = first;
runtime.currentDrawLayerIndex = -1;
exports.captureAppearanceImage(url, 50, 60);
assert.equal(exports.layerFrame.get(0)[0].x, 50, 'known owner can resolve a missing layer index by filename');
exports.layerFrame.clear();
runtime.currentDrawLayerItem = {Asset: first.Asset};
exports.captureAppearanceImage(url, 70, 80);
assert.equal(exports.layerFrame.size, 0, 'a different Item sharing the same Asset cannot supply editor layers');
console.log('Picker item identity regression passed');
