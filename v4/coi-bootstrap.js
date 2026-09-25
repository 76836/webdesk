/**
 * WebDesk COI bootstrap
 * localStorage WebDesk_coi_enabled: "1" (default off for safety) or "0"
 * sessionStorage WebDesk_coi_reloads: attempt count this session
 */
(function () {
  const KEY = "WebDesk_coi_enabled";
  const RELOAD_KEY = "WebDesk_coi_reloads";
  const FAIL_KEY = "WebDesk_coi_failed";
  const MAX_RELOADS = 2;
  const SW_URL = new URL("./coi-sw.js", window.location.href).href;

  function enabled() {
    return localStorage.getItem(KEY) === "1";
  }

  function reloadCount() {
    return parseInt(sessionStorage.getItem(RELOAD_KEY) || "0", 10) || 0;
  }

  function setReloadCount(n) {
    sessionStorage.setItem(RELOAD_KEY, String(n));
  }

  async function unregisterAll() {
    if (!("serviceWorker" in navigator)) return;
    const regs = await navigator.serviceWorker.getRegistrations();
    await Promise.all(regs.map((r) => r.unregister()));
  }

  async function registerSw() {
    if (!("serviceWorker" in navigator)) throw new Error("No serviceWorker");
    const reg = await navigator.serviceWorker.register(SW_URL, { scope: "./" });
    // Wait until controlling or active
    if (navigator.serviceWorker.controller) {
      navigator.serviceWorker.controller.postMessage({ type: "webdesk-coi-set", enabled: true });
      return reg;
    }
    await new Promise((resolve) => {
      const t = setTimeout(resolve, 2500);
      navigator.serviceWorker.addEventListener(
        "controllerchange",
        () => {
          clearTimeout(t);
          resolve();
        },
        { once: true }
      );
    });
    navigator.serviceWorker.controller?.postMessage({
      type: "webdesk-coi-set",
      enabled: true,
    });
    return reg;
  }

  /**
   * Public API for settings + desktop
   */
  window.WebDeskCOI = {
    KEY,
    isEnabled: enabled,
    isIsolated: () => !!window.crossOriginIsolated,
    async setEnabled(on) {
      localStorage.setItem(KEY, on ? "1" : "0");
      sessionStorage.removeItem(RELOAD_KEY);
      sessionStorage.removeItem(FAIL_KEY);
      if (!on) {
        await unregisterAll();
        // Reload so headers drop
        window.location.reload();
        return;
      }
      await registerSw();
      window.location.reload();
    },
    consumeFailureFlag() {
      const f = sessionStorage.getItem(FAIL_KEY) === "1";
      if (f) sessionStorage.removeItem(FAIL_KEY);
      return f;
    },
  };

  // --- Boot path ---
  if (!enabled()) {
    // Ensure no stale SW keeps forcing headers when user turned feature off
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.getRegistrations().then((regs) => {
        // Only unregister our COI worker if present
        regs.forEach((r) => {
          if (r.active?.scriptURL?.includes("coi-sw") || r.installing?.scriptURL?.includes("coi-sw") || r.waiting?.scriptURL?.includes("coi-sw")) {
            r.unregister();
          }
        });
      });
    }
    return;
  }

  // Feature ON
  if (window.crossOriginIsolated) {
    sessionStorage.removeItem(RELOAD_KEY);
    sessionStorage.removeItem(FAIL_KEY);
    // Keep SW informed
    if (navigator.serviceWorker?.controller) {
      navigator.serviceWorker.controller.postMessage({ type: "webdesk-coi-set", enabled: true });
    } else if ("serviceWorker" in navigator) {
      registerSw().catch(() => {});
    }
    return;
  }

  // Headers intended but not isolated yet
  const n = reloadCount();
  if (n >= MAX_RELOADS) {
    sessionStorage.setItem(FAIL_KEY, "1");
    sessionStorage.removeItem(RELOAD_KEY);
    console.warn("[WebDesk COI] isolation failed after", MAX_RELOADS, "reloads");
    return; // continue load; init will show error window
  }

  setReloadCount(n + 1);
  console.log("[WebDesk COI] not isolated — registering SW and reload", n + 1, "/", MAX_RELOADS);
  registerSw()
    .then(() => {
      window.location.reload();
    })
    .catch((err) => {
      console.error("[WebDesk COI] register failed", err);
      if (reloadCount() >= MAX_RELOADS) {
        sessionStorage.setItem(FAIL_KEY, "1");
        sessionStorage.removeItem(RELOAD_KEY);
      } else {
        window.location.reload();
      }
    });
})();
