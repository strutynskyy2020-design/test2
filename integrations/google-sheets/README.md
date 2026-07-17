# Google Sheets goals integration

Аркуш повинен називатися `Goals` і містити колонки:

`goals_login, employee_name, credit_current, credit_target, credit_mode, debit_current, debit_target, debit_mode, deposit_current, deposit_target, deposit_mode, monthly_bonus_current, monthly_bonus_target, note, updated_at`

1. Вставте `Code.gs` у Google Apps Script, прив'язаний до таблиці.
2. Опублікуйте як Web app (`Execute as: Me`, доступ відповідно до політики організації).
3. Додайте URL `/exec` у Netlify environment variable `GOOGLE_GOALS_SCRIPT_URL`.
4. Переконайтеся, що `REACT_APP_BACKEND_URL` або `BACKEND_API_URL` доступна Netlify Functions.
5. В адмін-панелі задайте користувачу `Ключ Google цілей`; він має збігатися з `goals_login` у таблиці.
