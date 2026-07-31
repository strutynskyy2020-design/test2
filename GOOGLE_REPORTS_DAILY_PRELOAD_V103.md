# Google reports daily preload v103

## Що змінилося

Google-звіти більше не завантажуються окремо на сторінках Home, Goals, кредитного та дебетового рейтингів, персональних показників і Schedule.

Після входу застосунок:

1. одразу читає останній звіт із `localStorage`;
2. у фоні перевіряє лише маленький `snapshot_version`;
3. завантажує повний персональний звіт тільки коли в Google Таблиці опубліковано новий snapshot;
4. передає вже готові дані всім сторінкам через спільний hook `useDailyGoogleReports`.

Тому переходи між сторінками не запускають `google-goals` і не показують повторне «Завантаження цілей…».

## Як оновлюються дані

У Google Таблиці кнопка **Оновити звіти** має бути прив’язана до функції:

```text
refreshReports
```

Після натискання Apps Script:

- читає робочі аркуші один раз;
- формує персональні JSON-знімки;
- записує їх у прихований аркуш `_TM6_REPORT_CACHE`;
- створює новий `snapshot_version`;
- оновлює публічний manifest без персональних даних.

Сайт перевіряє manifest через `google-goals-version`. Відповідь кешується Netlify CDN, тому перевірка спільна для користувачів і не запускає важку персональну function на кожній сторінці.

## Важлива межа браузера

Відкритий браузер не може дізнатися про натискання кнопки в Google Таблиці зовсім без мережевої перевірки. У v103 ця перевірка легка, виконується у фоні та не блокує інтерфейс. Через CDN-кеш новий snapshot може з'явитися на сайті із затримкою до кількох хвилин.

## Розгортання

1. Розгорнути оновлений сайт і Netlify Functions.
2. Замінити Apps Script код файлом `integrations/google-sheets/Code.gs` або `Code-v103.gs`.
3. У Apps Script відкрити `Deploy -> Manage deployments`.
4. Відредагувати Web App, вибрати `New version` і натиснути `Deploy`.
5. Перезавантажити Google Таблицю.
6. Переконатися, що кнопка викликає `refreshReports` без дужок.
7. Натиснути **Оновити звіти** один раз після deployment.

## Нові файли

- `frontend/src/lib/googleReportsCache.js`
- `frontend/src/hooks/useGoogleReports.js`
- `netlify/functions/google-goals-version.js`
- `integrations/google-sheets/Code-v103.gs`
- `validate_google_reports_daily_cache_v103.js`
