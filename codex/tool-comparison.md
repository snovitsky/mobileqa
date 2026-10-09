# Brandmaker QA и аналоги: сравнение и развитие

Проверено 2026-10-08. Brandmaker QA — локальная версия 2.6.3, коммит 9938b39, код и fixture tests. Конкуренты — официальные сайты/документация; приложения не устанавливались и сравнительного теста стабильности не было. НП означает «не подтверждено в просмотренных источниках», а не отсутствие функции. Цены, возможность оплаты и доступность из России не проверялись.

## Интерфейсы

Публичные изображения иллюстрируют устройство интерфейса; это не гарантия текущего дизайна установленной версии. Скриншот Sizzy — из страницы AppSumo, остальные — из официальной документации. Изображения не скачивались в репозиторий.

- [Responsively, руководство](https://responsively.app/blog/responsively-app-guide): https://responsively.app/assets/img/blog/menu-options.jpg
- [Polypane, layouts](https://polypane.app/docs/layouts/): https://polypane.app/doc-img/layouts/horizontal.png
- [Sizzy, пример на AppSumo](https://appsumo.com/products/sizzy/): https://appsumo2-cdn.appsumo.com/media/stories/images/sizzy-1.jpg?optimizer=gif
- [BrowserStack Live, multi-device](https://www.browserstack.com/docs/live/multi-device-testing/single-tab): https://www.browserstack.com/docs/static/img/live/parallel-testing/single-tab-testing/four-devices.webp

## Сводная таблица

| Возможность | Brandmaker QA | Responsively | Polypane | Sizzy | BrowserStack Live |
|---|---|---|---|---|---|
| Формат | Chrome extension, локально | Бесплатное desktop приложение | Отдельный платный браузер | Отдельный платный браузер | Облачный сервис |
| Несколько экранов | 3–5, 10 профилей | Да, наборы устройств | Да, panes/разные layouts | Да, device canvas | До 4 реальных устройств в одной вкладке; Team Pro+ |
| Синхронизация действий | Click/input/scroll/Escape/routes; двусторонняя основная вкладка | Click/scroll/navigation; остальные детали НП | Navigation/scroll/click/input/keys/hover/focus | Scroll/click/type/navigation | Interaction Sync beta, ограничения сайтов/браузеров |
| Отключение sync | Общее для всех действий | Детали НП | По типу событий и navigation на pane | Общий переключатель | Да, включение/выключение перезапускает устройства |
| Скриншоты и видео | Нет встроенной функции | Screenshots/full-page, видео НП | Screenshots и запись | Screenshots/full-page/framed, video/GIF | Screenshots/bug capture, запись сессии |
| Сохранённые наборы/проекты | Только текущий набор в preferences | Device suites/import-export | Projects/workspaces/device presets | Projects/presets/layouts/sessions | Сохранение выбранных наборов |
| Раздельные cookies/logins | Нет управления изоляцией; профиль Chrome общий | НП | Да, per-pane sessions | Да, per-device sessions | Устройства имеют собственные браузерные состояния |
| Настоящие устройства и Safari | Нет | Не предоставляет device cloud | Свои устройства/другие браузеры через Portal для локальной разработки | QR открывает URL на собственном телефоне; внутри Chromium | Да, облако реальных iOS/Android и браузеров |
| Touch/DPR/safe-area | Не эмулируются; вырезы декоративные | Профили; детали НП | Да, device/touch/DPR/safe-area/svh | User agents/touch/software keyboard; safe-area/DPR НП | Реальное поведение выбранного устройства |
| Сеть/медленное соединение | Нет | НП | Network throttling | Network throttling | Да, отключается при Interaction Sync |
| Инспектор/ошибки/качество | JSON событий sync, обычные Chrome DevTools вне панели | DevTools/unified inspector, цветовые симуляции | Inspector/console/network, accessibility, Web Vitals, overflow | Unified console/inspector/CSS tools | Remote DevTools, screen readers; auto-a11y отдельный продукт |
| Физические сантиметры | Да, после ручной калибровки монитора | НП | НП | НП | НП; реальный девайс на удалённом экране не означает физический размер изображения |
| Обновления сотрудников | Unpacked folder + reload; автоматического канала нет | Канал обновлений не проверялся | Канал обновлений не проверялся | Встроенный updater заявлен | Сервис обновляет платформу, локальной установки продукта нет |

## Источники функций

- [Responsively overview](https://responsively.app/) и [официальное руководство](https://responsively.app/blog/responsively-app-guide): mirrored interactions, suites, screenshots, inspector, бесплатность.
- [Polypane sync](https://polypane.app/docs/synced-interactions/), [emulation](https://polypane.app/docs/emulation/), [sessions](https://polypane.app/docs/session-management/), [Portal](https://polypane.app/docs/portal/), [overflow detection](https://polypane.app/docs/horizontal-overflow/), [overview](https://polypane.app/).
- [Sizzy](https://sizzy.co/): devices, sync, sessions, capture, presets, simulations, updater. «Real device sizes» — размеры Chromium panes, не облако физических телефонов.
- [BrowserStack Live multi-device](https://www.browserstack.com/docs/live/multi-device-testing/single-tab): текущая подробная документация подтверждает 4 устройства и beta sync, поэтому прежнее сомнение между старой обзорной страницей и marketing разрешено. [Live controls](https://www.browserstack.com/docs/live/get-started/test-websites).

## Оценка

Наш продукт уже покрывает базовую одновременную проверку вёрстки и подходит для простого рабочего процесса агентства в текущем Chrome. Отсутствие аккаунта/облачного сервиса, русскоязычная компактная панель, обычная вкладка на другом мониторе и калибровка — удобства для нашей команды. Это не доказательство общего превосходства. Базовое зеркалирование не уникально; ширина инструментария у аналогов выше. Степень стабильности всех продуктов нельзя ранжировать без одинаковых тестов на клиентских сайтах. В Safari/hardware accuracy наше расширение существенно уступает BrowserStack; декоративный вырез не создаёт env(safe-area-inset-*), touch или мобильный рендеринг.

## Что перенять и в каком порядке

| Приоритет | Функция | Польза | Реализация/ограничение |
|---|---|---|---|
| 1 | Ясная причина загрузки/рассинхронизации, выделение активного устройства | Сотрудник понимает, какой экран управляет и что не повторилось | Локальные сообщения и UI, без внешних API |
| 1 | Раздельный sync scroll/click/input/navigation; «не повторять следующий клик» | Меньше случайных повторных действий, особенно формы/заказы | Перенять идею Polypane; текущий submit guard не гарантирует защиту custom JS |
| 1 | Скриншоты, заметки/стрелки, HTML-отчёт с URL/model/time | Передать программисту точный дефект и подтвердить исправление | Capture cross-origin iframe требует отдельной проработки; нельзя обещать без проверки permission/архитектуры |
| 1 | Наборы сайтов/устройств, пользовательские размеры, экспорт настроек | Повторяемая проверка пяти сотрудников | chrome.storage.local, файлы без секретов; логины не экспортировать |
| 1 | Понятный канал обновления и номер сборки | Все сотрудники используют одинаковую версию | Unpacked folder manual; полностью автоматическое обновление через другой канал поставки |
| 2 | Проверка overflow, размера кнопок, мелкого текста, alt/labels | Практический аудит мобильной посадочной страницы | DOM проверки, подсветка дефектов вёрстки; без целей аналитики |
| 2 | QR-код текущей страницы на настоящий телефон | Быстро подтвердить Safari/клавиатуру/поведение телефона | Открывает только ссылку, не даёт sync реального телефона |
| 2 | Чек-лист агентства: меню, CTA, форма, спасибо, корзина, cookie banner | Проверка результата посетителя, а не только дизайна | Состояния локально, заявки не отправлять автоматически |
| 2 | Сравнение staging/production, до/после на одинаковом профиле | Проверка изменений без потери исходной версии | Сначала сравнить один размер, разные URLs с независимыми экранами |
| 3 | Автоматический повтор сценария/визуальная регрессия | Контроль обновлений сайта | Отдельный разрешённый test runner и fixture/staging; не real production submit |
| 3 | DPR/touch/network/media/safe-area emulation, isolated sessions | Более достоверное мобильное поведение | Существенное изменение архитектуры/permissions; не сводится к CSS рамке. Новые разрешения не добавлять без отдельного запроса |

Первая практическая очередь: стабильность/понятные ошибки → безопасное управление sync → скриншот с замечаниями → сохранённые наборы → аудит landing-page. Заимствовать продуктовые решения, не чужой код/графику без проверки лицензий. Код продукта этим исследованием не изменяется.
