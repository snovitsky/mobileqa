# Данные и хранение

Серверной БД, ORM и миграций нет. Feature database описывает browser storage и память панели.

| Место | Схема | Жизненный цикл |
|---|---|---|
| storage.local | preferences: count/scale, sync/followSource/compatibility, devices, landscapes, responsiveSizes, responsiveScales, check404, browserMode | Автосохранение пользовательских настроек, восстановление до запуска |
| storage.local | displayCalibration: {pxPerMM,dpr} | Калибровка монитора, сохраняется отдельно от preferences |
| storage.session | panels: tabId → {host,permissionMatch,token,sourceTabId,sourceWindowId,syncEnabled} | Рабочие сессии worker; prepare/cleanup обновляют Map и storage |
| storage.session | sourceWatches: panelTabId → {sourceTabId,sourceWindowId} | Следование выбранному рабочему окну; независимо от panels, выключается watch-source false/закрытием панели |
| DNR session rules | id, modifyHeaders, tabIds/requestDomains/sub_frame | Замена при prepare, удаление cleanup |
| Память panel | cards, leader, token, очередь событий, navigationHistory, snapshots, candidate/revision | Пересоздаётся при загрузке панели |
| Память panel | diagnostics, до 200 событий | До закрытия/обновления панели, экспорт только по кнопке |
| Память error-notice | lastMessage, occurrences, время последнего показа | Счётчик одинаковых видимых сообщений; clear/dismiss сбрасывают, диагностика сохраняется |
| Query panel | url, source, sourceWindow | Текущий адрес и подсказки выбора; меняется history.replaceState |

## Настройки экранов

count: 3/4/5; scale: auto/css/0.5/0.75/1; sync/followSource — строгие boolean. Отсутствующие значения используют defaults; незнакомые поля preferences сохраняются. devices[i] задаёт профиль позиции, landscapes[i] — boolean ориентации. responsiveSizes[i] содержит канонические {width,height} от 240 до 3840 CSS px для собственного viewport; массив сохраняется вместе с моделями. Поворот меняет отображаемую ориентацию, не теряет исходные размеры. Drag ручки обновляет память/отображение без записи storage на каждом движении и сохраняет изменённый размер один раз по завершении; клавиатурный шаг сохраняется сразу. Числовых полей ширины/высоты нет, .dimensions показывает текущее значение. После уменьшения количества сохраняются текущие позиции, как и модели.

browserMode: expanded/collapsed, прежнее none читается как expanded. check404 по умолчанию false. Настройки восстанавливаются до автозапуска после перезапуска Chrome в том же профиле; удаление расширения/профиля может их удалить.

Физический масштаб восстанавливается только при корректной displayCalibration; иначе используется auto без диалога. Калибровка pxPerMM допускает 1–16, dpr > 0; отмена не заменяет подтверждённый масштаб. Собственный responsive-профиль не имеет диагонали и использует CSS 1:1 при выборе физического масштаба. Калибровка не меняет его размеры.

## Источник и история

followSource сохраняет режим, а не постоянную идентичность вкладки. Query/sourceWatches содержат текущие ID и служат подсказками: resolver заново проверяет вкладку и normal-окно. При первичном восстановлении с исчезнувшими ID допускается выбор последнего normal-окна; если активна сама панель, среди сайтов того же окна используются lastAccessed либо близость index. Уже наблюдаемое закрытое окно возвращает unavailable, чужое окно не подменяет его.

tabs даёт адреса текущих вкладок, но chrome.history не используется. Полная история посещённых сайтов не сохраняется. Текущий адрес остаётся в query панели; локальная navigationHistory относится только к карточкам текущего сеанса.

## Диагностика

JSON содержит version, sync, devices {model,url,state}, последние события с time/type/device/url и kind/selector/sequence/message/code либо divergence. Последовательные scroll сворачиваются. Значения input в trace не записываются; в оперативном replay присутствуют значения обычных полей, password/file исключены.

missing в оперативном канале содержит kind/reason/eventId/message; reason описывает element-missing, different-page или apply-failed. Крестик сообщения и сброс его видимого счётчика не очищают diagnostics. Полная история сообщений на диск автоматически не записывается; время/счётчик уведомления живут только в текущей панели.

Серьёзность уведомления и состояние приложения хранятся/вычисляются отдельно в памяти панели. Предупреждение missing не меняет работающий сеанс на остановленный. #session-state доступен экранному диктору через sr-only, видимые текстовые подписи сеанса не выводятся.

URL не очищаются от query/hash и могут быть чувствительными. Отчёт создаётся по кнопке Blob/download без внешнего endpoint. Формы, cookies и авторизация принадлежат сайтам и профилю Chrome; расширение не создаёт отдельный профиль устройства. Статусы HTTP, DOM-замечания, QR и snapshots живут в памяти панели.

Состояния ready/connectionFailed карточек и таймер восстановления loading живут только в памяти панели. permissionMatch хранит точный запрошенный scheme://hostname/* для повторной проверки разрешений после отзыва. Для старых sessions без этого поля используется консервативный fallback по отозванному шаблону; новый prepare записывает поле. Список выданных доступов берётся непосредственно из Chrome permissions.getAll, отдельной копии в storage.local нет.

2.6.16: preferences.responsiveScales[i] хранит null или ratio 0.01..2 для позиции экрана. Отсутствующее/некорректное значение читается как null. Значение сохраняется при редактировании, rebuild и reload; у аппаратного профиля не применяется. Строка размеров создаёт временный редактор по клику; черновик не сохраняется до подтверждения.


## Результаты вёрстки 2.6.17

Последний scan ID, URL и Map id→Element живут только в bridge текущего документа и заменяются при новой проверке; до 200 записей. Панель держит только текущий отчёт в DOM. Значения полей не читаются для labels/export. TXT выгружается локально без сервера и storage; включает URL, видимые подписи, CSS paths, модель, viewport и время. Эти данные требуют проверки перед передачей.


## Очередь текущего источника 2.6.18

pendingSourceEvents в памяти панели: до 80 {token,sourceTabId,event}, без storage/export. Содержит те же поддерживаемые события, что обычные pending карточек; обычные значения input существуют лишь до применения/отмены. В trace попадают kind/selector/sequence без value. Password/file не захватываются. Выпуск только после готовности текущего источника и повторной проверки token/URL; отмена описана в api-map.

## Локальная подготовка 2.6.20

storage.local.extensionUpdate={version,previousVersion} записывается background при onInstalled reason=update для новой версии. seenReleaseVersion хранит подтверждённую пользователем версию уведомления. История release-notes.json упакована локально; чтение не обращается к серверу. Подсказки сайтов строятся в памяти по permissions.getAll, отдельная история URL/текстов ввода не сохраняется. Production-история между опубликованными выпусками и provenance описаны как будущая схема в store-release-plan.md.


## Автоматизация магазина — локальная подготовка 2026-10-19

Добавлены storage.local.pendingExtensionUpdate={version} и dismissedPendingUpdate=version. Они очищаются при onInstalled update. Значения форм для обновления не сохраняются; preferences записываются последовательно и подтверждаются каждой панелью перед reload. Релизные source SHA/digest/baseversion хранятся в CI artifact/release provenance вне extension ZIP.
