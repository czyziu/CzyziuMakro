// public/guard.js
document.addEventListener('DOMContentLoaded', () => {
  const token = localStorage.getItem('cm_token');
  const isLoggedIn = !!token;

  if (!isLoggedIn) {
    // usuń istniejącą treść strony
    const main = document.querySelector('main');
    if (main) main.innerHTML = '';

    // === Tworzymy overlay ===
    const overlay = document.createElement('div');
    Object.assign(overlay.style, {
      position: 'fixed',
      inset: '0',
      background: 'rgba(0,0,0,0.85)',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: '9999',
      color: 'white',
      fontFamily: 'Inter, Arial, sans-serif',
      textAlign: 'center',
      padding: '2rem'
    });

    const box = document.createElement('div');
    Object.assign(box.style, {
      background: '#101720',
      padding: '2.5rem 3rem',
      borderRadius: '1rem',
      boxShadow: '0 0 30px rgba(0,0,0,0.5)',
      maxWidth: '420px'
    });

    const title = document.createElement('h2');
    title.textContent = 'Nie jesteś zalogowany';
    title.style.marginBottom = '1rem';

    const text = document.createElement('p');
    text.textContent = 'Ta strona jest dostępna tylko dla zalogowanych użytkowników.';
    text.style.marginBottom = '1.5rem';
    text.style.color = '#ccc';

    const okBtn = document.createElement('button');
    okBtn.textContent = 'OK';
    Object.assign(okBtn.style, {
      background: '#facc15',
      color: '#000',
      border: 'none',
      padding: '0.8rem 1.6rem',
      borderRadius: '0.5rem',
      cursor: 'pointer',
      fontWeight: '600',
      fontSize: '1rem'
    });

    okBtn.addEventListener('click', () => {
      // po kliknięciu OK przenosimy do logowania
      window.location.href = 'logowanie.html?next=pozalogowaniu.html';
    });

    box.appendChild(title);
    box.appendChild(text);
    box.appendChild(okBtn);
    overlay.appendChild(box);
    document.body.appendChild(overlay);
  }
});
