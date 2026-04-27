import WindowManager from './windowManager.js';
import AppManager from './appManager.js';
import { UIManager, QuickSettings } from './uiManager.js';

const SETTINGS_APP_URL = new URL('../apps/settings', import.meta.url).href;
const FILES_APP_URL = new URL('../apps/files', import.meta.url).href;
const APPMAKER_APP_URL = new URL('../apps/appmaker', import.meta.url).href;
const HOME_ORDER_KEY = 'WebDesk_mobile_home_order';

function getHomeOrder() {
    try {
        return JSON.parse(localStorage.getItem(HOME_ORDER_KEY) || '[]');
    } catch {
        return [];
    }
}

function saveHomeOrder(order) {
    localStorage.setItem(HOME_ORDER_KEY, JSON.stringify(order));
}

function sortedEntries(windowManager) {
    const entries = Array.from(windowManager.appConfigs.entries());
    const order = getHomeOrder();
    if (!order.length) return entries;
    return entries.sort(([idA], [idB]) => {
        const a = order.indexOf(idA);
        const b = order.indexOf(idB);
        if (a === -1 && b === -1) return 0;
        if (a === -1) return 1;
        if (b === -1) return -1;
        return a - b;
    });
}

function openApp(windowManager, appId) {
    const config = windowManager.appConfigs.get(appId);
    if (!config) return;
    windowManager.createWindow(appId, config);
    document.querySelector('.home-screen')?.classList.remove('hidden');
    document.querySelector('.app-switcher')?.classList.add('hidden');
}

function renderHomeGrid(windowManager) {
    const grid = document.querySelector('.home-grid');
    if (!grid) return;
    grid.innerHTML = '';

    const entries = sortedEntries(windowManager);

    entries.forEach(([id, config], index) => {
        const appDiv = document.createElement('div');
        appDiv.className = 'launcher-app';
        appDiv.dataset.app = id;
        appDiv.draggable = true;
        appDiv.dataset.index = String(index);

        const iconDiv = document.createElement('div');
        iconDiv.className = 'launcher-app-icon';

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

        const nameSpan = document.createElement('span');
        nameSpan.className = 'launcher-app-name';
        nameSpan.textContent = config.title;

        appDiv.append(iconDiv, nameSpan);
        appDiv.addEventListener('click', () => openApp(windowManager, id));

        appDiv.addEventListener('dragstart', () => appDiv.classList.add('dragging'));
        appDiv.addEventListener('dragend', () => appDiv.classList.remove('dragging'));

        appDiv.addEventListener('dragover', (event) => event.preventDefault());
        appDiv.addEventListener('drop', (event) => {
            event.preventDefault();
            const dragged = grid.querySelector('.launcher-app.dragging');
            if (!dragged || dragged === appDiv) return;
            const nodes = Array.from(grid.children);
            const from = nodes.indexOf(dragged);
            const to = nodes.indexOf(appDiv);
            if (from < 0 || to < 0) return;
            if (from < to) appDiv.after(dragged);
            else appDiv.before(dragged);
            saveHomeOrder(Array.from(grid.querySelectorAll('.launcher-app')).map(node => node.dataset.app));
        });

        grid.appendChild(appDiv);
    });
}

function renderAppSwitcher(windowManager) {
    const list = document.getElementById('switcher-list');
    if (!list) return;
    list.innerHTML = '';

    Array.from(windowManager.openWindows.values()).reverse().forEach((win) => {
        const config = windowManager.appConfigs.get(win.id);
        const card = document.createElement('div');
        card.className = 'switcher-card';
        card.innerHTML = `<div><div>${config?.title || win.id}</div><small>${win.state}</small></div>`;

        const openBtn = document.createElement('button');
        openBtn.className = 'switcher-open';
        openBtn.textContent = 'Open';
        openBtn.addEventListener('click', () => {
            windowManager.restoreWindow(win.id);
            document.querySelector('.app-switcher')?.classList.add('hidden');
        });

        card.appendChild(openBtn);
        list.appendChild(card);
    });

    if (!windowManager.openWindows.size) {
        const empty = document.createElement('div');
        empty.className = 'switcher-card';
        empty.textContent = 'No recent apps';
        list.appendChild(empty);
    }
}

function setupNavigation(windowManager) {
    document.getElementById('nav-home')?.addEventListener('click', () => {
        windowManager.minimizeAll();
        document.querySelector('.app-switcher')?.classList.add('hidden');
    });

    document.getElementById('nav-recents')?.addEventListener('click', () => {
        const switcher = document.querySelector('.app-switcher');
        if (!switcher) return;
        renderAppSwitcher(windowManager);
        switcher.classList.toggle('hidden');
    });

    document.getElementById('nav-back')?.addEventListener('click', () => {
        const active = windowManager.activeWindowId && windowManager.openWindows.get(windowManager.activeWindowId);
        const frame = active?.element.querySelector('iframe');
        if (frame?.contentWindow) {
            frame.contentWindow.history.back();
        } else if (active) {
            windowManager.minimizeWindow(active.id);
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
        renderHomeGrid(this.windowManager);
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
            JSON.parse(stored).forEach(app => this.appManager.registerApp(app.id, app.config));
        }
    }

    handleMessage(event) {
        if (event.data?.type === 'registerApp') {
            this.appManager.registerApp(event.data.app.id, event.data.app.config);
            renderHomeGrid(this.windowManager);
        } else if (event.data?.type === 'unregisterApp') {
            this.appManager.unregisterApp(event.data.appId);
            renderHomeGrid(this.windowManager);
        }
    }
}

document.addEventListener('DOMContentLoaded', () => {
    window.WebDesk = new WebDesk();
});
