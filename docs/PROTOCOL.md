# Связь вкладок

background.js хранит сессии панели в storage.session: tabId панели → host, token, sourceTabId. Доступ запрашивается только к выбранному хосту из optional_host_permissions. Временное правило встраивания ограничено tabId панели и sub_frame выбранного хоста.

panel.js отправляет prepare {url, compatibility, sourceTabId?}, resync-source и stop через chrome.runtime. Ответ {ok, data} либо {ok:false, error}. worker принимает управляющие команды только из верхнего фрейма extension/panel.html своего расширения.

bridge.js выполняет bridge-hello. worker разрешает работу только вложенным фреймам активной панели и соответствующего хоста. postMessage: {app:'mobile-qa-v2', token, type, ...payload}. Панель проверяет token и contentWindow фрейма; bridge проверяет родительское окно, origin и token.

Панель → фрейм: ping, snapshot, apply {event}. Фрейм → панель: ready {url}, route {url}, loading, intent, interaction {event}, view-state {state}, sync-ack {eventId,kind}, missing/blocked {message}. event.kind: click, input, scroll, key. target описывает семантический элемент; scroll содержит доли x/y, input — value/checked/type. seq назначается панелью. Значения полей не пишутся в диагностику.

desktop-source.js подключается только к явно связанному sourceTabId: source-hello; worker отправляет source-config {token} и source-stop. Источник отправляет source-event {eventType,token,payload}. worker проверяет frameId=0, исходную вкладку, хост и токен, затем пересылает desktop-source-event. Панель сверяет token. События: ready, route, interaction, loading, intent, blocked; worker также сообщает closed и domain-change. Передача из источника односторонняя; при follow-source действия мобильных экранов не передаются обратно в исходную вкладку.

Не зеркалить HTML submit. Не изменять target=_blank исходной вкладки. Не передавать password/file из источника. Не менять эти договорённости без регрессионного теста и описания в PR. Сложные различия desktop/mobile DOM могут давать missing — случайный элемент не нажимается.
