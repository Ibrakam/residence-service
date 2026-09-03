# Единый каталог жилых комплексов

Go API и PostgreSQL объединяют каталоги всех готовых сайтов. Исторический
versioned-import остаётся bootstrap/recovery-механизмом, а
[`cmd/sync-catalogs`](./docs/catalog-live-sync.md) безопасно координирует
регулярные server-side capture wrappers из уже авторизованных CRM-сессий.

## Проверенный охват

На 31 августа 2026 dry-run и импорт дают 15 файлов, 16 проектов и 2 912 локальных записей:

| Проект | Импортируется | Официальный/public universe | Полнота |
|---|---:|---:|---|
| Avalon Residence | 268 | не заявлен | полный showroom snapshot |
| Mirador | 199 | 199 | полный |
| Ofiyat | 585 | 585 | полный |
| Meros | 256 | 256 | полный |
| Sad'O | 338 | 338 | полный |
| Flagman Tashkent | 8 | 8 | полный текущий листинг |
| 4U Tashkent | 33 | 183 | **локальная выборка, неполный** |
| Voha | 104 | 104 | полный |
| Maftun Makon | 204 | 204 | полный |
| Botanika Saroyi | 224 | 224 | полный |
| Bayterak | 140 | 140 | полный |
| Zamon | 104 | 104 | полный |
| Yangi Baxt | 265 | 265 | полный |
| Jomiy | 121 | 121 | полный |
| Regnum Plaza | 12 | 12 | полный sanitized public snapshot |
| SUN | 51 available | 306 public records | **sanitized available subset** |

SUN metadata сохраняет public universe `306 = 51 available + 41 reserve + 214 sold`. В БД загружаются только 51 разрешённая public-клиентская запись; архивные записи не реконструируются и не выдумываются. Неполные 4U и SUN snapshots никогда не деактивируют отсутствующие в них записи.

Официальные unit IDs, исходные статусы, цены, локальные/официальные ссылки планировок и полный JSON объекта сохраняются в PostgreSQL. Публичный API отдаёт внутренний ID и непрозрачный `sourceKey`, но не выдаёт CRM `source_id` или raw provenance. Metadata snapshot содержит checksum, дату capture, источник, schema, локальное/официальное число и признак полноты.

## Быстрый запуск

Весь стек одной командой:

```bash
docker compose up --build
```

После healthcheck PostgreSQL контейнер API применит миграции, импортирует все versioned catalogs и будет доступен на `http://127.0.0.1:8080`. PostgreSQL и API привязаны только к loopback; внешний доступ к API должен идти через Nginx/HTTPS.

Локальный запуск для разработки:

```bash
make db-up
go run ./cmd/import-catalogs -dry-run -data-dir ../website/data
go run ./cmd/import-catalogs -data-dir ../website/data
go run ./cmd/api
```

Основные настройки перечислены в [`.env.example`](./.env.example). Приложение читает переменные окружения напрямую; файл `.env` намеренно исключён из Git.

`website/data/kayan-catalog.json` — единственный KAYAN authority при автоматическом общем импорте. Legacy `cmd/import-kayan` оставлен только для локального ручного восстановления из сохранённых raw Profitbase snapshots, но на startup одновременно не запускается, поэтому Mirador/Ofiyat не импортируются дважды. `backend/data/raw` исключён из Git, Docker build context и production image: API image не содержит raw KAYAN `sourceId`.

## API

- `GET /healthz` — liveness процесса API без зависимости от PostgreSQL;
- `GET /readyz` — PostgreSQL плюс непустой каталог и успешный общий import run;
- `GET /v1/developers` — застройщики;
- `GET /v1/projects` — проекты и агрегаты;
- `GET /v1/projects/{slug}` — проект и его очереди;
- `GET /v1/projects/{slug}/units` — помещения с фильтрами;
- `GET /v1/projects/{slug}/layouts` — планировки;
- `GET /v1/projects/{slug}/availability` — агрегаты статусов;
- `GET /v1/projects/{slug}/floor-schemes` — sanitized versioned-артефакт официальных поэтажных схем;
- `GET /v1/units/{id}` — карточка помещения;
- `GET /v1/sync/status` — результат последней синхронизации;
- `GET /v1/sync/catalog-status` — freshness, последняя попытка/успех и безопасный error code по каждому live-провайдеру и проекту;
- `POST /v1/leads` — локальное хранение валидированной заявки, только когда явно включено.

Пример каталога свободных трёхкомнатных квартир Ofiyat II:

```http
GET /v1/projects/ofiyat/units?phase=phase-2&status=available&rooms=3&limit=50
```

Фильтры каталога: `phase`, `status`, `propertyType`, `rooms`, `floorFrom`, `floorTo`, `priceFrom`, `priceTo`, `limit`, `offset`. Максимальный `limit` — 500. Полный контракт находится в [`openapi/openapi.yaml`](./openapi/openapi.yaml).

Нормализованные статусы: `available`, `reserved`, `sold`, `unavailable`. Исходное значение всегда хранится в `rawStatus` и полном `source_payload`, поэтому workflow-статусы не теряются.

## Как устроен импорт

```text
авторизованные официальные источники
        ↓ provider capture в одноразовый private staging
полный catalog JSON candidate
        ↓ completeness/freshness guard + атомарный importer
PostgreSQL: projects → phases → units/layouts
        ↓ read-only Go API
сайты всех ЖК
```

Для production-планировщика, fail-closed capture contract, dry-run, systemd и
machine-readable health см. [`docs/catalog-live-sync.md`](./docs/catalog-live-sync.md).

Импорт атомарный и идемпотентный. Каждое помещение получает стабильный opaque `sourceKey`; отсутствующие записи помечаются неактивными только для доказанно полного snapshot. Изменения цены и статуса пишутся в историю. Контрольные суммы, provenance и результаты запусков сохраняются в БД. `*-client.json`, включая SUN, обнаруживаются автоматически.

Проверить данные без PostgreSQL:

```bash
make audit-catalogs
```

Команда печатает local/official counts и `complete` для каждого проекта. Импорт выполняется `make import-catalogs`.

### Поэтажные схемы: совместимые schema v2/v3

`website/data/*-floor-schemes.json` обнаруживаются обычным production-importer рядом с каталогом. Локальные WebP разрешаются только из sibling-каталога `../public` относительно `CATALOG_DATA_DIR`; Compose монтирует его read-only как `/app/data/public` рядом с `/app/data/catalogs`. Dry-run валидирует тот же контракт и для каждой схемы сверяет реальные WebP bytes, SHA-256 и dimensions; при импорте sidecar дополнительно проверяется против catalog units и сохраняется в той же PostgreSQL-транзакции. Неверный `unitKey`, phase/entrance/floor/number, geometry, local image path, file integrity или capture coverage отклоняют весь import и PostgreSQL transaction откатывается.

Schema v2 остаётся неизменяемым legacy-контрактом Mirador. Schema v3 требует `phaseSlug` в scheme, scope floor/hotspot и expected-universe assignment; identity схемы — `phaseSlug + entrance + floor`, квартиры — `phaseSlug + entrance + floor + unitNumber` плюс strict stable `unitKey`. Поэтому одинаковый номер квартиры в разных очередях допустим, но не может случайно разрешиться глобально. V3 image prefix выводится из `projectSlug`, source screenshot dimensions объявляются в sidecar, а crop проверяется внутри этого canvas — Mirador-only `main`, 1661×811 и 34/209 не используются как generic defaults.

Отдельный статус schema v3 `not-published-by-source` означает подтверждённый read-only аудит, при котором официальный источник не публикует floor-plan assets. Это не auth blocker: обязательны `capturedAt`, `sourceStatus=captured-read-only`, `captureScope.mode=unavailable`, непустое audited exclusion и честные 0 schemes/0 hotspots; expected universe и companion evidence остаются `null`. Миграция `0010` добавляет это состояние forward-only и не меняет существующий Mirador row. Более старый или менее доказательный artifact не может заменить сохранённый captured результат; schema version также не понижается.

#### Legacy Mirador v2

Текущий официальный read-only capture от 2026-08-31 содержит 34 схемы и 209 hotspot-зон: подъезд 1, этажи 2–8; подъезд 2, этажи 2–13; подъезд 3, этажи 2–16. Raw screenshot bytes, crop provenance и CRM routes остаются в repository-only raw artifact; sidecar, БД и public API получают только локальные image hashes/dimensions, full-screenshot crop coordinates и безопасную provenance-проекцию без tenant/account/routes/credentials.

Для `captured-complete` обязателен независимый official expected-universe manifest с checksum точных bytes. Он покрывает квартиры 1…209 ровно один раз по entrance/floor: 199 квартир строго связаны со stable `sourceKey` locked snapshot, а десять отсутствующих в нём квартир подтверждены отдельным checksummed public-DOM companion и сохраняют `unitKey=null`. Старый 199-row snapshot не переименовывается в полный 209-row inventory. Официальный источник не публикует visual block → entrance mapping, поэтому `blockEntranceMapping` остаётся `null`, а схемы ключуются только по entrance/floor. Partial/blocked capture expected universe и companion evidence не публикуют.

Цепочка integrity разделена по слоям: `expectedManifestByteSha256` — bytes independent capture manifest; `sidecarByteSha256` — bytes sanitized sidecar, вычисляется importer и не включается в сам sidecar; `backendApiArtifactSha256` — каноническая API-проекция после UTC microsecond normalization. Эти checksums имеют разный смысл и не должны совпадать.

Подготовка новых локальных floor WebP вынесена в явную команду `npm run prepare:mirador-floor-schemes` из `website`: она сначала lossless-оптимизирует **весь** набор в adjacent temporary files, сверяет финальные dimensions/bytes/SHA-256 и полность raw/client JSON, а затем единым staged commit заменяет WebP и JSON. До конца проверки production assets не перезаписываются; при ошибке в середине commit восстанавливаются из adjacent backups. Обычные `npm run verify:mirador-plans` и production build только проверяют артефакты и ничего не перекодируют.

## Заявки

По умолчанию `LEAD_WRITES_ENABLED=false`: dev/test запросы не сохраняют PII и получают `503 lead_writes_disabled`. Для реального сохранения оператор должен отдельно включить флаг после настройки production privacy/retention.

Контракт требует `consent: true`, `projectSlug`, имя, телефон `+998XXXXXXXXX`, цель и язык. Поддерживаются `formContext` и legacy `context`. Identity namespaces намеренно разделены: `unitKey` всегда разрешается только по stable opaque `units.source_key` (даже если строка выглядит числом); JSON number `unitId` — только по deployment-local `units.id`; любая JSON string `unitId` (включая строку из цифр) и legacy `lastViewedApartment.uuid` — только по `units.source_id`. Различие JSON-типов сохраняет совместимость с публичными строковыми ID, включая Regnum, не смешивая их с PostgreSQL bigserial. Ни один namespace не используется как fallback для другого. Если передано несколько identity-полей, они должны разрешиться в одну canonical unit внутри указанного проекта; неизвестная, неоднозначная или принадлежащая другому ЖК ссылка отклоняется. Клиентские номер квартиры, цена, площадь и статус не считаются canonical и не сохраняются как доказательство.

Backend не содержит внешнего CRM sink и сам ничего никуда не пересылает. Для заявок действуют два внутренних предохранителя:

- `LEAD_DUPLICATE_WINDOW=1m` — PostgreSQL-cooldown для одинаковых `project + phone`. Проверка защищена transaction advisory lock и поэтому работает при нескольких API replicas; повтор получает `429` и `Retry-After`;
- `LEAD_MAX_IN_FLIGHT=8` — немедленный отказ `429`, если один процесс уже выполняет заданное число lead-транзакций. Это защищает пул БД от burst-нагрузки.

Это не заменяет edge rate limiting: при same-origin схеме Go получает соединение от Next.js/reverse proxy, а не от браузера. Backend намеренно не доверяет `X-Forwarded-For` и не пишет IP/имя/телефон в логи. Raw database error для lead тоже не логируется, потому что PostgreSQL detail может содержать всю failing row с PII.

`ALLOWED_ORIGIN` — точный comma-separated allowlist Origin без завершающего `/`. Заголовки CORS выдаются только совпавшему Origin, а чужой Origin для preflight/lead POST получает `403`. Явное пустое `ALLOWED_ORIGIN=` отключает CORS; `*` намеренно не поддерживается. Same-origin server-to-server proxy без Origin продолжает работать.

## Подтверждённые source gaps

`null` и пустая планировка сохраняются как отсутствие официальных данных — importer ничего не рассчитывает и не подставляет:

- Mirador: 51 unit-level plan строго сверен по number/area/rooms/floor с видимым official DOM; для оставшихся 148 нет доказанной exact-связи. Отдельно импортируются 44 официальных Mirador layouts; они не выдаются за поэтажные схемы. Ofiyat unit-level mapping не менялся. Цена отсутствует у 617 неактуальных/несвободных записей.
- Avalon Residence: у 60 занятых/проданных объектов нет цены; unit-level plan отсутствует во всех 268 JSON rows (floor-layout конфигурация живёт отдельно от snapshot).
- Regnum Plaza: все 12 public rows имеют «цена по запросу», поэтому numeric price остаётся `null`; у 2 rows нет официального public plan.
- Maftun Makon: у 3 из 204 rows нет подтверждённой планировки.
- Meros: 1 numeric price отсутствует; Sad'O: 3 numeric prices отсутствуют.

## Production note

`docker-compose.yml` — локальный/dev профиль. API в нём rootless/read-only, без Linux capabilities, с `no-new-privileges`, init, graceful stop и loopback bind. Compose явно включает миграции; обычный process default — безопасный `AUTO_MIGRATE=false`. Пароль `catalog` является только локальным default и не подходит для сервера. Для production задайте отдельные секреты через окружение/secret manager, применяйте миграции отдельным release-шагом, не публикуйте PostgreSQL, оставьте API на loopback за Nginx, настройте backup/restore и запускайте liveness по `/healthz`, readiness по `/readyz`.

### Обязательный edge limit для заявок

Rate limit должен стоять на самом внешнем Nginx, где `$remote_addr` — реальный TCP client. Для текущей same-origin схемы Next.js (`127.0.0.1:3000`) минимальная конфигурация:

```nginx
# http {}
limit_req_zone  $binary_remote_addr zone=residence_leads_per_ip:10m rate=5r/m;
limit_conn_zone $binary_remote_addr zone=residence_lead_connections:10m;

upstream residence_web {
    server 127.0.0.1:3000;
    keepalive 32;
}

server {
    # TLS/server_name и основной location находятся в production-конфигурации.
    location ~ ^/(?:v1/leads|api/sun-lead|api/regnum-plaza-lead)$ {
        client_max_body_size 64k;

        limit_req zone=residence_leads_per_ip burst=3 nodelay;
        limit_req_status 429;
        limit_conn residence_lead_connections 2;
        limit_conn_status 429;

        proxy_connect_timeout 2s;
        proxy_send_timeout 10s;
        proxy_read_timeout 10s;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_pass http://residence_web;
    }
}
```

Если перед Nginx есть CDN/LB, нельзя принимать произвольный клиентский `X-Forwarded-For`: сначала перечислите **только** документированные CIDR этого CDN через `set_real_ip_from` и используйте его канонический real-IP header. Иначе атакующий подменит адрес и обойдёт лимит. Для прямого публичного catalog API аналогичный exact location `/v1/leads` должен находиться на его внешнем gateway; сам Go-порт остаётся приватным.

Перед `LEAD_WRITES_ENABLED=true` также обязательны утверждённый срок хранения PII и scheduled purge, ограничение доступа к таблице/backups, шифрование диска и проверенный restore. PostgreSQL statement/bind-parameter logging для lead-запросов должен быть выключен: параметры содержат имя и телефон. Код не выбирает срок хранения за владельца данных и поэтому не удаляет заявки автоматически.

Миграция `0007_validate_lead_safety.sql` проверяет и legacy rows: если старая заявка нарушает consent/format constraints, release останавливается до явной ручной remediation и ничего автоматически не удаляет.

## Проверка

```bash
gofmt -w ./cmd ./internal
go test ./...
go vet ./...
go run ./cmd/import-catalogs -dry-run -data-dir ../website/data
docker compose config --quiet
```

## Telegram-очередь исправлений

`cmd/ticket-bot` — отдельный процесс для закрытой Telegram-группы. Он не
встраивается в публичный catalog API и не исполняет текст сообщений как shell.
Процесс принимает сообщения только из точного `TELEGRAM_CHAT_ID` и только от
положительных numeric user ID из обязательного `TELEGRAM_ALLOWED_USER_IDS`.
Это comma-separated allowlist без дубликатов; usernames, диапазоны, пустые
элементы, bot ID и отрицательные значения не принимаются. Даже если ID бота
ошибочно внесён в allowlist, update с `is_bot=true` всегда игнорируется.
Неавторизованный update молча фиксируется в offset/dedupe, но не создаёт тикет
и не получает ответ. Новый top-level тикет обязан начинаться с `/fix` (для
альбома — в caption). `/help`, `/status` и `/cancel` доступны только allowlist-
пользователям и являются управляющими командами. Ответ на реальное статусное
сообщение `TNC-*` можно отправить без `/fix`: пока тикет queued, он дополнится,
а после claim станет отдельным follow-up. Ответ без `/fix` на любое другое
сообщение бота молча отклоняется с сохранением offset/dedupe. Сообщения одного
Telegram media album объединяются по `media_group_id` и получают небольшой
`ready_after`; запоздавшая часть уже working/terminal альбома становится новым
queued follow-up и не меняет тело, которое уже получил worker.

Чтобы Telegram действительно передавал боту обычные сообщения группы, а не
только команды и ответы, для него нужно отключить Group Privacy в BotFather
либо выдать подходящие права администратора. Проверка `chat_id` в сервисе всё
равно остаётся обязательной и не заменяется настройками Telegram.

Миграция `0011_ticket_automation.sql` хранит update offset, дедупликацию
`update_id`/`message_id`, тикеты, сообщения, вложения и единственную worker
lease. Вложения сначала скачиваются в `TICKET_ATTACHMENT_DIR` с режимом `0600`,
проверкой размера и SHA-256; только после этого тикет можно claim. Истёкшая
lease возвращает незавершённый тикет в очередь при следующем claim.
Миграция `0012_ticket_queue_hardening.sql` добавляет durable status-sync marker,
хеш finalization token для идемпотентного подтверждения и byte-safe ограничение
объединяемого текста. Reply дописывается только в ещё queued тикет; после claim
или при переполнении 65 536 octets он становится отдельным queued follow-up.
Миграция `0013_ticket_attachment_retention.sql` добавляет состояние `purged` и
время очистки локального файла без удаления аудита тикета/сообщения.

Секреты задаются только окружением:

```bash
export DATABASE_URL='postgres://...'
export TELEGRAM_BOT_TOKEN='...'
export TELEGRAM_CHAT_ID='...'
export TELEGRAM_ALLOWED_USER_IDS='123456789,987654321'
export TICKET_WORKER_API_TOKEN='at-least-32-random-characters'
export TICKET_PUBLIC_WORKER_BASE_URL='https://form.tencorp.uz/__residence-ticket-worker/'
export TICKET_ATTACHMENT_RETENTION='720h'
export TICKET_ATTACHMENT_DISK_WARN_BYTES='5368709120'
go run ./cmd/ticket-bot
```

`TICKET_BOT_ADDR` по умолчанию равен `127.0.0.1:8090` и конфигурация
отказывается стартовать на публичном адресе. Nginx может публиковать только
`/__residence-ticket-worker/`, удаляя этот prefix перед proxy на loopback.
Attachment URL строится исключительно из `TICKET_PUBLIC_WORKER_BASE_URL`; Host
и forwarded-заголовки запроса не используются.

Worker HTTP handlers сохраняют переход в PostgreSQL и сразу отвечают worker'у,
не ожидая Telegram API. Периодический reporter повторяет все несинхронизированные
и недавние статусы, поэтому временный сбой Telegram не превращает успешный
deploy в timeout. Идентичный повтор `complete`/`fail` с тем же lease token после
потерянного HTTP-ответа подтверждается идемпотентно; другой payload или token
получает `lease_lost`.

Вложения completed/failed/cancelled тикетов старше
`TICKET_ATTACHMENT_RETENTION` (по умолчанию 30 дней) очищает отдельная команда:

```bash
go run ./cmd/ticket-bot cleanup-attachments --dry-run
go run ./cmd/ticket-bot cleanup-attachments
```

Она никогда не выбирает queued/working тикеты, проверяет соответствие пути
`TICKET_ATTACHMENT_DIR/<ticket-id>/<attachment-id>.*`, запрещает symlink и
выход из корня, после удаления переводит DB-запись в `purged`. При превышении
`TICKET_ATTACHMENT_DISK_WARN_BYTES` выводится warning; любая небезопасная
структура каталога останавливает очистку без продолжения.

Worker API `ticket-runner/v1`:

- `GET /healthz` — локальная liveness и версия;
- authenticated `GET /internal/ticket-runner/health`;
- `POST /internal/ticket-runner/lease`;
- `POST /internal/ticket-runner/tickets/{id}/heartbeat`;
- `POST /internal/ticket-runner/tickets/{id}/progress`;
- `POST /internal/ticket-runner/tickets/{id}/complete`;
- `POST /internal/ticket-runner/tickets/{id}/fail`;
- protected attachment URL из lease response.

Все внутренние запросы требуют `Authorization: Bearer ...`; запросы конкретного
тикета дополнительно требуют `X-Ticket-Lease`. Bearer должен проверяться Nginx
или самим сервисом, но не передаваться в URL.

Для безопасного end-to-end теста оператор с bearer может создать обычный
`[TEST]`-тикет без сообщения пользователя. Текст читается из stdin (или из
явного `--text`), затем бот публикует нормальный статус и реальный worker
забирает тикет из той же очереди:

```bash
printf '%s\n' 'Проверить маленькое изменение без публикации' |
  go run ./cmd/ticket-bot enqueue-test
```

Команда обращается только к loopback API и не запускает shell-команд из текста.
Перед production запуском примените миграцию отдельным release-шагом либо один
раз включите `TICKET_AUTO_MIGRATE=true`; постоянный production default —
`false`.
