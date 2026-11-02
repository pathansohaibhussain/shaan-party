// Service worker: frame listing, per-site script registration, ad-tab closer.
const hostOf = u => { try { return new URL(u).hostname; } catch (e) { return ''; } };
const sameSite = (a, b) => !!a && !!b && (a === b || a.endsWith('.' + b) || b.endsWith('.' + a));
const suspects = new Map();

const getParty = async () => (await chrome.storage.session.get('party')).party || {};
async function setParty(tabId, host) {
  const party = await getParty();
  if (host) party[tabId] = host; else delete party[tabId];
  await chrome.storage.session.set({ party });
}
const adCloseOn = async () => (await chrome.storage.local.get({ adTabClose: false })).adTabClose;
async function closeTab(tabId) {
  try { await chrome.tabs.remove(tabId); } catch (e) { return; }
  const s = await chrome.storage.local.get({ adTabsClosed: 0 });
  await chrome.storage.local.set({ adTabsClosed: s.adTabsClosed + 1 });
}

// --- close pop-up tabs opened by a page that has an active party ---
chrome.webNavigation.onCreatedNavigationTarget.addListener(async d => {
  if (!(await adCloseOn())) return;
  const ph = (await getParty())[d.sourceTabId];
  if (!ph) return;
  const h = hostOf(d.url);
  if (h) { if (!sameSite(h, ph)) closeTab(d.tabId); } else suspects.set(d.tabId, ph);   // blank tab: judge on first real navigation
});
chrome.webNavigation.onBeforeNavigate.addListener(async d => {
  if (d.frameId !== 0 || !suspects.has(d.tabId)) return;
  const h = hostOf(d.url);
  if (!h) return;
  const ph = suspects.get(d.tabId);
  suspects.delete(d.tabId);
  if ((await adCloseOn()) && !sameSite(h, ph)) closeTab(d.tabId);
});
chrome.tabs.onRemoved.addListener(async tabId => { suspects.delete(tabId); if ((await getParty())[tabId]) await setParty(tabId, null); });

// --- scripts injected on sites the person enabled by hand (keep in sync with GEN_FILES in popup.js) ---
const GEN_JS = ['core/sync-math.js', 'platforms/generic/adapter.js', 'core/content-core.js'];

// Registered scripts survive extension updates with their OLD file list, so re-register them on every update.
chrome.runtime.onInstalled.addListener(async () => {
  const st = await chrome.storage.local.get({ genSites: {} });
  for (const [id, matches] of Object.entries(st.genSites)) {
    try { await chrome.scripting.unregisterContentScripts({ ids: [id] }); } catch (e) {}
    try { await chrome.scripting.registerContentScripts([{ id, matches, js: GEN_JS, allFrames: true, runAt: 'document_start', persistAcrossSessions: true }]); } catch (e) {}
  }
});

// --- allow extra origins (player domains) for a site ---
async function allow(sender, origins) {
  const host = hostOf(sender.url), id = 'sp-gen-' + host;
  const st = await chrome.storage.local.get({ genSites: {} });
  const all = [...new Set([...(st.genSites[id] || [new URL(sender.url).origin + '/*']), ...origins.map(o => o + '/*')])];
  try { await chrome.scripting.unregisterContentScripts({ ids: [id] }); } catch (e) {}
  await chrome.scripting.registerContentScripts([{ id, matches: all, js: GEN_JS, allFrames: true, runAt: 'document_start', persistAcrossSessions: true }]);
  st.genSites[id] = all;
  await chrome.storage.local.set({ genSites: st.genSites });
  try { await chrome.scripting.executeScript({ target: { tabId: sender.tab.id, allFrames: true }, files: ['platforms/generic/adapter.js'] }); } catch (e) {}
}

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (!sender.tab) return;
  if (msg.type === 'sp-frames') {
    chrome.webNavigation.getAllFrames({ tabId: sender.tab.id }).then(frames => {
      const set = new Set();
      (frames || []).forEach(f => { try { const u = new URL(f.url); if (/^https?:$/.test(u.protocol)) set.add(u.origin); } catch (e) {} });
      reply({ origins: [...set] });
    }).catch(() => reply({ origins: [] }));
    return true;
  }
  if (msg.type === 'sp-allow') {
    allow(sender, msg.origins || []).then(() => reply({ ok: true })).catch(() => reply({ ok: false }));
    return true;
  }
  if (msg.type === 'sp-party') {
    setParty(sender.tab.id, msg.active ? msg.host : null).then(() => reply({ ok: true }));
    return true;
  }
});
