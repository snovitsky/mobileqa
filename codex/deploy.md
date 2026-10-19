# Сборка, CI и выпуск

## Локальная подготовка

Node.js 22+, `npm ci`, затем `npx playwright install chromium` (Linux: при необходимости `--with-deps`). Это инструкции проекта, не перечень выполненных при обновлении документации действий. Runtime расширения не зависит от npm; devDependencies — Playwright 1.62.1 и fflate 0.8.3.

Перед push: `npm test` и `npm run build`. Локальный кандидат 2.6.20 собирается по allowlist scripts/release-files.cjs. Обычный ZIP содержит 25 runtime-файлов в extension/ и два пользовательских документа codex/ (27 путей). Отдельный `npm run build:store` создаёт flat ZIP с manifest.json в корне и 25 runtime-файлами; внутренние документы, тесты, scripts, node_modules и рабочие файлы туда не входят. Store audit сверяет состав/байты, версии/permissions, imports и известные сигнатуры секретов. Timestamps фиксированы 2020-01-01; это артефакты поставки, не резервные копии.
## GitHub Actions

`.github/workflows/ci.yml`: push в main и pull_request; job checks, ubuntu-24.04, Node 22, timeout 15 минут, contents read. Порядок: checkout → setup-node/npm cache → npm ci → playwright install --with-deps chromium → npm test → npm run build → npm run build:store → upload artifacts. Artifact brandmaker-qa-<SHA> содержит обычный ZIP; отдельный brandmaker-qa-store-<SHA> — store ZIP и пользовательский Markdown; отсутствие ZIP завершает upload ошибкой. Concurrency по ref отменяет предыдущий незавершённый run.

Workflow реагирует на PR, но не требует создавать PR. По зафиксированным правилам workflow main допускает прямой push, обязательные PR/review/checks отключены владельцем. Это зафиксированное соглашение; настройки GitHub и результаты конкретных Actions runs отдельно не проверялись. Локальные проверки остаются обязательными перед отправкой.

## Подтверждённая поставка 2.6.17

Приложение и проверки коммита 04172716a72e7bce4980188e5371f8f0ffc35708 прошли полный GitHub Actions CI на Ubuntu 24.04/Node 22: https://github.com/snovitsky/mobileqa/actions/runs/39252205754. Шаги test, build и upload-artifact — success. Артефакт brandmaker-qa-04172716a72e7bce4980188e5371f8f0ffc35708 (id 12184904857) содержит ZIP 2.6.17. Локальный установочный файл — dist/brandmaker-qa-2.6.17.zip; загрузка unpacked extension/ описана в user-guide. Публикация в Chrome Web Store/GitHub Release этим процессом не выполнялась.

## Согласованный выпуск

Разрабатывать в staging, продвигать согласованный проверенный SHA в main; обе ветки проходят одинаковый полный CI. Сначала pull --ff-only, без force push/удаления main. Согласовать пересечения в Issue. Коммит требует пользовательского pre-flight и явного подтверждения; запрос pull/обновить документацию не разрешает commit/push автоматически.

Версию менять одновременно в package.json и extension/manifest.json отдельным релизным изменением, lock обновлять `npm install --package-lock-only`. Согласованные релизы маркировать vX.Y.Z. Ручная установка — распаковать ZIP и загрузить extension/ в chrome://extensions. Автоматизация CWS/GitHub Release реализована в отдельных локальных workflows; фактическое подключение аккаунта/запуск ещё не выполнены. Наличие реальных release/tag artifacts не проверялось; не создавать дополнительные backup-архивы.

## Подтверждённая локальная сборка 2026-10-08

После установки зависимостей по lock и Chromium команды npm test и npm run build прошли на Windows/Node 24.19.0. ZIP содержит ровно 13 путей allowlist, содержимое совпадает с исходными файлами, CRC корректны, manifest 2.6.1. Это локальная проверка; результат удалённого CI или опубликованный release отдельно не подтверждён. Подробности среды — в checks.md.

## Воспроизводимость CI: 2026-10-19

По логу пользователя CI коммита dba01dd (2.6.16) остановился на desktop.cjs: trusted click не попал в второй span в matching fixture. Локально тот же assert воспроизведён при прокрученной панели: clicks=[], driver=phone. Исправлена подготовка координатного клика — scrollIntoView, учёт sticky-шапки, два animation frames и hit-test дочернего/родительского документов перед настоящим mouse.click. Проверки trusted/ambiguous matching не ослаблены. Это подтверждает дефект helper, но точное положение viewport в исходном CI run неизвестно.

Workflow закреплён на ubuntu-24.04, чтобы смена ubuntu-latest не меняла ОС автоматически. checkout@v6 и setup-node@v7 используют Node 24 для собственного исполнения (официальные action.yml: https://github.com/actions/checkout/blob/v6/action.yml и https://github.com/actions/setup-node/blob/v7/action.yml). Установленный для npm test Node остаётся 22. Поддержка образа: https://github.com/actions/runner-images#available-images. Предупреждения Actions об окружении не являются причиной указанного assertion. Успех нового удалённого run подтверждается отдельно после согласованного commit/push; локальные Windows-тесты не равны выполнению Ubuntu job.

CI 684c233 (run 39250228021) проверен: failure в desktop.cjs после успешного shared-anchor сценария; причина остановки теста — ожидание поля в уже detached Frame. Подготовлено ожидание значений через актуальные FrameLocator без повторного ввода. Прохождение локального теста не подтверждает успех нового Ubuntu run.

CI 7d49321 (run 39251372708): desktop полностью PASS, далее UI DPR 1.25 не подтвердил compact/focus-visible селектора. Добавлены ожидание фокуса и подробности стиля при неуспехе, исходные требования к обводке сохранены. Итог доставки определяется последним успешным run, а не отдельными пройденными стадиями.

## Локальная подготовка 2.6.20 и отдельный store ZIP

Актуальный кандидат — 2.6.20. scripts/release-files.cjs задаёт runtime allowlist: 25 файлов. Обычный build создаёт ZIP с extension/ и двумя пользовательскими документами codex/ (27 путей). build:store создаёт отдельный brandmaker-qa-2.6.20-store.zip: 25 runtime-файлов, manifest.json в корне, без codex/, тестов, scripts/, зависимостей и логов. store-audit.cjs сверяет состав, байты исходников, версии/permissions, imports, HTML scripts и известные сигнатуры секретов. Это сигнатурная проверка, не доказательство отсутствия любого секрета. release-notes.cjs валидирует локальную историю и готовит пользовательский Markdown.

В локальной версии ci.yml после test/build добавлен build:store и отдельный store artifact с заметками. Магазинного upload/publish в workflow всё ещё нет. Все прежние описания количества файлов относятся к прошлым версиям. План staging → main и автоматической публикации с едиными production-заметками: store-release-plan.md. До его внедрения существующие main-only правила сохраняются. Аккаунт издателя есть, карточка пока не создана; публикация и Google Cloud в этой задаче не выполнялись.

Для 2.6.19 подтверждён CI 76f7855: run 39259045747 прошёл во второй попытке того же SHA. Первая попытка упала на focus assertion ui-regressions.cjs; причина нестабильности не объявлена исправленной.


## Автоматизация магазина — локальная подготовка 2026-10-19

Актуальная реализация: одинаковый CI для main/staging, 22 suites включая secret scan + полная ordinary/store сборка. Store ZIP содержит 25 runtime-файлов, обычный ZIP — 27 путей. store-publish.yml получает точный artifact успешного CI main по run ID/SHA, проверяет его и отправляет через OIDC. store-status.yml мониторит draft-кандидат readonly, не повторяет публикацию. store-bootstrap.yml только явно связывает первый вручную опубликованный CI-пакет с provenance. Публикация выключена до CWS_PUBLISH_ENABLED=true (repository variable). Workflows закреплены на проверенные SHA. Код готовится локально; внешняя настройка, создание staging и push ещё не выполнены.

## Передача следующему исполнителю

Решение владельца 2026-10-19: текущий код/документы доставить прямо в main, создание staging и подключение Store оставить следующему разработчику/Codex. Порядок и готовое поручение — раздел передачи store-release-plan.md. Отслеживаемый store/release-state.json automationEnabled=false останавливает автоматические publish/monitor до установки зависимостей и Google auth даже при ошибочно включённом repository flag. CLI submit/monitor также проверяет блокиратор. Явные readonly status и operator bootstrap отделены от автоматической активации; в этой передаче их не запускаем.
