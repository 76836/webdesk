import WindowManager from './windowManager.js';
import AppManager from './appManager.js';
import { UIManager, QuickSettings } from './uiManager.js';

const RECENT_LAUNCHES_KEY = 'WebDesk_recent_launches';
const MAX_RECENT_LAUNCHES = 5;

let launcherState = {
    filteredAppIds: [],
    selectedIndex: 0
};

function getRecentLaunches() {
    try {
        const raw = localStorage.getItem(RECENT_LAUNCHES_KEY);
        const recent = raw ? JSON.parse(raw) : [];
        return Array.isArray(recent) ? recent : [];
    } catch {
        return [];
    }
}

function saveRecentLaunch(appId) {
    const current = getRecentLaunches().filter(id => id !== appId);
    current.unshift(appId);
    localStorage.setItem(RECENT_LAUNCHES_KEY, JSON.stringify(current.slice(0, MAX_RECENT_LAUNCHES)));
}

function closeLauncherView() {
    document.querySelector('.app-launcher-view')?.classList.add('hidden');
}

function openAppFromLauncher(appId) {
    if (!appId) return;
    const config = window.WebDesk?.windowManager?.appConfigs.get(appId);
    if (!config) return;
    window.WebDesk.windowManager.createWindow(appId, config);
    saveRecentLaunch(appId);
    closeLauncherView();
}

// Launcher utilities: update contents, context menu, and click handling
function createLauncherContextMenu() {
    if (document.getElementById('launcher-context-menu')) return;
    const menu = document.createElement('div');
    menu.id = 'launcher-context-menu';
    menu.classList.add('hidden');
    document.body.appendChild(menu);

    // Close on click outside
    document.addEventListener('click', (e) => {
        if (!menu.contains(e.target)) menu.classList.add('hidden');
    });
}

function showLauncherContextMenu(x, y, appId) {
    const menu = document.getElementById('launcher-context-menu');
    if (!menu) return;

    menu.innerHTML = '';

    const config = window.WebDesk.windowManager.appConfigs.get(appId);
    if (!config) return;

    const renameBtn = document.createElement('button');
    renameBtn.className = 'launcher-context-action';
    renameBtn.textContent = 'Rename';
    renameBtn.addEventListener('click', () => {
        const newName = prompt('Enter new name for the app', config.title);
        if (newName && newName.trim()) {
            config.title = newName.trim();
            if (window.WebDesk?.appManager?.apps.has(appId)) {
                const appConfig = window.WebDesk.appManager.apps.get(appId);
                appConfig.title = config.title;
                window.WebDesk.appManager.saveApps();
            }
            const tb = document.querySelector(`.shelf-item[data-app-id="${appId}"]`);
            if (tb) window.WebDesk.windowManager.setTaskbarIcon(tb, config);
            updateLauncherIcons();
        }
        menu.classList.add('hidden');
    });

    const pinBtn = document.createElement('button');
    pinBtn.className = 'launcher-context-action';
    pinBtn.textContent = (config.pinned ? 'Unpin from shelf' : 'Pin to shelf');
    pinBtn.addEventListener('click', () => {
        config.pinned = !config.pinned;
        if (window.WebDesk?.appManager?.apps.has(appId)) {
            const appConfig = window.WebDesk.appManager.apps.get(appId);
            appConfig.pinned = config.pinned;
            window.WebDesk.appManager.saveApps();
        }

        const existing = document.querySelector(`.shelf-item[data-app-id="${appId}"]`);
        if (config.pinned && !existing) {
            const taskbarIcon = document.createElement('div');
            taskbarIcon.className = 'shelf-item';
            taskbarIcon.dataset.appId = appId;
            taskbarIcon.title = config.title;
            window.WebDesk.windowManager.setTaskbarIcon(taskbarIcon, config);
            taskbarIcon.addEventListener('click', () => window.WebDesk.windowManager.createWindow(appId, config));
            document.querySelector('.shelf-items-left').appendChild(taskbarIcon);
            if (!window.WebDesk.windowManager.pinnedApps.includes(appId)) {
                window.WebDesk.windowManager.pinnedApps.push(appId);
            }
        } else if (!config.pinned && existing) {
            existing.remove();
            const idx = window.WebDesk.windowManager.pinnedApps.indexOf(appId);
            if (idx > -1) window.WebDesk.windowManager.pinnedApps.splice(idx, 1);
        }

        updateLauncherIcons();
        menu.classList.add('hidden');
    });

    menu.appendChild(renameBtn);
    menu.appendChild(pinBtn);

    let left = x;
    let top = y;
    menu.classList.remove('hidden');
    const rect = menu.getBoundingClientRect();
    if (left + rect.width > window.innerWidth) left = window.innerWidth - rect.width - 10;
    if (top + rect.height > window.innerHeight) top = window.innerHeight - rect.height - 10;
    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;
}

function getSortedAppEntries() {
    const entries = Array.from(window.WebDesk.windowManager.appConfigs.entries());
    const recent = getRecentLaunches();

    return entries.sort(([idA, configA], [idB, configB]) => {
        const recentA = recent.indexOf(idA);
        const recentB = recent.indexOf(idB);

        if (recentA !== -1 || recentB !== -1) {
            if (recentA === -1) return 1;
            if (recentB === -1) return -1;
            return recentA - recentB;
        }

        return configA.title.localeCompare(configB.title);
    });
}

function updateLauncherSelection(launcherGrid) {
    const cards = launcherGrid.querySelectorAll('.launcher-app:not(.hidden)');
    cards.forEach((card, index) => {
        card.classList.toggle('active', index === launcherState.selectedIndex);
    });
}

function filterLauncherApps(query, launcherGrid) {
    const normalized = query.trim().toLowerCase();
    const apps = Array.from(launcherGrid.querySelectorAll('.launcher-app'));

    const visible = apps.filter((app) => {
        const title = app.dataset.title || '';
        const url = app.dataset.url || '';
        const isMatch = !normalized || title.includes(normalized) || url.includes(normalized);
        app.classList.toggle('hidden', !isMatch);
        return isMatch;
    });

    launcherState.filteredAppIds = visible.map(app => app.dataset.app);
    launcherState.selectedIndex = Math.min(launcherState.selectedIndex, Math.max(visible.length - 1, 0));

    const emptyState = document.getElementById('launcher-empty-state');
    if (emptyState) emptyState.classList.toggle('hidden', visible.length > 0);

    updateLauncherSelection(launcherGrid);
}

function updateLauncherIcons() {
    const launcherGrid = document.querySelector('.launcher-grid');
    if (!launcherGrid) return;
    launcherGrid.innerHTML = '';

    const appEntries = getSortedAppEntries();
    appEntries.forEach(([id, config]) => {
        const appDiv = document.createElement('div');
        appDiv.className = 'launcher-app';
        appDiv.dataset.app = id;
        appDiv.dataset.title = (config.title || '').toLowerCase();
        appDiv.dataset.url = (config.url || '').toLowerCase();
        appDiv.tabIndex = 0;

        const iconDiv = document.createElement('div');
        iconDiv.className = 'launcher-app-icon';

        if (config.iconUrl) {
            const img = document.createElement('img');
            img.src = config.iconUrl;
            img.alt = config.title;
            img.addEventListener('error', () => {
                img.style.display = 'none';
                iconDiv.classList.add('placeholder-icon');
                iconDiv.innerHTML = window.WebDesk.windowManager.generateIcon(config.title);
            });
            iconDiv.appendChild(img);
        } else {
            iconDiv.classList.add('placeholder-icon');
            iconDiv.innerHTML = window.WebDesk.windowManager.generateIcon(config.title);
        }

        const nameSpan = document.createElement('span');
        nameSpan.className = 'launcher-app-name';
        nameSpan.textContent = config.title;

        appDiv.appendChild(iconDiv);
        appDiv.appendChild(nameSpan);

        appDiv.addEventListener('contextmenu', (ev) => {
            ev.preventDefault();
            showLauncherContextMenu(ev.pageX, ev.pageY, id);
        });

        launcherGrid.appendChild(appDiv);
    });

    const emptyState = document.createElement('div');
    emptyState.id = 'launcher-empty-state';
    emptyState.className = 'launcher-empty-state hidden';
    emptyState.textContent = 'No apps found';
    launcherGrid.appendChild(emptyState);

    launcherState.filteredAppIds = appEntries.map(([id]) => id);
    launcherState.selectedIndex = 0;
    updateLauncherSelection(launcherGrid);

    window.updateLauncherIcons = updateLauncherIcons;
}

function setupLauncherClicks() {
    const launcherGrid = document.querySelector('.launcher-grid');
    const launcherInput = document.querySelector('.launcher-search input');
    if (!launcherGrid) return;

    updateLauncherIcons();
    createLauncherContextMenu();

    window.addEventListener('message', (event) => {
        if (event.data.type === 'registerApp' || event.data.type === 'unregisterApp') {
            setTimeout(() => {
                updateLauncherIcons();
                filterLauncherApps(launcherInput?.value || '', launcherGrid);
            }, 100);
        }
    });

    launcherGrid.addEventListener('click', (e) => {
        const appItem = e.target.closest('.launcher-app');
        if (appItem) {
            openAppFromLauncher(appItem.dataset.app);
        }
    });

    launcherInput?.addEventListener('input', (e) => {
        launcherState.selectedIndex = 0;
        filterLauncherApps(e.target.value, launcherGrid);
    });

    launcherInput?.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
            closeLauncherView();
            return;
        }

        if (!['ArrowDown', 'ArrowUp', 'Enter'].includes(event.key)) return;
        const total = launcherState.filteredAppIds.length;
        if (!total) return;

        if (event.key === 'ArrowDown') {
            launcherState.selectedIndex = (launcherState.selectedIndex + 1) % total;
        }

        if (event.key === 'ArrowUp') {
            launcherState.selectedIndex = (launcherState.selectedIndex - 1 + total) % total;
        }

        if (event.key === 'Enter') {
            const selectedAppId = launcherState.filteredAppIds[launcherState.selectedIndex];
            openAppFromLauncher(selectedAppId);
        }

        updateLauncherSelection(launcherGrid);
        event.preventDefault();
    });

    filterLauncherApps('', launcherGrid);
}

class WebDesk {
    constructor() {
        this.windowManager = new WindowManager();
        this.appManager = new AppManager();
        this.uiManager = new UIManager();
        this.quickSettings = new QuickSettings();

        this.appManager.initialize(this.windowManager);
        this.registerBuiltInApps();

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
            title: '⚙️ Settings',
            url: './webdesk/v4/apps/settings',
            pinned: true
        });

        this.appManager.registerApp('appmaker', {
            title: 'AppCenter',
            url: './webdesk/v4/apps/appmaker',
            pinned: true,
            iconUrl: 'https://76836.github.io/AppCenter/apple-touch-icon.png'
        });

        this.loadCustomApps();
    }

    loadCustomApps() {
        const stored = localStorage.getItem('WebDesk_custom_apps');
        if (stored) {
            const apps = JSON.parse(stored);
            apps.forEach(app => {
                this.appManager.registerApp(app.id, app.config);
            });
        }
    }

    handleMessage(event) {
        if (event.data.type === 'registerApp') {
            const { app } = event.data;
            this.appManager.registerApp(app.id, app.config);
        } else if (event.data.type === 'unregisterApp') {
            const { appId } = event.data;
            this.appManager.unregisterApp(appId);
        }
    }
}

document.addEventListener('DOMContentLoaded', () => {
    console.log('Initializing WebDesk...');
    window.WebDesk = new WebDesk();
    setupLauncherClicks();
    console.log('Apps registered:', Array.from(window.WebDesk.windowManager.appConfigs.keys()));

    if (!localStorage.getItem('wallpaper')) {
        window.postMessage({
            type: 'setWallpaper',
            url: 'https://76836.github.io/webdesk/images/wallpapers/water.png'
        }, '*');
    }
});
