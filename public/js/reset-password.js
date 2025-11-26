// public/js/reset-password.js

document.addEventListener('DOMContentLoaded', () => {
  const page = document.body.dataset.page;

  if (page === 'reset-hasla') {
    initForgotPassword();
  } else if (page === 'nowe-haslo') {
    initNewPassword();
  }
});

function initForgotPassword() {
  const form = document.getElementById('forgot-form');
  const statusEl = document.getElementById('forgot-status');
  if (!form) return;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    statusEl.textContent = '';

    const email = form.email.value.trim();

    if (!email) {
      statusEl.textContent = 'Podaj adres e-mail.';
      return;
    }

    try {
      const res = await fetch('/api/password/forgot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });

      const data = await res.json();

      if (!res.ok) {
        statusEl.textContent = data?.message || 'Błąd podczas wysyłania maila.';
        return;
      }

      statusEl.textContent =
        data?.message ||
        'Jeśli konto istnieje, wysłaliśmy instrukcję resetu hasła.';
      form.reset();
    } catch (err) {
      console.error(err);
      statusEl.textContent =
        'Wystąpił błąd połączenia. Spróbuj ponownie później.';
    }
  });
}

function initNewPassword() {
  const form = document.getElementById('new-password-form');
  const statusEl = document.getElementById('reset-status');
  if (!form) return;

  const params = new URLSearchParams(window.location.search);
  const token = params.get('token');

  if (!token) {
    statusEl.textContent =
      'Brak tokenu resetującego. Użyj linku, który dostałeś w e-mailu.';
    form.querySelector('button[type="submit"]').disabled = true;
    return;
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    statusEl.textContent = '';

    const password = form.password.value;
    const password2 = form.password2.value;

    if (!password || !password2) {
      statusEl.textContent = 'Uzupełnij oba pola z hasłem.';
      return;
    }
    if (password !== password2) {
      statusEl.textContent = 'Hasła muszą być takie same.';
      return;
    }

    try {
      const res = await fetch('/api/password/reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password }),
      });

      const data = await res.json();

      if (!res.ok) {
        statusEl.textContent =
          data?.message ||
          'Nie udało się ustawić nowego hasła. Link mógł wygasnąć.';
        return;
      }

      statusEl.textContent =
        'Hasło zostało zmienione. Możesz się teraz zalogować.';
      form.reset();
    } catch (err) {
      console.error(err);
      statusEl.textContent =
        'Wystąpił błąd połączenia. Spróbuj ponownie później.';
    }
  });
}
