(function () {
  const TOKEN_KEYS = ['cm_token', 'token', 'authToken', 'jwt'];
  const findToken = () =>
    TOKEN_KEYS.map(k => localStorage.getItem(k) || sessionStorage.getItem(k)).find(Boolean);

  const $ = (sel) => document.querySelector(sel);
  let serverValues = null;

  async function getJSON(url, token) {
    const res = await fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
    if (res.status === 401) throw new Error('unauth');
    if (!res.ok) throw new Error(`http_${res.status}`);
    return res.json();
  }

  async function init() {
    const token = findToken();
    if (!token) return (window.location.href = 'logowanie.html');

    // 1) Czy profil kompletny?
    try {
      const status = await getJSON('/api/profile/status', token); // completed + profil core
      if (!status?.completed) {
        // Onboarding modalem zajmuje się Twój onboarding.js, my tylko nie kontynuujemy
        return;
      }
    } catch (e) {
      if (String(e.message).includes('unauth')) return (window.location.href = 'logowanie.html');
      console.warn('Nie udało się pobrać statusu profilu:', e);
      // mimo wszystko spróbujmy makra
    }

    // 2) Pobierz ostatnie makro i wstaw do pól
    try {
      const data = await getJSON('/api/profile/macro/latest', token);
      const m = data?.macro;
      if (m) {
        serverValues = {
          calories: m.kcal,
          protein: m.protein_g,
          fat: m.fat_g,
          carbs: m.carbs_g
        };
        $('#calories') && ($('#calories').value = serverValues.calories);
        $('#protein')  && ($('#protein').value  = serverValues.protein);
        $('#fat')      && ($('#fat').value      = serverValues.fat);
        $('#carbs')    && ($('#carbs').value    = serverValues.carbs);
      }
    } catch (err) {
      if (String(err.message).startsWith('http_404')) {
        console.info('Brak zapisanych makr — pozostawiamy pola puste.');
      } else {
        console.error('Błąd pobierania makr:', err);
      }
    }
  }

  function wireForm() {
    const form = $('#goalsForm');
    const resetBtn = $('#resetGoals');

    if (form) {
      form.addEventListener('submit', (e) => {
        e.preventDefault(); // na razie bez wysyłki
        alert('Na razie nie zapisujemy — wczytywanie działa.');
      });
    }
    if (resetBtn) {
      resetBtn.addEventListener('click', () => {
        if (serverValues) {
          $('#calories').value = serverValues.calories ?? '';
          $('#protein').value  = serverValues.protein  ?? '';
          $('#fat').value      = serverValues.fat      ?? '';
          $('#carbs').value    = serverValues.carbs    ?? '';
        } else {
          form?.reset();
        }
      });
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    wireForm();
    init();
  });
})();
