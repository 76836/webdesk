import WindowResizeManager from './windowResizeManager.js';

/** Normalize mouse/touch to client coordinates (touch acts like click-drag). */
function pointerClient(e) {
    if (e.touches && e.touches[0]) {
        return { x: e.touches[0].clientX, y: e.touches[0].clientY };
    }
    if (e.changedTouches && e.changedTouches[0]) {
        return { x: e.changedTouches[0].clientX, y: e.changedTouches[0].clientY };
    }
    return { x: e.clientX, y: e.clientY };
}

class WindowManager {
    constructor() {
        this.openWindows = new Map();
        this.nextZIndex = 100;
        this.appConfigs = new Map();
        this.pinnedApps = [];
        this.resizeManager = new WindowResizeManager(this);
        
        // Create snap preview element
        this.snapPreview = document.createElement('div');
        this.snapPreview.className = 'snap-preview';
        Object.assign(this.snapPreview.style, {
            position: 'fixed',
            border: '2px solid rgba(255,255,255,0.5)',
            background: 'rgba(255,255,255,0.2)',
            zIndex: 99999,
            pointerEvents: 'none',
            display: 'none',
            borderRadius: '8px',
            transition: 'all 0.15s ease-out'
        });
        document.body.appendChild(this.snapPreview);

        this.ensureContainers();
    }

    registerApp(id, config) {
        this.appConfigs.set(id, config);
        if (config.pinned) {
            if (!this.pinnedApps.includes(id)) {
                this.pinnedApps.push(id);
            }
            this.addTaskbarIcon(id, config);
        }
    }

    ensureContainers() {
        if (!document.querySelector('.launcher-grid')) {
            const grid = document.createElement('div');
            grid.className = 'launcher-grid';
            document.querySelector('.app-launcher-view')?.appendChild(grid);
        }
        if (!document.querySelector('.shelf-items-left')) {
            const shelf = document.createElement('div');
            shelf.className = 'shelf-items-left';
            document.querySelector('.shelf')?.insertBefore(shelf, document.querySelector('.status-area'));
        }
    }


    addTaskbarIcon(id, config) {
        let taskbarIcon = document.querySelector(`.shelf-item[data-app-id="${id}"]`);
        if (taskbarIcon) return taskbarIcon;

        taskbarIcon = document.createElement('div');
        taskbarIcon.className = 'shelf-item';
        taskbarIcon.dataset.appId = id;
        taskbarIcon.title = config.title;
        this.setTaskbarIcon(taskbarIcon, config);

        taskbarIcon.onclick = () => {
            const appConfig = this.appConfigs.get(id) || config;
            if (!appConfig) return;
            if (this.openWindows.has(id)) {
                this.toggleWindow(id);
            } else {
                this.createWindow(id, appConfig);
            }
        };

        taskbarIcon.addEventListener('contextmenu', (event) => {
            event.preventDefault();
            if (window.showAppContextMenu) {
                window.showAppContextMenu(event.pageX, event.pageY, id);
            }
        });

        document.querySelector('.shelf-items-left').appendChild(taskbarIcon);
        return taskbarIcon;
    }

    createWindow(id, config) {
        const existingWindow = this.openWindows.get(id);
        if (existingWindow) {
            if (existingWindow.state === 'minimized') this.restoreWindow(id);
            return;
        }

        // Apps that need SharedArrayBuffer (e.g. Firefox WASM) cannot run in an
        // iframe unless the whole desktop is crossOriginIsolated. Open top-level.
        const needsTopLevel =
            config.openMode === 'popup' ||
            (typeof config.url === 'string' && /firefox-wasm/i.test(config.url));
        if (needsTopLevel && config.url) {
            const w = Math.min(1280, Math.round(screen.availWidth * 0.9));
            const h = Math.min(900, Math.round(screen.availHeight * 0.9));
            const left = Math.max(0, Math.round((screen.availWidth - w) / 2));
            const top = Math.max(0, Math.round((screen.availHeight - h) / 2));
            const features = `popup=yes,width=${w},height=${h},left=${left},top=${top}`;
            const win = window.open(config.url, 'webdesk_' + id, features);
            if (!win) {
                // Popup blocked — fall through to iframe (will show isolation error)
                console.warn('[WebDesk] popup blocked for', id);
            } else {
                this.addTaskbarIcon(id, config);
                return;
            }
        }

        const taskbarIcon = this.addTaskbarIcon(id, config);

        const windowEl = document.createElement('div');
        windowEl.className = 'app-window';
        windowEl.dataset.appId = id;
        windowEl.innerHTML = `
            <div class="title-bar">
                <span class="title">${config.title}</span>
                <div class="window-controls">
                    <span class="minimize" title="Minimize">−</span>
                    <span class="maximize" title="Maximize">□</span>
                    <span class="close" title="Close">×</span>
                </div>
            </div>
            <div class="app-content"></div>
        `;

        Object.assign(windowEl.style, {
            width: '800px',
            height: '600px',
            left: '50px',
            top: '50px',
            display: 'flex',
            zIndex: ++this.nextZIndex
        });

        const content = windowEl.querySelector('.app-content');
        const iframe = document.createElement('iframe');
        iframe.src = config.url;
        iframe.frameBorder = '0';
        iframe.width = '100%';
        iframe.height = '100%';
        iframe.style.flex = '1';
        iframe.style.display = 'block';
        content.appendChild(iframe);

        document.querySelector('.os-desktop').appendChild(windowEl);

        this.openWindows.set(id, {
            id,
            element: windowEl,
            taskbarIcon,
            state: 'open',
            isMaximized: false,
            oldRect: null
        });

        this.setupWindowEvents(id);
        this.resizeManager.setupResizeHandlers(windowEl);
    }

    setupWindowEvents(id) {
        const win = this.openWindows.get(id);
        const el = win.element;

        el.querySelector('.minimize').onclick = (e) => { e.stopPropagation(); this.minimizeWindow(id); };
        el.querySelector('.maximize').onclick = (e) => { e.stopPropagation(); this.toggleMaximize(id); };
        el.querySelector('.close').onclick = (e) => { e.stopPropagation(); this.closeWindow(id); };
        win.taskbarIcon.oncontextmenu = (event) => {
            event.preventDefault();
            if (window.showAppContextMenu) {
                window.showAppContextMenu(event.pageX, event.pageY, id);
            }
        };

        const focusWin = () => {
            if (win.state === 'open') el.style.zIndex = ++this.nextZIndex;
        };
        el.addEventListener('mousedown', focusWin);
        el.addEventListener('touchstart', focusWin, { passive: true });

        const titleBar = el.querySelector('.title-bar');
        const beginDrag = (e) => {
            if (e.target.closest('.window-controls')) return;
            // Ignore multi-touch
            if (e.touches && e.touches.length > 1) return;

            if (win.isMaximized) this.toggleMaximize(id);

            const pt = pointerClient(e);
            const startX = pt.x - el.offsetLeft;
            const startY = pt.y - el.offsetTop;

            this.resizeManager.overlay.style.display = 'block';
            this.resizeManager.overlay.style.pointerEvents = 'auto';
            this.resizeManager.overlay.style.cursor = 'move';

            const onMove = (moveEvent) => {
                const p = pointerClient(moveEvent);
                el.style.left = (p.x - startX) + 'px';
                el.style.top = (p.y - startY) + 'px';
                this.updateSnapPreview(p.x, p.y);
                if (moveEvent.cancelable) moveEvent.preventDefault();
            };

            const onUp = (upEvent) => {
                document.removeEventListener('mousemove', onMove);
                document.removeEventListener('mouseup', onUp);
                document.removeEventListener('touchmove', onMove);
                document.removeEventListener('touchend', onUp);
                document.removeEventListener('touchcancel', onUp);
                this.resizeManager.overlay.style.display = 'none';
                this.resizeManager.overlay.style.pointerEvents = 'none';
                this.snapPreview.style.display = 'none';
                const p = pointerClient(upEvent);
                this.checkSnap(id, p.x, p.y);
            };

            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onUp);
            document.addEventListener('touchmove', onMove, { passive: false });
            document.addEventListener('touchend', onUp);
            document.addEventListener('touchcancel', onUp);
            if (e.cancelable) e.preventDefault();
        };

        titleBar.addEventListener('mousedown', beginDrag);
        titleBar.addEventListener('touchstart', beginDrag, { passive: false });
    }

    updateSnapPreview(x, y) {
        const snap = this.getSnapAction(x, y);
        if (snap) {
            Object.assign(this.snapPreview.style, {
                display: 'block',
                left: snap.left + 'px',
                top: snap.top + 'px',
                width: snap.width + 'px',
                height: snap.height + 'px'
            });
        } else {
            this.snapPreview.style.display = 'none';
        }
    }

    getSnapAction(x, y) {
        const threshold = 15;
        const w = window.innerWidth;
        const h = window.innerHeight - 48;

        if (x < threshold && y < threshold) return { left: 0, top: 0, width: w/2, height: h/2 };
        if (x > w - threshold && y < threshold) return { left: w/2, top: 0, width: w/2, height: h/2 };
        if (x < threshold && y > h - threshold) return { left: 0, top: h/2, width: w/2, height: h/2 };
        if (x > w - threshold && y > h - threshold) return { left: w/2, top: h/2, width: w/2, height: h/2 };

        if (y < threshold) return { left: 0, top: 0, width: w, height: h/2 };
        if (y > h - threshold) return { left: 0, top: h/2, width: w, height: h/2 };
        if (x < threshold) return { left: 0, top: 0, width: w/2, height: h };
        if (x > w - threshold) return { left: w/2, top: 0, width: w/2, height: h };

        return null;
    }

    checkSnap(id, x, y) {
        const snap = this.getSnapAction(x, y);
        if (snap) {
            const win = this.openWindows.get(id);
            win.oldRect = {
                width: win.element.style.width,
                height: win.element.style.height,
                left: win.element.style.left,
                top: win.element.style.top
            };
            Object.assign(win.element.style, {
                left: snap.left + 'px',
                top: snap.top + 'px',
                width: snap.width + 'px',
                height: snap.height + 'px'
            });
        }
    }

    toggleMaximize(id) {
        const win = this.openWindows.get(id);
        if (!win) return;
        if (win.isMaximized) {
            Object.assign(win.element.style, win.oldRect);
            win.isMaximized = false;
        } else {
            win.oldRect = {
                width: win.element.style.width,
                height: win.element.style.height,
                left: win.element.style.left,
                top: win.element.style.top
            };
            Object.assign(win.element.style, {
                width: '100vw',
                height: 'calc(100vh - 48px)',
                left: '0',
                top: '0'
            });
            win.isMaximized = true;
        }
    }

    minimizeWindow(id) {
        const win = this.openWindows.get(id);
        if (!win) return;
        win.state = 'minimized';
        win.element.style.display = 'none';
        win.taskbarIcon.classList.remove('active');
    }

    restoreWindow(id) {
        const win = this.openWindows.get(id);
        if (!win) return;
        win.state = 'open';
        win.element.style.display = 'flex';
        win.element.style.zIndex = ++this.nextZIndex;
        win.taskbarIcon.classList.add('active');
    }

    closeWindow(id) {
        const win = this.openWindows.get(id);
        if (!win) return;
        const iframes = win.element.querySelectorAll('iframe');
        iframes.forEach(iframe => {
            iframe.src = 'about:blank';
            iframe.remove();
        });
        win.element.remove();
        if (!this.pinnedApps?.includes(id)) {
            win.taskbarIcon.remove();
        }
        this.openWindows.delete(id);
    }

    toggleWindow(id) {
        const win = this.openWindows.get(id);
        if (!win) return;
        if (win.state === 'minimized') {
            this.restoreWindow(id);
        } else {
            this.minimizeWindow(id);
        }
    }

    generateIcon(title) {
        const letter = title.charAt(0).toUpperCase();
        const hue = Math.abs(title.split('').reduce((h, c) => h + c.charCodeAt(0), 0)) % 360;
        return `<svg viewBox="0 0 48 48" width="100%" height="100%"><circle cx="24" cy="24" r="22" fill="hsl(${hue}, 70%, 50%)" /><text x="50%" y="50%" dominant-baseline="central" text-anchor="middle" fill="#ffffff" font-size="24" font-family="sans-serif">${letter}</text></svg>`;
    }

    setTaskbarIcon(element, config) {
        element.title = config.title || element.title;
        if (config.iconUrl) {
            const img = document.createElement('img');
            img.src = config.iconUrl;
            img.style.width = '100%';
            img.style.height = '100%';
            img.style.objectFit = 'cover';
            img.style.borderRadius = '50%';
            img.addEventListener('error', () => {
                img.style.display = 'none';
                element.innerHTML = this.generateIcon(config.title);
            });
            element.innerHTML = '';
            element.appendChild(img);
        } else {
            element.innerHTML = this.generateIcon(config.title);
        }
    }
}

export default WindowManager;
