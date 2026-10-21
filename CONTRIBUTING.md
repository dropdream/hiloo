# Contribuir a hiloo

Gracias por tu interés. Los errores y las propuestas se reciben como [issues](https://github.com/dropdream/hiloo/issues/new/choose); los cambios, como pull requests contra `main`.

## Preparar el entorno

Necesitas Windows de 64 bits, Node.js `^22.13.0 || >=24.0.0` y npm.

```powershell
npm ci
npm run dev
```

Con pnpm: `pnpm install` y `pnpm dev`. No subas `pnpm-lock.yaml`; el lockfile es `package-lock.json`.

Antes de abrir una PR, comprueba que compila y que pasan las pruebas locales:

```powershell
npm run build
npm test -- --project=local
```

Si tocas el empaquetado, ejecuta también `npm run pack:win` y `npm test`. La [guía de desarrollo](docs/desarrollo.md) explica cada comando.

## Convenciones

- Estilo de código: TypeScript estricto, dos espacios, comillas simples y sin punto y coma. El resto está en [AGENTS.md](AGENTS.md).
- La interfaz está en español. Conserva los textos y nombres accesibles existentes.
- Añade pruebas en `tests/*.spec.ts` para el comportamiento que cambies, sobre todo en Markdown, guardado y teclado.
- No relajes el aislamiento de Electron: sandbox, aislamiento de contexto, Node deshabilitado en el renderer e IPC validado.
- Actualiza `docs/` cuando cambie el Markdown admitido o el comportamiento de la interfaz.

## Commits y pull requests

Usa mensajes en imperativo con prefijo:

- `feat: agrega pestañas de documentos`
- `fix: conserva el BOM al guardar`
- `docs: explica la CLI del Cerebro`

En la PR, explica qué cambia y por qué, enlaza el issue, indica los comandos que ejecutaste y su resultado, e incluye capturas si cambia la interfaz. No uses notas reales con datos personales en las capturas: el cuaderno de [`docs/demo`](docs/demo) sirve para eso.
