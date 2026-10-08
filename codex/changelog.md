# История сопровождения

## 2026-10-08

### Подготовка согласованного commit/push

- Пользователь явно подтвердил pre-flight с файлами документации и сборщиком. Выполнены npm ci и playwright install chromium, без изменения package/lock; использованы Node 24.19.0 и временный npm 11.21.0 вместо системного npm 6.
- Полный npm test прошёл: check, integration и desktop. Первый запуск остановился до тестов из-за пути npm-launcher; после исправления PATH повторный полный прогон успешен, код для этого не менялся.
- Проверены локальные сценарии синхронизации, навигации, стандартных форм и DNR cleanup; ограничения password/custom handlers/нескольких панелей остаются открытыми. Клиентские сайты не использовались, дополнительные резервные копии не создавались.
- npm run build прошёл; ZIP 24334 байта, 13 путей allowlist, совпадение байтов с исходниками, корректные CRC и manifest 2.6.1. Валидатор codex — 0 errors/0 warnings, git diff --check — OK. Package/lock не менялись; node_modules и dist не включаются в коммит.

### Объединение документации в codex/

- По прямому запросу пользователя сведения CONTRIBUTING.md и docs/PROTOCOL.md объединены с workflow/working-agreements/deploy/api-map; исходные два файла удалены. Пользовательские extension/README.md и extension/DEVICE-SOURCES.md перенесены в codex/user-guide.md и codex/device-sources.md. Корневой README оставлен кратким входом, AGENTS обновлён.
- Обновлены текущие ссылки, README/index, project-map, договорённости и профильные документы. Старые названия в предыдущих записях истории обозначают состояние до переноса.
- scripts/build.cjs теперь берёт 11 файлов приложения и 2 справочника codex; runtime-код/permissions/версии не менялись. Scope repository, schema 3 и выбранные features сохранены.
- Перед изменениями pull --ff-only подтвердил актуальность main. Зависимости не устанавливались, коммит/push и резервные файлы не создавались. Полный npm test/build требует подготовки среды и остаётся непроверенным.
- Проверки переноса прошли: валидатор codex 0 errors/0 warnings, локальные Markdown-ссылки в 25 файлах, scripts/check.cjs, синтаксис build.cjs и git diff --check. Все 13 уникальных источников ZIP существуют; в корне ровно AGENTS.md/README.md, Markdown в extension/ не осталось.

### Аудит codex-project-docs

- Перед аудитом pull --ff-only подтвердил актуальность main 26ccf12. Сверены core/schema/features/gates, исходники и инструменты разработки; больших структурных изменений документации не потребовалось.
- Уточнены оба README и docs/PROTOCOL.md: password исключён только у desktop source, PR не обязателен, описание изменений ведётся в согласованном Issue. Код приложения не исправлялся.
- Обновлены AGENTS, api-map, frontend, codestyle, workflow, working-agreements, project-map, risk-zones, runbooks, open-questions, checks и audit-types. Уточнены follow-source без связанного источника, исключение cleanup из общей очереди и условия snapshots; закрыто противоречие PR.
- Полный browser test/build и независимая проверка GitHub settings не входят в завершённый документационный аудит; соответствующие вопросы сохранены. Коммит/push и резервные файлы не создавались.
- Проверки аудита прошли: валидатор codex — 0 errors/0 warnings; локальные Markdown-ссылки в 27 файлах и завершающие пробелы — OK; git diff --check — OK; scripts/check.cjs — PASS. Версии manifest/package/lock совпадают (2.6.1), changelog не требует сжатия.

### Обновление после pull

- По запросу пользователя выполнен git pull --ff-only origin main: 8dc69f0 → 26ccf12, пять коммитов. Входящий AGENTS.md объединён с локальными правилами; временно содержимое удерживалось в памяти, резервных файлов не создавалось.
- Актуализированы карта, workflow/договорённости, checks, контракты, доступ, стиль, риски, диагностика, вопросы и решения. Добавлен deploy.md и feature deploy для ZIP/CI.
- Описаны Node 22+, Playwright/fflate, локальные fixture, две группы браузерных тестов, allowlist ZIP, GitHub Actions и прямой push в main. Уточнено, что отсутствие обязательных remote checks не отменяет локальные проверки и подтверждение коммита.
- Node v24.19.0: scripts/check.cjs прошёл; синтаксис четырёх .cjs-файлов прошёл; git diff --check прошёл. Полные npm test/build не выполнялись: node_modules отсутствует, зависимости/Chromium не устанавливались. Изменений JS приложения, коммита и push нет.
- Состояние GitHub settings/CI runs отдельно не проверялось; сохранившаяся ссылка на PR в docs/PROTOCOL.md отмечена как несогласованность документации.
- Валидатор обновлённой документации прошёл: 0 errors, 0 warnings. Scope остаётся repository, schema 3; добавлен профиль deploy, исходная дата завершения инициализации сохранена.

## 2026-10-06

- По подтверждению пользователя инициализированы AGENTS.md и codex/ по schema 3 для одного репозитория.
- Проверены все текстовые исходники extension, manifest, пользовательские README, DEVICE-SOURCES, gitignore и локальная история Git.
- Описаны два режима синхронизации, контракты, storage, permissions, DNR, DOM matching и диагностика.
- Зафиксированы расхождение защиты password, пределы submit guard, остаточные permissions/scripts, ограничения SPA history и viewport-профилей; код не изменён.
- Node v24.19.0 из встроенного runtime: syntax check всех пяти JavaScript-файлов прошёл. Manifest JSON разобран, ссылки service worker и icons существуют. `git diff --check` прошёл; новые документы отдельно проверяются валидатором и проверкой пробелов.
- Валидатор codex-project-docs завершился с 0 errors и 0 warnings; все 20 новых файлов прошли проверку завершающих пробелов. Инициализация завершена, schema 3, completedAt 2026-10-06.
- Browser smoke и сетевые Git-команды не выполнялись; коммит и push не создавались.
