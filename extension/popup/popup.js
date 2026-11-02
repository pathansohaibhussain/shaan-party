const $ = id => document.getElementById(id);
['😎','🦁','🐯','🦊','🐼','🐸','👻','🤖','👽','🦄','🍕','⭐'].forEach(e => { const o = document.createElement('option'); o.value = o.textContent = e; $('icon').appendChild(o); });
chrome.storage.local.get({ server: 'ws://localhost:8080', name: '', icon: '😎', giphy: '' }, s => {
  $('name').value = s.name; $('icon').value = s.icon; $('server').value = s.server; $('giphy').value = s.giphy;
});
const msg = t => $('msg').textContent = t;
function save(cb) {
  const server = $('server').value.trim();
  if (!/^wss?:\/\//.test(server)) return msg('Server URL must start with ws:// or wss://');
  chrome.storage.local.set({ name: $('name').value.trim() || 'Guest', icon: $('icon').value, server, giphy: $('giphy').value.trim() }, () => { msg('Saved'); cb && cb(); });
}
function toTab(m) {
  chrome.tabs.query({ active: true, currentWindow: true }, ([t]) => {
    if (!t) return msg('No active tab.');
    chrome.tabs.sendMessage(t.id, m, r => {
      if (chrome.runtime.lastError || !r) return msg('Not active on this page. On other websites click "Enable on this site" first, then retry (refresh if needed).');
      msg(m.type === 'sp-start' ? 'Party started! Room code: ' + r.room + '. Share the 🔗 link or this code.' : 'Joined.');
    });
  });
}
$('save').onclick = () => save();
$('start').onclick = () => save(() => toTab({ type: 'sp-start' }));
$('join').onclick = () => { const c = $('code').value.trim(); if (!/^[\w-]{3,32}$/.test(c)) return msg('Enter a valid room code'); save(() => toTab({ type: 'sp-join', room: c })); };

$('test').onclick = () => {
  const url = $('server').value.trim(); msg('Testing…'); let ws;
  try { ws = new WebSocket(url); } catch (e) { return msg('❌ Invalid URL'); }
  const to = setTimeout(() => { msg('❌ No response. Server off, wrong URL, or tunnel not running.'); try { ws.close(); } catch (_) {} }, 8000);
  ws.onopen = () => ws.send(JSON.stringify({ t: 'join', room: 'selftest', name: 'test', icon: '🧪' }));
  ws.onmessage = e => { try { if (JSON.parse(e.data).t === 'welcome') { clearTimeout(to); msg('✅ Server reachable. Same URL on both PCs = good.'); ws.close(); } } catch (_) {} };
  ws.onerror = () => { clearTimeout(to); msg('❌ Connection failed. Check URL and that the server + tunnel are running.'); };
};

$('local').onclick = () => chrome.tabs.create({ url: chrome.runtime.getURL('platforms/local/player.html') });

// ---- generic (any website) support, enabled per site ----
const GEN_FILES = ['core/sync-math.js', 'platforms/generic/adapter.js', 'core/content-core.js'];
const hostId = u => 'sp-gen-' + new URL(u).hostname;
const activeTab = async () => (await chrome.tabs.query({ active: true, currentWindow: true }))[0];

$('enable').onclick = async () => {
  const tab = await activeTab();
  if (!tab || !/^https?:/.test(tab.url || '')) return msg('Open the movie page in this tab first.');
  const set = new Set([new URL(tab.url).origin + '/*']);
  try { (await chrome.webNavigation.getAllFrames({ tabId: tab.id })).forEach(f => { if (/^https?:/.test(f.url)) set.add(new URL(f.url).origin + '/*'); }); } catch (e) {}
  const origins = [...set];
  const ok = await chrome.permissions.request({ origins });
  if (!ok) return msg('Permission was not granted.');
  const id = hostId(tab.url);
  const st0 = await chrome.storage.local.get({ genSites: {} });
  const all = [...new Set([...(st0.genSites[id] || []), ...origins])];
  try { await chrome.scripting.unregisterContentScripts({ ids: [id] }); } catch (e) {}
  await chrome.scripting.registerContentScripts([{ id, matches: all, js: GEN_FILES, allFrames: true, runAt: 'document_start', persistAcrossSessions: true }]);
  const st = await chrome.storage.local.get({ genSites: {} });
  st.genSites[id] = all;
  await chrome.storage.local.set({ genSites: st.genSites });
  try { await chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, files: GEN_FILES }); }
  catch (e) { return msg('Enabled. Refresh the page, then click Start a party.'); }
  msg('Enabled on ' + new URL(tab.url).hostname + ' (' + origins.length + ' origin(s)). Now click Start a party.');
};

$('disable').onclick = async () => {
  const tab = await activeTab();
  if (!tab || !tab.url) return;
  const id = hostId(tab.url);
  const st = await chrome.storage.local.get({ genSites: {} });
  try { await chrome.scripting.unregisterContentScripts({ ids: [id] }); } catch (e) {}
  if (st.genSites[id]) {
    try { await chrome.permissions.remove({ origins: st.genSites[id] }); } catch (e) {}
    delete st.genSites[id];
    await chrome.storage.local.set({ genSites: st.genSites });
  }
  msg('Disabled on this site. Refresh the tab.');
};

chrome.storage.local.get({ adTabClose: false, adTabsClosed: 0 }, s => {
  $('adclose').checked = s.adTabClose;
  $('adcount').textContent = s.adTabsClosed ? '(' + s.adTabsClosed + ' closed so far)' : '';
});
$('adclose').onchange = () => chrome.storage.local.set({ adTabClose: $('adclose').checked });
