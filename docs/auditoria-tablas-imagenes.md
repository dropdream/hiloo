# Auditoría independiente de tablas e imágenes

Fecha: 2026-10-03. Worktree: `tablas-y-funciones`.

El auditor no participó en la implementación. Su alcance de escritura se limita a `tests/table-image-audit.spec.ts`, `tests/image-visual-audit.spec.ts` y este informe. La verificación usa Electron real y operaciones de la interfaz; las comprobaciones de archivos comparan Markdown o árboles GFM normalizados para detectar pérdida semántica.

## Estado

Segunda ejecución independiente: **12 de 12 aprobadas** (43,9 s), después de las correcciones de selección de imagen y presentación de tablas anchas. Las capturas finales muestran cabeceras legibles y desplazamiento limitado a la tabla. Tab permite recorrer hasta la última columna y escribir en ella. No quedan fallos de datos o funcionamiento reproducidos por esta suite.

Primera ejecución: **8 aprobadas, 4 fallidas** (1,1 min), sobre build con corrección del título opcional pero sin las dos correcciones posteriores. TypeScript de Node/tests validado con `npx tsc --noEmit -p tsconfig.node.json`.

Después de revisar las capturas se afinó una aserción: además de navegar con Tab, desplazar horizontalmente con rueda hasta el extremo y comprobar que toda la celda final cabe dentro del scrollport. **Verificada también:** el coordinador ejecutó el caso actualizado con `--grep 'diez columnas' --output=.verification/local-scroll-final` y obtuvo 1 aprobado (5,7 s). El auditor inspeccionó su captura final: la última columna, incluido el borde derecho, es íntegramente visible; el scroll queda dentro de la tabla. No queda pendiente esta comprobación.

Comando: `npx playwright test tests/table-image-audit.spec.ts --project=local --output=.verification/independent-results`.

## Hallazgos reproducidos y correcciones verificadas

1. **P2 — Edición de imagen pierde selección después de guardar.** Insertar URL con alt y título vacíos, guardar, pulsar imagen y botón Imagen. El diálogo muestra `Insertar imagen`, no `Editar imagen`, impidiendo modificar/quitar la imagen desde sus herramientas. Caso: línea 178 del test, helper línea 43. No se observó pérdida del archivo; el Markdown `![](https://audit.test/one.png)` sí se guardó correctamente. Evidencia: `independent-results/table-image-audit-auditor--a5788-itar-y-quitar-repetidamente-local/error-context.md`.
2. **P2 — Imagen enlazada tampoco admite selección para editar.** Abrir `[![Foto](https://audit.test/photo.png)](https://example.com)`, pulsar imagen y herramienta Imagen: aparece `Insertar imagen`. Se reproduce también en celda. Los cambios estructurales y el guardado previo de la tabla conservaron correctamente la imagen y el enlace; falla al intentar editar la imagen. Casos: líneas 242 y 253. Evidencias: subdirectorios `4b50e` y `b48e6` de `independent-results`.
3. **P2 de usabilidad — Diez columnas a 420 px se convierten en texto vertical de una letra por línea.** No existe desbordamiento horizontal global, pero las celdas miden 35,5 px; cada cabecera `Columna0TextoLargo` ocupa más de una pantalla y la fila de datos queda fuera de vista. La aserción de 40 px es un indicador del auditor, mientras que la degradación se comprueba visualmente en `independent-results/table-image-audit-auditor--c88f3-x-sin-desbordamiento-global-local/wide-table-420.png`. No se observó pérdida de datos.

Los tres casos de selección compartían el manejo de selección de imagen; no se cuentan como tres causas raíz independientes. La selección explícita del NodeView resuelve los tres tests, incluidos edición y eliminación de imágenes enlazadas. El wrapper con scroll local y ancho mínimo por columna resuelve la presentación de tablas anchas. El auditor verificó estas correcciones independientemente y no modificó implementación.

Las rutas de errores de la primera ejecución son referencias históricas: Playwright regeneró `independent-results` durante la verificación final. La carpeta actual contiene las capturas después de las correcciones: `wide-table-420.png` y `wide-table-last-column-420.png`.

La evidencia más reciente del extremo derecho completo es `local-scroll-final/table-image-audit-auditor--c88f3-x-sin-desbordamiento-global-local/wide-table-last-column-420.png`.

## Resultados que aprobaron

Dimensiones y límites; cabecera única y pipes en código; marcas y enlace dentro de celdas; inserciones/eliminaciones antes/después en extremos; las tres alineaciones después de guardar/reabrir; eliminación final e historial; Tab/Shift+Tab/Enter; imagen rota y reparación/undo; cambio de base de ruta relativa codificada en Guardar como; protocolos y escape de directorio. Ninguna comprobación ejecutada detectó corrupción semántica de Markdown.

## Cobertura preparada

- Dimensiones mínimas/máximas e inválidas; cabecera única.
- Filas y columnas antes/después, extremos, eliminación final, deshacer/rehacer.
- Negrita, cursiva, tachado, enlaces, código y pipes escapados dentro de celdas.
- Alineación izquierda/centro/derecha en toda la columna y después de guardar/reabrir.
- Tab, Shift+Tab y Enter para salir de la tabla.
- Tabla de diez columnas a 420 px, captura y medición de desbordamiento.
- Imágenes sin alt ni título; creación, dos ediciones después de guardar, reapertura, eliminación y deshacer/rehacer.
- Imagen rota, fallback, reparación por URL y conservación del texto circundante.
- Ruta relativa con espacio codificado, cambio de base mediante Guardar como y conservación del origen Markdown.
- Imagen enlazada, imagen enlazada dentro de tabla y preservación del vínculo al editar la imagen.
- Protocolos peligrosos y rutas de escape simples/codificadas bloqueadas por el lector local.
- Fallos de conversión detectados mediante editor visible/editable y errores relevantes en consola, además del fixture de errores de página.

## Criterios y límites

La ausencia de desbordamiento global y el acceso a todas las celdas son criterios funcionales. El mínimo de 40 px por celda es un umbral de usabilidad elegido por el auditor, no un requisito textual del producto ni una norma de conformidad. Los hallazgos deben distinguir pérdida de datos, fallo funcional y este criterio visual.

Los orígenes HTTP(S) se simulan con imágenes deterministas; no se comprueba disponibilidad real de servicios externos. El lector `imageSource` devuelve una URL HTTP(S) validada y resuelve archivos relativos a datos: no es un fallo de seguridad que devuelva la URL remota.

La primera aprobación independiente cubrió las combinaciones descritas en Electron local y lectura de archivos PNG. Las secciones posteriores documentan la ampliación al ejecutable empaquetado, JPEG, dimensiones grandes y fotografía real. El informe no afirma cubrir todas las combinaciones de Markdown ni todos los sistemas operativos. Las pruebas de seguridad no constituyen una auditoría de penetración completa.

## Verificación final del coordinador

Además de la ejecución independiente anterior, el coordinador verificó la integración y la distribución final:

- `npm run typecheck` y `npm run build`: aprobados.
- `npx electron-builder --win --x64 --dir --publish never`: ejecutable generado en `dist/win-unpacked/hiloo.exe`.
- Suite local completa: 34 casos aprobados y una aserción de prueba incorrecta (`not.toMatch` recibía `null` cuando la imagen retiraba correctamente su `src`). Corregida a comprobar ausencia del atributo; el caso se repitió y aprobó. Los 35 casos locales quedan verificados.
- Prueba responsive refinada: aprobada de nuevo con rueda horizontal y límites del contenedor, revisada visualmente por el auditor.
- `npx playwright test --project=packaged --output=.verification/final-packaged`: **35/35 aprobados** (1,7 min), incluidos los 12 casos independientes y la aserción responsive refinada.

La verificación también corrigió el esquema de imágenes sin título: Markdown representa el título omitido como `null`, mientras que el esquema original sólo admitía texto. Las pruebas finales cubren apertura e inserción sin título ni texto alternativo.

Evidencias locales: `.verification/independent-results`, `.verification/final-local`, `.verification/local-image-final`, `.verification/local-scroll-final` y `.verification/final-packaged`. Estas carpetas quedan fuera de Git; las pruebas y este informe sí forman parte del worktree. No se publicaron paquetes ni se creó una release.

## Auditoría visual complementaria con imágenes grandes y fotografía real

**Aprobada sin bloqueos.** El auditor amplió la verificación con `tests/image-visual-audit.spec.ts`, sin modificar implementación. Esta sección incorpora las pruebas posteriores a la auditoría inicial con imágenes de un píxel.

Se ejecutaron **16 casos adicionales, todos aprobados**, con un trabajador y ambos proyectos Electron (`local` y `packaged`):

- **10/10** en 35,9 s: arte raster legible de 1200 × 675 en PNG/JPEG, retrato PNG de 600 × 900, carga local y HTTP interceptado, imagen grande dentro de tabla.
- **6/6** en 44,5 s: fotografía JPEG real suministrada por el usuario, de **3840 × 2160** y **2.404.005 bytes**, mediante archivo relativo, respuesta HTTP simulada e imagen dentro de celda; los tres escenarios se verificaron en ambos binarios.

Cada caso se comprobó en ventanas de **1000 y 420 px de ancho**. Las aserciones verifican visibilidad efectiva, fallback oculto, dimensiones renderizadas mayores que cero, anchura dentro del párrafo/celda, proporción original y ausencia de desbordamiento horizontal global. También prueban selección mediante clic, edición de alt/título, guardado, comparación semántica del Markdown, reapertura y nueva selección para editar. No se usa solamente `naturalWidth` como señal de éxito.

El auditor inspeccionó con `view_image` la fotografía original y capturas representativas del programa: foto local a ambos anchos, foto empaquetada ancha, HTTP empaquetado estrecho, foto en tabla ancha local y estrecha empaquetada; además, retrato PNG y ejemplos horizontales PNG/JPEG. La fotografía de la foca se muestra completa, sin deformación ni recorte. A 420 px se reduce al ancho del contenido y, dentro de la tabla, al ancho de su celda. El retrato conserva su orientación y su proporción; no se observan superposiciones con texto o herramientas.

Los casos de fotografía se habilitan mediante `HILOO_AUDIT_IMAGE`. El código versionado no contiene la ruta personal ni bytes de la fotografía. La copia de trabajo, documentos y capturas están exclusivamente en `.verification/image-visual-final`, ignorado por Git. Las solicitudes HTTP se resuelven mediante `page.route(...).fulfill(...)` con bytes locales, sin enviar la fotografía a un servidor. Cada caso comprueba el hash del original antes y después, y una comprobación final independiente confirmó el mismo SHA-256: `319C39704FE9C25DAFF83D127F1B37D636AA14BB67F0073DA55348AE3A8DB05C`.

Comandos ejecutados:

```powershell
npx playwright test tests/image-visual-audit.spec.ts --project=local --project=packaged --workers=1 --output=.verification/image-visual-final
# Con HILOO_AUDIT_IMAGE configurada en el entorno:
npx playwright test tests/image-visual-audit.spec.ts --project=local --project=packaged --workers=1 --grep 'foto real' --output=.verification/image-visual-final/real-photo
```

La primera ejecución contenía los cinco casos raster antes de añadir los tres casos opcionales de fotografía. El archivo final contiene ocho casos por proyecto: cinco deterministas y tres que se omiten cuando no se proporciona `HILOO_AUDIT_IMAGE`. El coordinador confirmó también `npm run typecheck` aprobado con este archivo final.

Capturas privadas de referencia, conservadas sólo localmente:

- `.verification/image-visual-final/real-photo/image-visual-audit-auditor-00eef-itable-sin-alterar-original-packaged/real-photo-local-1000.png`
- `.verification/image-visual-final/real-photo/image-visual-audit-auditor-d9752-itable-sin-alterar-original-packaged/real-photo-http-420.png`
- `.verification/image-visual-final/real-photo/image-visual-audit-auditor-73fd8-itable-sin-alterar-original-packaged/real-photo-table-420.png`

No se detectaron fallos nuevos ni fue necesario modificar CSS, selección o persistencia para superar esta ampliación. La comprobación visual de imágenes reales requerida para cerrar la auditoría queda satisfecha.
