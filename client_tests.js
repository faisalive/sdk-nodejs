import { test } from 'node:test';
import assert from 'node:assert/strict';
import RemoteBrowser, {
  APIConnectionError,
  APIConnectionTimeoutError,
  NotFoundError,
  RateLimitError
} from './index.js';

function mockFetch(...responses) {
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ url, init });
    const next = responses.shift();
    if (next instanceof Error) throw next;
    if (typeof next === 'function') return next(url, init);
    return next;
  };
  return { fetch, calls };
}

function json(status, body, headers) {
  return new Response(JSON.stringify(body), { status, headers });
}

test('reads apiKey and baseURL from the environment', (t) => {
  t.after(() => {
    delete process.env.REMOTEBROWSER_API_KEY;
    delete process.env.REMOTEBROWSER_URL;
  });
  process.env.REMOTEBROWSER_API_KEY = 'sk-env';
  process.env.REMOTEBROWSER_URL = 'http://env:3000/';
  const client = new RemoteBrowser();
  assert.equal(client.apiKey, 'sk-env');
  assert.equal(client.baseURL, 'http://env:3000');
});

test('options win over the environment', (t) => {
  t.after(() => delete process.env.REMOTEBROWSER_API_KEY);
  process.env.REMOTEBROWSER_API_KEY = 'sk-env';
  const client = new RemoteBrowser({ apiKey: 'sk-opt', baseURL: 'http://opt' });
  assert.equal(client.apiKey, 'sk-opt');
});

test('throws without apiKey or baseURL', () => {
  delete process.env.REMOTEBROWSER_API_KEY;
  delete process.env.REMOTEBROWSER_URL;
  assert.throws(() => new RemoteBrowser({ baseURL: 'http://x' }), /REMOTEBROWSER_API_KEY/);
  assert.throws(() => new RemoteBrowser({ apiKey: 'sk' }), /REMOTEBROWSER_URL/);
});

test('sends the bearer token and JSON body', async () => {
  const { fetch, calls } = mockFetch(json(200, { browser_id: 'B1', status: 'starting' }));
  const client = new RemoteBrowser({ apiKey: 'sk-1', baseURL: 'http://h', fetch });
  const result = await client.browsers.create({ os: 'ubuntu' });
  assert.deepEqual(result, { browser_id: 'B1', status: 'starting' });
  assert.equal(calls[0].url, 'http://h/api/v1/browsers');
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].init.headers.Authorization, 'Bearer sk-1');
  assert.equal(calls[0].init.headers['Content-Type'], 'application/json');
  assert.equal(calls[0].init.body, '{"os":"ubuntu"}');
});

test('maps status codes to error classes', async () => {
  const { fetch } = mockFetch(json(404, { error: 'not found' }));
  const client = new RemoteBrowser({ apiKey: 'sk', baseURL: 'http://h', fetch });
  await assert.rejects(client.browsers.retrieve('Bx'), (err) => {
    assert.ok(err instanceof NotFoundError);
    assert.ok(err instanceof RemoteBrowser.APIError);
    assert.equal(err.status, 404);
    assert.deepEqual(err.error, { error: 'not found' });
    assert.equal(err.message, '404 not found');
    return true;
  });
});

test('retries 429 using Retry-After', async () => {
  const { fetch, calls } = mockFetch(json(429, {}, { 'Retry-After': '0' }), json(200, ['B1']));
  const client = new RemoteBrowser({ apiKey: 'sk', baseURL: 'http://h', fetch });
  assert.deepEqual(await client.browsers.list(), ['B1']);
  assert.equal(calls.length, 2);
});

test('gives up after maxRetries', async () => {
  const { fetch, calls } = mockFetch(json(429, {}, { 'Retry-After': '0' }), json(429, {}, { 'Retry-After': '0' }));
  const client = new RemoteBrowser({ apiKey: 'sk', baseURL: 'http://h', fetch, maxRetries: 1 });
  await assert.rejects(client.browsers.list(), RateLimitError);
  assert.equal(calls.length, 2);
});

test('does not retry 409', async () => {
  const { fetch, calls } = mockFetch(json(409, { browser_id: 'B1', status: 'running' }));
  const client = new RemoteBrowser({ apiKey: 'sk', baseURL: 'http://h', fetch });
  await assert.rejects(client.browsers.resume('B1'), RemoteBrowser.ConflictError);
  assert.equal(calls.length, 1);
});

test('wraps network failures', async () => {
  const { fetch } = mockFetch(new TypeError('fetch failed'));
  const client = new RemoteBrowser({ apiKey: 'sk', baseURL: 'http://h', fetch, maxRetries: 0 });
  await assert.rejects(client.browsers.list(), APIConnectionError);
});

test('times out', async () => {
  const hang = (url, init) =>
    new Promise((resolve, reject) => init.signal.addEventListener('abort', () => reject(init.signal.reason)));
  const { fetch } = mockFetch(hang);
  const client = new RemoteBrowser({ apiKey: 'sk', baseURL: 'http://h', fetch, maxRetries: 0 });
  await assert.rejects(client.browsers.list({ timeout: 10 }), APIConnectionTimeoutError);
});
