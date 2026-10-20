# Cuaderno de demostración

`Proyecto de ejemplo` es un cuaderno inventado: notas sobre un huerto comunitario con enlaces, tablas, tareas y un diagrama Mermaid. Ábrelo en hiloo con **Abrir cuaderno** para probar la aplicación sin usar tus notas.

Las capturas de `docs/images/` salen de este cuaderno. Para repetirlas:

```powershell
npm run build
npx playwright test --config docs/demo/capturas/playwright.config.ts
```

El script copia el cuaderno a `C:\hiloo-demo\Proyecto de ejemplo`, para que no aparezcan rutas personales, y deja los PNG en `.verification/capturas/png`. Las imágenes publicadas se redujeron después a 1600 px de ancho y 256 colores.
