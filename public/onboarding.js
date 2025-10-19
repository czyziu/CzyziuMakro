// public/onboarding.js
// public/onboarding.js
(function () {
  let token = null;
  try { token = localStorage.getItem('cm_token'); } catch {}
  if (!token) return;

  // === helpery JWT i klucze per-user ===
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
  const payload = decodeJWT(token) || {};
  const uid = String(
    payload.userId || payload.sub || payload.id || (payload.user && (payload.user._id || payload.user.id)) || ''
  );
  if (!uid) return; // brak id — nie działamy

  // Namespacing kluczy po użytkowniku
  const K = (suffix) => `cm_${uid}_${suffix}`;
  const KEY_SETUP = K('profile_setup');
  const KEY_PROFILE = K('profile');

  // WYTNij starą globalną flagę (mogła zostać po poprzednim userze)
  try { localStorage.removeItem('cm_profile_setup'); } catch {}

  const backdrop = document.getElementById('onbBackdrop');
  const modal = document.getElementById('onbModal');
  const form = document.getElementById('onbForm');
  const submitBtn = document.getElementById('onbSubmit');

  if (!backdrop || !modal || !form || !submitBtn) return;

  // ✅ twardy bezpiecznik: jeśli ten KONKRETNY user ma już setup, to ucinamy modal
  try {
    if (localStorage.getItem(KEY_SETUP) === 'true') {
      modal.hidden = true;
      backdrop.hidden = true;
      modal.style.display = 'none';
      backdrop.style.display = 'none';
      document.body.style.overflow = '';
      return;
    }
  } catch {}

  function openModal() {
    modal.hidden = false;
    backdrop.hidden = false;
    modal.style.display = '';
    backdrop.style.display = '';
    document.body.style.overflow = 'hidden';
    const first = form.querySelector('input, select');
    first && first.focus();
  }
  function closeModal() {
    modal.hidden = true;
    backdrop.hidden = true;
    modal.style.display = 'none';
    backdrop.style.display = 'none';
    document.body.style.overflow = '';
  }



  function isValid() {
    const fd = new FormData(form);
    const age = Math.floor(Number(fd.get('age')));
    const weight = Number(fd.get('weight'));
    const activity = Number(fd.get('activity'));
    const sex = String(fd.get('sex') || '');
    const level = String(fd.get('level') || '');

    return (
      Number.isFinite(age) && age >= 18 && age <= 120 &&
      Number.isFinite(weight) && weight >= 20 && weight <= 400 &&
      [1,2,3,4,5].includes(activity) &&
      (sex === 'F' || sex === 'M') &&
      (level === 'basic' || level === 'advanced')
    );
  }

  function updateSubmitState() {
    submitBtn.disabled = !isValid();
  }

  // brak możliwości pominięcia
  document.addEventListener('keydown', (ev) => {
    if (!modal.hidden && ev.key === 'Escape') {
      ev.preventDefault();
      ev.stopPropagation();
    }
  });
  backdrop.addEventListener('click', (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
  });

  document.addEventListener('DOMContentLoaded', () => {
    form.addEventListener('input', updateSubmitState);
    form.addEventListener('change', updateSubmitState);
    updateSubmitState();
  });

  // 1) pokaż modal tylko jeśli profil nieukończony
(async function checkStatus() {
  const localFlag = (localStorage.getItem(KEY_SETUP) === 'true'); // <= per-user flaga
  if (localFlag) return;
  try {
    const res = await fetch('/api/profile/status', {
      method: 'GET',
      headers: { 'Accept': 'application/json', 'Authorization': 'Bearer ' + token }
    });
    if (res.ok) {
      const data = await res.json();
      if (data && data.completed === true) {
        localStorage.setItem(KEY_SETUP, 'true');
        if (data.profile) localStorage.setItem(KEY_PROFILE, JSON.stringify(data.profile));
        return;
      }
      openModal();
    } else {
      if (!localFlag) openModal();
    }
  } catch {
    if (!localFlag) openModal();
  }
})();

  // 2) zapis do bazy (obowiązkowy)
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!isValid()) {
      alert('Uzupełnij poprawnie wszystkie pola.');
      return;
    }

    submitBtn.disabled = true;

    const fd = new FormData(form);
    const profile = {
      age: Math.floor(Number(fd.get('age'))),
      weight: Number(fd.get('weight')),
      activity: Number(fd.get('activity')),
      sex: String(fd.get('sex')),
      level: String(fd.get('level')),
      ts: Date.now()
    };

    try {
      const res = await fetch('/api/profile/onboarding', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'Authorization': 'Bearer ' + token
        },
        body: JSON.stringify(profile)
      });

      if (!res.ok) {
        let msg = 'Nie udało się zapisać. Spróbuj ponownie.';
        try {
          const j = await res.json();
          if (j && j.message) msg = j.message;
        } catch {}
        alert(msg);
        submitBtn.disabled = false;
        return;
      }

localStorage.setItem(KEY_PROFILE, JSON.stringify(profile));
localStorage.setItem(KEY_SETUP, 'true');
location.reload();

// Dla pełnej pewności: po zapisie odśwież stronę, żeby nic już nie zainicjowało modala
location.reload();
    } catch {
      alert('Błąd połączenia z serwerem. Spróbuj ponownie.');
      submitBtn.disabled = false;
    }
  });
})();
