# Сборка, CI и выпуск

## Локальная подготовка

Node.js 22+, `npm ci`, затем `npx playwright install chromium` (Linux: при необходимости `--with-deps`). Это инструкции проекта, не перечень выполненных при обновлении документации действий. Runtime расширения не зависит от npm; devDependencies — Playwright 1.62.1 и fflate 0.8.3.

Перед push: `npm test` и `npm run build`. Build сначала запускает check, затем scripts/build.cjs через fflate формирует `dist/brandmaker-qa-2.6.17.zip`. В ZIP 20 явно разрешённых файлов: 18 файлов приложения в extension/ (двенадцать JS, panel.html/css, manifest и три иконки) и codex/user-guide.md, codex/device-sources.md. В runtime включены responsive.js, error-notice.js, access-settings.js, url-display.js и inspection-report.js. Справочники берутся из единственного исходного места codex/; остальные внутренние документы, AGENTS, tests, node_modules и рабочие файлы не упаковываются. Timestamps ZIP фиксированы датой 2020-01-01; это артефакт поставки, а не резервная копия.

## GitHub Actions

`.github/workflows/ci.yml`: push в main и pull_request; job checks, ubuntu-24.04, Node 22, timeout 15 минут, contents read. Порядок: checkout → setup-node/npm cache → npm ci → playwright install --with-deps chromium → npm test → npm run build → upload artifact. Artifact называется brandmaker-qa-<SHA>, содержит dist/*.zip; отсутствие ZIP завершает upload ошибкой. Concurrency по ref отменяет предыдущий незавершённый run.

Workflow реагирует на PR, но не требует создавать PR. По зафиксированным правилам workflow main допускает прямой push, обязательные PR/review/checks отключены владельцем. Это зафиксированное соглашение; настройки GitHub и результаты конкретных Actions runs отдельно не проверялись. Локальные проверки остаются обязательными перед отправкой.

## Согласованный выпуск

Работать только в main и собственном клоне, сначала pull --ff-only, без force push/удаления main. Согласовать пересечения в Issue. Коммит требует пользовательского pre-flight и явного подтверждения; запрос pull/обновить документацию не разрешает commit/push автоматически.

Версию менять одновременно в package.json и extension/manifest.json отдельным релизным изменением, lock обновлять `npm install --package-lock-only`. Согласованные релизы маркировать vX.Y.Z. Ручная установка — распаковать ZIP и загрузить extension/ в chrome://extensions. Автоматической публикации Chrome Web Store, GitHub Release или серверного deploy в workflow нет. Наличие реальных release/tag artifacts не проверялось; не создавать дополнительные backup-архивы.

## Подтверждённая локальная сборка 2026-10-08

После установки зависимостей по lock и Chromium команды npm test и npm run build прошли на Windows/Node 24.19.0. ZIP содержит ровно 13 путей allowlist, содержимое совпадает с исходными файлами, CRC корректны, manifest 2.6.1. Это локальная проверка; результат удалённого CI или опубликованный release отдельно не подтверждён. Подробности среды — в checks.md.

## Воспроизводимость CI: 2026-10-19

По логу пользователя CI коммита dba01dd (2.6.16) остановился на desktop.cjs: trusted click не попал в второй span в matching fixture. Локально тот же assert воспроизведён при прокрученной панели: clicks=[], driver=phone. Исправлена подготовка координатного клика — scrollIntoView, учёт sticky-шапки, два animation frames и hit-test дочернего/родительского документов перед настоящим mouse.click. Проверки trusted/ambiguous matching не ослаблены. Это подтверждает дефект helper, но точное положение viewport в исходном CI run неизвестно.

Workflow закреплён на ubuntu-24.04, чтобы смена ubuntu-latest не меняла ОС автоматически. checkout@v6 и setup-node@v7 используют Node 24 для собственного исполнения (официальные action.yml: https://github.com/actions/checkout/blob/v6/action.yml и https://github.com/actions/setup-node/blob/v7/action.yml). Установленный для npm test Node остаётся 22. Поддержка образа: https://github.com/actions/runner-images#available-images. Предупреждения Actions об окружении не являются причиной указанного assertion. Успех нового удалённого run подтверждается отдельно после согласованного commit/push; локальные Windows-тесты не равны выполнению Ubuntu job.

CI 684c233 (run 39250228021) проверен: failure в desktop.cjs после успешного shared-anchor сценария; причина остановки теста — ожидание поля в уже detached Frame. Подготовлено ожидание значений через актуальные FrameLocator без повторного ввода. Прохождение локального теста не подтверждает успех нового Ubuntu run.
