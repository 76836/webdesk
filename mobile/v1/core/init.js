import WindowManager from './windowManager.js';
import { UIManager, initQuickSettings } from './uiManager.js';

const APPS = [
  { id: 'files', title: 'Files', icon: '../../images/icons/files.png', url: './apps/files.html' },
  { id: 'settings', title: 'Settings', icon: '../../images/icons/settings.png', url: './apps/settings.html' },
  { id: 'appcenter', title: 'App Center', icon: '../../images/icons/PWR.png', url: './apps/appmaker.html' },
  { id: 'webdesk', title: 'WebDesk', icon: '../../images/icons/PWR.png', url: '../../v4/index.html' }
];

const HOME_KEY = 'WebDesk_mobile_home_layout_v1';
const WALL_KEY = 'WebDesk_mobile_wallpaper_v1';

const els = {
  wallpaper: document.getElementById('wallpaper'),
  homePages: document.getElementById('homePages'),
  pageDots: document.getElementById('pageDots'),
  statusTime: document.getElementById('statusTime'),
  statusBar: document.getElementById('statusBar'),
  controlCenter: document.getElementById('controlCenter'),
  appSurface: document.getElementById('appSurface'),
  recents: document.getElementById('recents'),
  recentsList: document.getElementById('recentsList'),
  backBtn: document.getElementById('backBtn'),
  homeBtn: document.getElementById('homeBtn'),
  recentsBtn: document.getElementById('recentsBtn')
};

const wm = new WindowManager({ appSurface: els.appSurface, recentsList: els.recentsList });
const ui = new UIManager({
  statusTime: els.statusTime,
  statusBar: els.statusBar,
  controlCenter: els.controlCenter,
  recents: els.recents,
  homePages: els.homePages,
  pageDots: els.pageDots
});

let editMode = false;
let layout = loadLayout();

APPS.forEach((app) => wm.registerApp(app));
renderHome();
ui.init(() => ui.toggleControlCenter(true));
ui.renderDots();

initQuickSettings({
  controlCenter: els.controlCenter,
  wallpaperEl: els.wallpaper,
  onToggleEdit: (on) => {
    editMode = on;
    renderHome();
  }
});

els.homeBtn.addEventListener('click', () => {
  wm.minimizeAll();
  ui.showRecents(false);
});
els.recentsBtn.addEventListener('click', () => {
  wm.renderRecents();
  ui.showRecents(els.recents.classList.contains('hidden'));
});
els.backBtn.addEventListener('click', () => wm.goBack());

window.addEventListener('message', (event) => {
  const data = event.data || {};
  if (data.type === 'setWallpaper' && data.wallpaper) {
    setWallpaper(data.wallpaper);
  }
});

const savedWallpaper = localStorage.getItem(WALL_KEY);
if (savedWallpaper) setWallpaper(savedWallpaper);

function loadLayout() {
  try {
    const parsed = JSON.parse(localStorage.getItem(HOME_KEY) || '');
    if (Array.isArray(parsed?.pages)) return parsed;
  } catch {}

  return {
    pages: [
      [{ type: 'widget', id: 'search' }, ...APPS.slice(0, 3).map((a) => ({ type: 'app', id: a.id }))],
      APPS.slice(3).map((a) => ({ type: 'app', id: a.id }))
    ]
  };
}

function saveLayout() {
  localStorage.setItem(HOME_KEY, JSON.stringify(layout));
}

function renderHome() {
  els.homePages.innerHTML = '';

  layout.pages.forEach((pageItems, pageIndex) => {
    const page = document.createElement('div');
    page.className = 'homePage';

    pageItems.forEach((item, itemIndex) => {
      const node = document.createElement('button');
      node.className = `homeItem ${item.type === 'widget' ? 'widget' : ''} ${editMode ? 'editing' : ''}`;
      node.dataset.page = String(pageIndex);
      node.dataset.index = String(itemIndex);

      if (item.type === 'widget') {
        node.innerHTML = '<span class="label">Search apps</span>';
      } else {
        const app = APPS.find((a) => a.id === item.id);
        if (!app) return;
        node.innerHTML = `<span class="icon" style="background-image:url('${app.icon}')"></span><span class="label">${app.title}</span>`;
        node.addEventListener('click', () => {
          if (editMode) return;
          wm.openApp(app.id);
          ui.toggleControlCenter(false);
          ui.showRecents(false);
        });
      }

      if (editMode) enableDragging(node);
      page.appendChild(node);
    });

    els.homePages.appendChild(page);
  });

  ui.renderDots();
}

function enableDragging(node) {
  node.addEventListener('pointerdown', (startEvent) => {
    let moved = false;

    const move = (e) => {
      moved = true;
      const target = document.elementFromPoint(e.clientX, e.clientY)?.closest('.homeItem');
      if (!target || target === node) return;

      const fromPage = Number(node.dataset.page);
      const fromIndex = Number(node.dataset.index);
      const toPage = Number(target.dataset.page);
      const toIndex = Number(target.dataset.index);

      const [movedItem] = layout.pages[fromPage].splice(fromIndex, 1);
      layout.pages[toPage].splice(toIndex, 0, movedItem);

      saveLayout();
      renderHome();
      cleanup();
    };

    const up = () => cleanup();

    const cleanup = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      if (moved) saveLayout();
    };

    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up, { once: true });
    startEvent.preventDefault();
  });
}

function setWallpaper(src) {
  els.wallpaper.style.backgroundImage = `url('${src}')`;
  localStorage.setItem(WALL_KEY, src);
}
