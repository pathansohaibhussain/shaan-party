(() => {
  const $ = id => document.getElementById(id);
  const v = $('video'), core = window.ShaanCore, P = window.ShaanPlatform;
  if (!core) { $('status').textContent = 'Core failed to load.'; return; }
  let info = null;   // { name, size, duration }

  const fmt = s => { s = Math.floor(s || 0); const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = s % 60; return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(x).padStart(2, '0'); };
  const mb = b => (b / 1048576).toFixed(1);
  const status = t => { $('status').textContent = t; };

  function load(file) {
    if (!file) return;
    if (v.dataset.url) URL.revokeObjectURL(v.dataset.url);
    v.querySelectorAll('track').forEach(t => t.remove());
    const url = URL.createObjectURL(file);
    v.dataset.url = url; v.src = url;
    info = { name: file.name, size: file.size, duration: 0 };
    $('title').textContent = file.name;
    $('empty').style.display = 'none';
    status('Loading ' + file.name + '…');
  }

  v.addEventListener('loadedmetadata', () => {
    if (!info) return;
    info.duration = v.duration;
    status('Loaded: ' + info.name + ' (' + mb(info.size) + ' MB, ' + fmt(info.duration) + ')');
    announce(true);
    if (core.inRoom()) core.requestState();     // catch up to where the party already is
  });
  v.addEventListener('error', () => status('Chrome cannot play this file (unsupported format or codec). Try an MP4 with H.264 video and AAC audio.'));

  function announce(ask) {
    if (core.inRoom() && info && info.duration) core.send({ kind: 'file', ask, name: info.name, size: info.size, duration: info.duration });
  }

  // hooks called by the core
  P.onJoined = () => { status('In party. ' + (info ? 'Checking file match…' : 'Open the same video file now.')); announce(true); };
  P.onRemote = (d) => {
    if (d.kind !== 'file') return;
    if (info && info.duration) {
      const same = d.size === info.size && Math.abs((d.duration || 0) - info.duration) < 2;
      core.notice(same ? '✓ Same video file as your partner.'
        : '⚠ Different file! Partner has “' + d.name + '” (' + mb(d.size) + ' MB, ' + fmt(d.duration) + '). Sync will drift.');
      if (d.ask) announce(false);
    }
  };

  // subtitles (.srt or .vtt)
  async function loadSubs(file) {
    if (!file) return;
    let text = (await file.text()).replace(/^\uFEFF/, '');
    if (!/^WEBVTT/.test(text)) text = 'WEBVTT\n\n' + text.replace(/\r/g, '').replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2');
    const url = URL.createObjectURL(new Blob([text], { type: 'text/vtt' }));
    v.querySelectorAll('track').forEach(t => t.remove());
    const t = document.createElement('track');
    t.kind = 'subtitles'; t.label = file.name; t.src = url; t.default = true;
    v.appendChild(t);
    t.addEventListener('load', () => { t.track.mode = 'showing'; });
    status('Subtitles loaded: ' + file.name);
  }

  function toggleFs() {
    if (document.fullscreenElement) document.exitFullscreen();
    else $('stage').requestFullscreen().catch(() => {});
  }

  $('open-btn').onclick = () => $('file').click();
  $('file').onchange = e => load(e.target.files[0]);
  $('sub-btn').onclick = () => $('subfile').click();
  $('subfile').onchange = e => loadSubs(e.target.files[0]);
  $('fs-btn').onclick = toggleFs;
  $('start-btn').onclick = () => {
    if (core.inRoom()) return status('Already in a party.');
    const c = core.start();
    status('Party started. Room code: ' + c + ' — send it to your friend (use the # button in the sidebar to copy).');
  };
  $('join-btn').onclick = () => {
    const c = $('code').value.trim();
    if (!core.join(c)) return status(core.inRoom() ? 'Already in a party.' : 'Enter a valid room code.');
    status('Joining room ' + c + '…');
  };

  // drag & drop
  const stage = $('stage');
  ['dragenter', 'dragover'].forEach(ev => stage.addEventListener(ev, e => { e.preventDefault(); stage.classList.add('drag'); }));
  ['dragleave', 'drop'].forEach(ev => stage.addEventListener(ev, e => { e.preventDefault(); stage.classList.remove('drag'); }));
  stage.addEventListener('drop', e => {
    const f = e.dataTransfer.files[0];
    if (!f) return;
    if (/\.(srt|vtt)$/i.test(f.name)) loadSubs(f); else load(f);
  });

  // keyboard shortcuts
  document.addEventListener('keydown', e => {
    if (/INPUT|TEXTAREA/.test(e.target.tagName)) return;
    if (e.code === 'Space') { e.preventDefault(); v.paused ? v.play() : v.pause(); }
    else if (e.code === 'ArrowRight') v.currentTime += 10;
    else if (e.code === 'ArrowLeft') v.currentTime -= 10;
    else if (e.key === 'f') toggleFs();
    else if (e.key === 'm') v.muted = !v.muted;
  });
})();
