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
        content.style.display = 'flex';
        content.style.flexDirection = 'column';
        content.style.flex = '1';
        content.style.minHeight = '0';
        content.style.overflow = 'hidden';

        let launchUrl = config.url;
        try {
            const u = new URL(String(launchUrl), window.location.href);
            if (u.hostname === '76836.github.io' && /\/games\/?$/i.test(u.pathname)) {
                u.searchParams.set('embed', 'true');
                launchUrl = u.toString();
            }
        } catch (_) {}

        document.querySelector('.os-desktop').appendChild(windowEl);

        this.openWindows.set(id, {
            id,
            element: windowEl,
            taskbarIcon,
            state: 'open',
            isMaximized: false,
            oldRect: null,
            config,
            native: !!(config.WDNative || config.wdNative)
        });

        this.setupWindowEvents(id);
        this.resizeManager.setupResizeHandlers(windowEl);

        if (config.WDNative || config.wdNative) {
            this.loadNativeApp(id, content, launchUrl).catch((err) => {
                console.error('[WebDesk WDNative]', err);
                content.innerHTML = '';
                const errEl = document.createElement('div');
                errEl.className = 'wd-native-error';
                errEl.style.cssText = 'padding:16px;color:#ff8a80;font:14px system-ui;';
                errEl.textContent = 'WDNative failed to load: ' + (err && err.message ? err.message : String(err));
                content.appendChild(errEl);
                // Fallback iframe so the app is still reachable
                const iframe = document.createElement('iframe');
                iframe.src = launchUrl;
                iframe.frameBorder = '0';
                iframe.style.cssText = 'flex:1;width:100%;height:100%;border:0;display:block;';
                content.appendChild(iframe);
            });
        } else {
            const iframe = document.createElement('iframe');
            iframe.src = launchUrl;
            iframe.frameBorder = '0';
            iframe.width = '100%';
            iframe.height = '100%';
            iframe.style.flex = '1';
            iframe.style.display = 'block';
            iframe.style.border = '0';
            content.appendChild(iframe);
        }
    }

    absolutizeUrl(url, baseHref) {
        if (!url) return url;
        const t = String(url).trim();
        if (!t || t.startsWith('data:') || t.startsWith('blob:') || t.startsWith('javascript:') || t.startsWith('#')) return t;
        try { return new URL(t, baseHref).href; } catch (_) { return t; }
    }

    rewriteDocumentUrls(doc, baseHref) {
        const attrs = [
            ['src', 'script'], ['src', 'img'], ['src', 'audio'], ['src', 'video'], ['src', 'source'],
            ['src', 'embed'], ['src', 'iframe'], ['href', 'link'], ['href', 'a'],
            ['data', 'object'], ['poster', 'video']
        ];
        attrs.forEach(([attr, sel]) => {
            doc.querySelectorAll(sel + '[' + attr + ']').forEach((el) => {
                el.setAttribute(attr, this.absolutizeUrl(el.getAttribute(attr), baseHref));
            });
        });
        doc.querySelectorAll('[srcset]').forEach((el) => {
            const rewritten = el.getAttribute('srcset').split(',').map((part) => {
                const bits = part.trim().split(/\s+/);
                if (!bits[0]) return part;
                bits[0] = this.absolutizeUrl(bits[0], baseHref);
                return bits.join(' ');
            }).join(', ');
            el.setAttribute('srcset', rewritten);
        });
        // url(...) in inline style attributes
        doc.querySelectorAll('[style]').forEach((el) => {
            el.setAttribute('style', el.getAttribute('style').replace(/url\((['"]?)([^)'"]+)\1\)/gi, (_, q, u) => {
                return 'url(' + q + this.absolutizeUrl(u, baseHref) + q + ')';
            }));
        });
    }

    async loadNativeApp(id, contentEl, url) {
        contentEl.innerHTML = '';
        const loading = document.createElement('div');
        loading.className = 'wd-native-loading';
        loading.style.cssText = 'padding:16px;color:#afd3ff;font:13px system-ui;';
        loading.textContent = 'Loading native app…';
        contentEl.appendChild(loading);

        const res = await fetch(url, { mode: 'cors', credentials: 'omit', cache: 'no-cache' });
        if (!res.ok) throw new Error('HTTP ' + res.status + ' fetching ' + url);
        const html = await res.text();
        const baseHref = new URL(url, window.location.href).href;

        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');
        this.rewriteDocumentUrls(doc, baseHref);

        const root = document.createElement('div');
        root.className = 'wd-native-root';
        root.dataset.nativeUrl = baseHref;
        root.style.cssText = 'flex:1;min-height:0;width:100%;height:100%;overflow:auto;position:relative;';

        // Pull stylesheet links + style tags into the root (scoped as much as possible)
        doc.querySelectorAll('link[rel="stylesheet"], style').forEach((node) => {
            root.appendChild(node.cloneNode(true));
        });

        const bodyWrap = document.createElement('div');
        bodyWrap.className = 'wd-native-body';
        bodyWrap.style.cssText = 'min-height:100%;';
        // Clone body children except scripts (scripts handled separately)
        Array.from(doc.body ? doc.body.childNodes : []).forEach((node) => {
            if (node.nodeName === 'SCRIPT') return;
            bodyWrap.appendChild(node.cloneNode(true));
        });
        root.appendChild(bodyWrap);

        contentEl.innerHTML = '';
        contentEl.appendChild(root);

        // Execute scripts in order (clone so they run in this document)
        const scripts = Array.from(doc.querySelectorAll('script'));
        for (const old of scripts) {
            await new Promise((resolve) => {
                const s = document.createElement('script');
                Array.from(old.attributes).forEach((a) => {
                    if (a.name === 'src') s.src = this.absolutizeUrl(a.value, baseHref);
                    else s.setAttribute(a.name, a.value);
                });
                if (!old.src && old.textContent) s.textContent = old.textContent;
                s.onload = () => resolve();
                s.onerror = () => resolve();
                if (!s.src) {
                    root.appendChild(s);
                    resolve();
                } else {
                    root.appendChild(s);
                    // external: wait onload
                }
            });
        }

        const win = this.openWindows.get(id);
        if (win) win.nativeRoot = root;
    }

    setupWindowEvents(id) {
        const win = this.openWindows.get(id);
        const el = win.element;

        const bindCtrl = (sel, fn) => {
            const node = el.querySelector(sel);
            if (!node) return;
            // pointerup + click both fire on many devices — debounce so maximize
            // does not instantly toggle back.
            let last = 0;
            const run = (e) => {
                e.preventDefault();
                e.stopPropagation();
                const now = performance.now();
                if (now - last < 400) return;
                last = now;
                fn();
            };
            node.addEventListener('pointerup', run);
            node.addEventListener('click', run);
        };
        bindCtrl('.minimize', () => this.minimizeWindow(id));
        bindCtrl('.maximize', () => this.toggleMaximize(id));
        bindCtrl('.close', () => this.closeWindow(id));
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
        if (/76836\.github\.io\/games(\?|$)/i.test(url)) return true;
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
        win.element.querySelectorAll('.games-fps, .games-menu-btn, .games-menu, .games-confirm').forEach((n) => n.remove());
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

    showGamesConfirm(hostEl, { title, body, confirmLabel = 'Confirm', cancelLabel = 'Cancel' }) {
        return new Promise((resolve) => {
            const existing = hostEl.querySelector('.games-confirm');
            if (existing) existing.remove();

            const wrap = document.createElement('div');
            wrap.className = 'games-confirm';
            wrap.innerHTML = `
                <div class="games-confirm-card" role="dialog" aria-modal="true">
                    <div class="games-confirm-title"></div>
                    <div class="games-confirm-body"></div>
                    <div class="games-confirm-actions">
                        <button type="button" class="games-confirm-btn games-confirm-cancel"></button>
                        <button type="button" class="games-confirm-btn games-confirm-ok"></button>
                    </div>
                </div>
            `;
            wrap.querySelector('.games-confirm-title').textContent = title;
            wrap.querySelector('.games-confirm-body').textContent = body;
            wrap.querySelector('.games-confirm-cancel').textContent = cancelLabel;
            wrap.querySelector('.games-confirm-ok').textContent = confirmLabel;

            const finish = (val) => {
                wrap.remove();
                resolve(val);
            };
            wrap.querySelector('.games-confirm-cancel').onclick = (e) => {
                e.stopPropagation();
                finish(false);
            };
            wrap.querySelector('.games-confirm-ok').onclick = (e) => {
                e.stopPropagation();
                finish(true);
            };
            wrap.addEventListener('pointerdown', (e) => {
                if (e.target === wrap) {
                    e.stopPropagation();
                    finish(false);
                }
            });
            hostEl.appendChild(wrap);
            wrap.querySelector('.games-confirm-ok').focus();
        });
    }

    ensureGamesMenu(id) {
        const win = this.openWindows.get(id);
        if (!win) return;
        const controls = win.element.querySelector('.window-controls');
        const titleBar = win.element.querySelector('.title-bar');
        if (!controls || !titleBar) return;

        if (!controls.querySelector('.games-fps')) {
            const fps = document.createElement('span');
            fps.className = 'games-fps';
            fps.title = 'Frames per second';
            fps.textContent = '— FPS';
            controls.insertBefore(fps, controls.firstChild);
        }

        if (controls.querySelector('.games-menu-btn')) return;

        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'games-menu-btn';
        btn.title = 'Game menu';
        btn.setAttribute('aria-label', 'Game menu');
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
        titleBar.appendChild(menu);

        const openMenu = () => {
            menu.hidden = false;
            win._gamesMenuIgnoreUntil = performance.now() + 400;
        };
        const closeMenu = () => {
            menu.hidden = true;
            const pr = menu.querySelector('.games-ping-result');
            if (pr) { pr.hidden = true; pr.textContent = ''; }
        };
        const toggleMenu = () => {
            if (menu.hidden) openMenu();
            else closeMenu();
        };

        // ONE activation path only. pointerup+click+touchend together toggled open then closed.
        let lastToggleAt = 0;
        const onBtnActivate = (e) => {
            e.preventDefault();
            e.stopPropagation();
            const now = performance.now();
            if (now - lastToggleAt < 400) return;
            lastToggleAt = now;
            toggleMenu();
        };
        // pointerup covers mouse + most touch; preventDefault reduces synthetic click
        btn.addEventListener('pointerup', onBtnActivate);
        btn.addEventListener('click', onBtnActivate);

        const stopBubble = (e) => e.stopPropagation();
        btn.addEventListener('pointerdown', stopBubble);
        btn.addEventListener('mousedown', stopBubble);
        btn.addEventListener('touchstart', stopBubble, { passive: true });
        menu.addEventListener('pointerdown', stopBubble);
        menu.addEventListener('mousedown', stopBubble);
        menu.addEventListener('touchstart', stopBubble, { passive: true });
        menu.addEventListener('click', stopBubble);

        menu.querySelector('[data-action="close-others"]').onclick = (e) => {
            e.stopPropagation();
            this.closeOtherWindows(id);
            closeMenu();
        };
        menu.querySelector('[data-action="fullscreen"]').onclick = async (e) => {
            e.stopPropagation();
            try {
                if (!document.fullscreenElement) await document.documentElement.requestFullscreen();
                else await document.exitFullscreen();
            } catch (err) {
                console.warn('fullscreen failed', err);
            }
            closeMenu();
        };
        menu.querySelector('[data-action="ping"]').onclick = (e) => {
            e.stopPropagation();
            const pr = menu.querySelector('.games-ping-result');
            if (pr) pr.hidden = false;
            this.runPingTest(menu);
        };
        menu.querySelector('[data-action="quit"]').onclick = async (e) => {
            e.stopPropagation();
            closeMenu();
            const ok = await this.showGamesConfirm(win.element, {
                title: 'Quit game?',
                body: 'Return to the Games Launcher? Unsaved progress in the current game may be lost.',
                confirmLabel: 'Quit',
                cancelLabel: 'Stay'
            });
            if (!ok) return;
            const iframe = win.element.querySelector('iframe');
            const home = (win.config && win.config.url) || 'https://76836.github.io/games?embed=true';
            if (iframe) iframe.src = home;
        };


        const onDoc = (ev) => {
            if (!win.element.classList.contains('games-mode')) {
                document.removeEventListener('pointerdown', onDoc, true);
                return;
            }
            if (menu.hidden) return;
            if (performance.now() < (win._gamesMenuIgnoreUntil || 0)) return;
            if (menu.contains(ev.target) || btn.contains(ev.target)) return;
            closeMenu();
        };
        document.addEventListener('pointerdown', onDoc, true);
        win._gamesMenuDocHandler = onDoc;
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
                document.removeEventListener('pointerdown', win._gamesMenuDocHandler, true);
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
        const now = performance.now();
        if (win._maxToggleAt && now - win._maxToggleAt < 350) return;
        win._maxToggleAt = now;
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
        // Leave immersive/maximized chrome before hiding the window
        if (win.isMaximized) {
            if (win.element.classList.contains('games-mode')) {
                this.applyGamesMode(id, false);
            }
            if (win.oldRect) Object.assign(win.element.style, win.oldRect);
            win.element.classList.remove('maximized');
            win.isMaximized = false;
        }
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
        win.element.querySelectorAll('.wd-native-root').forEach((n) => {
            n.querySelectorAll('script').forEach((s) => s.remove());
            n.remove();
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
