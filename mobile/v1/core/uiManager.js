class UIManager {
    constructor() {
        this.elements = {
            time: document.querySelector('.time'),
            date: document.querySelector('.date'),
            statusArea: document.querySelector('.status-area'),
            quickSettings: document.querySelector('.quick-settings-menu')
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
        this.elements.date.textContent = now.toLocaleDateString([], { month: 'short', day: 'numeric' });
    }

    startTimers() {
        this.updateTime();
        this.updateDate();
        setInterval(() => this.updateTime(), 60000);
        setInterval(() => this.updateDate(), 3600000);
    }

    setupEventListeners() {
        const quickSettings = this.elements.quickSettings;
        this.elements.statusArea?.addEventListener('click', () => quickSettings?.classList.toggle('hidden'));

        let startY = 0;
        let tracking = false;

        this.elements.statusArea?.addEventListener('pointerdown', (event) => {
            tracking = true;
            startY = event.clientY;
        });

        document.addEventListener('pointerup', (event) => {
            if (!tracking) return;
            if (event.clientY - startY > 20) quickSettings?.classList.remove('hidden');
            tracking = false;
        });

        document.addEventListener('click', (e) => {
            if (!quickSettings || quickSettings.classList.contains('hidden')) return;
            if (!quickSettings.contains(e.target) && !this.elements.statusArea?.contains(e.target)) {
                quickSettings.classList.add('hidden');
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

        this.setupSliders();
        this.setupTiles();
        this.initLightMode();
        this.updateFullscreenText();
        this.initBatteryStatus();
    }

    setupSliders() {
        const brightnessSlider = this.menu.querySelector('.brightness-slider input');
        brightnessSlider?.addEventListener('input', (e) => {
            const value = Number(e.target.value);
            document.querySelector('.mobile-shell').style.filter = `brightness(${Math.max(0.35, value / 100)})`;
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
                this.batteryStatus.textContent = `Battery: ${percent}%${battery.charging ? ' • Charging' : ''}`;
            };
            update();
            battery.addEventListener('levelchange', update);
            battery.addEventListener('chargingchange', update);
        }).catch(fallback);
    }
}

export { UIManager, QuickSettings };
