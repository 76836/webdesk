import WindowResizeManager from './windowResizeManager.js';

class WindowManager {
    constructor() {
        // Single source of truth for all windows
        this.openWindows = new Map();
        this.nextZIndex = 100;
        this.appConfigs = new Map();
        this.pinnedApps = [];
        
        // Initialize resize manager
        this.resizeManager = new WindowResizeManager(this);
        
        // Ensure containers exist
        this.ensureContainers();
    }

    registerApp(id, config) {
        // Store app configuration for later use
        this.appConfigs.set(id, config);
        
        // If app is pinned, create its taskbar icon
        if (config.pinned) {
            this.pinnedApps.push(id);
            const taskbarIcon = document.createElement('div');
            taskbarIcon.className = 'shelf-item';
            taskbarIcon.dataset.appId = id;
            taskbarIcon.title = config.title;
            this.setTaskbarIcon(taskbarIcon, config);
            taskbarIcon.addEventListener('click', () => this.createWindow(id, config));
            document.querySelector('.shelf-items-left').appendChild(taskbarIcon);
        }
    }

    ensureContainers() {
        // Create app drawer if needed
        if (!document.querySelector('.launcher-grid')) {
            const grid = document.createElement('div');
            grid.className = 'launcher-grid';
            document.querySelector('.app-launcher-view')?.appendChild(grid);
        }

        // Create shelf/taskbar if needed
        if (!document.querySelector('.shelf-items-left')) {
            const shelf = document.createElement('div');
            shelf.className = 'shelf-items-left';
            document.querySelector('.shelf')?.insertBefore(shelf, document.querySelector('.status-area'));
        }
    }

    createWindow(id, config) {
        // If the window already exists, just restore it
        const existingWindow = this.openWindows.get(id);
        if (existingWindow) {
            if (existingWindow.state === 'minimized') {
                this.restoreWindow(id);
            }
            return;
        }

        // Create taskbar icon if it doesn't exist
        let taskbarIcon = document.querySelector(`.shelf-item[data-app-id="${id}"]`);
        if (!taskbarIcon) {
            taskbarIcon = document.createElement('div');
            taskbarIcon.className = 'shelf-item';
            taskbarIcon.dataset.appId = id;
            taskbarIcon.title = config.title;
            this.setTaskbarIcon(taskbarIcon, config);
            document.querySelector('.shelf-items-left').appendChild(taskbarIcon);
        }

        // Create window element
        const windowEl = document.createElement('div');
        windowEl.className = 'app-window';
        windowEl.dataset.appId = id;
        windowEl.innerHTML = `
            <div class="title-bar">
                <span class="title">${config.title}</span>
                <div class="window-controls">
                    <span class="minimize" data-app-id="${id}">−</span>
                    <span class="close" data-app-id="${id}">×</span>
                </div>
            </div>
            <div class="app-content"></div>
        `;

        // Position window
        windowEl.style.width = '800px';
        windowEl.style.height = '600px';
        windowEl.style.left = '50px';
        windowEl.style.top = '50px';
        windowEl.style.display = 'flex';
        windowEl.style.zIndex = ++this.nextZIndex;

        // Add content
        const content = windowEl.querySelector('.app-content');
        const iframe = document.createElement('iframe');
        // For local files, convert to absolute URL using the current origin
        const url = config.url.startsWith('http') 
            ? config.url 
            : new URL(config.url, window.location.origin).href;
        iframe.src = url;
        iframe.frameBorder = '0';
        iframe.width = '100%';
        content.appendChild(iframe);

        // Add to DOM
        document.querySelector('.os-desktop').appendChild(windowEl);

        // Store window info
        this.openWindows.set(id, {
            id,
            title: config.title,
            element: windowEl,
            taskbarIcon,
            state: 'open'
        });

        // Set up event handlers
        this.setupWindowEvents(id);

        // Set up resize handlers
        this.resizeManager.setupResizeHandlers(windowEl);
    }

    setupWindowEvents(id) {
        const win = this.openWindows.get(id);
        if (!win) return;

        // Minimize button
        win.element.querySelector('.minimize').onclick = () => this.minimizeWindow(id);

        // Close button
        win.element.querySelector('.close').onclick = () => this.closeWindow(id);

        // Taskbar icon
        win.taskbarIcon.onclick = () => this.toggleWindow(id);

        // Window click brings to front
        win.element.onclick = () => {
            if (win.state === 'open') {
                win.element.style.zIndex = ++this.nextZIndex;
            }
        };

        // Make window draggable by title bar
        const titleBar = win.element.querySelector('.title-bar');
        titleBar.onmousedown = (e) => {
            if (e.target.closest('.window-controls')) return;

            const startX = e.clientX - win.element.offsetLeft;
            const startY = e.clientY - win.element.offsetTop;

            const mousemove = (e) => {
                win.element.style.left = (e.clientX - startX) + 'px';
                win.element.style.top = (e.clientY - startY) + 'px';
            };

            const mouseup = () => {
                document.removeEventListener('mousemove', mousemove);
                document.removeEventListener('mouseup', mouseup);
            };

            document.addEventListener('mousemove', mousemove);
            document.addEventListener('mouseup', mouseup);
        };
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

        // Remove window element and clean up iframes
        const iframes = win.element.querySelectorAll('iframe');
        iframes.forEach(iframe => {
            // Clear iframe src to stop any running content
            iframe.src = 'about:blank';
            iframe.remove();
        });
        win.element.remove();

        // Only remove the taskbar icon if it's not a pinned app
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
        return `
            <svg viewBox="0 0 48 48" width="100%" height="100%">
                <circle cx="24" cy="24" r="22" fill="hsl(${hue}, 70%, 50%)" />
                <text x="50%" y="50%" dominant-baseline="central" text-anchor="middle" 
                    fill="#ffffff" font-size="24" font-family="sans-serif">${letter}</text>
            </svg>
        `;
    }

    setTaskbarIcon(element, config) {
        // Ensure the element shows the correct title for accessibility/tooltips
        element.title = config.title || element.title;

        // Check if app has an icon URL
        if (config.iconUrl) {
            const img = document.createElement('img');
            img.src = config.iconUrl;
            img.alt = config.title;
            img.style.width = '100%';
            img.style.height = '100%';
            img.style.borderRadius = 'inherit';
            img.style.objectFit = 'cover';
            
            // Fallback to placeholder if image fails to load
            img.addEventListener('error', () => {
                img.style.display = 'none';
                element.innerHTML = this.generateIcon(config.title);
            });
            
            element.innerHTML = '';
            element.appendChild(img);
        } else {
            // No icon URL, use placeholder letter icon
            element.innerHTML = this.generateIcon(config.title);
        }
    }
}

export default WindowManager;