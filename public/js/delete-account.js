// ./js/delete-account.js

document.addEventListener('DOMContentLoaded', () => {
  const deleteBtn = document.querySelector('[data-action="delete-account"]');
  if (!deleteBtn) return;

  deleteBtn.addEventListener('click', () => {
    const wantDelete = confirm('Czy na pewno chcesz usunąć konto? Tej operacji nie można cofnąć.');

    if (!wantDelete) return;

    // TODO: tutaj podłącz backend do realnego usuwania konta.
    // Przykładowy szkic:
    /*
    fetch('/api/account/delete', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' }
    })
      .then(res => {
        if (!res.ok) throw new Error('Błąd odpowiedzi serwera');
        return res.json();
      })
      .then(() => {
        alert('Twoje konto zostało usunięte. Zostaniesz wylogowany.');
        window.location.href = 'index.html'; // lub logowanie.html
      })
      .catch(err => {
        console.error(err);
        alert('Nie udało się usunąć konta. Spróbuj ponownie później.');
      });
    */

    // Na razie tylko komunikat, bez backendu:
    alert('Tutaj wywołaj logikę usuwania konta po stronie backendu.');
  });
});
