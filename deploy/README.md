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
bash deploy/db.sh exec -T postgres psql -U hack -d marketplace -v ON_ERROR_STOP=1 < deploy/dashboard_access.sql
bash deploy/db.sh exec -T postgres psql -U hack -d marketplace -v ON_ERROR_STOP=1 < checks/mart.sql
```

Сверить пять контрольных ответов через queries/dashboard.sql и исходные queries/01…05. После проверки удалить временные дампы из /tmp на обоих компьютерах. Исходные raw и core уже есть в дампе: повторно CSV загружать не нужно.

## 3. Отдельное подключение дашборда

Открыть интерактивный psql:

```bash
bash deploy/db.sh exec postgres psql -U hack -d marketplace
```

Внутри psql, один раз:

```sql
CREATE ROLE dashboard_app LOGIN;
GRANT dashboard_reader TO dashboard_app;
ALTER ROLE dashboard_app SET default_transaction_read_only = on;
ALTER ROLE dashboard_app SET statement_timeout = '30s';
\password dashboard_app
```

Пароль ввести интерактивно. Учётку администратора hack в дашборде не использовать. Публичные права, которые могли приехать из сторонних дампов, дополнительно проверять; для текущего проекта доступ к core/raw этой роли не выдаётся.

## 4. DBeaver через SSH

Создать НОВОЕ подключение PostgreSQL, учебную hh.ru не удалять. Основная вкладка: host 127.0.0.1, port 5432, database marketplace. Для аналитика — согласованная отдельная учётка; dashboard_app имеет только агрегаты. Во вкладке SSH: USER, SERVER, ваш ключ. Это открывает туннель к loopback VPS. Соединение назвать «Marketplace SERVER», локальное оставить «Marketplace LOCAL».

## 5. Резервные копии и проверка восстановления

```bash
bash deploy/backup.sh
```

Настроить ежедневный запуск и копирование архива в отдельное защищённое хранилище. Локальный volume и копия на том же VPS не защищают от потери сервера. Скрипт проверяет каталог архива, но это НЕ тест восстановления. Для такого теста:

```bash
bash deploy/db.sh exec -T postgres createdb -U hack marketplace_restore_test
bash deploy/db.sh exec -T postgres pg_restore -U hack -d marketplace_restore_test --no-owner --no-acl --exit-on-error --single-transaction < deploy/backups/ИМЯ.dump
bash deploy/db.sh exec -T postgres psql -U hack -d marketplace_restore_test -v ON_ERROR_STOP=1 < checks/mart.sql
```

Тестовую базу создавать с новым именем; удалять после проверки вручную. Команда down не удаляет данные; `down -v` уничтожает volume, для обычного обслуживания её не применять.

## Дальше

Измерять длительность отчётов и загрузки, размер базы, свободный диск, CPU/RAM; подключить pg_stat_statements и мониторинг. По результатам — индексы, материализованные агрегаты с расписанием, пул подключений. Для отказоустойчивости нужна реплика + механизм переключения либо managed PostgreSQL; один VPS этого не даёт. ClickHouse рассматриваем при подтверждённой тяжёлой аналитической нагрузке.
