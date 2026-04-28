import WindowManager from './windowManager.js';
import AppManager from './appManager.js';
import { UIManager, QuickSettings } from './uiManager.js';

const SETTINGS_APP_URL = new URL('../apps/settings.html', import.meta.url).href;
const FILES_APP_URL = new URL('../apps/files.html', import.meta.url).href;
const APPMAKER_APP_URL = new URL('../apps/appmaker.html', import.meta.url).href;
const HOME_LAYOUT_KEY = 'WebDesk_mobile_layout';
const WALLPAPER_KEY = 'wallpaper';
const PAGE_SIZE = 12;

const HOME_WIDGET = 'widget:search';

const state = {
    pageIndex: 0,
    dragging: null
};

function normalizeAppUrl(url) {
    if (!url) return 'about:blank';
    if (/^https?:\/\//i.test(url) || url.startsWith('about:')) return url;
    if (url.includes('/apps/settings')) return SETTINGS_APP_URL;
    if (url.includes('/apps/files')) return FILES_APP_URL;
    if (url.includes('/apps/appmaker')) return APPMAKER_APP_URL;
    return new URL(url, window.location.href).href;
}

function getLayout() {
    try {
        const parsed = JSON.parse(localStorage.getItem(HOME_LAYOUT_KEY) || '[]');
        return Array.isArray(parsed) ? parsed.filter(Array.isArray) : [];
    } catch {
        return [];
    }
}

function saveLayout(layout) {
    localStorage.setItem(HOME_LAYOUT_KEY, JSON.stringify(layout));
}

function chunk(items, size) {
    const pages = [];
    for (let i = 0; i < items.length; i += size) pages.push(items.slice(i, i + size));
    return pages.length ? pages : [[]];
}

function buildDefaultLayout(windowManager) {
    const appIds = Array.from(windowManager.appConfigs.keys());
    const ordered = [HOME_WIDGET, ...appIds];
    return chunk(ordered, PAGE_SIZE);
}

function ensureLayoutIntegrity(windowManager) {
    const knownIds = new Set(windowManager.appConfigs.keys());
    const rawLayout = getLayout();
    const flattened = rawLayout.flat().filter((itemId) => itemId === HOME_WIDGET || knownIds.has(itemId));

    if (!flattened.includes(HOME_WIDGET)) flattened.unshift(HOME_WIDGET);

    Array.from(knownIds).forEach((id) => {
        if (!flattened.includes(id)) flattened.push(id);
    });

    const pages = chunk(flattened, PAGE_SIZE);
    saveLayout(pages);
    return pages;
}

function applyWallpaper() {
    const wallpaperLayer = document.getElementById('wallpaper-layer');
    const wallpaper = localStorage.getItem(WALLPAPER_KEY) || 'https://76836.github.io/webdesk/images/wallpapers/water.png';
    if (wallpaperLayer) wallpaperLayer.style.backgroundImage = `url('${wallpaper}')`;
}

function createSearchWidget(windowManager) {
    const wrapper = document.createElement('div');
    wrapper.className = 'home-item search-widget';
    wrapper.dataset.itemId = HOME_WIDGET;
    wrapper.innerHTML = `
        <span class="search-icon">🔎</span>
        <input type="text" placeholder="Search apps" aria-label="Search apps">
    `;

    wrapper.querySelector('input')?.addEventListener('input', (event) => {
        const query = event.target.value.toLowerCase().trim();
        if (!query) return;

        const match = Array.from(windowManager.appConfigs.entries())
            .find(([, config]) => (config.title || '').toLowerCase().includes(query));

        if (match) {
            windowManager.createWindow(match[0], match[1]);
            event.target.value = '';
            event.target.blur();
        }
    });

    return wrapper;
}

function createAppIcon(windowManager, appId, config) {
    const appDiv = document.createElement('button');
    appDiv.type = 'button';
    appDiv.className = 'home-item launcher-app';
    appDiv.dataset.itemId = appId;
    appDiv.innerHTML = `
        <div class="launcher-app-icon"></div>
        <span class="launcher-app-name">${config.title}</span>
    `;

    const iconDiv = appDiv.querySelector('.launcher-app-icon');

    if (config.iconUrl) {
        const img = document.createElement('img');
        img.src = config.iconUrl;
        img.alt = config.title;
        img.addEventListener('error', () => {
            iconDiv.innerHTML = windowManager.generateIcon(config.title);
        });
        iconDiv.appendChild(img);
    } else {
        iconDiv.innerHTML = windowManager.generateIcon(config.title);
    }

    appDiv.addEventListener('click', () => {
        if (state.dragging) return;
        windowManager.createWindow(appId, config);
    });

    return appDiv;
}

function moveItem(layout, fromPage, fromIndex, toPage, toIndex) {
    if (!layout[fromPage] || !layout[toPage]) return layout;
    const [item] = layout[fromPage].splice(fromIndex, 1);
    if (!item) return layout;
    layout[toPage].splice(toIndex, 0, item);
    return layout;
}

function setupItemDrag(item, pageIndex, itemIndex, windowManager) {
    let holdTimer = null;

    item.addEventListener('pointerdown', () => {
        if (!document.body.classList.contains('home-edit-unlocked')) return;
        holdTimer = setTimeout(() => {
            state.dragging = { id: item.dataset.itemId, fromPage: pageIndex, fromIndex: itemIndex };
            item.classList.add('dragging');
        }, 260);
    });

    item.addEventListener('pointerup', () => {
        clearTimeout(holdTimer);
        if (!state.dragging) return;

        const pages = ensureLayoutIntegrity(windowManager);
        const currentLayout = pages.map((page) => [...page]);
        const targetPage = Number(item.closest('.home-page')?.dataset.pageIndex || state.dragging.fromPage);
        const targetIndex = Number(item.dataset.itemIndex || 0);

        moveItem(currentLayout, state.dragging.fromPage, state.dragging.fromIndex, targetPage, targetIndex);
        saveLayout(currentLayout);
        state.dragging = null;
        renderHome(windowManager);
    });

    item.addEventListener('pointercancel', () => clearTimeout(holdTimer));
    item.addEventListener('pointerleave', () => clearTimeout(holdTimer));
}

function renderPageIndicators(pageCount) {
    const indicator = document.getElementById('page-indicators');
    if (!indicator) return;
    indicator.innerHTML = '';

    for (let i = 0; i < pageCount; i += 1) {
        const dot = document.createElement('div');
        dot.className = `page-dot ${i === state.pageIndex ? 'active' : ''}`;
        dot.addEventListener('click', () => {
            state.pageIndex = i;
            updatePagePosition();
        });
        indicator.appendChild(dot);
    }
}

function updatePagePosition() {
    const track = document.getElementById('home-pages-track');
    if (!track) return;
    track.style.transform = `translateX(-${state.pageIndex * 100}%)`;
    document.querySelectorAll('#page-indicators .page-dot').forEach((dot, index) => {
        dot.classList.toggle('active', index === state.pageIndex);
    });
}

function setupPageSwipe() {
    const track = document.getElementById('home-pages-track');
    if (!track || track.dataset.swipeBound === 'yes') return;

    let startX = 0;
    track.addEventListener('pointerdown', (event) => { startX = event.clientX; });
    track.addEventListener('pointerup', (event) => {
        const delta = event.clientX - startX;
        const pageCount = track.children.length;
        if (delta > 35) state.pageIndex = Math.max(0, state.pageIndex - 1);
        if (delta < -35) state.pageIndex = Math.min(pageCount - 1, state.pageIndex + 1);
        updatePagePosition();
    });

    track.dataset.swipeBound = 'yes';
}

function renderHome(windowManager) {
    const pages = ensureLayoutIntegrity(windowManager);
    const track = document.getElementById('home-pages-track');
    if (!track) return;
    track.innerHTML = '';

    pages.forEach((pageItems, pageIndex) => {
        const page = document.createElement('div');
        page.className = 'home-page';
        page.dataset.pageIndex = String(pageIndex);

        pageItems.forEach((itemId, itemIndex) => {
            const item = itemId === HOME_WIDGET
                ? createSearchWidget(windowManager)
                : createAppIcon(windowManager, itemId, windowManager.appConfigs.get(itemId));

            item.dataset.itemIndex = String(itemIndex);
            setupItemDrag(item, pageIndex, itemIndex, windowManager);
            page.appendChild(item);
        });

        track.appendChild(page);
    });

    if (state.pageIndex >= pages.length) state.pageIndex = pages.length - 1;
    renderPageIndicators(pages.length);
    updatePagePosition();
    setupPageSwipe();
}

function renderAppSwitcher(windowManager) {
    const list = document.getElementById('switcher-list');
    if (!list) return;
    list.innerHTML = '';

    const windows = windowManager.getWindowsInRecentsOrder();
    windows.forEach((win) => {
        const config = windowManager.appConfigs.get(win.id);
        const card = document.createElement('article');
        card.className = 'switcher-card';
        card.innerHTML = `
            <div>
                <strong>${config?.title || win.id}</strong>
                <div class="tile-sublabel">${win.state === 'minimized' ? 'Paused in background' : 'Running'}</div>
            </div>
            <div class="switcher-card-preview"></div>
        `;

        const actions = document.createElement('div');
        actions.className = 'switcher-card-actions';

        const openButton = document.createElement('button');
        openButton.className = 'switcher-open';
        openButton.textContent = 'Open';
        openButton.addEventListener('click', () => {
            windowManager.restoreWindow(win.id);
            document.getElementById('app-switcher')?.classList.add('hidden');
        });

        const closeButton = document.createElement('button');
        closeButton.className = 'switcher-close';
        closeButton.textContent = 'Close';
        closeButton.addEventListener('click', () => {
            windowManager.closeWindow(win.id);
            renderAppSwitcher(windowManager);
        });

        actions.append(openButton, closeButton);
        card.appendChild(actions);
        list.appendChild(card);
    });

    if (!windows.length) {
        const emptyCard = document.createElement('div');
        emptyCard.className = 'switcher-card';
        emptyCard.innerHTML = '<strong>No recent apps</strong><div class="tile-sublabel">Open an app from the home screen.</div>';
        list.appendChild(emptyCard);
    }
}

function setupNavigation(windowManager) {
    document.getElementById('nav-home')?.addEventListener('click', () => {
        windowManager.minimizeAll();
        document.getElementById('app-switcher')?.classList.add('hidden');
    });

    document.getElementById('nav-recents')?.addEventListener('click', () => {
        const switcher = document.getElementById('app-switcher');
        if (!switcher) return;
        renderAppSwitcher(windowManager);
        switcher.classList.toggle('hidden');
    });

    document.getElementById('nav-back')?.addEventListener('click', () => {
        const active = windowManager.activeWindowId ? windowManager.openWindows.get(windowManager.activeWindowId) : null;
        const frame = active?.element.querySelector('iframe');

        try {
            frame?.contentWindow?.history.back();
        } catch {
            if (active) windowManager.minimizeWindow(active.id);
        }
    });
}

class WebDesk {
    constructor() {
        this.windowManager = new WindowManager();
        this.appManager = new AppManager();
        this.uiManager = new UIManager();
        this.quickSettings = new QuickSettings();

        this.appManager.initialize(this.windowManager);
        this.registerBuiltInApps();
        applyWallpaper();
        renderHome(this.windowManager);
        setupNavigation(this.windowManager);

        window.addEventListener('message', this.handleMessage.bind(this));
    }

    registerBuiltInApps() {
        this.appManager.registerApp('chrome', {
            title: '76836',
            url: 'https://76836.github.io',
            pinned: true,
            iconUrl: 'https://76836.github.io/apple-touch-icon.png'
        });

        this.appManager.registerApp('themes', {
            title: 'Settings',
            url: SETTINGS_APP_URL,
            iconUrl: 'https://76836.github.io/webdesk/images/icons/settings.png',
            pinned: true
        });

        this.appManager.registerApp('files', {
            title: 'Files',
            url: FILES_APP_URL,
            iconUrl: 'https://76836.github.io/webdesk/images/icons/files.png',
            pinned: true
        });

        this.appManager.registerApp('appmaker', {
            title: 'AppCenter',
            url: APPMAKER_APP_URL,
            pinned: true,
            iconUrl: 'https://76836.github.io/AppCenter/apple-touch-icon.png'
        });

        const stored = localStorage.getItem('WebDesk_custom_apps');
        if (stored) {
            JSON.parse(stored).forEach((app) => {
                app.config.url = normalizeAppUrl(app.config.url);
                this.appManager.registerApp(app.id, app.config);
            });
        }
    }

    handleMessage(event) {
        if (event.data?.type === 'registerApp') {
            const app = event.data.app;
            if (!app?.id || !app?.config) return;
            app.config.url = normalizeAppUrl(app.config.url);
            this.appManager.registerApp(app.id, app.config);
            renderHome(this.windowManager);
        }

        if (event.data?.type === 'unregisterApp') {
            this.appManager.unregisterApp(event.data.appId);
            renderHome(this.windowManager);
        }

        if (event.data?.type === 'setWallpaper' && event.data?.url) {
            localStorage.setItem(WALLPAPER_KEY, event.data.url);
            applyWallpaper();
        }
    }
}

document.addEventListener('DOMContentLoaded', () => {
    window.WebDesk = new WebDesk();
});
