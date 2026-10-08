# Индекс контекста

| Задача | Читать | Основной код |
|---|---|---|
| Первое знакомство | [project-map.md](project-map.md), [workflow.md](workflow.md) | `extension/manifest.json` |
| Установка и использование | [user-guide.md](user-guide.md), [device-sources.md](device-sources.md) | `extension/`, `extension/devices.js` |
| Панель, размеры, поворот | [frontend.md](frontend.md), [codestyle.md](codestyle.md) | `panel.html`, `panel.css`, `panel.js`, `devices.js` внутри `extension/` |
| Синхронизация и переходы | [api-map.md](api-map.md), [risk-zones.md](risk-zones.md) | `extension/bridge.js`, `extension/desktop-source.js`, `extension/panel.js` |
| Разрешения, встраивание | [access.md](access.md), [risk-zones.md](risk-zones.md) | `extension/background.js`, `extension/manifest.json` |
| Настройки, отчёты | [data-map.md](data-map.md) | `extension/panel.js`, `extension/background.js` |
| Проверка и неисправности | [checks.md](checks.md), [runbooks.md](runbooks.md), [audit-types.md](audit-types.md) | Весь `extension/` |
| Сборка, CI, выпуск | [deploy.md](deploy.md), [checks.md](checks.md), [workflow.md](workflow.md) | `package.json`, `scripts/`, `tests/`, `.github/workflows/ci.yml` |
| Согласование и история | [working-agreements.md](working-agreements.md), [decisions.md](decisions.md), [changelog.md](changelog.md), [open-questions.md](open-questions.md), [task-analysis.md](task-analysis.md) | `AGENTS.md` |
