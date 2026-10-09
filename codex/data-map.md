# Данные и хранение

Серверной БД, ORM и миграций нет. Optional feature database используется для описания browser storage и локального состояния.

| Место | Схема | Жизненный цикл |
|---|---|---|
| chrome.storage.local | preferences: count (строка), compatibility (boolean), devices (массив id) | Сохраняется при смене count/compatibility/model, восстанавливается panel |
| chrome.storage.session | panels: объект tabId → `{host,token,sourceTabId,syncEnabled}` | Background загружает в Map при старте worker, persist после prepare/cleanup |
| DNR session rules | id, modifyHeaders action, condition tabIds/requestDomains/sub_frame | Добавляется prepare compatibility, удаляется cleanup |
| Память panel | cards, leader, token, running, pending events, navigationHistory, view state | Не постоянное хранилище; обновляется при ready/interaction/snapshot |
| Память panel | diagnostics, до 200 записей | Последовательный scroll одного устройства сворачивается; сброс при новой загрузке panel |
| Query panel | url и source | Меняется через history.replaceState; виден в URL extension page |

scale, orientation, sync и follow-source не сохраняются как preferences. Формы сайта и cookies относятся к загруженным сайтам и профилю Chrome; расширение не создаёт отдельный профиль на устройство.

## Диагностика

Пользовательская кнопка создаёт JSON через Blob/download: version, sync, devices `{model,url,state}`, events. Запись события содержит time,type,device,url и метаданные: kind,selector,sequence,message либо признаки divergence. Значения input намеренно не передаются в trace. В оперативных сообщениях replay значения присутствуют; password в bridge не исключён, см. [risk-zones.md](risk-zones.md).

Отчёт не сохраняется автоматически на сервер; сетевого endpoint диагностики в коде нет. URL не очищается от query/hash и может содержать чувствительные параметры. Документация не хранит примеры реальных credentials/token values.

## displayCalibration

chrome.storage.local хранит отдельный ключ displayCalibration: {pxPerMM,dpr}. pxPerMM — CSS-длина полоски / 50 mm, допустимый диапазон 1–16; dpr — devicePixelRatio при калибровке. Значения проверяются при чтении. Пароли, сайты и учётные данные отсутствуют. Настройка сохраняется между открытиями панели; для другого физического монитора пользователь должен повторить калибровку. Она не входит в preferences и не передаётся на сервер.

preferences.check404 — boolean, false по умолчанию. Результаты вёрстки, статусы документов, активный экран и QR живут только в панели; внешние сервисы не используются.

preferences.browserMode: expanded/collapsed/none, expanded по умолчанию; хранится локально вместе с другими настройками.

## 2.6.6 — Настройки панелей и ширина шапки

Режим «Только сайт» удалён. Панели по умолчанию развёрнуты; доступны expanded/collapsed, старое сохранённое none заменяется expanded при чтении. Верхняя шапка занимает полную ширину окна, адресный ввод получает оставшееся место. На узких окнах остаётся горизонтальная прокрутка одной строки.
