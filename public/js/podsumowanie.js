// public/js/podsumowanie.js
// Obsługa strony podsumowania: dzisiejsze makro, średnia z 7 dni + notatki z historią

document.addEventListener('DOMContentLoaded', () => {
  if (document.body.dataset.page !== 'podsumowanie') return;

  // ------------------- ELEMENTY Z DOM -------------------
  const kcalTodayEl = document.querySelector('[data-summary-kcal-today]');
  const kcalTargetEl = document.querySelector('[data-summary-kcal-target]');
  const proteinTodayEl = document.querySelector('[data-summary-protein-today]');
  const fatTodayEl = document.querySelector('[data-summary-fat-today]');
  const carbsTodayEl = document.querySelector('[data-summary-carbs-today]');

  const kcalWeekAvgEl = document.querySelector('[data-summary-kcal-week-avg]');
  const proteinWeekAvgEl = document.querySelector('[data-summary-protein-week-avg]');
  const fatWeekAvgEl = document.querySelector('[data-summary-fat-week-avg]');
  const carbsWeekAvgEl = document.querySelector('[data-summary-carbs-week-avg]');

  const notesEl = document.getElementById('summary-notes');
  const notesStatusEl = document.getElementById('summary-notes-status');
  const notesSaveBtn = document.getElementById('summary-notes-save');
  const notesListEl = document.getElementById('summary-notes-list');

  // ------------------- TOKEN / AUTH FETCH -------------------
  const TOKEN_KEYS = ['token', 'jwt', 'authToken', 'accessToken', 'cm_token'];

  function getToken() {
    try {
      for (const key of TOKEN_KEYS) {
        const val = localStorage.getItem(key);
        if (val) {
          console.log('[podsumowanie] używam tokenu z localStorage["' + key + '"]');
          return val;
        }
      }
    } catch (e) {
      console.warn('[podsumowanie] getToken error:', e);
    }
    console.warn('[podsumowanie] nie znaleziono tokenu w localStorage');
    return null;
  }

  async function authFetch(url, options = {}) {
    const token = getToken();
    const headers = Object.assign(
      { 'Content-Type': 'application/json' },
      options.headers || {},
    );

    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }

    const res = await fetch(url, { ...options, headers });

    if (res.status === 401 || res.status === 403) {
      throw new Error('Brak ważnego tokenu. Zaloguj się ponownie.');
    }

    return res;
  }

  // ------------------- RENDEROWANIE NOTATEK -------------------

  function formatDateTime(isoString) {
    if (!isoString) return '';
    const d = new Date(isoString);
    if (Number.isNaN(d.getTime())) return '';
    // prosto po PL: dd.mm.rrrr, gg:mm
    const pad = (x) => String(x).padStart(2, '0');
    const date = `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`;
    const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
    return `${date}, ${time}`;
  }

  function renderNotesList(notes) {
    if (!notesListEl) return;

    notesListEl.innerHTML = '';

    if (!notes || !notes.length) {
      const empty = document.createElement('p');
      empty.className = 'muted';
      empty.dataset.notesEmpty = 'true';
      empty.textContent = 'Nie masz jeszcze żadnych notatek. Zapisz pierwszą powyżej.';
      notesListEl.appendChild(empty);
      return;
    }

    notes.forEach((note) => {
      const item = document.createElement('article');
      item.className = 'note-item';

      const meta = document.createElement('div');
      meta.className = 'note-meta muted';
      meta.textContent = formatDateTime(note.createdAt);

      const textP = document.createElement('p');
      textP.className = 'note-text';
      textP.textContent = note.text;

      item.appendChild(meta);
      item.appendChild(textP);
      notesListEl.appendChild(item);
    });
  }

  // ------------------- NOTATKI: POBIERANIE + DODAWANIE -------------------

  async function loadNotes() {
    if (!notesListEl) return;

    try {
      const res = await authFetch('/api/summary/notes?limit=100', {
        method: 'GET',
      });

      if (!res.ok) {
        console.warn('GET /api/summary/notes status:', res.status);
        return;
      }

      const data = await res.json();
      renderNotesList(data.notes || []);
    } catch (e) {
      console.warn('loadNotes error:', e.message || e);
      if (notesStatusEl) {
        notesStatusEl.textContent =
          e.message === 'Brak ważnego tokenu. Zaloguj się ponownie.'
            ? 'Sesja wygasła. Zaloguj się ponownie.'
            : 'Nie udało się wczytać notatek.';
      }
    }
  }

  async function addNote() {
    if (!notesEl) return;

    const text = notesEl.value.trim();
    if (!text) {
      if (notesStatusEl) notesStatusEl.textContent = 'Wpisz treść notatki.';
      return;
    }

    if (notesStatusEl) notesStatusEl.textContent = 'Zapisuję notatkę...';

    try {
      const res = await authFetch('/api/summary/notes', {
        method: 'POST',
        body: JSON.stringify({ text }),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok || !data.ok || !data.note) {
        if (notesStatusEl) {
          notesStatusEl.textContent =
            data.message || 'Nie udało się zapisać notatki.';
        }
        return;
      }

      // wyczyść pole i odśwież listę
      notesEl.value = '';
      if (notesStatusEl) notesStatusEl.textContent = 'Zapisano notatkę.';

      // żeby nie ściągać wszystkiego od nowa, możesz dorzucić ją na początek:
      // ale dla prostoty – po prostu przeładuj listę:
      void loadNotes();
    } catch (e) {
      console.error('addNote error:', e);
      if (notesStatusEl) {
        notesStatusEl.textContent =
          e.message === 'Brak ważnego tokenu. Zaloguj się ponownie.'
            ? 'Sesja wygasła. Zaloguj się ponownie.'
            : 'Błąd podczas zapisu notatki.';
      }
    }
  }

  if (notesSaveBtn) {
    notesSaveBtn.addEventListener('click', () => {
      void addNote();
    });
  }

  // ------------------- MAKRO: DZIŚ + OSTATNIE 7 DNI -------------------

  async function loadMacroSummary() {
    // 1) Ostatnie makro z profilu (target kcal)
    try {
      const resMacro = await authFetch('/api/profile/macro/latest', {
        method: 'GET',
      });

      if (resMacro.ok) {
        const data = await resMacro.json();
        if (data && data.macro && kcalTargetEl) {
          const kcal = Number(data.macro.kcal || 0);
          kcalTargetEl.textContent = Math.round(kcal);
        }
      } else if (resMacro.status === 404) {
        console.info('[podsumowanie] Brak zapisanych makr dla użytkownika');
      }
    } catch (e) {
      console.warn('macro/latest error:', e.message || e);
    }

    // 2) Dane z kalendarza na bieżący tydzień
    try {
      const today = new Date();
      const todayIso = today.toISOString().slice(0, 10);

      const day = today.getDay(); // 0=nd, 1=pn...
      const diffToMonday = (day + 6) % 7;
      const monday = new Date(today);
      monday.setDate(today.getDate() - diffToMonday);
      const mondayIso = monday.toISOString().slice(0, 10);

      const resWeek = await authFetch(`/api/calendar/week?monday=${mondayIso}`, {
        method: 'GET',
      });

      if (!resWeek.ok) {
        console.warn('calendar/week status:', resWeek.status);
        return;
      }

      const dataWeek = await resWeek.json();
      const week = dataWeek.week || {};

      const dates = Object.keys(week);
      if (!dates.length) return;

      let sumK = 0, sumP = 0, sumF = 0, sumC = 0;
      let todayK = 0, todayP = 0, todayF = 0, todayC = 0;

      dates.forEach((date) => {
        const meals = week[date] || [];
        let dayK = 0, dayP = 0, dayF = 0, dayC = 0;

        meals.forEach((meal) => {
          (meal.items || []).forEach((it) => {
            const kcal = Number(it.kcal || 0);
            const protein = Number(it.protein || 0);
            const fat = Number(it.fat || 0);
            const carbs = Number(it.carbs || 0);

            dayK += kcal;
            dayP += protein;
            dayF += fat;
            dayC += carbs;
          });
        });

        sumK += dayK;
        sumP += dayP;
        sumF += dayF;
        sumC += dayC;

        if (date === todayIso) {
          todayK = dayK;
          todayP = dayP;
          todayF = dayF;
          todayC = dayC;
        }
      });

      const daysCount = dates.length || 7;
      const avgK = sumK / daysCount;
      const avgP = sumP / daysCount;
      const avgF = sumF / daysCount;
      const avgC = sumC / daysCount;

      if (kcalTodayEl) kcalTodayEl.textContent = Math.round(todayK);
      if (proteinTodayEl) proteinTodayEl.textContent = Math.round(todayP);
      if (fatTodayEl) fatTodayEl.textContent = Math.round(todayF);
      if (carbsTodayEl) carbsTodayEl.textContent = Math.round(todayC);

      if (kcalWeekAvgEl) kcalWeekAvgEl.textContent = Math.round(avgK);
      if (proteinWeekAvgEl) proteinWeekAvgEl.textContent = Math.round(avgP);
      if (fatWeekAvgEl) fatWeekAvgEl.textContent = Math.round(avgF);
      if (carbsWeekAvgEl) carbsWeekAvgEl.textContent = Math.round(avgC);
    } catch (e) {
      console.error('loadMacroSummary error:', e);
    }
  }

  // ------------------- START -------------------
  void loadNotes();
  void loadMacroSummary();
});
