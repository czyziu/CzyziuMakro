// src/utils/missing-products-log.js
//
// Logger brakujących produktów – dopisuje do jednego pliku JSON
// unikalne nazwy składników, które AI wygenerowało, ale nie ma ich w bazie.

const fs = require('fs');
const path = require('path');

const MISSING_PRODUCTS_FILE = path.join(
  __dirname,
  '..',
  '..',
  'data',
  'missing-products.json' // możesz zmienić np. na 'missing-products.json' w root
);

// pomocniczo: upewniamy się, że katalog istnieje
async function ensureDirExists() {
  const dir = path.dirname(MISSING_PRODUCTS_FILE);
  await fs.promises.mkdir(dir, { recursive: true });
}

// wczytanie aktualnej listy brakujących produktów
async function loadMissingProducts() {
  try {
    const raw = await fs.promises.readFile(MISSING_PRODUCTS_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed;
    return [];
  } catch (err) {
    if (err.code === 'ENOENT') {
      // plik jeszcze nie istnieje – zaczynamy od pustej listy
      return [];
    }
    console.error('[MISSING-PRODUCT] Błąd odczytu pliku:', err);
    return [];
  }
}

// zapis listy (z unikalnymi nazwami)
async function saveMissingProducts(list) {
  await ensureDirExists();

  // deduplikacja po name (case-insensitive)
  const map = new Map();
  for (const item of list) {
    if (!item || !item.name) continue;
    const key = String(item.name).trim().toLowerCase();
    if (!map.has(key)) {
      map.set(key, item);
    } else {
      // można ew. zsumować count, itp.
      const existing = map.get(key);
      existing.count = (existing.count || 1) + (item.count || 1);
      existing.lastSeenAt = item.lastSeenAt || existing.lastSeenAt;
    }
  }

  const unique = Array.from(map.values());

  await fs.promises.writeFile(
    MISSING_PRODUCTS_FILE,
    JSON.stringify(unique, null, 2),
    'utf8'
  );
}

// główna funkcja, której będziesz używał
async function logMissingProductName(name, extra = {}) {
  const clean = String(name || '').trim();
  if (!clean) return;

  let list = await loadMissingProducts();

  const key = clean.toLowerCase();
  let existing = list.find(
    (item) => item.name && String(item.name).toLowerCase() === key
  );

  const nowIso = new Date().toISOString();

  if (!existing) {
    existing = {
      name: clean,
      count: 0,
      firstSeenAt: nowIso,
      lastSeenAt: nowIso,
    };
    list.push(existing);
  }

  existing.count = (existing.count || 0) + 1;
  existing.lastSeenAt = nowIso;

  // opcjonalnie: zapisujemy skrócony prompt / kontekst
  if (extra.prompt) {
    const snippet = String(extra.prompt).slice(0, 200);
    existing.prompts = existing.prompts || [];
    if (!existing.prompts.includes(snippet)) {
      existing.prompts.push(snippet);
    }
  }

  await saveMissingProducts(list);

  console.log(
    `[MISSING-PRODUCT] Zapisano brakujący produkt: "${clean}" (count=${existing.count})`
  );
}

module.exports = {
  logMissingProductName,
  MISSING_PRODUCTS_FILE,
};
