(function () {
  // ====== TOKEN & HELPERS ======
  const TOKEN_KEYS = ['cm_token', 'token', 'authToken', 'jwt'];
  const findToken = () =>
    TOKEN_KEYS.map(k => localStorage.getItem(k) || sessionStorage.getItem(k)).find(Boolean);

  const $  = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  // Tolerancja różnicy między kaloriami a wyliczeniem z makro:
  // akceptuj różnicę do max(25 kcal, 2% celu)
  const TOL_KCAL_ABS = 25;
  const TOL_KCAL_PCT = 0.02;

  let serverValues = null;

  async function getJSON(url, token) {
    const res = await fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
    if (res.status === 401) throw new Error('unauth');
    if (!res.ok) throw new Error(`http_${res.status}`);
    return res.json();
  }

  // ====== UI: hint pod polem "Kalorie" ======
  function ensureKcalHint() {
    let hint = $('#kcalHint');
    if (hint) return hint;
    const caloriesRow = $('#calories')?.closest('.form-row') || $('#calories')?.parentElement || document.body;
    hint = document.createElement('div');
    hint.id = 'kcalHint';
    hint.className = 'small-note';
    hint.style.marginTop = '6px';
    caloriesRow.appendChild(hint);
    return hint;
  }

  function parseNum(el) {
    const v = Number(String(el?.value ?? '').replace(',', '.'));
    return Number.isFinite(v) ? v : NaN;
  }

  function kcalFromMacros(p, f, c) {
    const kcalP = 4 * p;
    const kcalF = 9 * f;
    const kcalC = 4 * c;
    const total = kcalP + kcalF + kcalC;
    return { total, kcalP, kcalF, kcalC };
  }

  function format1(x) { return Math.round(x); }

  // ====== WALIDACJA I PODPOWIEDZI ======
  function validateMacros(showReport = false) {
    const caloriesEl = $('#calories');
    const proteinEl  = $('#protein');
    const fatEl      = $('#fat');
    const carbsEl    = $('#carbs');
    const submitBtn  = $('#goalsForm button[type="submit"], #saveGoals');

    const kcalTarget = parseNum(caloriesEl);
    const p = parseNum(proteinEl);
    const f = parseNum(fatEl);
    const c = parseNum(carbsEl);

    const hint = ensureKcalHint();

    // Nie wszystkie pola są uzupełnione — pokaż neutralny stan
    if (![kcalTarget, p, f, c].every(Number.isFinite)) {
      caloriesEl?.setCustomValidity('');
      if (submitBtn) submitBtn.disabled = false;
      if (hint) hint.textContent = 'Uzupełnij wszystkie pola, aby sprawdzić zgodność.';
      return { ok: true, diff: 0 };
    }

    const { total, kcalP, kcalF, kcalC } = kcalFromMacros(p, f, c);
    const diff = total - kcalTarget; // +: makro > cel kcal | -: makro < cel kcal
    const tol = Math.max(TOL_KCAL_ABS, Math.abs(kcalTarget) * TOL_KCAL_PCT);
    const ok = Math.abs(diff) <= tol;

    const kcalAbs = Math.abs(diff);
    const gPC = Math.round(kcalAbs / 4); // białko/węgle (4 kcal/g)
    const gF  = Math.round(kcalAbs / 9); // tłuszcz (9 kcal/g)

    // Buduj sugestie co zrobić (konkretne komunikaty)
    let whatToDo = '';
    if (!ok) {
      // A: zmień "Kalorie" do sumy z makro
      const actCals = diff > 0
        ? `Odejmij ${format1(kcalAbs)} kcal w polu \u201EKalorie\u201D (ustaw ${format1(total)}).`
        : `Dodaj ${format1(kcalAbs)} kcal w polu \u201EKalorie\u201D (ustaw ${format1(total)}).`;

      // B: zostaw "Kalorie", skoryguj makro (pierwsza propozycja na białku)
      const actMacros = diff > 0
        ? `Albo odejmij ~${gPC} g białka (lub ~${gPC} g węgli, ~${gF} g tłuszczu).`
        : `Albo dodaj ~${gPC} g białka (lub ~${gPC} g węgli, ~${gF} g tłuszczu).`;

      whatToDo = `${actCals} ${actMacros}`;
    }

    // Komunikat pod polem
    if (hint) {
      hint.innerHTML =
        `Z makro wychodzi <strong>${format1(total)} kcal</strong> ` +
        `(B: ${format1(kcalP)} • T: ${format1(kcalF)} • W: ${format1(kcalC)}). ` +
        `Różnica: <strong>${diff > 0 ? '+' : ''}${format1(diff)} kcal</strong> ` +
        `(tolerancja ±${format1(tol)} kcal).` +
        (!ok ? `<br><strong>Co zrobić:</strong> ${whatToDo}` : '');
      hint.style.color = ok ? 'inherit' : 'var(--danger, #c0392b)';
    }

    // A11y + blokada submitu + dymek walidacyjny
    [caloriesEl, proteinEl, fatEl, carbsEl].forEach(el => el?.setAttribute('aria-invalid', String(!ok)));
    caloriesEl?.setCustomValidity(
      ok ? '' :
      `Kalorie nie zgadzają się z makro. ${diff > 0 ? 'Zbyt dużo kcal z makro.' : 'Za mało kcal z makro.'} ${whatToDo}`
    );
    if (submitBtn) submitBtn.disabled = !ok;

    if (!ok && showReport) caloriesEl?.reportValidity();

    return { ok, diff };
  }

  function wireValidation() {
    // Reaktywne przeliczanie przy każdej zmianie pól
    $$('#calories, #protein, #fat, #carbs').forEach(el => {
      el.addEventListener('input', () => validateMacros(false));
      el.addEventListener('change', () => validateMacros(false));
    });
    // Pierwsze przeliczenie po załadowaniu
    validateMacros(false);
  }

  // ====== INIT (GET ostatnich makr i podstawienie) ======
  async function init() {
    const token = findToken();
    if (!token) return (window.location.href = 'logowanie.html');

    // 1) Status profilu (onboarding)
    try {
      const status = await getJSON('/api/profile/status', token);
      if (!status?.completed) {
        return; // onboarding załatwia resztę
      }
    } catch (e) {
      if (String(e.message).includes('unauth')) return (window.location.href = 'logowanie.html');
      console.warn('Nie udało się pobrać statusu profilu:', e);
    }

    // 2) Ostatnie makro -> wstaw w pola
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
        if ($('#calories')) $('#calories').value = serverValues.calories;
        if ($('#protein'))  $('#protein').value  = serverValues.protein;
        if ($('#fat'))      $('#fat').value      = serverValues.fat;
        if ($('#carbs'))    $('#carbs').value    = serverValues.carbs;
        validateMacros(false);
      }
    } catch (err) {
      if (String(err.message).startsWith('http_404')) {
        console.info('Brak zapisanych makr — pozostawiamy pola puste.');
      } else {
        console.error('Błąd pobierania makr:', err);
      }
    }
  }

  // ====== FORM: reset + submit ======
  function wireForm() {
    const form = $('#goalsForm');
    const resetBtn = $('#resetGoals');

    if (form) {
      form.addEventListener('submit', async (e) => {
        e.preventDefault();

        const { ok } = validateMacros(true);
        if (!ok) return; // zablokuj wysyłkę przy niezgodności

        const token = findToken();
        const payload = {
          kcal: Number($('#calories').value),
          protein_g: Number($('#protein').value),
          fat_g: Number($('#fat').value),
          carbs_g: Number($('#carbs').value),
        };

        try {
          const res = await fetch('/api/profile/macro', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...(token ? { Authorization: `Bearer ${token}` } : {})
            },
            body: JSON.stringify(payload)
          });

          if (!res.ok) {
            const { message } = await res.json().catch(() => ({ message: 'Błąd zapisu' }));
            alert(message || 'Błąd zapisu');
            return;
          }

          const data = await res.json();
          serverValues = {
            calories: data.macro.kcal,
            protein: data.macro.protein_g,
            fat: data.macro.fat_g,
            carbs: data.macro.carbs_g
          };
          alert('Cele zapisane ✅');
        } catch (err) {
          console.error('POST /api/profile/macro error', err);
          alert('Błąd sieci. Spróbuj ponownie.');
        }
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
        validateMacros(false);
      });
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    wireForm();
    wireValidation();
    init();
  });
})();