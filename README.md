# Суши Точка — React + Node.js + PostgreSQL

Полноценная копия публичной витрины `sushitochka.com`: каталог, выбор точки, акции, корзина, вход по телефону, оформление заказа и отдельная админка. Визуальные ресурсы хранятся локально, поэтому клиентский сайт не зависит от оригинального домена.

## Что реализовано

- React-интерфейс на vinext/Next App Router с маршрутами `/catalog/:id`, `/promo`, `/order` и `/admin`;
- адаптивная сетка, модальные окна, корзина с сохранением на устройстве и оформление заказа;
- Node.js/Express API на порту `4000`;
- PostgreSQL-схема для товаров, категорий, точек, акций, клиентов, заказов и настроек;
- JWT-вход в админку, bcrypt-хеширование пароля, rate limiting, CORS и security headers;
- CRUD товаров, категорий, точек и акций; загрузка изображений; статусы заказов; настройки футера;
- резервные seed-данные: витрина открывается даже во время запуска API, а после подключения API берет актуальные данные из PostgreSQL.

## Быстрый запуск

1. Скопируйте `.env.example` в `.env` и обязательно смените `JWT_SECRET` и `ADMIN_PASSWORD`.
2. Запустите PostgreSQL:

   ```bash
   docker compose -p sushi-tochka up -d db
   ```

3. Подготовьте базу и запустите приложение:

   ```bash
   npm install
   npm run db:seed
   npm run dev:full
   ```

Витрина: `http://localhost:3000/catalog/1`  
Админка: `http://localhost:3000/admin`  
API: `http://localhost:4000/api`

Начальный локальный вход: `admin@sushitochka.local` / `ChangeMe123!`.

## Основные команды

- `npm run dev` — только клиентский сайт;
- `npm run dev:api` — API с автоперезапуском;
- `npm run dev:full` — клиент и API вместе;
- `npm run db:migrate` — создать/обновить схему;
- `npm run db:seed` — загрузить исходный каталог и администратора;
- `npm run typecheck` — проверить TypeScript;
- `npm run build` — production-сборка клиента;
- `npm test` — полная локальная проверка.

## Перед публикацией

- укажите production `DATABASE_URL`, `CORS_ORIGIN`, `NEXT_PUBLIC_API_URL` и длинный случайный `JWT_SECRET`;
- смените пароль администратора;
- подключите SMS-провайдера в `/api/auth/request-code` (в development используется код `0000`);
- замените юридические тексты и реквизиты оплаты на фактические;
- разместите frontend и Node.js API под HTTPS, а PostgreSQL — в закрытой сети с резервными копиями.
