// src/routes/ai-resolve-day-plan.js
//
// Dopasowanie składników z jadłospisu AI do produktów w bazie.
// Zwraca strukturę:
// {
//   mapped: [
//     {
//       name: "owies",
//       suggestions: [
//         { productId, productName, isAuto },
//         ...
//       ]
//     },
//     ...
//   ]
// }
//wazne
const { logMissingProductName } = require('../utils/missing-products-log');


const express = require('express');
const mongoose = require('mongoose');

const router = express.Router();

const PRODUCTS_COLLECTION =
  process.env.MONGODB_PRODUCTS_COLLECTION || 'products';

// Prosty schemat "cokolwiek", ważne żeby użyć tej samej kolekcji
const productSchema = new mongoose.Schema(
  {},
  {
    collection: PRODUCTS_COLLECTION,
    strict: false,
  }
);

// unikamy konfliktu z innymi modelami
const Product =
  mongoose.models.AiProduct || mongoose.model('AiProduct', productSchema);

function toNum(v, def = 0) {
  const n = parseFloat(String(v ?? '').replace(',', '.'));
  return Number.isFinite(n) ? n : def;
}


function escapeRegex(str) {
  return String(str || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}


function normalizeProductName(raw) {
  let name = String(raw || '').trim();

  // utnij nawias na końcu, np. "(light)", "(pieczona)", "(np. brokuły...)"
  name = name.replace(/\([^)]*\)\s*$/g, '');

  // utnij ilości na końcu, np. "100g", "200 ml", "- 150g"
  name = name.replace(
    /[-–—]?\s*\d+[.,]?\d*\s*(g|gram|gramy|kg|ml|l|szt|kcal)\b.*$/gi,
    ''
  );

  // posprzątaj spacje
  return name.replace(/\s+/g, ' ').trim();
}

function extractTrailingParen(raw) {
  const m = String(raw || '').match(/\(([^)]*)\)\s*$/);
  return m ? m[1].trim().toLowerCase() : null;
}






// Budujemy przyjemny regex: "płatki owsiane" -> /p.*łatki.*owsiane/i
function buildNameRegex(name) {
  const base = normalizeProductName(name) || name;
  const safe = escapeRegex(base).trim();
  if (!safe) return /.^/;
  const parts = safe.split(/\s+/).filter(Boolean);
  if (!parts.length) return /.^/;
  const pattern = parts.join('.*');
  return new RegExp(pattern, 'i');
}







// POST /api/ai/resolve-day-plan
// POST /api/ai/resolve-day-plan
router.post('/resolve-day-plan', async (req, res) => {
  try {
    const variant = req.body?.variant;

    if (!variant || !Array.isArray(variant.meals)) {
      return res
        .status(400)
        .json({ message: 'Brak poprawnego wariantu (pole "variant").' });
    }

    const namesSet = new Set();
    for (const meal of variant.meals || []) {
      for (const it of meal.items || []) {
        const rawName = String(it?.name || '').trim();
        if (rawName) namesSet.add(rawName);
      }
    }

    const names = Array.from(namesSet);
    // // Debug nazwy z wariantu:
    // console.log('[AI RESOLVE] Nazwy składników z wariantu:', names);

    const mapped = [];

    for (const name of names) {
const regex = buildNameRegex(name);
let products = [];

try {
  // 1. główne zapytanie – pełna fraza ("twaróg chudym")
  products = await Product.find({ name: regex }).limit(10).lean().exec();

  // 2. Fallback: jak nic nie znaleziono, szukaj po pierwszym słowie ("twaróg")
  if (!products.length) {
    const base = normalizeProductName(name) || name;
    const parts = base.split(/\s+/).filter(Boolean);

    if (parts.length > 1) {
      const firstWord = parts[0]; // np. "twaróg"
      const looseRegex = new RegExp(escapeRegex(firstWord), "i");

      products = await Product.find({ name: looseRegex })
        .limit(10)
        .lean()
        .exec();
    }
  }
} catch (err) {
  console.error('[AI RESOLVE] Błąd przy szukaniu produktów dla', name, err);
  products = [];
}


const inputParen = extractTrailingParen(name);
const baseInput = normalizeProductName(name).toLowerCase();
const inputWords = baseInput.split(/\s+/).filter(Boolean);

let suggestions = products.map((p, idx) => {
  const productName = p.name || name;
  const baseProduct = normalizeProductName(productName).toLowerCase();
  const productParen = extractTrailingParen(productName);
  const productWords = baseProduct.split(/\s+/).filter(Boolean);

  let score = 0;

  // 1) mocny bonus za identyczną bazową nazwę
  if (baseProduct === baseInput) score += 3;

  // 2) dopasowanie nawiasów (np. "(light)")
  if (inputParen && productParen) {
    if (productParen === inputParen) {
      score += 3;
    } else if (
      productParen.includes(inputParen) ||
      inputParen.includes(productParen)
    ) {
      score += 1;
    }
    // mały bonus za to, że oba w ogóle mają nawias
    score += 1;
  }

  // 3) NOWOŚĆ: wspólne słowa – np. "twaróg"
  const commonCount = inputWords.filter((w) => productWords.includes(w)).length;
  score += commonCount;

  // 4) lekki bonus jeśli jedno jest podciągiem drugiego
  if (baseProduct.includes(baseInput) || baseInput.includes(baseProduct)) {
    score += 1;
  }

  return {
    productId: String(p._id),
    productName,
    score,
    _idx: idx, // zachowanie kolejności przy remisie
  };
});

// posortuj po score (najlepsze na górze) i przytnij np. do 8
suggestions.sort((a, b) => {
  if (b.score !== a.score) return b.score - a.score;
  return a._idx - b._idx;
});

suggestions = suggestions.slice(0, 8);


// posortuj po score, potem po pierwotnej kolejności
suggestions = suggestions
  .sort((a, b) => b.score - a.score || a._idx - b._idx)
  .map((s, idx) => ({
    productId: s.productId,
    productName: s.productName,
    isAuto: idx === 0, // pierwszy po sortowaniu to AUTO
  }));


      if (!suggestions.length) {
        // ✅ JEDYNY log w konsoli, który zostawiamy
        console.log(
          `[AI RESOLVE] "${name}" -> brak dopasowań w bazie produktów`
        );

        try {
          await logMissingProductName(name, {
            prompt: req.body?.prompt || null,
          });
        } catch (e) {
          console.error('[MISSING-PRODUCT] Błąd zapisu brakującego produktu:', e);
        }

        continue;
      }

      // // Debug dopasowań – wyłączone
      // suggestions.forEach((s, idx) => {
      //   if (idx === 0) {
      //     console.log(
      //       `[AI RESOLVE] "${name}" -> AUTO "${s.productName}" (${s.productId})`
      //     );
      //   } else {
      //     console.log(
      //       `[AI RESOLVE] "${name}" -> ALT  "${s.productName}" (${s.productId})`
      //     );
      //   }
      // });

      mapped.push({ name, suggestions });
    }

    return res.json({ mapped });
  } catch (e) {
    console.error('[AI RESOLVE] Nieoczekiwany błąd:', e);
    return res
      .status(500)
      .json({ message: 'Błąd dopasowywania jadłospisu do produktów.' });
  }
});


module.exports = router;
