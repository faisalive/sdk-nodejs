import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { RemoteBrowser } from './client.js';
import { RemoteBrowserError } from './errors.js';

/**
 * @typedef {object} CliContext
 * @property {(text: string) => void} out
 * @property {(text: string) => void} err
 * @property {() => RemoteBrowser} client
 * @property {boolean} json
 *
 * @typedef {object} RunOptions
 * @property {{ write: (text: string) => unknown }} [stdout]
 * @property {{ write: (text: string) => unknown }} [stderr]
 * @property {import('./client.js').ClientOptions} [clientOptions]
 * @property {number} [pollInterval] Milliseconds between status checks of `create --wait`.
 */

const USAGE = `Usage: remotebrowser <command> [options]

Commands:
  create [options]          Launch a browser and print its id
  list                      Print the ids of the starting and running browsers
  get <id>                  Show the details of a browser
  delete <id>...            Terminate browsers (cannot be undone)
  suspend <id>...           Suspend browsers
  resume <id>...            Resume browsers
  connect <id>              Print the CDP WebSocket URL of a browser
  config get <id>           Show the configuration of a browser
  config set <id> [options] Change the configuration of a browser
  help                      Show this help

Options for create:
  --name <name>                1-80 characters, random if omitted
  --description <text>         Up to 140 characters
  --os <os>                    debian-13, ubuntu-26.04, fedora-44, windows-11, ...
  --browser <browser>          chromium or chrome
  --screen-resolution <res>    full-hd, wuxga, qhd or 4k
  --screen-scale <percent>     100, 125, 150, 175 or 200
  --webgl, --no-webgl          Enable or disable WebGL
  --proxy <url>                http://, socks4:// or socks5:// URL
  --wait                       Wait until the browser is running

Options for config set:
  --proxy <url>                Set the proxy (closes all open connections)
  --no-proxy                   Remove the proxy

Global options:
  --json                       Print the raw JSON response
  -h, --help                   Show this help
  -v, --version                Show the version

Environment:
  REMOTEBROWSER_API_KEY        API key (required)
  REMOTEBROWSER_URL            Base URL of the Remote Browser API (required)

The CDP endpoint printed by "connect" needs the API key in the header
"Authorization: Bearer $REMOTEBROWSER_API_KEY".
`;

const OPTIONS = /** @type {const} */ ({
  'json': { type: 'boolean' },
  'help': { type: 'boolean', short: 'h' },
  'version': { type: 'boolean', short: 'v' },
  'name': { type: 'string' },
  'description': { type: 'string' },
  'os': { type: 'string' },
  'browser': { type: 'string' },
  'screen-resolution': { type: 'string' },
  'screen-scale': { type: 'string' },
  'webgl': { type: 'boolean' },
  'no-webgl': { type: 'boolean' },
  'proxy': { type: 'string' },
  'no-proxy': { type: 'boolean' },
  'wait': { type: 'boolean' }
});

const CREATE_OPTIONS = [
  'name',
  'description',
  'os',
  'browser',
  'screen-resolution',
  'screen-scale',
  'webgl',
  'no-webgl',
  'proxy',
  'wait'
];
const CONFIG_SET_OPTIONS = ['proxy', 'no-proxy'];

class UsageError extends Error {}

/**
 * Run the CLI.
 * @param {string[]} argv Arguments without the node and script paths.
 * @param {RunOptions} [options]
 * @returns {Promise<number>} The exit code.
 */
export async function run(
  argv,
  { stdout = process.stdout, stderr = process.stderr, clientOptions, pollInterval = 1000 } = {}
) {
  const out = (/** @type {string} */ text) => stdout.write(text + '\n');
  const err = (/** @type {string} */ text) => stderr.write(text + '\n');

  try {
    const { values, positionals } = parseCommandLine(argv);
    const [command, ...args] = positionals;

    if (values.version) {
      out(version());
      return 0;
    }
    if (values.help || !command || command === 'help') {
      out(USAGE.trimEnd());
      return 0;
    }

    /** @type {RemoteBrowser | undefined} */
    let client;
    /** @type {CliContext} */
    const ctx = {
      out,
      err,
      json: Boolean(values.json),
      client: () => (client ??= new RemoteBrowser(clientOptions))
    };

    const used = Object.keys(values).filter((key) => !['json', 'help', 'version'].includes(key));

    switch (command) {
      case 'create':
        checkOptions(command, used, CREATE_OPTIONS);
        checkArgs(command, args, 0, 0);
        await create(ctx, values, pollInterval);
        break;
      case 'list':
      case 'ls':
        checkOptions(command, used, []);
        checkArgs(command, args, 0, 0);
        await list(ctx);
        break;
      case 'get':
      case 'info':
        checkOptions(command, used, []);
        checkArgs(command, args, 1, 1);
        await get(ctx, args[0]);
        break;
      case 'delete':
      case 'rm':
      case 'suspend':
      case 'resume': {
        checkOptions(command, used, []);
        checkArgs(command, args, 1, Infinity);
        const method = command === 'rm' ? 'delete' : command;
        await changeStatus(ctx, method, args);
        break;
      }
      case 'connect':
        checkOptions(command, used, []);
        checkArgs(command, args, 1, 1);
        connect(ctx, args[0]);
        break;
      case 'config':
        await config(ctx, args, values, used);
        break;
      default:
        throw new UsageError(`unknown command "${command}"`);
    }
    return 0;
  } catch (error) {
    if (error instanceof UsageError) {
      err(`remotebrowser: ${error.message}`);
      err('Run "remotebrowser help" for usage.');
      return 2;
    }
    if (error instanceof RemoteBrowserError) {
      err(`remotebrowser: ${error.message}`);
      return 1;
    }
    throw error;
  }
}

/** @param {string[]} argv */
function parseCommandLine(argv) {
  try {
    return parseArgs({ args: argv, options: OPTIONS, allowPositionals: true, strict: true });
  } catch (error) {
    throw new UsageError(error instanceof Error ? error.message : String(error));
  }
}

/** @param {string} command @param {string[]} used @param {string[]} allowed */
function checkOptions(command, used, allowed) {
  const invalid = used.find((key) => !allowed.includes(key));
  if (invalid) throw new UsageError(`option --${invalid} is not valid for "${command}"`);
}

/** @param {string} command @param {string[]} args @param {number} min @param {number} max */
function checkArgs(command, args, min, max) {
  if (args.length < min) throw new UsageError(`"${command}" needs a browser id`);
  if (args.length > max) throw new UsageError(`too many arguments for "${command}"`);
}

/** @param {CliContext} ctx @param {unknown} data */
function printJson(ctx, data) {
  ctx.out(JSON.stringify(data, null, 2));
}

/** @param {CliContext} ctx @param {Record<string, unknown>} fields */
function printFields(ctx, fields) {
  const width = Math.max(...Object.keys(fields).map((key) => key.length));
  for (const [key, value] of Object.entries(fields)) {
    const text = value == null ? '-' : typeof value === 'string' ? value : JSON.stringify(value);
    ctx.out(`${(key + ':').padEnd(width + 1)} ${text}`);
  }
}

/**
 * @param {CliContext} ctx
 * @param {Record<string, string | boolean | undefined>} values
 * @param {number} pollInterval
 */
async function create(ctx, values, pollInterval) {
  if (values.webgl && values['no-webgl']) {
    throw new UsageError('--webgl and --no-webgl cannot be used together');
  }

  /** @type {import('./browsers.js').BrowserCreateParams} */
  const params = {};
  if (values.name !== undefined) params.name = String(values.name);
  if (values.description !== undefined) params.description = String(values.description);
  if (values.os !== undefined) params.os = String(values.os);
  if (values.browser !== undefined) {
    params.browser = /** @type {'chromium' | 'chrome'} */ (values.browser);
  }
  if (values['screen-resolution'] !== undefined) {
    params.screen_resolution = /** @type {'full-hd' | 'wuxga' | 'qhd' | '4k'} */ (values['screen-resolution']);
  }
  if (values['screen-scale'] !== undefined) {
    const scale = Number(values['screen-scale']);
    if (!Number.isInteger(scale)) throw new UsageError('--screen-scale must be a number');
    params.screen_scale = /** @type {100 | 125 | 150 | 175 | 200} */ (scale);
  }
  if (values.webgl) params.webgl = true;
  if (values['no-webgl']) params.webgl = false;
  if (values.proxy !== undefined) params.proxy = String(values.proxy);

  const client = ctx.client();
  let result = await client.browsers.create(params);

  if (values.wait) {
    while (result.status === 'starting') {
      await new Promise((resolve) => setTimeout(resolve, pollInterval));
      result = await client.browsers.retrieve(result.browser_id);
    }
    if (result.status !== 'running') {
      if (ctx.json) printJson(ctx, result);
      throw new RemoteBrowserError(`browser ${result.browser_id} is ${result.status}`);
    }
  }

  if (ctx.json) printJson(ctx, result);
  else ctx.out(result.browser_id);
}

/** @param {CliContext} ctx */
async function list(ctx) {
  const ids = await ctx.client().browsers.list();
  if (ctx.json) printJson(ctx, ids);
  else for (const id of ids) ctx.out(id);
}

/** @param {CliContext} ctx @param {string} id */
async function get(ctx, id) {
  const browser = await ctx.client().browsers.retrieve(id);
  if (ctx.json) {
    printJson(ctx, browser);
    return;
  }
  const { browser_id, status, description, os, creation_timestamp, ...rest } = browser;
  printFields(ctx, {
    id: browser_id,
    status,
    description: description || undefined,
    os,
    created: creation_timestamp == null ? undefined : new Date(creation_timestamp).toISOString(),
    ...rest
  });
}

/**
 * @param {CliContext} ctx
 * @param {'delete' | 'suspend' | 'resume'} method
 * @param {string[]} ids
 */
async function changeStatus(ctx, method, ids) {
  const client = ctx.client();
  const results = [];
  let failed = false;
  for (const id of ids) {
    try {
      const result = await client.browsers[method](id);
      results.push(result);
      if (!ctx.json) ctx.out(`${result.browser_id} ${result.status}`);
    } catch (error) {
      if (!(error instanceof RemoteBrowserError) || ids.length === 1) throw error;
      failed = true;
      ctx.err(`remotebrowser: ${id}: ${error.message}`);
    }
  }
  if (ctx.json) printJson(ctx, ids.length === 1 ? results[0] : results);
  if (failed) throw new RemoteBrowserError(`could not ${method} every browser`);
}

/** @param {CliContext} ctx @param {string} id */
function connect(ctx, id) {
  const url = ctx.client().browsers.connectUrl(id);
  if (ctx.json) printJson(ctx, { browser_id: id, url });
  else ctx.out(url);
}

/**
 * @param {CliContext} ctx
 * @param {string[]} args
 * @param {Record<string, string | boolean | undefined>} values
 * @param {string[]} used
 */
async function config(ctx, args, values, used) {
  const [sub, ...rest] = args;
  /** @type {import('./browsers.js').BrowserConfig} */
  let result;
  if (sub === 'get') {
    checkOptions('config get', used, []);
    checkArgs('config get', rest, 1, 1);
    result = await ctx.client().browsers.config.retrieve(rest[0]);
  } else if (sub === 'set') {
    checkOptions('config set', used, CONFIG_SET_OPTIONS);
    checkArgs('config set', rest, 1, 1);
    if (values.proxy !== undefined && values['no-proxy']) {
      throw new UsageError('--proxy and --no-proxy cannot be used together');
    }
    if (values.proxy === undefined && !values['no-proxy']) {
      throw new UsageError('"config set" needs --proxy <url> or --no-proxy');
    }
    const proxy = values['no-proxy'] ? null : String(values.proxy);
    result = await ctx.client().browsers.config.update(rest[0], { proxy });
  } else {
    throw new UsageError(sub ? `unknown config command "${sub}"` : '"config" needs "get" or "set"');
  }
  if (ctx.json) printJson(ctx, result);
  else printFields(ctx, { id: result.browser_id, proxy: result.proxy });
}

function version() {
  const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));
  return pkg.version;
}
