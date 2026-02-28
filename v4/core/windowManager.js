import WindowResizeManager from './windowResizeManager.js';

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

        taskbarIcon.addEventListener('click', () => {
            const appConfig = this.appConfigs.get(id) || config;
            this.createWindow(id, appConfig);
        });

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
        win.taskbarIcon.onclick = () => {
            const appConfig = this.appConfigs.get(id);
            if (!appConfig) return;
            if (this.openWindows.has(id)) {
                this.toggleWindow(id);
            } else {
                this.createWindow(id, appConfig);
            }
        };
        win.taskbarIcon.oncontextmenu = (event) => {
            event.preventDefault();
            if (window.showAppContextMenu) {
                window.showAppContextMenu(event.pageX, event.pageY, id);
            }
        };

        el.onmousedown = () => {
            if (win.state === 'open') el.style.zIndex = ++this.nextZIndex;
        };

        const titleBar = el.querySelector('.title-bar');
        titleBar.onmousedown = (e) => {
            if (e.target.closest('.window-controls')) return;
            
            if (win.isMaximized) this.toggleMaximize(id);

            const startX = e.clientX - el.offsetLeft;
            const startY = e.clientY - el.offsetTop;
            
            this.resizeManager.overlay.style.display = 'block';
            this.resizeManager.overlay.style.pointerEvents = 'auto';
            this.resizeManager.overlay.style.cursor = 'move';

            const onMouseMove = (moveEvent) => {
                const x = moveEvent.clientX;
                const y = moveEvent.clientY;
                el.style.left = (x - startX) + 'px';
                el.style.top = (y - startY) + 'px';
                this.updateSnapPreview(x, y);
            };

            const onMouseUp = (upEvent) => {
                document.removeEventListener('mousemove', onMouseMove);
                document.removeEventListener('mouseup', onMouseUp);
                this.resizeManager.overlay.style.display = 'none';
                this.resizeManager.overlay.style.pointerEvents = 'none';
                this.snapPreview.style.display = 'none';
                this.checkSnap(id, upEvent.clientX, upEvent.clientY);
            };

            document.addEventListener('mousemove', onMouseMove);
            document.addEventListener('mouseup', onMouseUp);
            e.preventDefault();
        };
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
