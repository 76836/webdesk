/**
 * WebDesk COI bootstrap
 *
 * Registers the ROOT Pages worker https://76836.github.io/enable-threads.js
 * with scope "/" so isolation covers WebDesk AND same-origin apps
 * (e.g. /firefox-wasm/) in iframes — not only /webdesk/v4/.
 *
 * A SW file under /webdesk/v4/ cannot control the whole site (browser max scope
 * is the script's directory). Root enable-threads.js can.
 */
(function () {
  const KEY = "WebDesk_coi_enabled";
  const RELOAD_KEY = "WebDesk_coi_reloads";
  const FAIL_KEY = "WebDesk_coi_failed";
  const MAX = 2;

  // Absolute URL on the GitHub Pages origin (scope max = /)
  const ROOT_SW = new URL("/enable-threads.js", location.origin).href;

  function wantCoi() {
    return localStorage.getItem(KEY) === "1";
  }

  function getReloads() {
    return parseInt(sessionStorage.getItem(RELOAD_KEY) || "0", 10) || 0;
  }

  function setReloads(n) {
    sessionStorage.setItem(RELOAD_KEY, String(n));
  }

  /** Firefox: avoid reload() when COOP flips on the same history entry. */
  function hardNavigate() {
    const u = new URL(location.href);
    u.searchParams.delete("_coi");
    u.searchParams.set("_coi", String(Date.now()));
    location.replace(u.pathname + u.search + u.hash);
  }

  async function listRegs() {
    if (!("serviceWorker" in navigator)) return [];
    return navigator.serviceWorker.getRegistrations();
  }

  function scriptUrls(reg) {
    return [reg.active, reg.waiting, reg.installing]
      .filter(Boolean)
      .map((w) => w.scriptURL);
  }

  /** Drop workers that would fight root enable-threads (narrow webdesk SWs, old cors sw, etc.). */
  async function unregisterCompetitors() {
    const regs = await listRegs();
    await Promise.all(
      regs.map(async (reg) => {
        const urls = scriptUrls(reg);
        const isRootEnable = urls.some((u) => u.includes("/enable-threads.js"));
        // Keep root enable-threads if already present; remove everything else on this origin
        // that might own a parent/child scope and block claim.
        if (isRootEnable && reg.scope === new URL("/", location.origin).href) {
          return;
        }
        try {
          await reg.unregister();
          console.log("[WebDesk COI] unregistered competing SW", reg.scope, urls.join(","));
        } catch (e) {
          console.warn("[WebDesk COI] unregister failed", e);
        }
      })
    );
  }

  async function waitForController(timeoutMs) {
    if (navigator.serviceWorker.controller) {
      const u = navigator.serviceWorker.controller.scriptURL;
      if (u.includes("enable-threads.js")) return true;
    }
    return new Promise((resolve) => {
      const t = setTimeout(() => {
        const c = navigator.serviceWorker.controller;
        resolve(!!(c && c.scriptURL.includes("enable-threads.js")));
      }, timeoutMs);
      navigator.serviceWorker.addEventListener(
        "controllerchange",
        () => {
          clearTimeout(t);
          const c = navigator.serviceWorker.controller;
          resolve(!!(c && c.scriptURL.includes("enable-threads.js")));
        },
        { once: true }
      );
    });
  }

  async function registerRootSw() {
    if (!("serviceWorker" in navigator)) {
      throw new Error("serviceWorker API missing");
    }
    await unregisterCompetitors();
    await new Promise((r) => setTimeout(r, 50));

    // scope "/" — only legal because the script lives at /enable-threads.js
    const reg = await navigator.serviceWorker.register(ROOT_SW, {
      scope: "/",
      updateViaCache: "none",
    });
    console.log("[WebDesk COI] register() ok", reg.scope, ROOT_SW);

    if (reg.waiting) {
      reg.waiting.postMessage({ type: "SKIP_WAITING" });
    }
    await navigator.serviceWorker.ready;
    const ok = await waitForController(6000);
    if (!ok) {
      console.warn(
        "[WebDesk COI] registered but controller not enable-threads yet",
        navigator.serviceWorker.controller?.scriptURL
      );
    }
    return reg;
  }

  async function unregisterRootIsolation() {
    const regs = await listRegs();
    await Promise.all(
      regs.map(async (reg) => {
        const urls = scriptUrls(reg);
        if (
          urls.some(
            (u) =>
              u.includes("enable-threads.js") ||
              u.includes("coi-sw.js") ||
              u.includes("/sw.js")
          )
        ) {
          try {
            await reg.unregister();
            console.log("[WebDesk COI] unregistered", reg.scope);
          } catch (_) {}
        }
      })
    );
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
        await unregisterRootIsolation();
        hardNavigate();
        return;
      }
      try {
        await registerRootSw();
      } catch (e) {
        console.error("[WebDesk COI] enable failed", e);
      }
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
          waiting: r.waiting?.scriptURL,
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
    // If isolation SW still controlling while feature is off, drop it once
    listRegs().then(async (regs) => {
      const iso = regs.some((r) =>
        scriptUrls(r).some((u) => /enable-threads|coi-sw/i.test(u))
      );
      if (iso) {
        await unregisterRootIsolation();
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

  if (window.crossOriginIsolated) {
    sessionStorage.removeItem(RELOAD_KEY);
    sessionStorage.removeItem(FAIL_KEY);
    cleanUrlQuietly();
    console.log("[WebDesk COI] crossOriginIsolated OK (site-wide SW)");
    return;
  }

  const n = getReloads();
  if (n >= MAX) {
    sessionStorage.setItem(FAIL_KEY, "1");
    sessionStorage.removeItem(RELOAD_KEY);
    console.warn(
      "[WebDesk COI] gave up after",
      MAX,
      "attempts. controller=",
      navigator.serviceWorker?.controller?.scriptURL
    );
    return;
  }

  setReloads(n + 1);
  console.log(
    "[WebDesk COI] not isolated — register ROOT",
    ROOT_SW,
    "scope=/ attempt",
    n + 1,
    "/",
    MAX
  );

  registerRootSw()
    .then(() => hardNavigate())
    .catch((err) => {
      console.error("[WebDesk COI] register error", err);
      hardNavigate();
    });
})();
