export default class WindowManager {
  constructor({ appSurface, recentsList }) {
    this.appSurface = appSurface;
    this.recentsList = recentsList;
    this.apps = new Map();
    this.recents = [];
    this.activeAppId = null;
  }

  registerApp(app) {
    this.apps.set(app.id, { ...app, instance: null });
  }

  openApp(appId) {
    const app = this.apps.get(appId);
    if (!app) return;

    if (!app.instance) {
      app.instance = this.#createWindow(app);
      this.apps.set(appId, app);
    }

    if (this.activeAppId && this.activeAppId !== appId) {
      this.minimizeApp(this.activeAppId);
    }

    app.instance.classList.add('active');
    this.activeAppId = appId;
    this.#touchRecent(appId);
  }

  minimizeApp(appId) {
    const app = this.apps.get(appId);
    if (!app?.instance) return;
    app.instance.classList.remove('active');
    if (this.activeAppId === appId) this.activeAppId = null;
  }

  minimizeAll() {
    for (const [id] of this.apps) this.minimizeApp(id);
  }

  closeApp(appId) {
    const app = this.apps.get(appId);
    if (!app?.instance) return;
    app.instance.remove();
    app.instance = null;
    this.apps.set(appId, app);
    this.recents = this.recents.filter((id) => id !== appId);
    if (this.activeAppId === appId) this.activeAppId = null;
    this.renderRecents();
  }

  goBack() {
    if (!this.activeAppId) return;
    const app = this.apps.get(this.activeAppId);
    const iframe = app?.instance?.querySelector('iframe');
    try { iframe?.contentWindow?.history.back(); } catch {}
  }

  #createWindow(app) {
    const win = document.createElement('article');
    win.className = 'appWindow';
    win.dataset.appId = app.id;
    win.innerHTML = `
      <div class="windowControls">
        <button data-action="min">—</button>
        <button data-action="close">✕</button>
      </div>
      <iframe src="${app.url}" title="${app.title}"></iframe>
    `;
    win.querySelector('[data-action="min"]').addEventListener('click', () => this.minimizeApp(app.id));
    win.querySelector('[data-action="close"]').addEventListener('click', () => this.closeApp(app.id));
    this.appSurface.appendChild(win);
    return win;
  }

  #touchRecent(appId) {
    this.recents = [appId, ...this.recents.filter((id) => id !== appId)].slice(0, 8);
    this.renderRecents();
  }

  renderRecents() {
    this.recentsList.innerHTML = '';
    this.recents.forEach((id) => {
      const app = this.apps.get(id);
      if (!app) return;
      const card = document.createElement('div');
      card.className = 'recentCard';
      card.innerHTML = `<strong>${app.title}</strong><span>Open</span>`;
      card.addEventListener('click', () => this.openApp(id));
      const closer = document.createElement('button');
      closer.textContent = 'Close';
      closer.addEventListener('click', (e) => {
        e.stopPropagation();
        this.closeApp(id);
      });
      card.appendChild(closer);
      this.recentsList.appendChild(card);
    });
  }
}
