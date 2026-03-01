import WindowManager from './windowManager.js';
import AppManager from './appManager.js';
import { UIManager, QuickSettings } from './uiManager.js';

const RECENT_LAUNCHES_KEY = 'WebDesk_recent_launches';
const MAX_RECENT_LAUNCHES = 5;
const LAUNCHER_SORT_KEY = 'WebDesk_launcher_sort';

const SETTINGS_APP_URL = new URL('../apps/settings', import.meta.url).href;
const FILES_APP_URL = new URL('../apps/files', import.meta.url).href;
const APPMAKER_APP_URL = new URL('../apps/appmaker', import.meta.url).href;

let launcherState = {
    filteredAppIds: [],
    selectedIndex: 0,
    keyboardMode: false,
    columns: 1
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

function resetLauncherSelection() {
    launcherState.selectedIndex = 0;
    launcherState.keyboardMode = false;
}

function closeLauncherView() {
    document.querySelector('.app-launcher-view')?.classList.add('hidden');
    resetLauncherSelection();
    updateLauncherSelection();
}

function openAppFromLauncher(appId) {
    if (!appId) return;
    const config = window.WebDesk?.windowManager?.appConfigs.get(appId);
    if (!config) return;
    window.WebDesk.windowManager.createWindow(appId, config);
    saveRecentLaunch(appId);
    closeLauncherView();
}

function getCurrentSortMode() {
    const sort = document.getElementById('launcher-sort');
    return sort?.value || localStorage.getItem(LAUNCHER_SORT_KEY) || 'recent';
}

function getSortedAppEntries() {
    const entries = Array.from(window.WebDesk.windowManager.appConfigs.entries());
    const sortMode = getCurrentSortMode();

    if (sortMode === 'alpha') {
        return entries.sort(([, a], [, b]) => a.title.localeCompare(b.title));
    }

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

function createContextMenu(menuId) {
    let menu = document.getElementById(menuId);
    if (!menu) {
        menu = document.createElement('div');
        menu.id = menuId;
        menu.classList.add('hidden');
        document.body.appendChild(menu);
    }
    return menu;
}

function hideContextMenus() {
    document.getElementById('launcher-context-menu')?.classList.add('hidden');
    document.getElementById('desktop-context-menu')?.classList.add('hidden');
}

function showMenu(menu, x, y) {
    menu.classList.remove('hidden');
    const rect = menu.getBoundingClientRect();
    const left = Math.min(x, window.innerWidth - rect.width - 10);
    const top = Math.min(y, window.innerHeight - rect.height - 10);
    menu.style.left = `${Math.max(10, left)}px`;
    menu.style.top = `${Math.max(10, top)}px`;
}

function createLauncherContextMenu() {
    const menu = createContextMenu('launcher-context-menu');

    document.addEventListener('click', (e) => {
        if (!menu.contains(e.target)) menu.classList.add('hidden');
    });
}

function showAppContextMenu(x, y, appId) {
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
            filterLauncherApps(document.querySelector('.launcher-search input')?.value || '');
        }
        menu.classList.add('hidden');
    });

    const pinBtn = document.createElement('button');
    pinBtn.className = 'launcher-context-action';
    pinBtn.textContent = config.pinned ? 'Unpin from shelf' : 'Pin to shelf';
    pinBtn.addEventListener('click', () => {
        config.pinned = !config.pinned;
        if (window.WebDesk?.appManager?.apps.has(appId)) {
            const appConfig = window.WebDesk.appManager.apps.get(appId);
            appConfig.pinned = config.pinned;
            window.WebDesk.appManager.saveApps();
        }

        const existing = document.querySelector(`.shelf-item[data-app-id="${appId}"]`);
        if (config.pinned && !existing) {
            window.WebDesk.windowManager.addTaskbarIcon(appId, config);
            if (!window.WebDesk.windowManager.pinnedApps.includes(appId)) {
                window.WebDesk.windowManager.pinnedApps.push(appId);
            }
        } else if (!config.pinned && existing) {
            existing.remove();
            const idx = window.WebDesk.windowManager.pinnedApps.indexOf(appId);
            if (idx > -1) window.WebDesk.windowManager.pinnedApps.splice(idx, 1);
        }

        updateLauncherIcons();
        filterLauncherApps(document.querySelector('.launcher-search input')?.value || '');
        menu.classList.add('hidden');
    });

    menu.append(renameBtn, pinBtn);
    showMenu(menu, x, y);
}

function createDesktopContextMenu() {
    const menu = createContextMenu('desktop-context-menu');
    menu.innerHTML = `
        <button class="launcher-context-action" data-action="open-settings">Open settings</button>
        <button class="launcher-context-action" data-action="open-wallpapers">Wallpaper settings</button>
        <button class="launcher-context-action" data-action="close-all">Close all windows</button>
    `;

    menu.addEventListener('click', (event) => {
        const action = event.target.dataset.action;
        if (!action) return;

        if (action === 'open-settings' || action === 'open-wallpapers') {
            const config = window.WebDesk.windowManager.appConfigs.get('themes');
            if (config) window.WebDesk.windowManager.createWindow('themes', config);
            if (action === 'open-wallpapers') {
                setTimeout(() => {
                    const frame = document.querySelector('.app-window[data-app-id="themes"] iframe');
                    frame?.contentWindow?.postMessage({ type: 'settingsTab', tab: 'wallpaper' }, '*');
                }, 250);
            }
        }

        if (action === 'close-all') {
            Array.from(window.WebDesk.windowManager.openWindows.keys()).forEach((id) => {
                window.WebDesk.windowManager.closeWindow(id);
            });
        }

        menu.classList.add('hidden');
    });

    document.addEventListener('contextmenu', (event) => {
        const onDesktop = event.target.closest('.os-desktop') &&
            !event.target.closest('.app-window') &&
            !event.target.closest('.shelf');

        if (!onDesktop) return;
        event.preventDefault();
        hideContextMenus();
        showMenu(menu, event.pageX, event.pageY);
    });

    document.addEventListener('click', (e) => {
        if (!menu.contains(e.target)) menu.classList.add('hidden');
    });
}

function updateLauncherSelection() {
    const launcherGrid = document.querySelector('.launcher-grid');
    if (!launcherGrid) return;

    const cards = Array.from(launcherGrid.querySelectorAll('.launcher-app:not(.hidden)'));
    cards.forEach((card, index) => {
        const isActive = launcherState.keyboardMode && index === launcherState.selectedIndex;
        card.classList.toggle('active', isActive);
    });
}

function filterLauncherApps(query = '') {
    const launcherGrid = document.querySelector('.launcher-grid');
    if (!launcherGrid) return;

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
    launcherState.columns = Math.max(1, Math.floor(launcherGrid.clientWidth / 95));
    launcherState.selectedIndex = Math.min(launcherState.selectedIndex, Math.max(visible.length - 1, 0));

    const emptyState = document.getElementById('launcher-empty-state');
    if (emptyState) {
        const showEmpty = normalized.length > 0 && visible.length === 0;
        emptyState.classList.toggle('hidden', !showEmpty);
    }

    if (!launcherState.keyboardMode) launcherState.selectedIndex = 0;
    updateLauncherSelection();
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

        appDiv.append(iconDiv, nameSpan);

        appDiv.addEventListener('contextmenu', (ev) => {
            ev.preventDefault();
            showAppContextMenu(ev.pageX, ev.pageY, id);
        });

        launcherGrid.appendChild(appDiv);
    });

    const emptyState = document.createElement('div');
    emptyState.id = 'launcher-empty-state';
    emptyState.className = 'launcher-empty-state hidden';
    emptyState.textContent = 'No apps found';
    launcherGrid.appendChild(emptyState);

    launcherState.filteredAppIds = appEntries.map(([id]) => id);
    resetLauncherSelection();
    window.updateLauncherIcons = updateLauncherIcons;
}

function setupLauncherInteractions() {
    const launcherGrid = document.querySelector('.launcher-grid');
    const launcherInput = document.querySelector('.launcher-search input');
    const launcherSort = document.getElementById('launcher-sort');
    if (!launcherGrid) return;

    createLauncherContextMenu();
    createDesktopContextMenu();

    if (launcherSort) {
        launcherSort.value = localStorage.getItem(LAUNCHER_SORT_KEY) || 'recent';
        launcherSort.addEventListener('change', () => {
            localStorage.setItem(LAUNCHER_SORT_KEY, launcherSort.value);
            updateLauncherIcons();
            filterLauncherApps(launcherInput?.value || '');
        });
    }

    updateLauncherIcons();
    filterLauncherApps('');

    launcherGrid.addEventListener('click', (e) => {
        const appItem = e.target.closest('.launcher-app');
        if (appItem) {
            openAppFromLauncher(appItem.dataset.app);
        }
    });

    launcherInput?.addEventListener('input', (e) => {
        launcherState.keyboardMode = false;
        filterLauncherApps(e.target.value);
    });

    launcherInput?.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
            closeLauncherView();
            return;
        }

        if (event.key === 'Enter') {
            if (!launcherState.filteredAppIds.length) return;
            const index = launcherState.keyboardMode ? launcherState.selectedIndex : 0;
            openAppFromLauncher(launcherState.filteredAppIds[index]);
            event.preventDefault();
            return;
        }

        if (!['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight'].includes(event.key)) return;
        if (!launcherState.filteredAppIds.length) return;

        launcherState.keyboardMode = true;
        const total = launcherState.filteredAppIds.length;
        const cols = launcherState.columns;

        if (event.key === 'ArrowRight') launcherState.selectedIndex = Math.min(total - 1, launcherState.selectedIndex + 1);
        if (event.key === 'ArrowLeft') launcherState.selectedIndex = Math.max(0, launcherState.selectedIndex - 1);
        if (event.key === 'ArrowDown') launcherState.selectedIndex = Math.min(total - 1, launcherState.selectedIndex + cols);
        if (event.key === 'ArrowUp') launcherState.selectedIndex = Math.max(0, launcherState.selectedIndex - cols);

        updateLauncherSelection();
        event.preventDefault();
    });

    document.addEventListener('launcherclosed', () => {
        resetLauncherSelection();
        updateLauncherSelection();
    });

    window.addEventListener('message', (event) => {
        if (event.data?.type === 'registerApp' || event.data?.type === 'unregisterApp') {
            setTimeout(() => {
                updateLauncherIcons();
                filterLauncherApps(launcherInput?.value || '');
            }, 100);
        }
    });

    window.showAppContextMenu = showAppContextMenu;
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
            pinned: false,
            iconUrl: 'https://76836.github.io/apple-touch-icon.png'
        });

        this.appManager.registerApp('themes', {
            title: 'Settings',
            url: SETTINGS_APP_URL,
            iconUrl: 'https://76836.github.io/webdesk/images/icons/settings.png'
            pinned: true
        });
 
        this.appManager.registerApp('files', {
            title: 'Files',
            url: FILES_APP_URL,
            iconUrl: 'https://76836.github.io/webdesk/images/icons/files.png'
            pinned: true
        });

        this.appManager.registerApp('appmaker', {
            title: 'AppCenter',
            url: APPMAKER_APP_URL,
            pinned: true,
            iconUrl: 'https://76836.github.io/AppCenter/apple-touch-icon.png'
        });

        this.loadCustomApps();
    }

    loadCustomApps() {
        const stored = localStorage.getItem('WebDesk_custom_apps');
        if (stored) {
            const apps = JSON.parse(stored);
            apps.forEach(app => this.appManager.registerApp(app.id, app.config));
        }
    }

    handleMessage(event) {
        if (event.data?.type === 'registerApp') {
            const { app } = event.data;
            this.appManager.registerApp(app.id, app.config);
        } else if (event.data?.type === 'unregisterApp') {
            const { appId } = event.data;
            this.appManager.unregisterApp(appId);
        }
    }
}

document.addEventListener('DOMContentLoaded', () => {
    window.WebDesk = new WebDesk();
    setupLauncherInteractions();

    if (!localStorage.getItem('wallpaper')) {
        window.postMessage({ type: 'setWallpaper', url: 'https://76836.github.io/webdesk/images/wallpapers/water.png' }, '*');
    }

    document.addEventListener('click', hideContextMenus);
});
