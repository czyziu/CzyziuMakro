// public/auth-guard.js
// 1) Sprawdź token, 2) odczytaj usera z JWT, 3) ustaw nagłówek w fetchach, 4) pokaż info w UI

function b64urlDecode(str) {
  try {
    str = str.replace(/-/g, '+').replace(/_/g, '/');
    const pad = str.length % 4;
    if (pad) str += '='.repeat(4 - pad);
    return atob(str);
  } catch { return null; }
}
function decodeJWT(t) {
  try {
    const parts = String(t).split('.');
    if (parts.length !== 3) return null;
    const payload = b64urlDecode(parts[1]);
    return payload ? JSON.parse(payload) : null;
  } catch { return null; }
}

// 1) pobierz token
const token = localStorage.getItem('token');

// jeśli brak — wyloguj/przekieruj
if (!token) {
  // opcjonalnie wyczyść jakieś lokalne ślady
  localStorage.removeItem('token');
  location.href = '/logowanie.html';
}

// 2) odczytaj usera z JWT (do UI/debug)
const payload = decodeJWT(token) || {};
const userId = String(
  payload.userId || payload.sub || payload.id || (payload.user && (payload.user._id || payload.user.id)) || ''
);
const userEmail = payload.email || (payload.user && payload.user.email) || '';

// 3) pokaż info o zalogowanym użytkowniku (opcjonalnie)
(function showWho() {
  const el = document.querySelector('#auth-user-info');
  if (!el) return;
  el.textContent = userEmail ? `Zalogowano: ${userEmail}` : `ID użytkownika: ${userId}`;
})();

// 4) helper do autoryzowanych fetchy — możesz używać w swoich skryptach
export async function authFetch(url, options = {}) {
  const headers = new Headers(options.headers || {});
  headers.set('Authorization', 'Bearer ' + token);
  if (!headers.has('Content-Type') && options.body && typeof options.body === 'string') {
    headers.set('Content-Type', 'application/json');
  }
  const res = await fetch(url, { ...options, headers });
  // opcjonalna obsługa 401 → redirect
  if (res.status === 401) {
    localStorage.removeItem('token');
    location.href = '/logowanie.html';
    return Promise.reject(new Error('Unauthorized'));
  }
  return res;
}

// 5) udostępnij usera globalnie (gdybyś chciał np. wstawić hidden input)
window.cmAuth = { token, userId, userEmail };
