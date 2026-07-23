# TM6 Bonus v56 — дебетовий рейтинг і персональні видачі

## Що додано

- Натискання на картку **«Дебетовий напрямок»** відкриває сторінку `/goals/debit`.
- Рейтинг усіх операторів читається з вкладки **`Аркуш2`**.
- Кнопка **«Переглянути мої видачі»** відкриває `/goals/debit/me`.
- Персональні видачі за **місяць** і **вчора** читаються з вкладки **`Transformation Deb`**.
- Аватарки та повні логіни беруться з профілів TM6 за `goals_login`.

## Таблиця рейтингу на `Аркуш2`

Код автоматично шукає послідовність колонок:

```text
Debit | Inb_deb | Vse_Card | Web_Fuib | Web_apps | X_sell | Загальний deb
```

- `Debit` містить логін оператора.
- Рядок `TM_6` використовується як підсумок групи.
- Інші рядки сортуються за `Загальний deb` від більшого результату до меншого.

## Таблиця персональних видач на `Transformation Deb`

Блок за місяць:

```text
giving month | Inb_deb | Vse_Card | Web_Fuib | Web_apps | X_sell | Загальний
```

Блок за вчора:

```text
giving yesterday | Inb_deb yesterday | Vse_Card yesterday | Web_Fuib yesterday | Web_apps yesterday | X_sell yesterday | Загальний yesterday
```

Перший стовпець кожного блоку містить `goals_login` оператора.

## Що потрібно оновити

1. Завантажити новий frontend і Netlify Functions.
2. Замінити код Google Apps Script файлом `integrations/google-sheets/Code.gs`.
3. Повторно опублікувати Apps Script:

```text
Deploy → Manage deployments → Edit → New version → Deploy
```

Старий URL Web App можна залишити, якщо редагується наявне розгортання.
