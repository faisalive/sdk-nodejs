/**
 * @typedef {'starting' | 'running' | 'suspended' | 'error' | 'terminated'} BrowserStatus
 *
 * @typedef {object} BrowserCreateParams
 * @property {string} [name] 1-80 characters. A random name is used if omitted.
 * @property {string} [description] Up to 140 characters.
 * @property {'debian-13' | 'ubuntu-26.04' | 'fedora-44' | 'windows-11' | string} [os]
 * @property {'chromium' | 'chrome'} [browser]
 * @property {'full-hd' | 'wuxga' | 'qhd' | '4k'} [screen_resolution]
 * @property {100 | 125 | 150 | 175 | 200} [screen_scale]
 * @property {string | null} [proxy] http://, socks4:// or socks5:// URL.
 *
 * @typedef {{ browser_id: string, status: BrowserStatus }} BrowserStatusResponse
 *
 * @typedef {object} Browser
 * @property {string} browser_id
 * @property {BrowserStatus} status
 * @property {string} description
 * @property {string} os
 * @property {number | null} creation_timestamp Milliseconds since the Unix epoch.
 *
 * @typedef {{ browser_id: string, proxy: string | null }} BrowserConfig
 *
 * @typedef {import('./client.js').RequestOptions} RequestOptions
 */

function browserPath(id, suffix = '') {
  if (typeof id !== 'string' || !id) {
    throw new TypeError('A browser id is required');
  }
  return `/api/v1/browsers/${encodeURIComponent(id)}${suffix}`;
}

export class Config {
  /** @param {import('./client.js').RemoteBrowser} client */
  constructor(client) {
    /** @private */
    this._client = client;
  }

  /**
   * @param {string} id
   * @param {RequestOptions} [options]
   * @returns {Promise<BrowserConfig>}
   */
  retrieve(id, options) {
    return this._client.get(browserPath(id, '/config'), options);
  }

  /**
   * Changing the proxy closes all open connections of the browser.
   * @param {string} id
   * @param {{ proxy?: string | null }} params
   * @param {RequestOptions} [options]
   * @returns {Promise<BrowserConfig>}
   */
  update(id, params, options) {
    return this._client.patch(browserPath(id, '/config'), { body: params, ...options });
  }
}

export class Browsers {
  /** @param {import('./client.js').RemoteBrowser} client */
  constructor(client) {
    /** @private */
    this._client = client;
    this.config = new Config(client);
  }

  /**
   * Launch a browser. It may still be starting when this returns.
   * @param {BrowserCreateParams} [params]
   * @param {RequestOptions} [options]
   * @returns {Promise<BrowserStatusResponse>}
   */
  create(params = {}, options) {
    return this._client.post('/api/v1/browsers', { body: params, ...options });
  }

  /**
   * @param {string} id
   * @param {RequestOptions} [options]
   * @returns {Promise<Browser>}
   */
  retrieve(id, options) {
    return this._client.get(browserPath(id), options);
  }

  /**
   * IDs of the starting and running browsers in the workspace.
   * @param {RequestOptions} [options]
   * @returns {Promise<string[]>}
   */
  list(options) {
    return this._client.get('/api/v1/browsers', options);
  }

  /**
   * Terminate a browser. This cannot be undone.
   * @param {string} id
   * @param {RequestOptions} [options]
   * @returns {Promise<BrowserStatusResponse>}
   */
  delete(id, options) {
    return this._client.delete(browserPath(id), options);
  }

  /**
   * @param {string} id
   * @param {RequestOptions} [options]
   * @returns {Promise<BrowserStatusResponse>}
   */
  suspend(id, options) {
    return this._client.post(browserPath(id, '/suspend'), options);
  }

  /**
   * @param {string} id
   * @param {RequestOptions} [options]
   * @returns {Promise<BrowserStatusResponse>}
   */
  resume(id, options) {
    return this._client.post(browserPath(id, '/resume'), options);
  }

  /**
   * WebSocket URL of the CDP endpoint. The connection needs the API key in the
   * Authorization header, see `client.authHeaders`.
   * @param {string} id
   * @returns {string}
   */
  connectUrl(id) {
    const url = new URL(this._client.baseURL + browserPath(id, '/cdp'));
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    return url.toString();
  }
}
