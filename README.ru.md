# ![LabStock](public/img/labstock.png) LabStock

**Система учёта лабораторного инвентаря для самостоятельного размещения.**

[![Build](https://github.com/neightgar/labstock/actions/workflows/docker.yml/badge.svg)](https://github.com/neightgar/labstock/actions/workflows/docker.yml)
[![Image](https://ghcr.io/neightgar/labstock:latest)](https://github.com/neightgar/labstock/pkgs/container/labstock)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

---

## Возможности

- **Реактивы, расходники, оборудование** — полноценный учёт с фильтрами, пагинацией, импортом/экспортом XLSX
- **Мягкое удаление и корзина** — записи никогда не теряются, пока вы не решите
- **Протоколы (SOP)** — богатый текстовый редактор TipTap с историей версий
- **Список заказов** — отслеживайте позиции к заказу, выгружайте в Excel одним кликом
- **Рабочие пространства (Workspace)** — изоляция данных между группами; администратор видит всё, пользователи — своё пространство
- **Роли** — администратор и обычный пользователь
- **Полнотекстовый поиск** — глобальный FTS5 поиск по всем сущностям
- **QR-коды** — генерация и скачивание QR-кодов для карточек оборудования
- **Telegram-бот** — команды `/low`, `/expiring`, `/search`, `/orders`, ежедневные push-уведомления
- **REST API** — полноценный CRUD API со Swagger UI по адресу `/api/docs`
- **Двуязычный интерфейс** — русский и английский, переключается для каждого пользователя
- **Автоматическое резервное копирование** — расписание бэкапов SQLite через node-cron

---

## Стек технологий

| Уровень | Технология |
|---------|------------|
| Среда выполнения | Node.js 18+ |
| Web-фреймворк | Express |
| База данных | SQLite (WAL mode) |
| ORM | Prisma |
| Шаблоны | EJS |
| Редактор | TipTap |
| Аутентификация | bcrypt + express-session |
| Excel | exceljs |
| Планировщик | node-cron |
| Контейнеризация | Docker (мультиарх: amd64 / arm64) |

---

## Установка

### Вариант А — Docker (рекомендуется)

**Шаг 1 — Создать директории**

```bash
# Обычный сервер
mkdir -p /opt/labstock/{data,uploads,backups}
cd /opt/labstock

# Synology NAS
mkdir -p /volume1/docker/labstock/{data,uploads,backups}
cd /volume1/docker/labstock
```

**Шаг 2 — Создать `.env`**

```env
NODE_ENV=production
DATABASE_URL=file:/app/data/labstock.db
SESSION_SECRET=замените-на-случайную-строку-32-символа
```

**Шаг 3 — Создать `docker-compose.yml`**

```yaml
services:
  labstock:
    image: ghcr.io/neightgar/labstock:latest
    container_name: labstock
    restart: unless-stopped
    ports:
      - "3120:3000"
    volumes:
      - ./data:/app/data
      - ./uploads:/app/uploads
      - ./backups:/app/backups
    env_file:
      - .env
```

**Шаг 4 — Запустить**

```bash
docker compose up -d
```

**Шаг 5 — Открыть** `http://localhost:3120`

При первом запуске откроется Setup Wizard для создания учётной записи администратора.

#### Synology NAS (Container Manager)

1. Открыть **Container Manager → Projects → Create**
2. Загрузить или вставить `docker-compose.yml`
3. Запустить проект

Обновление образа:

```bash
docker compose pull && docker compose up -d
```

---

### Вариант Б — Ручная установка

**Требования:** Node.js 20+, Git

```bash
# 1. Клонировать репозиторий
git clone https://github.com/neightgar/labstock.git
cd labstock

# 2. Установить зависимости
npm install

# 3. Настроить окружение
cp .env.example .env
# Отредактировать .env — как минимум задать SESSION_SECRET

# 4. Применить миграции БД
npm run db:migrate

# 5а. Режим разработки (авторестарт)
npm run dev

# 5б. Production через PM2
npm install -g pm2
pm2 start src/server.js --name labstock
pm2 save && pm2 startup
```

Открыть `http://localhost:3000`

---

## Конфигурация

Все настройки задаются через переменные окружения (`.env`):

| Переменная | Описание | Пример |
|------------|----------|--------|
| `NODE_ENV` | Окружение | `production` |
| `DATABASE_URL` | Путь к файлу SQLite | `file:/app/data/labstock.db` |
| `SESSION_SECRET` | Секрет подписи сессии (обязательно) | случайная строка 32 символа |
| `PORT` | Порт сервера (опционально) | `3000` |
| `BACKUP_DIR` | Директория бэкапов (опционально) | `./backups` |

> **Telegram Bot** настраивается через панель администратора `/admin` — переменные окружения не нужны.

---

## Первый запуск

1. Открыть `http://your-host:3120`
2. **Setup Wizard** — создать учётную запись администратора
3. Перейти в `/admin` → создать рабочие пространства и пользователей
4. Перейти в `/admin` → настроить Telegram Bot (опционально)

---

## REST API

- **Swagger UI:** `http://your-host/api/docs`
- **Аутентификация:** заголовок `X-API-Key`
- **API Key:** сгенерировать в профиле `/profile`

Все эндпоинты поддерживают фильтрацию, сортировку и пагинацию. Полная схема — в Swagger.

---

## Telegram Bot

1. Создать бота через [@BotFather](https://t.me/BotFather) и скопировать токен
2. Вставить токен в `/admin` → раздел Telegram Bot
3. Включить бота и сохранить
4. Каждый пользователь отправляет `/start` боту и вводит свой логин для привязки аккаунта

**Команды:**

| Команда | Описание |
|---------|----------|
| `/low` | Позиции ниже минимального запаса |
| `/expiring` | Истекающие в течение 30 дней |
| `/search <запрос>` | Полнотекстовый поиск |
| `/orders` | Текущий список заказов |
| `/help` | Список команд |

---

## Лицензия

[MIT](LICENSE)
