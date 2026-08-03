# Netlify build fix v119

Помилка:

`Couldn't find any versions for "@jsonjoy.com/fs-node-builtins" that matches "4.65.0"`

не пов'язана з React-кодом або депозитними звітами. Вона виникала на етапі встановлення залежностей через несумісний примусовий override `webpack-dev-server 5.2.4` і частково опубліковану серію пакетів `memfs/jsonjoy`.

Виправлення в `frontend/package.json`:

```json
"webpack-dev-server": "4.15.2",
"memfs": "4.64.0",
"@jsonjoy.com/fs-node-builtins": "4.64.0"
```

Після завантаження змін на GitHub потрібно виконати `Clear cache and deploy site`.
