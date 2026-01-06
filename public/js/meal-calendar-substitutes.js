// public/js/meal-calendar-substitutes.js
// Zamienniki produktów w kalendarzu (popup + podmiana pozycji)

document.addEventListener('DOMContentLoaded', () => {
  // działa na stronach, gdzie jest kalendarz (bez zależności od data-page)
  const isCalendarPage = document.getElementById('calendarGrid') && document.getElementById('calDays');
  if (!isCalendarPage) return;

  // ------------------- TOKEN / AUTH FETCH -------------------
  const TOKEN_KEYS = ['token', 'jwt', 'authToken', 'accessToken', 'cm_token'];

  function getToken() {
    try {
      for (const key of TOKEN_KEYS) {
        const val = localStorage.getItem(key);
        if (val) return val;
      }
    } catch (e) {
      console.warn('[substitutes] getToken error:', e);
    }
    return null;
  }

  async function authFetch(url, options = {}) {
    const token = getToken();
    const headers = Object.assign(
      { 'Content-Type': 'application/json' },
      options.headers || {},
    );

    if (token) headers.Authorization = `Bearer ${token}`;

    const res = await fetch(url, { ...options, headers });

    if (res.status === 401 || res.status === 403) {
      throw new Error('Brak ważnego tokenu. Zaloguj się ponownie.');
    }

    return res;
  }

  // ------------------- MODAL UI -------------------
  const IDS = {
    backdrop: 'subsBackdrop',
    modal: 'subsModal',
    body: 'subsBody',
    title: 'subsTitle',
    status: 'subsStatus',
  };

  function ensureModal() {
    let backdrop = document.getElementById(IDS.backdrop);
    let modal = document.getElementById(IDS.modal);

    if (backdrop && modal) {
      return { backdrop, modal };
    }

    backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    backdrop.id = IDS.backdrop;
    backdrop.hidden = true;

    modal = document.createElement('div');
    modal.className = 'modal';
    modal.id = IDS.modal;
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-labelledby', IDS.title);
    modal.hidden = true;

    modal.innerHTML = `
      <div class="modal-card">
        <header class="modal-header" style="display:flex;align-items:center;justify-content:space-between;gap:12px;">
          <h2 id="${IDS.title}" style="margin:0;">Zamienniki produktu</h2>
          <button type="button" class="btn secondary" data-action="subs-close" aria-label="Zamknij">Zamknij</button>
        </header>
        <p class="muted" id="${IDS.status}" style="margin-top:10px;"></p>
        <div id="${IDS.body}" style="display:grid;gap:10px;margin-top:10px;"></div>
      </div>
    `.trim();

    document.body.appendChild(backdrop);
    document.body.appendChild(modal);

    backdrop.addEventListener('click', closeModal);
    modal.addEventListener('click', (e) => {
      const closeBtn = e.target.closest('[data-action="subs-close"]');
      if (closeBtn) closeModal();
    });

    return { backdrop, modal };
  }

  function setStatus(text) {
    const el = document.getElementById(IDS.status);
    if (el) el.textContent = text || '';
  }

  function openModal() {
    const { backdrop, modal } = ensureModal();
    backdrop.hidden = false;
    modal.hidden = false;
  }

  function closeModal() {
    const backdrop = document.getElementById(IDS.backdrop);
    const modal = document.getElementById(IDS.modal);

    // usuń modal z DOM, żeby nie „zawisł” po re-renderze / ewentualnym przeładowaniu
    if (backdrop) backdrop.remove();
    if (modal) modal.remove();
  }

  function fmt1(x) {
    const n = Number(x);
    if (!Number.isFinite(n)) return '0';
    return String(Math.round(n * 10) / 10);
  }

  function renderOriginal(original) {
    const body = document.getElementById(IDS.body);
    if (!body) return;

    const card = document.createElement('div');
    card.className = 'card';
    card.style.padding = '10px';
    card.innerHTML = `
      <div style="display:flex;flex-wrap:wrap;gap:8px;align-items:baseline;">
        <strong>${escapeHtml(original.name || 'Produkt')}</strong>
        <span class="muted">${escapeHtml(original.category || '')}</span>
        <span class="muted">• ${fmt1(original.grams)} g</span>
      </div>
      <div class="muted" style="margin-top:6px;">
        ${fmt1(original.macros?.kcal)} kcal • B: ${fmt1(original.macros?.protein)} g • T: ${fmt1(original.macros?.fat)} g • W: ${fmt1(original.macros?.carbs)} g
      </div>
    `.trim();

    body.appendChild(card);
  }

  function renderSuggestionList(ctx, suggestions) {
    const body = document.getElementById(IDS.body);
    if (!body) return;

    if (!suggestions || !suggestions.length) {
      const p = document.createElement('p');
      p.className = 'muted';
      p.textContent = 'Brak sensownych zamienników w tej kategorii.';
      body.appendChild(p);
      return;
    }

    const list = document.createElement('div');
    list.style.display = 'grid';
    list.style.gap = '10px';

    suggestions.forEach((s) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn secondary';
      btn.style.textAlign = 'left';
      btn.dataset.action = 'subs-choose';
      btn.dataset.productId = s.productId;
      btn.dataset.grams = String(s.gramsSuggested || 0);

      btn.innerHTML = `
        <div style="display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;">
          <strong>${escapeHtml(s.name || 'Produkt')}</strong>
          <span class="muted">${fmt1(s.gramsSuggested)} g</span>
        </div>
        <div class="muted" style="margin-top:4px;">
          ${fmt1(s.macros?.kcal)} kcal • B: ${fmt1(s.macros?.protein)} g • T: ${fmt1(s.macros?.fat)} g • W: ${fmt1(s.macros?.carbs)} g
        </div>
      `.trim();

      btn.addEventListener('click', () => {
        void applyReplacement(ctx, s.productId, s.gramsSuggested);
      });

      list.appendChild(btn);
    });

    body.appendChild(list);
  }

  function escapeHtml(str) {
    return String(str ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  // ------------------- API FLOW -------------------
  async function openSubstitutesPopup(date, slot, itemId) {
    openModal();
    setStatus('Szukam zamienników...');

    const encodedSlot = encodeURIComponent(slot);

    try {
      const res = await authFetch(`/api/calendar/${date}/${encodedSlot}/items/${itemId}/substitutes?limit=5`, {
        method: 'GET',
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        setStatus(data.message || 'Nie udało się pobrać zamienników.');
        return;
      }

      const body = document.getElementById(IDS.body);
      if (body) body.innerHTML = '';

      renderOriginal(data.original || {});
      renderSuggestionList({ date, slot, itemId }, data.suggestions || []);

      setStatus('Kliknij produkt, żeby podmienić pozycję w kalendarzu.');
    } catch (e) {
      console.warn('[substitutes] open popup error:', e);
      setStatus(e?.message || 'Błąd podczas pobierania zamienników.');
    }
  }

  async function applyReplacement(ctx, productId, grams) {
    if (!ctx?.date || !ctx?.slot || !ctx?.itemId) return;

    setStatus('Podmieniam...');

    const encodedSlot = encodeURIComponent(ctx.slot);

    try {
      const res = await authFetch(`/api/calendar/${ctx.date}/${encodedSlot}/items/${ctx.itemId}/replace`, {
        method: 'PATCH',
        body: JSON.stringify({ productId, grams }),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok || !data.ok) {
        setStatus(data.message || 'Nie udało się podmienić pozycji.');
        return;
      }

      closeModal();

      // Odśwież kalendarz bez przeładowania całej strony.
      // Najpierw spróbuj bezpośrednio (jeśli rdzeń jest dostępny), potem eventem.
      if (window.CalendarCore && typeof window.CalendarCore.render === 'function') {
        window.CalendarCore.render();
      } else {
        const ev = new CustomEvent('cm:calendar:reload', { cancelable: true });
        window.dispatchEvent(ev);
      }
    } catch (e) {
      console.error('[substitutes] replace error:', e);
      setStatus(e?.message || 'Błąd podczas podmiany produktu.');
    }
  }

  // ------------------- CLICK HANDLER (delegacja) -------------------
  // Oczekiwany przycisk w itemie:
  // <button data-action="substitute-item" data-date="YYYY-MM-DD" data-slot="Śniadanie" data-item-id="...">Zamiennik</button>
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action="substitute-item"]');
    if (!btn) return;

    // Minimalnie: ustaw data-date, data-slot, data-item-id na przycisku.
    // Fallback: jeśli date/slot są na rodzicu (np. karta dnia/posiłku), spróbuj je podciągnąć z DOM.
    const date = btn.dataset.date
      || btn.closest('[data-date]')?.dataset.date
      || btn.closest('[data-day]')?.dataset.day
      || btn.closest('[data-iso]')?.dataset.iso;

    const slot = btn.dataset.slot
      || btn.closest('[data-slot]')?.dataset.slot;

    const itemId = btn.dataset.itemId
      || btn.getAttribute('data-item-id')
      || btn.closest('[data-item-id]')?.getAttribute('data-item-id');

    if (!date || !slot || !itemId) {
      console.warn('[substitutes] Brakuje data-date / data-slot / data-item-id na przycisku.');
      return;
    }

    void openSubstitutesPopup(date, slot, itemId);
  });
});
