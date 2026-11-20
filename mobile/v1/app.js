const STORAGE_KEYS = {
  layout: 'webdesk.mobile.v1.layout',
  wallpaper: 'webdesk.mobile.v1.wallpaper',
  brightness: 'webdesk.mobile.v1.brightness',
  dock: 'webdesk.mobile.v1.dock'
};
const BUILTIN = [
  { id: 'settings', name: 'Settings', url: '../../v4/apps/settings.html', glyph: '⚙️', iconUrl: '../../images/icons/settings.png' },
  { id: 'files', name: 'Files', url: '../../v4/apps/files.html', glyph: '📁', iconUrl: '../../images/icons/files.png' },
  { id: 'appmaker', name: 'AppCenter', url: '../../v4/apps/appmaker.html', glyph: '🧩', iconUrl: 'https://76836.github.io/AppCenter/apple-touch-icon.png' }
];
const DEFAULT_LAYOUT = { pages: [['search', 'settings', 'files'], ['appmaker']] };
const DEFAULT_DOCK = ['settings', 'appmaker', 'files'];

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
function makeIcon(a, { dock = false } = {}) {
  const el = document.getElementById('app-icon-template').content.firstElementChild.cloneNode(true);
  el.dataset.itemId = a.id; applyIcon(el, a);
  el.querySelector('.badge-remove').addEventListener('click', (e) => { e.stopPropagation(); removeFromHome(a.id); });
  let t = null;
  const clear = () => { if (t) { clearTimeout(t); t = null; } };
  el.addEventListener('pointerdown', () => { t = setTimeout(() => setEditMode(true), 500); });
  el.addEventListener('pointerup', clear);
  el.addEventListener('pointerleave', clear);
  el.addEventListener('pointercancel', clear);
  el.addEventListener('click', (e) => {
    if (editMode || e.target.closest('.badge-remove')) return;
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
  iframe.setAttribute('allowtransparency', 'true');
  iframe.setAttribute('frameborder', '0');
  iframe.style.cssText = 'background:transparent!important;background-color:transparent!important;border:0;width:100%;height:100%;';
  iframe.addEventListener('load', () => {
    try {
      const doc = iframe.contentDocument;
      if (!doc) return;
      const s = doc.createElement('style');
      s.textContent = 'html,body{background:transparent!important;background-color:transparent!important;}';
      (doc.head || doc.documentElement).appendChild(s);
      if (doc.documentElement) doc.documentElement.style.background = 'transparent';
      if (doc.body) doc.body.style.background = 'transparent';
    } catch (_) {
      /* cross-origin — shell iframe stays transparent; page paints its own bg */
    }
  });
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
function setBrightness(v) {
  shell.style.filter = `brightness(${Number(v) / 100})`;
  localStorage.setItem(STORAGE_KEYS.brightness, String(v));
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
  statusBar.addEventListener('click', () => ccEl.classList.toggle('hidden'));
  let y0 = null;
  statusBar.addEventListener('touchstart', (e) => { y0 = e.touches[0].clientY; }, { passive: true });
  statusBar.addEventListener('touchmove', (e) => {
    if (y0 != null && e.touches[0].clientY - y0 > 20) ccEl.classList.remove('hidden');
  }, { passive: true });
  brightnessSlider.addEventListener('input', (e) => setBrightness(e.target.value));
  if (wallpaperSelect) wallpaperSelect.addEventListener('change', (e) => setWallpaper(e.target.value));
  document.addEventListener('click', (e) => {
    if (!ccEl.classList.contains('hidden') && !ccEl.contains(e.target) && !statusBar.contains(e.target)) ccEl.classList.add('hidden');
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
    if (d.type === 'registerApp' || d.type === 'unregisterApp') setTimeout(() => { rebuildCatalog(); renderHome(); }, 40);
  });
  window.addEventListener('storage', (e) => {
    if (e.key === 'WebDesk_custom_apps' || e.key === 'WebDesk_apps') { rebuildCatalog(); renderHome(); }
  });
}
boot();
bind();
