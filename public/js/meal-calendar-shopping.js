// /js/meal-calendar-shopping.js
// Kopiowanie dnia/posiłku + lista zakupów (z opcją zużycia lodówki) + druk bez inline JS (CSP-safe)

import {
  MEALS, toLocalISO, mondayOfWeek, loadWeekFromAPI, apiAddItem, render,
  getSelectedDayISO, authHeaders, resolveName
} from './meal-calendar-core.js';

// ====== prosty modal (spójny z core)
function openDialog({ title, content, onOpen }){
  const back = document.createElement('div');
  back.className = 'dlg-backdrop';
  const dlg = document.createElement('div');
  dlg.className = 'dlg';
  dlg.innerHTML = `
    <div class="dlg-head">
      <div class="dlg-title">${title}</div>
      <button class="dlg-x" data-dlg-close aria-label="Zamknij">×</button>
    </div>
    <div class="dlg-body">${content}</div>
    <div class="dlg-foot">
      <button class="btn-small" data-dlg-cancel>Anuluj</button>
      <div class="dlg-actions"></div>
    </div>
  `;
  back.appendChild(dlg);
  document.body.appendChild(back);
  const close = () => back.remove();
  if (typeof onOpen === 'function') onOpen({ back, dlg, close });
  return { back, dlg, close };
}
const opt = (v, t) => `<option value="${String(v)}">${t}</option>`;

// ====== KOPIOWANIE DNIA / POSIŁKU ============================================
function openCopyDialog(sourceISO){
  const mealOpts = [ opt('all', 'Cały dzień'), ...MEALS.map((m, i) => opt(`slot:${i}`, m)) ].join('');
  const today = toLocalISO(new Date());
  const html = `
    <div class="form-grid">
      <label class="form-field">
        <span>Zakres</span>
        <select name="copy-scope">${mealOpts}</select>
      </label>
      <label class="form-field">
        <span>Data docelowa</span>
        <input type="date" name="copy-date" value="${today}" />
      </label>
    </div>
    <div class="muted-note">Skopiuję pozycje z <strong>${sourceISO}</strong> do wybranego dnia. Jeśli wybierzesz posiłek — trafią do tego samego slotu.</div>
  `;
  const { dlg, close } = openDialog({
    title: 'Skopiuj',
    content: html,
    onOpen: ({ dlg }) => {
      dlg.querySelector('.dlg-actions').innerHTML = `<button class="btn-small primary" data-copy-confirm>Skopiuj</button>`;
    }
  });

  dlg.addEventListener('click', async (e) => {
    const t = e.target;
    if (!(t instanceof HTMLElement)) return;
    if (t.matches('[data-dlg-close],[data-dlg-cancel]')) { e.preventDefault(); return close(); }
    if (t.matches('[data-copy-confirm]')) {
      e.preventDefault();
      const scopeSel = dlg.querySelector('[name="copy-scope"]');
      const dateInp  = dlg.querySelector('[name="copy-date"]');
      const scope = scopeSel?.value || 'all';
      const destISO = dateInp?.value || toLocalISO(new Date());
      try { await performCopy({ sourceISO, destISO, scope }); close(); } catch (err) { alert('Błąd kopiowania: ' + err.message); }
    }
  }, { passive: false });
}

async function performCopy({ sourceISO, destISO, scope }) {
  const srcMonday = mondayOfWeek(new Date(sourceISO));
  const srcWeek = await loadWeekFromAPI(toLocalISO(srcMonday));
  const srcMeals = srcWeek[sourceISO] || [];

  const addItemsOfSlot = async (slotIdx) => {
    const slot = srcMeals[slotIdx];
    if (!slot || !Array.isArray(slot.items)) return;
    for (const it of slot.items) {
      const pid = it.productId || it.product?.id || it.product?._id;
      const grams = Number(it.grams || 0);
      if (!pid || !(grams > 0)) continue;
      await apiAddItem(destISO, slot.name, { productId: pid, grams });
    }
  };

  if (scope === 'all') {
    for (let i = 0; i < srcMeals.length; i++) await addItemsOfSlot(i);
  } else if (scope.startsWith('slot:')) {
    const idx = Number(scope.split(':')[1] || 0);
    await addItemsOfSlot(idx);
  }
  if (destISO === getSelectedDayISO()) await render();
}

// ====== API LODÓWKI + zużycie FIFO ===========================================
const API_FRIDGE = '/api/fridge';
async function apiFridgeList() {
  try {
    const r = await fetch(API_FRIDGE, { headers: authHeaders() });
    if (!r.ok) return [];
    const data = await r.json();
    const arr = Array.isArray(data) ? data : (data.items || []);
    return arr.map(doc => ({
      id: doc._id || doc.id,
      productId: doc.productId || doc.product?.id || doc.product?._id,
      grams: Number(doc.grams ?? 0),
      expiresAt: doc.expiresAt ? toLocalISO(new Date(doc.expiresAt)) : null,
      product: doc.product || null
    }));
  } catch { return []; }
}
async function apiFridgeUpdateItem(id, grams) {
  const body = JSON.stringify({ grams: Number(grams) });
  const r = await fetch(`${API_FRIDGE}/${id}`, { method: 'PATCH', headers: authHeaders(), body });
  if (!r.ok) throw new Error('PATCH /fridge');
  return true;
}
async function apiFridgeRemoveItem(id) {
  const r = await fetch(`${API_FRIDGE}/${id}`, { method: 'DELETE', headers: authHeaders() });
  if (!r.ok) throw new Error('DELETE /fridge');
  return true;
}
async function fridgeConsume(productId, needGrams) {
  if (!(needGrams > 0)) return { consumed: 0, shortage: 0 };
  const items = (await apiFridgeList()).filter(it => it.productId === productId);
  // FIFO wg. daty ważności
  items.sort((a,b) => (a.expiresAt || '') < (b.expiresAt || '') ? -1 : 1);
  let left = needGrams, consumed = 0;
  for (const it of items) {
    if (left <= 0) break;
    const take = Math.min(it.grams, left);
    const rest = it.grams - take;
    consumed += take;
    left -= take;
    if (rest <= 0) { try { await apiFridgeRemoveItem(it.id); } catch {} }
    else { try { await apiFridgeUpdateItem(it.id, rest); } catch {} }
  }
  const shortage = Math.max(0, left);
  return { consumed, shortage };
}

// ====== LISTA ZAKUPÓW ========================================================
function openShoppingDialog(){
  const today = toLocalISO(new Date());
  const html = `
    <div class="form-grid">
      <label class="form-field">
        <span>Od dnia</span>
        <input type="date" name="shop-from" value="${today}" />
      </label>
      <label class="form-field">
        <span>Do dnia</span>
        <input type="date" name="shop-to" value="${today}" />
      </label>
      <label class="form-field inline">
        <input type="checkbox" name="shop-consume" />
        <span>Usuń zużyte z lodówki</span>
      </label>
    </div>
    <div class="muted-note">Bez zaznaczenia — lista = pełne zapotrzebowanie (ignoruję lodówkę). Z zaznaczeniem — odejmuję z lodówki FIFO, a na listę trafiają tylko braki.</div>
    <div class="shop-results" data-shop-results hidden></div>
  `;
  const { dlg, close } = openDialog({
    title: 'Lista zakupów',
    content: html,
    onOpen: ({ dlg }) => {
      dlg.querySelector('.dlg-actions').innerHTML = `
        <button class="btn-small" data-shop-generate>Generuj</button>
        <button class="btn-small primary" data-shop-print hidden>Drukuj PDF</button>
      `;
    }
  });

  dlg.addEventListener('click', async (e) => {
    const t = e.target;
    if (!(t instanceof HTMLElement)) return;
    if (t.matches('[data-dlg-close],[data-dlg-cancel]')) { e.preventDefault(); return close(); }
    if (t.matches('[data-shop-generate]')) { e.preventDefault(); await handleGenerateShopping(dlg); }
    if (t.matches('[data-shop-print]'))    { e.preventDefault(); handlePrintShopping(dlg); }
  }, { passive: false });
}

async function handleGenerateShopping(dlg){
  const fromISO = dlg.querySelector('[name="shop-from"]').value;
  const toISO   = dlg.querySelector('[name="shop-to"]').value;
  const consume = dlg.querySelector('[name="shop-consume"]').checked;
  if (!fromISO || !toISO) return;

  // 1) Zbierz zapotrzebowanie (grams) po productId z zakresu dat
  const req = await collectRequirementsByProduct(fromISO, toISO);

  // 2) Zbuduj listę do kupienia
  const toBuy = {};
  if (consume) {
    // Zaznaczone → odejmujemy realnie z lodówki, a na listę trafiają tylko braki
    for (const [pid, gramsNeeded] of Object.entries(req)) {
      const { shortage } = await fridgeConsume(pid, gramsNeeded);
      if (shortage > 0) toBuy[pid] = (toBuy[pid] || 0) + shortage;
    }
  } else {
    // Niezaznaczone → IGNORUJEMY zapasy lodówki (pełne zapotrzebowanie)
    for (const [pid, gramsNeeded] of Object.entries(req)) {
      toBuy[pid] = gramsNeeded;
    }
  }

  // 3) Render w modalu
  const box = dlg.querySelector('[data-shop-results]');
  const list = Object.entries(toBuy);
  if (list.length === 0) {
    box.innerHTML = `<div class="muted-note">Brak braków — nic nie trzeba kupować 🎉</div>`;
    dlg.querySelector('[data-shop-print]')?.setAttribute('hidden','');
  } else {
    const rows = list
      .sort((a,b) => resolveName(a[0]).localeCompare(resolveName(b[0]), 'pl'))
      .map(([pid, g]) => `<div class="shop-row"><div class="shop-name">${escapeHtml(resolveName(pid))}</div><div class="shop-grams num">${Math.round(g)} g</div></div>`)
      .join('');
    box.innerHTML = `<div class="shop-list">${rows}</div>`;
    dlg.querySelector('[data-shop-print]')?.removeAttribute('hidden');
  }
  box.removeAttribute('hidden');
}

// Zbiorcze gramatury z zakresu dat
async function collectRequirementsByProduct(fromISO, toISO){
  let start = new Date(fromISO + 'T00:00:00');
  let end   = new Date(toISO   + 'T00:00:00');
  if (end < start) [start, end] = [end, start];

  const days = [];
  for (let d = new Date(start); d <= end; d.setDate(d.getDate()+1)) {
    days.push(toLocalISO(new Date(d)));
  }
  const weeks = new Map();
  for (const iso of days) {
    const mon = toLocalISO(mondayOfWeek(new Date(iso)));
    if (!weeks.has(mon)) weeks.set(mon, []);
    weeks.get(mon).push(iso);
  }
  const req = {};
  for (const [monISO, isoDays] of weeks.entries()) {
    const w = await loadWeekFromAPI(monISO);
    for (const iso of isoDays) {
      const meals = w[iso] || [];
      for (const m of meals) {
        for (const it of (m.items || [])) {
          const pid = it.productId || it.product?.id || it.product?._id;
          const g = Number(it.grams || 0);
          if (!pid || !(g > 0)) continue;
          req[pid] = (req[pid] || 0) + g;
        }
      }
    }
  }
  return req;
}

// ====== DRUKOWANIE: ukryty iframe + srcdoc bez inline JS (CSP-safe) ==========
function handlePrintShopping(dlg){
  const box = dlg.querySelector('.shop-list');
  if (!box) return;

  const now = new Date();
  const title = `Lista zakupów — ${now.toLocaleString('pl-PL')}`;

  const rowsHtml = [...box.querySelectorAll('.shop-row')].map(r => {
    const name = r.querySelector('.shop-name')?.textContent || '';
    const g    = r.querySelector('.shop-grams')?.textContent || '';
    return `<div class="row"><div class="name">${escapeHtml(name)}</div><div class="g">${escapeHtml(g)}</div></div>`;
  }).join('');

  const html = `
    <html>
      <head>
        <meta charset="utf-8" />
        <title>${escapeHtml(title)}</title>
        <style>
          @page { margin: 16mm; }
          body{ font: 14px/1.4 system-ui,-apple-system,Segoe UI,Roboto,Arial; color:#111; padding:0; }
          h1{ font-size:18px; margin:0 0 12px; }
          .row{ display:flex; justify-content:space-between; border-bottom:1px solid #ddd; padding:6px 0; }
          .name{ font-weight:600; }
          .g{ font-variant-numeric:tabular-nums; }
        </style>
      </head>
      <body>
        <h1>${escapeHtml(title)}</h1>
        ${rowsHtml}
      </body>
    </html>
  `;

  const iframe = document.createElement('iframe');
  iframe.style.position = 'fixed';
  iframe.style.right = '0';
  iframe.style.bottom = '0';
  iframe.style.width = '1px';
  iframe.style.height = '1px';
  iframe.style.border = '0';

  const cleanup = () => setTimeout(() => { try { iframe.remove(); } catch {} }, 1500);
  iframe.addEventListener('load', () => {
    try {
      iframe.contentWindow?.focus?.();
      iframe.contentWindow?.print?.();
      cleanup();
    } catch (e) {
      try {
        const blob = new Blob([html], { type: 'text/html' });
        const url = URL.createObjectURL(blob);
        iframe.src = url;
        iframe.onload = () => {
          try { iframe.contentWindow?.focus?.(); iframe.contentWindow?.print?.(); } finally {
            URL.revokeObjectURL(url); cleanup();
          }
        };
        return;
      } catch {}
      cleanup();
    }
  }, { once: true });

  iframe.srcdoc = html;
  document.body.appendChild(iframe);
}

// ====== utils
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
function escapeHtml(s) { return String(s ?? '').replace(/[&<>"']/g, c => ESC[c]); }

// ====== podpięcie przycisków (delegacja)
document.addEventListener('click', (e) => {
  const t = e.target;
  if (!(t instanceof HTMLElement)) return;
  if (t.matches('[data-copy-open]')) {
    e.preventDefault();
    const card = t.closest('.day-card');
    const iso = card?.dataset.date || getSelectedDayISO();
    openCopyDialog(iso);
  }
  if (t.matches('[data-shop-open]')) {
    e.preventDefault();
    openShoppingDialog();
  }
});
