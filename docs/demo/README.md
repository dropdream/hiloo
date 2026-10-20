# Cuaderno de demostración

`Proyecto de ejemplo` es un cuaderno inventado: notas sobre un huerto comunitario con enlaces, tablas, tareas y un diagrama Mermaid. Ábrelo en hiloo con **Abrir cuaderno** para probar la aplicación sin usar tus notas.

Las capturas de `docs/images/` salen de este cuaderno. Para repetirlas:

```powershell
npm run build
npx playwright test --config docs/demo/capturas/playwright.config.ts
python docs/demo/capturas/reducir.py .verification/capturas/png docs/images
```

El script crea una carpeta nueva con nombre único, como `C:\hiloo-demo-a1b2c3`, y copia ahí el cuaderno para que no aparezcan rutas personales. Nunca usa una carpeta que ya exista y, al terminar, borra solo la que creó. Deja los PNG originales en `.verification/capturas/png`; `reducir.py` los pasa a 1600 px y 256 colores y necesita Pillow (`pip install pillow`). `npm test` no ejecuta este script, porque solo busca pruebas en `tests/`.
