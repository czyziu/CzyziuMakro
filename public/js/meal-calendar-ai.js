// public/js/meal-calendar-ai.js — AI panel z karuzelą wariantów + live update UI
(() => {
  // ───────── helpers ─────────
  const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ESC[c]);
  const toNum = (v) => Number(v || 0);
  const fmt = (x) => Math.round(Number(x || 0));
  const norm = (t) => String(t ?? '').normalize('NFD').replace(/\p{Diacritic}/gu,'').toLowerCase().trim();

  function authHeaders() {
    const token = localStorage.getItem('cm_token') || localStorage.getItem('token');
    const h = { 'Content-Type': 'application/json' };
    if (token) h['Authorization'] = `Bearer ${token}`;
    return h;
  }
  async function apiJson(url, opts = {}) {
    const res = await fetch(url, { ...opts, headers: { ...authHeaders(), ...(opts.headers || {}) } });
    if (!res.ok) {
      let msg = `HTTP ${res.status}`;
      try { const j = await res.json(); if (j?.message) msg = j.message; } catch {}
      throw new Error(msg);
    }
    return res.json();
  }
  async function apiAddItem(dateISO, slotName, { productId, grams }) {
    if (typeof window.apiAddItem === 'function') {
      return window.apiAddItem(dateISO, slotName, { productId, grams });
    }
    return apiJson(`/api/calendar/${dateISO}/${encodeURIComponent(slotName)}/items`, {
      method: 'POST',
      body: JSON.stringify({ productId, grams })
    });
  }

  // ───────── UI/DOM helpers ─────────
  function sumDayFromDOM(cardEl) {
    const acc = { kcal:0, p:0, f:0, c:0 };
    cardEl.querySelectorAll('[data-slot-total]')?.forEach(el => {
      acc.kcal += toNum(el.getAttribute('data-k') || el.dataset.k);
      acc.p    += toNum(el.getAttribute('data-p') || el.dataset.p);
      acc.f    += toNum(el.getAttribute('data-f') || el.dataset.f);
      acc.c    += toNum(el.getAttribute('data-c') || el.dataset.c);
    });
    return acc;
  }

  function resolveSlotName(panelEl){
    if (panelEl?.dataset?.slot && panelEl.dataset.slot !== 'DOWOLNY') return panelEl.dataset.slot;
    const open = panelEl?.closest('.day-card')?.querySelector('details.meal[open]');
    if (open?.dataset?.slot) return open.dataset.slot;
    const first = panelEl?.closest('.day-card')?.querySelector('details.meal');
    if (first?.dataset?.slot) return first.dataset.slot;
    return 'DOWOLNY';
  }

  // znajdź elementy UI dla slotu
  function findSlotUI(dayCard, slotName){
    const slotEl = dayCard?.querySelector(`details.meal[data-slot="${CSS.escape(slotName)}"]`) ||
                   dayCard?.querySelector('details.meal');
const totalEl = slotEl?.querySelector('[data-slot-total]');
const listEl =
  slotEl?.querySelector('.food-list') ||   // <<< DODANE — tak renderuje core
  slotEl?.querySelector('[data-slot-items]') ||
  slotEl?.querySelector('[data-items]') ||
  slotEl?.querySelector('.slot-items') ||
  slotEl?.querySelector('tbody') ||
  slotEl?.querySelector('ul,ol') ||
  slotEl?.querySelector('.items');

    return { slotEl, totalEl, listEl };
  }

  const fmtTotalsStr = (t) => `K:${fmt(t.kcal)} · B:${fmt(t.p)} · T:${fmt(t.f)} · W:${fmt(t.c)}`;

  function bumpSlotTotals(totalEl, delta){
    if (!totalEl || !delta) return;
    const k = toNum(totalEl.getAttribute('data-k') || totalEl.dataset.k);
    const p = toNum(totalEl.getAttribute('data-p') || totalEl.dataset.p);
    const f = toNum(totalEl.getAttribute('data-f') || totalEl.dataset.f);
    const c = toNum(totalEl.getAttribute('data-c') || totalEl.dataset.c);
    const n = { kcal: k + (delta.kcal||0), p: p + (delta.p||0), f: f + (delta.f||0), c: c + (delta.c||0) };
    totalEl.setAttribute('data-k', String(n.kcal)); totalEl.dataset.k = String(n.kcal);
    totalEl.setAttribute('data-p', String(n.p));    totalEl.dataset.p = String(n.p);
    totalEl.setAttribute('data-f', String(n.f));    totalEl.dataset.f = String(n.f);
    totalEl.setAttribute('data-c', String(n.c));    totalEl.dataset.c = String(n.c);
    const txt = (totalEl.textContent || '').trim();
    if (/^K:\s*\d+/i.test(txt) || txt === '' ) totalEl.textContent = fmtTotalsStr(n);
  }

  // jeden item jako node — wspiera <tbody>, <ul>/<ol>, <div>
  function buildItemNode(listEl, { name, grams }){
    const tag = (listEl?.tagName || '').toUpperCase();
    if (tag === 'TBODY') {
      const tr = document.createElement('tr');
      tr.className = 'slot-item ai-added';
      tr.setAttribute('data-temp','1');
      const tdName  = document.createElement('td'); tdName.className='name';  tdName.textContent = name || 'Produkt';
      const tdGrams = document.createElement('td'); tdGrams.className='grams'; tdGrams.textContent = `${fmt(grams)} g`;
      tr.appendChild(tdName); tr.appendChild(tdGrams);
      return tr;
    }
    const isList = /^UL|OL$/.test(tag);
    const el = document.createElement(isList ? 'li' : 'div');
    el.className = 'slot-item ai-added';
    el.setAttribute('data-temp','1');
    el.innerHTML = `<span class="name">${esc(name||'Produkt')}</span> <span class="grams">${fmt(grams)} g</span>`;
    return el;
  }

  function appendItemsToList(listEl, items){
    if (!listEl || !Array.isArray(items)) return;
    for (const it of items) listEl.appendChild(buildItemNode(listEl, it));
  }

  // dzienny header (jeśli istnieje)
  function updateDayHeaderTotals(dayCard){
    const t = sumDayFromDOM(dayCard);
    const dayTotalEl = dayCard?.querySelector('[data-day-total]') || dayCard?.querySelector('.day-total');
    if (!dayTotalEl) return;
    dayTotalEl.setAttribute('data-k', String(t.kcal)); dayTotalEl.dataset.k = String(t.kcal);
    dayTotalEl.setAttribute('data-p', String(t.p));    dayTotalEl.dataset.p = String(t.p);
    dayTotalEl.setAttribute('data-f', String(t.f));    dayTotalEl.dataset.f = String(t.f);
    dayTotalEl.setAttribute('data-c', String(t.c));    dayTotalEl.dataset.c = String(t.c);
    const txt = (dayTotalEl.textContent || '').trim();
    if (/^K:\s*\d+/i.test(txt) || txt === '') dayTotalEl.textContent = fmtTotalsStr(t);
  }

  // opcjonalny pull z backendu (jeśli masz endpoint GET /api/calendar/{date}/{slot})
  async function refreshSlotFromServer(dayISO, slotName, dayCard){
    try{
      const data = await apiJson(`/api/calendar/${dayISO}/${encodeURIComponent(slotName)}`);
      const { totalEl, listEl } = findSlotUI(dayCard, slotName);
      if (Array.isArray(data?.items) && listEl){
        listEl.innerHTML = '';
        for (const it of data.items){
          const name = it.name || it.product?.name || 'Produkt';
          appendItemsToList(listEl, [{ name, grams: it.grams }]);
        }
      }
      if (data?.totals && totalEl){
        totalEl.setAttribute('data-k', String(data.totals.kcal));
        totalEl.setAttribute('data-p', String(data.totals.p));
        totalEl.setAttribute('data-f', String(data.totals.f));
        totalEl.setAttribute('data-c', String(data.totals.c));
        totalEl.dataset.k = String(data.totals.kcal);
        totalEl.dataset.p = String(data.totals.p);
        totalEl.dataset.f = String(data.totals.f);
        totalEl.dataset.c = String(data.totals.c);
        totalEl.textContent = fmtTotalsStr(data.totals);
      }
      updateDayHeaderTotals(dayCard);
    }catch{
      // jeżeli nie masz takiego endpointu — trudno, UI i tak jest już zaktualizowane lokalnie
    }
  }

  // broadcast dla innych części appki
  function notifyItemsAdded({ dayISO, slotName, items }){
    document.dispatchEvent(new CustomEvent('calendar:items-added', {
      detail: { dayISO, slotName, items }
    }));
    if (typeof window.refreshCalendarDay === 'function') {
      window.refreshCalendarDay(dayISO); // jeśli masz swój hook — dociągnij serwerowy stan
    }
  }

  // ───────── wstrzyknij panel AI do slotów ─────────
  function ensureAiPanelsInMeals() {
    document.querySelectorAll('.day-card details.meal').forEach(det => {
      const panelWrap = det.querySelector('[data-add-panel]');
      if (!panelWrap || panelWrap.querySelector('[data-panel="ai"]')) return;

      const inner = document.createElement('div');
      inner.className = 'add-panel-inner';
      inner.setAttribute('data-panel', 'ai');
      inner.hidden = true;
      inner.innerHTML = `
        <div class="ai-panel" data-ai-panel data-slot="${det.dataset.slot || 'DOWOLNY'}">
          <div class="row">
            <textarea name="ai-prompt" rows="3" placeholder="np. ~600 kcal, bez indyka"></textarea>
          </div>
          <div class="add-actions" style="margin:.25rem 0">
            <button class="btn-small primary" data-ai-suggest type="button">Zapytaj AI</button>
          </div>
          <div class="ai-results" data-ai-results></div>
          <div class="ai-recipe" data-ai-recipe></div>
        </div>
      `;
      panelWrap.appendChild(inner);
    });
  }

  // ───────── delegowany handler: „Zapytaj AI” ─────────
  document.addEventListener('click', async (ev) => {
    const t = ev.target;
    if (!(t instanceof HTMLElement) || !t.matches('[data-ai-suggest]')) return;

    const panel = t.closest('[data-ai-panel]');
    const card  = t.closest('.day-card');
    if (!panel || !card) return;

    const inner = panel.closest('.add-panel-inner');
    if (inner && inner.hidden) inner.hidden = false;

    let resultsBox = panel.querySelector('[data-ai-results]');
    let recipeBox  = panel.querySelector('[data-ai-recipe]');
    if (!resultsBox) { resultsBox = document.createElement('div'); resultsBox.setAttribute('data-ai-results',''); panel.appendChild(resultsBox); }
    if (!recipeBox)  { recipeBox  = document.createElement('div'); recipeBox.setAttribute('data-ai-recipe','');  panel.appendChild(recipeBox); }

    panel.dataset.slot = resolveSlotName(panel);
    const promptEl   = panel.querySelector('[name="ai-prompt"]');
    const prompt = (promptEl?.value || '').trim();
    if (!prompt) { resultsBox.innerHTML = '<div class="muted-note">Napisz, czego potrzebujesz.</div>'; promptEl?.focus(); return; }

    const dayTotalsNow = sumDayFromDOM(card);
    const targets = window.USER_TARGETS || {};

    resultsBox.textContent = 'Myślę…';
    recipeBox.innerHTML = '';

    try {
      const debugOn = (localStorage.getItem('AI_DEBUG') === '1');
      const topN = Number(localStorage.getItem('AI_TOPN') || 3);
      const qs = new URLSearchParams();
      if (debugOn) qs.set('debug','1');
      if (topN) qs.set('n', String(topN));   // jeżeli backend wspiera TOP-N
      const url = '/api/ai/plan' + (qs.toString() ? `?${qs}` : '');

      const data = await fetch(url, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ prompt, dayTotals: dayTotalsNow, targets })
      }).then(r => r.json());

      resultsBox.textContent = '';
      if (!data || (!Array.isArray(data.ingredients) && !Array.isArray(data.variants))) {
        resultsBox.innerHTML = `<div class="muted-note">${esc(data?.message || 'Brak propozycji.')}</div>`;
        return;
      }

      renderPlanResult({
        box: recipeBox || panel,
        data,
        dayISO: card?.dataset?.date,
        dayCard: card,
        slotName: panel.dataset.slot
      });
    } catch (e) {
      resultsBox.innerHTML = `<div class="muted-note">Błąd zapytania: ${esc(e.message || e)}</div>`;
    }
  });

  // ───────── render przepisu / wariantów ─────────
  function renderPlanResult({ box, data, dayISO, dayCard, slotName }) {
    const variants = Array.isArray(data.variants) && data.variants.length
      ? data.variants
      : [{
          mealId: data.mealId, title: data.title, scale: 1,
          totals: data.totals, timeMinutes: data.timeMinutes, servings: data.servings,
          ingredients: data.ingredients||[], steps: data.steps||[]
        }];

    let idx = Number(box._variantIndex ?? data.selectedIndex ?? 0);
    if (!Number.isFinite(idx) || idx<0) idx = 0;
    if (idx >= variants.length) idx = 0;
    box._variantIndex = idx;

    const hasCarousel = variants.length > 1;
    box.setAttribute('data-has-carousel', hasCarousel ? '1' : '0');

    const keyHandler = (ev) => {
      if (!hasCarousel) return;
      const tag = (ev.target?.tagName || '').toLowerCase();
      if (tag === 'textarea' || tag === 'input') return;
      if (ev.key === 'ArrowLeft') {
        ev.preventDefault();
        box._variantIndex = (box._variantIndex - 1 + variants.length) % variants.length;
        paint();
      } else if (ev.key === 'ArrowRight') {
        ev.preventDefault();
        box._variantIndex = (box._variantIndex + 1) % variants.length;
        paint();
      }
    };

    function paint(){
      const v = variants[box._variantIndex];
      const h = [];

      // Pasek tytuł + strzałki
      h.push(`
        <div class="ai-head">
          <button type="button" class="ai-nav" data-ai-prev aria-label="Poprzedni" ${hasCarousel?'':'disabled'}>‹</button>
          <h4 class="ai-title">${esc(v.title || 'Propozycja')}</h4>
          <button type="button" class="ai-nav" data-ai-next aria-label="Następny" ${hasCarousel?'':'disabled'}>›</button>
        </div>
        <div class="ai-sub">
          ${esc(fmtTotalsStr(v.totals || {kcal:0,p:0,f:0,c:0}))}
          ${hasCarousel ? `<span class="ai-count">(${box._variantIndex+1}/${variants.length})</span>` : ``}
        </div>
      `);

      // Produkty + „Dodaj wszystko”
      h.push('<div class="recipe-ingredients one-col">');
      for (const it of (v.ingredients||[])) {
        h.push(`
          <div class="ing">
            <span class="name">${esc(it.name||('Produkt '+it.productId))}</span>
            <span class="grams">${fmt(it.grams)} g</span>
            <button type="button" class="btn-small" data-add-ing data-id="${esc(it.productId)}" data-g="${fmt(it.grams)}">Dodaj</button>
          </div>
        `);
      }
      h.push(`
        <div class="ing-actions">
          <button type="button" class="btn-small primary" data-add-all>Dodaj wszystko</button>
        </div>
      `);
      h.push('</div>');

      box.innerHTML = h.join('');

      // fokus + klawiatura
      box.tabIndex = 0;
      box.removeEventListener('keydown', box._keyHandler || (()=>{}));
      box._keyHandler = keyHandler;
      box.addEventListener('keydown', keyHandler);

      // Strzałki (tylko gdy >1)
      if (hasCarousel) {
        box.querySelector('[data-ai-prev]')?.addEventListener('click', () => {
          box._variantIndex = (box._variantIndex - 1 + variants.length) % variants.length;
          paint();
        });
        box.querySelector('[data-ai-next]')?.addEventListener('click', () => {
          box._variantIndex = (box._variantIndex + 1) % variants.length;
          paint();
        });
      }

      // Dodaj pojedynczy
      box.querySelectorAll('[data-add-ing]')?.forEach(btn => {
        btn.addEventListener('click', async () => {
          const productId = btn.getAttribute('data-id');
          const grams = Number(btn.getAttribute('data-g'));
          try {
            await apiAddItem(dayISO, slotName, { productId, grams });
// === AI: pełny render po dodaniu (pojedynczy) ===
btn.textContent = 'Dodano ✓';
btn.disabled = true;

try {
  const core = await import('./meal-calendar-core.js');
  await (core.render?.() ?? window.CalendarCore?.render?.());
} catch {
  await window.CalendarCore?.render?.();
}

// Otwórz z powrotem ten sam dzień i ten sam posiłek
setTimeout(() => {
  const day = document.querySelector(`.day-card[data-date="${dayISO}"]`);
  const det = day?.querySelector(`details.meal[data-slot="${CSS.escape(slotName)}"]`);
  det?.setAttribute('open', 'true');
}, 0);
// === /AI ===



            notifyItemsAdded({ dayISO, slotName, items:[{ productId, grams }] });
          } catch (e) {
            alert('Nie udało się dodać: ' + (e.message||e));
          }
        });
      });

      // Dodaj wszystko
      box.querySelector('[data-add-all]')?.addEventListener('click', async (ev) => {
        const btnAll = ev.currentTarget;
        const vNow = variants[box._variantIndex];
        btnAll.disabled = true;
        btnAll.textContent = 'Dodaję…';
        try {
          for (const it of (vNow.ingredients||[])) {
            await apiAddItem(dayISO, slotName, { productId: it.productId, grams: Number(it.grams)||0 });
            const b = box.querySelector(`[data-add-ing][data-id="${CSS.escape(it.productId)}"]`);
            if (b) { b.textContent = 'Dodano ✓'; b.disabled = true; }
          }
// === AI: pełny render po dodaniu wszystkiego ===
btnAll.textContent = 'Dodano wszystko ✓';

try {
  const core = await import('./meal-calendar-core.js');
  await (core.render?.() ?? window.CalendarCore?.render?.());
} catch {
  await window.CalendarCore?.render?.();
}

// Otwórz z powrotem ten sam dzień i ten sam posiłek
setTimeout(() => {
  const day = document.querySelector(`.day-card[data-date="${dayISO}"]`);
  const det = day?.querySelector(`details.meal[data-slot="${CSS.escape(slotName)}"]`);
  det?.setAttribute('open', 'true');
}, 0);
// === /AI ===

        } catch (e) {
          btnAll.disabled = false;
          btnAll.textContent = 'Dodaj wszystko';
          alert('Nie udało się dodać wszystkiego: ' + (e.message||e));
        }
      });
    }

    paint();
  }

  // ───────── init ─────────
  window.addEventListener('DOMContentLoaded', () => {
    ensureAiPanelsInMeals();

    // jeżeli kalendarz się dogrywa dynamicznie — pilnuj wstrzykiwania paneli
    const grid = document.getElementById('calendarGrid');
    if (grid && !grid._aiObserver) {
      const obs = new MutationObserver(() => ensureAiPanelsInMeals());
      obs.observe(grid, { childList: true, subtree: true });
      grid._aiObserver = obs;
    }

    // globalny nasłuch na event — gdyby coś innego dodawało itemy
    document.addEventListener('calendar:items-added', (e) => {
      const { dayISO, slotName } = e.detail || {};
      const card = document.querySelector(`.day-card[data-date="${CSS.escape(dayISO||'')}"]`);
      if (card) updateDayHeaderTotals(card);
    });
  });
})();
