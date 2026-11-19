/**
 * WebDesk Siloxane Lite (.siopk) support
 * Parse, validate, store offline packages, install online projects when reachable.
 */
(function (global) {
  'use strict';

  const DB_NAME = 'WebDeskSiloxane';
  const DB_VER = 1;
  const STORE = 'packages';
  const PKG_ID_RE = /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)+$/;

  function openDB() {
    return new Promise((resolve, reject) => {
      const r = indexedDB.open(DB_NAME, DB_VER);
      r.onupgradeneeded = () => {
        const db = r.result;
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE, { keyPath: 'package_id' });
        }
      };
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error || new Error('IDB open failed'));
    });
  }

  function idbReq(req) {
    return new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function putPackage(record) {
    const db = await openDB();
    const tx = db.transaction(STORE, 'readwrite');
    await idbReq(tx.objectStore(STORE).put(record));
    return new Promise((res, rej) => {
      tx.oncomplete = () => res(record);
      tx.onerror = () => rej(tx.error);
    });
  }

  async function getPackage(packageId) {
    const db = await openDB();
    return idbReq(db.transaction(STORE, 'readonly').objectStore(STORE).get(packageId));
  }

  async function deletePackage(packageId) {
    const db = await openDB();
    const tx = db.transaction(STORE, 'readwrite');
    await idbReq(tx.objectStore(STORE).delete(packageId));
    return new Promise((res, rej) => {
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
    });
  }

  async function listPackages() {
    const db = await openDB();
    return idbReq(db.transaction(STORE, 'readonly').objectStore(STORE).getAll());
  }

  function normalizePath(p) {
    return String(p || '')
      .replace(/\\/g, '/')
      .replace(/^\.\//, '')
      .replace(/^\/+/, '');
  }

  function findCfgEntry(paths) {
    const preferred = ['siloxane.cfg', 'siloxanelite.cfg'];
    const lower = paths.map((p) => ({ raw: p, n: normalizePath(p).toLowerCase() }));
    for (const name of preferred) {
      const hit = lower.find((x) => x.n === name || x.n.endsWith('/' + name));
      if (hit) return hit.raw;
    }
    // Nested up to 6 levels: any path ending with siloxane.cfg
    const nested = lower
      .filter((x) => /(^|\/)siloxane(lite)?\.cfg$/i.test(x.n))
      .sort((a, b) => a.n.split('/').length - b.n.split('/').length);
    return nested[0] ? nested[0].raw : null;
  }

  function validateCfg(cfg) {
    if (!cfg || typeof cfg !== 'object') throw new Error('Invalid siloxane.cfg (not an object)');
    const format = (cfg.format != null ? String(cfg.format) : 'siloxanelite').toLowerCase();
    if (format !== 'siloxanelite') throw new Error('Unsupported format: ' + cfg.format);
    const name = String(cfg.name || '').trim();
    const package_id = String(cfg.package_id || '').trim();
    const start_url = String(cfg.start_url || '').trim();
    if (!name) throw new Error('Missing required field: name');
    if (!package_id) throw new Error('Missing required field: package_id');
    if (!start_url) throw new Error('Missing required field: start_url');
    if (!PKG_ID_RE.test(package_id)) {
      throw new Error('Invalid package_id (need at least two segments, e.g. com.example.app)');
    }
    const offline = !!cfg.offline;
    return {
      ...cfg,
      format: 'siloxanelite',
      format_version: cfg.format_version != null ? cfg.format_version : 1,
      name,
      package_id,
      start_url,
      offline,
      display: cfg.display || 'standalone',
      theme_color: cfg.theme_color || '#000000',
      background_color: cfg.background_color || '#000000'
    };
  }

  function wwwrootPrefix(paths) {
    const html = paths.find((p) => {
      const n = normalizePath(p).toLowerCase();
      return n === 'wwwroot/index.html' || n === 'wwwroot/index.htm' || n.endsWith('/wwwroot/index.html');
    });
    if (!html) return null;
    const n = normalizePath(html);
    const idx = n.toLowerCase().indexOf('wwwroot/');
    return idx >= 0 ? n.slice(0, idx + 'wwwroot/'.length) : 'wwwroot/';
  }

  /**
   * Parse a .siopk ArrayBuffer using JSZip (must be loaded globally as JSZip).
   */
  async function parseSiopk(arrayBuffer) {
    if (typeof JSZip === 'undefined') {
      throw new Error('JSZip is required to install .siopk packages');
    }
    const zip = await JSZip.loadAsync(arrayBuffer);
    const paths = Object.keys(zip.files).filter((p) => !zip.files[p].dir);
    const cfgPath = findCfgEntry(paths);
    if (!cfgPath) throw new Error('No siloxane.cfg found in package');
    const cfgText = await zip.file(cfgPath).async('string');
    let raw;
    try {
      raw = JSON.parse(cfgText);
    } catch (e) {
      throw new Error('siloxane.cfg is not valid JSON');
    }
    const cfg = validateCfg(raw);

    const files = {};
    if (cfg.offline) {
      const prefix = wwwrootPrefix(paths);
      if (!prefix) {
        throw new Error('Offline package requires wwwroot/index.html (or index.htm)');
      }
      for (const p of paths) {
        const n = normalizePath(p);
        if (!n.toLowerCase().startsWith(prefix.toLowerCase())) continue;
        const rel = n.slice(prefix.length); // path inside wwwroot
        if (!rel || rel.endsWith('/')) continue;
        files[rel] = await zip.file(p).async('arraybuffer');
      }
      if (!files['index.html'] && !files['index.htm']) {
        throw new Error('Offline wwwroot missing index.html');
      }
    }

    return { cfg, files };
  }

  function iconDataUrl(cfg) {
    if (cfg && cfg.icon_png_base64) {
      const b64 = String(cfg.icon_png_base64).replace(/\s/g, '');
      return 'data:image/png;base64,' + b64;
    }
    return null;
  }

  /**
   * Probe an online start_url. Returns { ok, error }.
   * CORS / network failures mean the app cannot be installed in WebDesk.
   */
  async function probeOnlineUrl(url) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 12000);
      const res = await fetch(url, {
        method: 'GET',
        mode: 'cors',
        credentials: 'omit',
        signal: ctrl.signal,
        cache: 'no-store'
      });
      clearTimeout(t);
      if (!res.ok) {
        return { ok: false, error: 'Remote app returned HTTP ' + res.status + ' — cannot install.' };
      }
      return { ok: true };
    } catch (e) {
      const msg = e && e.name === 'AbortError' ? 'Timed out reaching remote app.' : (e && e.message) || String(e);
      return {
        ok: false,
        error:
          "Can't install this app. The remote site is unreachable or blocked by CORS (" +
          msg +
          ').'
      };
    }
  }

  async function loadJsZip() {
    if (typeof JSZip !== 'undefined') return;
    await new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js';
      s.onload = resolve;
      s.onerror = () => reject(new Error('Failed to load JSZip'));
      document.head.appendChild(s);
    });
  }

  /**
   * Install from ArrayBuffer of .siopk
   * Returns { app, cfg, mode: 'offline'|'online' }
   */
  async function installFromBuffer(arrayBuffer) {
    await loadJsZip();
    const { cfg, files } = await parseSiopk(arrayBuffer);

    if (cfg.offline) {
      await putPackage({
        package_id: cfg.package_id,
        cfg,
        files,
        installedAt: Date.now()
      });
      return { cfg, mode: 'offline', filesCount: Object.keys(files).length };
    }

    // Online project: only cfg — probe start_url
    const probe = await probeOnlineUrl(cfg.start_url);
    if (!probe.ok) {
      const err = new Error(probe.error);
      err.code = 'SILOXANE_ONLINE_BLOCKED';
      throw err;
    }
    await putPackage({
      package_id: cfg.package_id,
      cfg,
      files: {},
      installedAt: Date.now()
    });
    return { cfg, mode: 'online' };
  }

  async function installFromUrl(siopkUrl) {
    let res;
    try {
      res = await fetch(siopkUrl, { mode: 'cors', credentials: 'omit', cache: 'no-store' });
    } catch (e) {
      const err = new Error(
        "Can't install this app. The package URL is unreachable or blocked by CORS (" +
          ((e && e.message) || e) +
          ').'
      );
      err.code = 'SILOXANE_FETCH_BLOCKED';
      throw err;
    }
    if (!res.ok) throw new Error('Failed to download package (HTTP ' + res.status + ')');
    const buf = await res.arrayBuffer();
    return installFromBuffer(buf);
  }

  function runnerUrl(packageId) {
    var q = '?id=' + encodeURIComponent(packageId);
    try {
      // When called from App Center (.../v4/apps/appmaker.html)
      if (/\/v4\/apps\//i.test(location.pathname)) {
        return new URL('siloxane-runner.html' + q, location.href).href;
      }
    } catch (_) {}
    try {
      return new URL('/webdesk/v4/apps/siloxane-runner.html' + q, location.origin).href;
    } catch (_) {}
    return 'https://76836.github.io/webdesk/v4/apps/siloxane-runner.html' + q;
  }

  function webdeskAppRecord(cfg, mode) {
    const id = 'siloxane-' + String(cfg.package_id).toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const icon = iconDataUrl(cfg) || 'https://76836.github.io/apple-touch-icon.png';
    let url;
    if (mode === 'offline' || cfg.offline) {
      url = runnerUrl(cfg.package_id);
    } else {
      url = cfg.start_url;
    }
    return {
      id,
      config: {
        title: cfg.name,
        url,
        iconUrl: icon,
        useIframe: true,
        siloxane: true,
        package_id: cfg.package_id,
        offline: !!cfg.offline,
        theme_color: cfg.theme_color
      }
    };
  }

  global.WebDeskSiloxane = {
    parseSiopk,
    validateCfg,
    installFromBuffer,
    installFromUrl,
    probeOnlineUrl,
    getPackage,
    putPackage,
    deletePackage,
    listPackages,
    iconDataUrl,
    runnerUrl,
    webdeskAppRecord,
    loadJsZip
  };
})(typeof window !== 'undefined' ? window : globalThis);
