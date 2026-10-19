# Карта проекта

## Состав и стек

Один Git-репозиторий, папка приложения `extension/`. JavaScript без TypeScript и сторонних runtime-библиотек, HTML, CSS, Chrome Extensions API. Backend и SQL отсутствуют. Инструменты разработки требуют Node.js 22+: Playwright 1.62.1 для тестов и fflate 0.8.3 для ZIP. Lockfile v3 фиксирует зависимости. `.gitignore` исключает ZIP, node_modules, .env/.env.*, dist, test-results и playwright-report.

| Путь | Ответственность |
|---|---|
| `extension/manifest.json` | Версия 2.6.18, MV3, service worker module, действие значка, разрешения, PNG-иконки |
| `extension/background.js` | Открытие панели, подготовка сессии, очередь операций, host permissions, session DNR rules, регистрация bridge, источник и очистка |
| `extension/panel.html` | Русский интерфейс и подключение panel.js как module |
| `extension/panel.css` | Панель управления, карточки, оболочки устройств, масштабирование iframe, адаптация до 700 px |
| `extension/panel.js` | Карточки, запуск/остановка, лидер, очереди событий, runtime/postMessage, история URL, диагностика, выравнивание |
| `extension/devices.js` | 10 CSS viewport-профилей и normalizeURL; общий импорт для panel/background |
| `extension/bridge.js` | Скрипт iframe: описание DOM, сбор действий, поиск элемента, применение события, handshake и route polling |
| `extension/desktop-source.js` | Скрипт основной вкладки: сбор действий, runtime-связь, announce; двустороннее применение событий после проверки сессии |
| `extension/errors.js` | Общие коды и понятные сообщения ошибок panel/background/devices |
| `extension/error-notice.js` | Закрываемое сообщение об ошибке, время и счётчик видимых повторений; сброс без удаления diagnostics |
| `extension/responsive.js` | Собственный viewport 240..3840 CSS px, drag-ручки рамки/клавиатура, канонические размеры без аппаратного профиля и числовых полей |
| `extension/qr.js` | Локальный QR-генератор Project Nayuki, лицензия в исходнике |
| `extension/icons/` | Иконки 16, 48, 128 px |
| `README.md`, `codex/user-guide.md` | Корневой README — краткий вход; подробные инструкции и ограничения — только в codex/user-guide.md |
| `codex/device-sources.md` | Основания выбора стартовых профилей и ограничения статистики |
| `package.json`, `package-lock.json` | Node 22+, версии продукта и devDependencies, команды check/test/build |
| `scripts/check.cjs` | Синтаксис extension JS, согласованность версий, MV3, точные permissions и наличие файлов manifest |
| `scripts/build.cjs` | ZIP из 17 файлов extension и 2 справочников codex, фиксированные timestamps |
| `tests/integration.cjs` | Локальный HTTP fixture и headless Chromium: автономная панель, sync, формы, заголовки и cleanup |
| `tests/desktop.cjs` | Desktop source: взаимодействия, навигация, reload, target blank, одна отправка формы, Stop/закрытие |
| `tests/source-following.cjs`, `tests/responsive.cjs`, `tests/selection.cjs` | Следование активной вкладке/состояния/отмена, собственные размеры и отсутствие выделения iframe как объекта; результаты запусков — checks.md |
| `tests/error-notice.cjs`, `tests/pointer-boundary.cjs` | Закрытие/повторение ошибок и отмена жеста на границе iframe; результаты запусков — checks.md |
| `tests/tablet-geometry.cjs` | Геометрия display/screen, пиксели углов/границ при разных DPR, поворотах, масштабах и панелях; результаты — checks.md |
| `tests/physical-size.cjs`, `tests/inspection.cjs`, `tests/ui-regressions.cjs`, `tests/preferences.cjs`, `tests/errors.cjs` | Калибровка, проверки страницы, отображение/прокрутка/подсказки и восстановление настроек |
| `.github/workflows/ci.yml` | Ubuntu/Node 22, установка Chromium, test/build, ZIP artifact по SHA |
| `codex/workflow.md`, `codex/api-map.md` | Совместная работа только main и правила контракта сообщений |
| `.github/ISSUE_TEMPLATE/task.md`, `.github/PULL_REQUEST_TEMPLATE.md` | Шаблоны задач и сохранившийся необязательный PR template |

## Архитектура и основные потоки

Значок → background создаёт panel.html с параметрами url/source/sourceWindow. Panel запрашивает доступ к выбранному host при действии пользователя, background создаёт token и сессию, регистрирует bridge, при необходимости снимает заголовки во встроенных страницах и подключает desktop-source. Panel создаёт 3–5 iframe с выбранными CSS-размерами.

Основная вкладка → desktop-source → runtime → background → runtime → panel → postMessage → bridge → действие на DOM. При выключенном следовании источник событий — выбранный iframe; panel пересылает события другим карточкам. Служебных вкладок на каждое устройство нет.

В 2.6.13 sourceWatches отслеживают активную вкладку закреплённого normal-окна. Main следует URL даже при sync off; host access запрашивается отдельно. Явный адрес с Main навигирует источник через navigate-source; source-open фокусирует вкладку и окно. Настройка собственного размера — отдельный модуль responsive.js, параметры сохраняются по позициям.

Остановка/закрытие удаляет сессию и session rules и отключает источник. Контентные скрипты не снимаются через unregister; bridge остаётся зарегистрированным до конца браузерной сессии. Полные детали: [api-map.md](api-map.md), [data-map.md](data-map.md), [access.md](access.md).

## Git и поставка

2026-10-08 выполнен `git pull --ff-only origin main`: `8dc69f0` → `26ccf12`, пять новых коммитов. Изменились инструменты/правила/README, JavaScript приложения не менялся. Локальный AGENTS.md объединён с полученным; codex/ сохранён. Main совпал с origin/main на момент pull.

Работа только в main, отдельные клоны исполнителей, задачи и пересечения согласуются в Issue. Прямой push без force, PR не обязателен. По зафиксированным правилам workflow обязательные remote checks/review отключены владельцем; актуальные настройки GitHub отдельно не запрашивались. Локальные npm test/build по-прежнему обязательны перед push. CI создаёт ZIP artifact, соглашение релизов — теги vX.Y.Z; автоматической публикации магазина/сервера в workflow нет. Детали: [deploy.md](deploy.md).

В 2.6.15 access-settings.js управляет списком Chrome host grants и явным отзывом в настройках; background onRemoved очищает лишившиеся доступа сессии/скрипты и уведомляет панель. tests/access-revocation.cjs проверяет этот цикл в изолированном VM. ZIP содержит 19 файлов, включая 11 runtime JS; npm test запускает 15 сценарных скриптов последовательно.

`extension/inspection-report.js` — группировка DOM-замечаний в панели, локальный TXT и команды показа элемента; сканирование и подсветка исполняются в bridge.js.
