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
        this.updateTime();
        this.updateDate();
        this.timers.time = setInterval(() => this.updateTime(), 60000);
        this.timers.date = setInterval(() => this.updateDate(), 3600000);
    }

    setLauncherVisibility(isOpen) {
        if (!this.elements.launcher) return;
        this.elements.launcher.classList.toggle('hidden', !isOpen);
        const eventName = isOpen ? 'launcheropened' : 'launcherclosed';
        document.dispatchEvent(new CustomEvent(eventName));
    }

    setupEventListeners() {
        this.elements.launcherButton?.addEventListener('click', () => {
            const isOpen = this.elements.launcher?.classList.contains('hidden');
            this.setLauncherVisibility(Boolean(isOpen));

            if (isOpen && window.updateLauncherIcons) {
                window.updateLauncherIcons();
            }

            const searchInput = this.elements.launcher?.querySelector('input');
            if (isOpen && searchInput) {
                searchInput.focus();
            }
        });

        this.elements.statusArea?.addEventListener('click', () => {
            this.elements.quickSettings?.classList.toggle('hidden');
        });

        document.addEventListener('click', (e) => {
            if (!this.elements.launcher?.classList.contains('hidden') &&
                !this.elements.launcher.contains(e.target) &&
                !this.elements.launcherButton?.contains(e.target)) {
                this.setLauncherVisibility(false);
            }

            if (!this.elements.quickSettings?.classList.contains('hidden') &&
                !this.elements.quickSettings.contains(e.target) &&
                !this.elements.statusArea?.contains(e.target)) {
                this.elements.quickSettings.classList.add('hidden');
            }
        });
    }

    destroy() {
        Object.values(this.timers).forEach(timer => {
            if (timer) clearInterval(timer);
        });
    }
}

class QuickSettings {
    constructor() {
        this.menu = document.querySelector('.quick-settings-menu');
        if (!this.menu) return;

        this.lightModeStatus = this.menu.querySelector('#lightmode-status');
        this.batteryStatus = this.menu.querySelector('#battery-status');
        this.fullscreenTile = this.menu.querySelector('#fullscreen-tile');
        this.fullscreenStatus = this.menu.querySelector('#fs-status');

        this.setupSliders();
        this.setupTiles();
        this.initLightMode();
        this.updateFullscreenText();
        this.initBatteryStatus();
    }

    setupSliders() {
        const brightnessSlider = this.menu.querySelector('.brightness-slider input');
        if (brightnessSlider) {
            brightnessSlider.addEventListener('input', (e) => {
                console.log('Brightness:', e.target.value);
            });
        }
    }

    setupTiles() {
        if (this.fullscreenTile) {
            this.fullscreenTile.addEventListener('click', async () => {
                try {
                    if (!document.fullscreenElement) {
                        await document.documentElement.requestFullscreen();
                    } else {
                        await document.exitFullscreen();
                    }
                } catch (error) {
                    console.error('Fullscreen toggle failed:', error);
                }
                this.updateFullscreenText();
            });
        }

        document.addEventListener('fullscreenchange', () => this.updateFullscreenText());

        const lightModeTile = this.menu.querySelector('.lightmode-tile');
        if (lightModeTile) {
            lightModeTile.addEventListener('click', () => {
                const lightModeEnabled = document.body.classList.toggle('light-mode');
                localStorage.setItem('WebDesk_lightMode', lightModeEnabled ? 'on' : 'off');
                this.updateLightModeText(lightModeEnabled);
            });
        }
    }

    initLightMode() {
        const enabled = localStorage.getItem('WebDesk_lightMode') === 'on';
        document.body.classList.toggle('light-mode', enabled);
        this.updateLightModeText(enabled);
    }

    updateLightModeText(enabled) {
        if (this.lightModeStatus) {
            this.lightModeStatus.textContent = enabled ? 'On' : 'Off';
        }
    }


    updateFullscreenText() {
        if (this.fullscreenStatus) {
            this.fullscreenStatus.textContent = document.fullscreenElement ? 'On' : 'Off';
        }
    }

    initBatteryStatus() {
        if (!this.batteryStatus) return;

        const fallback = () => {
            this.batteryStatus.textContent = 'Battery: 100% (estimated)';
        };

        if (!navigator.getBattery) {
            fallback();
            return;
        }

        navigator.getBattery().then((battery) => {
            const update = () => {
                const percent = Math.round((battery.level || 1) * 100);
                const charging = battery.charging ? ' • Charging' : '';
                this.batteryStatus.textContent = `Battery: ${percent}%${charging}`;
            };

            update();
            battery.addEventListener('levelchange', update);
            battery.addEventListener('chargingchange', update);
        }).catch(fallback);
    }
}

export { UIManager, QuickSettings };
