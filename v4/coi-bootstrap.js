/**
 * WebDesk COI bootstrap — runs before the desktop.
 *
 * localStorage  WebDesk_coi_enabled = "1" | "0"  (default off)
 * sessionStorage WebDesk_coi_reloads = "0"|"1"|"2"
 * sessionStorage WebDesk_coi_failed  = "1" after giving up
 *
 * Only one SW: ./coi-sw.js at scope ./
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

  async function listRegs() {
    if (!("serviceWorker" in navigator)) return [];
    return navigator.serviceWorker.getRegistrations();
  }

  /** Remove every SW that could fight for this scope or parent scopes. */
  async function unregisterConflicting() {
    const regs = await listRegs();
    await Promise.all(
      regs.map(async (reg) => {
        const urls = [reg.active, reg.waiting, reg.installing]
          .filter(Boolean)
          .map((w) => w.scriptURL);
        // Unregister anything under webdesk, or unknown workers on this origin
        const ours = urls.some(
          (u) =>
            u.includes("/webdesk/") ||
            u.includes("coi-sw") ||
            u.includes("coi-serviceworker") ||
            u.includes("sw.js")
        );
        // Always unregister all on this origin when managing COI — Pages SW conflicts are common
        try {
          const ok = await reg.unregister();
          console.log("[WebDesk COI] unregistered", urls.join(",") || reg.scope, ok);
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
    // Clear conflicts first
    await unregisterConflicting();
    // Small delay so browser drops old controller
    await new Promise((r) => setTimeout(r, 50));

    const reg = await navigator.serviceWorker.register(SW_PATH, {
      scope: "./",
      updateViaCache: "none",
    });
    await navigator.serviceWorker.ready;
    // Force activate
    if (reg.waiting) {
      reg.waiting.postMessage({ type: "SKIP_WAITING" });
    }
    await waitForController(4000);
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
        await unregisterConflicting();
        location.reload();
        return;
      }
      try {
        await registerExclusive();
      } catch (e) {
        console.error("[WebDesk COI] enable failed", e);
      }
      location.reload();
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
        regs: regs.map((r) => ({
          scope: r.scope,
          active: r.active?.scriptURL,
          waiting: r.waiting?.scriptURL,
        })),
      };
    },
  };

  // -------- boot --------
  if (!wantCoi()) {
    // If a COI SW is still controlling while feature is off, drop it once
    listRegs().then(async (regs) => {
      const coiRegs = regs.filter((r) =>
        [r.active, r.waiting, r.installing].some((w) => w && w.scriptURL.includes("coi-sw"))
      );
      if (coiRegs.length) {
        await unregisterConflicting();
        // One cleanup reload if we were isolated under a stale SW
        if (sessionStorage.getItem("WebDesk_coi_cleanup") !== "1") {
          sessionStorage.setItem("WebDesk_coi_cleanup", "1");
          location.reload();
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
    console.log("[WebDesk COI] crossOriginIsolated OK");
    return;
  }

  const n = getReloads();
  if (n >= MAX) {
    sessionStorage.setItem(FAIL_KEY, "1");
    sessionStorage.removeItem(RELOAD_KEY);
    console.warn("[WebDesk COI] gave up after", MAX, "reloads. controller=", navigator.serviceWorker?.controller?.scriptURL);
    return;
  }

  setReloads(n + 1);
  console.log("[WebDesk COI] not isolated — exclusive SW register + reload", n + 1, "/", MAX);

  registerExclusive()
    .then((reg) => {
      console.log(
        "[WebDesk COI] registered",
        reg.scope,
        "controller=",
        navigator.serviceWorker.controller?.scriptURL
      );
      location.reload();
    })
    .catch((err) => {
      console.error("[WebDesk COI] register error", err);
      // Still reload to consume attempt; next pass may work
      location.reload();
    });
})();
