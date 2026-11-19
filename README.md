# Remote Browser Node.js SDK

Node.js client for the [Remote Browser REST API](https://remotebrowser.ai/api/).

Requires Node.js 22 or later. It has no dependencies and uses the built-in `fetch`.

## Installation

```bash
npm install remotebrowser
```

## Usage

```js
import RemoteBrowser from 'remotebrowser';

const client = new RemoteBrowser({
  apiKey: process.env.REMOTEBROWSER_API_KEY, // default, can be omitted
  baseURL: process.env.REMOTEBROWSER_URL // default, can be omitted
});

const config = { os: 'ubuntu-26.04', browser: 'chrome' };
const { browser_id } = await client.browsers.create(config);
const browser = await client.browsers.retrieve(browser_id);
console.log(browser.status); // 'starting' | 'running' | ...
```

### Connect with Playwright

```js
import { chromium } from 'playwright-core';

const cdpUrl = client.browsers.connectUrl(browser_id);
const browser = await chromium.connectOverCDP(cdpUrl, { headers: client.authHeaders });
const page = await browser.contexts()[0].newPage();
await page.goto('https://example.com');
await page.screenshot({ path: 'screenshot.png' });
await page.close();
```

## Command-line tool

The package installs a `remotebrowser` executable. It reads the same `REMOTEBROWSER_API_KEY` and `REMOTEBROWSER_URL` environment variables.

```bash
npm install -g remotebrowser   # or: npx remotebrowser <command>

ID=$(remotebrowser create --os ubuntu-26.04 --browser chrome --wait)
remotebrowser list
remotebrowser get $ID
remotebrowser connect $ID      # prints the CDP WebSocket URL
remotebrowser suspend $ID
remotebrowser resume $ID
remotebrowser config set $ID --proxy socks5://proxy.example:1080
remotebrowser config get $ID
remotebrowser delete $ID
```

| Command                              | Description                                        |
| ------------------------------------ | -------------------------------------------------- |
| `create [options]`                   | Launch a browser and print its id                  |
| `list`                               | Print the ids of the starting and running browsers |
| `get <id>`                           | Show the details of a browser                      |
| `delete <id>...`                     | Terminate browsers                                 |
| `suspend <id>...` / `resume <id>...` | Suspend or resume browsers                         |
| `connect <id>`                       | Print the CDP WebSocket URL                        |
| `config get <id>`                    | Show the configuration                             |
| `config set <id> --proxy <url>`      | Change the proxy                                   |
| `config set <id> --no-proxy`         | Remove the proxy                                   |

`create` takes `--name`, `--description`, `--os`, `--browser`, `--screen-resolution`, `--screen-scale`, `--webgl`/`--no-webgl`, `--proxy`, and `--wait` (wait until the browser is running). Every command takes `--json` to print the raw API response. Run `remotebrowser help` for details.

The CDP endpoint needs the API key in the `Authorization: Bearer` header.

## API

| Method                                         | Endpoint                                                                     |
| ---------------------------------------------- | ---------------------------------------------------------------------------- |
| `client.browsers.create(params?)`              | `POST /api/v1/browsers`                                                      |
| `client.browsers.list()`                       | `GET /api/v1/browsers`                                                       |
| `client.browsers.retrieve(id)`                 | `GET /api/v1/browsers/{id}`                                                  |
| `client.browsers.delete(id)`                   | `DELETE /api/v1/browsers/{id}`                                               |
| `client.browsers.suspend(id)`                  | `POST /api/v1/browsers/{id}/suspend`                                         |
| `client.browsers.resume(id)`                   | `POST /api/v1/browsers/{id}/resume`                                          |
| `client.browsers.config.retrieve(id)`          | `GET /api/v1/browsers/{id}/config`                                           |
| `client.browsers.config.update(id, { proxy })` | `PATCH /api/v1/browsers/{id}/config`                                         |
| `client.browsers.connectUrl(id)`               | WebSocket URL for [CDP](https://chromedevtools.github.io/devtools-protocol/) |

Every method takes an optional last argument with request options: `timeout`, `maxRetries`, `headers`, and `signal`.

```js
await client.browsers.list({ timeout: 5 * 1000 });
```

## Handling errors

Non-2xx responses throw a subclass of `APIError`, which has `status`, `error` (the response body), and `headers`.

```js
try {
  await client.browsers.resume(id);
} catch (err) {
  if (err instanceof RemoteBrowser.ConflictError) {
    console.log('Browser is', err.error.status);
  } else {
    throw err;
  }
}
```

| Status code | Error type                 |
| ----------- | -------------------------- |
| 400         | `BadRequestError`          |
| 401         | `AuthenticationError`      |
| 403         | `PermissionDeniedError`    |
| 404         | `NotFoundError`            |
| 409         | `ConflictError`            |
| 422         | `UnprocessableEntityError` |
| 429         | `RateLimitError`           |
| >=500       | `InternalServerError`      |
| N/A         | `APIConnectionError`       |

A timeout throws `APIConnectionTimeoutError`. An aborted `signal` throws `APIUserAbortError`.

## Retries and timeouts

Connection errors, 408, 429, and 5xx responses are retried 2 times by default, with exponential backoff. The `Retry-After` header is respected. 409 is not retried because it means the browser is in the wrong state.

Each request times out after 60 seconds by default.

```js
const client = new RemoteBrowser({ maxRetries: 0, timeout: 20 * 1000 });
```
