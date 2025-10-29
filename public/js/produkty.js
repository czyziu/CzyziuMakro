// produkty.js — guard-friendly: bez przekierowań; makra/100 g; paginacja 10/strona

// ======= KONFIG API =======
const API_BASE = '/api/products';
const TOKEN_KEY = 'cm_token';           // zgodny z guard.js
const LEGACY_TOKEN_KEY = 'token';       // fallback (jeśli gdzieś zapisywałeś pod 'token')
const getToken = () => localStorage.getItem(TOKEN_KEY) || localStorage.getItem(LEGACY_TOKEN_KEY);
const authHeaders = () => {
  const h = { 'Content-Type': 'application/json' };
  const t = getToken();
  if (t) h['Authorization'] = `Bearer ${t}`; // dodaj nagłówek tylko gdy token istnieje — guard pilnuje reszty
  return h;
};

// ======= Adapter API =======
const api = {
  async list() {
    const r = await fetch(`${API_BASE}?page=1&pageSize=1000`, { headers: authHeaders() });
    if (!r.ok) {
      console.warn('API list() error', r.status);
      return []; // bez przekierowań — guard zajmie się autoryzacją/wall-em
    }
    const data = await r.json();
    const arr = Array.isArray(data) ? data : (data.items || []);
    return arr.map(mapDocToItem);
  },
  async create(p) {
    const body = JSON.stringify({
      name: p.name,
      category: p.category,
      kcal100: toNumOrNull(p.kcal100),
      p100: toNumOrNull(p.p100),
      f100: toNumOrNull(p.f100),
      c100: toNumOrNull(p.c100),
    });
    const r = await fetch(API_BASE, { method: 'POST', headers: authHeaders(), body });
    if (!r.ok) throw new Error('Nie udało się dodać produktu');
    const doc = await r.json();
    return mapDocToItem(doc);
  },
  async update(id, data) {
    const body = JSON.stringify({
      name: data.name,
      category: data.category,
      kcal100: toNumOrNull(data.kcal100),
      p100: toNumOrNull(data.p100),
      f100: toNumOrNull(data.f100),
      c100: toNumOrNull(data.c100),
    });
    const r = await fetch(`${API_BASE}/${id}`, { method: 'PATCH', headers: authHeaders(), body });
    if (!r.ok) throw new Error('Nie udało się zaktualizować produktu');
    const doc = await r.json();
    return mapDocToItem(doc);
  },
  async remove(id) {
    const r = await fetch(`${API_BASE}/${id}`, { method: 'DELETE', headers: authHeaders() });
    if (!r.ok) throw new Error('Nie udało się usunąć produktu');
    return true;
  },
};

function mapDocToItem(doc) {
  return {
    id: doc._id || doc.id,
    name: doc.name,
    category: doc.category,
    kcal100: doc.kcal100 ?? null,
    p100: doc.p100 ?? null,
    f100: doc.f100 ?? null,
    c100: doc.c100 ?? null,
    createdAt: doc.createdAt || Date.now(),
  };
}

function toNumOrNull(v) {
  if (v === '' || v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// ======= Helpers =======
const ESC_ENTITIES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ESC_ENTITIES[c]);

const byText = (q) => (item) => {
  const t = `${item.name} ${item.category || ''}`.toLowerCase();
  return t.includes(q.trim().toLowerCase());
};

// ======= Stan =======
const PAGE_SIZE = 10;
let items = [];
let filtered = [];
let page = 1;

// ======= DOM =======
const $ = (id) => document.getElementById(id);
const tbody = $('productTbody');
const emptyState = $('emptyState');
const searchInput = $('searchInput');
const pageList = $('pageList');
const prevBtn = $('prevPage');
const nextBtn = $('nextPage');
const pagerInfo = $('pagerInfo');
const addCard = $('addEditCard');
const form = $('productForm');
const formTitle = $('formTitle');
const openAddBtn = $('openAddBtn');
const cancelBtn = $('cancelBtn');

// ======= Init =======
(async function init() {
  try {
    wireEvents();
    items = await api.list();
    applyFilter(true);
  } catch (err) {
    console.error(err);
    alert('Nie udało się załadować produktów');
  }
})();

function wireEvents() {
  openAddBtn?.addEventListener('click', () => openForm());
  cancelBtn?.addEventListener('click', () => closeForm());
  form?.addEventListener('submit', onSubmit);
  searchInput?.addEventListener('input', () => applyFilter(true));
  prevBtn?.addEventListener('click', () => { if (page > 1) { page--; render(); } });
  nextBtn?.addEventListener('click', () => { const pages = totalPages(); if (page < pages) { page++; render(); } });
}

function openForm(editItem = null) {
  addCard.hidden = false;
  form.reset();
  const E = form.elements;
  if (editItem) {
    formTitle.textContent = 'Edytuj produkt';
    E.namedItem('id').value = editItem.id;
    E.namedItem('name').value = editItem.name || '';
    E.namedItem('category').value = editItem.category || '';
    E.namedItem('kcal100').value = editItem.kcal100 ?? '';
    E.namedItem('p100').value = editItem.p100 ?? '';
    E.namedItem('f100').value = editItem.f100 ?? '';
    E.namedItem('c100').value = editItem.c100 ?? '';
  } else {
    formTitle.textContent = 'Dodaj produkt';
  }
  E.namedItem('name').focus();
  addCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function closeForm() { addCard.hidden = true; }

async function onSubmit(e) {
  e.preventDefault();
  const data = Object.fromEntries(new FormData(form).entries());
  if (!data.name?.trim()) { form.elements.namedItem('name').focus(); return; }
  if (!data.category) { form.elements.namedItem('category').focus(); return; }

  const payload = {
    id: data.id || null,
    name: data.name.trim(),
    category: data.category,
    kcal100: toNumOrNull(data.kcal100),
    p100: toNumOrNull(data.p100),
    f100: toNumOrNull(data.f100),
    c100: toNumOrNull(data.c100),
  };

  try {
    if (payload.id) {
      const updated = await api.update(payload.id, payload);
      items = items.map((x) => (x.id === updated.id ? updated : x));
    } else {
      const created = await api.create(payload);
      items.push(created);
    }
    closeForm();
    applyFilter(true);
  } catch (err) {
    console.error(err);
    alert('Nie udało się zapisać produktu');
  }
}

function applyFilter(resetPage = true) {
  const q = searchInput.value || '';
  filtered = q ? items.filter(byText(q)) : [...items];
  if (resetPage) page = 1;
  render();
}

function totalPages() { return Math.max(1, Math.ceil(filtered.length / PAGE_SIZE)); }
function pageSlice() { const start = (page - 1) * PAGE_SIZE; return filtered.slice(start, start + PAGE_SIZE); }

function render() {
  const rows = pageSlice();
  tbody.innerHTML = '';

  if (rows.length === 0) {
    emptyState.hidden = false;
  } else {
    emptyState.hidden = true;
    for (const it of rows) tbody.appendChild(rowTpl(it));
  }

  renderPager();
  updatePagerInfo();
}

function cell(val) { return val ?? ''; }

function rowTpl(it) {
  const tr = document.createElement('tr');
  tr.innerHTML = `
    <td>${escapeHtml(it.name)}</td>
    <td>${escapeHtml(it.category || '')}</td>
    <td>${cell(it.kcal100)}</td>
    <td>${cell(it.p100)}</td>
    <td>${cell(it.f100)}</td>
    <td>${cell(it.c100)}</td>
    <td>
      <button class="btn small" data-act="edit">Edytuj</button>
      <button class="btn small danger" data-act="delete">Usuń</button>
    </td>`;

  tr.querySelector('[data-act="edit"]').addEventListener('click', () => openForm(it));
  tr.querySelector('[data-act="delete"]').addEventListener('click', async () => {
    if (!confirm(`Usunąć produkt: ${it.name}?`)) return;
    try {
      await api.remove(it.id);
      items = items.filter((x) => x.id !== it.id);
      const lastPage = totalPages();
      if (page > lastPage) page = lastPage;
      applyFilter(false);
    } catch (err) {
      console.error(err);
      alert('Nie udało się usunąć produktu');
    }
  });
  return tr;
}

function renderPager() {
  const pages = totalPages();
  if (page > pages) page = pages;
  prevBtn.disabled = page <= 1;
  nextBtn.disabled = page >= pages;

  pageList.innerHTML = '';
  const btn = (n) => {
    const b = document.createElement('button');
    b.className = 'btn secondary';
    b.textContent = String(n);
    b.setAttribute('aria-label', `Strona ${n}`);
    if (n === page) b.setAttribute('aria-current', 'page');
    b.addEventListener('click', () => { page = n; render(); });
    return b;
  };

  const show = new Set([1, 2, pages - 1, pages, page - 1, page, page + 1].filter((x) => x >= 1 && x <= pages));
  const ordered = [...show].sort((a, b) => a - b);
  let prev = 0;
  for (const n of ordered) {
    if (prev && n - prev > 1) {
      const span = document.createElement('span');
      span.className = 'muted';
      span.textContent = '…';
      pageList.appendChild(span);
    }
    pageList.appendChild(btn(n));
    prev = n;
  }
}

function updatePagerInfo() {
  const total = filtered.length;
  const start = total ? (page - 1) * PAGE_SIZE + 1 : 0;
  const end = Math.min(page * PAGE_SIZE, total);
  pagerInfo.textContent = total ? `${start}–${end} z ${total} pozycji` : '0 pozycji';
}
