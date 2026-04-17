# LabStock — План разработки
## База данных Сектора молекулярной радиобиологии ЛРБ ОИЯИ

> Документ предназначен для использования как контекст в Claude Code (VS Code).
> Основан на архитектуре [home-apothecary](https://github.com/neightgar/home-apothecary).
> Инструкции для Claude Code — в отдельном файле `AGENT.md`.

---

## Рабочее окружение

```
~/Projects/
├── home-apothecary/       ← reference-проект (read-only)
└── LabStock/                ← этот проект
```

- **Разработка**: VS Code + Claude Code, локальная машина
- **Деплой**: Docker → Synology NAS
- **Репозиторий**: GitHub (CI/CD → Docker Hub по аналогии с home-apothecary)

---

## Стек технологий

| Компонент | Технология | Из home-apothecary |
|-----------|-----------|-------------------|
| Runtime | Node.js (Express) | да |
| ORM | Prisma | да |
| БД | SQLite (WAL mode) | да (добавлен WAL) |
| Шаблоны | EJS (server-rendered) | да |
| Rich-text | TipTap (для протоколов) | новое |
| Аутентификация | bcrypt + express-session | новое |
| Файлы | multer | новое |
| Экспорт | exceljs (XLSX/CSV) | новое |
| i18n | JSON-файлы (RU/EN), cookie-parser | да |
| Крон | node-cron (бэкапы, уведомления) | да (расширен) |
| Деплой | Docker → Synology NAS | да |

---

## Карта переиспользования из home-apothecary

### Копировать as-is

| Файл в home-apothecary | Назначение в LabStock | Что изменить |
|------------------------|---------------------|-------------|
| `src/i18n.js` | `src/i18n.js` | Ничего |
| `src/services/telegram.js` | `src/services/telegram.js` (Фаза 8) | Ничего |
| `src/services/botI18n.js` | `src/services/botI18n.js` (Фаза 8) | Ничего |

### Адаптировать

| Файл в home-apothecary | Назначение в LabStock | Что изменить |
|------------------------|---------------------|-------------|
| `Dockerfile` | `Dockerfile` | Добавить python3/make/g++ для bcrypt. Создать /app/uploads, /app/backups |
| `docker-compose.yml` | `docker-compose.yml` | Сменить image/порт/env. Volumes для uploads/backups. Synology `/volume1/docker/` |
| `package.json` | `package.json` | Сохранить scripts. Добавить: bcrypt, express-session, multer, exceljs, qrcode |
| `src/app.js` | `src/app.js` | Сохранить middleware-цепочку. Добавить session/auth/multer. Заменить роуты |
| `src/server.js` | `src/server.js` | Graceful shutdown — as-is. Добавить backup cron. Telegram условно |
| `src/prisma.js` | `src/utils/prisma.js` | Добавить `PRAGMA journal_mode=WAL` |
| `src/services/settingsService.js` | `src/services/settingsService.js` | Сохранить .env read/write. Расширить ключи |
| `src/jobs/checkMedications.js` | `src/jobs/checkInventory.js` + `backupDb.js` | 3 таблицы вместо одной + backup job |

### Использовать как reference

| Файл в home-apothecary | Что взять |
|------------------------|-----------|
| `src/database.js` | `normalizeDatabaseUrl`, `ensureDatabaseDirectory` |
| `src/services/medicationService.js` | CRUD-паттерн → расширить: soft delete, пагинация, фильтры, audit |
| `src/services/telegramBot.js` | Polling, connectivity test, graceful start/stop |
| `src/routes/medicationRoutes.js` | `buildPayload` валидация, REST GET/POST/PUT/DELETE |
| `src/routes/web.js` | Роут → сервис → render EJS (разделить на файлы) |
| `views/index.ejs` | JSON initial data, i18n injection, sidebar, modal (разбить на layout+partials) |
| `public/styles.css` | CSS tokens/reset/shell (сменить тему на нейтральную) |
| `public/script.js` | State/render/API helpers (разбить на модули) |

### Не переносить

| Файл | Причина |
|------|---------|
| `prisma/schema.prisma` | Новая схема. Только generator/datasource скопировать |
| `data/*.db`, `prisma/data/` | Тестовые базы |
| `scripts/validate-api.js` | Специфичен для medication API |
| `public/apotheca_chest.png` | Заменить на логотип лаборатории |

---

## Структура БД (Prisma schema)

### Справочники

```prisma
model Location {
  id      Int     @id @default(autoincrement())
  nameRu  String  @map("name_ru")
  nameEn  String  @map("name_en")

  reagents    Reagent[]
  consumables Consumable[]
  equipment   Equipment[]

  @@map("locations")
}

model Manufacturer {
  id   Int    @id @default(autoincrement())
  name String @unique

  reagents    Reagent[]
  consumables Consumable[]
  equipment   Equipment[]

  @@map("manufacturers")
}

model ItemType {
  id       Int    @id @default(autoincrement())
  nameRu   String @map("name_ru")
  nameEn   String @map("name_en")
  category String // "consumable" | "glassware"

  consumables Consumable[]

  @@map("item_types")
}
```

### Основные таблицы (3)

```prisma
model Reagent {
  id             Int       @id @default(autoincrement())
  nameRu         String    @map("name_ru")
  nameEn         String    @map("name_en")
  casNumber      String?   @map("cas_number")
  formula        String?
  manufacturerId Int?      @map("manufacturer_id")
  manufacturer   Manufacturer? @relation(fields: [manufacturerId], references: [id])
  catalogNumber  String?   @map("catalog_number")
  quantity       Float
  unit           String
  minQuantity    Float?    @map("min_quantity")
  locationId     Int?      @map("location_id")
  location       Location? @relation(fields: [locationId], references: [id])
  expiryDate     DateTime? @map("expiry_date")
  receivedDate   DateTime? @map("received_date")
  notes          String?
  deletedAt      DateTime? @map("deleted_at")
  createdBy      Int       @map("created_by")
  creator        User      @relation(fields: [createdBy], references: [id])
  createdAt      DateTime  @default(now()) @map("created_at")
  updatedAt      DateTime  @updatedAt @map("updated_at")

  @@map("reagents")
}

model Consumable {
  id             Int       @id @default(autoincrement())
  nameRu         String    @map("name_ru")
  nameEn         String    @map("name_en")
  typeId         Int?      @map("type_id")
  type           ItemType? @relation(fields: [typeId], references: [id])
  manufacturerId Int?      @map("manufacturer_id")
  manufacturer   Manufacturer? @relation(fields: [manufacturerId], references: [id])
  catalogNumber  String?   @map("catalog_number")
  quantity       Int
  unit           String
  minQuantity    Int?      @map("min_quantity")
  locationId     Int?      @map("location_id")
  location       Location? @relation(fields: [locationId], references: [id])
  size           String?
  sterile        Boolean   @default(false)
  material       String?
  volume         Float?
  lotNumber      String?   @map("lot_number")
  expiryDate     DateTime? @map("expiry_date")
  notes          String?
  deletedAt      DateTime? @map("deleted_at")
  createdBy      Int       @map("created_by")
  creator        User      @relation(fields: [createdBy], references: [id])
  createdAt      DateTime  @default(now()) @map("created_at")
  updatedAt      DateTime  @updatedAt @map("updated_at")

  @@map("consumables")
}

model Equipment {
  id             Int       @id @default(autoincrement())
  nameRu         String    @map("name_ru")
  nameEn         String    @map("name_en")
  model          String?
  manufacturerId Int?      @map("manufacturer_id")
  manufacturer   Manufacturer? @relation(fields: [manufacturerId], references: [id])
  serialNumber   String?   @map("serial_number")
  locationId     Int?      @map("location_id")
  location       Location? @relation(fields: [locationId], references: [id])
  status         EquipmentStatus @default(WORKING)
  notes          String?
  deletedAt      DateTime? @map("deleted_at")
  createdBy      Int       @map("created_by")
  creator        User      @relation(fields: [createdBy], references: [id])
  createdAt      DateTime  @default(now()) @map("created_at")
  updatedAt      DateTime  @updatedAt @map("updated_at")

  @@map("equipment")
}

enum EquipmentStatus {
  WORKING
  REPAIR
  DECOMMISSIONED
}
```

### Заказы

```prisma
model OrderItem {
  id             Int      @id @default(autoincrement())
  nameRu         String   @map("name_ru")
  nameEn         String   @map("name_en")
  entityType     String   @map("entity_type")  // "reagent" | "consumable"
  entityId       Int?     @map("entity_id")     // FK на исходную запись (nullable — можно добавить вручную)
  quantity       Float                           // заказываемое кол-во
  unit           String
  manufacturer   String?                         // текст, не FK — в заказе может быть другой поставщик
  catalogNumber  String?  @map("catalog_number")
  notes          String?
  createdBy      Int      @map("created_by")
  creator        User     @relation(fields: [createdBy], references: [id])
  createdAt      DateTime @default(now()) @map("created_at")

  @@map("order_items")
}
```

### Протоколы (SOP)

```prisma
model Protocol {
  id        Int      @id @default(autoincrement())
  titleRu   String   @map("title_ru")
  titleEn   String   @map("title_en")
  contentRu String   @map("content_ru")
  contentEn String   @map("content_en")
  version   Int      @default(1)
  category  String?
  notes     String?
  deletedAt DateTime? @map("deleted_at")
  createdBy Int      @map("created_by")
  creator   User     @relation("ProtocolCreator", fields: [createdBy], references: [id])
  updatedBy Int      @map("updated_by")
  updater   User     @relation("ProtocolUpdater", fields: [updatedBy], references: [id])
  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt @map("updated_at")

  items    ProtocolItem[]
  versions ProtocolVersion[]

  @@map("protocols")
}

model ProtocolItem {
  id             Int     @id @default(autoincrement())
  protocolId     Int     @map("protocol_id")
  protocol       Protocol @relation(fields: [protocolId], references: [id])
  entityType     String  @map("entity_type")
  entityId       Int     @map("entity_id")
  quantityNeeded Float?  @map("quantity_needed")
  unit           String?
  notes          String?

  @@map("protocol_items")
}

model ProtocolVersion {
  id         Int      @id @default(autoincrement())
  protocolId Int      @map("protocol_id")
  protocol   Protocol @relation(fields: [protocolId], references: [id])
  version    Int
  titleRu    String   @map("title_ru")
  titleEn    String   @map("title_en")
  contentRu  String   @map("content_ru")
  contentEn  String   @map("content_en")
  changedBy  Int      @map("changed_by")
  changer    User     @relation(fields: [changedBy], references: [id])
  createdAt  DateTime @default(now()) @map("created_at")

  @@map("protocol_versions")
}
```

### Служебные таблицы

```prisma
model User {
  id             Int      @id @default(autoincrement())
  username       String   @unique
  passwordHash   String   @map("password_hash")
  displayName    String   @map("display_name")
  telegramChatId String?  @map("telegram_chat_id")
  language       String   @default("ru")
  createdAt      DateTime @default(now()) @map("created_at")

  reagents           Reagent[]
  consumables        Consumable[]
  equipment          Equipment[]
  orderItems         OrderItem[]
  protocolsCreated   Protocol[]        @relation("ProtocolCreator")
  protocolsUpdated   Protocol[]        @relation("ProtocolUpdater")
  protocolVersions   ProtocolVersion[]
  attachments        Attachment[]
  auditLogs          AuditLog[]

  @@map("users")
}

model Attachment {
  id         Int      @id @default(autoincrement())
  filename   String
  filepath   String
  mimeType   String   @map("mime_type")
  entityType String   @map("entity_type")
  entityId   Int      @map("entity_id")
  uploadedBy Int      @map("uploaded_by")
  uploader   User     @relation(fields: [uploadedBy], references: [id])
  uploadedAt DateTime @default(now()) @map("uploaded_at")

  @@map("attachments")
}

model AuditLog {
  id         Int      @id @default(autoincrement())
  userId     Int      @map("user_id")
  user       User     @relation(fields: [userId], references: [id])
  entityType String   @map("entity_type")
  entityId   Int      @map("entity_id")
  action     String
  changes    String?
  createdAt  DateTime @default(now()) @map("created_at")

  @@map("audit_logs")
}
```

---

## Раздел «Заказы» — описание функциональности

### Сценарий использования

1. Пользователь видит карточку реактива/расходника → нажимает кнопку **«Заказать»**
2. Открывается модальное окно с автозаполненными полями из карточки:
   - Название (name_ru / name_en)
   - Производитель (текст из справочника, но редактируемый — в заказе может быть другой)
   - Каталожный номер
   - Кол-во (пустое — пользователь вводит сколько заказать)
   - Единицы измерения
   - Комментарий
3. Пользователь редактирует при необходимости → подтверждает → запись появляется в разделе «Заказы»
4. В разделе «Заказы» — таблица всех заказываемых позиций с чекбоксами
5. Пользователь отмечает галочками нужные позиции → нажимает **«Сформировать заказ (Excel)»**
6. Скачивается XLSX-файл с таблицей:

| № | Название | Кол-во | Ед. | Производитель | Артикул | Комментарий |
|---|----------|--------|-----|---------------|---------|-------------|
| 1 | ... | ... | ... | ... | ... | ... |

7. После экспорта отмеченные позиции можно удалить из списка заказов (или оставить)

### Архитектурные решения

- **OrderItem хранит текст, не только FK** — потому что при заказе производитель/артикул могут отличаться от карточки
- **entityId nullable** — можно добавить позицию в заказ вручную, без привязки к существующей записи
- **Без статусов** — простой список → экспорт → удалить. Без workflow pending/ordered/delivered
- **Кнопка «Заказать» только для реактивов и расходников** — не для оборудования

---

## Структура проекта

```
~/Projects/LabStock/
├── prisma/
│   └── schema.prisma
├── src/
│   ├── app.js
│   ├── server.js
│   ├── routes/
│   │   ├── auth.js
│   │   ├── reagents.js
│   │   ├── consumables.js
│   │   ├── equipment.js
│   │   ├── protocols.js
│   │   ├── orders.js              # ← NEW: CRUD заказов + экспорт XLSX
│   │   ├── references.js
│   │   ├── dashboard.js
│   │   └── api/
│   │       └── v1/
│   ├── middleware/
│   │   ├── auth.js
│   │   ├── i18n.js
│   │   └── audit.js
│   ├── services/
│   │   ├── backup.js
│   │   ├── search.js
│   │   ├── export.js
│   │   ├── import.js
│   │   ├── orderExport.js         # ← NEW: генерация XLSX заказа
│   │   ├── qrcode.js
│   │   └── telegram.js
│   ├── jobs/
│   │   ├── checkInventory.js
│   │   └── backupDb.js
│   ├── locales/
│   │   ├── ru.json
│   │   └── en.json
│   └── utils/
│       ├── prisma.js
│       └── helpers.js
├── views/
│   ├── layouts/
│   │   └── main.ejs
│   ├── partials/
│   │   ├── header.ejs
│   │   ├── nav.ejs
│   │   ├── pagination.ejs
│   │   ├── filters.ejs
│   │   └── order-modal.ejs        # ← NEW: модальное окно заказа
│   ├── auth/
│   │   ├── login.ejs
│   │   ├── register.ejs
│   │   └── profile.ejs
│   ├── dashboard.ejs
│   ├── reagents/
│   │   ├── index.ejs
│   │   ├── form.ejs
│   │   └── show.ejs
│   ├── consumables/
│   ├── equipment/
│   ├── orders/                     # ← NEW
│   │   └── index.ejs              # Список заказов с чекбоксами + кнопка экспорта
│   ├── protocols/
│   │   ├── index.ejs
│   │   ├── form.ejs
│   │   ├── show.ejs
│   │   └── versions.ejs
│   └── references/
│       └── index.ejs
├── public/
│   ├── css/
│   ├── js/
│   └── img/
├── uploads/
├── backups/
├── Dockerfile
├── docker-compose.yml
├── .env.example
├── package.json
├── AGENT.md
└── PROJECT_PLAN.md
```

---

## Фазы разработки

### Фаза 1 — Инициализация, схема БД, Docker

Источники: `Dockerfile` (адапт.), `docker-compose.yml` (адапт.), `package.json` (адапт.), `src/prisma.js` (адапт.), `src/database.js` (ref)

- [ ] `npm init`, установка зависимостей
- [ ] Скопировать generator/datasource из `~/Projects/home-apothecary/prisma/schema.prisma`
- [ ] Написать Prisma schema (11 таблиц, см. выше — включая OrderItem)
- [ ] `prisma migrate dev` — применить миграции
- [ ] `PRAGMA journal_mode=WAL` при инициализации Prisma client
- [ ] Адаптировать Dockerfile из `~/Projects/home-apothecary/Dockerfile`
- [ ] Адаптировать docker-compose.yml (volumes: db, uploads, backups)
- [ ] node-cron: ежедневный бэкап SQLite → /backups (ротация 30 дней)
- [ ] .env.example конфигурация

### Фаза 2 — Аутентификация и пользователи

Источники: `src/app.js` (адапт.), `src/server.js` (адапт.), `src/services/settingsService.js` (адапт.)

- [ ] Адаптировать `src/app.js` из home-apothecary (middleware-цепочка)
- [ ] Адаптировать `src/server.js` из home-apothecary (graceful shutdown)
- [ ] Модель User, bcrypt хеширование
- [ ] express-session (хранение в SQLite через better-sqlite3-session-store)
- [ ] Login / Register страницы
- [ ] Setup wizard (первый пользователь при первом запуске)
- [ ] Middleware авторизации
- [ ] Страница профиля (смена пароля, язык, Telegram)
- [ ] CRUD для справочников (Location, Manufacturer, ItemType)

### Фаза 3 — CRUD + UI для учёта

Источники: `views/index.ejs` (ref), `public/styles.css` (ref), `public/script.js` (ref), `src/routes/medicationRoutes.js` (ref), `src/services/medicationService.js` (ref)

- [ ] Layout: sidebar/nav из home-apothecary → `views/layouts/main.ejs` + `views/partials/*`
- [ ] CSS: tokens/reset из home-apothecary → нейтральная/профессиональная тема
- [ ] JS: разбить на модули в `public/js/`
- [ ] Реактивы: список → фильтры → форма → карточка → **кнопка «Заказать»**
- [ ] Расходники + посуда: список → фильтры → форма → карточка → **кнопка «Заказать»**
- [ ] Оборудование: список → фильтры → форма → карточка (без кнопки заказа)
- [ ] Автодополнение из справочников в формах
- [ ] Загрузка файлов (multer → Attachment)
- [ ] Soft delete + корзина с восстановлением
- [ ] AuditLog middleware (автоматическая запись)
- [ ] Подсветка строк: quantity ≤ min_quantity, просроченные
- [ ] Экспорт: CSV + XLSX (exceljs)
- [ ] Массовый импорт из Excel

### Фаза 4 — Заказы

Источники: новая функциональность

- [ ] Модальное окно заказа (`views/partials/order-modal.ejs`):
  - Автозаполнение из карточки реактива/расходника (name, manufacturer, catalogNumber, unit)
  - Поле количества (пустое, пользователь вводит)
  - Поле комментария
  - Возможность изменить любое поле перед отправкой
- [ ] `POST /orders` — создание OrderItem из модального окна
- [ ] Раздел «Заказы» в навигации (`views/orders/index.ejs`):
  - Таблица всех OrderItem с чекбоксами
  - Столбцы: ☐ | Название | Кол-во | Ед. | Производитель | Артикул | Комментарий | Кто добавил | Дата
  - Выделить все / снять все
  - Кнопка «Сформировать заказ (Excel)» — активна если выбрана хотя бы 1 позиция
  - Кнопка «Удалить выбранные» — очистка после экспорта
- [ ] `POST /orders/export` — генерация XLSX из выбранных ID (`services/orderExport.js`):
  - Столбцы: №, Название, Кол-во, Ед. изм., Производитель, Артикул, Комментарий
  - Автоширина колонок, шапка жирным
  - Скачивание файла `order_YYYY-MM-DD.xlsx`
- [ ] Возможность добавить позицию вручную (без привязки к карточке)

### Фаза 5 — Протоколы работы (SOP)

Источники: новая функциональность

- [ ] Вкладка «Протоколы» в навигации
- [ ] Список протоколов с фильтрацией по категориям
- [ ] TipTap rich-text редактор (content_ru / content_en)
- [ ] Блок «Необходимые материалы» — выбор из реактивов/расходников/оборудования
- [ ] Индикатор наличия: зелёный (есть) / красный (нет/мало)
- [ ] Версионирование: при сохранении → snapshot в ProtocolVersion
- [ ] Просмотр истории версий
- [ ] Экспорт протокола в PDF для печати
- [ ] Вложения через общую таблицу Attachment

### Фаза 6 — i18n, дашборд, UX

Источники: `src/i18n.js` (copy), `src/locales/*.json` (ref)

- [ ] Скопировать `src/i18n.js` из home-apothecary as-is
- [ ] Полная локализация: ru.json / en.json
- [ ] Переключатель языка в хедере
- [ ] Дашборд: сводка категорий, ниже минимума, просроченные, **кол-во позиций в заказе**
- [ ] Глобальный поиск по всем категориям + протоколам
- [ ] SQLite FTS5: виртуальные таблицы, $queryRaw
- [ ] Адаптивный дизайн (мобильный доступ)
- [ ] QR-коды для оборудования

### Фаза 7 — REST API (опционально)

Источники: `src/routes/medicationRoutes.js` (ref)

- [ ] /api/v1/ endpoints для всех сущностей (включая orders)
- [ ] Миграция EJS-страниц на fetch → API
- [ ] Swagger / OpenAPI документация
- [ ] Аутентификация API (JWT или API key)

### Фаза 8 — Telegram-бот (низкий приоритет)

Источники: `src/services/telegram.js` (copy), `src/services/botI18n.js` (copy), `src/services/telegramBot.js` (ref), `src/jobs/checkMedications.js` (адапт.)

- [ ] Скопировать `telegram.js` и `botI18n.js` из home-apothecary as-is
- [ ] Адаптировать polling/connectivity из `telegramBot.js`
- [ ] Адаптировать `checkMedications.js` → `checkInventory.js` (3 таблицы)
- [ ] Команды: /low, /search, /expiring
- [ ] Включение/выключение через .env (паттерн BOT_ACTIVE)
- [ ] Отдельный сервис в docker-compose

---

## Ключевые архитектурные решения

1. **Справочники** — Location, Manufacturer, ItemType как отдельные таблицы с FK
2. **Soft delete** — `deleted_at` во всех основных таблицах
3. **Полиморфные Attachments** — одна таблица, `entity_type` + `entity_id`
4. **AuditLog** — автоматически через middleware
5. **Версионирование протоколов** — snapshot в ProtocolVersion
6. **WAL mode** — конкурентное чтение
7. **FTS5** — полнотекстовый поиск
8. **Посуда = Consumable** — через поля `material`, `volume`, `type`
9. **Модульный frontend** — layout/partials/pages + JS-модули
10. **Заказы — текстовые поля, не FK** — manufacturer и catalogNumber хранятся как текст в OrderItem, т.к. при заказе данные могут отличаться от карточки

---

## Docker-конфигурация (Synology NAS)

```yaml
services:
  labstock:
    image: neightgar/labstock:latest
    container_name: labstock
    restart: unless-stopped
    ports:
      - "3120:3000"
    volumes:
      - /volume1/docker/labstock/data:/app/data
      - /volume1/docker/labstock/uploads:/app/uploads
      - /volume1/docker/labstock/backups:/app/backups
    env_file:
      - .env
    environment:
      - NODE_ENV=production
      - DATABASE_URL=file:/app/data/labstock.db
```

---

## Зависимости (package.json)

```json
{
  "name": "labstock",
  "version": "1.0.0",
  "private": true,
  "description": "Lab inventory database for Molecular Radiobiology Sector, LRB JINR",
  "main": "server.js",
  "scripts": {
    "start": "node src/server.js",
    "dev": "nodemon src/server.js",
    "db:migrate": "prisma migrate deploy",
    "db:migrate:dev": "prisma migrate dev",
    "db:generate": "prisma generate"
  },
  "dependencies": {
    "@prisma/client": "^6.x",
    "bcrypt": "^5.x",
    "better-sqlite3-session-store": "^0.x",
    "cookie-parser": "^1.x",
    "dotenv": "^17.x",
    "ejs": "^5.x",
    "exceljs": "^4.x",
    "express": "^4.x",
    "express-session": "^1.x",
    "multer": "^1.x",
    "node-cron": "^4.x",
    "qrcode": "^1.x"
  },
  "devDependencies": {
    "nodemon": "^3.x",
    "prisma": "^6.x"
  }
}
```
