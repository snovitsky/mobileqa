# Первая настройка Chrome Web Store

Владелец отложил выбор исполнителя публикации. Сейчас код/документы передаются в main, без создания staging и без настройки аккаунтов. Следующему исполнителю сначала прочитать раздел передачи в ../codex/store-release-plan.md. Репозиторный блокиратор store/release-state.json содержит automationEnabled=false; его и repository variable CWS_PUBLISH_ENABLED включать только после отдельного согласования. Обычный push main с этой передачей магазин не публикует.

Состояние: инструкция для владельца аккаунта, не отчёт о выполненных действиях. Издатель Brandmaker, контакт info@brandmaker.ru, карточка пока не создана. Владелец подтвердил схему staging → main с одинаковыми обязательными проверками обеих веток; первоначальное создание staging/commit/push выполняется после release pre-flight. Внешние учётные данные в репозиторий не помещать.

## 1. Создать карточку один раз

1. Войти в [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole) под аккаунтом издателя. Проверить завершённую регистрацию и двухэтапную аутентификацию аккаунта.
2. После успешных локальных проверок собрать `npm run build:store`. Создать новый item, загрузив **`dist/brandmaker-qa-<версия>-store.zip`**. У этого ZIP manifest находится в корне. Обычный ZIP с каталогом extension/ для этого не использовать.
3. Скопировать **Item ID** созданной карточки и **Publisher ID** из аккаунта. Название издателя и номер Cloud-проекта не заменяют эти идентификаторы.
4. Заполнить описание, поддержку, изображения и Privacy practices по [listing.md](listing.md). Политика должна открываться без авторизации по постоянному HTTPS-адресу. Сначала отправить её в публичный репозиторий, затем проверить ссылку в приватном окне.
5. В Distribution выбрать **Unlisted**, проверить регионы. По ссылке сможет установить любой получатель. Ограниченный доступ по аккаунтам означает другой режим — Private. Требования модерации остаются общими. [Distribution](https://developer.chrome.com/docs/webstore/cws-dashboard-distribution).
6. Сохранить заполненную карточку. Первый выпуск может потребовать отправки через Dashboard, чтобы зафиксировать исходную видимость: API использует существующую видимость и не заменяет первоначальную настройку карточки. Если Dashboard и API позволяют отправить уже заполненный первый draft с корректным Unlisted, использовать проверенный workflow; при необходимости один раз завершить первоначальную публикацию в Dashboard. Последующие ZIP вручную не загружаются. [Публикация](https://developer.chrome.com/docs/webstore/publish), [API](https://developer.chrome.com/docs/webstore/using-api).

Пустая карточка и draft не означают доступность по ссылке. После модерации открыть опубликованную страницу из другого профиля, проверить название, издателя, версию и кнопку установки; сохранить окончательную ссылку. Модерация Google занимает отдельное время и не заменяется успешным Actions.

## 2. Связать издателя с Google Cloud без постоянного ключа

1. В выделенном/согласованном Google Cloud project включить **Chrome Web Store API**.
2. Создать отдельный service account для публикации Brandmaker QA. Для доступа к Store не выдавать ему Cloud Owner или Editor: связь с издателем настраивается отдельно.
3. В Account Developer Dashboard добавить email этого service account. Такая связь даёт полномочия управлять items издателя; по официальной документации допускается один service account на publisher. [Service accounts](https://developer.chrome.com/docs/webstore/service-accounts).
4. Создать Workload Identity Pool и OIDC provider для GitHub Actions, issuer `https://token.actions.githubusercontent.com`. Настроить mapping для `google.subject`, `attribute.repository_id`, `attribute.ref` из GitHub claims. Если workflow использует environment — сопоставить и проверять также environment.
5. Условием provider ограничить **числовой repository_id именно snovitsky/mobileqa**, `assertion.ref == 'refs/heads/main'` и, при использовании GitHub environment, `assertion.environment == 'chrome-web-store'`. Проверять реальные claims выбранного workflow: claim environment существует только у соответствующего job. Не оставлять trust для всей GitHub-организации или всех веток.
6. На **этом service account** выдать `roles/iam.workloadIdentityUser` только principalSet выбранного pool, ограниченному repository_id. Provider condition дополнительно ограничивает main/environment. Если выбранный способ получения токена требует TokenCreator, выдавать его точечно на account с объяснением необходимости; не выдавать на весь проект по шаблону.
7. В job публикации разрешить `id-token: write`, использовать `google-github-actions/auth` и короткоживущий access token со scope `https://www.googleapis.com/auth/chromewebstore`; не создавать JSON-ключ service account и не записывать credentials file в рабочую папку. Остальным jobs OIDC не нужен.

Порядок и актуальные параметры: [Google GitHub Actions auth](https://github.com/google-github-actions/auth), [GitHub OIDC для Google Cloud](https://docs.github.com/en/actions/how-tos/secure-your-work/security-harden-deployments/oidc-in-google-cloud-platform). Cloud project ID, pool/provider names и числовой repository_id — реальные значения настройки, а не универсальные строки из примера.

## 3. Задать GitHub Actions variables

В Settings → Secrets and variables → Actions создать CWS_PUBLISH_ENABLED как **repository variable** (она используется до старта job). Остальные variables можно задать там же либо в environment chrome-web-store:

| Variable | Значение |
|---|---|
| CWS_PUBLISH_ENABLED | `false` на этапе настройки; `true` только после проверки карточки, WIF и согласования автоматического выпуска. |
| CWS_PUBLISHER_ID | Реальный Publisher ID из Developer Dashboard. |
| CWS_ITEM_ID | Реальный Item ID созданной карточки. |
| GCP_WORKLOAD_IDENTITY_PROVIDER | Полный resource name `projects/<project-number>/locations/global/workloadIdentityPools/<pool>/providers/<provider>`. |
| GCP_SERVICE_ACCOUNT | Email выделенного service account. |

Эти идентификаторы не являются секретными ключами, но не нужно подставлять вымышленные значения для «зелёного» workflow. OIDC token существует только во время job, его нельзя печатать в логах. Если используются environment variables, jobs должны явно указывать тот же environment. Правила доступа к environment должны разрешать main, без обязательного второго ручного одобрения после уже согласованного release push, если требуется полностью автоматический выпуск.

## 4. Проверить связку до разрешения публикации

1. Прогнать все тесты, обычную сборку, магазинную сборку и аудит состава точного ZIP.
2. Проверить read-only `fetchStatus` через настроенный service account; сопоставить возвращённые item/version/state с Dashboard. Не тестировать права случайной загрузкой/публикацией production.
3. Убедиться, что jobs иных веток/PR не могут получить publisher token; отсутствие любой обязательной variable блокирует publish, а не превращается в «успешный пропуск» согласованного выпуска.
4. Подготовить единый пользовательский patch note от последней **фактически опубликованной** версии. Для первого Store-релиза предыдущей production-версии нет. Следующая публикация объединяет итоговые изменения всех промежуточных dev-версий в один список.
5. Только после подтверждения точного кандидата включить `CWS_PUBLISH_ENABLED=true` и запускать выпуск из main. Автоматическая отправка после проверок использует `DEFAULT_PUBLISH`, чтобы после одобрения Google не требовалось вручную публиковать staged draft.

Успешный upload/ответ «отправлено на проверку» ещё не означает опубликованный релиз. Монитор сверяет фактическую published version, после чего фиксирует release provenance и пользовательские заметки. Если уже идёт модерация, следующий кандидат блокируется без автоматической отмены предыдущего. [Статусы API](https://developer.chrome.com/docs/webstore/api/reference/rest/v2/publishers.items/fetchStatus).

## 5. Пользовательская установка и обновления

После одобрения передать ссылку Unlisted. У unpacked-копии и магазинной установки может различаться ID: пользователь устанавливает магазинную версию один раз, отключает старую тестовую копию; настройки между разными ID сами не мигрируют.

Дальше обновляет Chrome. Открытая панель может откладывать установку; нельзя обещать мгновенную доставку после push. Уведомление до обновления должно опираться на `runtime.onUpdateAvailable`, после установки — на `onInstalled` с reason=update. История конкретного опубликованного выпуска доступна локально в панели и по постоянному адресу `https://github.com/snovitsky/mobileqa/blob/main/releases/<версия>.md` после его push. [Жизненный цикл](https://developer.chrome.com/docs/extensions/develop/concepts/extensions-update-lifecycle).

Возврат исправлений — новый проверенный выпуск с **большим** номером. Удаление карточки или уменьшение version не откатывает уже установленные копии.

## 6. Однократный bootstrap и действия после него

До первого выпуска оставить CWS_PUBLISH_ENABLED=false. После успешного CI main скачать store artifact именно этого SHA, загрузить его store ZIP при создании карточки и зафиксировать Unlisted. При необходимости отправить первый выпуск через Dashboard. Дождаться фактического PUBLISHED нужной версии.

В Actions → Record first Chrome Web Store publication указать successful_ci_run_id и включить confirmed_exact_package только после проверки, что в Store загружен именно его ZIP. Workflow проверяет происхождение CI/пакета, читает Store readonly и создаёт production provenance/tag/release. Сам в Store ничего не загружает. Первоначальное совпадение байтов подтверждает оператор, поскольку API не отдаёт digest пакета; обычная автоматическая поставка далее имеет собственную цепочку upload/digest. Если Unlisted удалось с самого начала отправить API, этот bootstrap не нужен: обычный monitor создаст production-запись.

После инициализации включить CWS_PUBLISH_ENABLED=true. Все следующие версии: подготовка заметок от фактической production-базы → подтверждённый commit/push staging → полный CI → продвижение main → такой же полный CI → автоматический upload/submit → monitor фактической публикации. Отдельных ручных загрузок следующих версий нет.

Для проверки привязки открыть Chrome Web Store review status → Run workflow → verify_connection. Это readonly status, без upload/publish. При отказе модерации, несовпадающих метаданных или неизвестном результате API автоматика останавливается для сверки; не нажимать повтор загрузки вслепую.
