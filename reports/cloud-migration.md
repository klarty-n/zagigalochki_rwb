# Общая база Neon: перенос подтверждён

Дата: 28 октября 2026. PostgreSQL 16, Free, Frankfurt. База marketplace.

Хост: ep-withered-moon-balxq14e.c-8.eu-central-1.aws.neon.tech

Совпали количества строк в 16 таблицах raw/core, суммы price, freight_value и payment_value. Месячный контроль: 24 строки, выручка 13 221 498,11.

Отдельные учётки: dashboard_backend для сайта и team_reader для чтения командой; raw и запись им не разрешены. Пароли хранятся вне Git.

Проверены 19/19 тестов, включая чтение общей Neon под backend-логином. Сайт и API готовятся к размещению в Render; этот отчёт подтверждает базу, а не публикацию сайта.
