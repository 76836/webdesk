/**
 * WebDesk COI bootstrap
 *
 * Firefox shows:
 *   "This page has not been loaded because it looks like the security
 *    configuration doesn't match the previous page."
 * when COOP differs between history entries (e.g. location.reload() after SW
 * starts injecting COOP). Fix: always activate with location.replace() and a
 * fresh URL so it is not a same-history COOP mismatch.
 */
(function () {
  const KEY = "WebDesk_coi_enabled";
  const RELOAD_KEY = "WebDesk_coi_reloads";
  const FAIL_KEY = "WebDesk_coi_failed";
  const MAX = 2;
  const SW_PATH = "./coi-sw.js";

  function wantCoi() {
    return localStorage.getItem(KEY) === "1";
  }

  function getReloads() {
    return parseInt(sessionStorage.getItem(RELOAD_KEY) || "0", 10) || 0;
  }

  function setReloads(n) {
    sessionStorage.setItem(RELOAD_KEY, String(n));
  }

  /** Navigate without keeping the previous COOP in session history (Firefox). */
  function hardNavigate() {
    const u = new URL(location.href);
    // Drop prior coi cache-busters, add a new one
    u.searchParams.delete("_coi");
    u.searchParams.set("_coi", String(Date.now()));
    // replace() avoids "security configuration doesn't match the previous page"
    location.replace(u.pathname + u.search + u.hash);
  }

  async function listRegs() {
    if (!("serviceWorker" in navigator)) return [];
    return navigator.serviceWorker.getRegistrations();
  }

  async function unregisterAll() {
    const regs = await listRegs();
    await Promise.all(
      regs.map(async (reg) => {
        try {
          await reg.unregister();
          console.log("[WebDesk COI] unregistered", reg.scope);
        } catch (e) {
          console.warn("[WebDesk COI] unregister failed", e);
        }
      })
    );
  }

  async function waitForController(timeoutMs) {
    if (navigator.serviceWorker.controller) return true;
    return new Promise((resolve) => {
      const t = setTimeout(() => resolve(!!navigator.serviceWorker.controller), timeoutMs);
      navigator.serviceWorker.addEventListener(
        "controllerchange",
        () => {
          clearTimeout(t);
          resolve(true);
        },
        { once: true }
      );
    });
  }

  async function registerExclusive() {
    if (!("serviceWorker" in navigator)) {
      throw new Error("serviceWorker API missing");
    }
    await unregisterAll();
    await new Promise((r) => setTimeout(r, 75));

    const reg = await navigator.serviceWorker.register(SW_PATH, {
      scope: "./",
      updateViaCache: "none",
    });

    if (reg.waiting) {
      reg.waiting.postMessage({ type: "SKIP_WAITING" });
    }
    await navigator.serviceWorker.ready;
    await waitForController(5000);
    return reg;
  }

  window.WebDeskCOI = {
    KEY,
    isEnabled: wantCoi,
    isIsolated: () => !!window.crossOriginIsolated,
    async setEnabled(on) {
      localStorage.setItem(KEY, on ? "1" : "0");
      sessionStorage.removeItem(RELOAD_KEY);
      sessionStorage.removeItem(FAIL_KEY);
      if (!on) {
        await unregisterAll();
        hardNavigate();
        return;
      }
      try {
        await registerExclusive();
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
        reloads: getReloads(),
        ua: navigator.userAgent,
        regs: regs.map((r) => ({
          scope: r.scope,
          active: r.active?.scriptURL,
          waiting: r.waiting?.scriptURL,
        })),
      };
    },
  };

  // Strip _coi from the visible URL after a successful isolated load (optional cleanup)
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
      const hasCoi = regs.some((r) =>
        [r.active, r.waiting, r.installing].some((w) => w && /coi-sw/i.test(w.scriptURL))
      );
      if (hasCoi) {
        await unregisterAll();
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
    console.log("[WebDesk COI] crossOriginIsolated OK");
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
  console.log("[WebDesk COI] not isolated — register + replace navigate", n + 1, "/", MAX);

  registerExclusive()
    .then((reg) => {
      console.log("[WebDesk COI] registered", reg.scope, "ctrl=", navigator.serviceWorker.controller?.scriptURL);
      hardNavigate();
    })
    .catch((err) => {
      console.error("[WebDesk COI] register error", err);
      hardNavigate();
    });
})();
