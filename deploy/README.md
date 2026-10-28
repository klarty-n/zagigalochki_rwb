# Серверный PostgreSQL 16

Статус: комплект для VPS. Сам VPS ещё не выделен; облачного развёртывания пока нет. Это один сервер, без автоматического переключения при отказе. Нужен Linux с Docker Engine + Compose plugin, SSH-доступ и диск с запасом под данные, индексы, WAL и копии. Начальный размер ресурсов выбираем после измерений; для демонстрации можно начать с 2 vCPU/4 GB RAM и SSD, затем провести нагрузочную проверку.

Команды из корня репозитория. Используем отдельный compose, локальные настройки hh.ru и порт 5433 не меняются.

## 1. На VPS

```bash
mkdir -p deploy/secrets
chmod 700 deploy/secrets
(umask 077; openssl rand -hex 32 > deploy/secrets/postgres_password)
bash deploy/db.sh up -d --wait
```

Пароль генерировать только при первом запуске. Замена файла после инициализации volume НЕ меняет пароль в базе. Секреты и резервные копии исключены из Git. Порт PostgreSQL опубликован только на loopback VPS. Наружу нужен SSH; порт 5432 не открывать.

## 2. Перенести существующую базу

На Mac (пароль вводится по запросу; используется pg_dump версии 16 или совместимой с сервером):

```bash
pg_dump -h 127.0.0.1 -p 5433 -U hack -d marketplace -W -Fc -f /tmp/marketplace.dump
scp /tmp/marketplace.dump USER@SERVER:/tmp/marketplace.dump
```

На VPS: восстановление выполняется ТОЛЬКО в новую пустую marketplace, до начала командной работы. Нет --clean и удаления существующей базы. Роли исходной базы не импортируем; владельцем станет серверный hack.

```bash
bash deploy/db.sh exec -T postgres pg_restore -U hack -d marketplace --no-owner --no-acl --exit-on-error --single-transaction < /tmp/marketplace.dump
bash deploy/db.sh exec -T postgres psql -U hack -d marketplace -v ON_ERROR_STOP=1 < model/03_mart.sql
bash deploy/db.sh exec -T postgres psql -U hack -d marketplace -v ON_ERROR_STOP=1 < model/04_cached_mart.sql
bash deploy/db.sh exec -T postgres psql -U hack -d marketplace -v ON_ERROR_STOP=1 -c "BEGIN; REFRESH MATERIALIZED VIEW mart.category_sales_cached; UPDATE mart.refresh_state SET last_attempt_at=clock_timestamp(), last_success_at=clock_timestamp(), last_error=NULL WHERE name='category_sales_cached'; COMMIT;"
bash deploy/db.sh exec -T postgres psql -U hack -d marketplace -v ON_ERROR_STOP=1 < deploy/dashboard_access.sql
bash deploy/db.sh exec -T postgres psql -U hack -d marketplace -v ON_ERROR_STOP=1 < checks/mart.sql
```

Сверить пять контрольных ответов через queries/dashboard.sql и исходные queries/01…05. После проверки удалить временные дампы из /tmp на обоих компьютерах. Исходные raw и core уже есть в дампе: повторно CSV загружать не нужно.

## 3. Отдельное подключение API

Открыть интерактивный psql:

```bash
bash deploy/db.sh exec postgres psql -U hack -d marketplace
```

Внутри psql, один раз:

```sql
CREATE ROLE dashboard_backend LOGIN;
GRANT dashboard_api TO dashboard_backend;
ALTER ROLE dashboard_backend SET default_transaction_read_only = on;
ALTER ROLE dashboard_backend SET statement_timeout = '30s';
\password dashboard_backend
```

Пароль ввести интерактивно и указать эту учётную запись в серверном `DATABASE_URL` API. Браузер пароль БД не получает. `dashboard_api` читает нужные `mart` и согласованные таблицы `core` для экранов заказов и качества, но не получает запись и доступ к `raw`. Учётку администратора hack в API не использовать. Публичные права, которые могли приехать из сторонних дампов, дополнительно проверять.

## 4. DBeaver через SSH

Создать НОВОЕ подключение PostgreSQL, учебную hh.ru не удалять. Основная вкладка: host 127.0.0.1, port 5432, database marketplace. Для аналитика — согласованная отдельная учётка; dashboard_app имеет только агрегаты. Во вкладке SSH: USER, SERVER, ваш ключ. Это открывает туннель к loopback VPS. Соединение назвать «Marketplace SERVER», локальное оставить «Marketplace LOCAL».

## 5. Резервные копии и проверка восстановления

```bash
bash deploy/backup.sh
```

Настроить ежедневный запуск и копирование архива в отдельное защищённое хранилище. Локальный volume и копия на том же VPS не защищают от потери сервера. Скрипт проверяет каталог архива, но это НЕ тест восстановления. Для такого теста после создания дампа:

```bash
bash deploy/test_restore.sh deploy/backups/ИМЯ.dump
```

Ручной вариант:

```bash
bash deploy/db.sh exec -T postgres createdb -U hack marketplace_restore_test
bash deploy/db.sh exec -T postgres pg_restore -U hack -d marketplace_restore_test --no-owner --exit-on-error --single-transaction < deploy/backups/ИМЯ.dump
bash deploy/db.sh exec -T postgres psql -U hack -d marketplace_restore_test -v ON_ERROR_STOP=1 < checks/mart.sql
```

Роли PostgreSQL должны существовать на целевом сервере: они являются глобальными объектами и не входят в дамп одной базы. Права таблиц восстанавливаются из архива; `--no-acl` здесь использовать нельзя, иначе проверка прав дашборда упадёт. Ручную тестовую базу удалять после проверки; скрипт удаляет свою автоматически. Команда down не удаляет данные; `down -v` уничтожает volume, для обычного обслуживания её не применять.

## Если сервер или база перестали работать

Если остановился только процесс или контейнер, сначала проверить его состояние и запустить снова: `bash deploy/db.sh ps`, затем `bash deploy/db.sh up -d --wait`. Архив в этом случае обычно не требуется: данные остаются в volume.

Если данные потеряны или испорчены, выбрать последнюю проверенную копию **из отдельного хранилища** и восстановить её в новую пустую базу по шагам разделов 1–3 выше. Не запускать `pg_restore` поверх рабочей заполненной `marketplace` и не удалять volume ради проверки. После восстановления выполнить `checks/mart.sql`, сверку ключевых количеств и сумм, заново создать глобальную роль входа `dashboard_backend` при необходимости, проверить `DATABASE_URL` API и только затем открывать дашборд пользователям. Данные, поступившие после времени создания копии, этим архивом не восстанавливаются: их нужно отдельно повторно загрузить из сохранившегося источника.

Сейчас расписание копирования и внешнее хранилище не настроены; локальный файл в `deploy/backups/` защищает от ошибок в базе, но не от потери самой машины.

## Дальше

Измерять длительность отчётов и загрузки, размер базы, свободный диск, CPU/RAM; подключить pg_stat_statements и мониторинг. По результатам — индексы, материализованные агрегаты с расписанием, пул подключений. Для отказоустойчивости нужна реплика + механизм переключения либо managed PostgreSQL; один VPS этого не даёт. ClickHouse рассматриваем при подтверждённой тяжёлой аналитической нагрузке.
