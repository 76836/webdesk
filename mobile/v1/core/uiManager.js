export class UIManager {
  constructor({ statusTime, statusBar, controlCenter, recents, homePages, pageDots }) {
    this.statusTime = statusTime;
    this.statusBar = statusBar;
    this.controlCenter = controlCenter;
    this.recents = recents;
    this.homePages = homePages;
    this.pageDots = pageDots;
    this.isEditing = false;
  }

  init(onSwipeDown) {
    this.updateTime();
    setInterval(() => this.updateTime(), 1000 * 30);

    this.statusBar.addEventListener('click', () => this.toggleControlCenter());

    let startY = null;
    window.addEventListener('pointerdown', (e) => {
      if (e.clientY < 26) startY = e.clientY;
    });
    window.addEventListener('pointerup', (e) => {
      if (startY !== null && e.clientY - startY > 24) onSwipeDown();
      startY = null;
    });

    this.homePages.addEventListener('scroll', () => this.renderDots());
  }

  updateTime() {
    this.statusTime.textContent = new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }

  toggleControlCenter(force) {
    const shouldShow = typeof force === 'boolean' ? force : this.controlCenter.classList.contains('hidden');
    this.controlCenter.classList.toggle('hidden', !shouldShow);
  }

  showRecents(show) {
    this.recents.classList.toggle('hidden', !show);
  }

  renderDots() {
    const pages = [...this.homePages.querySelectorAll('.homePage')];
    const current = Math.round(this.homePages.scrollLeft / this.homePages.clientWidth);
    this.pageDots.innerHTML = '';
    pages.forEach((_, idx) => {
      const dot = document.createElement('span');
      dot.className = `dot ${idx === current ? 'active' : ''}`;
      this.pageDots.appendChild(dot);
    });
  }
}

export function initQuickSettings({ controlCenter, wallpaperEl, onToggleEdit }) {
  const lightTile = controlCenter.querySelector('#lightTile');
  const fsTile = controlCenter.querySelector('#fsTile');
  const editTile = controlCenter.querySelector('#editTile');
  const slider = controlCenter.querySelector('#brightnessSlider');
  const batteryText = controlCenter.querySelector('#batteryText');

  lightTile?.addEventListener('click', () => {
    document.body.classList.toggle('light');
    lightTile.classList.toggle('active');
  });

  fsTile?.addEventListener('click', async () => {
    if (!document.fullscreenElement) await document.documentElement.requestFullscreen();
    else await document.exitFullscreen();
    fsTile.classList.toggle('active', Boolean(document.fullscreenElement));
  });

  editTile?.addEventListener('click', () => {
    editTile.classList.toggle('active');
    onToggleEdit(editTile.classList.contains('active'));
  });

  slider?.addEventListener('input', () => {
    wallpaperEl.style.filter = `brightness(${slider.value}%)`;
  });

  if (navigator.getBattery) {
    navigator.getBattery().then((battery) => {
      const paint = () => batteryText.textContent = `Battery: ${Math.round(battery.level * 100)}%`;
      paint();
      battery.addEventListener('levelchange', paint);
    });
  }
}
