// ======= KONFIG/API =======
const TOKEN_KEY = 'cm_token';
const LEGACY_TOKEN_KEY = 'token';
const getToken = () => localStorage.getItem(TOKEN_KEY) || localStorage.getItem(LEGACY_TOKEN_KEY);
const authHeaders = () => {
  const h = { 'Content-Type': 'application/json' };
  const t = getToken();
  if (t) h['Authorization'] = `Bearer ${t}`;
  return h;
};

const API_PRODUCTS = '/api/products';
const API_FRIDGE   = '/api/fridge';

// ======= Adapter API =======
const api = {
  async listProducts() {
    const r = await fetch(`${API_PRODUCTS}?page=1&pageSize=1000&scope=all`, { headers: authHeaders() });
    if (!r.ok) return [];
    const data = await r.json();
    const arr = Array.isArray(data) ? data : (data.items || []);
    return arr.map(mapProductDoc);
  },
  async listFridge() {
    const r = await fetch(API_FRIDGE, { headers: authHeaders() });
    if (!r.ok) return [];
    const data = await r.json();
    const arr = Array.isArray(data) ? data : (data.items || []);
    return arr.map(mapFridgeDoc);
  },
  // ← teraz przyjmuje opcjonalnie expiresAt (YYYY-MM-DD)
  async addToFridge(productId, grams, expiresAt) {
    const payload = { productId, grams: Number(grams) };
    if (expiresAt) payload.expiresAt = expiresAt;
    const body = JSON.stringify(payload);
    const r = await fetch(API_FRIDGE, { method: 'POST', headers: authHeaders(), body });
    if (!r.ok) throw new Error('Nie udało się dodać do lodówki');
    return mapFridgeDoc(await r.json());
  },
  // ← można zaktualizować grams i/lub expiresAt (null usuwa datę)
  async updateFridgeItem(id, grams, expiresAt) {
    const payload = {};
    if (grams !== undefined)     payload.grams = Number(grams);
    if (expiresAt !== undefined) payload.expiresAt = expiresAt || null;
    const body = JSON.stringify(payload);
    const r = await fetch(`${API_FRIDGE}/${id}`, { method: 'PATCH', headers: authHeaders(), body });
    if (!r.ok) throw new Error('Nie udało się zaktualizować');
    return mapFridgeDoc(await r.json());
  },
  async removeFridgeItem(id) {
    const r = await fetch(`${API_FRIDGE}/${id}`, { method: 'DELETE', headers: authHeaders() });
    if (!r.ok) throw new Error('Nie udało się usunąć');
    return true;
  }
};

function mapProductDoc(doc) {
  return {
    id: doc._id || doc.id,
    name: doc.name,
    category: doc.category || '',
    kcal100: num(doc.kcal100),
    p100:   num(doc.p100),
    f100:   num(doc.f100),
    c100:   num(doc.c100),
  };
}
function mapFridgeDoc(doc) {
  const base = {
    id: doc._id || doc.id,
    productId: doc.productId || doc.product?.id || doc.product?._id,
    grams: Number(doc.grams ?? 0),
    // normalizacja do YYYY-MM-DD jeśli backend zwróci ISO/Date
    expiresAt: doc.expiresAt ? toYMD(doc.expiresAt) : null,
  };
  const p = doc.product ? mapProductDoc(doc.product) : null;
  return { ...base, product: p };
}
const num = (v) => (v === null || v === undefined ? null : Number(v));

// ======= STAN =======
let products = [];
let fridge = [];
let fridgeFiltered = [];

let selectedProductId = null;
let highlightedIndex = -1;
let currentSuggestions = [];

// ======= DOM =======
const $ = (id) => document.getElementById(id);
const catalogFilter = $('catalogFilter');
const gramsInput    = $('gramsInput');
const expiresInput  = $('expiresInput'); // ← NOWE
const resetAdd      = $('resetAdd');
const fridgeForm    = $('fridgeForm');

const fridgeSearch  = $('fridgeSearch');
const fridgeTbody   = $('fridgeTbody');
const fridgeEmpty   = $('fridgeEmpty');
const fridgeSummary = $('fridgeSummary');

// Modal — edycja gramów
const editModal   = document.getElementById('editModal');
const editInput   = document.getElementById('editModalInput');
const editName    = document.getElementById('editModalName');
const editSaveBtn = document.getElementById('editModalSave');
let   editCurrent = null;

// Modal — edycja daty ważności (HTML masz wstawiony w stronie)
const dateModal   = document.getElementById('dateModal');
const dateInput   = document.getElementById('dateModalInput');
const dateName    = document.getElementById('dateModalName');
const dateSaveBtn = document.getElementById('dateModalSave');
let   dateCurrent = null;

// ======= Helpers =======
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
function escapeHtml(s) { return String(s ?? '').replace(/[&<>"']/g, c => ESC[c]); }
function round1(x) { return Math.round(x * 10) / 10; }
function fmt(x) { return Number.isFinite(x) ? String(x) : '—'; }
function norm(str) {
  return String(str ?? '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
}
function toYMD(d){
  try {
    const dt = (d instanceof Date) ? d : new Date(d);
    const y = dt.getFullYear(), m = String(dt.getMonth()+1).padStart(2,'0'), da = String(dt.getDate()).padStart(2,'0');
    return `${y}-${m}-${da}`;
  } catch { return null; }
}
function isExpired(ymd){
  if (!ymd) return false;
  const today = new Date(); today.setHours(0,0,0,0);
  const d = new Date(ymd);  d.setHours(0,0,0,0);
  return d < today;
}

// ======= AUTOCOMPLETE =======
let suggestBox = null;

function setupAutocompleteUI() {
  if (!catalogFilter) return;

  let wrap = catalogFilter.closest('.ac-wrap') ||
             catalogFilter.closest('.form-field') ||
             catalogFilter.parentElement;

  let attachToBody = false;
  if (!wrap) { wrap = document.body; attachToBody = true; }

  if (!attachToBody) {
    wrap.style.position = wrap.style.position || 'relative';
    wrap.style.overflow = 'visible';
  }

  suggestBox = document.createElement('div');
  suggestBox.className = 'ac-panel';
  suggestBox.hidden = true;

  if (attachToBody) {
    Object.assign(suggestBox.style, { position: 'absolute', zIndex: '9999' });
    document.body.appendChild(suggestBox);
    const place = () => {
      const r = catalogFilter.getBoundingClientRect();
      suggestBox.style.left = `${r.left + window.scrollX}px`;
      suggestBox.style.top  = `${r.bottom + window.scrollY + 4}px`;
      suggestBox.style.width = `${r.width}px`;
    };
    place();
    window.addEventListener('scroll', place, { passive: true });
    window.addEventListener('resize', place);
    catalogFilter.addEventListener('focus', place);
    catalogFilter.addEventListener('input', place);
  } else {
    wrap.appendChild(suggestBox);
  }
}

function onSearchInput() {
  const q = norm(catalogFilter.value);
  selectedProductId = null;

  const hay = products.map(p => ({ ...p, _n: norm(p.name + ' ' + (p.category || '')) }));
  currentSuggestions = q ? hay.filter(p => p._n.includes(q)).slice(0, 12) : hay.slice(0, 10);

  highlightedIndex = -1;
  renderSuggestions();
  showSuggestions();
}

function renderSuggestions() {
  if (!suggestBox) return;
  suggestBox.innerHTML = '';
  if (!currentSuggestions.length) { hideSuggestions(); return; }

  currentSuggestions.forEach((p, i) => {
    const row = document.createElement('div');
    row.className = 'ac-item';
    row.dataset.id = p.id;

    const name = document.createElement('div');
    name.innerHTML = `<strong>${escapeHtml(p.name)}</strong>${p.category ? ` <span class="ac-muted">— ${escapeHtml(p.category)}</span>` : ''}`;

    const meta = document.createElement('div');
    meta.className = 'ac-muted';
    meta.textContent = hintMacros(p);

    row.appendChild(name);
    row.appendChild(meta);

    row.addEventListener('mouseenter', () => { highlightedIndex = i; updateHighlight(); });
    row.addEventListener('mousedown', ev => ev.preventDefault());
    row.addEventListener('click', () => pickSuggestion(p));

    suggestBox.appendChild(row);
  });

  updateHighlight();
}

function hintMacros(p) {
  const a = [];
  if (Number.isFinite(p.kcal100)) a.push(`${p.kcal100} kcal/100g`);
  if (Number.isFinite(p.p100))    a.push(`${p.p100} B`);
  if (Number.isFinite(p.f100))    a.push(`${p.f100} T`);
  if (Number.isFinite(p.c100))    a.push(`${p.c100} W`);
  return a.join(' • ');
}

function updateHighlight() {
  if (!suggestBox) return;
  [...suggestBox.children].forEach((el, idx) =>
    el.classList.toggle('is-active', idx === highlightedIndex)
  );
}

function pickSuggestion(p) {
  if (!p) return;
  selectedProductId = p.id;
  catalogFilter.value = p.name;
  hideSuggestions();
}

function showSuggestions() {
  if (suggestBox && currentSuggestions.length) suggestBox.hidden = false;
}
function hideSuggestions() {
  if (suggestBox) suggestBox.hidden = true;
}

function onSearchKeydown(e) {
  const has = currentSuggestions.length > 0 && suggestBox && !suggestBox.hidden;
  if (e.key === 'ArrowDown' && has) {
    e.preventDefault();
    highlightedIndex = (highlightedIndex + 1) % currentSuggestions.length;
    updateHighlight();
  } else if (e.key === 'ArrowUp' && has) {
    e.preventDefault();
    highlightedIndex = (highlightedIndex - 1 + currentSuggestions.length) % currentSuggestions.length;
    updateHighlight();
  } else if (e.key === 'Enter') {
    if (has) {
      e.preventDefault();
      pickSuggestion(currentSuggestions[Math.max(0, highlightedIndex)]);
    }
  } else if (e.key === 'Escape') {
    hideSuggestions();
  }
}

function clearSearch() {
  selectedProductId = null;
  catalogFilter.value = '';
  currentSuggestions = [];
  hideSuggestions();
}

// ======= Modale =======
function openEditModal(item){
  editCurrent = { it: item };
  editName.textContent = item.product?.name || '[brak nazwy]';
  editInput.value = String(item.grams ?? 0);

  editModal.hidden = false;
  document.body.classList.add('cm-modal-open');

  setTimeout(() => { editInput.focus(); editInput.select(); }, 0);
}

function closeEditModal(){
  editModal.hidden = true;
  document.body.classList.remove('cm-modal-open');
  editCurrent = null;
}

async function saveEditModal(){
  if (!editCurrent) return;
  const g = Number(editInput.value);
  if (!Number.isFinite(g) || g < 0) {
    editInput.focus(); editInput.select();
    return;
  }
  await setGrams(editCurrent.it, g);
  closeEditModal();
}

// ——— modal daty
function openDateModal(item){
  dateCurrent = { it: item };
  dateName.textContent = item.product?.name || '[brak nazwy]';
  dateInput.value = item.expiresAt || '';
  dateModal.hidden = false;
  document.body.classList.add('cm-modal-open');
  setTimeout(() => dateInput.focus(), 0);
}
function closeDateModal(){
  dateModal.hidden = true;
  document.body.classList.remove('cm-modal-open');
  dateCurrent = null;
}
async function saveDateModal(){
  if (!dateCurrent) return;
  const v = (dateInput.value || '').trim() || null; // null = usuń datę
  const grams = dateCurrent.it?.grams;              // ← doślij bieżące gramy (fallback dla backendu)

  try {
    const updated = await api.updateFridgeItem(dateCurrent.it.id, grams, v);
    mergeFridge(updated);
    applyFridgeFilter();
    closeDateModal();
  } catch (err) {
    console.error(err);
    alert('Nie udało się zapisać daty');
  }
}


// ======= INIT =======
(async function init() {
  try {
    setupAutocompleteUI();
    wireEvents();

    const raw = await api.listProducts();
    products = raw
      .map(p => ({ ...p, name: String(p?.name ?? '') }))
      .sort((a, b) => a.name.localeCompare(b.name, 'pl'));

    fridge = await api.listFridge();
    const pMap = new Map(products.map(p => [p.id, p]));
    fridge.forEach(it => { if (!it.product && pMap.has(it.productId)) it.product = pMap.get(it.productId); });

    applyFridgeFilter();
  } catch (err) {
    console.error(err);
    alert('Nie udało się załadować danych lodówki');
  }
})();

function wireEvents() {
  // AUTOCOMPLETE
  catalogFilter?.addEventListener('input', onSearchInput);
  catalogFilter?.addEventListener('keydown', onSearchKeydown);
  catalogFilter?.addEventListener('focus', showSuggestions);
  catalogFilter?.addEventListener('blur', () => setTimeout(hideSuggestions, 150));

  resetAdd?.addEventListener('click', () => {
    clearSearch();
    gramsInput.value = '';
    if (expiresInput) expiresInput.value = '';
    catalogFilter.focus();
  });

  fridgeForm?.addEventListener('submit', onAddSubmit);
  fridgeSearch?.addEventListener('input', () => applyFridgeFilter());

  // Zamknij dropdown podpowiedzi, gdy użytkownik jedzie do tabeli
  fridgeTbody?.addEventListener('mouseenter', hideSuggestions);
  document.addEventListener('click', (e) => {
    if (!catalogFilter.contains(e.target) && !(suggestBox && suggestBox.contains(e.target))) {
      hideSuggestions();
    }
  });

  // Modal gramów
  editSaveBtn?.addEventListener('click', () => { saveEditModal().catch(console.error); });
  editModal?.addEventListener('click', (e) => { if (e.target.matches('[data-close]')) closeEditModal(); });

  // Modal daty
  dateSaveBtn?.addEventListener('click', () => { saveDateModal().catch(console.error); });
  dateModal?.addEventListener('click', (e) => { if (e.target.matches('[data-close]')) closeDateModal(); });

  // Klawiatura dla obu modali
  document.addEventListener('keydown', (e) => {
    if (editModal && !editModal.hidden) {
      if (e.key === 'Escape') { e.preventDefault(); closeEditModal(); }
      if (e.key === 'Enter' && document.activeElement === editInput) {
        e.preventDefault(); saveEditModal().catch(console.error);
      }
    }
    if (dateModal && !dateModal.hidden) {
      if (e.key === 'Escape') { e.preventDefault(); closeDateModal(); }
      if (e.key === 'Enter' && document.activeElement === dateInput) {
        e.preventDefault(); saveDateModal().catch(console.error);
      }
    }
  });
}

// ======= FORM SUBMIT =======
async function onAddSubmit(e) {
  e.preventDefault();
  let productId = selectedProductId;
  const grams = Number(gramsInput.value);
  const expiresAt = (expiresInput?.value || '').trim() || null;

  if (!Number.isFinite(grams) || grams < 1) { gramsInput.focus(); return; }

  if (!productId) {
    // fallback: dopasuj po wpisanym tekście
    const q = norm(catalogFilter.value);
    if (!q) { catalogFilter.focus(); return; }
    const found = products.find(p => norm(p.name + ' ' + p.category).includes(q));
    productId = found?.id || null;
  }

  if (!productId) { alert('Wybierz produkt z podpowiedzi.'); catalogFilter.focus(); return; }

  const existing = fridge.find(it => it.productId === productId);
  try {
    if (existing) {
      const updated = await api.updateFridgeItem(existing.id, existing.grams + grams, expiresAt ?? undefined);
      mergeFridge(updated);
    } else {
      const created = await api.addToFridge(productId, grams, expiresAt);
      mergeFridge(created);
    }
    gramsInput.value = '';
    if (expiresInput) expiresInput.value = '';
    clearSearch();
    applyFridgeFilter();
  } catch (err) {
    console.error(err);
    alert('Nie udało się dodać/zmienić pozycji');
  }
}

function mergeFridge(item) {
  if (!item.product) {
    const p = products.find(p => p.id === item.productId);
    if (p) item.product = p;
  }
  const idx = fridge.findIndex(x => x.id === item.id);
  if (idx >= 0) fridge[idx] = item; else fridge.push(item);
}

function applyFridgeFilter() {
  const q = norm(fridgeSearch?.value || '');
  fridgeFiltered = q
    ? fridge.filter(it => {
        const name = it.product?.name || '';
        const cat  = it.product?.category || '';
        return norm(name + ' ' + cat).includes(q);
      })
    : [...fridge];
  renderFridge();
}

function renderFridge() {
  fridgeTbody.innerHTML = '';
  if (!fridgeFiltered.length) {
    fridgeEmpty.hidden = false;
  } else {
    fridgeEmpty.hidden = true;
    for (const it of fridgeFiltered) fridgeTbody.appendChild(rowTpl(it));
  }
  renderSummary();
}

function rowTpl(it) {
  const p = it.product || {};
  const tr = document.createElement('tr');
  const m = calcMacros(it.grams, p);
  tr.innerHTML = `
    <td>${escapeHtml(p.name || '[brak w bazie]')}</td>
    <td>${escapeHtml(p.category || '')}</td>
    <td class="exp-date ${isExpired(it.expiresAt) ? 'expired' : ''}">
      ${it.expiresAt ? escapeHtml(it.expiresAt) : '—'}
    </td>
    <td><strong>${it.grams}</strong></td>
    <td>${fmt(m.kcal)}</td>
    <td>${fmt(m.p)}</td>
    <td>${fmt(m.f)}</td>
    <td>${fmt(m.c)}</td>
    <td style="display:flex; gap:.25rem; flex-wrap:wrap;">
      <button class="btn small" data-act="minus10">-10g</button>
      <button class="btn small" data-act="minus50">-50g</button>
      <button class="btn small" data-act="plus50">+50g</button>
      <button class="btn small" data-act="edit">Zmień</button>
      <button class="btn small" data-act="date">Zmień datę</button>
      <button class="btn small danger" data-act="delete">Usuń</button>
    </td>`;
  const act = (sel) => tr.querySelector(`[data-act="${sel}"]`);
  act('minus10').addEventListener('click', () => adjust(it, -10));
  act('minus50').addEventListener('click', () => adjust(it, -50));
  act('plus50').addEventListener('click', () => adjust(it, +50));
  act('edit').addEventListener('click', () => openEditModal(it));
  act('date').addEventListener('click', () => openDateModal(it));
  act('delete').addEventListener('click', async () => {
    if (!confirm(`Usunąć z lodówki: ${p.name}?`)) return;
    try {
      await api.removeFridgeItem(it.id);
      fridge = fridge.filter(x => x.id !== it.id);
      applyFridgeFilter();
    } catch (err) {
      console.error(err);
      alert('Nie udało się usunąć');
    }
  });
  return tr;
}

async function adjust(it, delta) {
  const next = (it.grams || 0) + delta;
  if (next <= 0) {
    try {
      await api.removeFridgeItem(it.id);
      fridge = fridge.filter(x => x.id !== it.id);
      applyFridgeFilter();
    } catch (err) {
      console.error(err);
      alert('Nie udało się usunąć pozycji');
    }
  } else {
    await setGrams(it, next);
  }
}

async function setGrams(it, grams) {
  try {
    const updated = await api.updateFridgeItem(it.id, grams);
    mergeFridge(updated);
    applyFridgeFilter();
  } catch (err) {
    console.error(err);
    alert('Nie udało się zaktualizować ilości');
  }
}

function calcMacros(grams, p) {
  const g = Number(grams) || 0;
  const f = (v) => (Number.isFinite(v) ? v : 0);
  const factor = g / 100;
  return {
    kcal: Math.round(f(p.kcal100) * factor),
    p: round1(f(p.p100) * factor),
    f: round1(f(p.f100) * factor),
    c: round1(f(p.c100) * factor),
  };
}

function renderSummary() {
  let grams = 0, kcal = 0, p = 0, f = 0, c = 0;
  for (const it of fridgeFiltered) {
    grams += Number(it.grams) || 0;
    const m = calcMacros(it.grams, it.product || {});
    kcal += m.kcal; p += m.p; f += m.f; c += m.c;
  }
  fridgeSummary.innerHTML = fridgeFiltered.length
    ? `Suma: <strong>${grams} g</strong> • kcal: <strong>${fmt(kcal)}</strong> • B/T/W: <strong>${fmt(p)}</strong>/<strong>${fmt(f)}</strong>/<strong>${fmt(c)}</strong>`
    : 'Brak pozycji do podsumowania';
}
