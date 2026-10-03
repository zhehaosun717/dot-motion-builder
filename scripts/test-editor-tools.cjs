// Drawing tools: continuous strokes, rectangles, flood fill and pointer-to-cell mapping.
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const assert = require('node:assert/strict');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const resolve = Module._resolveFilename;
Module._resolveFilename = function(name, ...args) {return resolve.call(this, name.startsWith('@/') ? path.join(root, 'src', name.slice(2)) : name, ...args);};
require.extensions['.ts'] = (mod, filename) => mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}}).outputText, filename);
const {cellsOnLine, cellsInRect, floodFill, floodFillWhere, colorsWithinTolerance, isPointOnCells, cellAtPoint} = require('../src/lib/grid-tools.ts');

const cols = 8, rows = 8;
const at = (r, c) => r * cols + c;

// A fast drag reports far-apart points; the stroke must still be continuous.
assert.deepEqual(cellsOnLine(at(0, 0), at(0, 5), cols), [0, 1, 2, 3, 4, 5], 'horizontal stroke fills every cell');
assert.deepEqual(cellsOnLine(at(0, 0), at(3, 3), cols), [at(0, 0), at(1, 1), at(2, 2), at(3, 3)], 'diagonal');
const steep = cellsOnLine(at(0, 1), at(6, 3), cols);
assert.equal(steep.length, 7, 'one cell per row on a steep line');
for (let i = 1; i < steep.length; i++) {
  const [a, b] = [steep[i - 1], steep[i]];
  assert(Math.abs(Math.floor(a / cols) - Math.floor(b / cols)) <= 1 && Math.abs((a % cols) - (b % cols)) <= 1, 'no gaps in a steep line');
}
assert.deepEqual(cellsOnLine(at(2, 2), at(2, 2), cols), [at(2, 2)], 'a click is one cell');

assert.deepEqual(cellsInRect(at(1, 1), at(2, 3), cols).sort((a, b) => a - b), [at(1, 1), at(1, 2), at(1, 3), at(2, 1), at(2, 2), at(2, 3)]);
assert.equal(cellsInRect(at(5, 6), at(1, 2), cols).length, 5 * 5, 'rectangles work in any drag direction');

// Flood fill: the connected region sharing the start cell's state (4-neighbourhood).
const ring = new Set([at(1, 1), at(1, 2), at(1, 3), at(2, 1), at(2, 3), at(3, 1), at(3, 2), at(3, 3)]);
assert.deepEqual(floodFill(at(2, 2), ring, rows, cols), [at(2, 2)], 'the hole inside a ring');
assert.equal(floodFill(at(0, 0), ring, rows, cols).length, rows * cols - ring.size - 1, 'outside region excludes the enclosed hole');
assert.equal(floodFill(at(1, 1), ring, rows, cols).length, ring.size, 'filling a lit region selects the whole ring');

// Pointer to cell, with gaps snapping to the nearest cell and a zoomed canvas.
const geometry = {left: 100, top: 50, scale: 2, padding: 10, cellSize: 20, gap: 4, rows, cols};
assert.equal(cellAtPoint(100 + 2 * (10 + 5), 50 + 2 * (10 + 5), geometry), at(0, 0));
assert.equal(cellAtPoint(100 + 2 * (10 + 24 * 3 + 5), 50 + 2 * (10 + 24 * 2 + 5), geometry), at(2, 3));
assert.equal(cellAtPoint(100 + 2 * (10 + 22), 50 + 2 * (10 + 5), geometry), at(0, 1), 'a point in a gap snaps to the nearest cell');
assert.equal(cellAtPoint(0, 0, geometry), at(0, 0), 'points outside clamp to the grid');
assert.equal(cellAtPoint(99999, 99999, geometry), at(7, 7));

// Colour-aware bucket fill: a region is cells that look the same (state + colour).
const colours = {[at(0, 0)]: '#FF0000', [at(0, 1)]: '#FF0000', [at(0, 2)]: '#00FF00'};
const lit = new Set([at(0, 0), at(0, 1), at(0, 2)]);
const keyOf = cell => (lit.has(cell) ? colours[cell] ?? '#PRIMARY' : 'off');
assert.deepEqual(floodFill(at(0, 0), lit, rows, cols, keyOf).sort((a, b) => a - b), [at(0, 0), at(0, 1)], 'fill stops at a different colour');

// Image import: pixels -> lit cells with their colours; transparent and near-black stay off.
const {pixelsToCells} = require('../src/lib/image-import.ts');
const rgba = new Uint8ClampedArray(2 * 2 * 4);
rgba.set([255, 0, 0, 255], 0);        // red
rgba.set([0, 0, 0, 255], 4);          // black -> off (an unlit LED)
rgba.set([0, 128, 255, 10], 8);       // nearly transparent -> off
rgba.set([250, 250, 250, 255], 12);   // white
const imported = pixelsToCells(rgba, 2, 2);
assert.deepEqual(imported.cells, [0, 3]);
assert.deepEqual(imported.colors, {0: '#FF0000', 3: '#FAFAFA'});

// Static preset: every cell fully lit at all times (for still pixel art and imported images).
const {sampleMotion} = require('../src/lib/core/motion-sampler.ts');
const {createMockProject} = require('../src/lib/mock-project.ts');
const {getDefaultMotionConfig, motionPresets} = require('../src/lib/motion-presets.ts');
assert(motionPresets.some(p => p.id === 'static'), 'static preset is offered');
const still = structuredClone(createMockProject().loaders[0]);
still.animation = {...still.animation, ...getDefaultMotionConfig('static')};
for (const t of [0, 0.3, 0.77]) assert.deepEqual(sampleMotion(still, 5, t), {opacity: 1, scale: 1}, 'static never dims');

// Fill tolerance: a per-channel difference in percent of 255; 0 is exact and keeps unlit cells apart.
assert.equal(colorsWithinTolerance('#FF0000', '#FF0000', 0), true);
assert.equal(colorsWithinTolerance('#FF0000', '#F00000', 0), false, 'tolerance 0 is an exact match');
assert.equal(colorsWithinTolerance('#FF0000', '#F00000', 10), true, '15/255 is within 10%');
assert.equal(colorsWithinTolerance('#FF0000', '#C00000', 10), false, '63/255 is not within 10%');
assert.equal(colorsWithinTolerance(null, null, 0), true, 'unlit matches unlit');
assert.equal(colorsWithinTolerance(null, '#000000', 0), false, 'tolerance 0 never mixes unlit and lit');
assert.equal(colorsWithinTolerance(null, '#101010', 10), true, 'with tolerance, unlit counts as black');
// A photo-like gradient row: exact fill stops at the first step, tolerance spreads along it.
const shades = ['#200000', '#280000', '#300000', '#380000', '#900000', '#980000', '#A00000', '#A80000'];
const colorAt = cell => (cell < cols ? shades[cell] : null);
const fillRow = tolerance => floodFillWhere(0, rows, cols, cell => colorsWithinTolerance(colorAt(cell), colorAt(0), tolerance)).sort((a, b) => a - b);
assert.deepEqual(fillRow(0), [0], 'exact fill takes one shade');
assert.deepEqual(fillRow(10), [0, 1, 2, 3], 'tolerance fills the dark shades only');
assert.deepEqual(floodFillWhere(at(4, 4), rows, cols, () => true).length, rows * cols, 'region covers the whole grid when everything belongs');

// Presses in the padding around the cells belong to the artboard; gaps between cells belong to the grid.
assert.equal(isPointOnCells(100 + 2 * (10 + 22), 50 + 2 * (10 + 5), geometry), true, 'a gap between cells is on the grid');
assert.equal(isPointOnCells(100 + 2 * 3, 50 + 2 * (10 + 5), geometry), false, 'left padding is not');
const gridExtent = cols * 20 + (cols - 1) * 4;
assert.equal(isPointOnCells(100 + 2 * (10 + gridExtent + 1), 50 + 2 * (10 + 5), geometry), true, 'half a gap past the last cell still counts');
assert.equal(isPointOnCells(100 + 2 * (10 + gridExtent + 6), 50 + 2 * (10 + 5), geometry), false, 'right padding is not');

// Shapes: outline rectangles, ellipses, lines through shapeCells.
const {cellsInEllipse, shapeCells, isShapeTool} = require('../src/lib/grid-tools.ts');
const sorted = list => [...list].sort((a, b) => a - b);
assert.deepEqual(sorted(cellsInRect(at(1, 1), at(3, 4), cols, false)), sorted([at(1, 1), at(1, 2), at(1, 3), at(1, 4), at(2, 1), at(2, 4), at(3, 1), at(3, 2), at(3, 3), at(3, 4)]), 'outline rectangle is its border');
assert.equal(cellsInRect(at(1, 1), at(1, 1), cols, false).length, 1, 'a one-cell outline is that cell');
assert.deepEqual(sorted(cellsInEllipse(at(0, 0), at(2, 2), cols)), sorted([at(0, 1), at(1, 0), at(1, 1), at(1, 2), at(2, 1)]), 'a 3x3 circle is a plus, not a square');
const disc = cellsInEllipse(at(0, 0), at(6, 6), cols), ring2 = cellsInEllipse(at(0, 0), at(6, 6), cols, false);
assert(ring2.length < disc.length && ring2.every(c => disc.includes(c)), 'the outline is part of the disc');
assert(!ring2.includes(at(3, 3)), 'the outline is hollow');
assert(!disc.includes(at(0, 0)) && disc.includes(at(3, 0)) && disc.includes(at(0, 3)), 'corners are cut, edge midpoints kept');
assert.deepEqual(sorted(cellsInEllipse(at(6, 6), at(0, 0), cols)), sorted(disc), 'any drag direction');
assert.deepEqual(shapeCells('line', at(0, 0), at(0, 3), cols, true), [0, 1, 2, 3]);
assert.deepEqual(shapeCells('rect', at(0, 0), at(2, 2), cols, false).length, 8);
assert(isShapeTool('ellipse') && !isShapeTool('fill'));

// Whole-drawing transforms keep colours with their cells; nudges drop what leaves the grid.
const {transformPattern} = require('../src/lib/grid-transforms.ts');
const drawing = {cells: [at(0, 0), at(0, 1), at(2, 7)], colors: {[at(0, 1)]: '#FF0000'}};
const tf = op => transformPattern(drawing.cells, drawing.colors, rows, cols, op);
assert.deepEqual(tf('right'), {activeCells: [at(0, 1), at(0, 2)], cellColors: {[at(0, 2)]: '#FF0000'}}, 'nudge right drops the cell at the edge');
assert.deepEqual(tf('down').activeCells, [at(1, 0), at(1, 1), at(3, 7)]);
assert.deepEqual(tf('flip-h'), {activeCells: [at(0, 6), at(0, 7), at(2, 0)], cellColors: {[at(0, 6)]: '#FF0000'}});
assert.deepEqual(tf('flip-v').activeCells, [at(5, 7), at(7, 0), at(7, 1)]);
assert.deepEqual(tf('rotate-cw').activeCells, [at(0, 7), at(1, 7), at(7, 5)], 'top row turns into the right column');
const back = transformPattern(tf('rotate-cw').activeCells, tf('rotate-cw').cellColors, rows, cols, 'rotate-ccw');
assert.deepEqual(back, {activeCells: drawing.cells, cellColors: drawing.colors}, 'rotate there and back is lossless');

// Image import processing: black cut, colour reduction, dithering, frame sampling.
const {sampleFrameIndices, sequenceFps} = require('../src/lib/image-import.ts');
const strip = new Uint8ClampedArray(4 * 4 * 4);
for (let i = 0; i < 16; i++) strip.set([i * 16, i * 8, 255 - i * 16, 255], i * 4);
assert.equal(pixelsToCells(strip, 4, 4).cells.length, 16, 'every visible pixel is lit');
const dim = new Uint8ClampedArray([20, 20, 20, 255, 200, 200, 200, 255]);
assert.deepEqual(pixelsToCells(dim, 1, 2).cells, [0, 1], 'default cut keeps dim grey');
assert.deepEqual(pixelsToCells(dim, 1, 2, {blackCut: 20}).cells, [1], 'a higher black cut turns dark pixels off');
const reduced = pixelsToCells(strip, 4, 4, {colors: 4});
assert(new Set(Object.values(reduced.colors)).size <= 4, 'colour reduction keeps at most 4 colours');
const dithered = pixelsToCells(strip, 4, 4, {colors: 2, dither: true});
assert(new Set(Object.values(dithered.colors)).size <= 2 && dithered.cells.length === 16, 'dithering still uses the reduced palette');
const flat = new Uint8ClampedArray(8 * 8 * 4);
for (let i = 0; i < 64; i++) flat.set([128, 128, 128, 255], i * 4);
const bw = pixelsToCells(flat, 8, 8, {colors: 2, dither: true});
assert.equal(new Set(Object.values(bw.colors)).size, 1, 'a flat image has one colour to reduce to');
assert.deepEqual(sampleFrameIndices(5, 24), [0, 1, 2, 3, 4]);
assert.deepEqual(sampleFrameIndices(48, 24).slice(0, 3), [0, 2, 4], 'long animations are sampled evenly');
assert.equal(sequenceFps(2000, 24), 12, '24 frames over 2 s play at 12 fps');
assert.equal(sequenceFps(100, 24), 20, 'clamped to what the panel plays');

// Text tool: the built-in pixel fonts, wrapped and centred on the grid.
const {textToCells} = require('../src/lib/text-cells.ts');
const hi = textToCells('HI', 8, 8, 'small');
assert(hi.length > 0 && hi.every(c => c >= 0 && c < 64), 'small text lands inside the grid');
const hiRows = new Set(hi.map(c => Math.floor(c / 8)));
assert.equal(hiRows.size, 5, 'the 3x5 font is five rows tall');
assert.equal(Math.min(...hiRows), 1, 'centred vertically');
const hanzi = textToCells('你好', 32, 32, 'large');
assert(hanzi.length > 20 && new Set(hanzi.map(c => Math.floor(c / 32))).size <= 10, 'hanzi use the 10px font');
const twoLines = textToCells('A\nB', 32, 32, 'small');
assert.equal(new Set(twoLines.map(c => Math.floor(c / 32))).size, 10, 'line breaks make two lines');
assert.deepEqual(textToCells('  \n ', 8, 8, 'large'), [], 'blank text draws nothing');

console.log('PASS: editor tools — strokes, shapes, flood fill with tolerance, pointer mapping, transforms, image import, text.');
