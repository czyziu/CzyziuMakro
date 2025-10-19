// public/footer.js
document.addEventListener('DOMContentLoaded', async () => {
  try {
    const res = await fetch('/footer.html');
    if (!res.ok) throw new Error('Nie udało się wczytać stopki');
    const html = await res.text();

    // Wstawiamy stopkę na koniec <body>
    document.body.insertAdjacentHTML('beforeend', html);

    // Dodajemy aktualny rok (jeśli w stopce jest <span id="year">)
    const yearSpan = document.querySelector('#year');
    if (yearSpan) yearSpan.textContent = new Date().getFullYear();

    // 🔹 Wymuś ponowne przeliczenie layoutu po wstawieniu stopki
    document.body.style.display = 'flex';
    document.body.style.flexDirection = 'column';
    document.body.style.minHeight = '100vh';
    const main = document.querySelector('main');
    if (main) main.style.flex = '1';
  } catch (err) {
    console.error('[Footer error]', err);
  }
});
