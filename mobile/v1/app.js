/**
 * WebDesk Mobile v1 — Android-style shell with App Center + desktop storage parity.
 */
const STORAGE_KEYS = {
  layout: 'webdesk.mobile.v1.layout',
  wallpaper: 'webdesk.mobile.v1.wallpaper',
  brightness: 'webdesk.mobile.v1.brightness',
  dock: 'webdesk.mobile.v1.dock'
};

/** Built-in apps (relative paths work on Pages under /webdesk/mobile/v1/) */
const BUILTIN_APPS = [
  {
    id: 'settings',
    name: 'Settings',
    url: '../../programs/settings/index.html',
    glyph: '⚙️',
    iconUrl: '../../images/icons/settings.png'
  },
  {
    id: 'files',
    name: 'Files',
    url: '../../v4/apps/files.html',
    glyph: '📁',
    iconUrl: '../../images/icons/files.png'
  },
  {
    id: 'terminal',
    name: 'Terminal',
    url: '../../programs/terminal/index.html',
    glyph: '💻',
    iconUrl: '../../programs/terminal/apple-touch-icon.png'
  },
  {
    id: 'calculator',
    name: 'Calculator',
    url: '../../programs/calculator/index.html',
    glyph: '🔢',
    iconUrl: 'https://76836.github.io/CalculatorXP/icon.png'
  },
  {
    id: 'market',
    name: 'Market',
    url: '../../programs/market/index.html',
    glyph: '🛒',
    iconUrl: '../../programs/market/apple-touch-icon.png'
  },
  {
    id: 'appmaker',
    name: 'AppCenter',
    url: '../../v4/apps/appmaker.html',
    glyph: '🧩',
    iconUrl: 'https://76836.github.io/AppCenter/apple-touch-icon.png'
  }
];

const DEFAULT_LAYOUT = {
  pages: [
    ['search', 'settings', 'files', 'terminal', 'calculator'],
    ['market', 'appmaker']
  ]
};

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
const wallpaperSelect = document.getElementById('wallpaper-select');

let appCatalog = []; // merged builtins + App Center / desktop installs
let frameRegistry = new Map();
let appHistory = [];
let currentApp = null;
let dragItem = null;
let editMode = false;

function safeParse(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

/** Same keys desktop AppCenter / WebDesk v4 use */
function loadInstalledFromDesktopStorage() {
  const out = [];
  const sources = ['WebDesk_custom_apps', 'WebDesk_apps'];
  for (const key of sources) {
    const raw = safeParse(localStorage.getItem(key));
    if (!Array.isArray(raw)) continue;
    for (const entry of raw) {
      const id = entry.id || entry.config?.id;
      const cfg = entry.config || entry;
      if (!id || !cfg) continue;
      const title = cfg.title || cfg.name || id;
      const url = cfg.url;
      if (!url) continue;
      out.push({
        id: String(id),
        name: title,
        url,
        iconUrl: cfg.iconUrl || cfg.icon || null,
        glyph: '📦',
        fromStore: true
      });
    }
  }
  return out;
}

function rebuildCatalog() {
  const map = new Map();
  for (const a of BUILTIN_APPS) map.set(a.id, { ...a });
  for (const a of loadInstalledFromDesktopStorage()) {
    // Prefer store entry for URL/icon but keep stable id
    map.set(a.id, { ...map.get(a.id), ...a });
  }
  appCatalog = Array.from(map.values());
  return appCatalog;
}

function getApp(appId) {
  return appCatalog.find((a) => a.id === appId) || null;
}

function hydrateLayout() {
  const saved = safeParse(localStorage.getItem(STORAGE_KEYS.layout));
  if (saved?.pages?.length) return saved;
  return JSON.parse(JSON.stringify(DEFAULT_LAYOUT));
}

function saveLayout(layout) {
  localStorage.setItem(STORAGE_KEYS.layout, JSON.stringify(layout));
}

function hydrateDock() {
  const saved = safeParse(localStorage.getItem(STORAGE_KEYS.dock));
  return Array.isArray(saved) && saved.length ? saved : [...DEFAULT_DOCK];
}

function saveDock(ids) {
  localStorage.setItem(STORAGE_KEYS.dock, JSON.stringify(ids));
}

function applyIcon(el, app) {
  const img = el.querySelector('.app-img');
  const glyph = el.querySelector('.app-glyph');
  el.querySelector('.app-name').textContent = app.name;
  if (app.iconUrl) {
    img.src = app.iconUrl;
    img.alt = app.name;
    img.classList.remove('hidden');
    glyph.classList.add('hidden');
    img.onerror = () => {
      img.classList.add('hidden');
      glyph.classList.remove('hidden');
      glyph.textContent = app.glyph || '📦';
    };
  } else {
    img.classList.add('hidden');
    glyph.classList.remove('hidden');
    glyph.textContent = app.glyph || '📦';
  }
}

function createAppIcon(app, { inDock = false } = {}) {
  const icon = document.getElementById('app-icon-template').content.firstElementChild.cloneNode(true);
  icon.dataset.itemId = app.id;
  applyIcon(icon, app);

  const removeBtn = icon.querySelector('.remove-from-home');
  removeBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    removeFromHome(app.id);
  });

  let longPressTimer = null;
  const clearLp = () => {
    if (longPressTimer) {
      clearTimeout(longPressTimer);
      longPressTimer = null;
    }
  };
  icon.addEventListener('pointerdown', () => {
    longPressTimer = setTimeout(() => setEditMode(true), 520);
  });
  icon.addEventListener('pointerup', clearLp);
  icon.addEventListener('pointerleave', clearLp);
  icon.addEventListener('pointercancel', clearLp);

  icon.addEventListener('click', (e) => {
    if (editMode) return;
    if (e.target.closest('.remove-from-home')) return;
    openApp(app.id);
  });

  if (!inDock) bindDrag(icon);
  return icon;
}

function renderHome() {
  rebuildCatalog();
  pagesEl.innerHTML = '';
  pageDotsEl.innerHTML = '';
  const layout = hydrateLayout();

  // Ensure every installed app appears somewhere if missing from layout (first page)
  const placed = new Set();
  layout.pages.forEach((p) => p.forEach((id) => placed.add(id)));
  const missing = appCatalog.filter((a) => a.fromStore && !placed.has(a.id));
  if (missing.length) {
    if (!layout.pages.length) layout.pages.push([]);
    missing.forEach((a) => layout.pages[layout.pages.length - 1].push(a.id));
    saveLayout(layout);
  }

  layout.pages.forEach((items, pageIdx) => {
    const page = document.getElementById('home-page-template').content.firstElementChild.cloneNode(true);
    page.dataset.page = String(pageIdx);
    bindDrop(page);

    items.forEach((itemId) => {
      if (itemId === 'search') {
        const search = document.getElementById('search-widget-template').content.firstElementChild.cloneNode(true);
        search.dataset.itemId = 'search';
        bindDrag(search);
        search.querySelector('input').addEventListener('input', (e) => filterApps(e.target.value));
        page.append(search);
        return;
      }
      const app = getApp(itemId);
      if (!app) return;
      page.append(createAppIcon(app));
    });

    pagesEl.append(page);
    const dot = document.createElement('span');
    if (pageIdx === 0) dot.classList.add('active');
    pageDotsEl.append(dot);
  });

  renderDock();
}

function renderDock() {
  dockEl.innerHTML = '';
  hydrateDock().forEach((id) => {
    const app = getApp(id);
    if (!app) return;
    dockEl.append(createAppIcon(app, { inDock: true }));
  });
}

function bindDrag(el) {
  el.addEventListener('dragstart', () => {
    dragItem = {
      id: el.dataset.itemId,
      sourcePage: el.closest('.home-page')?.dataset.page
    };
  });
}

function bindDrop(page) {
  page.addEventListener('dragover', (e) => {
    e.preventDefault();
    page.classList.add('drag-over');
  });
  page.addEventListener('dragleave', () => page.classList.remove('drag-over'));
  page.addEventListener('drop', (e) => {
    e.preventDefault();
    page.classList.remove('drag-over');
    if (!dragItem) return;
    moveItemToPage(dragItem.id, Number(dragItem.sourcePage), Number(page.dataset.page));
    dragItem = null;
  });
}

function moveItemToPage(itemId, fromPage, toPage) {
  const layout = hydrateLayout();
  if (Number.isNaN(fromPage) || Number.isNaN(toPage) || fromPage === toPage) return;
  layout.pages[fromPage] = layout.pages[fromPage].filter((x) => x !== itemId);
  layout.pages[toPage].push(itemId);
  saveLayout(layout);
  renderHome();
}

function removeFromHome(appId) {
  const layout = hydrateLayout();
  layout.pages = layout.pages.map((p) => p.filter((x) => x !== appId));
  // drop empty pages except first
  layout.pages = layout.pages.filter((p, i) => i === 0 || p.length > 0);
  if (!layout.pages.length) layout.pages = [[]];
  saveLayout(layout);
  renderHome();
}

function addToHome(appId) {
  const layout = hydrateLayout();
  if (layout.pages.some((p) => p.includes(appId))) return;
  let page = layout.pages[layout.pages.length - 1];
  if (!page) {
    page = [];
    layout.pages.push(page);
  }
  // ~11 slots max excluding search (4x3-ish)
  if (page.filter((x) => x !== 'search').length >= 11) {
    page = [];
    layout.pages.push(page);
  }
  page.push(appId);
  saveLayout(layout);
  renderHome();
}

function setEditMode(on) {
  editMode = !!on;
  homeEl.classList.toggle('edit-mode', editMode);
  const btn = document.getElementById('btn-edit-home');
  const addBtn = document.getElementById('btn-add-app');
  btn.setAttribute('aria-pressed', editMode ? 'true' : 'false');
  btn.textContent = editMode ? 'Done' : 'Edit home';
  addBtn.classList.toggle('hidden', !editMode);
}

function openAppPicker() {
  rebuildCatalog();
  appPickerList.innerHTML = '';
  const layout = hydrateLayout();
  const onHome = new Set(layout.pages.flat());
  appCatalog.forEach((app) => {
    const row = createAppIcon(app);
    if (onHome.has(app.id)) {
      row.style.opacity = '0.45';
    }
    row.addEventListener('click', (e) => {
      e.stopPropagation();
      addToHome(app.id);
      openAppPicker(); // refresh dimming
    });
    // remove long-press / open behavior for picker clones
    appPickerList.append(row);
  });
  appPickerEl.classList.remove('hidden');
}

function ensureAppFrame(appId) {
  if (frameRegistry.has(appId)) return frameRegistry.get(appId);
  const app = getApp(appId);
  if (!app) return null;
  const iframe = document.createElement('iframe');
  iframe.title = app.name;
  iframe.src = app.url;
  iframe.dataset.app = appId;
  iframe.classList.add('hidden');
  iframe.allow = 'clipboard-read; clipboard-write; fullscreen';
  appHost.append(iframe);
  frameRegistry.set(appId, iframe);
  return iframe;
}

function openApp(appId) {
  rebuildCatalog();
  const next = ensureAppFrame(appId);
  if (!next) return;
  for (const frame of frameRegistry.values()) frame.classList.add('hidden');
  next.classList.remove('hidden');
  currentApp = appId;
  appHistory = [appId, ...appHistory.filter((x) => x !== appId)];
  appLayer.classList.remove('hidden');
  recentsEl.classList.add('hidden');
  appPickerEl.classList.add('hidden');
  setEditMode(false);
}

function closeApp(appId) {
  const frame = frameRegistry.get(appId);
  if (frame) {
    frame.remove();
    frameRegistry.delete(appId);
  }
  appHistory = appHistory.filter((x) => x !== appId);
  if (currentApp === appId) {
    currentApp = null;
    appLayer.classList.add('hidden');
  }
  if (!recentsEl.classList.contains('hidden')) renderRecents();
}

function goHome() {
  appLayer.classList.add('hidden');
  recentsEl.classList.add('hidden');
  appPickerEl.classList.add('hidden');
}

function showRecents() {
  recentsEl.classList.remove('hidden');
  appLayer.classList.add('hidden');
  appPickerEl.classList.add('hidden');
  renderRecents();
}

function renderRecents() {
  recentsListEl.innerHTML = '';
  if (!appHistory.length) {
    recentsListEl.innerHTML = '<p style="padding:24px;opacity:.6">No recent apps yet.</p>';
    return;
  }
  appHistory.forEach((appId) => {
    const app = getApp(appId);
    if (!app) return;
    const card = document.createElement('div');
    card.className = 'recents-card';
    card.innerHTML = `
      <div class="recents-card-top">
        ${app.iconUrl ? `<img src="${app.iconUrl}" alt="" onerror="this.style.display='none'" />` : `<span class="glyph">${app.glyph || '📦'}</span>`}
        <span class="name">${app.name}</span>
        <button type="button" class="close-x" aria-label="Close ${app.name}">×</button>
      </div>
      <div class="recents-preview">
        <div class="preview-label">Tap to resume · ${app.name}</div>
      </div>
    `;
    card.querySelector('.close-x').addEventListener('click', (e) => {
      e.stopPropagation();
      closeApp(appId);
    });
    card.addEventListener('click', (e) => {
      if (e.target.closest('.close-x')) return;
      openApp(appId);
    });
    recentsListEl.append(card);
  });
}

function filterApps(query) {
  const q = query.trim().toLowerCase();
  document.querySelectorAll('.home-page .app-icon').forEach((el) => {
    const name = el.querySelector('.app-name')?.textContent?.toLowerCase() || '';
    el.style.display = !q || name.includes(q) ? '' : 'none';
  });
}

function updateClocks() {
  const now = new Date();
  statusTime.textContent = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  ccDate.textContent = now.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
}

function setWallpaper(name) {
  shell.classList.remove('wallpaper-default', 'wallpaper-water', 'wallpaper-foreshadowing');
  shell.classList.add(`wallpaper-${name}`);
  localStorage.setItem(STORAGE_KEYS.wallpaper, name);
}

function applyBrightness(value) {
  const v = Number(value);
  shell.style.filter = `brightness(${v / 100})`;
  localStorage.setItem(STORAGE_KEYS.brightness, String(v));
}

function bootState() {
  rebuildCatalog();
  const wallpaper = localStorage.getItem(STORAGE_KEYS.wallpaper) || 'default';
  wallpaperSelect.value = wallpaper;
  setWallpaper(wallpaper);
  const brightness = localStorage.getItem(STORAGE_KEYS.brightness) || '100';
  brightnessSlider.value = brightness;
  applyBrightness(brightness);
  renderHome();
  updateClocks();
  setInterval(updateClocks, 30000);
}

function bindControls() {
  document.getElementById('nav-home').addEventListener('click', goHome);
  document.getElementById('nav-recents').addEventListener('click', showRecents);
  document.getElementById('nav-back').addEventListener('click', () => {
    const frame = frameRegistry.get(currentApp);
    try {
      frame?.contentWindow?.history?.back();
    } catch (_) {}
  });

  document.getElementById('btn-edit-home').addEventListener('click', () => setEditMode(!editMode));
  document.getElementById('btn-add-app').addEventListener('click', openAppPicker);
  document.getElementById('btn-close-picker').addEventListener('click', () => {
    appPickerEl.classList.add('hidden');
  });
  document.getElementById('btn-clear-recents').addEventListener('click', () => {
    [...appHistory].forEach((id) => closeApp(id));
    appHistory = [];
    renderRecents();
  });

  document.querySelectorAll('[data-window-action]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const action = btn.dataset.windowAction;
      if (!currentApp) return;
      if (action === 'close') closeApp(currentApp);
      if (action === 'minimize') goHome();
      if (action === 'maximize') appLayer.classList.toggle('maximized');
    });
  });

  statusBar.addEventListener('click', () => ccEl.classList.toggle('hidden'));
  let y0 = null;
  statusBar.addEventListener(
    'touchstart',
    (e) => {
      y0 = e.touches[0].clientY;
    },
    { passive: true }
  );
  statusBar.addEventListener(
    'touchmove',
    (e) => {
      if (y0 !== null && e.touches[0].clientY - y0 > 18) ccEl.classList.remove('hidden');
    },
    { passive: true }
  );

  brightnessSlider.addEventListener('input', (e) => applyBrightness(e.target.value));
  wallpaperSelect.addEventListener('change', (e) => setWallpaper(e.target.value));

  document.addEventListener('click', (e) => {
    if (!ccEl.classList.contains('hidden') && !ccEl.contains(e.target) && !statusBar.contains(e.target)) {
      ccEl.classList.add('hidden');
    }
  });

  pagesEl.addEventListener('scroll', () => {
    const i = Math.round(pagesEl.scrollLeft / Math.max(1, pagesEl.clientWidth));
    [...pageDotsEl.children].forEach((dot, idx) => dot.classList.toggle('active', idx === i));
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

  // AppCenter / desktop install bridge
  window.addEventListener('message', (event) => {
    const data = event.data;
    if (!data || typeof data !== 'object') return;
    if (data.type === 'webdesk:set-wallpaper' && typeof data.wallpaper === 'string') {
      wallpaperSelect.value = data.wallpaper;
      setWallpaper(data.wallpaper);
    }
    if (data.type === 'registerApp' || data.type === 'unregisterApp') {
      // App maker already writes localStorage; refresh home so icons appear
      setTimeout(() => {
        rebuildCatalog();
        renderHome();
      }, 50);
    }
  });

  // Cross-tab: desktop AppCenter install while mobile open
  window.addEventListener('storage', (e) => {
    if (e.key === 'WebDesk_custom_apps' || e.key === 'WebDesk_apps') {
      rebuildCatalog();
      renderHome();
    }
  });
}

bootState();
bindControls();
