// Desktop app pieces that run without Electron: device choice, the local agent API and its discovery file.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const Module = require('node:module');
const assert = require('node:assert/strict');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const resolve = Module._resolveFilename;
Module._resolveFilename = function(name, ...args) {return resolve.call(this, name.startsWith('@/') ? path.join(root, 'src', name.slice(2)) : name, ...args);};
require.extensions['.ts'] = (mod, filename) => mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true}}).outputText, filename);
const {pickPanel} = require('../desktop/src/device-chooser.ts');
const {createApiServer, MAX_BODY_BYTES} = require('../desktop/src/api-server.ts');
const {writeApiInfo, readApiInfo, API_INFO_FILE} = require('../desktop/src/api-info.ts');
const {acceptScene, AGENT_HOLD_MS} = require('../desktop/src/scene-priority.ts');

function request(port, {method = 'GET', path: urlPath = '/', headers = {}, body} = {}) {
  return new Promise((resolvePromise, reject) => {
    const req = http.request({host: '127.0.0.1', port, method, path: urlPath, headers}, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolvePromise({status: res.statusCode, headers: res.headers, text: Buffer.concat(chunks).toString('utf8')}));
    });
    req.on('error', reject);
    if (body !== undefined) req.write(typeof body === 'string' ? body : JSON.stringify(body));
    req.end();
  });
}

async function main() {
  // ------------------------------------------------------------ device choice
  const devices = [
    {deviceId: 'a', deviceName: 'Mi Band'},
    {deviceId: 'b', deviceName: 'IDM-0384DA'},
    {deviceId: 'c', deviceName: 'IDM-11AA22'}
  ];
  assert.equal(pickPanel(devices, null), 'b', 'first IDM- panel');
  assert.equal(pickPanel(devices, 'c'), 'c', 'the remembered panel wins');
  assert.equal(pickPanel(devices, 'zz'), 'b', 'a stale remembered id falls back to any panel');
  assert.equal(pickPanel([{deviceId: 'a', deviceName: 'Mi Band'}], null), null, 'no panel yet');

  // ------------------------------------------------------------ hook vs agent priority
  const thinking = {kind: 'status', status: 'thinking'}, done = {kind: 'status', status: 'done'};
  const waiting = {kind: 'status', status: 'waiting'}, working = {kind: 'status', status: 'working'};
  assert.equal(acceptScene('agent', done, 1000, 0), true, 'agents always show');
  assert.equal(acceptScene('hook', done, 0, 50_000), true, 'hooks show when no agent scene is recent');
  assert.equal(acceptScene('hook', done, 10_000, 15_000), false, 'a fresh agent mood is not overwritten by the Stop hook');
  assert.equal(acceptScene('hook', working, 10_000, 15_000), false, 'nor by tool-use hooks');
  assert.equal(acceptScene('hook', done, 10_000, 10_000 + AGENT_HOLD_MS + 1), true, 'hooks resume after the hold');
  assert.equal(acceptScene('hook', thinking, 10_000, 11_000), true, 'a new prompt always shows');
  assert.equal(acceptScene('hook', waiting, 10_000, 11_000), true, 'needing the user always shows');

  // ------------------------------------------------------------ API server
  const staticDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dmd-static-'));
  fs.mkdirSync(path.join(staticDir, 'editor'));
  fs.writeFileSync(path.join(staticDir, 'index.html'), '<h1>home</h1>');
  fs.writeFileSync(path.join(staticDir, 'editor', 'index.html'), '<h1>editor</h1>');
  fs.writeFileSync(path.join(staticDir, 'app.js'), 'console.log(1)');
  const scenes = [];
  const server = createApiServer({
    token: 'secret-token',
    staticDir,
    onScene: (scene, source) => scenes.push({...scene, source}),
    getState: () => ({connected: true, deviceName: 'IDM-0384DA', live: 'agent'})
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const auth = {'x-matrix-token': 'secret-token', 'content-type': 'application/json', host: `127.0.0.1:${port}`};

  assert.equal((await request(port, {path: '/api/state'})).status, 401, 'token required');
  assert.equal((await request(port, {path: '/api/state', headers: {...auth, 'x-matrix-token': 'nope'}})).status, 401, 'wrong token rejected');
  assert.equal((await request(port, {path: '/api/state', headers: {...auth, host: 'evil.example:80'}})).status, 403, 'foreign Host rejected (DNS rebinding)');
  const state = await request(port, {path: '/api/state', headers: auth});
  assert.equal(state.status, 200);
  assert.deepEqual(JSON.parse(state.text), {success: true, data: {connected: true, deviceName: 'IDM-0384DA', live: 'agent'}, error: null});

  const ok = await request(port, {method: 'POST', path: '/api/scene', headers: auth, body: {kind: 'mood', mood: 'happy'}});
  assert.equal(ok.status, 200);
  assert.deepEqual(scenes, [{kind: 'mood', mood: 'happy', source: 'agent'}], 'validated scene forwarded as an agent scene');
  await request(port, {method: 'POST', path: '/api/scene?source=hook', headers: auth, body: {kind: 'status', status: 'done'}});
  assert.equal(scenes[1].source, 'hook', 'hooks identify themselves');
  assert.equal((await request(port, {method: 'POST', path: '/api/scene?source=boss', headers: auth, body: {kind: 'status', status: 'done'}})).status, 400, 'unknown source rejected');
  scenes.length = 1;
  const bad = await request(port, {method: 'POST', path: '/api/scene', headers: auth, body: {kind: 'mood', mood: 'ecstatic'}});
  assert.equal(bad.status, 400);
  assert.match(JSON.parse(bad.text).error, /mood must be one of/, 'readable validation error');
  assert.equal((await request(port, {method: 'POST', path: '/api/scene', headers: auth, body: '{not json'})).status, 400, 'malformed JSON rejected');
  assert.equal((await request(port, {method: 'POST', path: '/api/scene', headers: auth, body: 'x'.repeat(MAX_BODY_BYTES + 10)})).status, 413, 'oversized body rejected');
  assert.equal(scenes.length, 1, 'rejected requests never reach the panel');
  const preflight = await request(port, {method: 'OPTIONS', path: '/api/scene', headers: {origin: 'https://evil.example', 'access-control-request-method': 'POST'}});
  assert(!preflight.headers['access-control-allow-origin'], 'no CORS grant for web pages');

  const editor = await request(port, {path: '/editor/', headers: {host: `127.0.0.1:${port}`}});
  assert.equal(editor.status, 200);
  assert.match(editor.text, /editor/);
  assert.match(editor.headers['content-type'], /text\/html/);
  assert.match((await request(port, {path: '/app.js', headers: {host: `127.0.0.1:${port}`}})).headers['content-type'], /javascript/);
  assert.equal((await request(port, {path: '/..%2f..%2fpackage.json', headers: {host: `127.0.0.1:${port}`}})).status, 404, 'no path traversal');
  assert.equal((await request(port, {path: '/missing.png', headers: {host: `127.0.0.1:${port}`}})).status, 404);
  server.close();

  // ------------------------------------------------------------ discovery file for MCP/hooks
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dmd-data-'));
  writeApiInfo(dataDir, {port: 47321, token: 'abc', executable: 'C:/app.exe', pid: 42});
  assert(fs.existsSync(path.join(dataDir, API_INFO_FILE)));
  assert.deepEqual(readApiInfo(dataDir), {port: 47321, token: 'abc', executable: 'C:/app.exe', args: [], pid: 42});
  fs.writeFileSync(path.join(dataDir, API_INFO_FILE), '{"port": "x"}');
  assert.equal(readApiInfo(dataDir), null, 'a corrupt discovery file is ignored');

  console.log('PASS: desktop — panel choice, API auth/host/CORS/size/validation, static serving without traversal, discovery file.');
}

main().catch(error => { console.error(error); process.exit(1); });
