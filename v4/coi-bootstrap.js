/**
 * WebDesk COI — register root /enable-threads.js (scope /) and ONLY navigate
 * after the worker is activated and controlling (or ready to control).
 *
 * Reloading too early is the usual failure mode: register() resolves before
 * install/activate finish, so the next document never gets COOP/COEP.
 */
(function () {
  const KEY = "WebDesk_coi_enabled";
  const RELOAD_KEY = "WebDesk_coi_reloads";
  const FAIL_KEY = "WebDesk_coi_failed";
  const MAX = 2;
  const ROOT_SW = new URL("/enable-threads.js", location.origin).href;

  const log = (...a) => console.log("[WebDesk COI]", ...a);
  const warn = (...a) => console.warn("[WebDesk COI]", ...a);

  function wantCoi() {
    return localStorage.getItem(KEY) === "1";
  }
  function getReloads() {
    return parseInt(sessionStorage.getItem(RELOAD_KEY) || "0", 10) || 0;
  }
  function setReloads(n) {
    sessionStorage.setItem(RELOAD_KEY, String(n));
  }

  function hardNavigate() {
    const u = new URL(location.href);
    u.searchParams.delete("_coi");
    u.searchParams.set("_coi", String(Date.now()));
    log("navigating with replace", u.pathname + u.search);
    location.replace(u.pathname + u.search + u.hash);
  }

  function workerState(worker) {
    return new Promise((resolve) => {
      if (!worker) return resolve(null);
      if (worker.state === "activated" || worker.state === "redundant") {
        return resolve(worker.state);
      }
      worker.addEventListener("statechange", function onChange() {
        log("worker state →", worker.state);
        if (worker.state === "activated" || worker.state === "redundant") {
          worker.removeEventListener("statechange", onChange);
          resolve(worker.state);
        }
      });
    });
  }

  function wait(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  async function listRegs() {
    if (!("serviceWorker" in navigator)) return [];
    return navigator.serviceWorker.getRegistrations();
  }

  function urls(reg) {
    return [reg.active, reg.waiting, reg.installing].filter(Boolean).map((w) => w.scriptURL);
  }

  async function unregisterCompetitors() {
    const regs = await listRegs();
    for (const reg of regs) {
      const u = urls(reg);
      const isOurRoot =
        u.some((x) => x.includes("/enable-threads.js")) &&
        (reg.scope === location.origin + "/" || reg.scope === new URL("/", location.origin).href);
      if (isOurRoot) {
        log("keeping root enable-threads", reg.scope);
        continue;
      }
      try {
        await reg.unregister();
        log("unregistered competitor", reg.scope, u.join(", "));
      } catch (e) {
        warn("unregister failed", e);
      }
    }
  }

  /**
   * Full registration pipeline:
   * register → wait installing/waiting → activated → ready → controller (or claim window)
   */
  async function ensureRootSwActive() {
    if (!("serviceWorker" in navigator)) {
      throw new Error("serviceWorker not supported");
    }

    // 1) Prove the script is fetchable (helps catch 404/HTML errors early)
    const probe = await fetch(ROOT_SW, { cache: "no-store" });
    if (!probe.ok) {
      throw new Error("ROOT_SW HTTP " + probe.status + " " + ROOT_SW);
    }
    const ct = probe.headers.get("content-type") || "";
    log("SW script OK", probe.status, ct, ROOT_SW);

    await unregisterCompetitors();
    // Let the browser drop old controllers briefly
    await wait(100);

    // 2) Register with site-wide scope
    log("registering…");
    const reg = await navigator.serviceWorker.register(ROOT_SW, {
      scope: "/",
      updateViaCache: "none",
    });
    log("register resolved", "scope=", reg.scope, "installing=", !!reg.installing, "waiting=", !!reg.waiting, "active=", !!reg.active);

    // 3) Wait for a worker to reach activated
    let worker = reg.installing || reg.waiting || reg.active;
    if (reg.installing) {
      log("waiting for installing worker…");
      await workerState(reg.installing);
    }
    if (reg.waiting) {
      log("waiting worker present — skipWaiting via message if supported");
      try {
        reg.waiting.postMessage({ type: "SKIP_WAITING" });
      } catch (_) {}
      // enable-threads calls skipWaiting on install; still wait
      await workerState(reg.waiting);
    }
    if (reg.active) {
      log("active worker", reg.active.scriptURL, reg.active.state);
    }

    // 4) serviceWorker.ready === active worker for this scope
    const ready = await navigator.serviceWorker.ready;
    log("serviceWorker.ready", ready.scope, ready.active?.scriptURL, ready.active?.state);

    // 5) clients.claim should make us controller; wait for it
    if (!navigator.serviceWorker.controller) {
      log("no controller yet — waiting up to 8s for controllerchange");
      await Promise.race([
        new Promise((resolve) => {
          navigator.serviceWorker.addEventListener(
            "controllerchange",
            () => {
              log("controllerchange", navigator.serviceWorker.controller?.scriptURL);
              resolve();
            },
            { once: true }
          );
        }),
        wait(8000),
      ]);
    }

    // 6) Extra settle time so the SW fetch handler is actually live
    await wait(250);

    const ctrl = navigator.serviceWorker.controller;
    log(
      "final controller=",
      ctrl ? ctrl.scriptURL : null,
      "isolated=",
      window.crossOriginIsolated
    );

    return {
      reg,
      controlled: !!(ctrl && ctrl.scriptURL.includes("enable-threads.js")),
      controller: ctrl ? ctrl.scriptURL : null,
    };
  }

  async function unregisterIsolation() {
    const regs = await listRegs();
    for (const reg of regs) {
      if (urls(reg).some((u) => /enable-threads|coi-sw|\/sw\.js/i.test(u))) {
        try {
          await reg.unregister();
          log("unregistered", reg.scope);
        } catch (_) {}
      }
    }
  }

  window.WebDeskCOI = {
    KEY,
    isEnabled: wantCoi,
    isIsolated: () => !!window.crossOriginIsolated,
    rootSw: ROOT_SW,
    async setEnabled(on) {
      localStorage.setItem(KEY, on ? "1" : "0");
      sessionStorage.removeItem(RELOAD_KEY);
      sessionStorage.removeItem(FAIL_KEY);
      if (!on) {
        await unregisterIsolation();
        hardNavigate();
        return;
      }
      try {
        const r = await ensureRootSwActive();
        log("setEnabled result", r);
      } catch (e) {
        console.error("[WebDesk COI] enable failed", e);
      }
      // Document that called register is often still non-isolated until navigation
      hardNavigate();
    },
    consumeFailureFlag() {
      const f = sessionStorage.getItem(FAIL_KEY) === "1";
      if (f) sessionStorage.removeItem(FAIL_KEY);
      return f;
    },
    async debug() {
      const regs = await listRegs();
      return {
        want: wantCoi(),
        isolated: !!window.crossOriginIsolated,
        controller: navigator.serviceWorker?.controller?.scriptURL || null,
        rootSw: ROOT_SW,
        reloads: getReloads(),
        regs: regs.map((r) => ({
          scope: r.scope,
          active: r.active?.scriptURL,
          activeState: r.active?.state,
          waiting: r.waiting?.scriptURL,
          installing: r.installing?.scriptURL,
        })),
      };
    },
  };

  function cleanUrlQuietly() {
    try {
      if (!window.crossOriginIsolated) return;
      const u = new URL(location.href);
      if (!u.searchParams.has("_coi")) return;
      u.searchParams.delete("_coi");
      history.replaceState(null, "", u.pathname + u.search + u.hash);
    } catch (_) {}
  }

  // -------- boot --------
  if (!wantCoi()) {
    listRegs().then(async (regs) => {
      const iso = regs.some((r) => urls(r).some((u) => /enable-threads|coi-sw/i.test(u)));
      if (iso) {
        await unregisterIsolation();
        if (sessionStorage.getItem("WebDesk_coi_cleanup") !== "1") {
          sessionStorage.setItem("WebDesk_coi_cleanup", "1");
          hardNavigate();
        }
      } else {
        sessionStorage.removeItem("WebDesk_coi_cleanup");
      }
    });
    return;
  }

  // Feature ON
  if (window.crossOriginIsolated) {
    sessionStorage.removeItem(RELOAD_KEY);
    sessionStorage.removeItem(FAIL_KEY);
    cleanUrlQuietly();
    log("crossOriginIsolated OK");
    return;
  }

  const n = getReloads();
  if (n >= MAX) {
    sessionStorage.setItem(FAIL_KEY, "1");
    sessionStorage.removeItem(RELOAD_KEY);
    warn("gave up after", MAX, "attempts; controller=", navigator.serviceWorker?.controller?.scriptURL);
    return;
  }

  setReloads(n + 1);
  log("not isolated — full register pipeline, attempt", n + 1, "/", MAX);

  ensureRootSwActive()
    .then((r) => {
      log("pipeline done", r);
      // Always navigate once SW is active so THIS document loads under COOP/COEP
      hardNavigate();
    })
    .catch((err) => {
      console.error("[WebDesk COI] pipeline error", err);
      // Still navigate once so we don't spin; next attempt can retry
      hardNavigate();
    });
})();
