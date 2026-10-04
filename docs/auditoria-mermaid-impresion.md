# Auditoría de Mermaid e impresión

Revisión del 2026-10-04 en el worktree `brain-bug`, Windows x64, Node 22.23.2 y Electron 44.5.1. La incorporación de PDF.js requiere Node 22.13 o posterior en la rama 22, o Node 24+.

## Cambios comprobados

El error de Cytoscape provenía de instalaciones desactualizadas: manifiesto y lockfile ya declaraban el paquete. Se sincronizaron las dependencias del worktree. Cada checkout, incluido `main`, necesita su propio `npm ci` después de actualizar dependencias.

Los bloques `mermaid` admiten flujos `flowchart`/`graph`. Su fuente sigue siendo código Markdown editable; el SVG se muestra como imagen, sin sustituir el contenido guardado. Se verificaron edición, deshacer, guardado/reapertura, varios diagramas y recuperación de errores. [Alcance y límites](estilo-markdown.md#flujos-mermaid).

Windows indicaba «Esta aplicación no admite la vista previa de impresión». Hiloo ahora genera un PDF en memoria y muestra páginas antes de abrir el diálogo nativo. Cancelar conserva la edición; confirmar valida documento, revisión y formato. [Comportamiento](vistas-e-impresion.md#imprimir).

## Correcciones durante la revisión

- Worker PDF local explícito para evitar URLs `blob` en producción.
- Bloqueo de edición conservado durante toda la vista previa.
- Rechazo de configuración Mermaid, metadatos extendidos y recursos externos, incluidas URLs CSS escapadas.
- Ancho del visor independiente de la aparición de scrollbars. La regresión de 420 px fallaba alternando dos anchos; tras corregirla, 120 cuadros mantuvieron un ancho único e Imprimir habilitado.

## Validación y evidencia

Compilación, tipos y empaquetado correctos. Los casos de Mermaid/impresión aprobaron en local; los 15 casos seleccionados de Mermaid, impresión y Cerebro aprobaron en empaquetado. Las regresiones de edición/navegación aprobaron 33/34 inicialmente: el caso de foco restante aprobó cuatro repeticiones, sin modificar ese comportamiento.

La auditoría independiente comprobó doce escenarios en Electron de producción y con Vite, además de estabilidad del ejecutable a 420 px. Se revisaron capturas y contenido visible del PDF. Evidencia local ignorada:

- `.verification/mermaid-audit-1OTCbU/`: informe y capturas finales.
- `.verification/development-nM7B10/`: registro Vite sin error de importación.
- `.verification/preview-stability-Hmrba8/`: estabilidad del ejecutable.
- `.verification/final-packaged-preview/`: regresiones finales del visor.

La impresión nativa se sustituyó en las pruebas para evitar trabajos físicos; no se certifican controladores ni impresoras. Windows puede seguir mostrando su limitación: la vista previa se realiza dentro de hiloo. `AGENTS.md` permanece intacto. El respaldo recuperable de dependencias parciales está en `.verification/node_modules-before-sync-20261004/`.
