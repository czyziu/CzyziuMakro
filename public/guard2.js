// public/guard2.js
// Dopalacz do guard.js: exp JWT, (opcjonalnie) onboarding, role, cross-tab. CSP-safe (żadnych inline).

(function () {
  // ====== KONFIG (opcjonalnie) ======
  // Wymagaj ukończonego profilu na tej stronie?
  // (Możesz też sterować w HTML: <body data-require-profile="true">)
  const REQUIRE_PROFILE_DEFAULT = false;

  // Wymagana rola? (np. 'admin'); albo ustaw w HTML: <body data-required-role="admin">
  const REQUIRED_ROLE_DEFAULT = ''; // '' = brak

  // ====== Early exit na stronie logowania ======
  const isLoginPage =
    location.pathname === '/logowanie.html' ||
    location.pathname.endsWith('/logowanie.html');
  if (isLoginPage) return;

  // ====== Helpers ======
  function b64urlDecode(str) {
    try {
      str = str.replace(/-/g, '+').replace(/_/g, '/');
      const pad = str.length % 4;
      if (pad) str += '='.repeat(4 - pad);
      return atob(str);
    } catch { return null; }
  }

  function decodeJWT(token) {
    try {
      const parts = String(token).split('.');
      if (parts.length !== 3) return null;
      const payload = b64urlDecode(parts[1]);
      return payload ? JSON.parse(payload) : null;
    } catch { return null; }
  }

  function isExpired(token, skewSec = 30) {
    const p = decodeJWT(token);
    if (!p || !p.exp) return false; // brak exp → nie blokuj; backend i tak zweryfikuje
    const now = Math.floor(Date.now() / 1000);
    return p.exp <= (now - skewSec);
  }

  function redirectToLogin() {
    // Nie buduj pętli: jeśli już jesteśmy na logowaniu, nic nie rób
    if (isLoginPage) return;
    const next = location.pathname + location.search + location.hash;
    location.replace('logowanie.html?next=' + encodeURIComponent(next));
  }

  // ====== Start (bez czekania na DOM) ======
  let token = null;
  try { token = localStorage.getItem('cm_token'); } catch {}

  // Jeśli nie mamy tokena — guard.js zrobi overlay/redirect. Tu nic nie robimy.
  if (!token) return;

  // Token uszkodzony/niewłaściwy format → wyczyść i zaloguj ponownie
  if (!decodeJWT(token)) {
    try { localStorage.removeItem('cm_token'); } catch {}
    redirectToLogin();
    return;
  }

  // 1) Wygasły token → wyloguj i przekieruj
  if (isExpired(token)) {
    try { localStorage.removeItem('cm_token'); } catch {}
    redirectToLogin();
    return;
  }

  // 2) Role (opcjonalnie)
  const requiredRole = (document.body?.dataset?.requiredRole || REQUIRED_ROLE_DEFAULT || '').trim();
  if (requiredRole) {
    const payload = decodeJWT(token) || {};
    const roles =
      Array.isArray(payload.role) ? payload.role :
      Array.isArray(payload.roles) ? payload.roles :
      payload.role ? [payload.role] : [];
    if (!roles.includes(requiredRole)) {
      // brak uprawnień → przenieś np. na stronę główną
      location.replace('index.html');
      return;
    }
  }

  // 3) (Opcjonalnie) Wymagaj ukończonego onboardingu (profilu)
  const requireProfile =
    (document.body?.dataset?.requireProfile === 'true') || REQUIRE_PROFILE_DEFAULT;

  if (requireProfile) {
    let profileDone = false;
try {
  const t = localStorage.getItem('cm_token');
  const parts = t ? t.split('.') : [];
  const decode = (s)=>{ try{
    s = s.replace(/-/g,'+').replace(/_/g,'/');
    const pad = s.length % 4; if (pad) s += '='.repeat(4 - pad);
    return JSON.parse(atob(s));
  } catch { return null; } };
  const payload = (parts.length===3) ? decode(parts[1]) : null;
  const uid = payload && (payload.userId || payload.sub || payload.id);
  const key = uid ? `cm_${uid}_profile_setup` : null;
  profileDone = key ? (localStorage.getItem(key) === 'true') : false;
} catch {}

    if (!profileDone) {
      // Sprawdź w API (może już zapisane na innym urządzeniu)
      fetch('/api/profile/status', {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
          'Authorization': 'Bearer ' + token
        }
      }).then(async (res) => {
        // TYLKO jeśli 401 → token nieprawidłowy → redirect do logowania
        if (res.status === 401) {
          try { localStorage.removeItem('cm_token'); } catch {}
          redirectToLogin();
          return;
        }

        // Każdy inny nie-OK (np. 404/500/offline) — NIE BLOKUJ.
        // Onboarding.js sam pokaże modal gdy potrzeba.
        if (!res.ok) return;

        const data = await res.json().catch(() => ({}));
        if (data && data.completed === true) {
          try { localStorage.setItem('cm_profile_setup', 'true'); } catch {}
          if (data.profile) {
            try { localStorage.setItem('cm_profile', JSON.stringify(data.profile)); } catch {}
          }
        }
        // Jeśli completed=false → nic nie rób: onboarding.js pokaże modal.
      }).catch(() => {
        // Brak sieci — pozwól onboardingowi działać (modal/fallback).
      });
    }
  }

  // 4) Cross-tab: jeśli w innej karcie usunięto token → przekieruj tutaj
  window.addEventListener('storage', (e) => {
    if (e.key === 'cm_token' && !e.newValue) {
      redirectToLogin();
    }
  });
})();
