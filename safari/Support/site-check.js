// Replacement method for PhotoShow's Safari build; the short identifiers refer
// to existing state constants and site matching helpers in background.js.
function checkSite(e,t,r=0){
  let url;
  try { url = new URL(t); } catch { return Promise.resolve(An); }
  if (!/^https?:$/.test(url.protocol) || (r && Mo(t))) return Promise.resolve(An);
  // Let Safari enforce website permission on the actual operation. A separate
  // permissions.contains() preflight must not suppress a successful page probe.
  // Recheck each time: access can change without an extension permission event.
  return no(Promise.resolve().then(() => chrome.scripting.executeScript({
    target: {tabId:e, frameIds:[r]},
    func: () => document.contentType !== 'image/svg+xml' &&
      document.documentElement?.namespaceURI !== 'http://www.w3.org/2000/svg',
    injectImmediately: true
  }))).then(results => {
    const result = results?.find(item => item.frameId === r) ?? results?.[0];
    if (result?.error) throw result.error;
    if (result?.result !== true) return An;
    return Pi.getSiteSettingsFilenamesByDomains(Hn(t)).find(site => Di.includes(site)) || _n;
  }).catch(error => {
    const message = String(error?.message || error || '');
    return /permission|not (?:have |allowed |permitted )?access|cannot access|access (?:denied|to .*denied)|缺少权限|没有权限|无权访问/i.test(message) ? xn : An;
  });
}
