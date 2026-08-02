# Капиталист — Монополия онлайн

Онлайн-версия настольной игры «Капиталист» (до 5 игроков), как в [видео](https://www.youtube.com/watch?v=KlucRIGg6DI).

## Локальный запуск

```bash
npm install
npm start
```

Откройте http://localhost:3000

## Деплой на Render (бесплатно)

1. Создайте репозиторий на GitHub и загрузите проект
2. Зайдите на [render.com](https://render.com) → New → Web Service
3. Подключите репозиторий
4. Render автоматически подхватит `render.yaml`:
   - **Build:** `npm install`
   - **Start:** `npm start`
5. После деплоя получите URL вида `https://the-capitalist.onrender.com`

### Быстрый деплой через Render Blueprint

```bash
# Загрузите на GitHub, затем:
# Render Dashboard → New → Blueprint → выберите репозиторий
```

## Как играть онлайн

1. **Создайте комнату** — получите 5-буквенный код
2. **Отправьте код друзьям** — они нажимают «Войти в комнату»
3. **Хост нажимает «Начать игру»** — пустые места заполняются ботами
4. Играйте по очереди в реальном времени!

## Технологии

- **Frontend:** HTML/CSS/JS
- **Backend:** Node.js + Express + Socket.io
- **Деплой:** Render.com (free tier)

## Структура

```
server.js           — HTTP + WebSocket сервер
server/
  rooms.js          — комнаты и лобби
  bot.js            — AI для пустых слотов
js/
  game.js           — игровая логика (сервер)
  network.js        — клиент Socket.io
  ui.js             — интерфейс доски
  config.js         — 40 клеток, карточки
```
