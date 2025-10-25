// /public/parametry.js — prefill + submit formularza "Zmień parametry" (front-end, bez module.exports)
(function () {
  // ---------- token / klucze zgodne z onboarding.js ----------
  function b64urlDecode(str) {
    try {
      str = String(str).replace(/-/g, '+').replace(/_/g, '/');
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
  function getToken() {
    try { return localStorage.getItem('cm_token') || ''; } catch { return ''; }
  }
  const token = getToken();
  const payload = decodeJWT(token) || {};
  const uid = String(
    payload.userId || payload.sub || payload.id || (payload.user && (payload.user._id || payload.user.id)) || ''
  );
  const K = (suffix) => (uid ? `cm_${uid}_${suffix}` : `cm_${suffix}`);
  const KEY_PROFILE = K('profile');
  const KEY_SETUP   = K('profile_setup');

  // ---------- DOM ----------
  document.addEventListener('DOMContentLoaded', () => {
    const form = document.getElementById('onbForm');
    const submitBtn = document.getElementById('onbSubmit');
    if (!form || !submitBtn) return;

    // Prefill z API -> fallback z localStorage
    prefillForm(form).finally(() => {
      // nic
    });

    form.addEventListener('submit', onSubmit);

    // prosta walidacja w locie (opcjonalnie)
    form.addEventListener('input',  () => submitBtn.classList.toggle('is-disabled', !validateForm(form).ok));
    form.addEventListener('change', () => submitBtn.classList.toggle('is-disabled', !validateForm(form).ok));
  });

  // ---------- Prefill ----------
  async function prefillForm(form) {
    // 1) Spróbuj z backendu (wymaga Authorization)
    if (token) {
      try {
        const res = await fetch('/api/profile/status', {
          headers: { 'Accept': 'application/json', 'Authorization': 'Bearer ' + token }
        });
        if (res.ok) {
          const data = await res.json();
          if (data && data.profile) {
            fill(form, data.profile);
            return;
          }
        }
      } catch (e) {
        console.warn('Prefill /status error:', e);
      }
    }
    // 2) Fallback z localStorage (to co zapisał onboarding.js po udanym POST)
    try {
      const cached = JSON.parse(localStorage.getItem(KEY_PROFILE) || 'null');
      if (cached) fill(form, cached);
    } catch {}
  }

  function fill(form, p) {
    if (!p) return;
    form.age.value    = p.age    ?? '';
    form.weight.value = p.weight ?? '';
    form.height.value = p.height ?? '';
    if (p.activity != null) form.activity.value = String(p.activity);
    if (p.goal)   form.goal.value = String(p.goal);
    if (p.sex) {
      const r = form.querySelector(`input[name="sex"][value="${p.sex}"]`);
      if (r) r.checked = true;
    }
    if (p.level) {
      const r = form.querySelector(`input[name="level"][value="${p.level}"]`);
      if (r) r.checked = true;
    }
  }

  // ---------- Submit ----------
  async function onSubmit(e) {
    e.preventDefault();
    const form = e.currentTarget;
    const check = validateForm(form);
    if (!check.ok) {
      alert(check.message);
      return;
    }
    if (!token) {
      alert('Brak tokenu – zaloguj się ponownie.');
      return;
    }
    const payload = check.data;

    try {
      const res = await fetch('/api/profile/onboarding', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'Authorization': 'Bearer ' + token
        },
        body: JSON.stringify(payload)
      });
      if (!res.ok) {
        let msg = 'Nie udało się zapisać.';
        try { const j = await res.json(); if (j?.message) msg = j.message; } catch {}
        alert(msg);
        return;
      }
      const j = await res.json().catch(() => ({}));
      const saved = j?.profile || payload;
      try {
        localStorage.setItem(KEY_PROFILE, JSON.stringify(saved));
        localStorage.setItem(KEY_SETUP, 'true');
      } catch {}
      alert('Zapisano!');
      // odśwież, żeby spiąć się z resztą UI
      location.reload();
    } catch (err) {
      console.error(err);
      alert('Błąd połączenia z serwerem.');
    }
  }

  // ---------- Walidacja ----------
  function validateForm(form) {
    const fd = new FormData(form);
    const num = (v) => Number(String(v ?? '').replace(',', '.'));
    const toInt = (v) => parseInt(String(v ?? '').trim(), 10);

    const data = {
      age: toInt(fd.get('age')),
      weight: num(fd.get('weight')),
      height: num(fd.get('height')),
      activity: toInt(fd.get('activity')),
      goal: String(fd.get('goal') || '').trim().toLowerCase(),
      sex: String(fd.get('sex') || '').trim().toUpperCase(),
      level: String(fd.get('level') || '').trim().toLowerCase(),
    };

    if (!Number.isFinite(data.age) || data.age < 18 || data.age > 120) return { ok:false, message:'Podaj wiek 18–120' };
    if (!Number.isFinite(data.weight) || data.weight < 20 || data.weight > 400) return { ok:false, message:'Waga 20–400 kg' };
    if (!Number.isFinite(data.height) || data.height < 100 || data.height > 250) return { ok:false, message:'Wzrost 100–250 cm' };
    if (![1,2,3,4,5].includes(data.activity)) return { ok:false, message:'Wybierz aktywność (1–5)' };
    if (!['F','M'].includes(data.sex)) return { ok:false, message:'Zaznacz płeć' };
    if (!['basic','advanced'].includes(data.level)) return { ok:false, message:'Wybierz poziom' };
    if (!['loss','maintain','gain'].includes(data.goal)) return { ok:false, message:'Wybierz cel' };

    return { ok:true, data };
  }
})();
