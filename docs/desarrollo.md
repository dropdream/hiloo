# Desarrollo de hiloo

Windows x64, Node.js `^22.13.0 || >=24.0.0` y npm. Ejecuta los comandos desde la raíz del repositorio. La instalación inicial descarga dependencias y Electron.

## Ejecutar y verificar

```powershell
npm ci
npm run dev
npm run build
npm test -- --project=local
```

`build` comprueba tipos y compila en `out/`. Para revisar solo tipos, usa `npm run typecheck`. `npm start` compila y abre la aplicación en modo producción.

Si actualizas la rama y cambia `package-lock.json`, detén el servidor y repite `npm ci`. Errores como `Failed to resolve import "cytoscape"` pueden indicar una instalación desactualizada. Cada worktree tiene sus propias dependencias.

## Empaquetar para Windows

```powershell
npm run pack:win
npm test
npm run dist:win
```

`pack:win` genera `dist/win-unpacked/hiloo.exe`; necesita toda su carpeta para funcionar. `npm test` ejecuta los proyectos local y empaquetado. `dist:win` genera el instalador NSIS, sin publicarlo. Los paquetes actuales no están firmados ni tienen actualización automática.

Si necesitas una copia alternativa, cambia `directories.output` al empaquetar y define `HILOO_TEST_PACKAGED_PATH` con la ruta de su ejecutable al probarla. Los resultados quedan en `.verification/`, fuera de Git.

## Código y documentación

Electron concentra archivos, diálogos e IPC en `src/main/`; `src/preload/` expone el puente acotado. React y el editor viven en `src/renderer/src/`; los contratos compartidos, en `src/shared/`. Se mantienen sandbox, aislamiento de contexto y Node deshabilitado en el renderer.

Consulta [AGENTS.md](../AGENTS.md) para estilo y pruebas, [STACK.md](../STACK.md) para alcance implementado y pendiente, y las auditorías de [Mermaid e impresión](auditoria-mermaid-impresion.md), [cuadernos](auditoria-cuadernos.md), [tablas e imágenes](auditoria-tablas-imagenes.md) e [integración del visualizador](auditoria-integracion-visualizador.md).

## Dependencias

La auditoría de producción del 2026-10-04 no reportó vulnerabilidades. La revisión del 2026-10-03 registró avisos de desarrollo asociados a `electron-builder → @electron/get → got → cacheable-request → http-cache-semantics`: [aviso original](https://github.com/advisories/GHSA-ch52-4w7c-c8xp). La caché HTTP afectada no estaba habilitada en el flujo revisado y el paquete no estaba presente en `app.asar`.

Esa evaluación no corrige la dependencia. Antes de actualizar el empaquetador, repetir auditorías, compilación, empaquetado y pruebas; evitar retrocesos u overrides sin validación. El registro original se conserva en `.verification/audit-assessment.md`.
