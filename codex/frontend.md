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
