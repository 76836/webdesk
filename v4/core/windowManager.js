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
            oldRect: null,
            config
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
            // Never treat window controls or in-game menu as a drag
            if (e.target.closest('.window-controls, .games-menu, .games-menu-btn, .games-fps')) return;
            // Ignore multi-touch
            if (e.touches && e.touches.length > 1) return;

            // Games immersive mode: title islet is not a drag handle (avoids accidental exit)
            if (win.isMaximized && win.element.classList.contains('games-mode')) return;

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


    isGamesApp(id) {
        const win = this.openWindows.get(id);
        if (!win) return false;
        const cfg = win.config || {};
        if (cfg.gamesMode) return true;
        const url = String(cfg.url || '');
        const title = String(cfg.title || '').toLowerCase();
        if (title.includes('games launcher') || title === 'games') return true;
        if (/76836\.github\.io\/games\/?(\?|$)/i.test(url)) return true;
        return false;
    }

    startGamesFps(id) {
        const win = this.openWindows.get(id);
        if (!win || win._fpsRaf) return;
        const label = win.element.querySelector('.games-fps');
        if (!label) return;
        let frames = 0;
        let last = performance.now();
        const tick = (now) => {
            if (!win.element.classList.contains('games-mode')) {
                win._fpsRaf = null;
                return;
            }
            frames++;
            if (now - last >= 500) {
                const fps = Math.round((frames * 1000) / (now - last));
                label.textContent = fps + ' FPS';
                frames = 0;
                last = now;
            }
            win._fpsRaf = requestAnimationFrame(tick);
        };
        win._fpsRaf = requestAnimationFrame(tick);
    }

    stopGamesFps(id) {
        const win = this.openWindows.get(id);
        if (!win) return;
        if (win._fpsRaf) {
            cancelAnimationFrame(win._fpsRaf);
            win._fpsRaf = null;
        }
    }

    removeGamesChrome(id) {
        const win = this.openWindows.get(id);
        if (!win) return;
        this.stopGamesFps(id);
        win.element.querySelectorAll('.games-fps, .games-menu-btn, .games-menu').forEach((n) => n.remove());
    }

    closeOtherWindows(exceptId) {
        const ids = [...this.openWindows.keys()];
        ids.forEach((id) => {
            if (id !== exceptId) this.closeWindow(id);
        });
    }

    async runPingTest(menuEl) {
        const result = menuEl.querySelector('.games-ping-result');
        if (!result) return;
        result.textContent = 'Pinging…';
        const targets = [
            { name: 'Cloudflare', url: 'https://www.cloudflare.com/cdn-cgi/trace' },
            { name: 'GitHub', url: 'https://api.github.com' },
        ];
        const lines = [];
        for (const t of targets) {
            const t0 = performance.now();
            try {
                await fetch(t.url, { method: 'GET', mode: 'cors', cache: 'no-store' });
                const ms = Math.round(performance.now() - t0);
                lines.push(t.name + ': ' + ms + ' ms');
            } catch (_) {
                const ms = Math.round(performance.now() - t0);
                // CORS/opaque may still give timing
                lines.push(t.name + ': ~' + ms + ' ms (blocked/opaque)');
            }
        }
        result.textContent = lines.join(' · ');
    }

    ensureGamesMenu(id) {
        const win = this.openWindows.get(id);
        if (!win) return;
        const controls = win.element.querySelector('.window-controls');
        if (!controls) return;

        if (!controls.querySelector('.games-fps')) {
            const fps = document.createElement('span');
            fps.className = 'games-fps';
            fps.title = 'Frames per second';
            fps.textContent = '— FPS';
            controls.insertBefore(fps, controls.firstChild);
        }

        if (!controls.querySelector('.games-menu-btn')) {
            const btn = document.createElement('span');
            btn.className = 'games-menu-btn';
            btn.title = 'Game menu';
            btn.setAttribute('role', 'button');
            btn.textContent = '☰';
            const fps = controls.querySelector('.games-fps');
            if (fps && fps.nextSibling) controls.insertBefore(btn, fps.nextSibling);
            else controls.insertBefore(btn, controls.firstChild);

            const menu = document.createElement('div');
            menu.className = 'games-menu';
            menu.hidden = true;
            menu.innerHTML = `
                <div class="games-menu-grid">
                    <button type="button" class="games-menu-tile" data-action="close-others">
                        <span class="gmt-icon" aria-hidden="true">⧉</span>
                        <span class="gmt-label">Close others</span>
                        <span class="gmt-sub">Hide other apps</span>
                    </button>
                    <button type="button" class="games-menu-tile" data-action="fullscreen">
                        <span class="gmt-icon" aria-hidden="true">⛶</span>
                        <span class="gmt-label">Fullscreen</span>
                        <span class="gmt-sub">Browser display</span>
                    </button>
                    <button type="button" class="games-menu-tile" data-action="ping">
                        <span class="gmt-icon" aria-hidden="true">⌁</span>
                        <span class="gmt-label">Ping test</span>
                        <span class="gmt-sub">Check connection</span>
                    </button>
                    <button type="button" class="games-menu-tile games-menu-tile-danger" data-action="quit">
                        <span class="gmt-icon" aria-hidden="true">⌂</span>
                        <span class="gmt-label">Quit game</span>
                        <span class="gmt-sub">Back to launcher</span>
                    </button>
                </div>
                <div class="games-ping-result" hidden></div>
            `;
            const titleBar = win.element.querySelector('.title-bar');
            titleBar.appendChild(menu);

            const stop = (e) => { e.stopPropagation(); e.preventDefault(); };

            btn.addEventListener('mousedown', stop);
            btn.addEventListener('touchstart', stop, { passive: false });
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                e.preventDefault();
                menu.hidden = !menu.hidden;
                if (menu.hidden) {
                    const pr = menu.querySelector('.games-ping-result');
                    if (pr) { pr.hidden = true; pr.textContent = ''; }
                }
            });

            menu.addEventListener('mousedown', stop);
            menu.addEventListener('touchstart', stop, { passive: false });
            menu.addEventListener('click', (e) => e.stopPropagation());

            menu.querySelector('[data-action="close-others"]').onclick = (e) => {
                e.stopPropagation();
                this.closeOtherWindows(id);
                menu.hidden = true;
            };
            menu.querySelector('[data-action="fullscreen"]').onclick = async (e) => {
                e.stopPropagation();
                try {
                    if (!document.fullscreenElement) await document.documentElement.requestFullscreen();
                    else await document.exitFullscreen();
                } catch (err) {
                    console.warn('fullscreen failed', err);
                }
                menu.hidden = true;
            };
            menu.querySelector('[data-action="ping"]').onclick = (e) => {
                e.stopPropagation();
                const pr = menu.querySelector('.games-ping-result');
                if (pr) pr.hidden = false;
                this.runPingTest(menu);
            };
            menu.querySelector('[data-action="quit"]').onclick = (e) => {
                e.stopPropagation();
                const ok = window.confirm(
                    'Quit game and return to the Games Launcher?\n\nUnsaved progress in the current game may be lost.'
                );
                if (!ok) return;
                const iframe = win.element.querySelector('iframe');
                const home = (win.config && win.config.url) || 'https://76836.github.io/games';
                // Stay in immersive mode — only navigate the iframe back to the launcher
                if (iframe) iframe.src = home;
                menu.hidden = true;
            };

            const onDoc = (ev) => {
                if (!win.element.classList.contains('games-mode')) {
                    document.removeEventListener('mousedown', onDoc);
                    return;
                }
                if (!menu.contains(ev.target) && ev.target !== btn && !btn.contains(ev.target)) {
                    menu.hidden = true;
                }
            };
            document.addEventListener('mousedown', onDoc);
            win._gamesMenuDocHandler = onDoc;
        }
    }

    applyGamesMode(id, on) {
        const win = this.openWindows.get(id);
        if (!win || !this.isGamesApp(id)) return;
        const el = win.element;
        const desktop = document.querySelector('.os-desktop');
        if (on) {
            el.classList.add('games-mode');
            document.body.classList.add('webdesk-games-mode');
            if (desktop) desktop.classList.add('webdesk-games-mode');
            this.ensureGamesMenu(id);
            this.startGamesFps(id);
        } else {
            el.classList.remove('games-mode');
            this.removeGamesChrome(id);
            if (win._gamesMenuDocHandler) {
                document.removeEventListener('mousedown', win._gamesMenuDocHandler);
                win._gamesMenuDocHandler = null;
            }
            let any = false;
            this.openWindows.forEach((w) => {
                if (w.element.classList.contains('games-mode')) any = true;
            });
            if (!any) {
                document.body.classList.remove('webdesk-games-mode');
                if (desktop) desktop.classList.remove('webdesk-games-mode');
            }
        }
    }

    toggleMaximize(id) {
        const win = this.openWindows.get(id);
        if (!win) return;
        if (win.isMaximized) {
            Object.assign(win.element.style, win.oldRect || {});
            win.isMaximized = false;
            win.element.classList.remove('maximized');
            this.applyGamesMode(id, false);
        } else {
            win.oldRect = {
                width: win.element.style.width,
                height: win.element.style.height,
                left: win.element.style.left,
                top: win.element.style.top
            };
            const games = this.isGamesApp(id);
            Object.assign(win.element.style, {
                width: '100vw',
                height: games ? '100vh' : 'calc(100vh - 48px)',
                left: '0',
                top: '0'
            });
            win.isMaximized = true;
            win.element.classList.add('maximized');
            this.applyGamesMode(id, games);
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
        this.applyGamesMode(id, false);
        this.stopGamesFps(id);
        win.element.classList.remove('games-mode', 'maximized');
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
