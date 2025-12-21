class UIManager {
    constructor() {
        this.elements = {
            time: document.querySelector('.time'),
            date: document.querySelector('.date'),
            statusArea: document.querySelector('.status-area'),
            quickSettings: document.querySelector('.quick-settings-menu'),
            launcher: document.querySelector('.app-launcher-view'),
            launcherButton: document.querySelector('.app-launcher')
        };

        this.timers = {
            time: null,
            date: null
        };

        this.setupEventListeners();
        this.startTimers();
    }

    updateTime() {
        if (!this.elements.time) return;
        const now = new Date();
        this.elements.time.textContent = now.toLocaleTimeString([], { 
            hour: 'numeric', 
            minute: '2-digit' 
        });
    }

    updateDate() {
        if (!this.elements.date) return;
        const now = new Date();
        this.elements.date.textContent = now.toLocaleDateString([], { 
            month: 'short', 
            day: 'numeric' 
        });
    }

    startTimers() {
        // Initial updates
        this.updateTime();
        this.updateDate();

        // Set timers
        this.timers.time = setInterval(() => this.updateTime(), 60000); // Every minute
        this.timers.date = setInterval(() => this.updateDate(), 3600000); // Every hour
    }

    setupEventListeners() {
        // App launcher toggle
        this.elements.launcherButton?.addEventListener('click', () => {
            this.elements.launcher?.classList.toggle('hidden');
            // Refresh launcher contents each time it's opened
            if (!this.elements.launcher?.classList.contains('hidden')) {
                if (window.updateLauncherIcons) window.updateLauncherIcons();
            }
            const searchInput = this.elements.launcher?.querySelector('input');
            if (searchInput && !this.elements.launcher?.classList.contains('hidden')) {
                searchInput.focus();
            }
        });

        // Handle shelf icon clicks
        const shelf = document.querySelector('.shelf-items-left');
        if (shelf) {
            shelf.addEventListener('click', (e) => {
                console.log('Shelf click detected');
                const icon = e.target.closest('.shelf-item:not(.app-launcher)');
                if (icon) {
                    console.log('Icon clicked:', icon.dataset.appId);
                    const appId = icon.dataset.appId;
                    if (!appId) {
                        console.error('No app ID found on clicked icon');
                        return;
                    }

                    // Ensure WebDesk is initialized
                    if (!window.WebDesk) {
                        console.error('WebDesk not initialized');
                        return;
                    }

                    // Check window manager
                    if (!window.WebDesk.windowManager) {
                        console.error('Window manager not initialized');
                        return;
                    }

                    // Get app config and create/restore window
                    const config = window.WebDesk.windowManager.appConfigs.get(appId);
                    if (config) {
                        window.WebDesk.windowManager.createWindow(appId, config);
                    } else {
                        console.error('App configuration not found:', appId);
                    }
                }
            });
        }

        // Quick settings toggle
        this.elements.statusArea?.addEventListener('click', () => {
            this.elements.quickSettings?.classList.toggle('hidden');
        });

        // Close menus when clicking outside
        document.addEventListener('click', (e) => {
            // Close launcher
            if (!this.elements.launcher?.classList.contains('hidden') &&
                !this.elements.launcher.contains(e.target) &&
                !this.elements.launcherButton?.contains(e.target)) {
                this.elements.launcher.classList.add('hidden');
            }

            // Close quick settings
            if (!this.elements.quickSettings?.classList.contains('hidden') &&
                !this.elements.quickSettings.contains(e.target) &&
                !this.elements.statusArea?.contains(e.target)) {
                this.elements.quickSettings.classList.add('hidden');
            }
        });
    }

    destroy() {
        // Clean up timers
        Object.values(this.timers).forEach(timer => {
            if (timer) clearInterval(timer);
        });
    }
}

// Quick settings component
class QuickSettings {
    constructor() {
        this.menu = document.querySelector('.quick-settings-menu');
        if (!this.menu) return;

        this.setupSliders();
        this.setupTiles();
    }

    setupSliders() {
        const brightnessSlider = this.menu.querySelector('.brightness-slider input');
        if (brightnessSlider) {
            brightnessSlider.addEventListener('input', (e) => {
                // Here you could implement actual brightness control
                console.log('Brightness:', e.target.value);
            });
        }
    }

    setupTiles() {
        const tiles = this.menu.querySelectorAll('.quick-settings-tile');
        tiles.forEach(tile => {
            tile.addEventListener('click', () => {
                const type = tile.classList[1]?.replace('-tile', '');
                if (type === 'wifi') {
                    // Toggle wifi state
                    const sublabel = tile.querySelector('.tile-sublabel');
                    if (sublabel) {
                        sublabel.textContent = sublabel.textContent === 'Connected' ? 'Disconnected' : 'Connected';
                    }
                } else if (type === 'focus') {
                    // Toggle focus mode
                    const sublabel = tile.querySelector('.tile-sublabel');
                    if (sublabel) {
                        sublabel.textContent = sublabel.textContent === 'On' ? 'Off' : 'On';
                    }
                }
            });
        });
    }
}

export { UIManager, QuickSettings };