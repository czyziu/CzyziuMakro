// /js/meal-calendar-core.js
// Rdzeń: kalendarz dnia, autouzupełnianie, dodawanie/edycja/usuwanie, podsumowanie i paski
// (bez: kopiowania i listy zakupów – to w osobnym module)

export const MEALS = ["Śniadanie", "II śniadanie", "Obiad", "Podwieczorek", "Kolacja"];
const KEY_PREFIX = "czyziu:calendar:v1:";
const CANDIDATE_UID_KEYS = ["cm:userId", "userId", "uid", "cm:uid", "auth:uid"];
const $ = (sel, root = document) => root.querySelector(sel);

const elGrid = document.getElementById("calendarGrid");
const elDays = document.getElementById("calDays");

let MEALS_CACHE = [];
let PRODUCTS_CACHE = [];
let COMBINED_CACHE = [];
let USER_TARGETS = { kcal: 0, protein: 0, fat: 0, carbs: 0 };

export const toLocalISO = (d) => {
  const off = d.getTimezoneOffset();
  const dt = new Date(d.getTime() - off * 60 * 1000);
  return dt.toISOString().slice(0, 10);
};
export const mondayOfWeek = (baseDate = new Date()) => {
  const d = new Date(baseDate);
  const day = (d.getDay() + 6) % 7; // 0=Pon ... 6=Niedz
  d.setDate(d.getDate() - day);
  d.setHours(0, 0, 0, 0);
  return d;
};
function weekdayIndexFromISO(iso) {
  const d = new Date(iso + "T00:00:00");
  const monday = new Date(currentMonday);
  const diff = Math.round((d - monday) / (24 * 60 * 60 * 1000));
  return diff;
}
function isoFromWeekdayIndex(i) {
  const d = new Date(currentMonday);
  d.setDate(d.getDate() + i);
  return toLocalISO(d);
}

let currentMonday = mondayOfWeek(new Date());
let selectedDayISO = toLocalISO(new Date());
export const getSelectedDayISO = () => selectedDayISO;

let uid = "guest";
for (const k of CANDIDATE_UID_KEYS) {
  const v = localStorage.getItem(k);
  if (v) { uid = v; break; }
}

// ====== fallback storage
const storageKey = (weekStartISO) => `${KEY_PREFIX}${uid}:${weekStartISO}`;
function loadWeekLocal(weekStartISO) {
  const raw = localStorage.getItem(storageKey(weekStartISO));
  if (raw) { try { return JSON.parse(raw); } catch {} }
  const obj = {};
  for (let i = 0; i < 7; i++) {
    const day = new Date(new Date(weekStartISO).getTime());
    day.setDate(day.getDate() + i);
    const iso = toLocalISO(day);
    obj[iso] = MEALS.map(name => ({ name, items: [] }));
  }
  return obj;
}
function saveWeekLocal(weekStartISO, data) {
  localStorage.setItem(storageKey(weekStartISO), JSON.stringify(data));
}

// ====== API helpers
const TOKEN_KEY = 'cm_token';
const LEGACY_TOKEN_KEY = 'token';
const getToken = () => localStorage.getItem(TOKEN_KEY) || localStorage.getItem(LEGACY_TOKEN_KEY);
export function authHeaders() {
  const h = { 'Content-Type': 'application/json' };
  const t = getToken();
  if (t) h['Authorization'] = `Bearer ${t}`;
  return h;
}
export async function apiJson(url, opts = {}) {
  const res = await fetch(url, { ...opts, headers: { ...authHeaders(), ...(opts.headers || {}) } });
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try { const j = await res.json(); if (j?.message) msg = j.message; } catch {}
    throw new Error(msg);
  }
  return res.json();
}

// ====== CELE (z bazy)
async function loadUserTargets() {
  try {
    const resp = await apiJson('/api/profile/macro/latest'); // { ok, macro }
    const m = resp?.macro || resp || {};
    const targets = {
      kcal:    toNum(m.kcal, 0),
      protein: toNum(m.protein_g, 0),
      fat:     toNum(m.fat_g, 0),
      carbs:   toNum(m.carbs_g, 0),
    };
    if (targets.kcal || targets.protein || targets.fat || targets.carbs) return targets;
  } catch {}
  try {
    const obj = await apiJson('/api/profile');
    if (obj && typeof obj === 'object') {
      const t = {
        kcal:    toNum(obj.kcal ?? obj.kcalTarget ?? obj.dailyKcal, 0),
        protein: toNum(obj.protein ?? obj.proteinTarget ?? obj.dailyProtein, 0),
        fat:     toNum(obj.fat ?? obj.fatTarget ?? obj.dailyFat, 0),
        carbs:   toNum(obj.carbs ?? obj.carbTarget ?? obj.dailyCarbs, 0),
      };
      if (t.kcal || t.protein || t.fat || t.carbs) return t;
    }
  } catch {}
  const kcal    = toNum(localStorage.getItem('cm:target:kcal')    ?? localStorage.getItem('targetKcal'),    0);
  const protein = toNum(localStorage.getItem('cm:target:protein') ?? localStorage.getItem('targetProtein'), 0);
  const fat     = toNum(localStorage.getItem('cm:target:fat')     ?? localStorage.getItem('targetFat'),     0);
  const carbs   = toNum(localStorage.getItem('cm:target:carbs')   ?? localStorage.getItem('targetCarbs'),   0);
  return { kcal, protein, fat, carbs };
}

// ====== Kalendarz API
export async function loadWeekFromAPI(mondayISO) {
  try {
    const data = await apiJson(`/api/calendar/week?monday=${encodeURIComponent(mondayISO)}`);
    return data.week;
  } catch (e) {
    console.warn("API week fetch failed, fallback localStorage:", e.message);
    return loadWeekLocal(mondayISO);
  }
}
export async function apiAddItem(dateISO, slotName, { productId, grams }) {
  return apiJson(`/api/calendar/${dateISO}/${encodeURIComponent(slotName)}/items`, {
    method: 'POST',
    body: JSON.stringify({ productId, grams })
  });
}
export async function apiDeleteItem(dateISO, slotName, itemId) {
  return apiJson(`/api/calendar/${dateISO}/${encodeURIComponent(slotName)}/items/${itemId}`, { method: 'DELETE' });
}
export async function apiUpdateItem(dateISO, slotName, itemId, { grams, productId }) {
  try {
    return await apiJson(`/api/calendar/${dateISO}/${encodeURIComponent(slotName)}/items/${itemId}`, {
      method: 'PATCH',
      body: JSON.stringify({ grams })
    });
  } catch (e) {
    await apiDeleteItem(dateISO, slotName, itemId);
    if (!productId) throw new Error("Brak productId do ponownego dodania");
    return await apiAddItem(dateISO, slotName, { productId, grams });
  }
}
async function apiClearDay(dateISO) {
  return apiJson(`/api/calendar/${dateISO}`, { method: 'DELETE' });
}

// ====== Produkty/Dania do AC
function mapProductDoc(doc) {
  return {
    id: doc._id || doc.id,
    name: String(doc.name || ''),
    category: doc.category || '',
    kcal100: toNum(doc.kcal100, null),
    p100: toNum(doc.p100, null),
    f100: toNum(doc.f100, null),
    c100: toNum(doc.c100, null),
  };
}
function mapProductForCache(doc) {
  return {
    id: doc._id || doc.id,
    name: String(doc.name || ''),
    category: doc.category || '',
    kcal100: (doc.kcal100 ?? null),
    p100:    (doc.p100 ?? null),
    f100:    (doc.f100 ?? null),
    c100:    (doc.c100 ?? null),
    _n: (String(doc.name || '') + ' ' + (doc.category || ''))
          .normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase()
  };
}
async function apiListProducts() {
  const data = await apiJson(`/api/products?page=1&pageSize=1000&scope=all`);
  const arr = Array.isArray(data) ? data : (data.items || []);
  return arr.map(mapProductDoc).map(p => ({ ...p, _n: norm(p.name + ' ' + (p.category || '')) }));
}
function mapMealDoc(doc) {
  return {
    id: doc._id || doc.id,
    name: String(doc.name || ''),
    postWeight: toNum(doc.postWeight, 0),
  };
}
async function apiListMeals() {
  const data = await apiJson(`/api/meals?page=1&pageSize=1000&scope=all`);
  const arr = Array.isArray(data) ? data : (data.items || []);
  return arr.map(mapMealDoc).map(m => ({ ...m, _n: norm(m.name) }));
}
async function apiGetMeal(id) {
  return apiJson(`/api/meals/${encodeURIComponent(id)}`);
}

// ====== SUMY
export const mealTotals = (meal) => meal.items.reduce((s, it) => ({
  kcal: s.kcal + (+it.kcal || 0),
  protein: s.protein + (+it.protein || 0),
  fat: s.fat + (+it.fat || 0),
  carbs: s.carbs + (+it.carbs || 0),
}), { kcal: 0, protein: 0, fat: 0, carbs: 0 });

export const dayTotals = (meals) => meals.reduce((acc, m) => {
  const t = mealTotals(m);
  acc.kcal += t.kcal; acc.protein += t.protein; acc.fat += t.fat; acc.carbs += t.carbs;
  return acc;
}, { kcal: 0, protein: 0, fat: 0, carbs: 0 });

// ====== UI — paski sum dnia
function renderSummaryDay(sumBox, totals, targets) {
  const rows = [
    ["kcal", totals.kcal,    toNum(targets.kcal, 0),    "kcal"],
    ["B",    totals.protein, toNum(targets.protein, 0), "g"],
    ["T",    totals.fat,     toNum(targets.fat, 0),     "g"],
    ["W",    totals.carbs,   toNum(targets.carbs, 0),   "g"],
  ].map(([label, val, target, unit]) => buildMacroRow(label, val, target, unit)).join("");
  sumBox.innerHTML = `<div class="sumrows">${rows}</div>`;
}
function buildMacroRow(label, value, target, unit) {
  const pct = target > 0 ? (value / target) * 100 : 0;
  const width = Math.max(0, Math.min(100, pct));
  const overflow = Math.max(0, pct - 100);
  const t = Math.max(0, Math.min(1, overflow / 50)); // 100–150% → 0..1
  const color = `color-mix(in oklab, var(--cal-accent) ${Math.round((1 - t) * 100)}%, var(--danger-500, #ef4444) ${Math.round(t * 100)}%)`;
  return `
    <div class="sumrow${pct > 100 ? ' over' : ''}">
      <div class="sumrow-head">
        <span class="sumrow-label">${label}</span>
        <span class="sumrow-num"><span class="num">${Math.round(value)}</span> / ${target || "—"} ${unit}</span>
      </div>
      <div class="sumrow-bar">
        <div class="sumrow-fill" style="width:${width}%; background:${color}"></div>
      </div>
    </div>
  `;
}

// ====== render
const dayNamesShort = ["Pon", "Wt", "Śr", "Czw", "Pt", "Sob", "Niedz"];
const dayNamesFull  = ["Poniedziałek", "Wtorek", "Środa", "Czwartek", "Piątek", "Sobota", "Niedziela"];

function renderHeaderDays() {
  const todayISO = toLocalISO(new Date());
  const days = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(currentMonday);
    d.setDate(d.getDate() + i);
    const iso = toLocalISO(d);
    const label = `${dayNamesShort[i]} ${d.toLocaleDateString("pl-PL", { day: "2-digit", month: "2-digit" })}`;
    days.push({ iso, label, isToday: iso === todayISO, isSelected: selectedDayISO === iso });
  }
  elDays.innerHTML = days.map(({ iso, label, isToday, isSelected }) =>
    `<button class="day-chip${isToday ? " is-today" : ""}${isSelected ? " is-selected" : ""}"
             data-cal-day="${iso}" aria-label="Data ${label}" aria-pressed="${isSelected}">${label}</button>`
  ).join("");
}

export async function render() {
  const weekISO = toLocalISO(currentMonday);
  const data = await loadWeekFromAPI(weekISO);

  renderHeaderDays();

  elGrid.innerHTML = "";

  let idx = weekdayIndexFromISO(selectedDayISO);
  if (idx < 0 || idx > 6) { idx = 0; selectedDayISO = isoFromWeekdayIndex(0); }

  const d = new Date(currentMonday);
  d.setDate(d.getDate() + idx);
  const iso     = toLocalISO(d);
  const meals   = data[iso];
  const isToday = iso === toLocalISO(new Date());
  const dtTitle = d.toLocaleDateString("pl-PL", { day: "2-digit", month: "2-digit" });

  // podsumowanie dnia
  const dayTotalsNow = dayTotals(meals);
  const sumBox = document.querySelector(".week-summary");
  if (sumBox) renderSummaryDay(sumBox, dayTotalsNow, USER_TARGETS);

  // karta dnia
  const card = document.createElement("article");
  card.className = "day-card";
  if (isToday) card.classList.add("is-today");
  card.dataset.date = iso;
  card.setAttribute("role", "listitem");
  card.innerHTML = `
    <div class="day-head">
      <div class="day-title">${dayNamesFull[idx]}</div>
      <div class="day-date${isToday ? " is-today" : ""}">${dtTitle}</div>
    </div>
    <div class="day-totals">
      <span class="chip">kcal: <strong class="num" data-day-kcal>0</strong></span>
      <span class="chip">B: <strong class="num" data-day-protein>0</strong> g</span>
      <span class="chip">T: <strong class="num" data-day-fat>0</strong> g</span>
      <span class="chip">W: <strong class="num" data-day-carbs>0</strong> g</span>
    </div>
    <div class="meals"></div>
    <div class="day-tools">
      <button class="btn-small" data-clear-day>Wyczyść</button>
      <button class="btn-small" data-copy-open>Skopiuj…</button>
      <button class="btn-small" data-shop-open>Lista zakupów…</button>
    </div>
  `;

  const totals = dayTotals(meals);
  card.querySelector("[data-day-kcal]").textContent    = Math.round(totals.kcal);
  card.querySelector("[data-day-protein]").textContent = Math.round(totals.protein);
  card.querySelector("[data-day-fat]").textContent     = Math.round(totals.fat);
  card.querySelector("[data-day-carbs]").textContent   = Math.round(totals.carbs);

  const mealsWrap = card.querySelector(".meals");

  meals.forEach((meal, mealIndex) => {
    const mt = mealTotals(meal);
    const det = document.createElement("details");
    det.className = "meal";
    det.dataset.mealIndex = String(mealIndex);
    det.dataset.slot = meal.name;

    det.innerHTML = `
      <summary>
        <span class="meal-name">${meal.name}</span>
        <span>
          <span class="meal-kcal num">${Math.round(mt.kcal)} kcal</span>
          <span class="meal-macro"> • B ${Math.round(mt.protein)}g • T ${Math.round(mt.fat)}g • W ${Math.round(mt.carbs)}g</span>
        </span>
      </summary>
      <div class="meal-body">
        <div class="food-list"></div>
        <div class="add-controls">
          <button class="btn-small" data-open-add="db">Dodaj z bazy</button>
          <button class="btn-small" data-open-add="quick">Szybkie dodawanie</button>
          <button class="btn-small ai" data-open-add="ai" disabled title="Wkrótce">Asystent AI</button>
        </div>
        <div class="add-panel" data-add-panel hidden>
          <div class="add-panel-inner" data-panel="db" hidden>
            <div class="db-search">
              <input name="db-q" placeholder="Nazwa produktu lub dania..." autocomplete="off" />
              <input name="db-g" inputmode="decimal" placeholder="Waga (g)" />
              <button class="btn-small primary" data-db-add-direct>Dodaj</button>
            </div>
            <div class="db-results" data-db-results></div>
          </div>
          <div class="add-panel-inner" data-panel="quick" hidden>
            <div class="muted-note">Na 100 g + waga porcji (g):</div>
            <div class="form-row">
              <input name="q-name" placeholder="Nazwa" />
              <input name="q-kcal100" inputmode="decimal" placeholder="kcal / 100 g" />
              <input name="q-protein100" inputmode="decimal" placeholder="B / 100 g" />
              <input name="q-fat100" inputmode="decimal" placeholder="T / 100 g" />
              <input name="q-carbs100" inputmode="decimal" placeholder="W / 100 g" />
              <input name="q-weight" inputmode="decimal" placeholder="Waga (g)" />
            </div>
            <div class="add-actions">
              <button class="btn-small primary" data-quick-submit>Dodaj</button>
              <button class="btn-small" data-quick-clear>Wyczyść</button>
            </div>
          </div>
          <div class="add-panel-inner" data-panel="ai" hidden>
            <div class="muted-note">Asystent AI — w przygotowaniu 🔧</div>
          </div>
        </div>
      </div>
    `;

    // lista pozycji
    const list = det.querySelector(".food-list");
    (meal.items || []).forEach((it, itemIndex) => {
      const row = document.createElement("div");
      row.className = "food-item";
      row.dataset.itemIndex = String(itemIndex);
      if (it.id) row.dataset.itemId = String(it.id);
      if (it.productId) row.dataset.productId = String(it.productId);
      if (it.grams != null) row.dataset.grams = String(it.grams);

      row.innerHTML = `
        <div class="name">
          <span class="label">${it.name}</span>${it.grams ? ` — ${Math.round(it.grams)} g` : ''}
        </div>
        <div class="num kcal">${Math.round(it.kcal || 0)} kcal</div>
        <div class="num protein">B ${Math.round(it.protein || 0)} g</div>
        <div class="num fat">T ${Math.round(it.fat || 0)} g</div>
        <div class="num carbs">W ${Math.round(it.carbs || 0)} g</div>
        <button class="food-edit" title="Edytuj wagę" aria-label="Edytuj" data-edit>✎</button>
        <button class="food-remove" title="Usuń" aria-label="Usuń pozycję" data-remove>×</button>
      `;

      list.appendChild(row);
    });

    mealsWrap.appendChild(det);
  });

  elGrid.appendChild(card);

  setupAutocompleteForAllDbInputs();
}

// ====== Helpers UI
function toNum(v, def = 0) {
  const n = parseFloat(String(v ?? "").replace(",", "."));
  return Number.isFinite(n) ? n : def;
}
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
function escapeHtml(s) { return String(s ?? '').replace(/[&<>"']/g, c => ESC[c]); }
function norm(str) {
  return String(str ?? '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
}
function hintMacros(p) {
  const a = [];
  if (Number.isFinite(p.kcal100)) a.push(`${p.kcal100} kcal/100g`);
  if (Number.isFinite(p.p100))    a.push(`${p.p100} B`);
  if (Number.isFinite(p.f100))    a.push(`${p.f100} T`);
  if (Number.isFinite(p.c100))    a.push(`${p.c100} W`);
  return a.join(' • ');
}
function debounce(fn, ms = 250) { let t; return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); }; }

// ====== Autocomplete
const AC_STATE = new WeakMap();

function setupAutocompleteForAllDbInputs() {
  document.querySelectorAll('[data-panel="db"] input[name="db-q"]').forEach(setupAutocompleteForInput);
}
function setupAutocompleteForInput(inp) {
  if (AC_STATE.has(inp)) return;

  const box = document.createElement('div');
  box.className = 'ac-panel';
  box.hidden = true;
  box.style.position = 'fixed';
  box.style.zIndex = '10000';
  document.body.appendChild(box);

  const place = () => {
    const r = inp.getBoundingClientRect();
    box.style.left = `${r.left}px`;
    box.style.top  = `${r.bottom + 4}px`;
    box.style.width = `${r.width}px`;
  };
  const placeDebounced = (() => { let t; return () => { clearTimeout(t); t = setTimeout(place, 0); }; })();
  window.addEventListener('scroll', placeDebounced, { passive: true });
  document.addEventListener('scroll', placeDebounced, { passive: true, capture: true });
  window.addEventListener('resize', placeDebounced);
  inp.addEventListener('focus', place);
  inp.addEventListener('input', place);

  AC_STATE.set(inp, { box, suggestions: [], highlightedIndex: -1, selected: null });

  inp.addEventListener('input', debounce(() => onAcInput(inp)));
  inp.addEventListener('keydown', (e) => onAcKeydown(e, inp));
  inp.addEventListener('focus', () => { place(); showAc(inp); });
  inp.addEventListener('blur', () => setTimeout(() => hideAc(inp), 150));
}
function onAcInput(inp) {
  const st = AC_STATE.get(inp);
  if (!st) return;
  st.selected = null;
  const q = norm(inp.value);
  const hay = COMBINED_CACHE;
  st.suggestions = q ? hay.filter(x => x._n.includes(q)).slice(0, 12) : hay.slice(0, 10);
  st.highlightedIndex = -1;
  renderAc(inp);
  showAc(inp);
}
function renderAc(inp) {
  const st = AC_STATE.get(inp);
  if (!st) return;
  const box = st.box;
  box.innerHTML = '';
  if (!st.suggestions.length) { hideAc(inp); return; }

  st.suggestions.forEach((s, i) => {
    const row = document.createElement('div');
    row.className = 'ac-item';
    row.dataset.id = s.id;
    row.dataset.kind = s.kind;

    const icon = s.kind === 'meal' ? '🍽️' : '🧺';
    const name = document.createElement('div');
    const extra = s.kind === 'product' && s.category ? ` <span class="ac-muted">— ${escapeHtml(s.category)}</span>` : '';
    name.innerHTML = `${icon} <strong>${escapeHtml(s.name)}</strong>${extra}`;

    const meta = document.createElement('div');
    meta.className = 'ac-muted';
    meta.textContent = s.kind === 'product' ? hintMacros(s) : 'Danie';

    row.appendChild(name);
    row.appendChild(meta);

    row.addEventListener('mouseenter', () => { st.highlightedIndex = i; updateAcHighlight(inp); });
    row.addEventListener('mousedown', ev => ev.preventDefault());
    row.addEventListener('click', () => pickAc(inp, s));

    box.appendChild(row);
  });

  updateAcHighlight(inp);
}
function updateAcHighlight(inp) {
  const st = AC_STATE.get(inp);
  const box = st.box;
  [...box.children].forEach((el, idx) => el.classList.toggle('is-active', idx === st.highlightedIndex));
}
function pickAc(inp, item) {
  const st = AC_STATE.get(inp);
  if (!st) return;
  st.selected = { id: item.id, kind: item.kind };
  inp.value = item.name;
  hideAc(inp);
}
function showAc(inp) {
  const st = AC_STATE.get(inp);
  if (st && st.suggestions.length) st.box.hidden = false;
}
function hideAc(inp) {
  const st = AC_STATE.get(inp);
  if (st) st.box.hidden = true;
}
function onAcKeydown(e, inp) {
  const st = AC_STATE.get(inp);
  const open = st && st.suggestions.length && st.box && !st.box.hidden;
  if (e.key === 'ArrowDown' && open) {
    e.preventDefault();
    st.highlightedIndex = (st.highlightedIndex + 1) % st.suggestions.length;
    updateAcHighlight(inp);
  } else if (e.key === 'ArrowUp' && open) {
    e.preventDefault();
    st.highlightedIndex = (st.highlightedIndex - 1 + st.suggestions.length) % st.suggestions.length;
    updateAcHighlight(inp);
  } else if (e.key === 'Enter' && open) {
    e.preventDefault();
    pickAc(inp, st.suggestions[Math.max(0, st.highlightedIndex)]);
  } else if (e.key === 'Escape') {
    hideAc(inp);
  }
}

// ==== Modal helper (spójny ze stylem pozostałych) ============================
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

// ==== „Wyczyść…” — dialog + wykonanie ========================================
function openClearDialog(sourceISO){
  const mealOpts = [ opt('all','Cały dzień'), ...MEALS.map((m,i)=>opt(`slot:${i}`, m)) ].join('');
  const html = `
    <div class="form-grid">
      <label class="form-field">
        <span>Zakres do wyczyszczenia</span>
        <select name="clear-scope">${mealOpts}</select>
      </label>
    </div>
    <div class="muted-note">
      Usunę pozycje z dnia <strong>${sourceISO}</strong>. Wybierz czy wyczyścić cały dzień czy tylko wybrany posiłek.
    </div>
  `;
  const { dlg, close } = openDialog({
    title: 'Wyczyść',
    content: html,
    onOpen: ({ dlg }) => {
      dlg.querySelector('.dlg-actions').innerHTML =
        `<button class="btn-small primary" data-clear-confirm>Wyczyść</button>`;
    }
  });

  dlg.addEventListener('click', async (e) => {
    const t = e.target;
    if (!(t instanceof HTMLElement)) return;
    if (t.matches('[data-dlg-close],[data-dlg-cancel]')) { e.preventDefault(); return close(); }
    if (t.matches('[data-clear-confirm]')) {
      e.preventDefault();
      const scope = dlg.querySelector('[name="clear-scope"]')?.value || 'all';
      try {
        await performClear({ sourceISO, scope });
        close();
        await render();
      } catch (err) {
        alert('Błąd czyszczenia: ' + err.message);
      }
    }
  }, { passive:false });
}

async function performClear({ sourceISO, scope }){
  // 1) Cały dzień
  if (scope === 'all') {
    try { 
      await apiClearDay(sourceISO); 
      return;
    } catch (e) {
      // fallback lokalny
      const wISO = toLocalISO(mondayOfWeek(new Date(sourceISO)));
      const data = (function(){
        const raw = localStorage.getItem(`${"czyziu:calendar:v1:"}${(localStorage.getItem("cm:userId")||localStorage.getItem("userId")||localStorage.getItem("uid")||"guest")}:${wISO}`);
        if (raw) { try { return JSON.parse(raw); } catch {} }
        return {};
      })();
      data[sourceISO] = MEALS.map(name => ({ name, items: [] }));
      localStorage.setItem(`czyziu:calendar:v1:${(localStorage.getItem("cm:userId")||localStorage.getItem("userId")||localStorage.getItem("uid")||"guest")}:${wISO}`, JSON.stringify(data));
      return;
    }
  }

  // 2) Tylko wybrany posiłek (slot)
  if (scope.startsWith('slot:')) {
    const idx = Number(scope.split(':')[1] || 0);
    try {
      const wISO = toLocalISO(mondayOfWeek(new Date(sourceISO)));
      const week = await loadWeekFromAPI(wISO);
      const meals = week[sourceISO] || [];
      const slot = meals[idx];
      if (slot && Array.isArray(slot.items)) {
        for (const it of slot.items) {
          const id = it.id || it._id;
          if (id) { try { await apiDeleteItem(sourceISO, slot.name, id); } catch {} }
        }
      }
    } catch (e) {
      // fallback lokalny: wyczyść listę items danego slotu
      const wISO = toLocalISO(mondayOfWeek(new Date(sourceISO)));
      const rawKey = `czyziu:calendar:v1:${(localStorage.getItem("cm:userId")||localStorage.getItem("userId")||localStorage.getItem("uid")||"guest")}:${wISO}`;
      const raw = localStorage.getItem(rawKey);
      if (raw) {
        try {
          const data = JSON.parse(raw);
          if (data[sourceISO] && data[sourceISO][idx]) {
            data[sourceISO][idx].items = [];
            localStorage.setItem(rawKey, JSON.stringify(data));
          }
        } catch {}
      }
    }
  }
}




// ====== obsługa klików (bez kopiuj/lista – te obsłuży moduł shopping)
document.addEventListener("click", async (ev) => {
  const t = ev.target;
  if (!(t instanceof HTMLElement)) return;

  // edycja
  if (t.matches("[data-edit]")) {
    ev.preventDefault();
    const row  = t.closest(".food-item");
    const det  = t.closest("details.meal");
    const card = t.closest(".day-card");
    if (!row || !det || !card) return;

    const dbBtn = det.querySelector('[data-open-add="db"]');
    if (dbBtn) dbBtn.click();

    const panel   = det.querySelector('[data-panel="db"]');
    const nameInp = panel.querySelector('input[name="db-q"]');
    const gramsInp= panel.querySelector('input[name="db-g"]');
    const addBtn  = panel.querySelector('[data-db-add-direct]');

    const nameText = row.querySelector('.name .label')?.textContent?.trim() || "";
    const gramsVal = Number(row.dataset.grams || 0);

    nameInp.value = nameText;
    gramsInp.value = gramsVal > 0 ? String(gramsVal) : "";

    panel.dataset.editItemId = row.dataset.itemId || "";
    panel.dataset.editProductId = row.dataset.productId || "";

    let st = AC_STATE.get(nameInp);
    if (!st) { setupAutocompleteForInput(nameInp); st = AC_STATE.get(nameInp); }
    if (st) { st.selected = { id: row.dataset.productId, kind: 'product' }; }

    if (addBtn) addBtn.textContent = "Zapisz";
    return;
  }
  if (t.closest(".food-item") && t.matches(".name, .name *")) {
    const editBtn = t.closest(".food-item").querySelector('[data-edit]');
    if (editBtn) editBtn.click();
    return;
  }

  // nawigacja
 if (t.matches("[data-clear-day]")) {
  ev.preventDefault();
  const dayISO = t.closest(".day-card")?.dataset.date || getSelectedDayISO();
  openClearDialog(dayISO);
  return;
}
  if (t.matches('[data-cal="next"]')) {
    ev.preventDefault();
    const keepIdx = weekdayIndexFromISO(selectedDayISO);
    currentMonday.setDate(currentMonday.getDate() + 7);
    selectedDayISO = isoFromWeekdayIndex(Math.max(0, Math.min(6, keepIdx)));
    await render();
    return;
  }
  if (t.matches("[data-cal-day]")) {
    ev.preventDefault();
    selectedDayISO = t.getAttribute("data-cal-day");
    await render();
    return;
  }

  // panele dodawania
  if (t.matches("[data-open-add]")) {
    ev.preventDefault();
    const mode = t.getAttribute("data-open-add");
    const det = t.closest("details.meal");
    if (!det) return;
    const panelWrap = det.querySelector("[data-add-panel]");
    const buttons = det.querySelectorAll("[data-open-add]");
    buttons.forEach(btn => btn.classList.toggle("primary", btn.getAttribute("data-open-add") === mode));

    if (panelWrap) {
      panelWrap.hidden = false;
      panelWrap.querySelectorAll(".add-panel-inner").forEach(x => x.hidden = x.getAttribute("data-panel") !== mode);
      if (mode === "db") {
        const dbInner = panelWrap.querySelector('[data-panel="db"]');
        if (dbInner) {
          delete dbInner.dataset.selectedId;
          delete dbInner.dataset.selectedType;
          delete dbInner.dataset.editItemId;
          delete dbInner.dataset.editProductId;

          const name = dbInner.querySelector('input[name="db-q"]');
          const grams = dbInner.querySelector('input[name="db-g"]');
          const box = dbInner.querySelector('[data-db-results]');
          if (name) {
            name.value = "";
            const st = AC_STATE.get(name);
            if (st) { st.selected = null; st.suggestions = []; st.highlightedIndex = -1; renderAc(name); }
            setupAutocompleteForInput(name);
          }
          if (grams) grams.value = "";
          if (box) box.innerHTML = "";
          const addBtn = dbInner.querySelector('[data-db-add-direct]');
          if (addBtn) addBtn.textContent = "Dodaj";
        }
      }
    }
    det.open = true;
    return;
  }

  // dodaj z bazy / zapisz
  if (t.matches("[data-db-add-direct]")) {
    ev.preventDefault();
    const det  = t.closest("details.meal");
    const card = t.closest(".day-card");
    if (!det || !card) return;

    const dayISO    = card.dataset.date;
    const mealIndex = Number(det.dataset.mealIndex);
    const slotName  = det.dataset.slot;

    const dbInner   = det.querySelector('[data-panel="db"]');
    const nameEl    = dbInner.querySelector('input[name="db-q"]');
    const gramsEl   = dbInner.querySelector('input[name="db-g"]');
    const resultsBox= dbInner.querySelector('[data-db-results]');
    const grams     = toNum(gramsEl.value);
    const nameStr   = (nameEl.value || '').trim();

    if (!nameStr) { resultsBox.innerHTML = '<div class="muted-note">Podaj nazwę.</div>'; nameEl.focus(); return; }
    if (!(grams > 0)) { resultsBox.innerHTML = '<div class="muted-note">Podaj prawidłową wagę (g).</div>'; gramsEl.focus(); return; }

    const st = AC_STATE.get(nameEl);
    let selected = st?.selected || null;

    if (!selected) {
      const q = norm(nameStr);
      const match = COMBINED_CACHE.find(x => x._n.includes(q));
      if (match) selected = { id: match.id, kind: match.kind };
    }
    if (!selected && !dbInner.dataset.editItemId) {
      resultsBox.innerHTML = '<div class="muted-note">Wybierz z podpowiedzi.</div>';
      nameEl.focus();
      return;
    }

    const isEdit = !!dbInner.dataset.editItemId;
    const editItemId = dbInner.dataset.editItemId || null;
    const editProductId = dbInner.dataset.editProductId || null;

    try {
      if (isEdit) {
        await apiUpdateItem(dayISO, slotName, editItemId, { grams, productId: editProductId });
      } else if (selected.kind === 'product') {
        await apiAddItem(dayISO, slotName, { productId: selected.id, grams });
      } else {
        // danie → rozbij na składniki i dodaj proporcjonalnie
        let meal = MEALS_CACHE.find(m => m.id === selected.id);
        if (!meal || !Array.isArray(meal.ingredients) || meal.ingredients.length === 0) {
          meal = await apiGetMeal(selected.id);
          const mi = MEALS_CACHE.findIndex(m => m.id === meal.id);
          if (mi >= 0) MEALS_CACHE[mi] = meal; else MEALS_CACHE.unshift(meal);
        }
        if (!meal.ingredients || meal.ingredients.length === 0) {
          resultsBox.innerHTML = '<div class="muted-note">To danie nie ma zdefiniowanych składników.</div>';
          return;
        }
        const totalWeight = meal.postWeight && meal.postWeight > 0
          ? meal.postWeight
          : meal.ingredients.reduce((s, it) => s + toNum(it.grams), 0);
        const scale = totalWeight > 0 ? (grams / totalWeight) : 1;
        for (const ing of meal.ingredients) {
          const g = Math.max(1, Math.round(toNum(ing.grams) * scale));
          await apiAddItem(dayISO, slotName, { productId: ing.productId, grams: g });
        }
      }
    } catch (e) {
      resultsBox.innerHTML = `<div class="muted-note">Błąd dodawania: ${e.message}</div>`;
      return;
    }

    await render();
    setTimeout(() => {
      const day = document.querySelector(`.day-card[data-date="${dayISO}"]`);
      const detAgain = day?.querySelector(`details.meal[data-meal-index="${mealIndex}"]`);
      detAgain?.setAttribute('open', 'true');
      const panelAgain = detAgain?.querySelector('[data-panel="db"]');
      const addBtnAgain = panelAgain?.querySelector('[data-db-add-direct]');
      if (panelAgain) {
        delete panelAgain.dataset.editItemId;
        delete panelAgain.dataset.editProductId;
      }
      if (addBtnAgain) addBtnAgain.textContent = "Dodaj";
    }, 0);
    return;
  }

  // szybkie dodawanie
  if (t.matches("[data-quick-submit]")) {
    ev.preventDefault();
    const det  = t.closest("details.meal");
    const card = t.closest(".day-card");
    if (!det || !card) return;

    const dayISO    = card.dataset.date;
    const mealIndex = Number(det.dataset.mealIndex);
    const slotName  = det.dataset.slot;

    const panel = det.querySelector('[data-panel="quick"]');
    const get = (name) => panel.querySelector(`[name="${name}"]`);
    const name    = (get("q-name").value || "Pozycja").trim();
    const kcal100 = toNum(get("q-kcal100").value, null);
    const p100    = toNum(get("q-protein100").value, null);
    const f100    = toNum(get("q-fat100").value, null);
    const c100    = toNum(get("q-carbs100").value, null);
    const weight  = toNum(get("q-weight").value);

    if (!name) { get("q-name").focus(); return; }
    if (!(weight > 0)) { get("q-weight").focus(); return; }

    try {
      const exist = await apiJson(`/api/products?q=${encodeURIComponent(name)}&scope=mine&page=1&pageSize=5`);
      const items = Array.isArray(exist) ? exist : (exist.items || []);
      let prod = items.find(p => (p.name || '').trim().toLowerCase() === name.toLowerCase());
      if (!prod) {
        prod = await apiJson(`/api/products`, {
          method: 'POST',
          body: JSON.stringify({ name, category: 'Gotowe / przetworzone', kcal100, p100, f100, c100 })
        });
      }
      await apiAddItem(dayISO, slotName, { productId: prod._id || prod.id, grams: weight });

      const mapped = mapProductForCache(prod);
      const idxP = PRODUCTS_CACHE.findIndex(p => p.id === mapped.id);
      if (idxP >= 0) PRODUCTS_CACHE[idxP] = { ...PRODUCTS_CACHE[idxP], ...mapped };
      else PRODUCTS_CACHE.unshift(mapped);
      const idxC = COMBINED_CACHE.findIndex(x => x.kind === 'product' && x.id === mapped.id);
      if (idxC >= 0) COMBINED_CACHE[idxC] = { ...COMBINED_CACHE[idxC], ...mapped };
      else COMBINED_CACHE.unshift({ kind: 'product', ...mapped });

    } catch (e) {
      console.warn("Quick add failed:", e.message);
    }

    await render();
    setTimeout(() => {
      const day = document.querySelector(`.day-card[data-date="${dayISO}"]`);
      day?.querySelector(`details.meal[data-meal-index="${mealIndex}"]`)?.setAttribute('open', 'true');
    }, 0);
    return;
  }
  if (t.matches("[data-quick-clear]")) {
    ev.preventDefault();
    const panel = t.closest('[data-panel="quick"]');
    panel?.querySelectorAll("input").forEach(inp => inp.value = "");
    return;
  }

  // usuń
  if (t.matches("[data-remove]")) {
    ev.preventDefault();
    const row  = t.closest(".food-item");
    const det  = t.closest("details.meal");
    const card = t.closest(".day-card");
    if (!row || !det || !card) return;

    const dayISO    = card.dataset.date;
    const mealIndex = Number(det.dataset.mealIndex);
    const slotName  = det.dataset.slot;

    const itemId = row.dataset.itemId;
    if (itemId) {
      try { await apiDeleteItem(dayISO, slotName, itemId); }
      catch (e) { console.warn("apiDeleteItem failed:", e.message); }
    } else {
      const weekISO = toLocalISO(currentMonday);
      const data = loadWeekLocal(weekISO);
      const idx = Number(row.dataset.itemIndex);
      data[dayISO][mealIndex].items.splice(idx, 1);
      saveWeekLocal(weekISO, data);
    }
    await render();
    setTimeout(() => {
      const day = document.querySelector(`.day-card[data-date="${dayISO}"]`);
      day?.querySelector(`details.meal[data-meal-index="${mealIndex}"]`)?.setAttribute('open', 'true');
    }, 0);
    return;
  }

  // wyczyść dzień (bez popupu – zgodnie z Twoją wersją)
  if (t.matches("[data-clear-day]")) {
    ev.preventDefault();
    const dayISO = t.closest(".day-card")?.dataset.date;
    if (!dayISO) return;
    try { await apiClearDay(dayISO); }
    catch (e) {
      const weekISO = toLocalISO(currentMonday);
      const data = loadWeekLocal(weekISO);
      data[dayISO] = MEALS.map(name => ({ name, items: [] }));
      saveWeekLocal(weekISO, data);
    }
    await render();
    return;
  }
});

// ====== start
(async function init() {
  try {
    USER_TARGETS = await loadUserTargets();
    const [prods, meals] = await Promise.all([ apiListProducts(), apiListMeals() ]);
    PRODUCTS_CACHE = prods.sort((a, b) => a.name.localeCompare(b.name, 'pl'));
    MEALS_CACHE    = meals.sort((a, b) => a.name.localeCompare(b.name, 'pl'));
    COMBINED_CACHE = [
      ...PRODUCTS_CACHE.map(p => ({ kind: 'product', ...p })),
      ...MEALS_CACHE.map(m => ({ kind: 'meal', ...m }))
    ].sort((a, b) => a.name.localeCompare(b.name, 'pl'));
  } catch (e) {
    console.error('Init lists/targets failed', e);
    PRODUCTS_CACHE = [];
    MEALS_CACHE = [];
    COMBINED_CACHE = [];
    USER_TARGETS = { kcal: 0, protein: 0, fat: 0, carbs: 0 };
  }
  render();
})();

// ====== eksporty przydatne dla modułu shopping
export function resolveName(productId){
  const hit = (PRODUCTS_CACHE || []).find(p => String(p.id) === String(productId));
  return hit ? hit.name : `Produkt ${productId}`;
}
