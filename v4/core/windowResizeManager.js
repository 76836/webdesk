function pointerClient(e) {
    if (e.touches && e.touches[0]) return { x: e.touches[0].clientX, y: e.touches[0].clientY };
    if (e.changedTouches && e.changedTouches[0]) return { x: e.changedTouches[0].clientX, y: e.changedTouches[0].clientY };
    return { x: e.clientX, y: e.clientY };
}

class WindowResizeManager {
    constructor(windowManager) {
        this.windowManager = windowManager;
        this.resizingWindow = null;
        this.resizeEdge = null;
        this.startX = 0;
        this.startY = 0;
        this.startWidth = 0;
        this.startHeight = 0;
        this.minWidth = 200;
        this.minHeight = 150;

        // Create the invisible shield for iframes
        this.overlay = document.createElement('div');
        Object.assign(this.overlay.style, {
            position: 'fixed',
            top: 0,
            left: 0,
            width: '100vw',
            height: '100vh',
            zIndex: 9999,
            display: 'none',
            pointerEvents: 'none'
        });
        document.body.appendChild(this.overlay);

        this.boundHandleMouseMove = this.handleMouseMove.bind(this);
        this.boundHandleMouseDown = this.handleMouseDown.bind(this);
        this.boundHandleMouseUp = this.handleMouseUp.bind(this);
        this.boundHandleDragging = this.handleDragging.bind(this);
    }

    setupResizeHandlers(windowEl) {
        windowEl.addEventListener('mousedown', this.boundHandleMouseDown);
        windowEl.addEventListener('touchstart', this.boundHandleMouseDown, { passive: false });
        // Track globally so we don't lose the edge
        document.addEventListener('mousemove', this.boundHandleMouseMove);
        document.addEventListener('mousemove', this.boundHandleDragging);
        document.addEventListener('mouseup', this.boundHandleMouseUp);
        document.addEventListener('touchmove', this.boundHandleMouseMove, { passive: true });
        document.addEventListener('touchmove', this.boundHandleDragging, { passive: false });
        document.addEventListener('touchend', this.boundHandleMouseUp);
        document.addEventListener('touchcancel', this.boundHandleMouseUp);
    }

    handleMouseMove(e) {
        if (this.resizingWindow) return;

        const edge = this.getResizeEdge(e);
        // Only change cursor if we are over an actual window or near its edge
        if (edge) {
            document.body.style.cursor = edge.cursor;
        } else {
            document.body.style.cursor = '';
        }
    }

    handleMouseDown(e) {
        if (e.target.closest('.window-controls') || e.target.closest('.title-bar')) return;
        if (e.touches && e.touches.length > 1) return;

        const edge = this.getResizeEdge(e);
        if (!edge) return;

        const windowEl = (e.target.closest && e.target.closest('.app-window'))
            || document.elementFromPoint(pointerClient(e).x, pointerClient(e).y)?.closest('.app-window');
        if (!windowEl) return;

        this.resizingWindow = windowEl;
        this.resizeEdge = edge;
        const pt = pointerClient(e);
        this.startX = pt.x;
        this.startY = pt.y;
        this.startWidth = windowEl.offsetWidth;
        this.startHeight = windowEl.offsetHeight;
        this.startLeft = windowEl.offsetLeft;
        this.startTop = windowEl.offsetTop;

        // Activate the shield and lock the cursor
        this.overlay.style.display = 'block';
        this.overlay.style.pointerEvents = 'auto';
        this.overlay.style.cursor = edge.cursor;
        
        this.resizingWindow.classList.add('no-transition');
        e.preventDefault();
    }

    handleMouseUp() {
        if (this.resizingWindow) {
            this.resizingWindow.classList.remove('no-transition');
            this.resizingWindow = null;
            this.resizeEdge = null;
            
            // Put the shield back to sleep
            this.overlay.style.display = 'none';
            this.overlay.style.pointerEvents = 'none';
            document.body.style.cursor = '';
        }
    }

    handleDragging(e) {
        if (!this.resizingWindow || !this.resizeEdge) return;

        const pt = pointerClient(e);
        const deltaX = pt.x - this.startX;
        const deltaY = pt.y - this.startY;
        if (e.cancelable && e.touches) e.preventDefault();

        let newWidth = this.startWidth;
        let newHeight = this.startHeight;
        let newLeft = this.startLeft;
        let newTop = this.startTop;

        if (this.resizeEdge.left) {
            newWidth = Math.max(this.minWidth, this.startWidth - deltaX);
            newLeft = this.startLeft + (this.startWidth - newWidth);
        } else if (this.resizeEdge.right) {
            newWidth = Math.max(this.minWidth, this.startWidth + deltaX);
        }

        if (this.resizeEdge.top) {
            newHeight = Math.max(this.minHeight, this.startHeight - deltaY);
            newTop = this.startTop + (this.startHeight - newHeight);
        } else if (this.resizeEdge.bottom) {
            newHeight = Math.max(this.minHeight, this.startHeight + deltaY);
        }

        this.resizingWindow.style.width = `${newWidth}px`;
        this.resizingWindow.style.height = `${newHeight}px`;
        this.resizingWindow.style.left = `${newLeft}px`;
        this.resizingWindow.style.top = `${newTop}px`;
    }

    getResizeEdge(e) {
        const pt = pointerClient(e);
        const target = (e.target && e.target.closest) ? e.target : document.elementFromPoint(pt.x, pt.y);
        const windowEl = target && target.closest ? target.closest('.app-window') : null;
        if (!windowEl) return null;

        const rect = windowEl.getBoundingClientRect();
        // Larger hit target on coarse pointers (touch)
        const edgeSize = (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) ? 18 : 10;

        const left = pt.x - rect.left < edgeSize;
        const right = rect.right - pt.x < edgeSize;
        const top = pt.y - rect.top < edgeSize;
        const bottom = rect.bottom - pt.y < edgeSize;

        if (!left && !right && !top && !bottom) return null;

        return {
            left, right, top, bottom,
            cursor: this.getResizeCursor(left, right, top, bottom)
        };
    }

    getResizeCursor(left, right, top, bottom) {
        if (top && left) return 'nwse-resize';
        if (top && right) return 'nesw-resize';
        if (bottom && left) return 'nesw-resize';
        if (bottom && right) return 'nwse-resize';
        if (left || right) return 'ew-resize';
        if (top || bottom) return 'ns-resize';
        return 'default';
    }
}

export default WindowResizeManager;
