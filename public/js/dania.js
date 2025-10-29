// dania.js — tworzenie i zarządzanie daniami (kalkulacja makro na porcję i łącznie)

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
const API_MEALS    = '/api/meals';

// ======= Adapter API =======
const api = {
  // Produkty do autouzupełniania
  async listProducts() {
    const r = await fetch(`${API_PRODUCTS}?page=1&pageSize=1000&scope=all`, { headers: authHeaders() });
    if (!r.ok) return [];
    const data = await r.json();
    const arr = Array.isArray(data) ? data : (data.items || []);
    return arr.map(mapProductDoc);
  },

  // Dania
  async listMeals() {
    const r = await fetch(`${API_MEALS}?page=1&pageSize=1000`, { headers: authHeaders() });
    if (!r.ok) return [];
    const data = await r.json();
    const arr = Array.isArray(data) ? data : (data.items || []);
    return arr.map(mapMealDoc);
  },
  async createMeal(payload) {
    const r = await fetch(API_MEALS, { method: 'POST', headers: authHeaders(), body: JSON.stringify(payload) });
    if (!r.ok) throw new Error('Nie udało się dodać dania');
    return mapMealDoc(await r.json());
  },
  async updateMeal(id, payload) {
    const r = await fetch(`${API_MEALS}/${id}`, { method: 'PATCH', headers: authHeaders(), body: JSON.stringify(payload) });
    if (!r.ok) throw new Error('Nie udało się zaktualizować dania');
    return mapMealDoc(await r.json());
  },
  async removeMeal(id) {
    const r = await fetch(`${API_MEALS}/${id}`, { method: 'DELETE', headers: authHeaders() });
    if (!r.ok) throw new Error('Nie udało się usunąć dania');
    return true;
  },
};

function mapProductDoc(doc) {
  return {
    id: doc._id || doc.id,
    name: String(doc.name || ''),
    category: doc.category || '',
    kcal100: num(doc.kcal100),
    p100:   num(doc.p100),
    f100:   num(doc.f100),
    c100:   num(doc.c100),
  };
}
function mapMealDoc(doc) {
  // doc.ingredients: [{ productId, grams, product? }]
  const base = { 
    id: doc._id || doc.id,
    name: doc.name || '',
    category: doc.category || '',
    portions: Math.max(1, Number(doc.portions || 1)),
    postWeight: Number(doc.postWeight || 0) || 0,
    recipe: doc.recipe || '',
    isPublic: Boolean(doc.isPublic),
    ingredients: Array.isArray(doc.ingredients) ? doc.ingredients.map(x => ({
      productId: x.productId || x.product?._id || x.product?.id || null,
      grams: Number(x.grams || 0),
      product: x.product ? mapProductDoc(x.product) : null,
    })) : [],
  };
  return base;
}

const num = (v) => (v === null || v === undefined ? null : Number(v));

// ======= STAN =======
let products = [];
let meals = [];
let filteredMeals = [];
let page = 1;
const PAGE_SIZE = 10;

let editMeal = null; // { id|null, name, category, portions, ingredients: [{productId, grams}] }
let ingRows = [];    // UI stan dla wierszy składników

// ======= DOM =======
const $ = (id) => document.getElementById(id);

const mealFormCard   = $('mealFormCard');
const mealListCard   = $('mealListCard');
const mealForm       = $('mealForm');
const mealFormTitle  = $('mealFormTitle');
const mealCancelBtn  = $('mealCancelBtn');
const addIngBtn      = $('addIngBtn');
const ingTbody       = $('ingTbody');
const ingEmpty       = $('ingEmpty');
const mealSummary    = $('mealSummary');

const openAddMealBtn = $('openAddMealBtn');
const mealSearch     = $('mealSearch');
const mealTbody      = $('mealTbody');
const mealEmpty      = $('mealEmpty');
const prevMealPage   = $('prevMealPage');
const nextMealPage   = $('nextMealPage');
const mealPageList   = $('mealPageList');
const mealPagerInfo  = $('mealPagerInfo');

// Modal podglądu
const previewModal = document.getElementById('previewModal');
const previewBody  = document.getElementById('previewBody');


// Zamknięcie modala (przycisk + tło)
previewModal?.addEventListener('click', (e) => {
  const closer = e.target.closest('[data-close]');
  if (closer) {
    e.preventDefault();
    closePreview();
  }
});

// ESC zamyka podgląd
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !previewModal.hidden) closePreview();
});

// ======= Helpers =======
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, c => ESC[c]);
const round1 = (x) => Math.round(x * 10) / 10;
const round0 = (x) => Math.round(x);
const fmt = (x) => Number.isFinite(x) ? String(x) : '—';
const norm = (str) => String(str ?? '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();

// ======= Autocomplete (dla wiersza składnika) =======
function attachAutocomplete(input, onPick) {
  let panel = document.createElement('div');
  panel.className = 'ac-panel';
  panel.hidden = true;
  input.parentElement.style.position = input.parentElement.style.position || 'relative';
  input.parentElement.style.overflow = 'visible';
  input.parentElement.appendChild(panel);

  let current = [];
  let idx = -1;

  function render() {
    panel.innerHTML = '';
    if (!current.length) { panel.hidden = true; return; }
    current.forEach((p, i) => {
      const row = document.createElement('div');
      row.className = 'ac-item';
      row.dataset.id = p.id;
      row.innerHTML = `<div><strong>${escapeHtml(p.name)}</strong>${p.category ? ` <span class="ac-muted">— ${escapeHtml(p.category)}</span>` : ''}</div>
                       <div class="ac-muted">${hintMacros(p)}</div>`;
      row.addEventListener('mouseenter', () => { idx = i; updateHighlight(); });
      row.addEventListener('mousedown', ev => ev.preventDefault());
      row.addEventListener('click', () => { onPick(p); hide(); });
      panel.appendChild(row);
    });
    updateHighlight();
    panel.hidden = false;
  }
  function updateHighlight() {
    [...panel.children].forEach((el, i) => el.classList.toggle('is-active', i === idx));
  }
  function hide() { panel.hidden = true; }
  function search() {
    const q = norm(input.value);
    const hay = products.map(p => ({ ...p, _n: norm(p.name + ' ' + (p.category || '')) }));
    current = q ? hay.filter(p => p._n.includes(q)).slice(0, 12) : hay.slice(0, 10);
    idx = -1; render();
  }

  input.addEventListener('input', search);
  input.addEventListener('focus', search);
  input.addEventListener('keydown', (e) => {
    const has = current.length && !panel.hidden;
    if (e.key === 'ArrowDown' && has) { e.preventDefault(); idx = (idx + 1) % current.length; updateHighlight(); }
    else if (e.key === 'ArrowUp' && has) { e.preventDefault(); idx = (idx - 1 + current.length) % current.length; updateHighlight(); }
    else if (e.key === 'Enter') { if (has) { e.preventDefault(); onPick(current[Math.max(0, idx)]); hide(); } }
    else if (e.key === 'Escape') hide();
  });
  document.addEventListener('click', (e) => { if (!input.contains(e.target) && !panel.contains(e.target)) hide(); });

  return { hide };
}

function hintMacros(p) {
  const a = [];
  if (Number.isFinite(p.kcal100)) a.push(`${p.kcal100} kcal/100g`);
  if (Number.isFinite(p.p100))    a.push(`${p.p100} B`);
  if (Number.isFinite(p.f100))    a.push(`${p.f100} T`);
  if (Number.isFinite(p.c100))    a.push(`${p.c100} W`);
  return a.join(' • ');
}

// ======= Kalkulacje =======
function calcForIngredient(grams, p) {
  const g = Number(grams) || 0;
  const f = (v) => (Number.isFinite(v) ? v : 0);
  const factor = g / 100;
  return {
    grams: g,
    kcal: round0(f(p.kcal100) * factor),
    p: round1(f(p.p100) * factor),
    f: round1(f(p.f100) * factor),
    c: round1(f(p.c100) * factor),
  };
}
function sumTotals(ings) {
  let grams = 0, kcal = 0, p = 0, f = 0, c = 0;
  for (const ing of ings) {
    const res = calcForIngredient(ing.grams, ing.product || {});
    grams += res.grams; kcal += res.kcal; p += res.p; f += res.f; c += res.c;
  }
  return { grams, kcal, p, f, c };
}

// ======= UI — wiersze składników =======
function addIngRow(prefill = null) {
  const tr = document.createElement('tr');

  const tdName = document.createElement('td');
  const nameWrap = document.createElement('label');
  nameWrap.className = 'form-field';
  nameWrap.innerHTML = `<input type="search" class="ing-name" placeholder="Wybierz produkt" autocomplete="off" />`;
  tdName.appendChild(nameWrap);

  const tdCat = document.createElement('td');
  tdCat.className = 'muted';
  tdCat.textContent = '—';

  const tdGr = document.createElement('td');
  tdGr.innerHTML = `<input type="number" class="ing-grams" min="1" step="1" inputmode="numeric" placeholder="np. 100" />`;

  const tdKcal = document.createElement('td'); tdKcal.textContent = '—';
  const tdBTW  = document.createElement('td'); tdBTW.textContent  = '—';

  const tdDel = document.createElement('td');
  const delBtn = document.createElement('button');
  delBtn.className = 'btn small danger';
  delBtn.type = 'button';
  delBtn.textContent = 'Usuń';
  tdDel.appendChild(delBtn);

  tr.append(tdName, tdCat, tdGr, tdKcal, tdBTW, tdDel);
  ingTbody.appendChild(tr);

  const row = {
    el: tr,
    nameInput: nameWrap.querySelector('input'),
    gramsInput: tdGr.querySelector('input'),
    productId: null,
    product: null,
    renderMeta() {
      if (this.product) {
        tdCat.textContent = this.product.category || '—';
        const m = calcForIngredient(this.gramsInput.value, this.product);
        tdKcal.textContent = fmt(m.kcal);
        tdBTW.textContent = `${fmt(m.p)}/${fmt(m.f)}/${fmt(m.c)}`;
      } else {
        tdCat.textContent = '—'; tdKcal.textContent = '—'; tdBTW.textContent = '—';
      }
    },
    pickProduct(p) {
      this.productId = p.id;
      this.product = p;
      this.nameInput.value = p.name;
      this.renderMeta();
      recalcSummary();
    }
  };

  // autocomplete
  attachAutocomplete(row.nameInput, (p) => row.pickProduct(p));

  // events
  row.gramsInput.addEventListener('input', () => { row.renderMeta(); recalcSummary(); });

  delBtn.addEventListener('click', () => {
    ingRows = ingRows.filter(x => x !== row);
    tr.remove();
    toggleIngEmpty();
    recalcSummary();
  });

  if (prefill) {
    // prefill: { productId, grams, product? }
    let prod = prefill.product || products.find(p => p.id === prefill.productId) || null;
    if (prod) row.pickProduct(prod);
    if (prefill.grams) { row.gramsInput.value = String(prefill.grams); row.renderMeta(); }
  }

  ingRows.push(row);
  toggleIngEmpty();
  return row;
}

function clearIngRows() {
  ingRows = [];
  ingTbody.innerHTML = '';
  toggleIngEmpty();
  recalcSummary();
}

function toggleIngEmpty() {
  ingEmpty.hidden = ingRows.length > 0;
}

// ======= Formularz dania =======
function openMealForm(meal = null) {
  editMeal = meal ? JSON.parse(JSON.stringify(meal)) : { id: null, name: '', category: '', portions: 1, postWeight: 0, recipe: '', isPublic: false, ingredients: [] };
  mealForm.reset();
  mealFormTitle.textContent = meal ? 'Edytuj danie' : 'Dodaj danie';
  const E = mealForm.elements;
  E.namedItem('id').value = editMeal.id || '';
  E.namedItem('name').value = editMeal.name || '';
  E.namedItem('category').value = editMeal.category || '';
  E.namedItem('portions').value = editMeal.portions || '';

  clearIngRows();
  for (const ing of editMeal.ingredients) addIngRow(ing);
  if (!editMeal.id && editMeal.ingredients.length === 0) { addIngRow(); addIngRow(); }

  mealListCard.hidden = true;
  mealFormCard.hidden = false;
  E.namedItem('name').focus();
  recalcSummary();
}

function closeMealForm() {
  mealFormCard.hidden = true;
  mealListCard.hidden = false;
}

function readMealFromForm() {
  const E = mealForm.elements;
  const data = {
    id: E.namedItem('id').value || null,
    name: (E.namedItem('name').value || '').trim(),
    category: E.namedItem('category').value || '',
    portions: Math.max(1, Number(E.namedItem('portions').value || 1)),
    postWeight: Math.max(0, Number(E.namedItem('postWeight')?.value || 0)),
    recipe: (E.namedItem('recipe')?.value || '').trim(),
    isPublic: !!E.namedItem('isPublic')?.checked,
    ingredients: ingRows
      .filter(r => r.productId && Number(r.gramsInput.value) > 0)
      .map(r => ({ productId: r.productId, grams: Number(r.gramsInput.value) })),
  };
  return data;
}

function recalcSummary() {
  const E = mealForm.elements;
  const portions = Math.max(1, Number(E.namedItem('portions').value || 1));
  const postWeight = Math.max(0, Number(E.namedItem('postWeight')?.value || 0));
  const tmpIngs = ingRows.map(r => ({ product: r.product, grams: Number(r.gramsInput.value || 0) }));
  const sum = sumTotals(tmpIngs);
  const per = { kcal: sum.kcal / portions, p: sum.p / portions, f: sum.f / portions, c: sum.c / portions };

  if (!ingRows.length) {
    mealSummary.innerHTML = 'Wprowadź składniki, aby zobaczyć makro.';
    return;
  }
  mealSummary.innerHTML = `
    Łącznie: <strong>${fmt(sum.kcal)}</strong> kcal • B/T/W: <strong>${fmt(round1(sum.p))}</strong>/<strong>${fmt(round1(sum.f))}</strong>/<strong>${fmt(round1(sum.c))}</strong> • Masa składników: <strong>${fmt(sum.grams)}</strong> g${postWeight ? ` • Masa po obróbce: <strong>${postWeight}</strong> g` : ''}<br/>
    Na porcję (<strong>${portions}</strong>): <strong>${fmt(round0(per.kcal))}</strong> kcal • B/T/W: <strong>${fmt(round1(per.p))}</strong>/<strong>${fmt(round1(per.f))}</strong>/<strong>${fmt(round1(per.c))}</strong>${postWeight ? `<br/>Na 100 g (po obróbce): <strong>${fmt(round0(sum.kcal * 100 / postWeight))}</strong> kcal • B/T/W: <strong>${fmt(round1(sum.p * 100 / postWeight))}</strong>/<strong>${fmt(round1(sum.f * 100 / postWeight))}</strong>/<strong>${fmt(round1(sum.c * 100 / postWeight))}</strong>` : ''}`;
}

// ======= Lista / Paginacja =======
function applyMealFilter(resetPage = true) {
  const q = mealSearch.value || '';
  filteredMeals = q
    ? meals.filter(m => (`${m.name} ${m.category || ''}`).toLowerCase().includes(q.toLowerCase()))
    : [...meals];
  if (resetPage) page = 1;
  renderMealList();
}

function totalMealPages() { return Math.max(1, Math.ceil(filteredMeals.length / PAGE_SIZE)); }
function mealPageSlice() { const start = (page - 1) * PAGE_SIZE; return filteredMeals.slice(start, start + PAGE_SIZE); }

function renderMealList() {
  mealTbody.innerHTML = '';
  const rows = mealPageSlice();

  if (!rows.length) {
    mealEmpty.hidden = false;
  } else {
    mealEmpty.hidden = true;
    for (const it of rows) mealTbody.appendChild(mealRowTpl(it));
  }

  renderMealPager();
  updateMealPagerInfo();
}

function mealRowTpl(it) {
  // oblicz na porcję
  const totals = sumTotals(it.ingredients.map(ing => ({ grams: ing.grams, product: ing.product || products.find(p => p.id === ing.productId) || {} })));
  const per = { kcal: round0(totals.kcal / it.portions), p: round1(totals.p / it.portions), f: round1(totals.f / it.portions), c: round1(totals.c / it.portions) };

  const tr = document.createElement('tr');
  tr.innerHTML = `
    <td>${escapeHtml(it.name)}</td>
    <td>${escapeHtml(it.category || '')}</td>
    <td>${it.portions}</td>
    <td>${fmt(per.kcal)}</td>
    <td>${fmt(per.p)}/${fmt(per.f)}/${fmt(per.c)}</td>
    <td>
      <button class="btn small" data-act="preview">Podgląd</button>
      <button class="btn small" data-act="edit">Edytuj</button>
      <button class="btn small danger" data-act="delete">Usuń</button>
    </td>`;

  tr.querySelector('[data-act="edit"]').addEventListener('click', () => openMealForm(it));
  tr.querySelector('[data-act="delete"]').addEventListener('click', async () => {
    if (!confirm(`Usunąć danie: ${it.name}?`)) return;
    try {
      await api.removeMeal(it.id);
      meals = meals.filter(x => x.id !== it.id);
      const last = totalMealPages();
      if (page > last) page = last;
      applyMealFilter(false);
    } catch (err) {
      console.error(err);
      alert('Nie udało się usunąć dania');
    }
  });
  tr.querySelector('[data-act="preview"]').addEventListener('click', () => openPreview(it));
  return tr;
}

function renderMealPager() {
  const pages = totalMealPages();
  if (page > pages) page = pages;
  prevMealPage.disabled = page <= 1;
  nextMealPage.disabled = page >= pages;
  mealPageList.innerHTML = '';

  const btn = (n) => {
    const b = document.createElement('button');
    b.className = 'btn secondary';
    b.textContent = String(n);
    b.setAttribute('aria-label', `Strona ${n}`);
    if (n === page) b.setAttribute('aria-current', 'page');
    b.addEventListener('click', () => { page = n; renderMealList(); });
    return b;
  };

  const show = new Set([1, 2, pages - 1, pages, page - 1, page, page + 1].filter(x => x >= 1 && x <= pages));
  const ordered = [...show].sort((a, b) => a - b);
  let prev = 0;
  for (const n of ordered) {
    if (prev && n - prev > 1) {
      const span = document.createElement('span');
      span.className = 'muted';
      span.textContent = '…';
      mealPageList.appendChild(span);
    }
    mealPageList.appendChild(btn(n));
    prev = n;
  }
}
function updateMealPagerInfo() {
  const total = filteredMeals.length;
  const start = total ? (page - 1) * PAGE_SIZE + 1 : 0;
  const end = Math.min(page * PAGE_SIZE, total);
  mealPagerInfo.textContent = total ? `${start}–${end} z ${total} dań` : '0 dań';
}

// ======= Podgląd =======
function openPreview(meal) {
  // oblicz sumy i makro na porcję
  const totals = sumTotals(meal.ingredients.map(ing => ({
    grams: ing.grams,
    product: ing.product || products.find(p => p.id === ing.productId) || {}
  })));
  const portions = Number(meal.portions || 0);
  const per = portions > 0
    ? { kcal: Math.round(totals.kcal / portions), p: round1(totals.p / portions), f: round1(totals.f / portions), c: round1(totals.c / portions) }
    : null;

  // wiersze składników
  const rows = meal.ingredients.map((ing) => {
    const prod = ing.product || products.find(p => p.id === ing.productId) || {};
    const res = calcForIngredient(ing.grams, prod);
    const pname = prod.name ? escapeHtml(prod.name) : '<em>[brak w bazie]</em>';
    return `<tr>
      <td>${pname}</td>
      <td>${escapeHtml(prod.category || '')}</td>
      <td class="t-right">${ing.grams}</td>
      <td class="t-right">${fmt(res.kcal)}</td>
      <td class="t-right">${fmt(res.p)}/${fmt(res.f)}/${fmt(res.c)}</td>
    </tr>`;
  }).join('');

  // odznaki
  const visBadge = meal.isPublic
    ? `<span class="cm-badge success">Publiczne</span>`
    : `<span class="cm-badge">Prywatne</span>`;
  const portionsBadge   = portions > 0 ? `<span class="cm-badge">${portions} porcji</span>` : '';
  const postWeightBadge = meal.postWeight ? `<span class="cm-badge neutral">${meal.postWeight} g po obróbce</span>` : '';

  // tytuł modala
  const titleEl = document.getElementById('previewTitle');
  if (titleEl) titleEl.textContent = `Podgląd: ${meal.name || 'danie'}`;

  // treść modala
  previewBody.innerHTML = `
    <div class="preview-head">
      <div class="preview-name">${escapeHtml(meal.name || '')}</div>
      <div class="preview-meta">
        ${visBadge}
        ${portionsBadge}
        ${postWeightBadge}
        ${meal.category ? `<span class="cm-badge outline">${escapeHtml(meal.category)}</span>` : ''}
      </div>
    </div>

    ${meal.recipe ? `<div class="card recipe-card"><h4>Przepis</h4><p>${escapeHtml(meal.recipe)}</p></div>` : ''}

    <div class="table-wrapper">
      <table class="table preview-table">
        <thead><tr>
          <th>Produkt</th><th>Kategoria</th><th class="t-right">Ilość (g)</th><th class="t-right">kcal</th><th class="t-right">B/T/W</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>

    <div class="card" style="background:var(--surface-2);">
  <h4>Podsumowanie</h4>
  <div class="summary-grid">
    <!-- Łącznie -->
    <section class="summary-box">
      <div class="summary-title">Łącznie</div>
      <ul class="metrics">
        <li><span>kcal</span><strong>${fmt(totals.kcal)}</strong></li>
        <li><span>Białko</span><strong>${fmt(round1(totals.p))} g</strong></li>
        <li><span>Tłuszcz</span><strong>${fmt(round1(totals.f))} g</strong></li>
        <li><span>Węgle</span><strong>${fmt(round1(totals.c))} g</strong></li>
        <li><span>Masa</span><strong>${fmt(totals.grams)} g</strong></li>
      </ul>
    </section>

    <!-- Na porcję (pokazuj tylko gdy podano liczbę porcji) -->
    ${per ? `
    <section class="summary-box">
      <div class="summary-title">Na porcję</div>
      <ul class="metrics">
        <li><span>kcal</span><strong>${fmt(per.kcal)}</strong></li>
        <li><span>Białko</span><strong>${fmt(per.p)} g</strong></li>
        <li><span>Tłuszcz</span><strong>${fmt(per.f)} g</strong></li>
        <li><span>Węgle</span><strong>${fmt(per.c)} g</strong></li>
      </ul>
    </section>` : ''}

    <!-- Na 100 g po obróbce (pokazuj tylko gdy podana waga po obróbce) -->
    ${meal.postWeight ? `
    <section class="summary-box">
      <div class="summary-title">Na 100 g (po obróbce)</div>
      <ul class="metrics">
        <li><span>kcal</span><strong>${fmt(Math.round(totals.kcal * 100 / meal.postWeight))}</strong></li>
        <li><span>Białko</span><strong>${fmt(round1(totals.p * 100 / meal.postWeight))} g</strong></li>
        <li><span>Tłuszcz</span><strong>${fmt(round1(totals.f * 100 / meal.postWeight))} g</strong></li>
        <li><span>Węgle</span><strong>${fmt(round1(totals.c * 100 / meal.postWeight))} g</strong></li>
      </ul>
    </section>` : ''}
  </div>
</div>
`;

  previewModal.hidden = false;
  document.body.classList.add('cm-modal-open');
}

function closePreview() {
  previewModal.hidden = true;
  document.body.classList.remove('cm-modal-open');
}



// ======= Init =======
(async function init() {
  try {
    wireEvents();
    products = await api.listProducts();

    meals = await api.listMeals();
    // dołącz produkty do składników (jeśli nie przyszły z API)
    const pMap = new Map(products.map(p => [p.id, p]));
    meals.forEach(m => m.ingredients.forEach(ing => { if (!ing.product && pMap.has(ing.productId)) ing.product = pMap.get(ing.productId); }));

    applyMealFilter(true);
  } catch (err) {
    console.error(err);
    alert('Nie udało się załadować listy dań');
  }
})();

function wireEvents() {
  openAddMealBtn?.addEventListener('click', () => openMealForm());
  mealCancelBtn?.addEventListener('click', () => closeMealForm());
  addIngBtn?.addEventListener('click', () => addIngRow());
  mealSearch?.addEventListener('input', () => applyMealFilter(true));

  prevMealPage?.addEventListener('click', () => { if (page > 1) { page--; renderMealList(); } });
  nextMealPage?.addEventListener('click', () => { const pages = totalMealPages(); if (page < pages) { page++; renderMealList(); } });

  mealForm?.addEventListener('submit', onMealSubmit);
}

async function onMealSubmit(e) {
  e.preventDefault();
  const data = readMealFromForm();

  if (!data.name) { mealForm.elements.namedItem('name').focus(); return; }
  if (!data.category) { mealForm.elements.namedItem('category').focus(); return; }
  if (!data.portions || data.portions < 1) { mealForm.elements.namedItem('portions').focus(); return; }
  if (data.ingredients.length < 2) { alert('Dodaj przynajmniej dwa składniki'); return; }

  try {
    if (data.id) {
      const updated = await api.updateMeal(data.id, data);
      // podmień w listach
      meals = meals.map(x => x.id === updated.id ? updated : x);
    } else {
      const created = await api.createMeal(data);
      meals.push(created);
    }
    closeMealForm();
    applyMealFilter(true);
  } catch (err) {
    console.error(err);
    alert('Nie udało się zapisać dania');
  }
}
