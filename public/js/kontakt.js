// ./js/kontakt.js

document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('contact-form');
  const statusEl = document.getElementById('contact-status');
  const nameInput = document.getElementById('name');
  const emailInput = document.getElementById('email');
  const userNameSpan = document.getElementById('userName'); // z headera (Cześć, X!)
  if (!form) return;

  // ==========================
  //  AUTOFILL ZALOGOWANEGO UŻYTKOWNIKA
  // ==========================
  try {
    const userStr = localStorage.getItem('cm_user');
    if (userStr) {
      const user = JSON.parse(userStr);

      // Imię i nazwisko
      const fullName =
        (user && (user.name || user.username)) ||
        '';

      if (fullName && nameInput && !nameInput.value) {
        nameInput.value = fullName;
      }

      // E-mail
      if (user && user.email && emailInput && !emailInput.value) {
        emailInput.value = user.email;
      }
    }
  } catch (e) {
    console.warn('Nie udało się odczytać cm_user z localStorage:', e);
  }

  // Dodatkowo: jeśli app.js ustawił już greeting w headerze,
  // to możemy z tego wziąć imię, gdyby localStorage był pusty.
  if (userNameSpan && nameInput && !nameInput.value) {
    const headerName = (userNameSpan.textContent || '').trim();
    if (headerName) {
      nameInput.value = headerName;
    }
  }

  // ==========================
  //  WYSYŁKA FORMULARZA
  // ==========================

  form.addEventListener('submit', async (event) => {
    event.preventDefault();

    // Walidacja HTML5
    if (!form.checkValidity()) {
      form.reportValidity();
      return;
    }

    if (statusEl) {
      statusEl.textContent = 'Wysyłam wiadomość...';
    }

    const payload = {
      name: form.name.value.trim(),
      email: form.email.value.trim(),
      subject: form.subject.value.trim(),
      message: form.message.value.trim(),
      consent: form.consent.checked,
    };

    try {
      const response = await fetch('/api/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        console.error('Błąd odpowiedzi serwera:', response.status);
        throw new Error('Błąd odpowiedzi serwera');
      }

      const body = await response.json();

      if (body && body.ok) {
        if (statusEl) {
          statusEl.textContent = 'Wiadomość została wysłana. Dzięki za kontakt!';
        }
        form.reset();

        // Po resecie spróbuj ponownie uzupełnić dane usera
        try {
          const userStr = localStorage.getItem('cm_user');
          if (userStr) {
            const user = JSON.parse(userStr);
            const fullName =
              (user && (user.name || user.username)) ||
              '';

            if (fullName && nameInput) {
              nameInput.value = fullName;
            }
            if (user && user.email && emailInput) {
              emailInput.value = user.email;
            }
          }
        } catch {}
      } else {
        if (statusEl) {
          statusEl.textContent =
            'Nie udało się wysłać wiadomości. Spróbuj ponownie później.';
        }
      }
    } catch (error) {
      console.error('Błąd podczas wysyłki formularza kontaktowego:', error);
      if (statusEl) {
        statusEl.textContent =
          'Wystąpił błąd połączenia lub serwera. Spróbuj ponownie później.';
      }
    }
  });
});
