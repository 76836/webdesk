const STORAGE_KEYS = {
  layout: 'webdesk.mobile.v1.layout',
  wallpaper: 'webdesk.mobile.v1.wallpaper',
  brightness: 'webdesk.mobile.v1.brightness',
  appOrder: 'webdesk.mobile.v1.appOrder'
};

const APPS = [
  { id: 'settings', name: 'Settings', url: '../../programs/settings/index.html' },
  { id: 'files', name: 'Files', url: '../../v4/apps/files.html' },
  { id: 'terminal', name: 'Terminal', url: '../../programs/terminal/index.html' },
  { id: 'calculator', name: 'Calculator', url: '../../programs/calculator/index.html' },
  { id: 'market', name: 'Market', url: '../../programs/market/index.html' },
  { id: 'appmaker', name: 'App Maker', url: '../../v4/apps/appmaker.html' }
];

const shell = document.getElementById('phone-shell');
const pagesEl = document.getElementById('homescreen-pages');
const pageDotsEl = document.getElementById('page-dots');
const appLayer = document.getElementById('app-layer');
const appHost = document.getElementById('app-host');
const recentsEl = document.getElementById('recents');
const recentsListEl = document.getElementById('recents-list');
const ccEl = document.getElementById('control-center');
const statusBar = document.getElementById('status-bar');
const statusTime = document.getElementById('status-time');
const ccDate = document.getElementById('cc-date');
const brightnessSlider = document.getElementById('brightness-slider');
const wallpaperSelect = document.getElementById('wallpaper-select');

let frameRegistry = new Map();
let appHistory = [];
let currentApp = null;
let dragItem = null;

const defaultLayout = {
  pages: [
    ['search', 'settings', 'files', 'terminal', 'calculator'],
    ['market', 'appmaker']
  ]
};

function hydrateLayout() {
  const saved = safeParse(localStorage.getItem(STORAGE_KEYS.layout));
  return saved?.pages?.length ? saved : defaultLayout;
}

function renderHome() {
  pagesEl.innerHTML = '';
  pageDotsEl.innerHTML = '';
  const layout = hydrateLayout();

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
      const app = APPS.find((a) => a.id === itemId);
      if (!app) return;
      const icon = document.getElementById('app-icon-template').content.firstElementChild.cloneNode(true);
      icon.dataset.itemId = app.id;
      icon.querySelector('.app-name').textContent = app.name;
      icon.addEventListener('click', () => openApp(app.id));
      bindDrag(icon);
      page.append(icon);
    });

    pagesEl.append(page);
    const dot = document.createElement('span');
    if (pageIdx === 0) dot.classList.add('active');
    pageDotsEl.append(dot);
  });
}

function bindDrag(el) {
  el.addEventListener('dragstart', () => {
    dragItem = { id: el.dataset.itemId, type: el.dataset.itemType, sourcePage: el.closest('.home-page')?.dataset.page };
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
  localStorage.setItem(STORAGE_KEYS.layout, JSON.stringify(layout));
  renderHome();
}

function ensureAppFrame(appId) {
  if (frameRegistry.has(appId)) return frameRegistry.get(appId);
  const app = APPS.find((a) => a.id === appId);
  const iframe = document.createElement('iframe');
  iframe.title = app.name;
  iframe.src = app.url;
  iframe.dataset.app = appId;
  iframe.classList.add('hidden');
  appHost.append(iframe);
  frameRegistry.set(appId, iframe);
  return iframe;
}

function openApp(appId) {
  const next = ensureAppFrame(appId);
  for (const frame of frameRegistry.values()) frame.classList.add('hidden');
  next.classList.remove('hidden');
  currentApp = appId;
  if (!appHistory.includes(appId)) appHistory.unshift(appId);
  else appHistory = [appId, ...appHistory.filter((x) => x !== appId)];
  appLayer.classList.remove('hidden');
  recentsEl.classList.add('hidden');
}

function closeApp(appId) {
  const frame = frameRegistry.get(appId);
  if (!frame) return;
  frame.remove();
  frameRegistry.delete(appId);
  appHistory = appHistory.filter((x) => x !== appId);
  if (currentApp === appId) {
    currentApp = null;
    appLayer.classList.add('hidden');
  }
}

function goHome() {
  appLayer.classList.add('hidden');
  recentsEl.classList.add('hidden');
}

function showRecents() {
  recentsEl.classList.remove('hidden');
  appLayer.classList.add('hidden');
  renderRecents();
}

function renderRecents() {
  recentsListEl.innerHTML = '';
  if (!appHistory.length) {
    recentsListEl.innerHTML = '<p>No recent apps yet.</p>';
    return;
  }
  appHistory.forEach((appId) => {
    const app = APPS.find((a) => a.id === appId);
    const card = document.createElement('button');
    card.className = 'recents-card';
    card.innerHTML = `<strong>${app.name}</strong><div>Tap to resume existing session</div>`;
    card.addEventListener('click', () => openApp(appId));
    recentsListEl.append(card);
  });
}

function filterApps(query) {
  const q = query.trim().toLowerCase();
  document.querySelectorAll('.app-icon').forEach((el) => {
    const visible = el.querySelector('.app-name').textContent.toLowerCase().includes(q);
    el.style.display = visible ? '' : 'none';
  });
}

function safeParse(value) {
  try { return JSON.parse(value); } catch { return null; }
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
  shell.style.filter = `brightness(${Number(value) / 100})`;
  localStorage.setItem(STORAGE_KEYS.brightness, String(value));
}

function bootState() {
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
    frame?.contentWindow?.history?.back();
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
  statusBar.addEventListener('touchstart', (e) => { y0 = e.touches[0].clientY; }, { passive: true });
  statusBar.addEventListener('touchmove', (e) => {
    if (y0 !== null && e.touches[0].clientY - y0 > 18) ccEl.classList.remove('hidden');
  }, { passive: true });

  brightnessSlider.addEventListener('input', (e) => applyBrightness(e.target.value));
  wallpaperSelect.addEventListener('change', (e) => setWallpaper(e.target.value));

  document.addEventListener('click', (e) => {
    if (!ccEl.classList.contains('hidden') && !ccEl.contains(e.target) && !statusBar.contains(e.target)) {
      ccEl.classList.add('hidden');
    }
  });

  pagesEl.addEventListener('scroll', () => {
    const i = Math.round(pagesEl.scrollLeft / pagesEl.clientWidth);
    [...pageDotsEl.children].forEach((dot, idx) => dot.classList.toggle('active', idx === i));
  });

  document.getElementById('tile-fullscreen').addEventListener('click', async (e) => {
    if (!document.fullscreenElement) await document.documentElement.requestFullscreen();
    else await document.exitFullscreen();
    e.currentTarget.classList.toggle('active', !!document.fullscreenElement);
  });

  ['tile-wifi', 'tile-bt', 'tile-rotation'].forEach((id) => {
    document.getElementById(id).addEventListener('click', (e) => e.currentTarget.classList.toggle('active'));
  });

  window.addEventListener('message', (event) => {
    const data = event.data;
    if (!data || typeof data !== 'object') return;
    if (data.type === 'webdesk:set-wallpaper' && typeof data.wallpaper === 'string') {
      wallpaperSelect.value = data.wallpaper;
      setWallpaper(data.wallpaper);
    }
  });
}

bootState();
bindControls();
