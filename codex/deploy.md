# Сборка, CI и выпуск

## Локальная подготовка

Node.js 22+, `npm ci`, затем `npx playwright install chromium` (Linux: при необходимости `--with-deps`). Это инструкции проекта, не перечень выполненных при обновлении документации действий. Runtime расширения не зависит от npm; devDependencies — Playwright 1.62.1 и fflate 0.8.3.

Перед push: `npm test` и `npm run build`. Build сначала запускает check, затем scripts/build.cjs через fflate формирует `dist/brandmaker-qa-2.6.3.zip`. В ZIP 13 явно разрешённых файлов: 11 файлов приложения в extension/ (пять JS, panel.html/css, manifest и три иконки) и codex/user-guide.md, codex/device-sources.md. Справочники берутся из единственного исходного места codex/; остальные внутренние документы, AGENTS, tests, node_modules и рабочие файлы не упаковываются. Timestamps ZIP фиксированы датой 2020-01-01; это артефакт поставки, а не резервная копия.

## GitHub Actions

`.github/workflows/ci.yml`: push в main и pull_request; job checks, ubuntu-latest, Node 22, timeout 15 минут, contents read. Порядок: checkout → setup-node/npm cache → npm ci → playwright install --with-deps chromium → npm test → npm run build → upload artifact. Artifact называется brandmaker-qa-<SHA>, содержит dist/*.zip; отсутствие ZIP завершает upload ошибкой. Concurrency по ref отменяет предыдущий незавершённый run.

Workflow реагирует на PR, но не требует создавать PR. По зафиксированным правилам workflow main допускает прямой push, обязательные PR/review/checks отключены владельцем. Это зафиксированное соглашение; настройки GitHub и результаты конкретных Actions runs отдельно не проверялись. Локальные проверки остаются обязательными перед отправкой.

## Согласованный выпуск

Работать только в main и собственном клоне, сначала pull --ff-only, без force push/удаления main. Согласовать пересечения в Issue. Коммит требует пользовательского pre-flight и явного подтверждения; запрос pull/обновить документацию не разрешает commit/push автоматически.

Версию менять одновременно в package.json и extension/manifest.json отдельным релизным изменением, lock обновлять `npm install --package-lock-only`. Согласованные релизы маркировать vX.Y.Z. Ручная установка — распаковать ZIP и загрузить extension/ в chrome://extensions. Автоматической публикации Chrome Web Store, GitHub Release или серверного deploy в workflow нет. Наличие реальных release/tag artifacts не проверялось; не создавать дополнительные backup-архивы.

## Подтверждённая локальная сборка 2026-10-08

После установки зависимостей по lock и Chromium команды npm test и npm run build прошли на Windows/Node 24.19.0. ZIP содержит ровно 13 путей allowlist, содержимое совпадает с исходными файлами, CRC корректны, manifest 2.6.1. Это локальная проверка; результат удалённого CI или опубликованный release отдельно не подтверждён. Подробности среды — в checks.md.
