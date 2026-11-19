import { test } from 'node:test';
import assert from 'node:assert/strict';
import RemoteBrowser from './index.js';

function setup(body = {}) {
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ url, method: init.method, body: init.body });
    return new Response(JSON.stringify(body), { status: 200 });
  };
  const client = new RemoteBrowser({ apiKey: 'sk', baseURL: 'https://rb.example/', fetch });
  return { client, calls };
}

test('maps each method to its endpoint', async () => {
  const { client, calls } = setup();
  await client.browsers.create();
  await client.browsers.list();
  await client.browsers.retrieve('B1');
  await client.browsers.delete('B1');
  await client.browsers.suspend('B1');
  await client.browsers.resume('B1');
  await client.browsers.config.retrieve('B1');
  await client.browsers.config.update('B1', { proxy: null });

  const base = 'https://rb.example/api/v1/browsers';
  assert.deepEqual(
    calls.map((c) => `${c.method} ${c.url}`),
    [
      `POST ${base}`,
      `GET ${base}`,
      `GET ${base}/B1`,
      `DELETE ${base}/B1`,
      `POST ${base}/B1/suspend`,
      `POST ${base}/B1/resume`,
      `GET ${base}/B1/config`,
      `PATCH ${base}/B1/config`
    ]
  );
  assert.equal(calls[0].body, '{}');
  assert.equal(calls[4].body, undefined);
  assert.equal(calls[7].body, '{"proxy":null}');
});

test('escapes browser ids', async () => {
  const { client, calls } = setup();
  await client.browsers.retrieve('a/b');
  assert.equal(calls[0].url, 'https://rb.example/api/v1/browsers/a%2Fb');
});

test('rejects a missing browser id', () => {
  const { client } = setup();
  assert.throws(() => client.browsers.retrieve(), TypeError);
});

test('builds the CDP WebSocket URL', () => {
  const { client } = setup();
  assert.equal(client.browsers.connectUrl('B1'), 'wss://rb.example/api/v1/browsers/B1/cdp');
  const local = new RemoteBrowser({ apiKey: 'sk', baseURL: 'http://localhost:3000' });
  assert.equal(local.browsers.connectUrl('B1'), 'ws://localhost:3000/api/v1/browsers/B1/cdp');
  assert.deepEqual(local.authHeaders, { Authorization: 'Bearer sk' });
});
