// public/js/ui.js
document.addEventListener("DOMContentLoaded", () => {
  // ====== Stopka: rok ======
  const yr = document.getElementById("year");
  if (yr) yr.textContent = new Date().getFullYear();

  // ====== Banner info ======
  const banner = document.getElementById("infoBanner");
  const closeInfoBtn = document.getElementById("closeInfo");
  if (closeInfoBtn && banner) closeInfoBtn.addEventListener("click", () => (banner.style.display = "none"));

  // ====== MOBILE UI ======
  const isTouch = window.matchMedia("(pointer: coarse)").matches;
  const isNarrow = window.matchMedia("(max-width: 820px)").matches;
  const isMobileUI = isTouch || isNarrow;
  if (!isMobileUI) return; // na PC nic nie robimy

  const body = document.body;
  const siteHeader = document.querySelector(".site-header");
  const headerInner =
    document.querySelector(".site-header .header-inner") ||
    document.querySelector(".site-header .container");

  if (!headerInner) return;

  // --- backdrop (zawsze w body) ---
  let backdrop = document.querySelector(".cm-backdrop");
  if (!backdrop) {
    backdrop = document.createElement("div");
    backdrop.className = "cm-backdrop";
    document.body.appendChild(backdrop);
  }

  // --- hamburger ☰ (po PRAWEJ) ---
  let menuBtn = document.querySelector("#cmMobileMenuBtn");
  if (!menuBtn) {
    menuBtn = document.createElement("button");
    menuBtn.type = "button";
    menuBtn.id = "cmMobileMenuBtn";
    menuBtn.className = "cm-mobile-menu-btn";
    menuBtn.setAttribute("aria-label", "Otwórz menu");
    menuBtn.setAttribute("aria-expanded", "false");
    menuBtn.innerHTML = "☰";
    headerInner.appendChild(menuBtn); // ✅ po prawej
  }

  // --- drawer: istniejący side-nav albo tworzony (publiczne strony) ---
  let sideNav = document.querySelector(".side-nav");
  let createdPublicDrawer = false;

  if (!sideNav) {
    sideNav = document.createElement("aside");
    sideNav.className = "side-nav cm-public-drawer";
    sideNav.innerHTML = "<ul></ul>";
    document.body.appendChild(sideNav);
    createdPublicDrawer = true;
  }

  let sideUl = sideNav.querySelector("ul");
  if (!sideUl) {
    sideUl = document.createElement("ul");
    sideNav.appendChild(sideUl);
  }

  // --- przenieś linki z górnego nav do drawer (BEZ klonowania, żeby data-auth działało) ---
  const headerNav = document.querySelector(".site-header .nav");
  if (headerNav && headerNav.dataset.cmMoved !== "1") {
    const links = Array.from(headerNav.querySelectorAll("a.nav-link"));
    if (links.length) {
      const frag = document.createDocumentFragment();

      links.forEach((a) => {
        const li = document.createElement("li");
        a.classList.remove("nav-link");
        a.classList.add("side-link");
        li.appendChild(a); // ✅ przenosimy element, nie klonujemy
        frag.appendChild(li);
      });

      const sep = document.createElement("li");
      sep.setAttribute("data-cm-toplinks", "1");
      sep.innerHTML = '<div style="margin:.5rem .75rem;height:1px;background:rgba(255,255,255,.08)"></div>';
      frag.appendChild(sep);

      sideUl.insertBefore(frag, sideUl.firstChild);
      headerNav.dataset.cmMoved = "1";
    }
  }

  const open = () => {
    body.classList.add("nav-open");
    body.classList.remove("header-hidden");
    menuBtn.setAttribute("aria-expanded", "true");
  };

  const close = () => {
    body.classList.remove("nav-open");
    menuBtn.setAttribute("aria-expanded", "false");
  };

  menuBtn.addEventListener("click", () => (body.classList.contains("nav-open") ? close() : open()));
  backdrop.addEventListener("click", close);

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") close();
  });

  sideNav.addEventListener("click", (e) => {
    const hit = e.target.closest("a, button");
    if (hit) close();
  });

  // --- auto-hide header ---
  let lastY = window.scrollY;
  let ticking = false;

  const onScroll = () => {
    if (!siteHeader) return;

    const y = window.scrollY;
    if (y < 10) {
      body.classList.remove("header-hidden");
      lastY = y;
      ticking = false;
      return;
    }

    const goingDown = y > lastY;

    if (!body.classList.contains("nav-open")) {
      if (goingDown && y > 120) body.classList.add("header-hidden");
      else body.classList.remove("header-hidden");
    }

    lastY = y;
    ticking = false;
  };

  window.addEventListener(
    "scroll",
    () => {
      if (!ticking) {
        ticking = true;
        requestAnimationFrame(onScroll);
      }
    },
    { passive: true }
  );
});
