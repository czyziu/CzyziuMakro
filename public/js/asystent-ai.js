// public/js/asystent-ai.js
// Asystent AI: układanie całego dnia (5 posiłków) jak najbliżej makr użytkownika.

(() => {
  const MEALS = ["Śniadanie", "II śniadanie", "Obiad", "Podwieczorek", "Kolacja"];

  // ===== Helpers =====
  const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ESC[c]);

  function toNum(v, def = 0) {
    const n = parseFloat(String(v ?? "").replace(",", "."));
    return Number.isFinite(n) ? n : def;
  }
  const fmt = (v) => Math.round(toNum(v, 0));

  // ===== Auth & API =====
  const TOKEN_KEY = "cm_token";
  const LEGACY_TOKEN_KEY = "token";
  const getToken = () =>
    localStorage.getItem(TOKEN_KEY) || localStorage.getItem(LEGACY_TOKEN_KEY);

  function authHeaders() {
    const h = { "Content-Type": "application/json" };
    const t = getToken();
    if (t) h["Authorization"] = `Bearer ${t}`;
    return h;
  }

  async function apiJson(url, opts = {}) {
    const res = await fetch(url, {
      ...opts,
      headers: {
        ...authHeaders(),
        ...(opts.headers || {}),
      },
    });

    if (!res.ok) {
      let msg = `HTTP ${res.status}`;
      try {
        const j = await res.json();
        if (j?.message) msg = j.message;
      } catch {
        /* ignore */
      }
      throw new Error(msg);
    }

    return res.json();
  }

  // ===== Targets (jak w kalendarzu) =====
  async function loadUserTargets() {
    // 1) Najnowsze makra z profilu
    try {
      const resp = await apiJson("/api/profile/macro/latest");
      const m = resp?.macro || resp || {};
      const targets = {
        kcal: toNum(m.kcal, 0),
        protein: toNum(m.protein_g, 0),
        fat: toNum(m.fat_g, 0),
        carbs: toNum(m.carbs_g, 0),
      };
      if (targets.kcal || targets.protein || targets.fat || targets.carbs) return targets;
    } catch {}

    // 2) Dane profilu
    try {
      const obj = await apiJson("/api/profile");
      if (obj && typeof obj === "object") {
        const t = {
          kcal: toNum(obj.kcal ?? obj.kcalTarget ?? obj.dailyKcal, 0),
          protein: toNum(obj.protein ?? obj.proteinTarget ?? obj.dailyProtein, 0),
          fat: toNum(obj.fat ?? obj.fatTarget ?? obj.dailyFat, 0),
          carbs: toNum(obj.carbs ?? obj.carbTarget ?? obj.dailyCarbs, 0),
        };
        if (t.kcal || t.protein || t.fat || t.carbs) return t;
      }
    } catch {}

    // 3) LocalStorage
    const kcal = toNum(
      localStorage.getItem("cm:target:kcal") ?? localStorage.getItem("targetKcal"),
      0
    );
    const protein = toNum(
      localStorage.getItem("cm:target:protein") ??
        localStorage.getItem("targetProtein"),
      0
    );
    const fat = toNum(
      localStorage.getItem("cm:target:fat") ?? localStorage.getItem("targetFat"),
      0
    );
    const carbs = toNum(
      localStorage.getItem("cm:target:carbs") ??
        localStorage.getItem("targetCarbs"),
      0
    );
    return { kcal, protein, fat, carbs };
  }

  function renderTargets(box, t) {
    if (!box) return;
    if (!t || (!t.kcal && !t.protein && !t.fat && !t.carbs)) {
      box.innerHTML =
        '<p class="small-note muted">Nie masz jeszcze ustawionych celów. AI ułoży jadłospis „na oko”.</p>';
      return;
    }
    box.innerHTML = `
      <p class="small-note muted">Dzienne cele z profilu:</p>
      <div class="ai-target-chips">
        <span class="chip">kcal: <strong class="num">${fmt(t.kcal)}</strong></span>
        <span class="chip">B: <strong class="num">${fmt(t.protein)}</strong> g</span>
        <span class="chip">T: <strong class="num">${fmt(t.fat)}</strong> g</span>
        <span class="chip">W: <strong class="num">${fmt(t.carbs)}</strong> g</span>
      </div>
      <p class="small-note">Asystent będzie próbował trafić jak najbliżej tych wartości w skali całego dnia.</p>
    `;
  }

  // ===== Makra =====
  function normalizeTotals(raw) {
    if (!raw) return { kcal: 0, protein: 0, fat: 0, carbs: 0 };
    return {
      kcal: toNum(raw.kcal ?? raw.calories ?? raw.k, 0),
      protein: toNum(raw.protein ?? raw.p ?? raw.b, 0),
      fat: toNum(raw.fat ?? raw.f ?? raw.t, 0),
      carbs: toNum(raw.carbs ?? raw.c ?? raw.w, 0),
    };
  }

  // ===== Uporządkowanie posiłków w kolejności kalendarzowej =====
  function orderMeals(meals) {
    const map = new Map();
    for (const m of meals) {
      map.set(m.slot, m);
    }
    const ordered = [];

    // 5 głównych slotów
    for (const name of MEALS) {
      const m = map.get(name);
      if (m) {
        ordered.push(m);
      } else {
        ordered.push({
          slot: name,
          items: [],
          totals: { kcal: 0, protein: 0, fat: 0, carbs: 0 },
          _empty: true,
        });
      }
    }

    // dodatkowe (jeśli kiedyś się pojawią)
    for (const m of meals) {
      if (!MEALS.includes(m.slot)) ordered.push(m);
    }

    return ordered;
  }

  // ===== Normalizacja wariantu od AI =====
  function normalizeVariant(raw) {
    const result = {
      title: raw?.title || "Jadłospis dnia",
      description: raw?.description || raw?.note || "",
      meals: [],
      totals: { kcal: 0, protein: 0, fat: 0, carbs: 0 },
    };

    let totals = normalizeTotals(raw?.totals);
    result.totals = totals;

    let meals = Array.isArray(raw?.meals) ? raw.meals.map((m) => ({ ...m })) : null;

    // Jeśli backend nie zwrócił meals – próbujemy coś z ingredients
    if (!meals || meals.length === 0) {
      const ings = Array.isArray(raw?.ingredients) ? raw.ingredients : [];
      if (ings.length) {
        const hasSlots = ings.some((it) => it.slot || it.meal || it.mealName);
        if (hasSlots) {
          const groups = new Map();
          for (const it of ings) {
            const slot =
              (it.slot || it.mealName || it.meal || "").trim() || "Cały dzień";
            if (!groups.has(slot)) groups.set(slot, []);
            groups.get(slot).push(it);
          }
          meals = Array.from(groups.entries()).map(([slot, items]) => ({
            slot,
            items,
            totals: null,
          }));
        } else {
          // totalny fallback: jeden „Cały dzień”
          meals = [
            {
              slot: "Cały dzień",
              items: ings,
              totals,
            },
          ];
        }
      } else {
        meals = [];
      }
    }

    const normMeals = meals.map((m) => {
      const slot = (m.slot || m.name || "").trim() || "Posiłek";
      const items = Array.isArray(m.items) ? m.items : [];
      const mt = normalizeTotals(m.totals);

      return {
        slot,
        items,
        totals: mt,
        _empty: m._empty,
      };
    });

    const orderedMeals = orderMeals(normMeals);
    result.meals = orderedMeals;

    // jeżeli totals puste – sumujemy z posiłków
    if (!(result.totals.kcal || result.totals.protein || result.totals.fat || result.totals.carbs)) {
      const sum = { kcal: 0, protein: 0, fat: 0, carbs: 0 };
      for (const m of orderedMeals) {
        sum.kcal += m.totals.kcal;
        sum.protein += m.totals.protein;
        sum.fat += m.totals.fat;
        sum.carbs += m.totals.carbs;
      }
      result.totals = sum;
    }

    return result;
  }

  // ===== Różnice względem celu =====
  function diffText(value, target, unit) {
    const v = fmt(value);
    const t = fmt(target);
    if (!t) return `${v} ${unit}`;
    const diff = v - t;
    if (diff === 0) return `${v} ${unit} (idealnie)`;
    const sign = diff > 0 ? "+" : "";
    return `${v} ${unit} (${sign}${diff})`;
  }

  // ===== HTML dla wariantu =====
  function buildVariantHTML(rawVariant, idx, totalCount, targets) {
    const v = normalizeVariant(rawVariant);
    const t = v.totals || { kcal: 0, protein: 0, fat: 0, carbs: 0 };
    const tg = targets || {};

    const mealsHtml = v.meals
      .map((m) => {
        const mt = m.totals || { kcal: 0, protein: 0, fat: 0, carbs: 0 };
        const hasItems = Array.isArray(m.items) && m.items.length > 0 && !m._empty;

        const itemsHtml = hasItems
          ? `<ul class="ai-meal-items">
              ${m.items
                .map(
                  (it) => `
                <li>
                  <span class="name">${esc(it.name || "Produkt")}</span>
                  ${
                    it.grams
                      ? `<span class="grams">${fmt(it.grams)} g</span>`
                      : ""
                  }
                </li>`
                )
                .join("")}
             </ul>`
          : `<p class="small-note muted">Brak konkretnej propozycji dla tego posiłku.</p>`;

        return `
          <section class="ai-meal">
            <h4>${esc(m.slot || "Posiłek")}</h4>
            <div class="ai-meal-macros">
              ~${fmt(mt.kcal)} kcal • B ${fmt(mt.protein)} g • T ${fmt(mt.fat)} g • W ${fmt(mt.carbs)} g
            </div>
            ${itemsHtml}
          </section>
        `;
      })
      .join("");

    return `
      <article class="ai-day-card">
        <header class="ai-day-head">
          <div class="ai-day-title-block">
            <span class="chip">Wariant ${idx + 1} z ${totalCount}</span>
            <h3>${esc(v.title || "Jadłospis dnia")}</h3>
          </div>
          <div class="ai-day-head-macros">
            <span class="chip">kcal: ${diffText(t.kcal, tg.kcal, "kcal")}</span>
            <span class="chip">B: ${diffText(t.protein, tg.protein, "g")}</span>
            <span class="chip">T: ${diffText(t.fat, tg.fat, "g")}</span>
            <span class="chip">W: ${diffText(t.carbs, tg.carbs, "g")}</span>
          </div>
        </header>
        ${
          v.description
            ? `<p class="small-note muted" style="margin-bottom:.5rem;">${esc(
                v.description
              )}</p>`
            : ""
        }
        <div class="ai-meals-grid">
          ${mealsHtml}
        </div>
        <footer class="ai-day-footer" style="margin-top: .75rem;">
          <button type="button"
                  class="btn secondary"
                  data-action="ai-add-to-calendar"
                  data-variant-index="${idx}">
            Dodaj ten wariant do kalendarza
          </button>
        </footer>
      </article>
    `;
  }

  // ===== Helpers dla okienka wyboru zakresu =====
function buildDateRangeArray(fromIso, toIso) {
  const out = [];
  if (!fromIso) return out;

  const [fy, fm, fd] = fromIso.split("-").map(Number);
  const [ty, tm, td] = (toIso || fromIso).split("-").map(Number);

  if (!fy || !fm || !fd || !ty || !tm || !td) return out;

  const start = new Date(fy, fm - 1, fd); // lokalny czas
  const end = new Date(ty, tm - 1, td);

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return out;

  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    out.push(`${y}-${m}-${day}`);
  }

  return out;
}


  function closeAiPlanModal(modal, payload) {
    modal.hidden = true;
    document.body.classList.remove("cm-modal-open");
    const errEl = modal.querySelector("[data-ai-plan-error]");
    if (errEl) errEl.textContent = "";
    if (typeof modal._onDone === "function") {
      modal._onDone(payload);
      modal._onDone = null;
    }
  }

  function handleAiPlanConfirm(modal) {
    const fromInput = modal.querySelector("[data-ai-plan-date-from]");
    const toInput = modal.querySelector("[data-ai-plan-date-to]");
    const mealsBox = modal.querySelector("[data-ai-plan-meals]");
    const errEl = modal.querySelector("[data-ai-plan-error]");

    if (errEl) errEl.textContent = "";

    const from = fromInput && fromInput.value ? fromInput.value : "";
    const toRaw = toInput && toInput.value ? toInput.value : "";
    const to = toRaw || from;

    if (!from) {
      if (errEl) errEl.textContent = "Wybierz przynajmniej datę początkową.";
      if (fromInput) fromInput.focus();
      return;
    }

    if (to && to < from) {
      if (errEl) {
        errEl.textContent =
          "Data końcowa nie może być wcześniejsza niż data początkowa.";
      }
      if (toInput) toInput.focus();
      return;
    }

    const slotCheckboxes = mealsBox
      ? Array.from(mealsBox.querySelectorAll('input[type="checkbox"]'))
      : [];

    const slots = slotCheckboxes
      .filter((el) => el.checked && !el.disabled)
      .map((el) => el.value);

    if (!slots.length) {
      if (errEl) errEl.textContent =
        "Zaznacz przynajmniej jeden posiłek do dodania.";
      return;
    }

    closeAiPlanModal(modal, { from, to, slots });
  }

  function ensureAiPlanModal() {
    let modal = document.getElementById("aiPlanModal");
    if (modal) return modal;

    modal = document.createElement("div");
    modal.id = "aiPlanModal";
    modal.className = "cm-modal";
    modal.hidden = true;
    modal.innerHTML = `
      <div class="cm-modal__backdrop" data-ai-plan-action="cancel"></div>
      <div class="cm-modal__dialog" role="dialog" aria-modal="true" aria-labelledby="aiPlanModalTitle">
        <div class="cm-modal__header">
          <h4 id="aiPlanModalTitle">Dodaj jadłospis do kalendarza</h4>
        </div>
        <div class="cm-modal__body">
          <div class="ai-plan-modal">
            <p class="ai-plan-modal__summary">
              Wybierz zakres dat oraz posiłki z tego wariantu, które chcesz dodać do kalendarza.
            </p>
            <div class="ai-plan-modal__grid">
              <div class="ai-plan-modal__section">
                <span class="ai-plan-label">Zakres dat</span>
                <div class="ai-plan-dates">
                  <label>
                    <span>Od</span>
                    <input type="date" data-ai-plan-date-from />
                  </label>
                  <label>
                    <span>Do</span>
                    <input type="date" data-ai-plan-date-to />
                  </label>
                </div>
                <p class="small-note muted">
                  Jeśli wybierzesz ten sam dzień w obu polach, jadłospis zostanie dodany tylko raz.
                </p>
              </div>
              <div class="ai-plan-modal__section">
                <span class="ai-plan-label">Które posiłki dodać?</span>
                <div class="ai-plan-meals" data-ai-plan-meals>
                  <!-- uzupełnia JS -->
                </div>
              </div>
            </div>
            <p class="ai-plan-error" data-ai-plan-error></p>
          </div>
        </div>
        <div class="cm-modal__footer">
          <button type="button" class="btn secondary" data-ai-plan-action="cancel">
            Anuluj
          </button>
          <button type="button" class="btn primary" data-ai-plan-action="confirm">
            Dodaj do kalendarza
          </button>
        </div>
      </div>
    `;

    modal.addEventListener("click", (ev) => {
      const actionEl = ev.target.closest("[data-ai-plan-action]");
      if (!actionEl) return;
      const action = actionEl.getAttribute("data-ai-plan-action");
      if (action === "cancel") {
        closeAiPlanModal(modal, null);
      }
      if (action === "confirm") {
        handleAiPlanConfirm(modal);
      }
    });

    document.addEventListener("keydown", (ev) => {
      if (ev.key === "Escape" && !modal.hidden) {
        ev.preventDefault();
        closeAiPlanModal(modal, null);
      }
    });

    document.body.appendChild(modal);
    return modal;
  }

  function openAiPlanModal(variant) {
    const modal = ensureAiPlanModal();

    const todayIso = new Date().toISOString().slice(0, 10);
    const fromInput = modal.querySelector("[data-ai-plan-date-from]");
    const toInput = modal.querySelector("[data-ai-plan-date-to]");
    if (fromInput) fromInput.value = todayIso;
    if (toInput) toInput.value = todayIso;

    const mealsBox = modal.querySelector("[data-ai-plan-meals]");
    if (mealsBox) {
      const mealsHtml = (variant.meals || [])
        .filter((m) => MEALS.includes(m.slot))
        .map((m) => {
          const hasItems =
            Array.isArray(m.items) && m.items.length > 0 && !m._empty;
          const kcal = fmt(m.totals && m.totals.kcal);
          return `
            <label class="ai-plan-meal-chip${
              hasItems ? "" : " ai-plan-meal-chip--disabled"
            }">
              <input
                type="checkbox"
                value="${esc(m.slot)}"
                ${hasItems ? "checked" : "disabled"}
              />
              <span class="ai-plan-meal-name">${esc(m.slot)}</span>
              <span class="ai-plan-meal-kcal small-note muted">
                ${
                  hasItems
                    ? `~${kcal} kcal`
                    : "Brak propozycji dla tego posiłku"
                }
              </span>
            </label>
          `;
        })
        .join("");

      mealsBox.innerHTML =
        mealsHtml ||
        '<p class="small-note muted">Brak posiłków do dodania.</p>';
    }

    const errEl = modal.querySelector("[data-ai-plan-error]");
    if (errEl) errEl.textContent = "";

    modal.hidden = false;
    document.body.classList.add("cm-modal-open");

    return new Promise((resolve) => {
      modal._onDone = (payload) => {
        resolve(payload);
        modal._onDone = null;
      };
    });
  }

  // ===== Zapis wybranego wariantu do kalendarza =====
  async function applyVariantToCalendar(variantIndex) {
    const statusEl = document.getElementById("aiStatus");
    const store = window.LAST_AI_DAY_PLAN;

    if (!store || !Array.isArray(store.variants) || !store.variants[variantIndex]) {
      if (statusEl) {
        statusEl.textContent = "Najpierw wygeneruj jadłospis.";
      }
      return;
    }

    const rawVariant = store.variants[variantIndex];
    const variant = normalizeVariant(rawVariant); // ma .meals[].slot / items[]

    // 1) Pokaż modal, nie prompt()
    const selection = await openAiPlanModal(variant);
    if (!selection) {
      // anulowane
      return;
    }

    const dates = buildDateRangeArray(selection.from, selection.to);
    const slotsToUse = Array.isArray(selection.slots) ? selection.slots : [];

    if (!dates.length || !slotsToUse.length) {
      return;
    }

    if (statusEl) {
      statusEl.textContent = "Porównuję składniki z bazą produktów…";
    }

    // 2) Porównanie z bazą produktów
    let resolveResp;
    try {
      resolveResp = await apiJson("/api/ai/resolve-day-plan", {
        method: "POST",
        body: JSON.stringify({ variant }),
      });
    } catch (e) {
      if (statusEl) statusEl.textContent = "";
      alert("Błąd porównywania z bazą produktów: " + (e.message || e));
      return;
    }

    const mapped = Array.isArray(resolveResp?.mapped) ? resolveResp.mapped : [];

    // nazwa składnika -> productId (auto-dopasowane)
    const autoMap = new Map();
    for (const m of mapped) {
      const sugg =
        (m.suggestions || []).find((s) => s && s.isAuto && s.productId);
      if (sugg) {
        autoMap.set(m.name, sugg.productId);
      }
    }

    if (!autoMap.size) {
      if (statusEl) {
        statusEl.textContent =
          "AI nie znalazło żadnych automatycznych dopasowań do Twoich produktów.";
      }
      return;
    }

    if (statusEl) {
      statusEl.textContent = "Zapisuję jadłospis do kalendarza…";
    }

    // 3) Zapis do kalendarza dla wybranych dni i posiłków
    let added = 0;

    for (const date of dates) {
      for (const meal of variant.meals || []) {
        const slot = (meal.slot || "").trim();
        if (!slot || !slotsToUse.includes(slot)) continue;

        for (const it of meal.items || []) {
          const name = it && it.name ? String(it.name).trim() : "";
          const grams = Number(it && it.grams) || 0;
          if (!name || !grams) continue;

          const pid = autoMap.get(name);
          if (!pid) continue;

          try {
            await apiJson(
              `/api/calendar/${encodeURIComponent(
                date
              )}/${encodeURIComponent(slot)}/items`,
              {
                method: "POST",
                body: JSON.stringify({
                  productId: pid,
                  grams: Math.round(grams),
                }),
              }
            );
            added++;
          } catch (e) {
            console.warn("Nie udało się dodać pozycji do kalendarza:", e);
          }
        }
      }
    }

    if (statusEl) {
      if (added > 0) {
        if (dates.length === 1) {
          statusEl.textContent = `Dodano ${added} pozycji do kalendarza na dzień ${dates[0]}.`;
        } else {
          statusEl.textContent = `Dodano ${added} pozycji do kalendarza w zakresie ${dates[0]} – ${
            dates[dates.length - 1]
          }.`;
        }
      } else {
        statusEl.textContent =
          "Nie udało się dodać żadnej pozycji (brak dopasowań lub błędy zapisu).";
      }
    }
  }


  // ===== Obsługa formularza =====
  async function onFormSubmit(ev) {
    ev.preventDefault();
    const promptEl = document.getElementById("aiPrompt");
    const statusEl = document.getElementById("aiStatus");
    const variantsBox = document.getElementById("aiVariants");

    if (!promptEl || !statusEl || !variantsBox) return;

    const basePrompt = (promptEl.value || "").trim();
    if (!basePrompt) {
      statusEl.textContent = "";
      variantsBox.innerHTML =
        '<p class="small-note muted">Najpierw wpisz, czego potrzebujesz (np. trening, preferencje, produkty do wykorzystania).</p>';
      promptEl.focus();
      return;
    }

    const targets = window.USER_TARGETS || {};

    const extra =
      targets && (targets.kcal || targets.protein || targets.fat || targets.carbs)
        ? `\n\nMoje dzienne cele makro (orientacyjnie): ok. ${fmt(
            targets.kcal)
          } kcal, ${fmt(targets.protein)} g białka, ${fmt(
            targets.fat
          )} g tłuszczu, ${fmt(
            targets.carbs
          )} g węglowodanów.\nUłóż jadłospis na CAŁY dzień (5 posiłków: Śniadanie, II śniadanie, Obiad, Podwieczorek, Kolacja), jak najbliżej tych celów.`
        : `\n\nUłóż jadłospis na CAŁY dzień (5 posiłków: Śniadanie, II śniadanie, Obiad, Podwieczorek, Kolacja).`;

    const prompt = basePrompt + extra;

    statusEl.textContent = "Myślę…";
    variantsBox.innerHTML = "";

    try {
      const debugOn = localStorage.getItem("AI_DEBUG") === "1";
      const topN = 1; // na razie jeden wariant
      const qs = new URLSearchParams();
      if (debugOn) qs.set("debug", "1");
      if (topN) qs.set("n", String(topN));

      const url = "/api/ai/day-plan" + (qs.toString() ? `?${qs}` : "");

      const body = {
        prompt,
        dayTotals: { kcal: 0, p: 0, f: 0, c: 0 }, // układamy dzień od zera
        targets,
      };

      const data = await apiJson(url, {
        method: "POST",
        body: JSON.stringify(body),
      });

      statusEl.textContent = "";

      if (
        !data ||
        (!Array.isArray(data.variants) &&
          !Array.isArray(data.meals) &&
          !Array.isArray(data.ingredients))
      ) {
        variantsBox.innerHTML = `<p class="small-note muted">Brak propozycji od AI. ${
          data?.message ? esc(data.message) : ""
        }</p>`;
        return;
      }

      let rawVariants;
      if (Array.isArray(data.variants) && data.variants.length) {
        rawVariants = data.variants;
      } else {
        rawVariants = [data];
      }

      window.LAST_AI_DAY_PLAN = { raw: data, variants: rawVariants };

      const html = rawVariants
        .map((v, idx) => buildVariantHTML(v, idx, rawVariants.length, targets))
        .join("");

      variantsBox.innerHTML =
        html || '<p class="small-note muted">Brak propozycji.</p>';
    } catch (e) {
      statusEl.textContent = "";
      variantsBox.innerHTML = `<p class="small-note muted">Błąd zapytania: ${esc(
        e.message || e
      )}</p>`;
    }
  }

  // ===== Init =====
  window.addEventListener("DOMContentLoaded", async () => {
    const form = document.getElementById("aiForm");
    if (form) {
      form.addEventListener("submit", onFormSubmit);
    }

    const askBtn = document.getElementById("askBtn");
    if (askBtn && form) {
      askBtn.addEventListener("click", (ev) => {
        ev.preventDefault();
        form.requestSubmit();
      });
    }

    // Obsługa przycisku "Dodaj ten wariant do kalendarza"
    const variantsBox = document.getElementById("aiVariants");
    if (variantsBox) {
      variantsBox.addEventListener("click", (ev) => {
        const btn = ev.target.closest('[data-action="ai-add-to-calendar"]');
        if (!btn) return;

        const idx = Number(btn.dataset.variantIndex || "0");
        if (!Number.isFinite(idx)) return;

        applyVariantToCalendar(idx);
      });
    }

    const targetsBox = document.getElementById("targetsBox");
    try {
      const t = await loadUserTargets();
      window.USER_TARGETS = t;
      renderTargets(targetsBox, t);
    } catch (e) {
      if (targetsBox) {
        targetsBox.innerHTML =
          '<p class="small-note muted">Nie udało się pobrać Twoich celów. AI ułoży jadłospis w przybliżeniu.</p>';
      }
      window.USER_TARGETS = { kcal: 0, protein: 0, fat: 0, carbs: 0 };
    }
  });
})();
