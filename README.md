# Суши Точка — React + Node.js + PostgreSQL

Полноценная копия публичной витрины `sushitochka.com`: каталог, выбор точки, акции, корзина, вход по телефону, оформление заказа и отдельная админка. Визуальные ресурсы хранятся локально, поэтому клиентский сайт не зависит от оригинального домена.

## Что реализовано

- React-интерфейс на vinext/Next App Router с маршрутами `/catalog/:id`, `/promo`, `/order` и `/admin`;
- адаптивная сетка, модальные окна, корзина с сохранением на устройстве и оформление заказа;
- единый production-сервис: сайт, API и загрузки работают на одном домене и одном публичном порту;
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
API при локальной разработке: `http://localhost:4000/api`

Начальный локальный вход в админку: только пароль `ChangeMe123!`. Email не нужен.

## Основные команды

- `npm run dev` — только клиентский сайт;
- `npm run dev:api` — API с автоперезапуском;
- `npm run dev:full` — клиент и API вместе;
- `npm start` — production-запуск сайта и API одним сервисом на одном `PORT`;
- `npm run db:migrate` — создать/обновить схему;
- `npm run db:seed` — загрузить исходный каталог и администратора;
- `npm run typecheck` — проверить TypeScript;
- `npm run build` — production-сборка клиента;
- `npm test` — полная локальная проверка.

## Railway: один сервис без разделения frontend/backend

1. Создайте в Railway PostgreSQL и один сервис из этого GitHub-репозитория.
2. В Variables сервиса добавьте:

   ```env
   DATABASE_URL=${{Postgres.DATABASE_URL}}
   NODE_ENV=production
   JWT_SECRET=длинная-случайная-строка-минимум-32-символа
   ADMIN_PASSWORD=ваш-надежный-пароль
   ```

3. В Settings → Deploy укажите Build Command `npm run build`, а Start Command `npm start`.
4. Нажмите Deploy, затем в Settings → Networking создайте публичный домен.
5. Чтобы загруженные через админку изображения не пропадали после deploy, подключите Railway Volume с mount path `/app/public/uploads`.

`PORT`, `CORS_ORIGIN`, `NEXT_PUBLIC_API_URL` и email администратора на Railway указывать не нужно. При первом запуске схема и исходный каталог создаются автоматически. Изменение `ADMIN_PASSWORD` и повторный deploy сразу меняют пароль админки.

## Перед публикацией

- задайте длинные случайные `JWT_SECRET` и `ADMIN_PASSWORD`;
- подключите SMS-провайдера в `/api/auth/request-code` (в development используется код `0000`);
- замените юридические тексты и реквизиты оплаты на фактические;
- разместите frontend и Node.js API под HTTPS, а PostgreSQL — в закрытой сети с резервными копиями.
