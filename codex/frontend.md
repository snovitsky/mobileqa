# Интерфейс и поведение панели

`extension/panel.html` — русскоязычная extension page, `panel.js` — ES module. Элементы управления: URL, Показать/Остановить, 3/4/5 экранов (default 4), sync (default on), compatibility (default off), масштаб auto/50/75/100%, follow-source, source-open, align, export-debug. Версия читается из manifest.

## Жизненный цикл

Panel читает source/url из query и preferences из storage.local. Если host ранее разрешён, автоматически prepare без нового permission prompt. Иначе start вызывает permissions.request прямо из click/submit gesture, очищает старые iframe и запрашивает prepare. Ошибки показываются в status.

Каждая карточка хранит select, iframe, readiness, очередь, orientation, URL и локальную navigationHistory. При смене количества карточки перестраиваются; прежние модели сохраняются по индексам. Default: iPhone 11, Redmi Note 13, Galaxy A12, iPad 11; пятый Pixel 7. Orientation не сохраняется в preferences.

`setURL` создаёт новый iframe с remote src до вставки, sandbox `allow-scripts allow-same-origin allow-forms allow-modals allow-downloads`, referrerpolicy strict-origin-when-cross-origin. Заглушка скрывается после ready от bridge. Нет подключения через 10/12 s приводит к сообщению, но не доказывает конкретную причину.

## Размеры и оформление

DEVICES.width/height задают реальный CSS viewport iframe, rotate меняет их местами. Scale меняет внешнее отображение transform, размеры контейнера пересчитываются. Auto использует ширину devices с вычетом gaps/оболочек, нижняя граница 0.1; верхняя граница не задана. DPR/platform/rank не используются для эмуляции. CSS clip и absolute iframe предотвращают нежелательную прокрутку оболочки при focus. Панель имеет flex-ряд и адаптивные controls до 700 px.

## Управление и контроль состояния

При follow-source события из карточек не зеркалируются; основная вкладка — источник. Без follow-source пользовательское взаимодействие выбирает leader. Sync off очищает pending queues и прекращает пересылку. До готовности — до 80 событий, scroll для одного селектора заменяет предыдущий.

Переключатель follow-source сам не вызывает prepare: при включении отправляет только resync-source. Если последняя сессия подготовлена без sourceTabId, нужно повторно нажать «Показать» с включённым следованием. Выключение checkbox само не посылает source-stop; panel перестаёт использовать события источника. Полная остановка выполняется отдельной кнопкой Stop/cleanup.

«Выровнять» использует URL готового лидера либо первого готового iframe. «Назад» использует navigationHistory карточек, не chrome history; при sync on действует на все. Reload тоже на все при sync on. Эти кнопки не навигируют основную вкладку.

Раз в 1200 ms панель запрашивает snapshot; сравнивает URL без hash и наличие `.fancybox-is-open,.fancybox__container,.lg-visible,dialog[open]`. Снимки должны быть не старше 2500 ms; после двух расхождений и паузы 1800 ms может выровнять URL в preparedOrigin или сообщить о другом modal state. В follow-source leader обычно отсутствует, поэтому этот алгоритм не является полноценным контролем совпадения с desktop.

## Brandmaker QA 2.6.2

Название панели и manifest — Brandmaker QA. Адрес, запуск/остановка, количество экранов, масштаб, синхронизация, встраивание, выравнивание, диагностика и связь с основной вкладкой собраны в верхнем header. На desktop header закреплён при прокрутке; до 700 px элементы переносятся, header становится обычным блоком. Подписи остаются видимыми, URL имеет доступный label, фокус клавиатуры сохранён. Существующие карточки, CSS viewport и протокол синхронизации не изменены. Пунктирных обводок целей и интерфейса Метрики в текущих исходниках нет.

## Выбранное оформление: тёмно-синяя шапка и рамки моделей

Применён предоставленный пользователем вариант 07: navy surface, светлое поле URL, cyan primary action, статус справа во второй строке на широком экране. В узких окнах controls переносятся; ошибки выводятся полностью. В resize карточка получает data-model/data-platform и класс landscape. CSS оформляет рамки iPhone 11/17/SE, Redmi Note 13, Galaxy A12/S24, Pixel 7 и iPad. Камера/выемка/кнопки декоративные, pointer-events:none, размещены вне viewport iframe; размеры страниц, события и permissions не менялись. Рамки стилизованы, не являются точной аппаратной моделью.

## Уточнение внешнего вида по изображениям производителей

Первая условная версия рамок заменена: системная полоска hardware-top вне iframe, широкая выемка iPhone 11, отверстие Redmi, Infinity-V Galaxy A12, камера iPad на длинной стороне. Скругление/детали масштабируются через --device-scale; auto-width учитывает фактические боковые padding/border каждой shell вместо общего вычета 18 px. Декоративная полоска увеличивает высоту макета, viewport сайта не уменьшается. Landscape — упрощённое оформление, не точная аппаратная маска. Источники: https://support.apple.com/en-gb/111865 , https://www.mi.com/global/product/redmi-note-13/ , https://www.samsung.com/ph/smartphones/galaxy-a/galaxy-a12-black-128gb-sm-a127fzkjxtc/ , https://support.apple.com/en-euro/guide/ipad/ipad72d777dc/ipados .

## Brandmaker QA 2.6.3: меню и физический масштаб

Основная панель — две строки: бренд/URL/start/stop, затем count/scale/sync/follow/source-open/settings/status. Compatibility, align, export-debug и calibration размещены в native details «Настройки». source-status доступен screen reader, hint визуально скрыт. Меню закрывается снаружи и Escape; статус имеет title для полного текста.

В режиме auto сохранено заполнение ширины, CSS 1:1 — прежний scale=1. 50/75/100% теперь относятся к физическому размеру и требуют калибровки. Dialog подгоняет полоску 50 mm, сохраняет pxPerMM и devicePixelRatio. Формула масштаба карточки: diagonalInches × 25.4 × pxPerMM × savedDPR/currentDPR / hypot(viewportWidth, viewportHeight), умноженная на выбранную долю. Масштаб только transform; CSS viewport не меняется. В physical-size скрыт дополнительный hardware-top, чтобы его высота не увеличивала откалиброванный экран. Углы и вырезы дают меньшую видимую область внутри полного прямоугольника. Рамки/корпус по сантиметрам не калибруются.

## Финальная компоновка и двустороннее управление 2.6.3

На desktop header в одну строку: бренд, поле URL шириной 300 px с Показать/Стоп, screens/scale/sync, включение основной вкладки и переход к ней, settings, индикатор состояния. Полное состояние доступно через title и aria-live. На узких окнах строка прокручивается горизонтально. Dropdown settings имеет fixed позицию, рассчитанную по summary, и не обрезается overflow header. Footer содержит три шага и два раскрываемых пояснения.

Following теперь означает включение обычной вкладки в общую двустороннюю синхронизацию. Действия из iframe передаются peers и desktop через worker, действия desktop — peers; активность выбирает leader, replay scroll подавлен. Routes активного iframe выравнивают остальные и desktop в пределах host. Sync off останавливает все направления и routes. Повторное включение Основная во время работы выполняет start, переподготавливая сессию.

## Исправленная геометрия вырезов и полного экрана

.display объединяет status chrome и .screen с iframe. Высота полного дисплея остаётся DEVICES.height × viewScale во всех режимах; website viewport = full height − status bar (36 iPhone11, 45 iPhone17, 22 SE, 30 Android, 24 landscape, 0 iPad). Физическая диагональ рассчитывается по .display, не по iframe. Dimensions подписывают фактическую CSS-высоту сайта. Рамки/вырезы не перекрывают сайт, полоска больше не добавляется поверх полного измеряемого дисплея. Камера A12 имеет плавную U/V-образную форму вместо clip polygon; iPhone island/выемка получили детали камеры. Нативная Safari/Chrome address bar по-прежнему не эмулируется.
