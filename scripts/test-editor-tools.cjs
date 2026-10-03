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
const {cellsOnLine, cellsInRect, floodFill, cellAtPoint} = require('../src/lib/grid-tools.ts');

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

console.log('PASS: editor tools — continuous strokes, rectangles, flood fill, pointer mapping.');
