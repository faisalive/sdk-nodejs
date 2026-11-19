import { Browsers } from './browsers.js';
import * as Errors from './errors.js';

/**
 * @typedef {object} ClientOptions
 * @property {string} [apiKey] Defaults to process.env.REMOTEBROWSER_API_KEY.
 * @property {string} [baseURL] Defaults to process.env.REMOTEBROWSER_URL.
 * @property {number} [timeout] Milliseconds per attempt. Default 60 seconds.
 * @property {number} [maxRetries] Default 2.
 * @property {Record<string, string>} [defaultHeaders]
 * @property {typeof fetch} [fetch] Custom fetch implementation.
 *
 * @typedef {object} RequestOptions
 * @property {unknown} [body]
 * @property {number} [timeout]
 * @property {number} [maxRetries]
 * @property {Record<string, string>} [headers]
 * @property {AbortSignal} [signal]
 */

const DEFAULT_TIMEOUT = 60 * 1000;
const DEFAULT_MAX_RETRIES = 2;
const MAX_RETRY_DELAY = 60 * 1000;

export class RemoteBrowser {
  /** @param {ClientOptions} [options] */
  constructor({
    apiKey = process.env.REMOTEBROWSER_API_KEY,
    baseURL = process.env.REMOTEBROWSER_URL,
    timeout = DEFAULT_TIMEOUT,
    maxRetries = DEFAULT_MAX_RETRIES,
    defaultHeaders = {},
    fetch: fetchFn = globalThis.fetch
  } = {}) {
    if (!apiKey) {
      throw new Errors.RemoteBrowserError(
        'The REMOTEBROWSER_API_KEY environment variable is missing or empty; either provide it, or pass the ' +
          '`apiKey` option to the RemoteBrowser client.'
      );
    }
    if (!baseURL) {
      throw new Errors.RemoteBrowserError(
        'The REMOTEBROWSER_URL environment variable is missing or empty; either provide it, or pass the ' +
          '`baseURL` option to the RemoteBrowser client.'
      );
    }
    this.apiKey = apiKey;
    this.baseURL = baseURL.replace(/\/+$/, '');
    this.timeout = timeout;
    this.maxRetries = maxRetries;
    this.defaultHeaders = defaultHeaders;
    this.fetch = fetchFn;

    this.browsers = new Browsers(this);
  }

  /** Headers for connections the SDK does not make itself, such as CDP over WebSocket. */
  get authHeaders() {
    return { Authorization: `Bearer ${this.apiKey}` };
  }

  /** @param {string} path @param {RequestOptions} [options] */
  get(path, options) {
    return this.request('GET', path, options);
  }

  /** @param {string} path @param {RequestOptions} [options] */
  post(path, options) {
    return this.request('POST', path, options);
  }

  /** @param {string} path @param {RequestOptions} [options] */
  patch(path, options) {
    return this.request('PATCH', path, options);
  }

  /** @param {string} path @param {RequestOptions} [options] */
  delete(path, options) {
    return this.request('DELETE', path, options);
  }

  /**
   * @param {string} method
   * @param {string} path
   * @param {RequestOptions} [options]
   */
  async request(method, path, options = {}) {
    const maxRetries = options.maxRetries ?? this.maxRetries;
    for (let attempt = 0; ; attempt++) {
      const retriesLeft = maxRetries - attempt;
      try {
        return await this.#makeRequest(method, path, options);
      } catch (err) {
        if (retriesLeft <= 0 || !shouldRetry(err)) throw err;
        await sleep(retryDelay(err, attempt));
      }
    }
  }

  async #makeRequest(method, path, { body, timeout = this.timeout, headers, signal }) {
    if (signal?.aborted) throw new Errors.APIUserAbortError();

    const init = {
      method,
      headers: {
        Accept: 'application/json',
        ...this.authHeaders,
        ...this.defaultHeaders,
        ...headers
      },
      signal: AbortSignal.any([AbortSignal.timeout(timeout), ...(signal ? [signal] : [])])
    };
    if (body !== undefined) {
      init.headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(body);
    }

    let response, text;
    try {
      response = await this.fetch(this.baseURL + path, init);
      text = await response.text();
    } catch (err) {
      if (signal?.aborted) throw new Errors.APIUserAbortError();
      if (err?.name === 'TimeoutError') throw new Errors.APIConnectionTimeoutError();
      throw new Errors.APIConnectionError({ cause: err });
    }

    let data;
    try {
      data = text ? JSON.parse(text) : undefined;
    } catch {
      // Proxies in front of the API may answer with plain text.
      data = text;
    }

    if (!response.ok) {
      throw Errors.APIError.generate(response.status, data, response.headers);
    }
    return data;
  }
}

function shouldRetry(err) {
  if (err instanceof Errors.APIUserAbortError) return false;
  if (err instanceof Errors.APIConnectionError) return true;
  // 409 is a state conflict in this API, so retrying it would not help.
  return err instanceof Errors.APIError && (err.status === 408 || err.status === 429 || err.status >= 500);
}

function retryDelay(err, attempt) {
  const retryAfter = Number(err.headers?.get('retry-after'));
  if (retryAfter >= 0 && retryAfter * 1000 <= MAX_RETRY_DELAY) {
    return retryAfter * 1000;
  }
  const base = Math.min(500 * 2 ** attempt, 8000);
  return base * (1 - Math.random() * 0.25);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

Object.assign(RemoteBrowser, Errors);
