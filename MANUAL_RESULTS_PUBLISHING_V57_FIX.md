# TM6 Bonus v57 — виправлення Apps Script

Виправлено синтаксичну помилку Google Apps Script у `updateResultsSnapshot()`.

Було:

```javascript
lock.waitLock(30_000);
```

Стало:

```javascript
lock.waitLock(30000);
```

Google Apps Script у цьому середовищі не прийняв числовий роздільник `_`.
Після заміни коду збережіть проєкт і перевидайте Web App новою версією.
