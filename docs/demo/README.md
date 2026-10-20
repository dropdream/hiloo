# Cuaderno de demostración

`Proyecto de ejemplo` es un cuaderno inventado: notas sobre un huerto comunitario con enlaces, tablas, tareas y un diagrama Mermaid. Ábrelo en hiloo con **Abrir cuaderno** para probar la aplicación sin usar tus notas.

Las capturas de `docs/images/` salen de este cuaderno. Para repetirlas:

```powershell
npm run build
npx playwright test --config docs/demo/capturas/playwright.config.ts
python docs/demo/capturas/reducir.py .verification/capturas/png docs/images
```

El script copia el cuaderno a `C:\hiloo-demo\Proyecto de ejemplo`, para que no aparezcan rutas personales, y no borra esa copia al terminar. Deja los PNG originales en `.verification/capturas/png`; `reducir.py` los pasa a 1600 px y 256 colores y necesita Pillow (`pip install pillow`). `npm test` no ejecuta este script, porque solo busca pruebas en `tests/`.
