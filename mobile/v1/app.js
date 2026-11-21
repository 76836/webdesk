const STORAGE_KEYS = {
  layout: 'webdesk.mobile.v1.layout',
  wallpaper: 'webdesk.mobile.v1.wallpaper',
  brightness: 'webdesk.mobile.v1.brightness',
  dock: 'webdesk.mobile.v1.dock',
  swapNav: 'webdesk.mobile.v1.swapNav',
  verbose: 'webdesk.mobile.v1.verbose',
  notifyErrors: 'webdesk.mobile.v1.notifyErrors',
  appMeta: 'webdesk.mobile.v1.appMeta'
};
const BUILTIN = [
  { id: 'settings', name: 'Settings', url: './settings.html', glyph: '⚙️', iconUrl: '../../images/icons/settings.png' },
  { id: 'files', name: 'Files', url: '../../v4/apps/files.html', glyph: '📁', iconUrl: '../../images/icons/files.png' },
  { id: 'appmaker', name: 'AppCenter', url: '../../v4/apps/appmaker.html', glyph: '🧩', iconUrl: 'https://76836.github.io/AppCenter/apple-touch-icon.png' },
  { id: 'jsconsole', name: 'JS Console', url: '../../v4/apps/jsconsole.html', glyph: '>_', iconUrl: null }
];
const DEFAULT_LAYOUT = { pages: [['search', 'settings', 'files'], ['appmaker', 'jsconsole']] };
const DEFAULT_DOCK = ['settings', 'appmaker', 'files'];
const NOTIF_KEY = 'webdesk.mobile.v1.notifications';
const NOTIF_MAX = 40;


const shell = document.getElementById('phone-shell');
const homeEl = document.getElementById('home');
const pagesEl = document.getElementById('homescreen-pages');
const pageDotsEl = document.getElementById('page-dots');
const dockEl = document.getElementById('dock');
const appLayer = document.getElementById('app-layer');
const appHost = document.getElementById('app-host');
const recentsEl = document.getElementById('recents');
const recentsListEl = document.getElementById('recents-list');
const appPickerEl = document.getElementById('app-picker');
const appPickerList = document.getElementById('app-picker-list');
const ccEl = document.getElementById('control-center');
const statusBar = document.getElementById('status-bar');
const statusTime = document.getElementById('status-time');
const ccDate = document.getElementById('cc-date');
const brightnessSlider = document.getElementById('brightness-slider');
const wallpaperSelect = document.getElementById('wallpaper-select'); // optional; wallpaper lives in Settings

let catalog = [], frames = new Map(), history = [], current = null, dragItem = null, editMode = false;

function parse(v) { try { return JSON.parse(v); } catch { return null; } }
function loadStoreApps() {
  const out = [];
  for (const key of ['WebDesk_custom_apps', 'WebDesk_apps']) {
    const list = parse(localStorage.getItem(key));
    if (!Array.isArray(list)) continue;
    for (const entry of list) {
      const id = entry.id || entry.config?.id;
      const cfg = entry.config || entry;
      if (!id || !cfg?.url) continue;
      out.push({ id: String(id), name: cfg.title || cfg.name || id, url: cfg.url, iconUrl: cfg.iconUrl || cfg.icon || null, glyph: '📦', fromStore: true });
    }
  }
  return out;
}
function rebuildCatalog() {
  const map = new Map();
  BUILTIN.forEach((a) => map.set(a.id, { ...a }));
  loadStoreApps().forEach((a) => map.set(a.id, { ...map.get(a.id), ...a }));
  catalog = [...map.values()];
}
function app(id) { return catalog.find((a) => a.id === id) || null; }
function layout() {
  const s = parse(localStorage.getItem(STORAGE_KEYS.layout));
  const L = s?.pages?.length ? s : JSON.parse(JSON.stringify(DEFAULT_LAYOUT));
  L.pages = (L.pages || []).map((page) => page.filter((id) => id !== 'market' && id !== 'terminal' && id !== 'calculator'));
  return L;
}
function saveLayout(L) { localStorage.setItem(STORAGE_KEYS.layout, JSON.stringify(L)); }
function dockIds() {
  const s = parse(localStorage.getItem(STORAGE_KEYS.dock));
  const ids = Array.isArray(s) && s.length ? s : [...DEFAULT_DOCK];
  return ids.filter((id) => id !== 'market' && id !== 'terminal' && id !== 'calculator');
}
function applyIcon(el, a) {
  const img = el.querySelector('.app-img'), glyph = el.querySelector('.app-glyph');
  el.querySelector('.app-name').textContent = a.name;
  if (a.iconUrl) {
    img.src = a.iconUrl; img.alt = ''; img.classList.remove('hidden'); glyph.classList.add('hidden');
    img.onerror = () => { img.classList.add('hidden'); glyph.classList.remove('hidden'); glyph.textContent = a.glyph || '📦'; };
  } else {
    img.classList.add('hidden'); glyph.classList.remove('hidden'); glyph.textContent = a.glyph || '📦';
  }
}
function loadAppMeta() {
  return parse(localStorage.getItem(STORAGE_KEYS.appMeta)) || {};
}
function saveAppMeta(m) {
  localStorage.setItem(STORAGE_KEYS.appMeta, JSON.stringify(m || {}));
}
function effectiveApp(a) {
  if (!a) return a;
  const meta = loadAppMeta()[a.id] || {};
  return { ...a, name: meta.name || a.name, iconUrl: meta.iconUrl != null ? meta.iconUrl : a.iconUrl, glyph: meta.glyph || a.glyph };
}
function hideAppMenu() {
  document.getElementById('app-context-menu')?.classList.add('hidden');
}
function showAppMenu(a, x, y) {
  const menu = document.getElementById('app-context-menu');
  if (!menu) return;
  menu.dataset.appId = a.id;
  menu.classList.remove('hidden');
  const pad = 12;
  const rect = menu.getBoundingClientRect();
  let left = Math.min(Math.max(pad, x - 20), window.innerWidth - rect.width - pad);
  let top = Math.min(Math.max(pad, y - 10), window.innerHeight - rect.height - pad);
  menu.style.left = left + 'px';
  menu.style.top = top + 'px';
}
function makeIcon(a, { dock = false } = {}) {
  a = effectiveApp(a);
  const el = document.getElementById('app-icon-template').content.firstElementChild.cloneNode(true);
  el.dataset.itemId = a.id; applyIcon(el, a);
  el.querySelector('.badge-remove').addEventListener('click', (e) => { e.stopPropagation(); removeFromHome(a.id); });
  let t = null, longPress = false, sx = 0, sy = 0;
  const clear = () => { if (t) { clearTimeout(t); t = null; } };
  el.addEventListener('pointerdown', (e) => {
    longPress = false; sx = e.clientX; sy = e.clientY;
    t = setTimeout(() => {
      longPress = true;
      showAppMenu(a, e.clientX || sx, e.clientY || sy);
    }, 520);
  });
  el.addEventListener('pointermove', (e) => {
    if (t && (Math.abs(e.clientX - sx) > 12 || Math.abs(e.clientY - sy) > 12)) clear();
  });
  el.addEventListener('pointerup', clear);
  el.addEventListener('pointerleave', clear);
  el.addEventListener('pointercancel', clear);
  el.addEventListener('click', (e) => {
    if (editMode || longPress || e.target.closest('.badge-remove')) return;
    openApp(a.id);
  });
  if (!dock) bindDrag(el);
  return el;
}
function renderHome() {
  rebuildCatalog();
  pagesEl.innerHTML = ''; pageDotsEl.innerHTML = '';
  const L = layout();
  const placed = new Set(L.pages.flat());
  const missing = catalog.filter((a) => a.fromStore && !placed.has(a.id));
  if (missing.length) {
    if (!L.pages.length) L.pages.push([]);
    missing.forEach((a) => L.pages[L.pages.length - 1].push(a.id));
    saveLayout(L);
  }
  L.pages.forEach((items, i) => {
    const page = document.getElementById('home-page-template').content.firstElementChild.cloneNode(true);
    page.dataset.page = String(i); bindDrop(page);
    items.forEach((id) => {
      if (id === 'search') {
        const s = document.getElementById('search-widget-template').content.firstElementChild.cloneNode(true);
        s.dataset.itemId = 'search'; bindDrag(s);
        s.querySelector('input').addEventListener('input', (e) => filterApps(e.target.value));
        page.append(s); return;
      }
      const a = app(id); if (a) page.append(makeIcon(a));
    });
    pagesEl.append(page);
    const dot = document.createElement('span');
    if (i === 0) dot.classList.add('active');
    pageDotsEl.append(dot);
  });
  dockEl.innerHTML = '';
  dockIds().forEach((id) => { const a = app(id); if (a) dockEl.append(makeIcon(a, { dock: true })); });
}
function bindDrag(el) {
  el.addEventListener('dragstart', () => { dragItem = { id: el.dataset.itemId, from: el.closest('.home-page')?.dataset.page }; });
}
function bindDrop(page) {
  page.addEventListener('dragover', (e) => { e.preventDefault(); page.classList.add('drag-over'); });
  page.addEventListener('dragleave', () => page.classList.remove('drag-over'));
  page.addEventListener('drop', (e) => {
    e.preventDefault(); page.classList.remove('drag-over');
    if (!dragItem) return;
    const L = layout(), from = Number(dragItem.from), to = Number(page.dataset.page);
    if (Number.isNaN(from) || Number.isNaN(to) || from === to) return;
    L.pages[from] = L.pages[from].filter((x) => x !== dragItem.id);
    L.pages[to].push(dragItem.id); saveLayout(L); dragItem = null; renderHome();
  });
}
function removeFromHome(id) {
  const L = layout();
  L.pages = L.pages.map((p) => p.filter((x) => x !== id)).filter((p, i) => i === 0 || p.length);
  if (!L.pages.length) L.pages = [[]];
  saveLayout(L); renderHome();
}
function setEditMode(on) { editMode = !!on; homeEl.classList.toggle('edit-mode', editMode); }
function openPicker() {
  rebuildCatalog(); appPickerList.innerHTML = '';
  catalog.forEach((a) => {
    const el = makeIcon(a);
    el.addEventListener('click', (e) => { e.stopPropagation(); openApp(a.id); appPickerEl.classList.add('hidden'); });
    appPickerList.append(el);
  });
  appPickerEl.classList.remove('hidden');
}
function ensureFrame(id) {
  if (frames.has(id)) return frames.get(id);
  const a = app(id); if (!a) return null;
  const iframe = document.createElement('iframe');
  iframe.title = a.name;
  iframe.src = a.url;
  iframe.classList.add('hidden');
  iframe.allow = 'clipboard-read; clipboard-write; fullscreen';
  iframe.setAttribute('frameborder', '0');
  // Shell styles stay on the iframe element only — never inject CSS into the app document
  iframe.style.cssText = 'border:0;width:100%;height:100%;background:transparent;';
  // Isolation: empty sandbox is too strict; use credentialless where supported without touching app CSS
  try { iframe.referrerPolicy = 'no-referrer-when-downgrade'; } catch (_) {}
  appHost.append(iframe); frames.set(id, iframe); return iframe;
}
function openApp(id) {
  rebuildCatalog();
  const f = ensureFrame(id); if (!f) return;
  frames.forEach((x) => x.classList.add('hidden'));
  f.classList.remove('hidden'); current = id;
  history = [id, ...history.filter((x) => x !== id)];
  appLayer.classList.remove('hidden');
  recentsEl.classList.add('hidden'); appPickerEl.classList.add('hidden'); setEditMode(false);
}
function forceStopApp(id) {
  const f = frames.get(id);
  if (f) {
    try { f.src = 'about:blank'; } catch (_) {}
    f.remove();
    frames.delete(id);
  }
  history = history.filter((x) => x !== id);
  if (current === id) { current = null; appLayer.classList.add('hidden'); }
  try { window.WebDeskLog && window.WebDeskLog.write('info', 'shell', 'force-stop ' + id); } catch (_) {}
}
function closeApp(id) {
  const f = frames.get(id); if (f) { f.remove(); frames.delete(id); }
  history = history.filter((x) => x !== id);
  if (current === id) { current = null; appLayer.classList.add('hidden'); }
  if (!recentsEl.classList.contains('hidden')) renderRecents();
}
function goHome() {
  appLayer.classList.add('hidden'); recentsEl.classList.add('hidden');
  appPickerEl.classList.add('hidden'); setEditMode(false);
}
function showRecents() {
  appLayer.classList.add('hidden'); appPickerEl.classList.add('hidden');
  recentsEl.classList.remove('hidden'); renderRecents();
}
function renderRecents() {
  recentsListEl.innerHTML = '';
  if (!history.length) {
    recentsListEl.innerHTML = '<p style="margin:auto;opacity:.5;padding:40px">No recent apps</p>';
    return;
  }
  history.forEach((id) => {
    const a = app(id); if (!a) return;
    const card = document.createElement('button');
    card.type = 'button'; card.className = 'recents-card';
    const letter = (a.name || '?').charAt(0).toUpperCase();
    const ico = a.iconUrl
      ? `<img class="ico" src="${a.iconUrl}" alt="" onerror="this.outerHTML='<span class=ico>${a.glyph || '📦'}</span>'" />`
      : `<span class="ico">${a.glyph || '📦'}</span>`;
    card.innerHTML = `<div class="recents-card-chrome">${ico}<span class="label">${a.name}</span><span class="dismiss" role="button">×</span></div><div class="recents-shot" data-letter="${letter}"></div>`;
    card.querySelector('.dismiss').addEventListener('click', (e) => { e.stopPropagation(); closeApp(id); });
    card.addEventListener('click', (e) => { if (!e.target.closest('.dismiss')) openApp(id); });
    // Swipe up to dismiss
    let ry0 = null, rActive = false;
    card.addEventListener('touchstart', (e) => { ry0 = e.touches[0].clientY; rActive = true; card.style.transition = 'none'; }, { passive: true });
    card.addEventListener('touchmove', (e) => {
      if (!rActive || ry0 == null) return;
      const dy = e.touches[0].clientY - ry0;
      if (dy < 0) card.style.transform = 'translateY(' + dy + 'px) scale(' + Math.max(0.88, 1 + dy / 600) + ')';
    }, { passive: true });
    card.addEventListener('touchend', (e) => {
      if (!rActive || ry0 == null) return;
      const dy = (e.changedTouches[0]?.clientY ?? ry0) - ry0;
      card.style.transition = 'transform 0.18s ease, opacity 0.18s ease';
      if (dy < -80) {
        card.style.transform = 'translateY(-120%)';
        card.style.opacity = '0';
        setTimeout(() => closeApp(id), 160);
      } else {
        card.style.transform = '';
        card.style.opacity = '';
      }
      ry0 = null; rActive = false;
    });
    recentsListEl.append(card);
  });
}
function filterApps(q) {
  q = q.trim().toLowerCase();
  document.querySelectorAll('.home-page .app-icon').forEach((el) => {
    const n = el.querySelector('.app-name')?.textContent?.toLowerCase() || '';
    el.style.display = !q || n.includes(q) ? '' : 'none';
  });
}
function clocks() {
  const n = new Date();
  statusTime.textContent = n.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  ccDate.textContent = n.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
}
function setWallpaper(nameOrUrl) {
  const oldVideo = shell.querySelector('.desktop-wallpaper-video');
  if (oldVideo) oldVideo.remove();
  shell.classList.remove('wallpaper-default', 'wallpaper-water', 'wallpaper-foreshadowing', 'has-custom-wallpaper');
  shell.style.backgroundImage = '';
  const v = nameOrUrl || 'default';
  if (v === 'default' || v === 'water' || v === 'foreshadowing') {
    shell.classList.add('wallpaper-' + v);
    localStorage.setItem(STORAGE_KEYS.wallpaper, v);
    return;
  }
  // Desktop v4 wallpaper URL / data URL
  localStorage.setItem('wallpaper', v);
  localStorage.setItem(STORAGE_KEYS.wallpaper, v);
  if (String(v).startsWith('data:video') || /\.(mp4|webm|mov|m4v|ogg)(\?|$)/i.test(String(v))) {
    shell.classList.add('has-custom-wallpaper');
    const video = document.createElement('video');
    video.className = 'desktop-wallpaper-video';
    video.src = v;
    video.autoplay = true;
    video.loop = true;
    video.muted = true;
    video.playsInline = true;
    shell.insertBefore(video, shell.firstChild);
  } else {
    shell.classList.add('has-custom-wallpaper');
    shell.style.backgroundImage = 'url(\'' + String(v).replace(/'/g, '%27') + '\')';
  }
}
function applySwapNav(on) {
  const nav = document.querySelector('.system-nav');
  if (!nav) return;
  nav.classList.toggle('swap-nav', !!on);
  localStorage.setItem(STORAGE_KEYS.swapNav, on ? '1' : '0');
}
function verboseOn() {
  return localStorage.getItem(STORAGE_KEYS.verbose) !== '0';
}
function notifyErrorsOn() {
  return localStorage.getItem(STORAGE_KEYS.notifyErrors) !== '0';
}
function shellLog(level, src, msg) {
  try { window.WebDeskLog && window.WebDeskLog.write(level, src, msg); } catch (_) {}
  if (level === 'error' && notifyErrorsOn()) {
    pushNotif({ title: src || 'Error', body: msg, level: 'error', source: src || 'shell' });
  } else if (verboseOn() && level !== 'error') {
    // verbose info stays in log only
  }
}
function setBrightness(v) {
  shell.style.filter = `brightness(${Number(v) / 100})`;
  localStorage.setItem(STORAGE_KEYS.brightness, String(v));
}

function loadNotifs() {
  try {
    const arr = JSON.parse(localStorage.getItem(NOTIF_KEY) || '[]');
    return Array.isArray(arr) ? arr : [];
  } catch (_) { return []; }
}
function saveNotifs(list) {
  localStorage.setItem(NOTIF_KEY, JSON.stringify(list.slice(0, NOTIF_MAX)));
}
function pushNotif(n) {
  const item = {
    id: 'n_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
    title: String(n.title || 'Notification'),
    body: String(n.body || ''),
    level: n.level === 'info' ? 'info' : 'error',
    source: n.source || '',
    at: n.at || Date.now()
  };
  const list = [item, ...loadNotifs()].slice(0, NOTIF_MAX);
  saveNotifs(list);
  renderNotifs();
  try {
    window.WebDeskLog && window.WebDeskLog.write(item.level === 'error' ? 'error' : 'info', item.source || 'notify', item.title + (item.body ? ' — ' + item.body : ''));
  } catch (_) {}
  if (item.level === 'error' && ccEl) {
    ccEl.classList.remove('hidden');
  }
  return item;
}
function clearNotifs() {
  saveNotifs([]);
  renderNotifs();
}
function renderNotifs() {
  const listEl = document.getElementById('cc-notify-list');
  const bar = document.getElementById('status-bar');
  if (!listEl) return;
  const list = loadNotifs();
  if (bar) bar.setAttribute('data-has-notifs', list.length ? '1' : '0');
  if (!list.length) {
    listEl.innerHTML = '<p class="cc-notify-empty">No notifications</p>';
    return;
  }
  listEl.innerHTML = '';
  list.forEach((n) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'cc-notify-item ' + (n.level || 'info');
    const t = new Date(n.at || Date.now());
    const time = t.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    btn.innerHTML = '<span class="n-title"></span><span class="n-body"></span><span class="n-time"></span>';
    btn.querySelector('.n-title').textContent = n.title;
    btn.querySelector('.n-body').textContent = n.body;
    btn.querySelector('.n-time').textContent = time + (n.source ? ' · ' + n.source : '');
    listEl.appendChild(btn);
  });
}

function boot() {
  rebuildCatalog();
  const deskWall = localStorage.getItem('wallpaper');
  const w = deskWall || localStorage.getItem(STORAGE_KEYS.wallpaper) || 'default';
  if (wallpaperSelect) wallpaperSelect.value = (deskWall ? 'default' : w);
  setWallpaper(deskWall || w);
  const b = localStorage.getItem(STORAGE_KEYS.brightness) || '100';
  brightnessSlider.value = b; setBrightness(b);
  renderHome(); clocks(); setInterval(clocks, 30000);
  renderNotifs();
  applySwapNav(localStorage.getItem(STORAGE_KEYS.swapNav) === '1');
  shellLog('info', 'shell', 'WebDesk Mobile boot');
}
function bind() {
  document.getElementById('nav-home').addEventListener('click', goHome);
  document.getElementById('nav-recents').addEventListener('click', showRecents);
  document.getElementById('nav-back').addEventListener('click', () => {
    try { frames.get(current)?.contentWindow?.history?.back(); } catch (_) {}
  });
  document.getElementById('btn-clear-recents').addEventListener('click', () => {
    [...history].forEach(closeApp); history = []; renderRecents();
  });
  document.getElementById('btn-close-picker').addEventListener('click', () => appPickerEl.classList.add('hidden'));
  let lastHome = 0;
  document.getElementById('nav-home').addEventListener('click', () => {
    const now = Date.now();
    if (now - lastHome < 350) openPicker();
    lastHome = now;
  });
  document.querySelectorAll('[data-window-action]').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (!current) return;
      const act = btn.dataset.windowAction;
      if (act === 'close') closeApp(current);
      if (act === 'minimize') goHome();
      if (act === 'maximize') appLayer.classList.toggle('maximized');
    });
  });
  function openCC() { ccEl.classList.remove('hidden'); }
  function closeCC() { ccEl.classList.add('hidden'); }
  statusBar.addEventListener('click', () => ccEl.classList.toggle('hidden'));
  // Swipe down on home (or status bar) → notification / control center
  let hy0 = null, homeSwipe = false;
  function bindSwipeDownOpen(el) {
    if (!el) return;
    el.addEventListener('touchstart', (e) => {
      if (!appLayer.classList.contains('hidden')) return;
      if (!recentsEl.classList.contains('hidden')) return;
      hy0 = e.touches[0].clientY; homeSwipe = true;
    }, { passive: true });
    el.addEventListener('touchmove', (e) => {
      if (!homeSwipe || hy0 == null) return;
      if (e.touches[0].clientY - hy0 > 48) { openCC(); homeSwipe = false; hy0 = null; }
    }, { passive: true });
    el.addEventListener('touchend', () => { hy0 = null; homeSwipe = false; });
  }
  bindSwipeDownOpen(statusBar);
  bindSwipeDownOpen(homeEl);
  bindSwipeDownOpen(pagesEl);
  // Swipe up inside CC or tap outside → close
  let ccy0 = null;
  ccEl.addEventListener('touchstart', (e) => { ccy0 = e.touches[0].clientY; }, { passive: true });
  ccEl.addEventListener('touchmove', (e) => {
    if (ccy0 != null && e.touches[0].clientY - ccy0 < -40) closeCC();
  }, { passive: true });
  brightnessSlider.addEventListener('input', (e) => setBrightness(e.target.value));
  const clearBtn = document.getElementById('btn-clear-notifs');
  if (clearBtn) clearBtn.addEventListener('click', (e) => { e.stopPropagation(); clearNotifs(); });

  if (wallpaperSelect) wallpaperSelect.addEventListener('change', (e) => setWallpaper(e.target.value));
  document.addEventListener('click', (e) => {
    if (!ccEl.classList.contains('hidden') && !ccEl.contains(e.target) && !statusBar.contains(e.target)) closeCC();
    if (!e.target.closest('#app-context-menu') && !e.target.closest('.app-icon')) hideAppMenu();
  });
  pagesEl.addEventListener('scroll', () => {
    const i = Math.round(pagesEl.scrollLeft / Math.max(1, pagesEl.clientWidth));
    [...pageDotsEl.children].forEach((d, idx) => d.classList.toggle('active', idx === i));
  });
  document.getElementById('tile-fullscreen').addEventListener('click', async (e) => {
    try {
      if (!document.fullscreenElement) await document.documentElement.requestFullscreen();
      else await document.exitFullscreen();
    } catch (_) {}
    e.currentTarget.classList.toggle('active', !!document.fullscreenElement);
  });
  ['tile-wifi', 'tile-bt', 'tile-rotation'].forEach((id) => {
    document.getElementById(id).addEventListener('click', (e) => e.currentTarget.classList.toggle('active'));
  });
  window.addEventListener('message', (ev) => {
    const d = ev.data; if (!d || typeof d !== 'object') return;
    if (d.type === 'setWallpaper' && typeof d.url === 'string') {
      setWallpaper(d.url);
    }
    if (d.type === 'webdesk:set-wallpaper' && typeof d.wallpaper === 'string') {
      setWallpaper(d.wallpaper);
    }
    if (d.type === 'WebDeskLog') {
      try {
        window.WebDeskLog && window.WebDeskLog.write(d.level || 'log', d.src || 'iframe', d.msg || d.message || '');
      } catch (_) {}
      if ((d.level === 'error' || d.level === 'warn') && notifyErrorsOn()) {
        pushNotif({ title: d.src || 'Error', body: d.msg || d.message || '', level: d.level === 'warn' ? 'info' : 'error', source: d.src || 'log' });
      }
    }
    if (d.type === 'webdesk:notify' || d.type === 'siloxane:error') {
      pushNotif({
        title: d.title || (d.type === 'siloxane:error' ? 'Siloxane error' : 'Notification'),
        body: d.body || d.message || '',
        level: d.level || 'error',
        source: d.source || '',
        at: d.at
      });
    }
    if (d.type === 'webdesk:set-brightness') setBrightness(d.value);
    if (d.type === 'webdesk:set-swap-nav') applySwapNav(!!d.value);
    if (d.type === 'webdesk:set-verbose') localStorage.setItem(STORAGE_KEYS.verbose, d.value ? '1' : '0');
    if (d.type === 'webdesk:open-app' && d.id) openApp(d.id);
    if (d.type === 'webdesk:notifs-cleared') { clearNotifs(); }
    if (d.type === 'registerApp' || d.type === 'unregisterApp') setTimeout(() => { rebuildCatalog(); renderHome(); }, 40);
  });

  // App context menu actions
  const menu = document.getElementById('app-context-menu');
  if (menu) {
    menu.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      const id = menu.dataset.appId;
      const act = btn.dataset.action;
      hideAppMenu();
      if (!id) return;
      if (act === 'open') openApp(id);
      if (act === 'force-stop') forceStopApp(id);
      if (act === 'info') {
        const a = effectiveApp(app(id));
        pushNotif({ title: a?.name || id, body: (a?.url || '') + '\n' + id, level: 'info', source: 'app-info' });
        openCC();
      }
      if (act === 'edit-name') {
        const a = app(id);
        const name = prompt('App name', effectiveApp(a)?.name || id);
        if (name) {
          const m = loadAppMeta();
          m[id] = { ...(m[id] || {}), name };
          saveAppMeta(m);
          renderHome();
        }
      }
      if (act === 'edit-icon') {
        const a = app(id);
        const iconUrl = prompt('Icon URL (empty = default glyph)', effectiveApp(a)?.iconUrl || '');
        if (iconUrl != null) {
          const m = loadAppMeta();
          m[id] = { ...(m[id] || {}), iconUrl };
          saveAppMeta(m);
          renderHome();
        }
      }
      if (act === 'uninstall') {
        if (!confirm('Remove ' + id + ' from home and store list?')) return;
        removeFromHome(id);
        forceStopApp(id);
        try {
          const apps = JSON.parse(localStorage.getItem('WebDesk_custom_apps') || '[]').filter((x) => x.id !== id && x.package_id !== id);
          localStorage.setItem('WebDesk_custom_apps', JSON.stringify(apps));
        } catch (_) {}
        rebuildCatalog(); renderHome();
        shellLog('info', 'shell', 'uninstalled ' + id);
      }
    });
  }

  // Global error → log + optional notify
  window.addEventListener('error', (ev) => {
    shellLog('error', 'window', (ev.message || 'error') + (ev.filename ? ' @ ' + ev.filename + ':' + ev.lineno : ''));
  });
  window.addEventListener('unhandledrejection', (ev) => {
    const r = ev.reason;
    shellLog('error', 'promise', r && r.message ? r.message : String(r));
  });
  window.addEventListener('storage', (e) => {
    if (e.key === 'WebDesk_custom_apps' || e.key === 'WebDesk_apps') { rebuildCatalog(); renderHome(); }
  });
}

(function installMobileWebDeskBridge() {
  if (!window.WebDeskLog) {
    const log = {
      max: 400,
      lines: [],
      subs: new Set(),
      write(level, src, msg) {
        const line = { t: Date.now(), level: level || 'log', src: src || 'app', msg: String(msg) };
        this.lines.push(line);
        while (this.lines.length > this.max) this.lines.shift();
        this.subs.forEach((fn) => { try { fn(line); } catch (_) {} });
      },
      on(fn) { this.subs.add(fn); return () => this.subs.delete(fn); },
      dump(n) { return this.lines.slice(-(n || 100)); }
    };
    window.WebDeskLog = log;
    window.addEventListener('message', (ev) => {
      const d = ev.data;
      if (!d || d.type !== 'WebDeskLog') return;
      try { log.write(d.level || 'log', d.src || 'iframe', d.msg || ''); } catch (_) {}
    });
    ['log', 'warn', 'error', 'info'].forEach((level) => {
      const orig = console[level].bind(console);
      console[level] = (...args) => {
        orig(...args);
        try {
          const msg = args.map((a) => {
            if (typeof a === 'string') return a;
            if (a && typeof a === 'object' && a.message) return a.message;
            try { return JSON.stringify(a); } catch (_) { return String(a); }
          }).join(' ');
          log.write(level, 'console', msg);
        } catch (_) {}
      };
    });
  }
  // Minimal WebDesk surface so jsconsole.html commands work on Mobile
  window.WebDesk = window.WebDesk || {};
  window.WebDesk.appManager = window.WebDesk.appManager || {
    get apps() {
      const m = new Map();
      try {
        (typeof catalog !== 'undefined' ? catalog : []).forEach((a) => {
          m.set(a.id, { title: a.name, url: a.url, WDNative: !!a.WDNative });
        });
      } catch (_) {}
      return m;
    }
  };
  window.WebDesk.windowManager = window.WebDesk.windowManager || {
    get openWindows() {
      const m = new Map();
      try {
        frames.forEach((iframe, id) => {
          const a = typeof app === 'function' ? app(id) : null;
          m.set(id, {
            config: { title: (a && a.name) || id },
            state: iframe.classList.contains('hidden') ? 'hidden' : 'open',
            native: false
          });
        });
      } catch (_) {}
      return m;
    }
  };
})();

boot();
bind();
