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

  // usuń starą globalną flagę (po poprzednim userze)
  try { localStorage.removeItem('cm_profile_setup'); } catch {}

  const backdrop  = document.getElementById('onbBackdrop');
  const modal     = document.getElementById('onbModal');
  const form      = document.getElementById('onbForm');
  const submitBtn = document.getElementById('onbSubmit');
  if (!backdrop || !modal || !form || !submitBtn) return;

  // ✅ jeśli ten user ma już setup, schowaj modal
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

  // —————————————————————————————
  //  Warstwa BLUR widoczna zawsze (tworzona do sterowania)
  // —————————————————————————————
  const blurLayer = document.createElement('div');
  blurLayer.id = 'cm-submit-blur';
  Object.assign(blurLayer.style, {
    position: 'fixed',
    inset: '0',
    backdropFilter: 'blur(8px)',
    WebkitBackdropFilter: 'blur(8px)',
    background: 'rgba(0,0,0,0.35)',
    zIndex: '950',            // nad tłem, pod modalem (który ma 1000)
    pointerEvents: 'none',    // nie blokuje kliku — blokadę robi modal
    display: 'none'
  });
  document.body.appendChild(blurLayer);

  function setBlur(active) {
    // klasa jako dodatkowy fallback (masz już style.css)
    document.body.classList.toggle('blur-active', !!active);
    blurLayer.style.display = active ? 'block' : 'none';
  }
  window.addEventListener('beforeunload', () => setBlur(false));

  function openModal() {
    modal.hidden = false;
    backdrop.hidden = false;
    modal.style.display = '';
    backdrop.style.display = '';
    document.body.style.overflow = 'hidden';
    document.documentElement.classList.add('modal-open');
    const first = form.querySelector('input, select');
    first && first.focus();

    // WŁĄCZ rozmycie gdy modal jest otwarty — to realizuje Twoje życzenie:
    setBlur(true);
  }
  function closeModal() {
    modal.hidden = true;
    backdrop.hidden = true;
    modal.style.display = 'none';
    backdrop.style.display = 'none';
    document.body.style.overflow = '';
    document.documentElement.classList.remove('modal-open');

    // ZAWSZE wyłącz blur przy zamknięciu modału
    setBlur(false);
  }

  // Auto-otwarcie modału i blur jeśli profil nie skonfigurowany:
  // (wcześniej było zakomentowane openModal(); — teraz otwieramy modal
  // i rozmazywujemy stronę do momentu wypełnienia formularza)
  openModal();

  // ============ Walidacja ============
  function validateForm() {
    const fd = new FormData(form);

    const age      = Math.floor(Number(fd.get('age')));
    const weight   = Number(String(fd.get('weight') || '').replace(',', '.'));
    const height   = Number(String(fd.get('height') || '').replace(',', '.'));
    const activity = Number(fd.get('activity'));
    const sex      = String(fd.get('sex') || '');
    const level    = String(fd.get('level') || '');
    const goal     = String(fd.get('goal') || '');

    if (!Number.isFinite(age) || age < 18 || age > 120)
      return { ok: false, message: 'Podaj wiek w zakresie 18–120 lat.' };
    if (!Number.isFinite(weight) || weight < 20 || weight > 400)
      return { ok: false, message: 'Podaj wagę w zakresie 20–400 kg.' };
    if (!Number.isFinite(height) || height < 100 || height > 250)
      return { ok: false, message: 'Podaj wzrost w zakresie 100–250 cm.' };
    if (![1,2,3,4,5].includes(activity))
      return { ok: false, message: 'Wybierz poziom aktywności (1–5).' };
    if (!(sex === 'F' || sex === 'M'))
      return { ok: false, message: 'Zaznacz płeć.' };
    if (!(level === 'basic' || level === 'advanced'))
      return { ok: false, message: 'Wybierz poziom użytkownika.' };
    if (!(goal === 'loss' || goal === 'maintain' || goal === 'gain'))
      return { ok: false, message: 'Wybierz cel (schudnąć / utrzymać / przytyć).' };

    return { ok: true, data: { age, weight, height, activity, sex, level, goal, ts: Date.now() } };
  }

  // pseudo-disabled (klasa, nie .disabled)
  function updateSubmitState() {
    const ok = validateForm().ok;
    submitBtn.classList.toggle('is-disabled', !ok);
    submitBtn.setAttribute('aria-disabled', String(!ok));
  }
  form.addEventListener('input',  updateSubmitState);
  form.addEventListener('change', updateSubmitState);
  updateSubmitState();

  // ============ Submit ============
  let isSubmitting = false;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const validation = validateForm();
    if (!validation.ok) {
      alert(validation.message);
      setBlur(true); // upewnij się, że blur jest włączony gdy wystąpi błąd walidacji
      return;
    }
    if (isSubmitting) return; // anty-dubel

    isSubmitting = true;
    submitBtn.classList.add('is-disabled');
    submitBtn.setAttribute('aria-disabled', 'true');

    // Wyłączamy rozmycie **na czas wysyłki** tak jak chciałeś:
    // (użytkownik wysyła formularz -> strona ma być "normalna")
    setBlur(false);

    const profile = validation.data;

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
        isSubmitting = false;
        updateSubmitState();

        // Przy błędzie przywróć blur (user wraca do modału i edycji)
        setBlur(true);
        return;
      }

      // profil zwrócony z backendu (jeśli jest)
      let saved = null;
      try { const j = await res.json(); saved = j && j.profile ? j.profile : null; } catch {}
      const toStore = saved || profile;

      localStorage.setItem(KEY_PROFILE, JSON.stringify(toStore));
      localStorage.setItem(KEY_SETUP, 'true');

      // zamknij modal (closeModal wyłączy blur) i zrób reload strony
      closeModal();

      location.reload();
    } catch {
      alert('Błąd połączenia z serwerem. Spróbuj ponownie.');
      isSubmitting = false;
      updateSubmitState();

      // przy błędzie sieci przywróć blur
      setBlur(true);
    }
  });
})();
