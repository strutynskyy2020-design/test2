# Встановлення TM6 Bonus v107

## Зміни релізу

- Bonus Match розширено з 50 до 150 базових рівнів.
- Нові рівні 51–150 складніші: 33–38 ходів, 12 800–58 750 цільових очок, 22–32 монети та 10–25 комбінованих перешкод.
- За перше проходження рівня тепер нараховується 5 Point замість 10 Point. XP не змінено: 10 XP за перше проходження і 5 XP за повторне.
- Service Worker оновлено до `tm6-v107`, щоб мобільна PWA отримала новий каталог рівнів.

## Розгортання

1. Розгорніть увесь проєкт v107, включно з папками `backend` і `frontend`.
2. Переконайтеся, що backend використовує оновлений файл `backend/bonus_match_levels.json`.
3. На Netlify виконайте новий frontend deployment.
4. На телефоні повністю закрийте PWA та відкрийте її знову. Service Worker v107 активується і перезавантажить застосунок.
5. Google Apps Script у цьому релізі не змінювався. Можна залишити Apps Script v106.

## Прогрес користувачів

Скидання прогресу не виконується. Гравці, які вже пройшли рівень 50, автоматично отримають доступ до рівня 51 після першого запиту `/games/bonus-match/status` на новому backend.

## Перевірки

```bash
python validate_bonus_match_levels.py
python validate_bonus_match_rewards_v93.py
pytest -q tests/test_bonus_match_v89_regression.py tests/test_bonus_match_v107_levels.py
```
