# Netlify diamond-frame build fix v141

Build падав не через застарілі package warnings. Єдиною фатальною помилкою було:

```text
Module not found: Can't resolve '/card-frames/diamond-employee-card-v137.png'
```

Файл існував у `frontend/public/card-frames`, але абсолютний URL був записаний у `frontend/src/index.css`. У production pipeline css-loader спробував резолвити цей URL як імпорт.

Виправлено перенесенням копії ресурсу до `frontend/src/assets/card-frames` і використанням відносного URL. Public-копію залишено для сумісності зі старим Service Worker та вже опублікованими сторінками.
