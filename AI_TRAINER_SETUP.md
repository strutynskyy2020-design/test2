# AI-тренажер: налаштування Netlify

1. Завантажте зміни в GitHub. Netlify автоматично запустить новий deploy.
2. У Netlify відкрийте **Project configuration → Environment variables**.
3. Створіть секретну змінну `OPENAI_API_KEY`.
4. У полі **Production** вставте ключ `sk-proj-...`.
5. Для Scope достатньо **Functions**. Якщо ваш тариф не дозволяє вибір scope, залиште доступні стандартні scope.
6. Необов'язково створіть `OPENAI_MODEL` зі значенням `gpt-4.1-mini`.
7. Запустіть **Deploys → Trigger deploy → Deploy site**.

Після входу на сайт у нижньому меню з'явиться вкладка **AI**. Ключ ніколи не передається у браузер: він читається лише Netlify Function.
