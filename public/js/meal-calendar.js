// /js/meal-calendar.js
(function () {
  const MEALS = ["Śniadanie", "II śniadanie", "Obiad", "Podwieczorek", "Kolacja"];
  const KEY_PREFIX = "czyziu:calendar:v1:";
  const CANDIDATE_KEYS = ["cm:userId", "userId", "uid", "cm:uid", "auth:uid"];
  let uid = "guest";
  for (const k of CANDIDATE_KEYS) {
    const val = localStorage.getItem(k);
    if (val) { uid = val; break; }
  }

  const $ = (sel, root = document) => root.querySelector(sel);

  const elGrid = document.getElementById("calendarGrid");
  const elDays = document.getElementById("calDays");

  // ===== Daty
  const toLocalISO = (d) => {
    const off = d.getTimezoneOffset();
    const dt = new Date(d.getTime() - off * 60 * 1000);
    return dt.toISOString().slice(0, 10);
  };
  const mondayOfWeek = (baseDate = new Date()) => {
    const d = new Date(baseDate);
    const day = (d.getDay() + 6) % 7; // 0=Mon ... 6=Sun
    d.setDate(d.getDate() - day);
    d.setHours(0, 0, 0, 0);
    return d;
  };

  let currentMonday = mondayOfWeek(new Date());
  // >>> ZAWSZE JEDEN DZIEŃ: domyślnie dzisiaj
  let selectedDayISO = toLocalISO(new Date());

  // ===== Storage
  const storageKey = (weekStartISO) => `${KEY_PREFIX}${uid}:${weekStartISO}`;
  const loadWeek = (weekStartISO) => {
    const raw = localStorage.getItem(storageKey(weekStartISO));
    if (raw) { try { return JSON.parse(raw); } catch (_) {} }
    const obj = {};
    for (let i = 0; i < 7; i++) {
      const day = new Date(new Date(weekStartISO).getTime());
      day.setDate(day.getDate() + i);
      const iso = toLocalISO(day);
      obj[iso] = MEALS.map(name => ({ name, items: [] }));
    }
    return obj;
  };
  const saveWeek = (weekStartISO, data) => {
    localStorage.setItem(storageKey(weekStartISO), JSON.stringify(data));
  };

  // ===== Sumy
  const mealTotals = (meal) => meal.items.reduce((s, it) => ({
    kcal: s.kcal + (+it.kcal || 0),
    protein: s.protein + (+it.protein || 0),
    fat: s.fat + (+it.fat || 0),
    carbs: s.carbs + (+it.carbs || 0),
  }), { kcal: 0, protein: 0, fat: 0, carbs: 0 });

  const dayTotals = (meals) => meals.reduce((acc, m) => {
    const t = mealTotals(m);
    acc.kcal += t.kcal; acc.protein += t.protein; acc.fat += t.fat; acc.carbs += t.carbs;
    return acc;
  }, { kcal: 0, protein: 0, fat: 0, carbs: 0 });

  const weekTotals = (dataObj) => {
    const acc = { kcal: 0, protein: 0, fat: 0, carbs: 0 };
    Object.values(dataObj).forEach(meals => {
      const t = dayTotals(meals);
      acc.kcal += t.kcal; acc.protein += t.protein; acc.fat += t.fat; acc.carbs += t.carbs;
    });
    return acc;
  };

  const dayNamesShort = ["Pon", "Wt", "Śr", "Czw", "Pt", "Sob", "Niedz"];
  const dayNamesFull  = ["Poniedziałek", "Wtorek", "Środa", "Czwartek", "Piątek", "Sobota", "Niedziela"];

  // Pomocnicze: indeks dnia tygodnia i ISO z indeksu (0=Pon ... 6=Niedz)
  function weekdayIndexFromISO(iso) {
    const d = new Date(iso + "T00:00:00");
    const monday = new Date(currentMonday);
    const diff = Math.round((d - monday) / (24*60*60*1000));
    return Math.max(0, Math.min(6, diff));
  }
  function isoFromWeekdayIndex(i) {
    const d = new Date(currentMonday);
    d.setDate(d.getDate() + i);
    return toLocalISO(d);
  }

  // Pasek dat (chipów) — BEZ ROKU
  function renderHeaderDays() {
    const todayISO = toLocalISO(new Date());
    const days = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(currentMonday);
      d.setDate(d.getDate() + i);
      const iso   = toLocalISO(d);
      const label = `${dayNamesShort[i]} ${d.toLocaleDateString("pl-PL", { day: "2-digit", month: "2-digit" })}`;
      days.push({ iso, label, isToday: iso === todayISO, isSelected: selectedDayISO === iso });
    }
    elDays.innerHTML = days.map(({ iso, label, isToday, isSelected }) =>
      `<button class="day-chip${isToday ? " is-today" : ""}${isSelected ? " is-selected" : ""}" data-cal-day="${iso}" aria-label="Data ${label}" aria-pressed="${isSelected}">${label}</button>`
    ).join("");
  }

  // Główny render — WYŁĄCZNIE JEDEN DZIEŃ (selectedDayISO)
  function render() {
    const weekISO = toLocalISO(currentMonday);
    const data = loadWeek(weekISO);

    renderHeaderDays();

    // Tygodniowe sumy (z całego tygodnia — nie usuwamy)
    const wt = weekTotals(data);
    $("[data-week-kcal]").textContent = Math.round(wt.kcal);
    $("[data-week-protein]").textContent = Math.round(wt.protein);
    $("[data-week-fat]").textContent = Math.round(wt.fat);
    $("[data-week-carbs]").textContent = Math.round(wt.carbs);

    // Wyczyść siatkę i narysuj TYLKO wybrany dzień
    elGrid.innerHTML = "";

    // Jeśli wybrany dzień nie należy do aktualnego tygodnia, przesuń wybór na poniedziałek tego tygodnia
    let idx = weekdayIndexFromISO(selectedDayISO);
    if (idx < 0 || idx > 6) { idx = 0; selectedDayISO = isoFromWeekdayIndex(0); }

    const d = new Date(currentMonday);
    d.setDate(d.getDate() + idx);
    const iso     = toLocalISO(d);
    const meals   = data[iso];
    const isToday = iso === toLocalISO(new Date());
    const dtTitle = d.toLocaleDateString("pl-PL", { day: "2-digit", month: "2-digit" }); // bez roku

    // Kafelek dnia
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
        <button class="btn-small" data-copy-day>Kopiuj dzień</button>
        <button class="btn-small" data-paste-day>Wklej dzień</button>
        <button class="btn-small" data-clear-day>Wyczyść</button>
      </div>
    `;

    // Suma dnia
    const totals = dayTotals(meals);
    card.querySelector("[data-day-kcal]").textContent   = Math.round(totals.kcal);
    card.querySelector("[data-day-protein]").textContent= Math.round(totals.protein);
    card.querySelector("[data-day-fat]").textContent    = Math.round(totals.fat);
    card.querySelector("[data-day-carbs]").textContent  = Math.round(totals.carbs);

    // Lista posiłków (5 sekcji <details>)
    const mealsWrap = card.querySelector(".meals");
    meals.forEach((meal, mealIndex) => {
      const mt = mealTotals(meal);
      const det = document.createElement("details");
      det.className = "meal";
      det.dataset.mealIndex = String(mealIndex);
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
          <div class="add-box">
            <div class="muted-note">Dodaj pozycję (wpisz ręcznie lub wybierz z listy „Twoje dania”, jeśli jest dostępna)</div>
            <div class="add-row">
              <input name="name" placeholder="Nazwa" list="user-dishes" />
              <input name="kcal" inputmode="decimal" placeholder="kcal" />
              <input name="protein" inputmode="decimal" placeholder="B (g)" />
              <input name="fat" inputmode="decimal" placeholder="T (g)" />
              <input name="carbs" inputmode="decimal" placeholder="W (g)" />
              <select name="portion">
                <option value="1" selected>1 porcja</option>
                <option value="0.5">1/2</option>
                <option value="1.5">1.5</option>
                <option value="2">2</option>
              </select>
            </div>
            <div class="add-actions">
              <button class="btn-small primary" data-add>Dodaj</button>
              <button class="btn-small" data-add-clear>Wyczyść pola</button>
            </div>
          </div>
        </div>
      `;
      // pozycje jedzenia
      const list = det.querySelector(".food-list");
      meal.items.forEach((it, itemIndex) => {
        const row = document.createElement("div");
        row.className = "food-item";
        row.dataset.itemIndex = String(itemIndex);
        row.innerHTML = `
          <div class="name">${it.name}</div>
          <div class="num">${Math.round(it.kcal)} kcal</div>
          <div class="num">B ${Math.round(it.protein)} g</div>
          <div class="num">T ${Math.round(it.fat)} g • W ${Math.round(it.carbs)} g</div>
          <button class="food-remove" title="Usuń" aria-label="Usuń pozycję" data-remove>×</button>
        `;
        list.appendChild(row);
      });
      mealsWrap.appendChild(det);
    });

    elGrid.appendChild(card);

    // Datalist z „Twoje dania” (opcjonalnie z localStorage)
    ensureDatalist(optionsFromUserDishes());
  }

  function optionsFromUserDishes() {
    const KEYS = ["czyziu:dania", "dania", "user:dania", "meals:custom"];
    for (const k of KEYS) {
      try {
        const raw = localStorage.getItem(k);
        if (!raw) continue;
        const arr = JSON.parse(raw);
        if (Array.isArray(arr)) {
          const names = new Set();
          arr.forEach(x => {
            if (typeof x === "string") names.add(x);
            else if (x && typeof x.name === "string") names.add(x.name);
            else if (x && typeof x.tytul === "string") names.add(x.tytul);
          });
          return Array.from(names).slice(0, 200);
        }
      } catch (_) {}
    }
    return [];
  }
  function ensureDatalist(options) {
    let dl = document.getElementById("user-dishes");
    if (!dl) {
      dl = document.createElement("datalist");
      dl.id = "user-dishes";
      document.body.appendChild(dl);
    }
    dl.innerHTML = options.map(o => `<option value="${String(o).replace(/"/g, "&quot;")}"></option>`).join("");
  }

  // ===== Kliknięcia
  document.addEventListener("click", (ev) => {
    const t = ev.target;
    if (!(t instanceof HTMLElement)) return;

    // Strzałki tygodnia — trzymaj ten sam dzień tygodnia
    if (t.matches('[data-cal="prev"]')) {
      ev.preventDefault();
      const keepIdx = weekdayIndexFromISO(selectedDayISO);
      currentMonday.setDate(currentMonday.getDate() - 7);
      selectedDayISO = isoFromWeekdayIndex(keepIdx);
      render();
    }
    if (t.matches('[data-cal="next"]')) {
      ev.preventDefault();
      const keepIdx = weekdayIndexFromISO(selectedDayISO);
      currentMonday.setDate(currentMonday.getDate() + 7);
      selectedDayISO = isoFromWeekdayIndex(keepIdx);
      render();
    }

    // Klik na dacie w pasku — ZAWSZE wybieramy dzień (bez trybu „tydzień”)
    if (t.matches("[data-cal-day]")) {
      ev.preventDefault();
      selectedDayISO = t.getAttribute("data-cal-day");
      render();
    }

    // Dodaj pozycję
    if (t.matches("[data-add]")) {
      ev.preventDefault();
      const det = t.closest("details.meal");
      const card = t.closest(".day-card");
      if (!det || !card) return;
      const dayISO = card.dataset.date;
      const mealIndex = Number(det.dataset.mealIndex);

      const weekISO = toLocalISO(currentMonday);
      const data = loadWeek(weekISO);

      const addRow = det.querySelector(".add-row");
      const get = (name) => addRow.querySelector(`[name="${name}"]`);
      const portion = parseFloat(get("portion").value || "1");
      const item = {
        id: cryptoRandomId(),
        name: (get("name").value || "Pozycja").trim(),
        kcal: toNum(get("kcal").value) * portion,
        protein: toNum(get("protein").value) * portion,
        fat: toNum(get("fat").value) * portion,
        carbs: toNum(get("carbs").value) * portion,
      };
      if (!item.name) item.name = "Pozycja";

      data[dayISO][mealIndex].items.push(item);
      saveWeek(weekISO, data);
      render();

      setTimeout(() => {
        const day = document.querySelector(`.day-card[data-date="${dayISO}"]`);
        const det2 = day?.querySelector(`details.meal[data-meal-index="${mealIndex}"]`);
        if (det2) det2.open = true;
      }, 0);
    }

    if (t.matches("[data-add-clear]")) {
      ev.preventDefault();
      const addRow = t.closest("details.meal")?.querySelector(".add-row");
      if (!addRow) return;
      addRow.querySelectorAll("input").forEach(inp => inp.value = "");
      addRow.querySelector('select[name="portion"]').value = "1";
    }

    // Usuń pozycję
    if (t.matches("[data-remove]")) {
      ev.preventDefault();
      const row = t.closest(".food-item");
      const det = t.closest("details.meal");
      const card = t.closest(".day-card");
      if (!row || !det || !card) return;

      const dayISO = card.dataset.date;
      const mealIndex = Number(det.dataset.mealIndex);
      const itemIndex = Number(row.dataset.itemIndex);

      const weekISO = toLocalISO(currentMonday);
      const data = loadWeek(weekISO);
      data[dayISO][mealIndex].items.splice(itemIndex, 1);
      saveWeek(weekISO, data);
      render();
    }

    // Narzędzia dnia: kopiuj / wklej / wyczyść
    if (t.matches("[data-copy-day]")) {
      ev.preventDefault();
      const dayISO = t.closest(".day-card")?.dataset.date;
      if (!dayISO) return;
      const data = loadWeek(toLocalISO(currentMonday));
      sessionStorage.setItem("czyziu:clipboard:day", JSON.stringify(data[dayISO]));
      t.textContent = "Skopiowano!";
      setTimeout(() => t.textContent = "Kopiuj dzień", 800);
    }
    if (t.matches("[data-paste-day]")) {
      ev.preventDefault();
      const dayISO = t.closest(".day-card")?.dataset.date;
      const weekISO = toLocalISO(currentMonday);
      if (!dayISO) return;
      const clip = sessionStorage.getItem("czyziu:clipboard:day");
      if (!clip) return;
      const data = loadWeek(weekISO);
      try {
        const meals = JSON.parse(clip);
        meals.forEach(m => m.items.forEach(it => it.id = cryptoRandomId()));
        data[dayISO] = meals;
        saveWeek(weekISO, data);
        render();
      } catch (_) {}
    }
    if (t.matches("[data-clear-day]")) {
      ev.preventDefault();
      const dayISO = t.closest(".day-card")?.dataset.date;
      const weekISO = toLocalISO(currentMonday);
      if (!dayISO) return;
      const data = loadWeek(weekISO);
      data[dayISO] = MEALS.map(name => ({ name, items: [] }));
      saveWeek(weekISO, data);
      render();
    }
  });

  function toNum(v) { const n = parseFloat(String(v).replace(",", ".")); return Number.isFinite(n) ? n : 0; }
  function cryptoRandomId() { try { return crypto.randomUUID(); } catch (_) { return "id-" + Math.random().toString(36).slice(2); } }

  render();
})();
