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
    }

    setupResizeHandlers(windowEl) {
        windowEl.addEventListener('mousemove', this.handleMouseMove.bind(this));
        windowEl.addEventListener('mousedown', this.handleMouseDown.bind(this));
        document.addEventListener('mouseup', this.handleMouseUp.bind(this));
        document.addEventListener('mousemove', this.handleDragging.bind(this));
    }

    handleMouseMove(e) {
        if (this.resizingWindow) return;

        const edge = this.getResizeEdge(e);
        if (edge) {
            e.target.style.cursor = edge.cursor;
        } else {
            e.target.style.cursor = '';
        }
    }

    handleMouseDown(e) {
        if (e.target.closest('.window-controls') || e.target.closest('.title-bar')) return;

        const edge = this.getResizeEdge(e);
        if (!edge) return;

        const windowEl = e.target.closest('.app-window');
        if (!windowEl) return;

        this.resizingWindow = windowEl;
        this.resizeEdge = edge;
        this.startX = e.clientX;
        this.startY = e.clientY;
        this.startWidth = windowEl.offsetWidth;
        this.startHeight = windowEl.offsetHeight;
        this.startLeft = windowEl.offsetLeft;
        this.startTop = windowEl.offsetTop;

        windowEl.classList.add('no-transition');
        e.preventDefault();
    }

    handleMouseUp() {
        if (this.resizingWindow) {
            this.resizingWindow.classList.remove('no-transition');
            this.resizingWindow = null;
            this.resizeEdge = null;
        }
    }

    handleDragging(e) {
        if (!this.resizingWindow || !this.resizeEdge) return;

        const deltaX = e.clientX - this.startX;
        const deltaY = e.clientY - this.startY;

        let newWidth = this.startWidth;
        let newHeight = this.startHeight;
        let newLeft = this.startLeft;
        let newTop = this.startTop;

        // Handle horizontal resizing
        if (this.resizeEdge.left) {
            newWidth = Math.max(this.minWidth, this.startWidth - deltaX);
            newLeft = this.startLeft + (this.startWidth - newWidth);
        } else if (this.resizeEdge.right) {
            newWidth = Math.max(this.minWidth, this.startWidth + deltaX);
        }

        // Handle vertical resizing
        if (this.resizeEdge.top) {
            newHeight = Math.max(this.minHeight, this.startHeight - deltaY);
            newTop = this.startTop + (this.startHeight - newHeight);
        } else if (this.resizeEdge.bottom) {
            newHeight = Math.max(this.minHeight, this.startHeight + deltaY);
        }

        // Apply new dimensions
        this.resizingWindow.style.width = newWidth + 'px';
        this.resizingWindow.style.height = newHeight + 'px';
        this.resizingWindow.style.left = newLeft + 'px';
        this.resizingWindow.style.top = newTop + 'px';
    }

    getResizeEdge(e) {
        const windowEl = e.target.closest('.app-window');
        if (!windowEl) return null;

        const rect = windowEl.getBoundingClientRect();
        const edgeSize = 8;

        const left = e.clientX - rect.left < edgeSize;
        const right = rect.right - e.clientX < edgeSize;
        const top = e.clientY - rect.top < edgeSize;
        const bottom = rect.bottom - e.clientY < edgeSize;

        if (!left && !right && !top && !bottom) return null;

        return {
            left,
            right,
            top,
            bottom,
            cursor: this.getResizeCursor(left, right, top, bottom)
        };
    }

    getResizeCursor(left, right, top, bottom) {
        if (top && left) return 'nw-resize';
        if (top && right) return 'ne-resize';
        if (bottom && left) return 'sw-resize';
        if (bottom && right) return 'se-resize';
        if (left || right) return 'ew-resize';
        if (top || bottom) return 'ns-resize';
        return 'default';
    }
}

export default WindowResizeManager;