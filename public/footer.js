// public/footer.js
document.addEventListener('DOMContentLoaded', async () => {
  try {
    const res = await fetch('/footer.html');
    if (!res.ok) throw new Error('Nie udało się wczytać stopki');
    const html = await res.text();

    // Wstawiamy stopkę na koniec <body>
    document.body.insertAdjacentHTML('beforeend', html);

    // Dodajemy rok do stopki
    const yearEl = document.createElement('script');
    yearEl.textContent = `
      const yr = document.querySelector('.site-footer span#year');
      if (yr) yr.textContent = new Date().getFullYear();
    `;
  } catch (err) {
    console.error('[Footer error]', err);
  }
});
