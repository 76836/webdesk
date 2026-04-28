class WindowManager {
    constructor() {
        this.openWindows = new Map();
        this.nextZIndex = 40;
        this.appConfigs = new Map();
        this.pinnedApps = [];
        this.activeWindowId = null;
    }

    registerApp(id, config) {
        this.appConfigs.set(id, config);
        if (config.pinned && !this.pinnedApps.includes(id)) this.pinnedApps.push(id);
    }

    createWindow(id, config) {
        const existing = this.openWindows.get(id);
        if (existing) {
            this.restoreWindow(id);
            return existing.element;
        }

        const windowEl = document.createElement('div');
        windowEl.className = 'app-window active';
        windowEl.dataset.appId = id;
        windowEl.innerHTML = `
            <div class="title-bar">
                <span class="title">${config.title}</span>
                <div class="window-controls">
                    <span class="minimize" title="Minimize">−</span>
                    <span class="maximize" title="Fullscreen">□</span>
                    <span class="close" title="Close">×</span>
                </div>
            </div>
            <div class="app-content"></div>
        `;

        const iframe = document.createElement('iframe');
        iframe.src = config.url;
        iframe.loading = 'eager';
        windowEl.querySelector('.app-content').appendChild(iframe);

        document.querySelector('.workspace')?.appendChild(windowEl);
        this.openWindows.set(id, { id, element: windowEl, state: 'open', isFullscreen: false, lastActive: Date.now() });

        this.setupWindowEvents(id);
        this.restoreWindow(id);
        return windowEl;
    }

    setupWindowEvents(id) {
        const win = this.openWindows.get(id);
        if (!win) return;
        const el = win.element;

        el.querySelector('.minimize')?.addEventListener('click', (e) => {
            e.stopPropagation();
            this.minimizeWindow(id);
        });

        el.querySelector('.close')?.addEventListener('click', (e) => {
            e.stopPropagation();
            this.closeWindow(id);
        });

        el.querySelector('.maximize')?.addEventListener('click', (e) => {
            e.stopPropagation();
            this.toggleMaximize(id);
        });

        el.addEventListener('pointerdown', () => this.bringToFront(id));
    }

    getWindowsInRecentsOrder() {
        return Array.from(this.openWindows.values()).sort((a, b) => b.lastActive - a.lastActive);
    }

    bringToFront(id) {
        const win = this.openWindows.get(id);
        if (!win) return;
        this.openWindows.forEach((w) => w.element.classList.remove('active'));
        win.element.classList.add('active');
        win.element.style.display = 'flex';
        win.element.style.zIndex = ++this.nextZIndex;
        win.state = 'open';
        win.lastActive = Date.now();
        this.activeWindowId = id;
    }

    minimizeWindow(id) {
        const win = this.openWindows.get(id);
        if (!win) return;
        win.state = 'minimized';
        win.element.classList.remove('active');
        win.element.style.display = 'none';

        if (this.activeWindowId === id) {
            this.activeWindowId = null;
            const next = this.getWindowsInRecentsOrder().find((w) => w.state === 'open');
            if (next) this.bringToFront(next.id);
        }
    }

    minimizeAll() {
        this.openWindows.forEach((win) => {
            win.state = 'minimized';
            win.element.classList.remove('active');
            win.element.style.display = 'none';
        });
        this.activeWindowId = null;
    }

    restoreWindow(id) {
        const win = this.openWindows.get(id);
        if (!win) return;
        win.state = 'open';
        win.element.style.display = 'flex';
        this.bringToFront(id);
    }

    closeWindow(id) {
        const win = this.openWindows.get(id);
        if (!win) return;
        win.element.remove();
        this.openWindows.delete(id);

        if (this.activeWindowId === id) {
            this.activeWindowId = null;
            const next = this.getWindowsInRecentsOrder().find((w) => w.state === 'open');
            if (next) this.bringToFront(next.id);
        }
    }

    toggleMaximize(id) {
        const win = this.openWindows.get(id);
        if (!win) return;
        win.isFullscreen = !win.isFullscreen;
        win.element.querySelector('.title-bar').style.display = win.isFullscreen ? 'none' : 'flex';
    }

    generateIcon(title) {
        const letter = title.charAt(0).toUpperCase();
        const hue = Math.abs(title.split('').reduce((h, c) => h + c.charCodeAt(0), 0)) % 360;
        return `<svg viewBox="0 0 48 48" width="100%" height="100%"><rect x="2" y="2" width="44" height="44" rx="14" fill="hsl(${hue},72%,48%)"/><text x="50%" y="52%" dominant-baseline="central" text-anchor="middle" fill="#fff" font-size="24" font-family="sans-serif">${letter}</text></svg>`;
    }
}

export default WindowManager;
