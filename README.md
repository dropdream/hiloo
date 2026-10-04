# hiloo

Editor local de Markdown para Windows con edición de código y vista de impresión con fondo blanco o nocturno, interfaz Día/Noche, barra compacta y controles nativos. Abre, edita y guarda archivos reales. Arranca con un documento vacío, sin ejemplos precargados. El manifiesto conserva la versión inicial 0.1.0; esta integración no publica una release.

## Uso y alcance actual

- Vistas **Markdown** y **Vista impresión** con fondo independiente **Papel blanco / Fondo noche**, tema de interfaz **Día / Noche**, **Formato de página** (Carta, Oficio, Legal, A4, A5 o personalizado) e **Imprimir** con Ctrl+P. Medidas, conservación del contenido y límites: [vistas e impresión](docs/vistas-e-impresion.md).
- Abrir, Guardar y Guardar como; párrafo, títulos 1–6, negrita, cursiva, tachado, listas, tareas, citas, tablas, imágenes, enlaces y deshacer/rehacer.
- Atajos: Ctrl+O, Ctrl+S, Ctrl+Mayús+S, Ctrl+B, Ctrl+I, Ctrl+Z y Ctrl+Y. Los formatos también tienen botones con estado activo y tooltips.
- Estado visible de cambios pendientes, operación en curso, guardado y errores. Abrir/cerrar pide guardar, descartar o cancelar si hay cambios.
- Guardar detecta modificaciones externas antes de reemplazar el archivo; Guardar como permite conservar la edición en otra ruta.
- Cada escritura confirma únicamente la revisión guardada. Las ediciones posteriores quedan pendientes; un error de sincronización o tamaño impide guardar silenciosamente una versión anterior.
- Archivos UTF-8 .md/.markdown de hasta 2 MiB. El original sin editar conserva sus bytes. Al editar se normaliza la sintaxis Markdown admitida; los formatos conocidos fuera del alcance se bloquean, y una conversión visual incompatible se muestra en solo lectura.

No hay autoguardado, recuperación tras cierre forzado, cuadernos, SQLite, asociaciones de archivos, importación de temas personalizados ni exportación directa HTML/PDF. Los enlaces se pueden insertar, editar y quitar; se muestran sin navegar. Las imágenes admiten URL HTTP(S) y rutas relativas dentro de la carpeta del Markdown guardado; los archivos locales no se copian ni se incrustan en el Markdown. El pegado importa texto plano. Los límites, formatos y normalización se detallan en [estilo Markdown](docs/estilo-markdown.md); las variables de interfaz, en [tema de interfaz](docs/tema-interfaz.md). [STACK.md](STACK.md) distingue implementación y proyecto futuro.

## Requisitos y comandos

Windows x64; Node.js 22.12+ dentro de la rama 22, o Node.js 24+; npm incluido. Entorno comprobado: Node 22.23.2 y npm 11.6.2. La instalación inicial necesita Internet para npm y Electron.

Desde la raíz, en PowerShell:

```powershell
npm ci
npm run dev
```

| Comando | Resultado |
| --- | --- |
| `npm run typecheck` | Comprueba proceso principal, preload, renderer, configuración y pruebas. |
| `npm run build` | Comprueba tipos y genera out/. |
| `npm start` | Compila y abre una vista previa local de producción. |
| `npm run pack:win` | Genera dist/win-unpacked/hiloo.exe sin instalar. |
| `npm run dist:win` | Genera también dist/hiloo-0.1.0-x64-setup.exe sin ejecutarlo ni publicarlo. |
| `npm test` | Prueba Electron local y empaquetado; ejecutar pack:win o dist:win antes. |
| `npm run test:packaged` | Prueba solamente el paquete existente. |

El ejecutable necesita toda su carpeta win-unpacked. El paquete local no está firmado, conserva el icono predeterminado de Electron y no tiene actualización automática. La creación de archivos nuevos usa copia exclusiva, sin depender de enlaces duros; se ha verificado en NTFS, sin certificar aquí FAT/exFAT ni unidades de red.

## Estructura y seguridad

| Ruta | Responsabilidad |
| --- | --- |
| src/main/index.ts | Ventana, navegación y ciclo de vida. |
| src/main/documents.ts | Diálogos, validación, guardado y protección de cambios. |
| src/preload/index.ts | Puente acotado para documentos y estados. |
| src/shared/ | Tipos, límites, formatos admitidos y colores nativos. |
| src/renderer/src/App.tsx | Estado de documento y composición. |
| src/renderer/src/editor.tsx | Milkdown/ProseMirror y comandos de edición. |
| src/renderer/src/Toolbar.tsx | Herramientas Radix accesibles. |
| src/renderer/src/*.css | Variables públicas y CSS Modules privados. |
| tests/ | Pruebas de archivos, editor y ventana en Electron real. |

El renderer mantiene contextIsolation, sandbox y Node deshabilitado. El proceso principal accede a documentos elegidos mediante diálogos y resuelve imágenes raster dentro de su carpeta, comprobando la ruta real, el tamaño y la firma del archivo; no se expone IO genérico. IPC valida emisor, marco principal, URL y argumentos. La CSP de producción admite scripts propios e imágenes HTTP(S)/data, bloquea objetos y marcos; la navegación y nuevas ventanas están denegadas. React Refresh admite scripts inline solo en desarrollo.

## Verificación

La integración de vistas e impresión pasó compilación y empaquetado Windows, una suite completa con **114 pruebas aprobadas y 6 omitidas** (fotografía privada opcional no disponible), y dos regresiones adicionales local/empaquetada después del ajuste final del botón Imprimir. Se comprobaron PDF A5 y personalizado horizontal, fondo blanco y un documento de 12 páginas con imágenes y tablas. El [informe de auditoría independiente](docs/auditoria-integracion-visualizador.md) detalla las correcciones y límites. No se enviaron trabajos a impresoras físicas.

La ampliación de tablas, imágenes, enlaces, tareas y tachado incluye pruebas de regresión y una [auditoría independiente de tablas e imágenes](docs/auditoria-tablas-imagenes.md). El informe registra los fallos encontrados, las correcciones verificadas y el alcance de las pruebas. Las tablas anchas mantienen columnas legibles con desplazamiento horizontal propio.

Las pruebas usan Electron real y archivos temporales reales: formato, historial, guardar/reabrir, cancelación, guardar al cerrar, conflictos externos, conservación de BOM/CRLF y rechazo de formatos. Comprueban además aislamiento, menú y controles de ventana por API. Los resultados de diálogos nativos se simulan desde el proceso principal para hacer reproducibles las decisiones; no se acreditan clics físicos en esos diálogos ni Windows Snap.

Resultado del 2026-10-03: compilación y empaquetado correctos; 30 pruebas aprobadas (15 locales y 15 empaquetadas). Incluyen actualizaciones durante el guardado, rechazo por tamaño, colisiones y errores de copia, atajos y restauración del foco tras elegir un bloque. Capturas a 1000 × 700 y 420 × 700 unidades lógicas, captura nativa, registros y reporte están en .verification/, excluido de Git y distribución. Informe de esta entrega: .verification/editor-report.md. La revisión React comprobó efectos/limpieza en StrictMode, callbacks, estado derivado, imports específicos, teclado y nombres accesibles; no es una auditoría completa con lector de pantalla.

## Auditoría de dependencias

Revisión del 2026-10-03: `npm audit --omit=dev` no reportó vulnerabilidades. Los ocho avisos altos de la auditoría completa derivan de un único aviso, [GHSA-ch52-4w7c-c8xp](https://github.com/advisories/GHSA-ch52-4w7c-c8xp), propagado por esta cadena de desarrollo:

```text
electron-builder 26.15.3 → app-builder-lib 26.15.3
→ @electron/get 3.1.0 → got 11.8.6
→ cacheable-request 7.0.4 → http-cache-semantics 4.2.0
```

`dmg-builder` y `electron-builder-squirrel-windows` reciben también el aviso por depender de `app-builder-lib`; no son vulnerabilidades independientes. El `@electron/get` 5.1.0 usado por el paquete Electron está separado de la copia 3.1.0 usada por electron-builder.

El fallo descrito afecta la reutilización de respuestas restringidas en una caché HTTP compartida, al aceptar una petición con `Cache-Control: max-stale`. En el código instalado, `got` tiene `cache: undefined` y solo utiliza `cacheable-request` cuando esa opción está activada. La configuración actual de hiloo y el descargador de electron-builder no la activan. La caché de archivos ZIP de `@electron/get` es un mecanismo distinto. Además, se comprobó que `http-cache-semantics` está ausente de `app.asar`. Por ello, **no se identificó una ruta de explotación de este aviso en la aplicación distribuida ni en el flujo de descarga configurado**. Es una evaluación de este uso concreto, no una corrección del paquete vulnerable ni una garantía sobre otras configuraciones.

Opciones de remediación evaluadas:

| Opción | Evaluación |
| --- | --- |
| Actualizar `http-cache-semantics` dentro de su rango compatible | npm sigue publicando 4.2.0 como última versión y el aviso no declara una corregida. La [propuesta de parche #58](https://github.com/kornelski/http-cache-semantics/pull/58) sigue abierta. Revisar una actualización cuando haya una versión corregida publicada. |
| Actualizar electron-builder | 26.15.3 es la versión estable más reciente consultada y aún declara `@electron/get: ^3.0.0`; 3.1.0 es la última de esa rama. No hay actualización compatible publicada que resuelva esta cadena. |
| Forzar `@electron/get` 5 con `overrides` | Elimina `got`, pero cambia a Fetch/RequestInit y modifica proxy, timeout y opciones de descarga. electron-builder actualmente pasa opciones de Got. Requiere adaptación y pruebas del empaquetador; no se fuerza. Véanse las [notas de migración](https://github.com/electron/get/releases/tag/v5.0.0). |
| Retroceder electron-builder a 26.5.0, como sugiere audit | Esa versión no declara esta dependencia, pero supone retroceder el empaquetador completo. No se ha validado como sustituto y no se adopta para reducir el contador de avisos. |

Se conserva la cadena de empaquetado probada, sin `audit fix --force`, overrides ni cambios dirigidos a eliminar el aviso. La entrega 2 añade las dependencias funcionales de edición; no cambia esa cadena. Al publicarse un parche compatible o una actualización del empaquetador que retire la cadena, actualizar el lockfile y repetir `npm ci`, ambas auditorías, empaquetado y pruebas local/empaquetada. Reevaluar antes si se activa una caché HTTP o cambian las opciones del descargador. Informes originales y revisión: `.verification/audit*.json`; análisis técnico: `.verification/audit-assessment.md`.

## Referencias

- [electron-vite: inicio y requisitos](https://electron-vite.org/guide/)
- [Electron: controles nativos sobre una barra oculta](https://www.electronjs.org/docs/latest/tutorial/custom-title-bar)
- [Playwright: automatización de Electron](https://playwright.dev/docs/api/class-electron)
