/* =========================================================================
   guard.js — lekki strażnik widoczności treści
   Scenariusze:
   1) Brak/wygaśnięty token -> blur + ściana "Tylko dla zalogowanych"
   2) Pierwsze logowanie (token OK, brak flagi profilu) -> blur zostaje,
      onboarding.js pokazuje formularz
   3) Kolejne logowania (token OK, flaga profilu = true) -> brak blur, treść normalnie
   ========================================================================= */

(function () {
  "use strict";

  // ====== Konfiguracja (zmień pod siebie w razie potrzeby) =================
  const TOKEN_KEY = "cm_token"; // localStorage key z JWT
  const LOGIN_URL = "/logowanie.html";  // absolutna ścieżka z ukośnikiem
  const WALL_ID   = "authWall"; // id kontenera z komunikatem
  const BLUR_CLASS = "blur-active"; // klasa CSS włączająca rozmycie tła

  // ====== Utilsy ===========================================================
  const b64urlToStr = (b64url) => {
    try {
      const b64 = b64url.replace(/-/g, "+").replace(/_/g, "/")
                        .padEnd(Math.ceil(b64url.length / 4) * 4, "=");
      return decodeURIComponent(
        atob(b64)
          .split("")
          .map((c) => "%" + ("00" + c.charCodeAt(0).toString(16)).slice(-2))
          .join("")
      );
    } catch {
      return "";
    }
  };

  const parseJwt = (jwt) => {
    if (!jwt || typeof jwt !== "string") return null;
    const parts = jwt.split(".");
    if (parts.length < 2) return null;
    try {
      return JSON.parse(b64urlToStr(parts[1]));
    } catch {
      return null;
    }
  };

  const nowSec = () => Math.floor(Date.now() / 1000);

  const getTokenPayload = () => {
    const raw = localStorage.getItem(TOKEN_KEY);
    const payload = parseJwt(raw);
    return payload && typeof payload === "object" ? payload : null;
  };

  const getUserId = () => {
    const p = getTokenPayload();
    // typowo sub / userId / id
    return p?.sub || p?.userId || p?.id || null;
  };

  const tokenValid = () => {
    const p = getTokenPayload();
    if (!p) return false;
    if (typeof p.exp === "number" && p.exp <= nowSec()) return false;
    return true;
  };

  const profileFlagKey = (uid) => `cm_${uid}_profile_setup`;
  const isProfileSetup = (uid) => localStorage.getItem(profileFlagKey(uid)) === "true";

  // ====== BLUR / WALL ======================================================
  const addBlur = () => {
    document.documentElement.classList.add(BLUR_CLASS);
    document.body.classList.add(BLUR_CLASS);
  };
  const removeBlur = () => {
    document.documentElement.classList.remove(BLUR_CLASS);
    document.body.classList.remove(BLUR_CLASS);
  };

  const ensureWallExists = () => {
    let wall = document.getElementById(WALL_ID);
    if (wall) return wall;

    wall = document.createElement("div");
    wall.id = WALL_ID;
    wall.setAttribute("role", "dialog");
    wall.setAttribute("aria-modal", "true");
    wall.style.position = "fixed";
    wall.style.inset = "0";
    wall.style.display = "none";
    wall.style.zIndex = "1101"; // nad blur/backdropem
    wall.style.backdropFilter = "none"; // bez dodatkowego blurra
    wall.style.pointerEvents = "auto";

    // prosty, samowystarczalny styl (niezależny od reszty CSS)
    wall.innerHTML = `
  <style>
    .auth-wall-wrap {
      position:absolute; inset:0;
      display:flex; align-items:center; justify-content:center;
      padding:16px;
    }
    .auth-wall-card {
      max-width:520px; width:100%;
      background:#0f172a; color:#f8fafc;
      border:1px solid #1e293b;
      border-radius:16px;
      box-shadow:0 20px 50px rgba(0,0,0,.5);
      padding:28px 32px;
      text-align:center;
      font-family: Inter, system-ui, -apple-system, sans-serif;
    }
    .auth-wall-card h2 {
      margin:0 0 10px;
      font-size:22px;
      font-weight:800;
      letter-spacing:.2px;
    }
    .auth-wall-card p {
      margin:0 0 20px;
      line-height:1.55;
      color:#cbd5e1;
    }
    .auth-wall-btn {
      display:inline-block;
      padding:12px 20px;
      border-radius:12px;
      background:#facc15;
      color:#1a1500;
      font-weight:800;
      letter-spacing:.25px;
      text-decoration:none;
      box-shadow:0 10px 24px rgba(250,204,21,.35);
      transform:translateY(0);
      transition:
        transform .15s ease,
        box-shadow .15s ease,
        background .15s ease;
    }
    .auth-wall-btn:hover {
      background:#eab308;
      box-shadow:0 14px 30px rgba(250,204,21,.45);
      transform:translateY(-1px);
    }
    .auth-wall-btn:focus-visible {
      outline:3px solid #facc15;
      outline-offset:2px;
    }
  </style>

  <div class="auth-wall-wrap">
    <div class="auth-wall-card">
      <h2>Treść dostępna tylko dla zalogowanych</h2>
      <p>Zaloguj się, aby zobaczyć zawartość tej strony.</p>
      <a class="auth-wall-btn" href="${LOGIN_URL}">Przejdź do logowania</a>
    </div>
  </div>
`;

    document.body.appendChild(wall);
    return wall;
  };

  const showWall = () => {
    ensureWallExists().style.display = "block";
  };
  const hideWall = () => {
    const wall = document.getElementById(WALL_ID);
    if (wall) wall.style.display = "none";
  };

  // Dodatkowo „uciszamy” ewentualny onboarding, gdy user jest gościem,
  // żeby nie migał (bez ciężkich observerów).
  const hardHideOnboarding = () => {
    const ids = ["onbModal", "onbBackdrop", "onbForm", "onboardingForm"];
    for (const id of ids) {
      const el = document.getElementById(id);
      if (!el) continue;
      if (el.hidden && el.style.display === "none" && el.hasAttribute("inert")) continue;
      el.hidden = true;
      el.style.display = "none";
      el.setAttribute("aria-hidden", "true");
      el.setAttribute("inert", "");
    }
    document.querySelectorAll(".modal, .onboarding, [data-onboarding]")
      .forEach((el) => {
        if (el.hidden && el.style.display === "none" && el.hasAttribute("inert")) return;
        el.hidden = true;
        el.style.display = "none";
        el.setAttribute("aria-hidden", "true");
        el.setAttribute("inert", "");
      });
  };

  // ====== Główny przełącznik stanów =======================================
  let lastAppliedState = null; // "guest" | "first" | "ok"

  const applyState = () => {
    const valid = tokenValid();

    if (!valid) {
      // --- Scenariusz 1: gość / token nieważny ---
      if (lastAppliedState !== "guest") {
        addBlur();
        showWall();
        hardHideOnboarding();
        lastAppliedState = "guest";
      }
      return;
    }

    hideWall();

    const uid = getUserId();
    const firstLogin = uid && !isProfileSetup(uid);

    if (firstLogin) {
      // --- Scenariusz 2: pierwsze logowanie — zostaw blur,
      // onboarding.js pokaże modal i po sukcesie ustawi flagę ---
      if (lastAppliedState !== "first") {
        addBlur();
        lastAppliedState = "first";
      }
      return;
    }

    // --- Scenariusz 3: wszystko OK, treść widoczna ---
    if (lastAppliedState !== "ok") {
      removeBlur();
      lastAppliedState = "ok";
    }
  };

  // ====== Reagowanie na zmiany tokena / czasu =============================
  const onStorage = (e) => {
    if (e.key === TOKEN_KEY) {
      // zmiana tokena w innej karcie
      applyState();
    } else if (e.key && e.key.startsWith("cm_") && e.key.endsWith("_profile_setup")) {
      // onboarding zakończony
      applyState();
    }
  };

  // Autowylogowanie po wygaśnięciu tokena (lekki „watchdog”)
  let expiryTimer = null;
  const scheduleExpiryCheck = () => {
    if (expiryTimer) clearTimeout(expiryTimer);
    const p = getTokenPayload();
    if (!p?.exp) return;
    const ms = Math.max(0, p.exp * 1000 - Date.now());
    // sprawdzimy tuż po czasie wygaśnięcia
    expiryTimer = setTimeout(() => {
      if (!tokenValid()) {
        localStorage.removeItem(TOKEN_KEY);
      }
      applyState();
    }, ms + 250);
  };

  // ====== Start ============================================================
  const start = () => {
    // Jeśli ktoś zostawił „startowe” rozmycie w HTML — zdejmij:
    document.documentElement.classList.remove(BLUR_CLASS);
    document.body.classList.remove(BLUR_CLASS);

    applyState();
    scheduleExpiryCheck();

    // Zmiany między kartami / onboarding
    window.addEventListener("storage", onStorage);

    // Na wypadek ręcznych modyfikacji localStorage w tej samej karcie:
    // Delikatny polling co 1.5s (lekki koszt, zero observerów atrybutów)
    let lastToken = localStorage.getItem(TOKEN_KEY);
    setInterval(() => {
      const cur = localStorage.getItem(TOKEN_KEY);
      if (cur !== lastToken) {
        lastToken = cur;
        scheduleExpiryCheck();
        applyState();
      }
    }, 1500);

    // Re-check na zmianę widoczności (np. powrót do karty po dłuższej przerwie)
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") {
        scheduleExpiryCheck();
        applyState();
      }
    });
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }
})();
