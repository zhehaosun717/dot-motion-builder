// Agent display: moods, statuses, text and pixel scenes rendered to 32x32 frames, plus input validation.
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const assert = require('node:assert/strict');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const resolve = Module._resolveFilename;
Module._resolveFilename = function(name, ...args) {return resolve.call(this, name.startsWith('@/') ? path.join(root, 'src', name.slice(2)) : name, ...args);};
require.extensions['.ts'] = (mod, filename) => mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true}}).outputText, filename);
const {MOODS} = require('../src/lib/agent-display/face.ts');
const {STATUSES} = require('../src/lib/agent-display/status-icons.ts');
const {wrapText, measureText} = require('../src/lib/agent-display/font.ts');
const {renderScene, parseScene, isAnimated} = require('../src/lib/agent-display/scene.ts');

const N = 32 * 32;
const lit = rgb => { let n = 0; for (let i = 0; i < N; i++) if (rgb[i * 3] || rgb[i * 3 + 1] || rgb[i * 3 + 2]) n++; return n; };
const differs = (a, b) => a.some((v, i) => v !== b[i]);
const pixel = (rgb, x, y) => [...rgb.subarray((y * 32 + x) * 3, (y * 32 + x) * 3 + 3)];
const previews = [];

for (const mood of MOODS) {
  const scene = parseScene({kind: 'mood', mood});
  const frames = [0, 150, 700, 1300, 2600].map(t => renderScene(scene, t));
  frames.forEach(f => assert.equal(f.length, N * 3));
  assert(lit(frames[2]) >= 20, `${mood} draws a face (${lit(frames[2])} lit)`);
  assert.deepEqual(renderScene(scene, 700), frames[2], `${mood} is deterministic`);
  assert(frames.some(f => differs(f, frames[0])), `${mood} animates`);
  previews.push([mood, frames[2]]);
}

for (const status of STATUSES) {
  const scene = parseScene({kind: 'status', status});
  const frames = [0, 300, 700, 1500].map(t => renderScene(scene, t));
  assert(lit(frames[2]) >= 3, `${status} draws an icon`);
  assert(frames.some(f => differs(f, frames[0])), `${status} animates`);
  const labelled = renderScene(parseScene({kind: 'status', status, label: 'tests'}), 700);
  assert(lit(labelled.subarray(26 * 32 * 3)) > 0, `${status} label is drawn in the bottom band`);
  previews.push([status, frames[2]]);
}

// Text: short text is static and centred, long text scrolls.
assert.deepEqual(wrapText('hello there agent friend', 8), ['hello', 'there', 'agent', 'friend']);
assert.deepEqual(wrapText('supercalifragilistic', 8), ['supercal', 'ifragili', 'stic']);
assert.equal(measureText('ABC'), 11);
const short = parseScene({kind: 'text', text: 'BUILD OK', color: '#00FF00'});
assert(!isAnimated(short), 'short text is static');
const shortFrame = renderScene(short, 0);
assert(lit(shortFrame) > 10);
assert.deepEqual(pixel(shortFrame, 0, 0), [0, 0, 0]);
assert(shortFrame.some((v, i) => i % 3 === 1 && v === 255), 'custom colour is used');
const long = parseScene({kind: 'text', text: 'All 128 tests passed and the build is green, shipping now!'});
assert(isAnimated(long), 'long text scrolls');
assert(differs(renderScene(long, 0), renderScene(long, 500)), 'marquee moves');
previews.push(['text', shortFrame]);

// Chinese: a 10px pixel font, 3 lines x 3 hanzi static, longer text scrolls.
const {cjkGlyph, measureCjk, needsCjk, CJK_FONT_GLYPH_COUNT} = require('../src/lib/agent-display/cjk-font.ts');
assert(CJK_FONT_GLYPH_COUNT > 8000, `font covers GB2312 and common Big5 (${CJK_FONT_GLYPH_COUNT})`);
for (const ch of '的一是中國龍你好完成，。！') assert(cjkGlyph(ch.codePointAt(0)), `glyph for ${ch}`);
const zhong = cjkGlyph('中'.codePointAt(0));
assert.equal(zhong.width, 10, 'hanzi are 10px wide');
// BDF: BBX 9x9 at y-offset -1 under ascent 9, so the glyph starts on row 1 of the 10-row cell.
assert.equal(zhong.bits[1 * 10 + 4], 1, '中: vertical stroke at the top centre');
assert.equal(zhong.bits[3 * 10 + 0], 1, '中: box left edge');
assert.equal(zhong.bits[0 * 10 + 0], 0, '中: empty corner');
assert.equal(cjkGlyph('A'.codePointAt(0)).width, 5, 'Latin is half width');
assert.equal(measureCjk('你好'), 20);
assert.equal(measureCjk('AI完成'), 30);
assert(needsCjk('构建成功') && needsCjk('build 完成') && !needsCjk('BUILD OK'), 'Chinese switches font, ASCII keeps the 3x5 font');

const nihao = parseScene({kind: 'text', text: '你好'});
assert(!isAnimated(nihao), 'short Chinese text is static');
const nihaoFrame = renderScene(nihao, 0);
assert(lit(nihaoFrame) > 30, 'Chinese glyphs are drawn');
const rowsLit = y => [...Array(32).keys()].some(x => pixel(nihaoFrame, x, y).some(v => v));
assert(!rowsLit(0) && !rowsLit(31) && rowsLit(16), 'one line is vertically centred');
const nine = parseScene({kind: 'text', text: '今天天气真不错啊！'});
assert(!isAnimated(nine), 'nine hanzi fit as 3 lines of 3');
const longZh = parseScene({kind: 'text', text: '所有测试都通过了，可以合并发布新版本'});
assert(isAnimated(longZh), 'longer Chinese scrolls');
assert(differs(renderScene(longZh, 0), renderScene(longZh, 600)), 'Chinese marquee moves');
assert(lit(renderScene(parseScene({kind: 'text', text: 'CI 通过'}), 0)) > 20, 'mixed Latin and Chinese renders');
const zhLabel = renderScene(parseScene({kind: 'status', status: 'done', label: '部署'}), 900);
assert(lit(zhLabel.subarray(22 * 32 * 3)) > 15, 'Chinese label gets a taller band');
const missing = renderScene(parseScene({kind: 'text', text: '🙂'}), 0);
assert(lit(missing) > 0, 'unsupported characters show a placeholder instead of nothing');
previews.push(['你好', nihaoFrame]);
previews.push(['nine', renderScene(nine, 0)]);
previews.push(['label', zhLabel]);

// Pixel art from an LLM-friendly palette grid, optionally animated.
const smiley = ['..yyyy..', '.y....y.', 'y.k..k.y', 'y......y', 'y.k..k.y', 'y..kk..y', '.y....y.', '..yyyy..'];
const pixels = parseScene({kind: 'pixels', frames: [smiley], palette: {y: '#FFD000', k: '#FF0000'}});
const art = renderScene(pixels, 0);
assert.deepEqual(pixel(art, 2, 0), [255, 208, 0], 'palette colour at its grid position');
assert.deepEqual(pixel(art, 2, 2), [255, 0, 0]);
assert.deepEqual(pixel(art, 0, 0), [0, 0, 0], "'.' is black");
const blink = parseScene({kind: 'pixels', frames: [['r'], ['.']], palette: {r: '#FF0000'}, fps: 2});
assert(isAnimated(blink));
assert.deepEqual(pixel(renderScene(blink, 0), 0, 0), [255, 0, 0]);
assert.deepEqual(pixel(renderScene(blink, 600), 0, 0), [0, 0, 0], 'frames advance at fps');

// Validation at the boundary: clear errors, no partial scenes.
assert.throws(() => parseScene({kind: 'mood', mood: 'ecstatic'}), /mood/);
assert.throws(() => parseScene({kind: 'status', status: 'done', label: 'x'.repeat(200)}), /label/);
assert.throws(() => parseScene({kind: 'text', text: ''}), /text/);
assert.throws(() => parseScene({kind: 'text', text: 'hi', color: 'red'}), /color/);
assert.throws(() => parseScene({kind: 'pixels', frames: [['.'.repeat(33)]], palette: {}}), /32/);
assert.throws(() => parseScene({kind: 'pixels', frames: [], palette: {}}), /frames/);
assert.throws(() => parseScene({kind: 'pixels', frames: [['a']], palette: {a: '#12'}}), /palette/);
assert.throws(() => parseScene({kind: 'teleport'}), /kind/);

// Contact sheet for eyeballing the designs (scratch output only).
if (process.env.AGENT_PREVIEW_OUT) {
  fs.writeFileSync(process.env.AGENT_PREVIEW_OUT, JSON.stringify(previews.map(([name, rgb]) => [name, Buffer.from(rgb).toString('base64')])));
}
console.log(`PASS: agent display — ${MOODS.length} moods, ${STATUSES.length} statuses with labels, text wrap/marquee, palette pixel art, validation.`);
