import WindowManager from './windowManager.js';
import AppManager from './appManager.js';
import { UIManager, QuickSettings } from './uiManager.js';


// Launcher utilities: update contents, context menu, and click handling
function createLauncherContextMenu() {
    if (document.getElementById('launcher-context-menu')) return;
    const menu = document.createElement('div');
    menu.id = 'launcher-context-menu';
    menu.style.position = 'fixed';
    menu.style.background = '#ffffff';
    menu.style.border = '1px solid rgba(0,0,0,0.12)';
    menu.style.boxShadow = '0 4px 12px rgba(0,0,0,0.12)';
    menu.style.padding = '6px 0';
    menu.style.borderRadius = '6px';
    menu.style.zIndex = '10000';
    menu.style.minWidth = '160px';
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

    // Clear previous items
    menu.innerHTML = '';

    const config = window.WebDesk.windowManager.appConfigs.get(appId);
    if (!config) return;

    // Rename action
    const renameBtn = document.createElement('button');
    renameBtn.textContent = 'Rename';
    renameBtn.style.display = 'block';
    renameBtn.style.width = '100%';
    renameBtn.style.padding = '8px 12px';
    renameBtn.style.border = 'none';
    renameBtn.style.background = 'transparent';
    renameBtn.style.textAlign = 'left';
    renameBtn.style.cursor = 'pointer';
    renameBtn.addEventListener('click', () => {
        const newName = prompt('Enter new name for the app', config.title);
        if (newName && newName.trim()) {
            config.title = newName.trim();
            // Update app manager (persistence)
            if (window.WebDesk && window.WebDesk.appManager && window.WebDesk.appManager.apps.has(appId)) {
                const appConfig = window.WebDesk.appManager.apps.get(appId);
                appConfig.title = config.title;
                window.WebDesk.appManager.saveApps();
            }
            // Update taskbar icon if present
            const tb = document.querySelector(`.shelf-item[data-app-id="${appId}"]`);
            if (tb) window.WebDesk.windowManager.setTaskbarIcon(tb, config);

            // Refresh launcher
            updateLauncherIcons();
        }
        menu.classList.add('hidden');
    });

    // Pin/unpin action
    const pinBtn = document.createElement('button');
    pinBtn.textContent = (config.pinned ? 'Unpin from shelf' : 'Pin to shelf');
    pinBtn.style.display = 'block';
    pinBtn.style.width = '100%';
    pinBtn.style.padding = '8px 12px';
    pinBtn.style.border = 'none';
    pinBtn.style.background = 'transparent';
    pinBtn.style.textAlign = 'left';
    pinBtn.style.cursor = 'pointer';
    pinBtn.addEventListener('click', () => {
        config.pinned = !config.pinned;
        // Update persistence
        if (window.WebDesk && window.WebDesk.appManager && window.WebDesk.appManager.apps.has(appId)) {
            const appConfig = window.WebDesk.appManager.apps.get(appId);
            appConfig.pinned = config.pinned;
            window.WebDesk.appManager.saveApps();
        }

        // Add or remove shelf item
        const existing = document.querySelector(`.shelf-item[data-app-id="${appId}"]`);
        if (config.pinned && !existing) {
            const taskbarIcon = document.createElement('div');
            taskbarIcon.className = 'shelf-item';
            taskbarIcon.dataset.appId = appId;
            taskbarIcon.title = config.title;
            window.WebDesk.windowManager.setTaskbarIcon(taskbarIcon, config);
            taskbarIcon.addEventListener('click', () => window.WebDesk.windowManager.createWindow(appId, config));
            document.querySelector('.shelf-items-left').appendChild(taskbarIcon);
            // Track pinned apps in window manager state
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

    // Position menu (clamp to viewport)
    const rect = menu.getBoundingClientRect();
    let left = x;
    let top = y;
    if (left + 160 > window.innerWidth) left = window.innerWidth - 170;
    if (top + rect.height > window.innerHeight) top = window.innerHeight - rect.height - 10;
    menu.style.left = left + 'px';
    menu.style.top = top + 'px';
    menu.classList.remove('hidden');
}

function updateLauncherIcons() {
    const launcherGrid = document.querySelector('.launcher-grid');
    if (!launcherGrid) return;
    launcherGrid.innerHTML = '';

    window.WebDesk.windowManager.appConfigs.forEach((config, id) => {
        const appDiv = document.createElement('div');
        appDiv.className = 'launcher-app';
        appDiv.dataset.app = id;

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

        // Right-click context menu
        appDiv.addEventListener('contextmenu', (ev) => {
            ev.preventDefault();
            showLauncherContextMenu(ev.pageX, ev.pageY, id);
        });

        launcherGrid.appendChild(appDiv);
    });

    // store globally so UIManager can call it
    window.updateLauncherIcons = updateLauncherIcons;
}

function setupLauncherClicks() {
    const launcherGrid = document.querySelector('.launcher-grid');
    if (!launcherGrid) return;

    // Update icons initially
    updateLauncherIcons();

    // Create context menu element
    createLauncherContextMenu();

    // Listen for app changes
    window.addEventListener('message', (event) => {
        if (event.data.type === 'registerApp' || event.data.type === 'unregisterApp') {
            // Wait a moment for the registration to complete
            setTimeout(updateLauncherIcons, 100);
        }
    });

    // Set up click handler (open app)
    launcherGrid.addEventListener('click', (e) => {
        const appItem = e.target.closest('.launcher-app');
        if (appItem) {
            const appId = appItem.dataset.app;
            if (appId) {
                const config = window.WebDesk.windowManager.appConfigs.get(appId);
                if (config) {
                    window.WebDesk.windowManager.createWindow(appId, config);
                    document.querySelector('.app-launcher-view').classList.add('hidden');
                }
            }
        }
    });
}

class WebDesk {
    constructor() {
        this.windowManager = new WindowManager();
        this.appManager = new AppManager();
        this.uiManager = new UIManager();
        this.quickSettings = new QuickSettings();

        // Initialize app manager with window manager
        this.appManager.initialize(this.windowManager);

        // Register built-in apps
        this.registerBuiltInApps();
        
        // Set up message listener for AppCenter
        window.addEventListener('message', this.handleMessage.bind(this));
    }

    registerBuiltInApps() {
        // Register app configurations but don't create windows yet
        this.appManager.registerApp('chrome', {
            title: '76836',
            url: 'https://76836.github.io',
            pinned: true,
            iconUrl: "https://76836.github.io/apple-touch-icon.png"
        });

        this.appManager.registerApp('themes', {
            title: '⚙️ Settings',
            url: './apps/settings',
            pinned: true
        });

        this.appManager.registerApp('appmaker', {
            title: 'AppCenter',
            url: './apps/appmaker',
            pinned: true,
            iconUrl: "https://76836.github.io/AppCenter/apple-touch-icon.png"
        });

        // Load any custom apps from storage
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

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    console.log('Initializing WebDesk...');
    window.WebDesk = new WebDesk();
    setupLauncherClicks();
    console.log('Apps registered:', Array.from(window.WebDesk.windowManager.appConfigs.keys()));

});
