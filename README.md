# CzyziuMakro

Aplikacja webowa do planowania i analizy żywienia: rejestrowanie posiłków, kontrola kcal/makro, zarządzanie „lodówką” (zapasami) oraz generowanie list zakupów. Projekt zawiera backend (Node.js + Express) oraz statyczny frontend serwowany z katalogu `public/`. Opcjonalnie dostępny jest moduł AI oparty o lokalnie uruchomioną usługę Ollama. 

---

## Funkcje

- **Rejestracja i logowanie** (JWT)
- **Profil i cele**: wyliczanie i ustawianie dziennych celów kcal/makro
- **Produkty**: baza produktów z wartościami na 100g (CRUD, izolacja po użytkowniku)
- **Dania**: definicje dań (lista składników + gramatura), tryb prywatny/publiczny (tylko odczyt) 
- **Kalendarz posiłków**: planowanie dnia w 5 stałych slotach (Śniadanie, II śniadanie, Obiad, Podwieczorek, Kolacja) i bieżący bilans
- **Lodówka / zapasy**: ilości + termin ważności
- **Lista zakupów**: zakres dat → zapotrzebowanie z planu – stan lodówki = lista; generowanie PDF i (opcjonalnie) wysyłka e-mail 
- **AI (opcjonalnie)**:
  - generowanie posiłku / planu dnia,
  - walidacja odpowiedzi (JSON), mapowanie składników do bazy,
  - przeliczenia i ewentualne skalowanie porcji,
  - zapis do kalendarza dopiero po akceptacji użytkownika 

---

## Architektura (skrót)

- **Backend**: Node.js + Express + REST API (JSON)
- **Baza**: MongoDB (+ Mongoose)
- **Frontend**: statyczne pliki w `public/` serwowane przez backend
- **AI**: Ollama (lokalny serwer modeli), model konfigurowany przez `OLLAMA_MODEL` (np. `gemma3:4b`) 

---

## Wymagania

Minimalnie:
- Node.js (zalecane LTS) + npm
- MongoDB (lokalnie lub kontener)
- przeglądarka internetowa

Opcjonalnie:
- Ollama (moduł AI)
- SMTP (wysyłka e-mail) :contentReference[oaicite:6]{index=6}

---

## Instalacja i uruchomienie

1) Instalacja zależności:
```bash
npm install