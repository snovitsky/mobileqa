# Проверки

## Поддерживаемые способы

Node.js 22+, devDependencies из package-lock.json (`npm ci`) и Chromium (`npx playwright install chromium`) нужны для разработки. Расширение работает непосредственно в Chrome без Node. Отдельных lint/typecheck/unit runner нет; проверки — Node assert и Playwright.

| Команда | Что проверяет |
|---|---|
| `npm run check` | scripts/check.cjs: версии package/manifest, MV3, точные permissions/optional permissions, синтаксис всех JS extension, файлы worker/icons и запрещённые имена файлов |
| `npm test` | check, затем tests/integration.cjs и tests/desktop.cjs последовательно |
| `npm run test:integration` | Автономная панель: CSS widths, масштабированные клики, gallery/Escape, input, root/nested scroll, sync off, навигация/Back, preferences, 4→5 экранов, однократный POST, CSP compatibility, очередь/loading, восстановление URL, cleanup rules |
| `npm run test:desktop` | Основная вкладка: click/input/scroll/navigation/reload, сохранение target blank, один POST, Stop/reconnect и закрытие источника |
| `npm run build` | check и ZIP из allowlist через fflate; подробности в [deploy.md](deploy.md) |

Тесты поднимают HTTP-сервер на 127.0.0.1 с динамическим портом, создают временный тестовый стенд и отдельный Chromium profile; исходный manifest не меняют. Loopback host permission добавляется только в тестовую копию. Используются headless Chromium и Extensions.loadUnpacked через CDP; встроенный сайт искусственный, клиентские сайты не затрагиваются. Стенд удаляется в finally. Integration также создаёт временный preview.png, который удаляется со стендом. Это рабочие fixture теста, не сохранённые резервные копии. Полноту покрытия известных рисков не гарантируют.

Перед push обязательны обе команды npm test и npm run build. GitHub Actions выполняет их на Ubuntu/Node 22; результат конкретного CI run при этом обновлении не проверялся.

- `git diff --check` — пробелы/конфликтные маркеры в отслеживаемом diff. Новые неотслеживаемые документы требуют отдельной проверки.
- `python <путь-к-навыку>/scripts/validate_codex_docs.py .` — документы: схема, ссылки, gate, незавершённые маркеры. При нерабочем python alias использовать реальный доступный Python, без установки зависимостей.
- Современный Node: `node --check --input-type=module` с содержимым каждого `extension/*.js` через stdin — синтаксис; JSON.parse для manifest. Старый Node 10 не подходит для текущего синтаксиса.

## Ручной smoke в Chrome

1. В chrome://extensions включить developer mode, загрузить `extension/`, проверить отсутствие ошибок service worker. Manifest требует Chrome 118+; совместимость на нижней границе отдельно не подтверждена.
2. Открыть разрешённую тестовую страницу, нажать значок, затем «Показать», дать host access. Проверить 4 готовых экрана и следование основной вкладке.
3. Проверить 3/5 экранов, все профили, поворот, авто/50/75/100% масштаб. Убедиться, что меняется viewport, а не только внешняя оболочка.
4. Проверить click, text input, checkbox/select, Escape, scroll и URL/SPA-переходы; повторить с выключенным следованием, затем с выключенной синхронизацией.
5. На тестовой форме проверить единственную отправку стандартного submit; отдельно custom fetch-кнопку, без реальных действий с данными.
6. На своём тестовом сайте с CSP/X-Frame-Options проверить режим встраивания, ограничения по panel tab и host, снятие session rules после Stop/закрытия.
7. Проверить переход на другой домен, закрытие источника, повторное открытие панели и восстановление preferences.
8. Экспортировать диагностику только при необходимости задачи; проверить структуру и отсутствие значений полей. URL/селекторы могут содержать чувствительную информацию.

## Выполнение при инициализации 2026-10-06

Node v24.19.0 из встроенного runtime: все пять JavaScript-файлов прошли syntax check через stdin/module. Manifest JSON корректен, ссылки service worker и icons существуют. `git diff --check` прошёл; неотслеживаемые документы проверяются отдельно валидатором и проверкой пробелов. Python alias WindowsApps и Node 10 из PATH для этих проверок непригодны; использован встроенный runtime Codex без установки пакетов.

Browser smoke не выполнялся: задача ограничена документацией, браузерная установка и работа продукта не подтверждены. Известные дефекты не считать исправленными по результату syntax check. Итог валидации документации — в [changelog.md](changelog.md).

## Выполнение после pull 2026-10-08

Встроенным Node v24.19.0 выполнен `node scripts/check.cjs`: PASS syntax, manifest, version, permissions and Basic package. Все четыре .cjs-файла scripts/tests прошли node --check. `git diff --check` прошёл. node_modules отсутствует: npm test и npm run build не выполнялись, зависимости/Chromium для этой документационной задачи не устанавливались, ZIP не создавался. Это не готовность к push без оставшихся обязательных проверок. Валидатор документов запускается отдельно; результат в changelog.

При последующем audit-docs повторяются валидатор codex, проверка локальных Markdown-ссылок всего репозитория и git diff --check. Сценарий follow-source после автономного prepare добавлен к ручному smoke: включить checkbox, проверить сообщение resync и подключение после повторного «Показать». Синтаксическая проверка не подтверждает результат этого сценария в Chrome.

После объединения документации дополнительно проверить существование всех 13 источников build allowlist и синтаксис scripts/build.cjs: 11 файлов extension и user-guide/device-sources из codex. ZIP должен сохранять эти относительные пути. Полную ZIP-сборку нельзя считать проверенной только по allowlist; для неё нужен установленный fflate и npm run build.

## Проверки перед commit/push 2026-10-08

После явного подтверждения пользователя выполнены npm ci по lock-файлу и установка Chromium Playwright. Среда: Windows, Node v24.19.0, временный npm 11.21.0, Playwright 1.62.1, Chromium 151.0.7922.34. Первый запуск npm test остановился в npm-launcher до проверок из-за пути временного npm; после исправления PATH полный npm test завершился успешно без изменений кода/lock.

Прошли check, tests/integration.cjs и tests/desktop.cjs: автономная панель, CSS widths, click/input/Escape/scroll, sync off, переходы и Back, 4→5 экранов, preferences, однократный POST, очередь загрузки, восстановление URL, сохранение введённого адреса, scope/cleanup DNR; источник — click/input/scroll/navigation/reload, target blank, одна отправка, Stop/reconnect/закрытие. Это прогон локальных fixture в установленном Chromium, не подтверждение Safari, реальных устройств, Chrome 118 или всех открытых вопросов.

npm run build прошёл. В ZIP 13 ожидаемых уникальных путей: все байты совпадают с исходниками, CRC проверены, manifest 2.6.1. Валидатор codex завершился с 0 errors/0 warnings, git diff --check прошёл. package.json и package-lock.json установкой не изменены. ZIP и node_modules исключены из коммита через gitignore.

## Диагностика chiedocover.ru 2026-10-08

На macOS в отдельном headless Chromium Playwright с текущим extension 2.6.1 и тестовым доступом только к выбранному домену проверена загрузка четырёх экранов: автономный режим и follow-source. В обоих режимах четыре карточки сообщили «Подключён»; screenshot и DOM подтвердили отображение сайта. Compatibility включён. Клики и отправка форм не выполнялись. HTTP GET вернул 200 без CSP/X-Frame-Options. Сайт загружает сторонние iframe Botfaqtor, включая blocked.botfaqtor.ru; их наличие не доказывает причину белого экрана пользователя. Проблема в пользовательском профиле Chrome не воспроизведена; требуются уточнение области белого экрана и диагностика установленной копии. Полный npm test в рамках этой диагностики не запускался.

## Проверка Brandmaker QA 2.6.2 на macOS

npm test и npm run build прошли после переименования и переноса контролов в header. В отдельном Chromium проверены 1600/1024/390 px: URL остаётся в header, горизонтального переполнения controls нет. Screenshot 1600 px проверен визуально; header 128 px на 1600/1024, 241 px на 390. Manifest permissions не менялись. Результаты относятся к локальному Chromium; CI ещё не запускался.

После выбранного оформления 07 полный npm test прошёл с декоративными рамками: реальные CSS widths iframe остались 414/393/360/820; синхронизация и очистка DNR прошли. После перемещения status внутри settings визуально проверены ширины 1600/1024/390: controls не переполняют header, высота 115/145/251 px. Декоративные детали не перекрывают iframe.

## Калибровка и меню 2.6.3

node tests/physical-size.cjs прошёл на macOS/Chromium: требование калибровки и cancel, контрольная полоска 250 CSS px при условных 5px/mm, диагональ экрана iPhone 11 6.06×25.4×5 px (допуск <1px), rotation, 50%, persistence, CSS 1:1 и отклонение нулевого ввода. Физическое совпадение на пользовательском мониторе требует его ручной калибровки; тест проверяет геометрию и сохранение, не измеряет монитор линейкой. Полный npm test выполняется дополнительно перед выпуском.

Финальный прогон 2.6.3: check, integration и desktop прошли. Первый physical тест обнаружил отсутствие ожидания асинхронного close dialog в тесте; добавлен waitForFunction для завершения отмены. Повторный npm run test:physical прошёл, npm run build и git diff --check прошли. Полный npm test после исправления только тестового ожидания повторно не запускался.

## Полный финальный прогон перед коммитом

npm test полностью прошёл после исправления вырезов и двустороннего транспорта: check, integration, desktop с обратным phone/tablet управлением и выключением routes, physical-size с диагональю .display и проверкой status+site=display. npm run build и git diff --check прошли. Preview 1600: header 54px, элементы не переполняют строку; 1024/390: intentional horizontal scrolling, header 54/52px.

## Проверки ошибок страницы

`node tests/inspection.cjs`: локальный ответ 404, опция по умолчанию off, сохранение и отключение, отсутствие повторного HTTP-запроса при определении статуса, overflow/маленькая кнопка/мелкий текст, QR canvas. Запускается в npm test. Проверка не обращается к клиентским сайтам.

Physical-size тест дополнен проверками суммы всех частей дисплея, expanded/collapsed/none и неизменности физической диагонали при переключении.
