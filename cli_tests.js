import { test } from 'node:test';
import assert from 'node:assert/strict';
import { run } from './cli.js';

function setup(...responses) {
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ url, method: init.method, body: init.body });
    const [status, body] = responses.shift() ?? [200, {}];
    return new Response(JSON.stringify(body), { status });
  };
  let stdout = '';
  let stderr = '';
  const options = {
    stdout: { write: (text) => (stdout += text) },
    stderr: { write: (text) => (stderr += text) },
    clientOptions: { apiKey: 'sk', baseURL: 'https://rb.example', fetch, maxRetries: 0 },
    pollInterval: 0
  };
  return {
    calls,
    run: (...argv) => run(argv, options),
    get stdout() {
      return stdout;
    },
    get stderr() {
      return stderr;
    }
  };
}

const base = 'https://rb.example/api/v1/browsers';

test('help needs no credentials', async () => {
  let stdout = '';
  const code = await run(['--help'], { stdout: { write: (text) => (stdout += text) }, clientOptions: {} });
  assert.equal(code, 0);
  assert.match(stdout, /Usage: remotebrowser/);
});

test('create sends the options and prints the id', async () => {
  const cli = setup([200, { browser_id: 'B1', status: 'starting' }]);
  const code = await cli.run('create', '--os', 'ubuntu-26.04', '--screen-scale', '150', '--no-webgl');
  assert.equal(code, 0);
  assert.equal(cli.calls[0].method, 'POST');
  assert.deepEqual(JSON.parse(cli.calls[0].body), { os: 'ubuntu-26.04', screen_scale: 150, webgl: false });
  assert.equal(cli.stdout, 'B1\n');
});

test('create --wait polls until running', async () => {
  const cli = setup(
    [200, { browser_id: 'B1', status: 'starting' }],
    [200, { browser_id: 'B1', status: 'starting' }],
    [200, { browser_id: 'B1', status: 'running', os: 'debian-13' }]
  );
  assert.equal(await cli.run('create', '--wait'), 0);
  assert.deepEqual(
    cli.calls.map((c) => `${c.method} ${c.url}`),
    [`POST ${base}`, `GET ${base}/B1`, `GET ${base}/B1`]
  );
  assert.equal(cli.stdout, 'B1\n');
});

test('create --wait fails when the browser does not run', async () => {
  const cli = setup([200, { browser_id: 'B1', status: 'starting' }], [200, { browser_id: 'B1', status: 'error' }]);
  assert.equal(await cli.run('create', '--wait'), 1);
  assert.match(cli.stderr, /B1 is error/);
});

test('list prints one id per line, or JSON', async () => {
  const cli = setup([200, ['B1', 'B2']], [200, ['B1']]);
  await cli.run('list');
  await cli.run('list', '--json');
  assert.equal(cli.stdout, 'B1\nB2\n[\n  "B1"\n]\n');
});

test('get shows the browser details', async () => {
  const cli = setup([
    200,
    { browser_id: 'B1', status: 'running', description: '', os: 'fedora-44', creation_timestamp: 0 }
  ]);
  await cli.run('get', 'B1');
  assert.match(cli.stdout, /^id: +B1$/m);
  assert.match(cli.stdout, /^description: +-$/m);
  assert.match(cli.stdout, /^created: +1970-01-01T00:00:00.000Z$/m);
});

test('delete, suspend and resume accept several ids', async () => {
  const cli = setup(
    [200, { browser_id: 'B1', status: 'terminated' }],
    [200, { browser_id: 'B2', status: 'terminated' }],
    [200, { browser_id: 'B3', status: 'suspended' }],
    [200, { browser_id: 'B3', status: 'running' }]
  );
  await cli.run('delete', 'B1', 'B2');
  await cli.run('suspend', 'B3');
  await cli.run('resume', 'B3');
  assert.deepEqual(
    cli.calls.map((c) => `${c.method} ${c.url}`),
    [`DELETE ${base}/B1`, `DELETE ${base}/B2`, `POST ${base}/B3/suspend`, `POST ${base}/B3/resume`]
  );
  assert.equal(cli.stdout, 'B1 terminated\nB2 terminated\nB3 suspended\nB3 running\n');
});

test('delete keeps going when one browser fails', async () => {
  const cli = setup([404, { error: 'not found' }], [200, { browser_id: 'B2', status: 'terminated' }]);
  assert.equal(await cli.run('delete', 'B1', 'B2'), 1);
  assert.equal(cli.stdout, 'B2 terminated\n');
  assert.match(cli.stderr, /B1: 404 not found/);
});

test('connect prints the CDP URL without a request', async () => {
  const cli = setup();
  await cli.run('connect', 'B1');
  assert.equal(cli.stdout, 'wss://rb.example/api/v1/browsers/B1/cdp\n');
  assert.equal(cli.calls.length, 0);
});

test('config get and set', async () => {
  const cli = setup([200, { browser_id: 'B1', proxy: null }], [200, { browser_id: 'B1', proxy: 'socks5://p:1080' }]);
  await cli.run('config', 'get', 'B1');
  await cli.run('config', 'set', 'B1', '--proxy', 'socks5://p:1080');
  assert.equal(cli.calls[1].method, 'PATCH');
  assert.equal(cli.calls[1].body, '{"proxy":"socks5://p:1080"}');
  assert.equal(cli.stdout, 'id:    B1\nproxy: -\nid:    B1\nproxy: socks5://p:1080\n');
});

test('config set --no-proxy sends null', async () => {
  const cli = setup([200, { browser_id: 'B1', proxy: null }]);
  await cli.run('config', 'set', 'B1', '--no-proxy');
  assert.equal(cli.calls[0].body, '{"proxy":null}');
});

test('usage errors exit with 2', async () => {
  const cli = setup();
  assert.equal(await cli.run('frobnicate'), 2);
  assert.equal(await cli.run('get'), 2);
  assert.equal(await cli.run('list', '--os', 'x'), 2);
  assert.equal(await cli.run('create', '--bogus'), 2);
  assert.equal(await cli.run('config', 'set', 'B1'), 2);
  assert.equal(cli.calls.length, 0);
});

test('missing credentials exit with 1', async () => {
  let stderr = '';
  const code = await run(['list'], { stderr: { write: (text) => (stderr += text) }, clientOptions: { apiKey: '' } });
  assert.equal(code, 1);
  assert.match(stderr, /REMOTEBROWSER_API_KEY/);
});
