// public/app.js
// Front do rejestracji/logowania (payload { body: { ... } } + top-level dla middleware)

/* ========== Helpers ========== */
function normalizeToken(t) {
  if (!t) return '';
  return String(t).trim().replace(/^Bearer\s+/i, '');
}

function parseJwt(token) {
  try {
    const raw = normalizeToken(token);
    const base = raw.split('.')[1];
    if (!base) return null;
    // url-safe base64 -> base64
    const json = atob(base.replace(/-/g, '+').replace(/_/g, '/'));
    return JSON.parse(json);
  } catch { return null; }
}

function buildUserFromToken(token) {
  const payload = parseJwt(token) || {};
  const username =
    payload.username ||
    payload.user?.username ||
    payload.name ||
    payload.sub ||
    '';
  const email = payload.email || payload.user?.email || '';
  const name = payload.name || payload.user?.name || username || '';
  if (!username && !email && !name) return null;
  return { username, email, name };
}

async function postJSON(url, data) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type':'application/json' },
    body: JSON.stringify(data),
  });

  const text = await res.text();
  let json = {};
  try { json = text ? JSON.parse(text) : {}; } catch {}

  console.log('[REQ]', url, data);
  console.log('[RES]', res.status, text);

  if (!res.ok) {
    const msg = (json && (json.error || json.message)) || text || 'Wystąpił błąd';
    throw new Error(msg);
  }
  return json;
}

function toUsername(fullName) {
  let u = (fullName || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  u = u.replace(/[^a-zA-Z0-9_.\- ]+/g, '').trim().replace(/\s+/g, '_').toLowerCase();
  if (u.length < 3) u = (u + '___').slice(0, 3);
  return u;
}

function ensureMsgBox(form) {
  let el = form.querySelector('.form-msg');
  if (!el) {
    el = document.createElement('p');
    el.className = 'form-msg';
    form.appendChild(el);
  }
  return el;
}

function setSubmitting(form, on) {
  const btn = form.querySelector('[type="submit"]');
  if (!btn) return;
  btn.disabled = on;
  if (on) {
    btn.dataset._label = btn.textContent;
    btn.textContent = 'Przetwarzanie...';
  } else {
    btn.textContent = btn.dataset._label || btn.textContent;
    delete btn.dataset._label;
  }
}

const auth = {
  save(t) { if (t) localStorage.setItem('cm_token', t); },
  clear() { localStorage.removeItem('cm_token'); localStorage.removeItem('cm_user'); },
  get() { return localStorage.getItem('cm_token'); },
};

/* ========== Rejestracja ========== */
function initRegisterForm() {
  const form =
    document.querySelector('body[data-page="rejestracja"] form.form') ||
    document.getElementById('registerForm');
  if (!form) return;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const fullName = (form.querySelector('#fullName')?.value || '').trim();
    const email = (form.querySelector('#email')?.value || '').trim();
    const password = form.querySelector('#password')?.value || '';
    const password2 = form.querySelector('#password2')?.value || '';
    const tos = !!form.querySelector('#tos')?.checked;

    const username = toUsername(fullName);
    const msg = ensureMsgBox(form);

    // Walidacja po stronie klienta
    if (fullName.length < 3) return (msg.textContent = 'Imię i nazwisko musi mieć co najmniej 3 znaki.', msg.className='form-msg err');
    if (username.length < 3) return (msg.textContent = 'Login (po przetworzeniu) musi mieć co najmniej 3 znaki.', msg.className='form-msg err');
    if (!email.includes('@') || !email.includes('.')) return (msg.textContent = 'Podaj poprawny adres e-mail (np. nazwa@domena.pl).', msg.className='form-msg err');
    if (password.length < 6) return (msg.textContent = 'Hasło musi mieć co najmniej 6 znaków.', msg.className='form-msg err');
    if (password !== password2) return (msg.textContent = 'Hasła nie są identyczne.', msg.className='form-msg err');
    if (!tos) return (msg.textContent = 'Musisz zaakceptować Regulamin.', msg.className='form-msg err');

    try {
      setSubmitting(form, true);
      msg.textContent = ''; msg.className = 'form-msg';

      // Wysyłamy pola zarówno top-level (dla middleware), jak i w body (dla walidatora)
      const payload = {
        name: fullName,
        fullName: fullName,
        username,
        email,
        password,
        body: { name: fullName, username, email, password },
      };

      const res = await postJSON('/api/auth/register', payload);

      const token = res.token;
      auth.save(token);
      let user = res.user || { username, name: fullName, email };
      if (!user || !user.username) {
        const fromToken = buildUserFromToken(token);
        if (fromToken) user = fromToken;
      }
      localStorage.setItem('cm_user', JSON.stringify(user));

      msg.textContent = res.message || `Witaj, ${user.username || username}! Konto utworzone.`;
      msg.className = 'form-msg ok';

      setTimeout(() => { window.location.href = 'logowanie.html'; }, 800);
    } catch (err) {
      msg.textContent = err.message || 'Nie udało się utworzyć konta.';
      msg.className = 'form-msg err';
    } finally {
      setSubmitting(form, false);
    }
  });
}

/* ========== Logowanie ========== */
function initLoginForm() {
  const form =
    document.querySelector('body[data-page="logowanie"] form.form') ||
    document.getElementById('loginForm');
  if (!form) return;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const email = (form.querySelector('#email')?.value || '').trim();
    const password = form.querySelector('#password')?.value || '';
    const msg = ensureMsgBox(form);

    if (!email.includes('@') || !email.includes('.')) return (msg.textContent = 'Podaj poprawny adres e-mail.', msg.className='form-msg err');
    if (!password) return (msg.textContent = 'Podaj hasło.', msg.className='form-msg err');

    try {
      setSubmitting(form, true);
      msg.textContent = ''; msg.className = 'form-msg';

      // Backend wymaga { body: { email, password } }
      const res = await postJSON('/api/auth/login', { body: { email, password } });

      const token = res.token;
      auth.save(token);

      // 1) Preferuj usera z odpowiedzi
      let user = res.user || null;

      // 2) Jeśli brak, spróbuj z JWT
      if (!user || !user.username) {
        const fromToken = buildUserFromToken(token);
        if (fromToken) user = fromToken;
      }

      // 3) Jeśli token też nie ma username/email (jak u Ciebie) — zbuduj usera z e-maila
      if (!user || (!user.username && !user.name)) {
        const uname = email.split('@')[0] || 'Użytkowniku';
        user = { username: uname, name: uname, email };
      }

      localStorage.setItem('cm_user', JSON.stringify(user));

      msg.textContent = `Zalogowano jako ${user.email || email}.`;
      msg.className = 'form-msg ok';

      setTimeout(() => { window.location.href = 'pozalogowaniu.html'; }, 600);
    } catch (err) {
      msg.textContent = (err.message === 'Invalid credentials')
        ? 'Zły e-mail lub hasło (albo konto nie istnieje).'
        : (err.message || 'Nie udało się zalogować.');
      msg.className = 'form-msg err';
    } finally {
      setSubmitting(form, false);
    }
  });
}
/* ========== UI: wylogowanie / stan ========== */
function initAuthUI() {
  // GLOBALNE WYLOGOWANIE (header + modal)
  document.addEventListener('click', function (e) {
    const el = e.target.closest('[data-action="logout"], #logoutBtn');
    if (!el) return;

    e.preventDefault();

    // Usuń tokeny i dane logowania
    try {
      auth.clear();
      ['token', 'auth', 'jwt', 'accessToken', 'refreshToken', 'user', 'profile']
        .forEach(k => {
          localStorage.removeItem(k);
          sessionStorage.removeItem(k);
        });
    } catch (_) {}

    // Usuń ciasteczka (jeśli jakieś są)
    try {
      document.cookie.split(';').forEach(c => {
        document.cookie = c.trim().replace(/=.*/, '=;expires=' + new Date(0).toUTCString() + ';path=/');
      });
    } catch (_) {}

    // Przekieruj na stronę logowania
    window.location.replace('logowanie.html');
  }, true); // capture = true, by złapać klik w każdej warstwie (modal itp.)

  // Pokazywanie / ukrywanie elementów zależnie od stanu logowania
  const hasToken = !!auth.get();
  document.querySelectorAll('[data-auth="in"]').forEach(el => {
    el.style.display = hasToken ? '' : 'none';
  });
  document.querySelectorAll('[data-auth="out"]').forEach(el => {
    el.style.display = hasToken ? 'none' : '';
  });

  // Powitanie użytkownika w navbarze
  const userNameEl = document.getElementById('userName');
  if (userNameEl) {
    try {
      let user = null;
      const userStr = localStorage.getItem('cm_user');
      if (userStr) {
        user = JSON.parse(userStr);
      } else {
        const token = auth.get();
        const fromToken = token ? buildUserFromToken(token) : null;
        if (fromToken) {
          user = fromToken;
          localStorage.setItem('cm_user', JSON.stringify(user));
        }
      }

      if (user && (user.username || user.name)) {
        const full = user.username || user.name;
        const firstName = full.trim().split(' ')[0]; // np. "Jan Kowalski" → "Jan"
        userNameEl.textContent = firstName;
      } else {
        userNameEl.textContent = '';
      }
    } catch {
      userNameEl.textContent = '';
    }
  }
}

/* ========== Start ========== */
document.addEventListener('DOMContentLoaded', () => {
  initRegisterForm();
  initLoginForm();
  initAuthUI();
});
