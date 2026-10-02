// iDotMatrix live mode: PNG frames, DIY-mode framing, frame flow control and latest-frame-wins streaming.
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const Module = require('node:module');
const assert = require('node:assert/strict');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const resolve = Module._resolveFilename;
Module._resolveFilename = function(name, ...args) {return resolve.call(this, name.startsWith('@/') ? path.join(root, 'src', name.slice(2)) : name, ...args);};
require.extensions['.ts'] = (mod, filename) => mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020}}).outputText, filename);
const {createMockProject} = require('../src/lib/mock-project.ts');
const {getDefaultMotionConfig} = require('../src/lib/motion-presets.ts');
const {MATRIX_SIZE} = require('../src/lib/idotmatrix/constants.ts');
const {encodePng} = require('../src/lib/idotmatrix/png-encoder.ts');
const {buildImageFrame, isImageAck, DIY_MODE_ON, crc32} = require('../src/lib/idotmatrix/protocol.ts');
const {MatrixLink} = require('../src/lib/idotmatrix/matrix-link.ts');
const {LiveFrameStream} = require('../src/lib/idotmatrix/live-stream.ts');
const {renderMatrixStill, renderMatrixAt, renderMatrixFrames, getMatrixLayout} = require('../src/lib/idotmatrix/render-frames.ts');
const {screenPixelsToLed} = require('../src/lib/idotmatrix/screen-mirror.ts');

const N = MATRIX_SIZE * MATRIX_SIZE;
const sleep = ms => new Promise(r => setTimeout(r, ms));

function decodePng(png) {
  assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10], 'PNG signature');
  let p = 8, width = 0, height = 0, depth = 0, colorType = 0, palette = null;
  const idat = [];
  while (p < png.length) {
    const len = png.readUInt32BE(p), type = png.toString('latin1', p + 4, p + 8), data = png.subarray(p + 8, p + 8 + len);
    assert.equal(png.readUInt32BE(p + 8 + len), crc32(png.subarray(p + 4, p + 8 + len)), `${type} CRC`);
    if (type === 'IHDR') { width = data.readUInt32BE(0); height = data.readUInt32BE(4); depth = data[8]; colorType = data[9]; assert.deepEqual([...data.subarray(10)], [0, 0, 0]); }
    if (type === 'PLTE') palette = data;
    if (type === 'IDAT') idat.push(data);
    p += 12 + len;
    if (type === 'IEND') break;
  }
  assert((colorType === 2 && depth === 8) || (colorType === 3 && [4, 8].includes(depth) && palette), `supported format (type ${colorType}, depth ${depth})`);
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = colorType === 2 ? width * 3 : Math.ceil((width * depth) / 8);
  const rgb = new Uint8Array(width * height * 3);
  for (let y = 0; y < height; y++) {
    const row = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    assert.equal(raw[y * (stride + 1)], 0, 'filter type none');
    for (let x = 0; x < width; x++) {
      if (colorType === 2) { rgb.set(row.subarray(x * 3, x * 3 + 3), (y * width + x) * 3); continue; }
      const index = depth === 8 ? row[x] : (row[x >> 1] >> (x & 1 ? 0 : 4)) & 15;
      assert(index * 3 + 2 < palette.length, 'index inside the palette');
      rgb.set(palette.subarray(index * 3, index * 3 + 3), (y * width + x) * 3);
    }
  }
  return {width, height, rgb, colorType, depth};
}

function fakePanel({imageAcks = true, ackDelayMs = 5} = {}) {
  const notify = new EventTarget();
  const writes = [], log = [];
  let images = 0;
  const ack = bytes => { notify.value = new DataView(Uint8Array.from(bytes).buffer); notify.dispatchEvent(new Event('characteristicvaluechanged')); };
  let pending = 0, expected = null, kind = null;
  const write = {
    async writeValueWithoutResponse(data) {
      const bytes = new Uint8Array(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength));
      writes.push(bytes);
      if (expected === null) { expected = new DataView(bytes.buffer).getUint16(0, true); kind = bytes[2] === 1 && bytes.length >= 16 ? 'gif' : bytes.length > 9 && bytes[2] === 0 ? 'image' : 'cmd'; }
      pending += bytes.length;
      if (pending < expected) return;
      const done = kind; pending = 0; expected = null;
      if (done === 'image') { const n = images++; log.push('start' + n); if (imageAcks) setTimeout(() => { log.push('ack' + n); ack([5, 0, 0, 0, 1]); }, ackDelayMs); }
      if (done === 'gif') setTimeout(() => ack([5, 0, 1, 0, 3]), 1);
    }
  };
  return {gatt: {name: 'IDM-TEST', write, notify, disconnect() {}}, writes, log};
}
const fast = {packetGapMs: 0, ackTimeoutMs: 50, frameAckTimeoutMs: 40, diySettleMs: 0, cooldownMs: 0, retryDelayMs: 1};
const messages = writes => {
  const out = [];
  let buf = [], expected = null;
  for (const w of writes) {
    if (expected === null) expected = w[0] | (w[1] << 8);
    buf.push(...w);
    if (buf.length >= expected) { out.push(Uint8Array.from(buf)); buf = []; expected = null; }
  }
  return out;
};

async function main() {
  // ------------------------------------------------------------ PNG
  const rgb = Uint8Array.from({length: N * 3}, (_, i) => (i * 31) & 255);
  const png = Buffer.from(await encodePng(MATRIX_SIZE, MATRIX_SIZE, rgb));
  const decoded = decodePng(png);
  assert.deepEqual([decoded.width, decoded.height], [32, 32]);
  assert.deepEqual(decoded.rgb, rgb, 'PNG round-trips losslessly');
  assert(png.length < 4096, 'a 32x32 frame fits one upload chunk');
  const wide = Uint8Array.from({length: N * 3}, (_, i) => [Math.floor(i / 3) & 255, Math.floor(i / 12) & 255, 77][i % 3]);
  const wideDecoded = decodePng(Buffer.from(await encodePng(MATRIX_SIZE, MATRIX_SIZE, wide)));
  assert.equal(wideDecoded.colorType, 2, 'more than 256 colours stays RGB');
  assert.deepEqual(wideDecoded.rgb, wide);

  // Editor frames use few colours: an indexed PNG is lossless and much smaller (fewer BLE packets).
  const swatch = [[255, 107, 0], [10, 14, 18], [0, 0, 0], [120, 60, 0]];
  const fewColours = Uint8Array.from({length: N * 3}, (_, i) => swatch[(Math.floor(i / 3) * 7 + (Math.floor(i / 96) % 3)) % 4][i % 3]);
  const indexedDecoded = decodePng(Buffer.from(await encodePng(MATRIX_SIZE, MATRIX_SIZE, fewColours)));
  assert.deepEqual([indexedDecoded.colorType, indexedDecoded.depth], [3, 4], '<=16 colours -> 4-bit palette PNG');
  assert.deepEqual(indexedDecoded.rgb, fewColours, '4-bit palette PNG round-trips');
  const many = Uint8Array.from({length: N * 3}, (_, i) => ((Math.floor(i / 3) % 200) * ((i % 3) + 1)) & 255);
  const manyDecoded = decodePng(Buffer.from(await encodePng(MATRIX_SIZE, MATRIX_SIZE, many)));
  assert.deepEqual([manyDecoded.colorType, manyDecoded.depth], [3, 8], '17-256 colours -> 8-bit palette PNG');
  assert.deepEqual(manyDecoded.rgb, many, '8-bit palette PNG round-trips');
  const wave = structuredClone(createMockProject().loaders[0]);
  wave.pattern.activeCells = Array.from({length: 36}, (_, i) => i);
  wave.animation = {...wave.animation, ...getDefaultMotionConfig('wave'), inactiveStyle: 'breathe'};
  const editorFrame = renderMatrixFrames(createMockProject(), wave, {showInactive: true}).frames[3];
  const rgbOnly = Buffer.from(await encodePng(MATRIX_SIZE, MATRIX_SIZE, editorFrame, {allowPalette: false}));
  const paletted = Buffer.from(await encodePng(MATRIX_SIZE, MATRIX_SIZE, editorFrame));
  assert.equal(decodePng(rgbOnly).colorType, 2, 'palette can be disabled');
  assert.deepEqual(decodePng(paletted).rgb, editorFrame, 'editor frame survives the palette');
  assert(paletted.length < rgbOnly.length, `palette PNG is smaller (${paletted.length} vs ${rgbOnly.length} B)`);

  // ------------------------------------------------------------ DIY image framing
  const small = Uint8Array.from({length: 300}, (_, i) => i & 255);
  const frame = buildImageFrame(small);
  assert.equal(frame.length, 300 + 9);
  assert.deepEqual([...frame.subarray(0, 9)], [(309) & 255, 309 >> 8, 0, 0, 0, 44, 1, 0, 0], 'u16 packet length, 00 00, first flag, u32 PNG length');
  const big = buildImageFrame(new Uint8Array(5000));
  assert.equal(big.length, 5000 + 18, 'one 9-byte header per 4 KiB chunk');
  assert.deepEqual([big[4105 + 0], big[4105 + 1], big[4105 + 4]], [(904 + 9) & 255, (904 + 9) >> 8, 2], 'continuation chunk header');
  assert(isImageAck(Uint8Array.of(5, 0, 0, 0, 1)) && !isImageAck(Uint8Array.of(5, 0, 1, 0, 1)));
  assert.deepEqual([...DIY_MODE_ON], [5, 0, 4, 1, 1]);

  // ------------------------------------------------------------ MatrixLink.showFrame
  const panel = fakePanel();
  const link = new MatrixLink(panel.gatt, fast);
  await link.showFrame(png);
  await link.showFrame(png);
  let sent = messages(panel.writes);
  assert.deepEqual([...sent[0]], [...DIY_MODE_ON], 'enters DIY mode before the first frame');
  assert.equal(sent.filter(m => m.length === DIY_MODE_ON.length && m[2] === 4).length, 1, 'DIY mode is entered once (it blanks the panel)');
  assert.deepEqual(sent[1], buildImageFrame(png), 'frame bytes on the wire');

  await link.uploadGif(Uint8Array.from({length: 500}, (_, i) => i & 255));
  panel.writes.length = 0;
  await link.showFrame(png);
  sent = messages(panel.writes);
  assert.deepEqual([...sent[0]], [...DIY_MODE_ON], 'a GIF upload leaves DIY mode, so the next frame re-enters it');

  // GIF uploads and frames never interleave on the wire.
  const mixed = fakePanel();
  const mixedLink = new MatrixLink(mixed.gatt, fast);
  const gif = Uint8Array.from({length: 9000}, (_, i) => (i * 3) & 255);
  await Promise.all([mixedLink.uploadGif(gif), mixedLink.showFrame(png), mixedLink.showFrame(png)]);
  const order = messages(mixed.writes).map(m => (m.length >= 16 && m[2] === 1 ? 'gif' : m.length === 5 ? 'cmd' : 'img'));
  assert.deepEqual(order.slice(0, 3), ['gif', 'gif', 'gif'], `GIF chunks stay contiguous (${order.join(' ')})`);

  // Without acks the stream keeps going after a short timeout instead of stalling.
  const mute = fakePanel({imageAcks: false});
  const muteLink = new MatrixLink(mute.gatt, fast);
  const t0 = Date.now();
  for (let i = 0; i < 4; i++) await muteLink.showFrame(png);
  assert(Date.now() - t0 < 1000, 'missing frame acks only cost a short timeout');
  assert.equal(messages(mute.writes).length, 5, 'DIY + 4 frames');

  // A frame ack that arrives after its timeout must not release the next frame early.
  const lagging = fakePanel({ackDelayMs: 120});
  const laggingLink = new MatrixLink(lagging.gatt, {...fast, frameAckTimeoutMs: 60});
  for (let i = 0; i < 6; i++) await laggingLink.showFrame(png);
  const ack3At = lagging.log.indexOf('ack3'), start5At = lagging.log.indexOf('start5');
  assert(ack3At >= 0 && ack3At < start5At, `late acks are not credited to later frames (${lagging.log.join(' ')})`);

  // A frame still queued in the live stream when a GIF upload starts must not overwrite the GIF.
  const racing = fakePanel();
  const racingLink = new MatrixLink(racing.gatt, fast);
  const racingStream = new LiveFrameStream(async (f, stillWanted) => {
    await sleep(15); // PNG encoding
    if (stillWanted()) await racingLink.showFrame(png);
  }, {minIntervalMs: 0});
  racingStream.show(Uint8Array.from({length: N * 3}, () => 1));
  await sleep(2);
  racingStream.cancel();
  await racingStream.idle();
  await racingLink.uploadGif(Uint8Array.from({length: 600}, (_, i) => i & 255));
  await sleep(30);
  const tail = messages(racing.writes).map(m => (m.length >= 16 && m[2] === 1 ? 'gif' : m.length === 5 ? 'cmd' : 'img'));
  assert.equal(tail[tail.length - 1], 'gif', `the GIF is the last thing on the wire (${tail.join(' ')})`);

  // ------------------------------------------------------------ latest-frame-wins stream
  const pushed = [];
  const stream = new LiveFrameStream(async f => { pushed.push(f[0]); await sleep(30); }, {minIntervalMs: 0});
  const frameOf = v => Uint8Array.from({length: N * 3}, () => v);
  stream.show(frameOf(1)); stream.show(frameOf(2)); stream.show(frameOf(3));
  await sleep(10);
  stream.show(frameOf(4)); stream.show(frameOf(5));
  await stream.idle();
  assert.deepEqual(pushed, [1, 5], 'superseded frames are dropped');
  stream.show(frameOf(5));
  await stream.idle();
  assert.deepEqual(pushed, [1, 5], 'an unchanged frame is not resent');
  stream.reset();
  stream.show(frameOf(5));
  await stream.idle();
  assert.deepEqual(pushed, [1, 5, 5], 'reset forces the next frame out');
  const errors = [];
  const failing = new LiveFrameStream(async () => { throw new Error('gone'); }, {minIntervalMs: 0, onError: e => errors.push(e.message)});
  failing.show(frameOf(1));
  await failing.idle();
  assert.deepEqual(errors, ['gone'], 'push errors are reported, not thrown');

  // ------------------------------------------------------------ pacing by time since the last write
  const timed = fakePanel();
  const stamps = [];
  const timedWrite = timed.gatt.write.writeValueWithoutResponse;
  timed.gatt.write.writeValueWithoutResponse = async data => { stamps.push(Date.now()); return timedWrite(data); };
  const pacedLink = new MatrixLink(timed.gatt, {...fast, packetGapMs: 40});
  const longMessage = new Uint8Array(1200).fill(1);
  longMessage.set([1200 & 255, 1200 >> 8], 0);
  await pacedLink.send(longMessage);
  assert(stamps.length === 3 && stamps[1] - stamps[0] >= 35 && stamps[2] - stamps[1] >= 35, `packets of one message stay paced (${stamps.map(t => t - stamps[0])})`);
  await sleep(80);
  const before = Date.now();
  await pacedLink.send(DIY_MODE_ON);
  assert(Date.now() - before < 25, `no gap is added when the link has been idle longer than the gap (${Date.now() - before} ms)`);

  // ------------------------------------------------------------ adaptive frame packet gap
  // Measured on the user's panel: frame packets need no gap (50 fps, no missed acks). Should a link drop
  // them anyway (frame acks time out), the gap backs off towards the safe GIF value.
  const bigFrame = Buffer.from(await encodePng(MATRIX_SIZE, MATRIX_SIZE, wide));
  assert(buildImageFrame(bigFrame).length > 1018, 'test frame spans 3+ packets');
  const adaptive = fakePanel({imageAcks: false});
  const frameStamps = [];
  const adaptiveWrite = adaptive.gatt.write.writeValueWithoutResponse;
  adaptive.gatt.write.writeValueWithoutResponse = async data => { frameStamps.push(Date.now()); return adaptiveWrite(data); };
  const adaptiveLink = new MatrixLink(adaptive.gatt, {...fast, packetGapMs: 30, framePacketGapMs: 0, frameAckTimeoutMs: 20});
  await adaptiveLink.showFrame(bigFrame); // DIY + frame 1
  const firstFrameSpan = frameStamps[frameStamps.length - 1] - frameStamps[1];
  assert(firstFrameSpan < 20, `frame packets go out back to back (${firstFrameSpan} ms)`);
  for (let i = 0; i < 4; i++) await adaptiveLink.showFrame(bigFrame); // acks never come: gap backs off
  const lastPackets = frameStamps.slice(-3);
  assert(lastPackets[1] - lastPackets[0] >= 10 && lastPackets[2] - lastPackets[1] >= 10, `gap grows after missed frame acks (${lastPackets.map(t => t - lastPackets[0])})`);

  // ------------------------------------------------------------ pulled, time-sampled frames
  const pulled = [];
  const puller = new LiveFrameStream(async f => { pulled.push(f[0]); await sleep(15); }, {minIntervalMs: 0});
  const startedAt = Date.now();
  puller.play(at => Uint8Array.from({length: N * 3}, () => Math.floor((at - startedAt) / 10) % 256));
  await sleep(200);
  puller.play(null);
  await puller.idle();
  const settled = pulled.length;
  await sleep(60);
  assert.equal(pulled.length, settled, 'stopping the source stops pushes');
  assert(settled >= 6, `frames keep flowing while a source plays (${settled})`);
  assert(pulled.every((v, i) => i === 0 || v > pulled[i - 1]), `each push samples a later moment (${pulled.join(',')})`);

  // ------------------------------------------------------------ frame at an arbitrary time
  const timeline = structuredClone(createMockProject().loaders[0]);
  timeline.pattern.activeCells = [0, 7, 14];
  timeline.animation = {...timeline.animation, ...getDefaultMotionConfig('wave'), durationMs: 1000, fps: 20, speed: 1};
  const tlFrames = renderMatrixFrames(createMockProject(), timeline, {showInactive: true}).frames;
  assert.deepEqual(renderMatrixAt(createMockProject(), timeline, 0, {showInactive: true}), tlFrames[0], 'time 0 is the first frame');
  assert.deepEqual(renderMatrixAt(createMockProject(), timeline, 1000 + 250, {showInactive: true}), tlFrames[5], 'time wraps around the cycle');
  const seqA = structuredClone(timeline), seqB = structuredClone(timeline);
  Object.assign(seqA, {id: 'a', sequenceId: 's', sequenceIndex: 0});
  Object.assign(seqB, {id: 'b', sequenceId: 's', sequenceIndex: 1});
  seqA.animation.fps = seqB.animation.fps = 4;
  seqB.pattern.activeCells = [35];
  const seqProject = createMockProject();
  seqProject.loaders = [seqA, seqB];
  assert.deepEqual(renderMatrixAt(seqProject, seqA, 300, {showInactive: false}), renderMatrixFrames(seqProject, seqA, {showInactive: false}).frames[1], 'sequences step at their own fps');

  // ------------------------------------------------------------ still frames + screen mirroring
  const loader = structuredClone(createMockProject().loaders[0]);
  loader.pattern.grid.rows = loader.pattern.grid.cols = 32;
  loader.pattern.activeCells = [0, 33];
  loader.animation = {...loader.animation, ...getDefaultMotionConfig('wave')};
  loader.style.primaryColor = '#FF6B00';
  const still = renderMatrixStill(loader, {showInactive: false});
  assert.deepEqual([...still.subarray(0, 3)], [255, 107, 0], 'drawn cell is lit at full colour while editing');
  assert.deepEqual([...still.subarray(33 * 3, 33 * 3 + 3)], [255, 107, 0]);
  assert.deepEqual([...still.subarray(3, 6)], [0, 0, 0], 'undrawn cell stays dark');
  assert.equal(getMatrixLayout(32, 32).cell, 1);

  const rgba = Uint8ClampedArray.from({length: N * 4}, (_, i) => (i % 4 === 3 ? 255 : 128));
  const led = screenPixelsToLed(rgba);
  assert.equal(led.length, N * 3);
  assert(led[0] < 128 && led[0] > 0, 'screen colours are linearised for the LEDs');

  console.log('PASS: iDotMatrix live — PNG, DIY framing, DIY mode tracking, no interleaving, ack timeouts, latest-frame-wins, still frames, mirroring.');
}

main().catch(error => { console.error(error); process.exit(1); });
