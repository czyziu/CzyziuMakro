# CzyziuMakro

CzyziuMakro to aplikacja backendowa pomagająca rejestrować posiłki, makra, zapasy produktów i zamienniki. Zawiera zabezpieczone API z JWT, integrację z MongoDB, podstawowe endpointy AI (Ollama), wysyłkę wiadomości e-mail oraz generowanie list zakupów.

## Wymagania wstępne
- Node.js 18+
- działająca instancja MongoDB (domyślnie `mongodb://127.0.0.1:27017/czyziumakro`) lub tryb in-memory w DEV
- (opcjonalnie) konto SMTP/Gmail do formularza kontaktowego, resetowania hasła i list zakupów

## Instalacja
```bash
npm install
```

## Uruchomienie
- Środowisko developerskie z automatycznym restartem: `npm run dev`
- DEV z bazą w pamięci (mongo-memory-server): `npm run dev:mem` przy `MONGO_URI=memory`
- Produkcyjnie: `npm start`

Serwer HTTP startuje na porcie `PORT` (domyślnie 4000) i loguje połączenie z MongoDB.

## Kluczowe zmienne środowiskowe
- `PORT` – port API
- `MONGO_URI` / `MONGODB_URI` – adres MongoDB (`memory` uruchamia bazę w pamięci w DEV)
- `MONGO_DB_NAME` / `MONGODB_DB` – nazwa bazy (opcjonalnie)
- `ALLOW_MEMORY_DB` – `true/false` czy dopuścić fallback do bazy in-memory w DEV
- `ORIGIN` – dozwolony origin dla CORS
- `JWT_SECRET`, `JWT_EXPIRES_IN` – konfiguracja tokenów
- `MAIL_USER` / `MAIL_PASS` / `MAIL_TO` – formularz kontaktowy
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM` – reset hasła i listy zakupów
- `FRONTEND_URL` – adres używany w linkach resetu hasła
- `OLLAMA_HOST`, `OLLAMA_MODEL`, `AI_DEBUG` – obsługa endpointów AI

## Funkcje API
- **Autoryzacja i profile**: rejestracja/logowanie z normalizacją username, obsługa JWT i profil użytkownika.
- **Produkty, lodówka, posiłki, kalendarz**: CRUD-y bazujące na MongoDB.
- **AI (Ollama)**: sugestie posiłków i receptury z limiterem żądań.
- **Formularz kontaktowy**: wysyła e-mail przez Gmail/SMTP z pola `/api/contact`.
- **Reset hasła**: generowanie tokenu i wysyłka maila z linkiem.
- **Lista zakupów**: przygotowanie i wysyłka PDF na maila.
- **Statyczny frontend**: serwowany z katalogu `public/` z fallbackiem do `index.html`.

## Testy
Uruchom testy jednostkowe poleceniem:
```bash
npm test
```
