# Контракты сообщений

HTTP API продукта нет. Этот документ — единый контракт Chrome runtime и window.postMessage, включая правила ранее отдельного PROTOCOL. Изменения контракта/форм требуют причины в согласованном Issue и регрессионного теста; [workflow](workflow.md) не требует обязательного PR. Общий файл нормализации URL: `extension/devices.js`, только http/https, без URL username/password, схема по умолчанию https.

## Обязательные договорённости

Не зеркалить HTML submit и не изменять target=_blank исходной вкладки. Не передавать password/file из desktop source. Эти договорённости нельзя менять без описания причины и регрессионного теста. Текущее ограничение bridge: file исключён, password при управлении внутри панели может зеркалироваться; описание правила не означает исправление этого кода. Значения полей не писать в диагностику. При сложном desktop/mobile DOM допустим missing; не нажимать произвольный элемент ради продолжения синхронизации.

## Chrome runtime

| Откуда → куда | type | Поля / ответ |
|---|---|---|
| panel → background | prepare | url, compatibility, sourceTabId; ответ `{ok:true,data:{token,sourceURL}}` или `{ok:false,error}` |
| panel → background | resync-source | Ответ ok/data; отправляет source-config источнику |
| panel → background | stop | Очистка сессии и rules; ответ ok/data |
| bridge → background | bridge-hello | `{enabled,token,parentOrigin}` для подходящего frame/host/session |
| desktop → background | source-hello | `{enabled,token}` для frame 0 исходной вкладки |
| desktop → background | source-event | token, eventType, payload |
| background → desktop | source-config / source-stop | token при конфигурации; деактивация на Stop |
| background → panel | desktop-source-event | panelTabId, token, eventType, payload; closed/domain-change без обычного payload |

Background проверяет sender.id, tab, frameId и host. Panel-команды допускаются только для frame 0 с URL panel.html. Управляющие prepare/resync-source/stop и cleanup из tabs.onRemoved/onUpdated проходят Promise queue. Не каждый вызов cleanup защищён очередью: ветка chrome.action.onClicked при недоступной прежней панели вызывает его напрямую. Desktop events проходят allowlist ready/route/interaction/loading/blocked/intent; closed/domain-change создаёт background. Panel фильтрует source-event по token и following; panelTabId не проверяет.

## postMessage panel ↔ bridge

Envelope `{app:'mobile-qa-v2',token,type,...payload}`. Panel отправляет в iframe с targetOrigin `*`; принимает только сообщения своей карточки по e.source и token. Bridge принимает от window.parent, с точным parentOrigin и token, после readySent. Bridge отвечает на extension origin из handshake.

- Panel → bridge: ping, snapshot, apply `{event}`.
- Bridge → panel: ready/route `{url}`, loading, intent, interaction `{event}`, blocked/missing `{message,eventId?}`, sync-ack `{eventId,kind}`, view-state `{state:{url,modal}}`.
- Event: kind click/input/scroll/key, url и seq; target — описание DOM; input несёт value/checked/type, scroll — нормализованные x/y, key поддерживает Escape.

## DOM matching и replay

Описание: selector, tag, id, name, href, aria label, текст до 160 символов, image source, anchor, classes без active/selected/current/open; enclosing button/role button описывается отдельно. Поиск: root/id/control, anchor с оценкой видимой площади и swiper-slide-active, совместимый selector, уникальные атрибутные/классовые candidates. При неоднозначности обычно возвращает null.

Replay отклоняет разные URL без hash; scroll использует относительную долю доступной прокрутки, click вызывает el.click, input native setter и synthetic input/change, строки до 10000 символов. Escape dispatches keydown/keyup без sync-ack. isTrusted используется при capture click/input; scroll loop подавляется 400 ms. Стандартный submit guard не охватывает все реальные запросы сайта.
