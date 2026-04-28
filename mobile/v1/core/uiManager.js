class UIManager {
    constructor() {
        this.elements = {
            time: document.querySelector('.time'),
            date: document.querySelector('.date'),
            statusArea: document.querySelector('.status-area'),
            quickSettings: document.querySelector('.quick-settings-menu'),
            closeButton: document.getElementById('qs-close')
        };
        this.startTimers();
        this.setupEventListeners();
    }

    updateTime() {
        const now = new Date();
        this.elements.time.textContent = now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    }

    updateDate() {
        const now = new Date();
        this.elements.date.textContent = now.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
    }

    startTimers() {
        this.updateTime();
        this.updateDate();
        setInterval(() => this.updateTime(), 30000);
        setInterval(() => this.updateDate(), 1800000);
    }

    openQuickSettings() {
        this.elements.quickSettings?.classList.remove('hidden');
    }

    closeQuickSettings() {
        this.elements.quickSettings?.classList.add('hidden');
    }

    setupEventListeners() {
        const quickSettings = this.elements.quickSettings;
        this.elements.statusArea?.addEventListener('click', () => quickSettings?.classList.toggle('hidden'));
        this.elements.closeButton?.addEventListener('click', () => this.closeQuickSettings());

        let startY = 0;
        let tracking = false;

        document.addEventListener('pointerdown', (event) => {
            if (event.clientY <= 18 || this.elements.statusArea?.contains(event.target)) {
                tracking = true;
                startY = event.clientY;
            }
        });

        document.addEventListener('pointerup', (event) => {
            if (!tracking) return;
            if (event.clientY - startY > 28) this.openQuickSettings();
            tracking = false;
        });

        document.addEventListener('click', (event) => {
            if (!quickSettings || quickSettings.classList.contains('hidden')) return;
            if (!quickSettings.contains(event.target) && !this.elements.statusArea?.contains(event.target)) {
                this.closeQuickSettings();
            }
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
        this.homeLockTile = this.menu.querySelector('#home-lock-tile');

        this.setupSliders();
        this.setupTiles();
        this.initLightMode();
        this.updateFullscreenText();
        this.initBatteryStatus();
    }

    setupSliders() {
        const brightnessSlider = this.menu.querySelector('.brightness-slider input');
        brightnessSlider?.addEventListener('input', (event) => {
            const value = Number(event.target.value);
            document.getElementById('mobile-shell').style.filter = `brightness(${value / 100})`;
        });
    }

    setupTiles() {
        this.fullscreenTile?.addEventListener('click', async () => {
            try {
                if (!document.fullscreenElement) await document.documentElement.requestFullscreen();
                else await document.exitFullscreen();
            } catch (error) {
                console.error('Fullscreen toggle failed:', error);
            }
            this.updateFullscreenText();
        });

        document.addEventListener('fullscreenchange', () => this.updateFullscreenText());

        this.menu.querySelector('.lightmode-tile')?.addEventListener('click', () => {
            const enabled = document.body.classList.toggle('light-mode');
            localStorage.setItem('WebDesk_lightMode', enabled ? 'on' : 'off');
            this.updateLightModeText(enabled);
        });

        this.homeLockTile?.addEventListener('click', () => {
            const unlocked = document.body.classList.toggle('home-edit-unlocked');
            this.homeLockTile.classList.toggle('active', unlocked);
            this.homeLockTile.querySelector('.tile-sublabel').textContent = unlocked ? 'Edit on' : 'Edit off';
        });
    }

    initLightMode() {
        const enabled = localStorage.getItem('WebDesk_lightMode') === 'on';
        document.body.classList.toggle('light-mode', enabled);
        this.updateLightModeText(enabled);
    }

    updateLightModeText(enabled) {
        if (this.lightModeStatus) this.lightModeStatus.textContent = enabled ? 'On' : 'Off';
    }

    updateFullscreenText() {
        if (this.fullscreenStatus) this.fullscreenStatus.textContent = document.fullscreenElement ? 'On' : 'Off';
    }

    initBatteryStatus() {
        if (!this.batteryStatus) return;
        const fallback = () => { this.batteryStatus.textContent = 'Battery: 100% (estimated)'; };
        if (!navigator.getBattery) return fallback();

        navigator.getBattery().then((battery) => {
            const update = () => {
                const percent = Math.round((battery.level || 1) * 100);
                const charging = battery.charging ? ' • Charging' : '';
                this.batteryStatus.textContent = `Battery: ${percent}%${charging}`;
                const pill = document.querySelector('.battery-percent');
                if (pill) pill.textContent = `${percent}%`;
            };
            update();
            battery.addEventListener('levelchange', update);
            battery.addEventListener('chargingchange', update);
        }).catch(fallback);
    }
}

export { UIManager, QuickSettings };
