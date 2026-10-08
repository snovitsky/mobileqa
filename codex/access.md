# Разрешения и границы доступа

`extension/manifest.json`: activeTab, storage, scripting, declarativeNetRequestWithHostAccess. Optional host permissions: http://*/* и https://*/*; это доступные к запросу шаблоны, а не автоматический запрос ко всем сайтам при запуске.

Полученный AGENTS.md запрещает расширение permissions/optional_host_permissions без явной инструкции пользователя; scripts/check.cjs проверяет точные массивы разрешений. Тесты меняют host_permissions только в временной fixture-копии расширения для loopback, не в исходном manifest. Доступы иных проектов использовать нельзя.

Panel запрашивает protocol://hostname/* после пользовательского Показать. При уже выданном доступе auto-start не выводит prompt. Background ещё раз проверяет permissions.contains. normalizeURL отклоняет протоколы кроме http/https и username/password в URL.

## Скрипты и сессии

Background регистрирует bridge на match выбранного host: allFrames true, document_start, persistAcrossSessions false. Bridge выходит в обычном top frame; handshake активирует его в iframe панели только при session, host и frameId > 0. Source внедряется executeScript в frame 0 выбранной основной вкладки; marker препятствует повторной установке listeners, source-config обновляет token.

Token генерируется crypto.randomUUID; хранится в storage.session и передаётся content scripts. Runtime проверяет extension sender и контекст вкладки; postMessage ограничивается token/source и parentOrigin на стороне bridge. Это контекстная проверка сообщений, не система пользовательской авторизации. Ролей, аккаунтов расширения, OAuth или отдельной модели доступа нет.

## Совместимость встраивания

DNR session rule удаляет x-frame-options, content-security-policy и content-security-policy-report-only только для sub_frame ответов requestDomains выбранного host в panel tab. В ordinary tabs правило не применяется. Полная CSP содержит больше ограничений, чем запрет iframe; результат требует отдельного подтверждения в обычном браузере.

cleanup удаляет подходящие session rules, session state и посылает source-stop. Permissions не отзываются; registered content scripts не удаляются. Site cookies, login и политика third-party frames управляются Chrome/сайтом; одна панель не предоставляет изоляцию сессии каждого устройства.
