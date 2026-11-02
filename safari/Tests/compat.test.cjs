'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');

function load() {
  const context = vm.createContext({});
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../Support/safari-compat.js'), 'utf8'), context);
  return context.SafariPhotoShow;
}
function tasks(overrides = {}) {
  return { cancelTasks() {}, getImageObjectUrl() {}, revokeObjectUrls() {}, ...overrides };
}

test('image conversion returns the original result and forwards image options and job id', async () => {
  const api = load();
  const image = { src: 'https://example.test/image.jpg', flips: [1, 0], rotation: 90 };
  const result = { url: 'blob:extension/generated', type: 'image/png' };
  api.installImageTasks(tasks({ async getImageObjectUrl(actual, id) {
    assert.equal(actual, image);
    assert.equal(id, 'job-1');
    return result;
  } }));
  assert.equal(await api.runImageTask('GET_IMAGE_OBJECT_URL', image, 'job-1'), result);
});

test('cancel and revoke execute their original synchronous operations', async () => {
  const api = load();
  const cancelled = new Set();
  const remaining = new Set(['blob:a', 'blob:b']);
  api.installImageTasks(tasks({
    cancelTasks(ids) { for (const id of ids) cancelled.add(id); },
    revokeObjectUrls(urls) { for (const url of urls) remaining.delete(url); },
  }));
  assert.equal(await api.runImageTask('CANCEL_TASKS', ['job-1']), undefined);
  await api.runImageTask('REVOKE_OBJECT_URLS', ['blob:a']);
  assert.deepEqual([...cancelled], ['job-1']);
  assert.deepEqual([...remaining], ['blob:b']);
});

test('original image fetch and synchronous conversion failures remain failures', async () => {
  const api = load();
  const fetchError = new Error('HTTP_ERROR_STATUS_403');
  api.installImageTasks(tasks({ getImageObjectUrl() { return Promise.reject(fetchError); } }));
  await assert.rejects(api.runImageTask('GET_IMAGE_OBJECT_URL', {}), error => error === fetchError);
  const conversionError = new Error('Canvas conversion failed');
  api.installImageTasks(tasks({ getImageObjectUrl() { throw conversionError; } }));
  await assert.rejects(api.runImageTask('GET_IMAGE_OBJECT_URL', {}), error => error === conversionError);
});

test('unloaded, incomplete and unknown operations fail explicitly', async () => {
  const api = load();
  await assert.rejects(api.runImageTask('GET_IMAGE_OBJECT_URL', {}), /尚未加载/);
  assert.throws(() => api.installImageTasks({}), /不完整/);
  api.installImageTasks(tasks());
  await assert.rejects(api.runImageTask('UNKNOWN'), /不支持/);
  await assert.rejects(api.runImageTask('toString'), /不支持/);
});

function saveHarness({ size = 20, tabsError } = {}) {
  let listener, serial = 0;
  const opened = [], revoked = [], timers = new Map();
  const page = 'safari-web-extension://photoshow/safari/save.html';
  const context = vm.createContext({
    chrome: {
      runtime: { id: 'photoshow', getURL: relative => `safari-web-extension://photoshow/${relative}`, onMessage: { addListener: fn => { listener = fn; } } },
      tabs: { async create(value) { if (tabsError) throw tabsError; opened.push(value); return { id: 9 }; } },
    },
    crypto: { randomUUID: () => `00000000-0000-4000-8000-${String(++serial).padStart(12, '0')}` },
    URL: { revokeObjectURL: value => revoked.push(value) },
    fetch: async () => ({ ok: true, blob: async () => ({ type: 'image/png', size }) }),
    FileReader: class { readAsDataURL() { this.result = 'data:image/png;base64,YQ=='; this.onload(); } },
    setTimeout: fn => { const key = Symbol(); timers.set(key, fn); return key; },
    clearTimeout: key => timers.delete(key),
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../Support/safari-compat.js'), 'utf8'), context);
  const api = context.SafariPhotoShow;
  api.installImageTasks(tasks({ getImageObjectUrl(image) { return { url: image.src, type: 'image/png' }; } }));
  return {
    api, opened, revoked, timers,
    async own(url) { await api.runImageTask('GET_IMAGE_OBJECT_URL', { src: url }); },
    claim(id, sender = { id: 'photoshow', url: page }) {
      let reply;
      listener({ cmd: 'PHOTOSHOW_SAFARI_CLAIM_SAVE', id }, sender, value => { reply = value; });
      return reply;
    },
  };
}

test('save payload is one-use, sender-restricted, filename-only and releases background URL', async () => {
  const h = saveHarness();
  await assert.rejects(h.api.openSaveBlob({ url: 'blob:unowned' }), /只能保存/);
  await h.own('blob:owned');
  const result = await h.api.openSaveBlob({ url: 'blob:owned', filename: '../private/picture.png' });
  assert.equal(result.opened, true);
  assert.equal(result.saved, undefined);
  const id = h.opened[0].url.split('#')[1];
  assert.equal(h.claim(id, { url: 'https://example.test/' }).success, false);
  assert.equal(h.claim(id, { id: 'other', url: 'safari-web-extension://photoshow/safari/save.html' }).success, false);
  const claimed = h.claim(id);
  assert.equal(claimed.success, true);
  assert.equal(claimed.filename, 'picture.png');
  assert.equal(claimed.dataUrl, 'data:image/png;base64,YQ==');
  assert.deepEqual(h.revoked, ['blob:owned']);
  assert.equal(h.timers.size, 0);
  assert.equal(h.claim(id).success, false);
});

test('save timeout and pending task limit release resources', async () => {
  const h = saveHarness();
  for (let i = 0; i < 5; i++) await h.own(`blob:${i}`);
  for (let i = 0; i < 4; i++) await h.api.openSaveBlob({ url: `blob:${i}` });
  await assert.rejects(h.api.openSaveBlob({ url: 'blob:4' }), /过多/);
  const id = h.opened[0].url.split('#')[1];
  [...h.timers.values()][0]();
  assert.equal(h.claim(id).success, false);
  assert.ok(h.revoked.includes('blob:0'));
  assert.ok(h.revoked.includes('blob:4'));
});

test('oversize files and failed tab opening reject and release owned URLs', async () => {
  const large = saveHarness({ size: 33 * 1024 * 1024 });
  await large.own('blob:large');
  await assert.rejects(large.api.openSaveBlob({ url: 'blob:large' }), /32 MB/);
  assert.equal(large.opened.length, 0);
  assert.deepEqual(large.revoked, ['blob:large']);
  assert.equal(large.timers.size, 0);
  const failure = new Error('Tab creation denied');
  const failed = saveHarness({ tabsError: failure });
  await failed.own('blob:failed');
  await assert.rejects(failed.api.openSaveBlob({ url: 'blob:failed' }), error => error === failure);
  assert.deepEqual(failed.revoked, ['blob:failed']);
  assert.equal(failed.timers.size, 0);
});

test('settings export may save another extension page blob but never a website blob', async () => {
  const h = saveHarness();
  await assert.rejects(h.api.openSaveBlob({ url: 'https://example.test/file' }), /只能保存/);
  await assert.rejects(h.api.openSaveBlob({ url: 'blob:https://example.test/file' }), /只能保存/);
  await assert.rejects(h.api.openSaveBlob({ url: 'blob:safari-web-extension://photoshow-other/file' }), /只能保存/);
  const url = 'blob:safari-web-extension://photoshow/options-export';
  await h.api.openSaveBlob({ url, filename: 'settings.json' });
  const result = h.claim(h.opened[0].url.split('#')[1]);
  assert.equal(result.success, true);
  assert.equal(result.filename, 'settings.json');
  assert.deepEqual(h.revoked, [url]);
});

test('Safari background permission initialization tolerates Safari-only manifest', () => {
  const source = fs.readFileSync(path.join(__dirname, '../WebExtension/background/background.js'), 'utf8');
  const match = source.match(/const wo=(chrome\.runtime\.getManifest\(\).*?),vo=/);
  assert.ok(match, 'locate the actual background initialization expression');
  for (const manifest of [{ browser_specific_settings: { safari: { strict_min_version: '26.0' } } }, {}]) {
    const result = vm.runInNewContext(match[1], { chrome: { runtime: { getManifest: () => manifest } } });
    assert.deepEqual(Array.from(result), []);
  }
});

function loadSiteCheck(executeScript) {
  const source = fs.readFileSync(path.join(__dirname, '../WebExtension/background/background.js'), 'utf8');
  const start = source.indexOf('checkSite(e,t,r=0){');
  const end = source.indexOf(',activateTab(', start);
  assert.ok(start > 0 && end > start);
  return vm.runInNewContext(`({${source.slice(start, end)}})`, {
    URL, Promise, console,
    chrome: { permissions: { contains: async () => false }, scripting: { executeScript } },
    ji: new Map(), An: 'UNAVAILABLE', xn: 'NO_ACCESS', _n: 'UNKNOWN',
    Mo: () => false, no: promise => promise,
    Hn: url => new URL(url).hostname,
    Pi: { getSiteSettingsFilenamesByDomains: host => [host] }, Di: ['x.com'],
  }).checkSite;
}

test('successful Safari page probe takes precedence over negative permission lookup', async () => {
  const check = loadSiteCheck(async () => [{ frameId: 0, result: true }]);
  assert.equal(await check(1, 'https://x.com/home'), 'x.com');
});

test('Safari permission revocation is not hidden by cached page access', async () => {
  let denied = false;
  const check = loadSiteCheck(async () => {
    if (denied) throw new Error('The extension does not have access to this tab.');
    return [{ frameId: 0, result: true }];
  });
  assert.equal(await check(1, 'https://x.com/home'), 'x.com');
  denied = true;
  assert.equal(await check(1, 'https://x.com/home'), 'NO_ACCESS');
});

test('non-permission probe errors and unsupported pages are not called permission denial', async () => {
  const crashed = loadSiteCheck(async () => { throw new Error('The tab was closed.'); });
  assert.equal(await crashed(1, 'https://x.com/home'), 'UNAVAILABLE');
  const svg = loadSiteCheck(async () => [{ frameId: 0, result: { error: 'SVG_DOCUMENT' } }]);
  assert.equal(await svg(1, 'https://x.com/image.svg'), 'UNAVAILABLE');
  const empty = loadSiteCheck(async () => []);
  assert.equal(await empty(1, 'https://x.com/home'), 'UNAVAILABLE');
  assert.equal(await empty(1, 'safari://settings'), 'UNAVAILABLE');
});

test('popup does not present a missing background reply as missing website permission', async () => {
  const source = fs.readFileSync(path.join(__dirname, '../WebExtension/popup/popup.js'), 'utf8');
  const start = source.indexOf('function To(){');
  const end = source.indexOf('function _o()', start);
  const state = { textContent: '' };
  const attributes = {};
  const element = { classList: { add() {}, remove() {} }, setAttribute(key, value) { attributes[key] = value; } };
  const refresh = vm.runInNewContext(`(${source.slice(start, end)})`, {
    Promise, yo: { id: 1, url: 'https://x.com/home', windowId: 1 },
    jn: async () => undefined, Oo() {}, Ao() {}, xo: false,
    uo: state, lo: element, wo: element, fo: element, po: element, An: key => key,
  });
  await refresh();
  assert.match(state.textContent, /后台未响应/);
  assert.doesNotMatch(state.textContent, /photoShowNoAccessMsg/);
  assert.match(attributes.title, /并非网站授权结果/);
});

function loadClipboard(sendMessage) {
  return vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../Support/clipboard-copy.js'), 'utf8') + '\nOo', {
    chrome: { runtime: { sendMessage } },
    FileReader: class {
      readAsDataURL(blob) { this.result = `data:image/png;base64,${blob.base64}`; this.onload(); }
    },
  });
}

test('Safari image copy sends original PNG bytes without requesting browser clipboard permission', async () => {
  const calls = [];
  const copy = loadClipboard(async message => { calls.push(message); return { success: true }; });
  await copy({ type: 'image/png', size: 5, base64: 'aGVsbG8=' });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].cmd, 'PHOTOSHOW_SAFARI_COPY');
  assert.equal(calls[0].data.png, 'aGVsbG8=');
});

test('Safari copy reports native write failure and preserves text copy variants', async () => {
  await assert.rejects(loadClipboard(async () => ({ success: false, error: 'CLIPBOARD_WRITE_FAILED' }))('caption'), /CLIPBOARD_WRITE_FAILED/);
  await assert.rejects(loadClipboard(async () => undefined)('caption'), /SAFARI_CLIPBOARD_WRITE_FAILED/);
  const copy = loadClipboard(async message => {
    assert.equal(message.data.text, 'https://example.test/full.png');
    return { success: true };
  });
  await copy('https://example.test/full.png');
  await assert.rejects(copy({ type: 'image/png', size: 33 * 1024 * 1024 }), /TOO_LARGE/);
});

test('native clipboard relay accepts only its own extension and propagates native results', async () => {
  const listeners = [];
  let nativeCalls = 0;
  const context = vm.createContext({ chrome: { runtime: {
    id: 'photoshow', onMessage: { addListener(fn) { listeners.push(fn); } },
    async sendNativeMessage(app, payload) {
      nativeCalls++;
      assert.equal(app, 'com.anaheim.photoshow.safari');
      assert.equal(payload.command, 'copy');
      return { success: false, error: 'CLIPBOARD_WRITE_FAILED' };
    },
  } } });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../Support/safari-compat.js'), 'utf8'), context);
  const message = { cmd: 'PHOTOSHOW_SAFARI_COPY', data: { png: 'aGVsbG8=' } };
  const invoke = sender => new Promise(resolve => listeners[0](message, sender, resolve));
  assert.equal((await invoke({ id: 'foreign' })).error, 'INVALID_CLIPBOARD_SENDER');
  assert.equal(nativeCalls, 0);
  assert.equal((await invoke({ id: 'photoshow' })).error, 'CLIPBOARD_WRITE_FAILED');
  assert.equal(nativeCalls, 1);
});

function loadNavigationHandler() {
  const source = fs.readFileSync(path.join(__dirname, '../WebExtension/background/background.js'), 'utf8');
  const start = source.indexOf('chrome.webNavigation.onCommitted.addListener(');
  const end = source.indexOf('chrome.tabs.onActivated', start);
  assert.ok(start >= 0 && end > start);
  let listener;
  const injected = [], updated = [];
  vm.runInNewContext(source.slice(start, end).replace(/,$/, ';'), {
    chrome: { webNavigation: { onCommitted: { addListener(fn) { listener = fn; } } } },
    _i: { get() {} }, Co: {}, Hn: url => new URL(url).hostname,
    qo: { insert(...args) { injected.push(args); return Promise.resolve(); } },
    photoShow: { updateTabState(tabId) { updated.push(tabId); } },
  });
  return { listener, injected, updated };
}

test('Safari navigation without Chromium-only metadata still injects PhotoShow', async () => {
  const state = loadNavigationHandler();
  state.listener({ frameId: 0, tabId: 7, url: 'https://example.test/images' });
  await new Promise(setImmediate);
  assert.equal(state.injected.length, 1);
  assert.deepEqual(Array.from(state.injected[0]), [7, 0, 'https://example.test/images', 'WEB_NAVIGATION_ON_COMMITTED']);
  assert.deepEqual(state.updated, [7]);
});

test('explicit non-active documents remain excluded from navigation injection', async () => {
  const state = loadNavigationHandler();
  state.listener({ documentLifecycle: 'prerender', frameId: 0, tabId: 7, transitionQualifiers: [], url: 'https://example.test/images' });
  await new Promise(setImmediate);
  assert.equal(state.injected.length, 0);
  assert.equal(state.updated.length, 0);
});

test('background startup survives a failing webRequest tracker init', () => {
  const source = fs.readFileSync(path.join(__dirname, '../WebExtension/background/background.js'), 'utf8');
  assert.ok(!source.includes(',Ci.init(),'), 'unguarded tracker init must not remain in the startup sequence');
  const match = source.match(/\(\(\)=>\{try\{Ci\.init\(\)\}catch\{\}\}\)\(\)/);
  assert.ok(match, 'locate the actual guarded tracker init expression');
  vm.runInNewContext(match[0], { Ci: { init() { throw new TypeError("Cannot read properties of undefined (reading 'onHeadersReceived')"); } } });
  let calls = 0;
  vm.runInNewContext(match[0], { Ci: { init() { calls += 1; } } });
  assert.equal(calls, 1, 'a working tracker init still runs exactly once');
});

test('background startup survives a missing windows focus event', () => {
  const source = fs.readFileSync(path.join(__dirname, '../WebExtension/background/background.js'), 'utf8');
  assert.ok(!source.includes('chrome.windows.onFocusChanged.addListener('), 'unguarded focus listener must not remain');
  const match = source.match(/chrome\.windows\?\.onFocusChanged\?\.addListener\(/);
  assert.ok(match, 'locate the actual guarded focus listener registration');
  vm.runInNewContext('chrome.windows?.onFocusChanged?.addListener(() => {})', { chrome: {} });
  vm.runInNewContext('chrome.windows?.onFocusChanged?.addListener(() => {})', { chrome: { windows: {} } });
  let registered = null;
  vm.runInNewContext('chrome.windows?.onFocusChanged?.addListener(fn)', {
    fn() {},
    chrome: { windows: { onFocusChanged: { addListener(fn) { registered = fn; } } } },
  });
  assert.equal(typeof registered, 'function', 'a present focus event still receives the listener');
  assert.ok(source.includes('(chrome.windows?.getAll()??Promise.resolve([]))'), 'getAll call is guarded with an empty-window fallback');
});

test.skip('RegExp diagnostic logs the rejected pattern and leaves valid patterns untouched', () => {
  const logs = [];
  const context = vm.createContext({ console: { error: (...args) => logs.push(args.join(' ')) } });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../Support/safari-compat.js'), 'utf8'), context);
  assert.throws(
    () => vm.runInContext("new RegExp('[z-a]')", context),
    (error) => /Invalid regular expression/.test(error.message)
      && error.message.includes('[PhotoShow diagnostic] pattern="[z-a]"'),
    'an invalid dynamically built pattern still throws, with the pattern appended to the message',
  );
  assert.equal(logs.length, 1, 'the rejection is logged exactly once');
  assert.ok(logs[0].includes('[PhotoShow regex diagnostic]'), 'log line carries the diagnostic marker');
  assert.ok(logs[0].includes('[z-a]'), 'log line names the offending pattern');
  const matched = vm.runInContext("'abc123'.replace(new RegExp('(\\\\d+)'), '[$1]') + '|' + RegExp.$1", context);
  assert.equal(matched, 'abc[123]|123', 'valid patterns, replace and RegExp.$1 keep working through the wrapper');
  const instance = vm.runInContext("new RegExp('a+') instanceof RegExp", context);
  assert.equal(instance, true, 'constructed patterns remain RegExp instances');
});

test.skip('background startup stage markers are injected in evaluation order', () => {
  const source = fs.readFileSync(path.join(__dirname, '../WebExtension/background/background.js'), 'utf8');
  const stages = ['corejs', 'utils', 'store', 'helpers', 'configs', 'menus', 'download', 'webrequest', 'sites', 'pre-tools'];
  let previous = -1;
  for (const stage of stages) {
    const marker = `globalThis.__psStage="${stage}"`;
    const index = source.indexOf(marker);
    assert.ok(index > previous, `stage marker ${stage} is present after the previous marker`);
    assert.equal(source.indexOf(marker, index + 1), -1, `stage marker ${stage} appears exactly once`);
    previous = index;
  }
});

test.skip('background error trap records the last stage and the error position', () => {
  let handler;
  const context = vm.createContext({ addEventListener: (type, fn) => { if (type === 'error') handler = fn; } });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../Support/safari-compat.js'), 'utf8'), context);
  assert.equal(context.__psStage, 'compat-loaded', 'compat marks its own load as the first stage');
  assert.equal(context.__psError, null, 'no error is recorded before anything fails');
  assert.equal(typeof handler, 'function', 'the error trap is registered before the background scripts run');
  context.__psStage = 'utils';
  handler({ message: 'Invalid regular expression: range out of order in character class', filename: 'background.js', lineno: 1, colno: 71591, error: { message: 'Invalid regular expression: range out of order in character class', stack: 'global code@background.js:1:71591' } });
  assert.equal(context.__psError.stage, 'utils', 'the trap keeps the stage reached before the failure');
  assert.equal(context.__psError.colno, 71591, 'the trap keeps the failing column for source lookup');
  assert.ok(context.__psError.message.includes('range out of order'), 'the trap keeps the original message');
});

test.skip('regex probe scripts isolate every background literal in manifest order', () => {
  const web = path.join(__dirname, '../WebExtension');
  const manifest = JSON.parse(fs.readFileSync(path.join(web, 'manifest.json'), 'utf8'));
  const scripts = manifest.background.scripts;
  assert.equal(scripts[0], 'safari/safari-compat.js');
  assert.equal(scripts[1], 'background/offscreen.js');
  assert.equal(scripts[scripts.length - 1], 'background/background.js');
  const probes = scripts.slice(2, -1);
  assert.equal(probes.length, 87, 'one probe script per background regex literal');
  probes.forEach((entry, i) => {
    assert.equal(entry, `safari/probe/p${String(i).padStart(3, '0')}.js`);
    const source = fs.readFileSync(path.join(web, entry), 'utf8');
    assert.ok(source.startsWith('"use strict";\nvoid (/'), 'probe isolates a single literal');
    new vm.Script(source);
  });
});

test('generated extension scripts are ASCII-only, parse, and keep their text', () => {
  const web = path.join(__dirname, '../WebExtension');
  const manifest = JSON.parse(fs.readFileSync(path.join(web, 'manifest.json'), 'utf8'));
  assert.deepEqual(manifest.background.scripts, ['safari/safari-compat.js', 'background/offscreen.js', 'background/background.js'], 'temporary probe scripts are gone');
  for (const rel of ['background/background.js', 'background/offscreen.js', 'safari/safari-compat.js', 'content/content.js', 'popup/popup.js', 'options/options.js']) {
    const source = fs.readFileSync(path.join(web, rel), 'utf8');
    assert.ok(/^[\x00-\x7F]*$/.test(source), `${rel} ships as pure ASCII so Safari's legacy-encoding decoding cannot mangle it`);
    new vm.Script(source);
  }
  const background = fs.readFileSync(path.join(web, 'background/background.js'), 'utf8');
  assert.ok(!background.includes('__psStage'), 'temporary stage markers are gone');
  const probe = vm.runInNewContext("const Fn = (e) => e.replace(/\\s*[(\\uFF08]\\s*[)\\uFF09]\\s*/g, ''); Fn('a( )b')", {});
  assert.equal(probe, 'ab', 'escaped full-width parenthesis pattern still strips empty parentheses');
});

test('analytics sender is neutralized and the webRequest permission is kept', () => {
  const web = path.join(__dirname, '../WebExtension');
  const background = fs.readFileSync(path.join(web, 'background/background.js'), 'utf8');
  assert.ok(background.includes('function So(){return Promise.resolve()}'), 'analytics sender body is a no-op');
  assert.ok(!background.includes('mp/collect') && !background.includes('measurement_id'), 'Google Analytics collect endpoint is gone');
  const manifest = JSON.parse(fs.readFileSync(path.join(web, 'manifest.json'), 'utf8'));
  assert.ok(manifest.permissions.includes('webRequest'), 'webRequest permission is requested (redirect tracker feeds image info)');
});

test('only Chinese and English locales ship', () => {
  const locales = fs.readdirSync(path.join(__dirname, '../WebExtension/_locales')).sort();
  assert.deepEqual(locales, ['en', 'zh_CN', 'zh_TW']);
});

