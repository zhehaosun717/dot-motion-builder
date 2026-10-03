// iDotMatrix 32x32 export: layout, rendering, GIF encoding, BLE framing and upload flow.
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const assert = require('node:assert/strict');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const resolve = Module._resolveFilename;
Module._resolveFilename = function(name, ...args) {return resolve.call(this, name.startsWith('@/') ? path.join(root, 'src', name.slice(2)) : name, ...args);};
require.extensions['.ts'] = (mod, filename) => mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020}}).outputText, filename);
const {createMockProject} = require('../src/lib/mock-project.ts');
const {motionPresets, getDefaultMotionConfig} = require('../src/lib/motion-presets.ts');
const {hexToRgb} = require('../src/lib/colors.ts');
const {MATRIX_SIZE, GIF_BUDGET_BYTES, MAX_GIF_FRAMES} = require('../src/lib/idotmatrix/constants.ts');
const {getMatrixLayout, renderMatrixFrames} = require('../src/lib/idotmatrix/render-frames.ts');
const {encodeGif} = require('../src/lib/idotmatrix/gif-encoder.ts');
const {buildMatrixGif} = require('../src/lib/idotmatrix/build-gif.ts');
const {crc32, buildGifChunks, isGifAck, SCREEN_ON} = require('../src/lib/idotmatrix/protocol.ts');
const {MatrixLink} = require('../src/lib/idotmatrix/matrix-link.ts');
const {MAX_GRID_SIZE} = require('../src/lib/grid-limits.ts');
const {getCanvasGridMetrics, CANVAS_FRAME_INSET, CANVAS_GRID_PADDING} = require('../src/lib/canvas-grid-metrics.ts');

const N = MATRIX_SIZE * MATRIX_SIZE;
let checks = 0;

// ---------------------------------------------------------------- GIF decoder (test oracle)
function lzwDecode(data, minCode, count) {
  const clear = 1 << minCode, eoi = clear + 1;
  let size, dict, prev, bitPos = 0;
  const out = [];
  const reset = () => { dict = Array.from({length: clear + 2}, (_, i) => i < clear ? [i] : []); size = minCode + 1; prev = null; };
  const read = () => { let code = 0; for (let i = 0; i < size; i++, bitPos++) code |= ((data[bitPos >> 3] >> (bitPos & 7)) & 1) << i; return code; };
  reset();
  while (bitPos + size <= data.length * 8) {
    const code = read();
    if (code === clear) { reset(); continue; }
    if (code === eoi) break;
    let entry;
    if (code < dict.length) entry = dict[code];
    else if (code === dict.length && prev) entry = [...prev, prev[0]];
    else throw new Error(`bad LZW code ${code}`);
    out.push(...entry);
    if (prev && dict.length < 4096) dict.push([...prev, entry[0]]);
    prev = entry;
    if (dict.length === (1 << size) && size < 12) size++;
  }
  assert.equal(out.length, count, 'LZW pixel count');
  return out;
}

function decodeGif(bytes) {
  let p = 0;
  const u8 = () => bytes[p++];
  const u16 = () => { const v = bytes[p] | (bytes[p + 1] << 8); p += 2; return v; };
  const blocks = () => { const parts = []; for (let n = u8(); n; n = u8()) { parts.push(...bytes.slice(p, p + n)); p += n; } return parts; };
  const signature = String.fromCharCode(...bytes.slice(0, 6)); p = 6;
  const width = u16(), height = u16(), packed = u8(); u8(); u8();
  const tableSize = packed & 0x80 ? 2 << (packed & 7) : 0;
  const palette = bytes.slice(p, p + tableSize * 3); p += tableSize * 3;
  const frames = [];
  let delay = 0, loop = null;
  while (p < bytes.length) {
    const block = u8();
    if (block === 0x3b) break;
    if (block === 0x21) {
      const label = u8();
      if (label === 0xf9) { u8(); u8(); delay = u16(); u8(); u8(); }
      else if (label === 0xff) { const n = u8(); const id = String.fromCharCode(...bytes.slice(p, p + n)); p += n; const sub = blocks(); if (id === 'NETSCAPE2.0') loop = sub[1] | (sub[2] << 8); }
      else blocks();
      continue;
    }
    assert.equal(block, 0x2c, 'image descriptor');
    u16(); u16();
    const w = u16(), h = u16();
    assert.equal(u8() & 0x80, 0, 'frames use the global palette only (no per-frame flicker)');
    const minCode = u8();
    frames.push({delay, indices: lzwDecode(blocks(), minCode, w * h)});
  }
  return {signature, width, height, palette, frames, loop};
}

function toRgb(decoded, frame) {
  const rgb = new Uint8Array(frame.indices.length * 3);
  frame.indices.forEach((index, i) => rgb.set(decoded.palette.slice(index * 3, index * 3 + 3), i * 3));
  return rgb;
}

const pixel = (frame, x, y) => Array.from(frame.subarray((y * MATRIX_SIZE + x) * 3, (y * MATRIX_SIZE + x) * 3 + 3));

function makeLoader(size, presetId, cells = 'all') {
  const loader = structuredClone(createMockProject().loaders[0]);
  loader.pattern.grid.rows = loader.pattern.grid.cols = size;
  loader.pattern.activeCells = cells === 'all' ? Array.from({length: size * size}, (_, i) => i) : cells;
  loader.animation = {...loader.animation, ...getDefaultMotionConfig(presetId), originX: (size + 1) / 2, originY: (size + 1) / 2, speed: 1};
  loader.style.primaryColor = '#FF6B00';
  loader.style.primaryAlpha = 1;
  loader.style.backgroundColor = '#2D3743';
  loader.style.backgroundAlpha = 1;
  return loader;
}

function projectWith(...loaders) {
  const project = createMockProject();
  project.loaders = loaders;
  return project;
}

async function main() {
  // ------------------------------------------------------------ layout
  for (let size = 2; size <= 13; size++) {
    // Default: blocks fill the panel, like scaled-up pixel art.
    const tight = getMatrixLayout(size, size);
    assert.equal(tight.gap, 0, `grid ${size} has no gaps by default`);
    assert.equal(tight.cell, Math.floor(MATRIX_SIZE / size), `grid ${size} uses the largest whole block`);
    assert(Math.abs(tight.offsetX * 2 + size * tight.cell - MATRIX_SIZE) <= 1, `grid ${size} is centred`);
    // Optional dot-matrix look: a dark gap between dots.
    const layout = getMatrixLayout(size, size, {gaps: true});
    const extent = size * layout.cell + (size - 1) * layout.gap;
    assert(extent <= MATRIX_SIZE, `grid ${size} must fit the panel`);
    assert(layout.cell >= 1 && layout.gap >= 1, `grid ${size} keeps a dark gap between dots`);
    assert(Math.abs(layout.offsetX * 2 + extent - MATRIX_SIZE) <= 1, `grid ${size} is centred`);
    const bigger = size * (layout.cell + 1) + (size - 1) * Math.max(1, Math.floor((layout.cell + 1) / 5));
    assert(bigger > MATRIX_SIZE, `grid ${size} uses the largest cell that fits`);
    checks++;
  }
  assert.deepEqual(getMatrixLayout(8, 8), {cell: 4, gap: 0, offsetX: 0, offsetY: 0}, '8x8 fills the panel with 4px blocks');
  assert.deepEqual(getMatrixLayout(16, 16), {cell: 2, gap: 0, offsetX: 0, offsetY: 0}, '16x16 fills the panel with 2px blocks');
  assert.deepEqual(getMatrixLayout(6, 6, {gaps: true}), {cell: 4, gap: 1, offsetX: 1, offsetY: 1}, '6x6 with gaps -> 4px dots');
  const wide = getMatrixLayout(3, 8);
  assert(wide.offsetY > wide.offsetX, 'non-square grids centre on both axes');

  // ------------------------------------------------------------ rendering
  const breathing = makeLoader(6, 'breathing');
  const {frames, delaysCs} = renderMatrixFrames(projectWith(breathing), breathing, {showInactive: false});
  assert(frames.length >= 2 && frames.length <= MAX_GIF_FRAMES, 'frame count within limits');
  assert.equal(frames.length % 2, 0, 'breathing peak frame is sampled');
  frames.forEach(f => assert.equal(f.length, N * 3, '32x32 RGB frames'));
  const peak = frames[frames.length / 2];
  const orange = Object.values(hexToRgb('#FF6B00'));
  assert.deepEqual(pixel(peak, 2, 2), orange, 'full-brightness cell shows the exact primary colour');
  assert.deepEqual(pixel(peak, 0, 0), [0, 0, 0], 'margin stays dark');
  const spacedPeak = renderMatrixFrames(projectWith(breathing), breathing, {showInactive: false, gaps: true}).frames[frames.length / 2];
  assert.deepEqual(pixel(spacedPeak, 5, 2), [0, 0, 0], 'with gaps on, the gap between dots stays dark');
  const eight = makeLoader(8, 'breathing');
  const eightFrames = renderMatrixFrames(projectWith(eight), eight, {showInactive: false}).frames;
  const eightPeak = eightFrames[eightFrames.length / 2];
  for (let i = 0; i < N; i++) assert.deepEqual(Array.from(eightPeak.subarray(i * 3, i * 3 + 3)), orange, `8x8: LED ${i} lit, no seams between blocks`);
  assert(pixel(frames[0], 2, 2)[0] < orange[0], 'breathing low point is dimmer');
  const totalCs = delaysCs.reduce((a, b) => a + b, 0);
  assert(Math.abs(totalCs - 100) <= 1, `loop keeps its 1000 ms duration (got ${totalCs}0 ms)`);
  assert(delaysCs.every(d => d >= 2), 'every frame delay is playable');

  const ghost = makeLoader(6, 'wave', []);
  ghost.animation.inactiveStyle = 'static-dim';
  const ghostOn = renderMatrixFrames(projectWith(ghost), ghost, {showInactive: true}).frames[0];
  const ghostOff = renderMatrixFrames(projectWith(ghost), ghost, {showInactive: false}).frames[0];
  const dim = pixel(ghostOn, 2, 2);
  assert(dim[2] > 0 && dim[2] < 0x43, 'inactive dots render dimmed in the inactive colour');
  assert.deepEqual(pixel(ghostOff, 2, 2), [0, 0, 0], 'inactive dots can be switched off');

  const circle = makeLoader(3, 'breathing', [4]);
  circle.style.cellShape = 'circle';
  const circleFrames = renderMatrixFrames(projectWith(circle), circle, {showInactive: false}).frames;
  const lit = circleFrames[circleFrames.length / 2];
  const layout3 = getMatrixLayout(3, 3);
  const cx = layout3.offsetX + layout3.cell + layout3.gap, cy = layout3.offsetY + layout3.cell + layout3.gap;
  assert.deepEqual(pixel(lit, cx + Math.floor(layout3.cell / 2), cy + Math.floor(layout3.cell / 2)), orange, 'circle centre lit');
  assert(pixel(lit, cx, cy)[0] < orange[0], 'circle corners are cut');

  // ------------------------------------------------------------ per-cell colours (pixel art, imported images)
  const painted = makeLoader(32, 'static', [0, 1, 2]);
  painted.pattern.cellColors = {1: '#00FF00', 2: '#123456'};
  const paintedFrame = renderMatrixFrames(projectWith(painted), painted, {showInactive: false}).frames[0];
  assert.deepEqual(pixel(paintedFrame, 0, 0), orange, 'cells without a colour use the active colour');
  assert.deepEqual(pixel(paintedFrame, 1, 0), [0, 255, 0], 'a painted cell keeps its own colour');
  assert.deepEqual(pixel(paintedFrame, 2, 0), [0x12, 0x34, 0x56]);
  assert.deepEqual(pixel(paintedFrame, 3, 0), [0, 0, 0]);

  // ------------------------------------------------------------ 32x32 grids: one cell per LED
  assert.equal(MAX_GRID_SIZE, MATRIX_SIZE, 'editor grids go up to the panel resolution');
  assert.deepEqual(getMatrixLayout(32, 32), {cell: 1, gap: 0, offsetX: 0, offsetY: 0}, '32x32 maps 1:1 onto the LEDs');
  const full = makeLoader(32, 'breathing');
  const fullFrames = renderMatrixFrames(projectWith(full), full, {showInactive: false}).frames;
  const fullPeak = fullFrames[fullFrames.length / 2];
  for (let i = 0; i < N; i++) assert.deepEqual(Array.from(fullPeak.subarray(i * 3, i * 3 + 3)), orange, `LED ${i} lit at the breathing peak`);

  const canvasSide = 420 - CANVAS_FRAME_INSET * 2 - CANVAS_GRID_PADDING * 2;
  const metricsFor = size => { const l = makeLoader(size, 'wave'); l.animation.style = 'opacity-only'; return getCanvasGridMetrics(l); };
  for (const size of [14, 20, 32]) {
    const m = metricsFor(size);
    assert(m.gridWidth <= canvasSide, `${size}x${size} editor grid fits the artboard (${m.gridWidth} > ${canvasSide})`);
    assert(m.cellSize >= 6 && m.gap >= 1 && m.gap < m.cellSize, `${size}x${size} cells stay clickable (${m.cellSize}px / gap ${m.gap})`);
  }
  assert.deepEqual([metricsFor(6).cellSize, metricsFor(6).gap], [53, 6], '6x6 editor layout unchanged');
  assert.deepEqual([metricsFor(13).cellSize, metricsFor(13).gap], [22, 6], '13x13 editor layout unchanged');

  // ------------------------------------------------------------ GIF encoder
  const gif = encodeGif(MATRIX_SIZE, MATRIX_SIZE, frames.map((rgb, i) => ({rgb, delayCs: delaysCs[i]})));
  const decoded = decodeGif(gif);
  assert.equal(decoded.signature, 'GIF89a');
  assert.equal(decoded.width, MATRIX_SIZE);
  assert.equal(decoded.loop, 0, 'loops forever');
  assert.equal(decoded.frames.length, frames.length);
  decoded.frames.forEach((frame, i) => {
    assert.equal(frame.delay, delaysCs[i], 'delay preserved');
    assert.deepEqual(toRgb(decoded, frame), frames[i], `frame ${i} round-trips losslessly`);
  });

  // 40k noisy pixels overflow the 4096-entry LZW table, exercising the clear-code reset path.
  const swatches = Array.from({length: 64}, (_, i) => [i * 4, 255 - i * 4, (i * 37) & 255]);
  let seed = 1;
  const random = () => (seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) >>> 16;
  const picks = Array.from({length: 200 * 200}, () => swatches[random() % 64]);
  const large = Uint8Array.from({length: 200 * 200 * 3}, (_, i) => picks[Math.floor(i / 3)][i % 3]);
  const largeDecoded = decodeGif(encodeGif(200, 200, [{rgb: large, delayCs: 10}]));
  assert.deepEqual(toRgb(largeDecoded, largeDecoded.frames[0]), large, 'LZW table reset round-trips losslessly');

  const noisy = Array.from({length: 3}, (_, f) => ({rgb: Uint8Array.from({length: N * 3}, (_, i) => (i * 37 + f * 101) % 256), delayCs: 5}));
  const reduced = decodeGif(encodeGif(MATRIX_SIZE, MATRIX_SIZE, noisy));
  assert(reduced.palette.length <= 256 * 3, 'palette capped at 256 colours');
  reduced.frames.forEach((frame, f) => toRgb(reduced, frame).forEach((v, i) => assert(Math.abs(v - noisy[f].rgb[i]) <= 18, 'colour reduction stays close')));

  // Photo-like frames (imported images) with >256 colours: median cut keeps dark tones instead of crushing them.
  const darkPhoto = Uint8Array.from({length: N * 3}, (_, i) => { const p = Math.floor(i / 3); return [p & 15, (p >> 4) & 15, (p >> 8) * 3 + (p & 1)][i % 3]; });
  const darkDecoded = decodeGif(encodeGif(MATRIX_SIZE, MATRIX_SIZE, [{rgb: darkPhoto, delayCs: 10}]));
  const darkRgb = toRgb(darkDecoded, darkDecoded.frames[0]);
  let darkError = 0, crushed = 0;
  for (let i = 0; i < darkPhoto.length; i++) darkError += Math.abs(darkRgb[i] - darkPhoto[i]);
  for (let px = 0; px < N; px++) if (darkPhoto[px * 3] + darkPhoto[px * 3 + 1] + darkPhoto[px * 3 + 2] > 0 && darkRgb[px * 3] + darkRgb[px * 3 + 1] + darkRgb[px * 3 + 2] === 0) crushed++;
  assert(darkError / darkPhoto.length < 4, `dark photo stays close (mean error ${(darkError / darkPhoto.length).toFixed(2)})`);
  assert.equal(crushed, 0, 'no lit pixel is crushed to black');

  // ------------------------------------------------------------ budget + presets
  for (const preset of motionPresets) for (const size of [2, 6, 13, 32]) {
    const loader = makeLoader(size, preset.id);
    loader.animation.inactiveStyle = 'breathe';
    const result = buildMatrixGif(projectWith(loader), loader, {showInactive: true});
    assert(result.gif.length <= GIF_BUDGET_BYTES, `${preset.id} ${size}x${size} fits the ${GIF_BUDGET_BYTES} B budget (${result.gif.length})`);
    assert(result.frameCount >= 2 && result.frameCount <= MAX_GIF_FRAMES);
    assert.equal(decodeGif(result.gif).frames.length, result.frameCount);
    checks++;
  }

  // ------------------------------------------------------------ panel colour tuning
  const {applyPanelTuning, sanitizePanelTuning, isNeutralTuning, NEUTRAL_PANEL_TUNING} = require('../src/lib/idotmatrix/panel-tuning.ts');
  const tune = (rgb, patch) => Array.from(applyPanelTuning(Uint8Array.from(rgb), {...NEUTRAL_PANEL_TUNING, ...patch}));
  const sample = Uint8Array.from([0, 0, 0, 128, 128, 128, 200, 60, 20]);
  assert.equal(applyPanelTuning(sample, NEUTRAL_PANEL_TUNING), sample, 'neutral tuning is a no-op');
  for (const patch of [{contrast: 50}, {warmth: -100}, {brightness: 200}, {gamma: 0.5}]) {
    assert.deepEqual(tune([0, 0, 0], patch), [0, 0, 0], `black stays unlit with ${JSON.stringify(patch)}`);
  }
  const grey = tune([200, 60, 20], {saturation: 0});
  assert(grey[0] === grey[1] && grey[1] === grey[2], 'saturation 0 makes grey');
  const vivid = tune([200, 60, 20], {saturation: 150});
  assert(vivid[0] > 200 && vivid[2] < 20, 'saturation above 100 spreads the channels');
  assert.equal(tune([128, 128, 128], {gamma: 2.2})[0], Math.round(255 * (128 / 255) ** 2.2), 'gamma darkens midtones');
  assert.deepEqual(tune([255, 255, 255], {gamma: 2.2}), [255, 255, 255], 'gamma keeps white');
  const warm = tune([200, 200, 200], {warmth: 100});
  assert(warm[0] === 200 && warm[2] < warm[1] && warm[1] < 200, 'warm cuts blue most, then green');
  const cool = tune([200, 200, 200], {warmth: -100});
  assert(cool[2] === 200 && cool[0] < 200, 'cool cuts red');
  assert(tune([100, 100, 100], {contrast: 200})[0] < 100 && tune([180, 180, 180], {contrast: 200})[0] > 180, 'contrast spreads from mid grey');
  assert.deepEqual(tune([100, 100, 100], {brightness: 50}), [50, 50, 50], 'brightness scales');
  assert.deepEqual(sanitizePanelTuning({brightness: 999, gamma: 1.2000000000000002, warmth: 'x'}), {...NEUTRAL_PANEL_TUNING, brightness: 200, gamma: 1.2}, 'stored tuning is clamped and rounded');
  assert.deepEqual(sanitizePanelTuning(null), NEUTRAL_PANEL_TUNING);
  assert(isNeutralTuning(sanitizePanelTuning({})));
  const tunedLoader = makeLoader(8, 'static');
  const plainGif = buildMatrixGif(projectWith(tunedLoader), tunedLoader, {showInactive: false});
  const tunedGif = buildMatrixGif(projectWith(tunedLoader), tunedLoader, {showInactive: false, tuning: {...NEUTRAL_PANEL_TUNING, gamma: 2.2}});
  assert.deepEqual(pixel(plainGif.frames[0], 16, 16), [0xFF, 0x6B, 0x00]);
  assert.deepEqual(pixel(tunedGif.frames[0], 16, 16), [255, Math.round(255 * (0x6B / 255) ** 2.2), 0], 'GIFs sent to the panel carry the tuning');

  // ------------------------------------------------------------ sequence mode
  const first = makeLoader(4, 'wave', [0]);
  first.sequenceId = 'seq'; first.sequenceIndex = 1; first.animation.fps = 5;
  const second = structuredClone(first);
  second.id = 'seq-2'; second.sequenceIndex = 0; second.pattern.activeCells = [15];
  const sequence = renderMatrixFrames(projectWith(first, second), first, {showInactive: false});
  assert.equal(sequence.frames.length, 2, 'one GIF frame per sequence frame');
  assert.deepEqual(sequence.delaysCs, [20, 20], 'sequence uses its own fps');
  const l4 = getMatrixLayout(4, 4);
  const mid = Math.floor(l4.cell / 2);
  const lastCell = [l4.offsetX + 3 * (l4.cell + l4.gap) + mid, l4.offsetY + 3 * (l4.cell + l4.gap) + mid];
  assert.deepEqual(pixel(sequence.frames[0], ...lastCell), orange, 'sequence order follows sequenceIndex');
  assert.deepEqual(pixel(sequence.frames[0], l4.offsetX + mid, l4.offsetY + mid), [0, 0, 0]);
  const longSequence = Array.from({length: MAX_GIF_FRAMES + 5}, (_, i) => ({...structuredClone(first), id: `long-${i}`, sequenceIndex: i}));
  assert.equal(renderMatrixFrames(projectWith(...longSequence), longSequence[0], {showInactive: false}).frames.length, MAX_GIF_FRAMES, 'sequences are capped too');

  // ------------------------------------------------------------ BLE framing
  assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926, 'zlib CRC-32');
  const blob = Uint8Array.from({length: 5000}, (_, i) => (i * 7) & 255);
  const chunks = buildGifChunks(blob);
  assert.equal(chunks.length, 2);
  const view = c => new DataView(c.buffer, c.byteOffset, c.byteLength);
  chunks.forEach((chunk, i) => {
    assert.equal(view(chunk).getUint16(0, true), chunk.length, 'chunk length incl. 16-byte header');
    assert.deepEqual([chunk[2], chunk[3], chunk[4]], [1, 0, i ? 2 : 0], 'first/continuation flag');
    assert.equal(view(chunk).getUint32(5, true), 5000, 'total GIF length');
    assert.equal(view(chunk).getUint32(9, true), crc32(blob), 'GIF CRC');
    assert.deepEqual([chunk[13], chunk[14], chunk[15]], [5, 0, 13], 'hardware-verified header tail');
  });
  assert.deepEqual([chunks[0].length, chunks[1].length], [4096 + 16, 904 + 16]);
  assert.deepEqual(Buffer.concat(chunks.map(c => c.subarray(16))), Buffer.from(blob), 'payload preserved');
  assert.throws(() => buildGifChunks(new Uint8Array(0)));
  assert(isGifAck(Uint8Array.of(5, 0, 1, 0, 1)) && isGifAck(Uint8Array.of(5, 0, 1, 0, 3)));
  assert(!isGifAck(Uint8Array.of(5, 0, 0, 0, 1)), 'image ack is not a GIF ack');

  // ------------------------------------------------------------ upload flow (fake GATT)
  /**
   * A fake panel: rejects packets above maxPacket, throws once on the write calls listed in failCalls
   * (or on every call from failFrom on), and acks each fully received chunk after ackDelays[chunk] ms (null = never).
   */
  function fakePanel({maxPacket = 514, failCalls = [], failFrom = Infinity, ackDelays = []} = {}) {
    const notify = new EventTarget();
    const writes = [], log = [];
    const failOnce = new Set(failCalls);
    let calls = 0, pending = 0, expected = null, chunk = 0;
    const ack = index => { log.push(`ack${index}`); notify.value = new DataView(Uint8Array.of(5, 0, 1, 0, 1).buffer); notify.dispatchEvent(new Event('characteristicvaluechanged')); };
    const write = {
      async writeValueWithoutResponse(data) {
        const call = calls++;
        if (failOnce.delete(call) || call >= failFrom) throw new Error('GATT operation failed for unknown reason.');
        const bytes = new Uint8Array(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength));
        if (bytes.length > maxPacket) throw new Error('GATT operation failed for unknown reason.');
        if (expected === null) { expected = new DataView(bytes.buffer).getUint16(0, true); log.push(`start${chunk}`); }
        writes.push(bytes);
        pending += bytes.length;
        if (pending >= expected) {
          const index = chunk++, delay = ackDelays[index] === undefined ? 1 : ackDelays[index];
          pending = 0; expected = null;
          if (delay !== null) setTimeout(() => ack(index), delay);
        }
      }
    };
    return {gatt: {name: 'IDM-TEST', write, notify, disconnect() {}}, writes, log};
  }
  const fastOptions = {packetGapMs: 0, ackTimeoutMs: 30, cooldownMs: 0, retryDelayMs: 1};
  async function upload(panel, data = blob, options = fastOptions) {
    const link = new MatrixLink(panel.gatt, options);
    const progress = [];
    const result = await link.uploadGif(data, (sent, total) => progress.push([sent, total]));
    return {link, result, progress};
  }

  const big = fakePanel();
  const bigRun = await upload(big);
  assert(big.writes.every(w => w.length <= 509), 'packets fit the negotiated MTU');
  assert(big.writes.some(w => w.length === 509), 'uses full-size packets when the link allows');
  assert.deepEqual(Buffer.concat(big.writes), Buffer.concat(chunks), 'byte stream equals the framed chunks');
  assert.deepEqual(bigRun.result, {chunks: 2, missedAcks: 0});
  assert.deepEqual(bigRun.progress, [[1, 2], [2, 2]]);

  const small = fakePanel({maxPacket: 20});
  await upload(small);
  assert(small.writes.every(w => w.length <= 20), 'falls back to 20-byte packets on a small MTU');
  assert.deepEqual(Buffer.concat(small.writes), Buffer.concat(chunks), 'fallback never drops bytes');

  const silent = fakePanel({ackDelays: [null, null]});
  assert.equal((await upload(silent)).result.missedAcks, 2, 'missing acks are reported, not fatal');

  const glitchMidway = fakePanel({failCalls: [4]});
  assert.deepEqual((await upload(glitchMidway)).result, {chunks: 2, missedAcks: 0}, 'a transient write error is retried, not fatal');
  assert.deepEqual(Buffer.concat(glitchMidway.writes), Buffer.concat(chunks), 'retry resends the same bytes once');

  const glitchFirst = fakePanel({failCalls: [0]});
  await upload(glitchFirst);
  assert(glitchFirst.writes.some(w => w.length === 509), 'one transient error on the first packet does not shrink the packet size');

  const restricted = fakePanel();
  await upload(restricted, blob, {...fastOptions, packetSizes: [20]});
  assert(restricted.writes.every(w => w.length <= 20), 'platform packet sizes are honoured');

  const dead = fakePanel({failFrom: 3});
  const deadLink = new MatrixLink(dead.gatt, fastOptions);
  await assert.rejects(deadLink.uploadGif(blob), /GATT/, 'a link that keeps failing surfaces the error');
  assert.equal(deadLink.uploading, false, 'busy flag clears after a failed upload');

  // Chunk 0's ack arrives late, while chunk 1 is still being written: it must not count as chunk 1's ack.
  const three = Uint8Array.from({length: 9000}, (_, i) => (i * 13) & 255);
  const late = fakePanel({ackDelays: [140, 60, 1]});
  const lateRun = await upload(late, three, {packetGapMs: 10, ackTimeoutMs: 100, cooldownMs: 0, retryDelayMs: 1});
  assert.equal(lateRun.result.missedAcks, 1, 'the late chunk is reported as unacknowledged');
  const ack1At = late.log.indexOf('ack1'), start2At = late.log.indexOf('start2');
  assert(ack1At >= 0 && ack1At < start2At, `chunk 2 waits for chunk 1's own ack (${late.log.join(' ')})`);

  const busyPanel = fakePanel();
  const busyLink = new MatrixLink(busyPanel.gatt, fastOptions);
  const inFlight = busyLink.uploadGif(blob);
  await assert.rejects(busyLink.uploadGif(blob), /in progress/, 'concurrent uploads are refused');
  await inFlight;

  const cooled = fakePanel();
  const cooledLink = new MatrixLink(cooled.gatt, {...fastOptions, cooldownMs: 120});
  await cooledLink.uploadGif(blob);
  const t0 = Date.now();
  await cooledLink.uploadGif(blob);
  assert(Date.now() - t0 >= 100, 'back-to-back uploads respect the cooldown');
  assert.deepEqual(Array.from(SCREEN_ON), [5, 0, 7, 1, 1]);

  console.log(`PASS: iDotMatrix layout + ${checks} preset budgets, render, lossless GIF round-trip incl. LZW table reset, BLE framing, retries, late acks, busy and cooldown.`);
}

main().catch(error => { console.error(error); process.exit(1); });
