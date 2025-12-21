class AppManager {
    constructor() {
        this.apps = new Map();
        this.windows = null;
        this.storage = localStorage;
        
        // Load saved apps from storage
        this.loadSavedApps();
    }

    initialize(windowManager) {
        this.windows = windowManager;
        this.restoreApps();
    }

    registerApp(id, config) {
        if (this.apps.has(id)) return;

        // Default configuration
        const defaultConfig = {
            title: config.title || id,
            url: config.url || 'about:blank',
            // Support both `iconUrl` and legacy `icon` properties
            iconUrl: config.iconUrl || config.icon || null,
            icon: config.icon || config.iconUrl || null,
            pinned: config.pinned || false,
            position: config.position || { x: 50, y: 50 },
            size: config.size || { width: '80vw', height: '70vh' }
        };

        this.apps.set(id, defaultConfig);
        
        if (this.windows) {
            this.windows.registerApp(id, defaultConfig);
        }

        this.saveApps();
    }

    loadSavedApps() {
        try {
            const saved = this.storage.getItem('WebDesk_apps');
            if (saved) {
                const apps = JSON.parse(saved);
                apps.forEach(app => this.registerApp(app.id, app.config));
            }
        } catch (e) {
            console.error('Error loading saved apps:', e);
        }
    }

    saveApps() {
        try {
            const apps = Array.from(this.apps).map(([id, config]) => ({
                id,
                config: {
                    ...config,
                    position: {
                        x: this.windows?.openWindows.get(id)?.element.offsetLeft || config.position.x,
                        y: this.windows?.openWindows.get(id)?.element.offsetTop || config.position.y
                    }
                }
            }));
            this.storage.setItem('WebDesk_apps', JSON.stringify(apps));
        } catch (e) {
            console.error('Error saving apps:', e);
        }
    }

    restoreApps() {
        if (!this.windows) return;
        
        this.apps.forEach((config, id) => {
            this.windows.registerApp(id, config);
        });
    }

    unregisterApp(id) {
        if (!this.apps.has(id)) return;
        
        const index = this.windows?.pinnedApps.indexOf(id);
        if (index > -1) {
            this.windows.pinnedApps.splice(index, 1);
        }

        this.apps.delete(id);
        this.saveApps();
    }
}

export default AppManager;