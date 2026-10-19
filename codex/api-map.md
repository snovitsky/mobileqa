# Контракты сообщений

HTTP API продукта нет. Общий normalizeURL в extension/devices.js допускает только http/https без username/password. Изменения формата сопровождаются регрессиями; workflow не требует обязательного PR.

## Runtime 2.6.15

protocolVersion остаётся 1: изменения оформления/drag не меняют защищённый runtime/postMessage контракт. Локальная серьёзность уведомления отделена от состояния сеанса: missing остаётся предупреждением, не командой остановки.

Panel-команды допускаются только от extension sender, frame 0, URL panel.html и tab. Выполняются через serial queue. Ответы: {ok:true,data} или {ok:false,error,code}; code проверяется по errors.js, native exception.message пользователю не показывается.

| Команда panel → background | Поля и результат |
|---|---|
| resolve-source | sourceTabId?, sourceWindowId? → candidate + protocolVersion:1 |
| watch-source | enabled, sourceTabId?, sourceWindowId? → candidate при включении, true при выключении; хранение sourceWatches отдельно от panels |
| source-open | sourceTabId?, sourceWindowId? → candidate; активирует текущую вкладку и фокусирует её окно |
| navigate-source | url, sourceTabId?, sourceWindowId?; проверяет TARGET host permission, навигирует текущий источник; изменённый URL → loading, прежний → текущий candidate |
| prepare | url, compatibility, sourceTabId?, sourceWindowId?, sync → {protocolVersion:1,token,sourceTabId,sourceWindowId,sourceURL} |
| set-sync | enabled; меняет syncEnabled активной сессии |
| source-apply | token,event; требует syncEnabled, source, token и совпадающий host |
| source-navigate | token,url; навигация в пределах подготовленного host независимо от syncEnabled |
| resync-source | повторный source-config текущему источнику |
| stop | удаляет session/rules; watch выключается отдельной watch-source false |

Candidate: {state,sourceTabId?,sourceWindowId?,sourceURL?,host?}. state: ready, loading, needs-access, unavailable, unsupported, unknown-url. URL берётся из pendingUrl либо url. Resolver выбирает активную вкладку фиксированного normal-окна; если активна панель, сохраняет известную вкладку сайта того же окна. При закрытии вкладки подхватывает активную в этом окне. Уже наблюдаемое закрытое окно возвращает unavailable, без перехода в чужое. При первичном восстановлении панели с исчезнувшими ID допускается повторно определить normal-окно. Переключение фокуса на чужое окно не перехватывает источник.

Background → panel source-candidate содержит panelTabId и candidate, без session token. Оно принимается только соответствующей панелью при включённом watch. Дедупликация включает state, поэтому loading → ready одного ID создаёт уведомление. Получение нового разрешения требует пользовательского жеста в panel, worker не запрашивает его сам.

Prepare проверяет host access/источник и возможность injection перед заменой прежней session. DNR rules заменяются атомарно; при неудачной конфигурации откатываются прежняя session/rules. Рамки заменяются панелью после успешной подготовки. Для явного ▶ требуется принудительное применение настроек, даже если candidate/URL прежние. Ревизия операции защищает от запоздалого prepare после Stop/смены режима.

## Источник, guards и синхронизация

| Направление | Контракт |
|---|---|
| desktop → background source-hello | {enabled,token}; только source tab, frame 0, host |
| desktop → background source-event | token,eventType,payload; allowlist ready/route/interaction/loading/blocked/intent/missing/sync-ack |
| background → desktop source-config/source-stop | обновление token либо выключение; при общем source cleanup не гасит оставшуюся session |
| background → panel desktop-source-event | panelTabId,token,eventType,payload; panel проверяет identity, token, following и подключение |
| bridge → background bridge-hello | enabled/token/parentOrigin только для session panel tab, frameId > 0 и host |

Следование адресам Main работает при sync off. Sync выключает повторение click/input/scroll/key и очищает pending, но не отключает наблюдение за адресом. Двусторонняя навигация из активного iframe через source-navigate сохраняет host guard; ручной адрес нового host передаётся через navigate-source после отдельного запроса доступа.

Desktop-source подключается на document_start, ready объявляется после DOMContentLoaded; поздний executeScript — запасной путь. Смена token/Stop отменяет отложенное объявление. Sender/tab/frame/host/token сохраняются. Desktop-source хранит один token: несколько панелей одного источника не являются полноценной многопользовательской синхронизацией.

## postMessage panel ↔ bridge

Envelope {app:'mobile-qa-v2',token,type,...payload}. Panel отправляет iframe с targetOrigin '*', принимает только от его contentWindow с текущим token. Bridge принимает только от window.parent с проверенным parentOrigin/token после handshake, отвечает extension origin.

Panel → bridge: ping, snapshot, apply {event}, http-status, inspect-page, cancel-pointer. Последняя команда проходит тот же guard source/origin/token/ready и отменяет только локальный зажатый жест; на другие экраны не пересылается.

После восстановления панели устаревшие ID служат только подсказкой: если сама панель активна в normal-окне, выбирается последняя доступная вкладка сайта в том же окне (lastAccessed, а в старых Chrome — ближайшая по порядку). Уже наблюдаемое закрытое рабочее окно не заменяется чужим окном: показывается ожидание.
Bridge → panel: ready/route {url}, loading, intent, interaction {event}, blocked/missing {message,eventId?}, sync-ack {eventId,kind}, view-state {state:{url,modal}}, http-status {url,status}, page-findings {url,findings,truncated}.

missing из bridge и desktop-source дополнительно содержит kind, eventId и reason: element-missing/different-page/apply-failed. Panel форматирует название действия, конкретный экран/основную вкладку и следующий шаг по reason; сырой вложенный текст не дублируется. blocked сохраняет отдельный смысл, например запрет повторения формы.

cancel-pointer — локальная отмена текущего pointer-жеста, не событие replay. Bridge отслеживает доверенный pointerdown, при выходе за viewport/out/blur/visibility освобождает capture и отправляет pointercancel/совместимый mouseup. Завершающий native click отменённого жеста подавляется до следующего pointerdown. Запасной parent-канал screen pointerleave/window blur проходит обычные source/origin/token/ready guards; другие экраны его не повторяют.

HTTP/DOM-результаты принимаются для текущего iframe/token/URL. responseStatus=0 означает отсутствие доступного статуса; SPA не наследует предыдущий. Проверки DOM не нажимают элементы и не отправляют формы.

## DOM matching и replay

Event: kind click/input/scroll/key, url, seq; target описывает selector/tag/id/name/href/aria-label/текст до 160 символов/image/anchor/classes без active/selected/current/open. Control описывается отдельно. Поиск использует видимость, id/control/anchor/совместимый selector/уникальные признаки; неоднозначность обычно возвращает null.

Replay отклоняет разные URL без hash. Scroll относительный, click вызывает el.click, input использует native setter и synthetic input/change, строки до 10000 символов. Escape повторяется keydown/keyup. Захват click/input проверяет isTrusted; scroll loop подавляется mute. До readiness очередь до 80 событий, scroll одного селектора заменяется.

Не зеркалить HTML submit и не изменять target=_blank исходной вкладки. Password/file исключены при capture/apply в обоих content scripts; значения полей не писать в диагностику. При неоднозначном DOM возвращать missing, не нажимать произвольный элемент. Стандартный submit guard не охватывает произвольные обработчики сайта. Предыдущая семантика 2.6.3, в которой sync off блокировал и маршруты, заменена в 2.6.13.

## Восстановление состояния 2.6.15

Контракт сообщений и protocolVersion:1 сохранены. Ответ navigate-source описывает начало перехода, а не гарантированное текущее состояние после доставки: панель повторно получает resolve-source. Loading перепроверяется раз в секунду до другого candidate/Stop; ready/route/loading desktop события используются как сигнал resolver. Iframe ping повторяется только у неподключённых карточек и отвечает прежним ready с токеном. Состояния UI partial/disconnected не являются новыми runtime-сообщениями.

access-revoked: worker → panel, {panelTabId,origins,sessionRevoked}. Отправитель проверяется как остальные runtime-сообщения; sessionRevoked:true относится только к удалённой после contains(false) session. Панель инвалидирует поздние операции и iframe; false не останавливает чужой разрешённый сеанс. Сохранённая session содержит permissionMatch. События Chrome onRemoved/onAdded проходят общую serial очередь; onAdded перепроверяет watch. ProtocolVersion остаётся 1; публичной команды произвольного отзыва от content scripts нет.


## Проверка и подсветка 2.6.17

inspect-page → page-findings дополнен inspectionId (номер сканирования в текущем document), viewport:{width,height}; findings:[{id,kind,selector,label,message}], максимум 200. kind: overflow/target/text; truncated отражает лимит результатов или обхода 10 000 элементов. Панель принимает только текущий iframe/token/URL.

show-finding panel → bridge: {inspectionId,url,findingId}. Проходит существующий source/origin/token/ready guard. Bridge сверяет номер последнего сканирования, точный URL и сохранённый Element.isConnected/видимость. Произвольного CSS selector в этой команде нет. Ответ finding-focused:{url,inspectionId,ok}; при false панель предлагает пересканировать. Подсветка/прокрутка не являются replay, не пересылаются другим экранам и не нажимают элементы. protocolVersion остаётся 1; старые поля findings совместимы, новая подсветка требует актуального bridge.


## Первое действие после reload: 2.6.18

Runtime envelope/protocolVersion:1 не менялись. Panel получает проверенные background desktop-source-event с текущим token. Если текущая session ещё ожидает resolver (candidate loading, sessionSourceId совпадает с sourceTabId, origin события совпадает с preparedOrigin, Sync on), interaction временно попадает в pendingSourceEvents, максимум 80; scroll одного селектора объединяется. Ready resolver для той же session открывает/оставляет нужные iframe и выпускает события только с текущими token/sourceTabId и совпадающим URL без hash. До bridge ready они используют обычную очередь карточки. Loading события документа очищают прежнюю очередь. Stop/Main off/Sync off, отзыв доступа, смена token/источника, неподдерживаемый источник и управление из другого макета отменяют накопленные события. При переполнении есть предупреждение о ручной проверке. Ввод password/file и submit по-прежнему исключаются upstream.

source-navigate сравнивает целевой URL с pendingUrl || url вкладки. Уже начатый переход к тому же адресу не запускается повторно через tabs.update; host/token/watch guards сохранены.
