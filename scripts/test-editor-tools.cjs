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

console.log('PASS: editor tools — continuous strokes, rectangles, flood fill, pointer mapping.');
