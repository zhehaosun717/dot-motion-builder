// Drawing layers: flattening, painting, non-destructive moves, transforms, merging, selections, symmetry.
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const assert = require('node:assert/strict');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const resolve = Module._resolveFilename;
Module._resolveFilename = function(name, ...args) {return resolve.call(this, name.startsWith('@/') ? path.join(root, 'src', name.slice(2)) : name, ...args);};
require.extensions['.ts'] = (mod, filename) => mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}}).outputText, filename);
const L = require('../src/lib/layers.ts');

const rows = 8, cols = 8;
const at = (r, c) => r * cols + c;

// A layer from cells round-trips through flattening, keeping overrides and base-coloured cells apart.
const base = L.layerFromCells('Base', [at(0, 0), at(1, 1)], {[at(1, 1)]: '#FF0000'}, cols, 'base');
assert.deepEqual(L.flattenLayers([base], rows, cols), {activeCells: [at(0, 0), at(1, 1)], cellColors: {[at(1, 1)]: '#FF0000'}});

// The top visible layer wins; hidden layers do not show.
const top = L.layerFromCells('Top', [at(1, 1), at(2, 2)], {[at(1, 1)]: '#00FF00', [at(2, 2)]: '#0000FF'}, cols, 'top');
assert.deepEqual(L.flattenLayers([base, top], rows, cols).cellColors, {[at(1, 1)]: '#00FF00', [at(2, 2)]: '#0000FF'});
assert.deepEqual(L.flattenLayers([base, {...top, visible: false}], rows, cols).activeCells, [at(0, 0), at(1, 1)]);

// Painting: colour undefined keeps an existing colour, "" is the base colour, erasing removes the pixel.
let layer = L.paintLayer(base, [at(1, 1), at(3, 3)], true, cols);
assert.equal(L.layerPixelAt(layer, at(1, 1), cols), '#FF0000', 'existing colour kept');
assert.equal(L.layerPixelAt(layer, at(3, 3), cols), '', 'new pixel takes the base colour');
layer = L.paintLayer(layer, [at(3, 3)], true, cols, '#ABCDEF');
assert.equal(L.layerPixelAt(layer, at(3, 3), cols), '#ABCDEF');
layer = L.paintLayer(layer, [at(0, 0)], false, cols);
assert.equal(L.layerPixelAt(layer, at(0, 0), cols), undefined);
assert.equal(L.paintLayer(layer, [at(5, 5)], false, cols), layer, 'no change returns the same layer');

// Moving a layer off the grid and back loses nothing (the reported bug).
let moved = base;
for (let i = 0; i < 5; i++) moved = L.transformLayer(moved, 'left', rows, cols);
assert.deepEqual(L.flattenLayers([moved], rows, cols).activeCells, [], 'everything is off the grid');
for (let i = 0; i < 5; i++) moved = L.transformLayer(moved, 'right', rows, cols);
assert.deepEqual(L.flattenLayers([moved], rows, cols), L.flattenLayers([base], rows, cols), 'and comes back intact');

// Painting on a moved layer lands under the pointer.
const shifted = L.offsetLayer(base, 2, 1);
const painted = L.paintLayer(shifted, [at(4, 4)], true, cols, '#111111');
assert.equal(painted.pixels['2,3'], '#111111', 'stored in layer coordinates');
assert(L.flattenLayers([painted], rows, cols).activeCells.includes(at(4, 4)));

// Flips and rotations turn around the grid centre and keep off-grid pixels.
const corner = L.layerFromCells('c', [at(0, 0)], {}, cols);
assert.deepEqual(L.flattenLayers([L.transformLayer(corner, 'flip-h', rows, cols)], rows, cols).activeCells, [at(0, 7)]);
assert.deepEqual(L.flattenLayers([L.transformLayer(corner, 'flip-v', rows, cols)], rows, cols).activeCells, [at(7, 0)]);
assert.deepEqual(L.flattenLayers([L.transformLayer(corner, 'rotate-cw', rows, cols)], rows, cols).activeCells, [at(0, 7)]);
assert.deepEqual(L.flattenLayers([L.transformLayer(corner, 'rotate-ccw', rows, cols)], rows, cols).activeCells, [at(7, 0)]);
const outside = L.offsetLayer(corner, -3, 0);
const flippedOutside = L.transformLayer(outside, 'flip-h', rows, cols);
assert.deepEqual(L.flattenLayers([flippedOutside], rows, cols).activeCells, [], 'an off-grid pixel mirrors to off-grid');
assert.deepEqual(L.flattenLayers([L.transformLayer(flippedOutside, 'flip-h', rows, cols)], rows, cols).activeCells, [], 'still off-grid');
assert.equal(Object.keys(L.transformLayer(flippedOutside, 'flip-h', rows, cols).pixels).length, 1, 'but not lost');

// Merging keeps the upper layer's pixels on top, at the same place on the grid.
const merged = L.mergeLayers(base, L.offsetLayer(top, 1, 0));
assert.deepEqual(L.flattenLayers([merged], rows, cols), L.flattenLayers([base, L.offsetLayer(top, 1, 0)], rows, cols));
assert.equal(merged.id, 'base');

// Lifting a selection splits a layer without moving anything on screen.
const box = L.cellsInBox({x0: 1, y0: 1, x1: 2, y1: 2}, rows, cols);
assert.deepEqual(box, [at(1, 1), at(1, 2), at(2, 1), at(2, 2)]);
const {rest, lifted} = L.liftCells(L.offsetLayer(top, 0, 0), box, cols, 'Selection');
assert.deepEqual(L.flattenLayers([rest, lifted], rows, cols), L.flattenLayers([top], rows, cols), 'lifting changes nothing visible');
assert.equal(Object.keys(rest.pixels).length, 0);
assert.equal(Object.keys(lifted.pixels).length, 2);
assert.deepEqual(L.cellsInBox({x0: -2, y0: 6, x1: 1, y1: 12}, rows, cols), [at(6, 0), at(6, 1), at(7, 0), at(7, 1)], 'boxes are clipped to the grid');

// Replacing keeps id, name and visibility.
const replaced = L.replaceLayerCells({...top, visible: false}, [at(5, 5)], {[at(5, 5)]: '#123456'}, cols);
assert.equal(replaced.id, 'top');
assert.equal(replaced.visible, false);
assert.deepEqual(replaced.pixels, {'5,5': '#123456'});

// Stored layers are sanitised.
assert.equal(L.sanitizeLayer(null, 0), null);
const cleaned = L.sanitizeLayer({id: 'x', pixels: {'1,2': '#abcdef', 'a,b': '#FFFFFF', '3,3': 'red', '9999,0': '#FFFFFF'}, offsetX: 1.6}, 2);
assert.deepEqual(cleaned, {id: 'x', name: '', visible: true, offsetX: 2, offsetY: 0, pixels: {'1,2': '#ABCDEF', '3,3': ''}});

// Symmetry partners.
assert.deepEqual(L.mirroredCells(at(1, 2), rows, cols, 'none'), [at(1, 2)]);
assert.deepEqual(L.mirroredCells(at(1, 2), rows, cols, 'x'), [at(1, 2), at(1, 5)]);
assert.deepEqual(L.mirroredCells(at(1, 2), rows, cols, 'y'), [at(1, 2), at(6, 2)]);
assert.deepEqual(L.mirroredCells(at(1, 2), rows, cols, 'xy').sort((a, b) => a - b), [at(1, 2), at(1, 5), at(6, 2), at(6, 5)]);
assert.deepEqual(L.mirroredCells(3 * 7 + 3, 7, 7, 'xy'), [24], 'the centre cell of an odd grid is its own mirror');

// Loader-level operations: legacy drawings become a layer on first edit; flat cells always follow the layers.
const ops = require('../src/stores/layer-ops.ts');
const {createMockProject} = require('../src/lib/mock-project.ts');
const legacy = structuredClone(createMockProject().loaders[0]);
legacy.pattern.grid = {...legacy.pattern.grid, rows: 8, cols: 8};
legacy.pattern.activeCells = [at(0, 0)];
legacy.pattern.cellColors = {};
legacy.style.primaryColor = '#66BDFF';
delete legacy.pattern.layers;
let lo = ops.paintCells(legacy, [at(1, 1)], true, '#66bdff');
assert.equal(lo.pattern.layers.length, 1, 'first edit turns the old drawing into a layer');
assert.deepEqual(lo.pattern.activeCells, [at(0, 0), at(1, 1)]);
assert.deepEqual(lo.pattern.cellColors, {}, 'painting with the base colour stores no override');
const imported = ops.putCellsOnLayer(lo, [at(2, 2)], {[at(2, 2)]: '#FF0000'}, {name: 'photo'});
lo = imported.loader;
assert.equal(lo.pattern.layers.length, 2);
assert.equal(lo.pattern.activeLayerId, imported.layerId, 'an import becomes the active layer');
lo = ops.moveLayerBy(lo, imported.layerId, 3, 0);
const reapplied = ops.putCellsOnLayer(lo, [at(2, 2), at(2, 3)], {}, {layerId: imported.layerId, name: ''}).loader;
assert.deepEqual(reapplied.pattern.activeCells, [at(0, 0), at(1, 1), at(2, 5), at(2, 6)], 're-applying keeps the layer where it was moved');
lo = ops.paintCells(lo, [at(0, 0)], false);
assert(lo.pattern.activeCells.includes(at(0, 0)), 'erasing on the top layer leaves the layer below alone');
const liftedLo = ops.liftToLayer(ops.selectLayer(lo, lo.pattern.layers[0].id), [at(0, 0), at(1, 1)], 'sel');
assert.equal(liftedLo.loader.pattern.layers.length, 3);
assert.deepEqual(liftedLo.loader.pattern.activeCells, lo.pattern.activeCells, 'lifting changes nothing visible');
assert.equal(ops.liftToLayer(lo, [at(7, 7)], 'none').layerId, null, 'nothing to lift');
const fromBelow = ops.liftToLayer(ops.selectLayer(lo, imported.layerId), [at(1, 1)], 'sel');
assert(fromBelow.layerId, 'an empty active layer lifts from the visible layer that has the pixels');
assert.equal(Object.keys(fromBelow.loader.pattern.layers.find(l => l.id === fromBelow.layerId).pixels).length, 1);
const mergedLo = ops.mergeLayerDown(lo, imported.layerId);
assert.equal(mergedLo.pattern.layers.length, 1);
assert.deepEqual(mergedLo.pattern.activeCells, lo.pattern.activeCells, 'merging changes nothing visible');
const single = ops.deleteLayer(mergedLo, mergedLo.pattern.layers[0].id);
assert.equal(single.pattern.layers.length, 1, 'the last layer is emptied, not removed');
assert.deepEqual(single.pattern.activeCells, []);
assert.deepEqual(ops.fillActiveLayer(single, true).pattern.activeCells.length, 64);
const hiddenLo = ops.setLayerVisible(lo, imported.layerId, false);
assert(!hiddenLo.pattern.activeCells.includes(at(2, 5)), 'hidden layers do not show');
const tampered = {...lo, pattern: {...lo.pattern, activeCells: [63], layers: [...lo.pattern.layers, {id: 7}]}};
assert.deepEqual(ops.syncLayers(ops.sanitiseStoredLayers(tampered)).pattern.activeCells, lo.pattern.activeCells, 'stored flat cells cannot disagree with the layers');
assert.deepEqual(ops.syncLayers({...lo, pattern: {...lo.pattern, activeCells: [63]}}).pattern.activeCells, lo.pattern.activeCells, 'every edit re-derives the flat cells');

// Review regressions: a drawing without stored layers keeps one stable layer id, so panel actions land.
const fresh = {...legacy, pattern: {...legacy.pattern, layers: undefined, activeLayerId: undefined}};
assert.equal(ops.layersOf(fresh).activeId, ops.layersOf(fresh).activeId, 'the stand-in layer id is stable');
const freshId = ops.layersOf(fresh).activeId;
assert.equal(ops.setLayerVisible(fresh, freshId, false).pattern.activeCells.length, 0, 'hiding the stand-in layer works');
assert.equal(ops.duplicateLayer(fresh, freshId, 'copy').pattern.layers.length, 2, 'duplicating it works');
assert.equal(ops.renameLayer(fresh, freshId, 'base').pattern.layers[0].name, 'base', 'renaming it works');
// At the layer limit, imports are refused instead of dropping the bottom layer.
let crowded = fresh;
for (let i = 0; i < ops.MAX_LAYERS - 1; i++) crowded = ops.addEmptyLayer(crowded, `L${i}`);
assert.equal(crowded.pattern.layers.length, ops.MAX_LAYERS);
const refused = ops.putCellsOnLayer(crowded, [at(7, 7)], {}, {name: 'one too many'});
assert.equal(refused.layerId, null);
assert.equal(refused.loader, crowded, 'nothing is dropped');
assert.deepEqual(crowded.pattern.activeCells, [at(0, 0)], 'the bottom layer keeps its pixels');
// A lifted selection keeps its source layer's visibility.
const hiddenSource = ops.setLayerVisible(fresh, freshId, false);
assert.equal(ops.liftToLayer(hiddenSource, [at(0, 0)], 'sel').loader.pattern.layers[1].visible, false);
assert.equal(ops.reorderLayer(lo, imported.layerId, 1), lo, 'the top layer cannot move up');

// Agent artwork format: palette rows in and out.
const A = require('../src/lib/agent-editor.ts');
assert.deepEqual(A.artworkPixels(['r.g', ' x'], {r: '#ff0000', g: '00FF00'}, 1, 2), {'1,2': '#FF0000', '3,2': '#00FF00'}, 'dots, spaces and unknown keys stay unlit');
assert.deepEqual(A.artworkCells(['rr'], {r: '#FF0000'}, 4, 4, 3, 0), {cells: [3], colors: {3: '#FF0000'}}, 'clipped to the grid');
const parsed = A.editorDrawSchema.parse({frames: [['r']], palette: {r: '#FF0000'}});
assert.equal(parsed.target, 'layer');
assert.throws(() => A.editorDrawSchema.parse({frames: [['r']], palette: {r: 'red'}}), 'colours must be hex');
const art = {
  name: 'Smile', style: {primaryColor: '#66BDFF'},
  pattern: {grid: {rows: 2, cols: 3}, activeCells: [0, 2, 4], cellColors: {2: '#FF0000'},
    layers: [L.layerFromCells('', [0, 2], {2: '#FF0000'}, 3, 'a'), L.layerFromCells('mouth', [4], {}, 3, 'b')], activeLayerId: 'b'}
};
const read = A.drawingToArtwork(art);
assert.equal(read.pixels.length, 2);
assert.equal(read.pixels[0][1], '.');
assert.equal(read.palette[read.pixels[0][0]], '#66BDFF', 'base-coloured cells read as the base colour');
assert.equal(read.palette[read.pixels[0][2]], '#FF0000');
assert.deepEqual(read.layers.map(l => [l.name, l.active, l.pixelCount]), [['mouth', true, 1], ['Layer 1', false, 2]], 'top layer first');
const roundTrip = A.artworkCells(read.pixels, read.palette, 2, 3);
assert.deepEqual(roundTrip.cells, [0, 2, 4], 'what an agent reads it can draw back');
const many = {...art, pattern: {grid: {rows: 10, cols: 10}, activeCells: Array.from({length: 100}, (_, i) => i), cellColors: Object.fromEntries(Array.from({length: 100}, (_, i) => [i, '#' + (i * 2).toString(16).padStart(2, '0') + '4080']))}};
const reduced = A.drawingToArtwork(many);
assert(Object.keys(reduced.palette).length <= 62 && reduced.pixels.every(row => row.length === 10), 'photos are reduced to the available keys');

// The editor side of the agent tools, against the real store.
const {useEditorStore} = require('../src/stores/use-editor-store.ts');
const {handleEditorRequest} = require('../src/components/editor/agent-editor-handler.ts');
const store = useEditorStore.getState();
const startCount = store.project.loaders.length;
const firstId = store.selectedLoaderId;
const layerResult = handleEditorRequest({action: 'draw', payload: {frames: [['rr', '.r']], palette: {r: '#FF0000'}, name: 'cat'}});
assert.equal(layerResult.created, 'layer');
assert.equal(layerResult.pixels, 3);
let first = useEditorStore.getState().project.loaders.find(l => l.id === firstId);
assert.equal(first.pattern.layers[first.pattern.layers.length - 1].name, 'cat', 'drawn as a new top layer');
assert(first.pattern.activeCells.includes(0) && first.pattern.cellColors[0] === '#FF0000');
const seen = handleEditorRequest({action: 'get-drawing'});
assert.equal(seen.layers[0].name, 'cat');
assert.equal(seen.palette[seen.pixels[0][0]], '#FF0000');
const boardResult = handleEditorRequest({action: 'draw', payload: {frames: [['g']], palette: {g: '#00FF00'}, target: 'artboard', name: 'tree'}});
assert.equal(boardResult.created, 'artboard');
assert.equal(useEditorStore.getState().project.loaders.length, startCount + 1);
const board = useEditorStore.getState().project.loaders.find(l => l.id === useEditorStore.getState().selectedLoaderId);
assert.equal(board.name, 'tree');
assert.equal(board.animation.presetId, 'static', 'a drawn artboard shows as drawn');
const seqResult = handleEditorRequest({action: 'draw', payload: {frames: [['r'], ['.r'], ['..r']], palette: {r: '#FF0000'}, fps: 8}});
assert.equal(seqResult.created, 'sequence');
assert.equal(useEditorStore.getState().project.loaders.filter(l => l.sequenceId).length >= 3, true);
assert.throws(() => handleEditorRequest({action: 'draw', payload: {frames: [], palette: {}}}));
assert.throws(() => handleEditorRequest({action: 'erase-everything'}), /unknown editor action/);

console.log('PASS: layers — flatten, paint, lossless moves, transforms, merge, lift, sanitise, symmetry, agent artwork format and editor tools.');
