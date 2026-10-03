// MCP side: the panel client (discovery, auth, launch-on-demand) and the MCP tools end to end.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');
const assert = require('node:assert/strict');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const resolve = Module._resolveFilename;
Module._resolveFilename = function(name, ...args) {return resolve.call(this, name.startsWith('@/') ? path.join(root, 'src', name.slice(2)) : name, ...args);};
require.extensions['.ts'] = (mod, filename) => mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true}}).outputText, filename);
const {createApiServer} = require('../desktop/src/api-server.ts');
const {writeApiInfo} = require('../desktop/src/api-info.ts');
const {PanelClient} = require('../mcp/src/panel-client.ts');
const {createMatrixMcpServer} = require('../mcp/src/server-tools.ts');
const {Client} = require('@modelcontextprotocol/sdk/client/index.js');
const {InMemoryTransport} = require('@modelcontextprotocol/sdk/inMemory.js');

async function startFakeApp(dataDir, token = 'tok') {
  const received = [];
  const server = createApiServer({
    token,
    staticDir: dataDir,
    onScene: (scene, source) => { received.push({scene, source}); return !(source === 'hook' && scene.status === 'working'); },
    getState: () => ({connected: true, deviceName: 'IDM-TEST', live: 'agent'}),
    onEditor: async (req) => { received.push({editor: req}); return req.action === 'get-drawing' ? {rows: 32, cols: 32, pixels: ['....']} : {created: 'layer'}; }
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  writeApiInfo(dataDir, {port: server.address().port, token, executable: path.join(dataDir, 'missing.exe'), pid: 1});
  return {server, received};
}

async function main() {
  // ------------------------------------------------------------ panel client
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dmd-mcp-'));
  const offline = new PanelClient({dataDir, launch: false, timeoutMs: 500});
  const notRunning = await offline.sendScene({kind: 'mood', mood: 'happy'});
  assert.equal(notRunning.ok, false);
  assert.match(notRunning.error, /Dot Matrix Studio/, 'tells the agent the app is not running');

  const {server, received} = await startFakeApp(dataDir);
  const client = new PanelClient({dataDir, launch: false, timeoutMs: 2000});
  assert.deepEqual(await client.sendScene({kind: 'mood', mood: 'happy'}), {ok: true, shown: true});
  assert.deepEqual(received[0], {scene: {kind: 'mood', mood: 'happy'}, source: 'agent'});
  assert.deepEqual(await client.sendScene({kind: 'status', status: 'working'}, 'hook'), {ok: true, shown: false}, 'held hook scenes report shown:false');
  const invalid = await client.sendScene({kind: 'mood', mood: 'meh'});
  assert.equal(invalid.ok, false);
  assert.match(invalid.error, /mood must be one of/, 'validation errors reach the agent');
  assert.deepEqual(await client.getState(), {ok: true, state: {connected: true, deviceName: 'IDM-TEST', live: 'agent'}});

  writeApiInfo(dataDir, {port: server.address().port, token: 'wrong', executable: 'x', pid: 1});
  assert.match((await client.sendScene({kind: 'mood', mood: 'happy'})).error, /token/i, 'stale token is reported');
  server.close();

  // Launch on demand: when the app is not reachable the client starts it, then retries.
  const launchDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dmd-launch-'));
  writeApiInfo(launchDir, {port: 9, token: 'tok', executable: 'C:/fake/app.exe', pid: 1});
  let launched = null, app = null;
  const launcher = new PanelClient({
    dataDir: launchDir, launch: true, timeoutMs: 400, launchWaitMs: 4000,
    spawnApp: async exe => { launched = exe; app = await startFakeApp(launchDir); }
  });
  assert.deepEqual(await launcher.sendScene({kind: 'status', status: 'thinking'}), {ok: true, shown: true});
  assert.equal(launched, 'C:/fake/app.exe', 'starts the installed app');
  app.server.close();

  // ------------------------------------------------------------ MCP tools end to end
  const mcpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dmd-tools-'));
  const fake = await startFakeApp(mcpDir);
  const mcp = createMatrixMcpServer(new PanelClient({dataDir: mcpDir, launch: false, timeoutMs: 2000}));
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const mcpClient = new Client({name: 'test', version: '1.0.0'});
  await Promise.all([mcp.connect(serverTransport), mcpClient.connect(clientTransport)]);

  const tools = (await mcpClient.listTools()).tools.map(t => t.name).sort();
  assert.deepEqual(tools, ['draw_pixels', 'editor_draw', 'editor_get_drawing', 'get_panel_state', 'set_mood', 'set_status', 'show_text']);
  const moodTool = (await mcpClient.listTools()).tools.find(t => t.name === 'set_mood');
  assert.deepEqual(moodTool.inputSchema.properties.mood.enum.slice(0, 3), ['neutral', 'happy', 'excited'], 'mood enum is advertised');

  const call = (name, args) => mcpClient.callTool({name, arguments: args});
  assert(!(await call('set_status', {status: 'working', label: 'tests'})).isError);
  assert(!(await call('set_mood', {mood: 'proud'})).isError);
  assert(!(await call('show_text', {text: 'BUILD OK', color: '#00FF00'})).isError);
  assert(!(await call('draw_pixels', {frames: [['rr', 'rr']], palette: {r: '#FF0000'}})).isError);
  assert.deepEqual(fake.received.map(r => r.scene.kind), ['status', 'mood', 'text', 'pixels']);
  assert(fake.received.every(r => r.source === 'agent'));
  const read = await call('editor_get_drawing', {});
  assert(!read.isError);
  assert.match(read.content[0].text, /"cols":32/);
  const drew = await call('editor_draw', {frames: [['rr', 'rr']], palette: {r: '#FF0000'}, name: 'cat', target: 'artboard'});
  assert(!drew.isError);
  assert.match(drew.content[0].text, /editor/);
  const editorCalls = fake.received.splice(4).map(r => r.editor);
  assert.deepEqual(editorCalls.map(r => r.action), ['get-drawing', 'draw']);
  assert.equal(editorCalls[1].payload.target, 'artboard');
  assert((await call('editor_draw', {frames: [['r'.repeat(33)]], palette: {r: '#FF0000'}})).isError, 'oversized art is an error result');
  const state = await call('get_panel_state', {});
  assert.match(state.content[0].text, /IDM-TEST/);
  const rejected = await call('draw_pixels', {frames: [['x'.repeat(40)]], palette: {}});
  assert(rejected.isError, 'invalid art is an MCP error result, not a crash');
  await mcpClient.close();
  fake.server.close();

  for (const dir of [dataDir, launchDir, mcpDir]) fs.rmSync(dir, {recursive: true, force: true});
  console.log('PASS: mcp — client discovery/auth/errors/launch-on-demand, 7 tools end to end over MCP.');
}

main().catch(error => { console.error(error); process.exit(1); });
