#!/usr/bin/env python3
"""Version-checked Safari port of the user's PhotoShow 4.93.2 package."""
import hashlib
import json
import re
import shutil
import zipfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
PROJECT = HERE / 'Project/PhotoShow Safari'
WEB = HERE / 'WebExtension'
archive = ROOT / 'photoshow.zip'
# Extract into a clean tree: files removed upstream must not linger here and
# silently ship in every later build.
shutil.rmtree(WEB, ignore_errors=True)
WEB.mkdir(parents=True)
with zipfile.ZipFile(archive) as z:
    assert json.loads(z.read('manifest.json'))['version'] == '4.93.2', 'Recheck patches before updating PhotoShow'
    for name in z.namelist():
        assert not name.startswith('/') and '..' not in Path(name).parts
        if not name.startswith('_metadata/'):
            z.extract(name, WEB)

# This port targets Chinese/English UIs; the other locales only add weight.
for locale_dir in (WEB / '_locales').iterdir():
    if locale_dir.is_dir() and locale_dir.name not in ('en', 'zh_CN', 'zh_TW'):
        shutil.rmtree(locale_dir)

def replace_once(value, old, new):
    assert value.count(old) == 1, f'Expected one patch target: {old[:90]}'
    return value.replace(old, new)



manifest = json.loads((WEB / 'manifest.json').read_text())
for key in ('update_url', 'minimum_chrome_version'):
    manifest.pop(key, None)
manifest['background'] = {'scripts': ['safari/safari-compat.js', 'background/offscreen.js', 'background/background.js'], 'persistent': False}
manifest['permissions'] = [x for x in manifest['permissions'] if x not in ('offscreen', 'favicon', 'publicSuffix', 'downloads')]
manifest['version'] = '4.93.2.13'
manifest['version_name'] = '4.93.2 Safari 13'
manifest['permissions'].append('nativeMessaging')
manifest['browser_specific_settings'] = {'safari': {'strict_min_version': '26.0'}}
for entry in manifest.get('web_accessible_resources', []):
    entry.pop('use_dynamic_url', None)
(WEB / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n')
(WEB / 'safari').mkdir(exist_ok=True)
shutil.copy2(HERE / 'Support/safari-compat.js', WEB / 'safari/safari-compat.js')
for name in ('save.html', 'save.js', 'save.css'):
    shutil.copy2(HERE / 'Support' / name, WEB / 'safari' / name)


path = WEB / 'background/offscreen.js'
value = path.read_text()
marker = 'chrome.runtime.onMessage.addListener('
assert value.count(marker) == 1 and value.endswith('})();')
value = value[:value.index(marker)] + 'globalThis.SafariPhotoShow.installImageTasks(Ne);})();'
path.write_text(value)

path = WEB / 'background/background.js'
value = path.read_text()
# Safari adds browser_specific_settings.safari, but has no Firefox gecko block.
# The upstream partial optional chain throws before runtime handlers register.
value = replace_once(value, 'browser_specific_settings?.gecko.data_collection_permissions.optional',
                     'browser_specific_settings?.gecko?.data_collection_permissions?.optional')
start = value.index('function Ao(e,...t){')
end = value.index('let _o=null,To=null;', start)
value = value[:start] + 'function Ao(e,...t){return globalThis.SafariPhotoShow.runImageTask(e,...t)}' + value[end:]
value = replace_once(value, 'init:()=>go.get("blobUrls").then(e=>{Array.isArray(e)&&(_o=new Map(e))})', 'init:()=>go.remove("blobUrls").then(()=>{_o=new Map})')
# Safari navigation events omit Chromium transition/lifecycle metadata.
# Missing lifecycle is an ordinary committed document, not prerender.
value = replace_once(value,
    '({documentLifecycle:e,frameId:t,parentFrameId:r,tabId:n,transitionQualifiers:o,transitionType:i,url:a})=>',
    '({documentLifecycle:e="active",frameId:t,parentFrameId:r,tabId:n,transitionQualifiers:o=[],transitionType:i,url:a})=>')
# The webRequest redirect tracker only pre-fills save filenames. Its init sits
# in the middle of the startup registration sequence; if the namespace is ever
# unavailable, an unguarded throw aborts every registration after it (the same
# failure shape as the Build 2 and Build 5 startup bugs).
value = replace_once(value, ',Ci.init(),chrome.commands.onCommand.addListener(',
                     ',(()=>{try{Ci.init()}catch{}})(),chrome.commands.onCommand.addListener(')
# A missing focus event must not abort listener registration either.
value = replace_once(value, 'chrome.windows.onFocusChanged.addListener(', 'chrome.windows?.onFocusChanged?.addListener(')
# executeForAllActiveTabs runs when the extension (re)activates; a missing
# windows namespace must degrade to "no windows", not a synchronous throw.
value = replace_once(value, 'chrome.windows.getAll()', '(chrome.windows?.getAll()??Promise.resolve([]))')
value = replace_once(value, 'chrome.action.setBadgeTextColor(', 'chrome.action.setBadgeTextColor?.(')
value = replace_once(value, 'chrome.action.setBadgeBackgroundColor(', 'chrome.action.setBadgeBackgroundColor?.(')
value = value.replace('chrome.runtime.OnInstalledReason.INSTALL', '"install"').replace('chrome.runtime.OnInstalledReason.UPDATE', '"update"')
# Check actual frame access instead of inferring it from the host-permission list.
start = value.index('checkSite(e,t,r=0){')
end = value.index(',activateTab(', start)
site_check = (HERE / 'Support/site-check.js').read_text()
site_check = site_check[site_check.index('function checkSite'):].removeprefix('function ').strip()
value = value[:start] + site_check + value[end:]
value = replace_once(value,
    'chrome.permissions.contains({origins:[new URL("/*",t).href]}).then(t=>!t&&qo.removeFromAllFrames(e))',
    'photoShow.checkSite(e,t).then(t=>Tn.includes(t)&&qo.removeFromAllFrames(e))')

# WebKit cannot modify response headers; don't register an unsupported rule.
start = value.index('yi=[{name:"removeHeaderCORP"')
end = value.index('{name:"instagramApiUserAgent"', start)
value = value[:start] + 'yi=[' + value[end:]
# Safari has no downloads API. Preserve image preparation and hand off the result
# to a real extension page where a user click starts Safari's own save flow.
start = value.index('vi={init(){chrome.downloads.onChanged')
end = value.index(',yi=[', start)
value = value[:start] + '''vi={init(){},cancel(e){return Ao("CANCEL_TASKS",e)},download(e={},{downloadId:t}={}){if(!e?.src)return Promise.resolve();return gi(e).then(({base:r,extension:n})=>Ao("GET_IMAGE_OBJECT_URL",{...e,flips:Co.has(e.src)?null:e.flips,format:n,rotation:Co.has(e.src)?null:e.rotation},t??crypto.randomUUID()).then(({type:e,url:t})=>this.downloadBlob({url:t,filename:r.replace("<BLOB_URL>",t.split("/").at(-1))+"."+(Bn(e)||n||"png")})))},downloadBlob:e=>globalThis.SafariPhotoShow.openSaveBlob(e),remove(){}}''' + value[end:]
value = value.replace('e?.ShadowRoot||null', 'e?.shadowRoot||e?.ShadowRoot||null')
value = replace_once(value, 't.staticRulesetId&&chrome.declarativeNetRequest.updateEnabledRulesets(', 't.staticRulesetId&&chrome.runtime.getManifest().declarative_net_request.rule_resources.some(e=>e.id===t.staticRulesetId)&&chrome.declarativeNetRequest.updateEnabledRulesets(')
# This port is for personal use. The upstream analytics sender posts usage
# events to Google Analytics (measurement protocol, hardcoded secret) after
# an IP/geolocation lookup; usage-data consent already defaults to off, and
# the sender is dead weight plus a privacy leak. Replace its body with a
# no-op — its only caller fire-and-forgets the returned promise.
start = value.index('function So(e){')
end = value.index('const Eo={', start)
assert 'google-analytics.com' in value[start:end], 'Recheck the analytics sender before replacing it'
value = value[:start] + 'function So(){return Promise.resolve()}' + value[end:]
path.write_text(value)

path = WEB / 'content/content.js'
value = path.read_text().replace('e?.ShadowRoot||null', 'e?.shadowRoot||e?.ShadowRoot||null')
start = value.index('function Oo(e){')
end = value.index('function Mo(e)', start)
value = value[:start] + (HERE / 'Support/clipboard-copy.js').read_text() + value[end:]
path.write_text(value)
path = WEB / 'popup/popup.js'
value = replace_once(path.read_text(), 'chrome.action.getUserSettings()', '(chrome.action.getUserSettings?.()??Promise.resolve({}))')
# Zoom affects only popup typography; a missing API should not prevent popup startup.
value = replace_once(value, 'chrome.tabs.getZoom()', '(chrome.tabs.getZoom?.()??Promise.resolve(undefined))')
# Missing background replies used to fall through to the NO_ACCESS branch.
value = replace_once(value, 'const{hasAccess:t,hasReadPopupPrompt:r,',
    'if(!e||typeof e.hasAccess!=="boolean"){Oo();uo.textContent="PhotoShow 后台未响应，请关闭再启用扩展并刷新网页。";lo.setAttribute("title","后台连接失败，并非网站授权结果");return}const{hasAccess:t,hasReadPopupPrompt:r,')
path.write_text(value)
# Chrome's internal favicon endpoint doesn't exist in Safari. Use the packaged icon
# when a saved site favicon is unavailable, without contacting a favicon service.
path = WEB / 'options/options.js'
path.write_text(replace_once(path.read_text(), 'chrome.runtime.getURL("/_favicon")', 'chrome.runtime.getURL("resources/icon32.png")'))

omitted = []
for path in (WEB / 'net-request-rule-sets').glob('*.json'):
    rules = json.loads(path.read_text())
    allowed = []
    for rule in rules:
        if 'responseHeaders' in rule.get('action', {}) or 'responseHeaders' in rule.get('condition', {}):
            omitted.append({'file': path.name, 'id': rule['id']})
        else:
            allowed.append(rule)
    path.write_text(json.dumps(allowed, separators=(',', ':')) + '\n')
manifest['declarative_net_request']['rule_resources'] = [entry for entry in manifest['declarative_net_request']['rule_resources'] if json.loads((WEB / entry['path']).read_text())]
(WEB / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n')
(HERE / 'port-info.json').write_text(json.dumps({'source_version':'4.93.2','safari_version':'4.93.2.13','source_sha256':hashlib.sha256(archive.read_bytes()).hexdigest(),'minimum_safari':'26.0','omitted_response_header_rules':omitted},indent=2)+'\n')

# Safari decodes extension scripts with the system legacy encoding (GBK on
# zh-Hans systems), not UTF-8. Multibyte characters are then misread, and
# their trailing bytes swallow structural ASCII (\, ]) inside regex literals,
# which killed the background page at parse time ("range out of order in
# character class", Builds 6-10). Ship every script as pure ASCII, escaping
# each non-ASCII character as \uXXXX; the resulting strings and patterns are
# character-for-character identical when parsed.
def ascii_escape_js(text):
    out = []
    for ch in text:
        code = ord(ch)
        if code < 128:
            out.append(ch)
        elif code <= 0xFFFF:
            out.append(f'\\u{code:04x}')
        else:
            code -= 0x10000
            out.append(f'\\u{0xD800 + (code >> 10):04x}\\u{0xDC00 + (code & 0x3FF):04x}')
    return ''.join(out)

for path in WEB.rglob('*.js'):
    escaped = ascii_escape_js(path.read_text())
    assert escaped.isascii(), f'Non-ASCII survived escaping in {path}'
    path.write_text(escaped)

if PROJECT.exists():
    resources = PROJECT / 'PhotoShow Safari Extension/Resources'
    shutil.copy2(HERE / 'Support/SafariWebExtensionHandler.swift', PROJECT / 'PhotoShow Safari Extension/SafariWebExtensionHandler.swift')
    for item in WEB.iterdir():
        if item.is_dir():
            target = resources / item.name
            # copytree never deletes: prune payload files that no longer exist
            # in WebExtension so removed resources cannot ship forever.
            if target.exists():
                keep = {str(p.relative_to(item)) for p in item.rglob('*') if p.is_file()}
                for old in target.rglob('*'):
                    if old.is_file() and str(old.relative_to(target)) not in keep:
                        old.unlink()
            shutil.copytree(item, target, dirs_exist_ok=True)
        else:
            shutil.copy2(item, resources / item.name)
    app = PROJECT / 'PhotoShow Safari'
    shutil.copy2(HERE / 'Support/App/ViewController.swift', app / 'ViewController.swift')
    for name in ('Script.js', 'Style.css'):
        shutil.copy2(HERE / 'Support/App' / name, app / 'Resources' / name)
    shutil.copy2(HERE / 'Support/App/Main.html', app / 'Resources/Base.lproj/Main.html')
    shutil.copy2(WEB / 'resources/icon128.png', app / 'Resources/Icon.png')
    storyboard = app / 'Base.lproj/Main.storyboard'
    layout = storyboard.read_text().replace('width="425" height="325"', 'width="640" height="600"')
    layout = layout.replace('titled="YES" closable="YES"/>', 'titled="YES" closable="YES" miniaturizable="YES" resizable="YES"/>')
    storyboard.write_text(layout)
    pbx = PROJECT / 'PhotoShow Safari.xcodeproj/project.pbxproj'
    value = pbx.read_text()
    value = re.sub(r'MACOSX_DEPLOYMENT_TARGET = [^;]+;', 'MACOSX_DEPLOYMENT_TARGET = 14.0;', value)
    value = value.replace('"com.anaheim.photoshow.PhotoShow-Safari"', 'com.anaheim.photoshow.safari')
    value = value.replace('INFOPLIST_KEY_CFBundleDisplayName = "PhotoShow Safari Extension";', 'INFOPLIST_KEY_CFBundleDisplayName = "PhotoShow · Safari 本机版";')
    value = re.sub(r'ENABLE_USER_SELECTED_FILES = [^;]+;', 'ENABLE_USER_SELECTED_FILES = NO;', value)
    value = value.replace('SWIFT_DEFAULT_ACTOR_ISOLATION = MainActor;', 'SWIFT_DEFAULT_ACTOR_ISOLATION = nonisolated;')
    def tune(match):
        block = match.group(0)
        if 'PRODUCT_BUNDLE_IDENTIFIER' not in block:
            return block
        is_extension = 'com.anaheim.photoshow.safari.Extension' in block
        block = re.sub(r'\n\s*(CODE_SIGN_ENTITLEMENTS|CODE_SIGN_INJECT_BASE_ENTITLEMENTS|ENABLE_OUTGOING_NETWORK_CONNECTIONS|MARKETING_VERSION|CURRENT_PROJECT_VERSION) = [^;]+;', '', block)
        entitlement = 'Extension' if is_extension else 'App'
        additions = f'\n\t\t\t\tCODE_SIGN_ENTITLEMENTS = "../../Support/{entitlement}.entitlements";\n\t\t\t\tCODE_SIGN_INJECT_BASE_ENTITLEMENTS = NO;\n\t\t\t\tMARKETING_VERSION = 4.93.2;\n\t\t\t\tCURRENT_PROJECT_VERSION = 13;'
        if not is_extension:
            additions += '\n\t\t\t\tENABLE_OUTGOING_NETWORK_CONNECTIONS = YES;'
        return block.replace('buildSettings = {', 'buildSettings = {' + additions)
    value = re.sub(r'buildSettings = \{.*?\n\t\t\t\};', tune, value, flags=re.S)
    pbx.write_text(value)
print('PhotoShow Safari resources prepared (4.93.2.13).')
