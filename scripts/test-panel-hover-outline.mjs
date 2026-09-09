import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

let flash = false, outline = true, label = false, starts = 0;
const runtime = {hoverCharGroup: null};
const stop = () => { runtime.hoverCharGroup = null; };
const dependencies = {
  '@/core/runtime': {runtime},
  '@/core/settings': {settings: {
    hoverHighlightChar: {get: () => flash},
    hoverOutlinePanel: {get: () => outline},
  }},
  '@/controllers/uiController': {stopHoverCharHighlight: stop, startHoverCharHighlight: () => starts++},
  '@/controllers/appearancePickerController': {isLayerPickerLabelPoint: () => label},
};
const exports = {};
const context = vm.createContext({exports, require: name => dependencies[name] ?? {},
  MouseX: 1200, MouseY: 160, CharacterAppearanceMode: '',
  CharacterAppearanceOffset: 0, CharacterAppearanceNumGroupPerPage: 10,
  CharacterAppearanceGroups: [{Name: 'Hat'}, {Name: 'Cloth'}],
});
const source = fs.readFileSync(new URL('../src/hooks/appearanceHooks.ts', import.meta.url), 'utf8')
  + '\nexport {handleHoverCharHighlight};';
vm.runInContext(ts.transpileModule(source, {
  compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022},
}).outputText, context);
const hover = () => exports.handleHoverCharHighlight(true);
for (flash of [false, true]) for (outline of [false, true]) {
  stop();
  starts = 0;
  hover();
  assert.equal(runtime.hoverCharGroup, flash || outline ? 'Hat' : null);
  assert.equal(starts, flash ? 1 : 0, 'outline must not start flashing');
  hover();
  assert.equal(starts, flash ? 1 : 0, 'same row must not restart animation');
}
flash = false;
outline = true;
stop();
hover();
context.MouseY = 255;
hover();
assert.equal(runtime.hoverCharGroup, 'Cloth', 'outline follows row changes');
context.MouseY = 230;
hover();
assert.equal(runtime.hoverCharGroup, null, 'row gap clears outline');
context.MouseY = 160;
hover();
label = true;
hover();
assert.equal(runtime.hoverCharGroup, null, 'layer label blocks panel hover');
label = false;
hover();
exports.handleHoverCharHighlight(false);
assert.equal(runtime.hoverCharGroup, null, 'leaving appearance clears outline');
console.log('Panel hover outline regression checks passed.');
