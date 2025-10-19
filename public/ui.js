// public/js/ui.js
document.addEventListener('DOMContentLoaded', () => {
  const yr = document.getElementById('year');
  if (yr) yr.textContent = new Date().getFullYear();

  const banner = document.getElementById('infoBanner');
  const btn = document.getElementById('closeInfo');
  if (btn && banner) {
    btn.addEventListener('click', () => (banner.style.display = 'none'));
  }
});
