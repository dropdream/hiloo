# Auditoría de integración del visualizador

Fecha: 2026-10-03. Dictamen independiente: **APROBADO**, sin hallazgos bloqueantes abiertos en el estado revisado.

## Objetivo y alcance

Se revisaron los cambios de código, documentación y pruebas que incorporan edición Markdown, Vista impresión editable, formatos de papel, impresión nativa, temas Día/Noche y fondo independiente Papel blanco/Fondo noche. La revisión incluyó preservación del documento y su historial, guardado, aislamiento IPC, controles accesibles, estilos y salida impresa. El auditor no modificó código de producto ni realizó commits, publicaciones o integraciones.

## Hallazgos corregidos

- El editor Markdown se mantiene montado por documento para conservar deshacer al alternar vistas.
- Una frontera de historial separa la conversión desde Markdown de la primera edición visual. Antes, deshacer podía eliminar también un párrafo ya guardado desde Markdown; la reproducción independiente confirmó que ahora se conserva y el estado vuelve a Guardado.
- El botón Imprimir permite recuperar desde Markdown un documento cuya conversión inicial estaba bloqueada, manteniendo la validación del contenido y sin modificar el archivo original.
- La conversión compara contenido serializado para que los IDs internos de encabezados generados por Milkdown no rechacen conversiones válidas. Se conservan las comprobaciones estructurales y de tamaño.

## Validación

| Comprobación | Resultado |
| --- | --- |
| Empaquetado Windows, typecheck y build | Correctos |
| Suite completa local y empaquetada | 114 aprobadas, 6 omitidas; 8,1 minutos |
| Regresión final del botón Imprimir tras reconstruir el paquete | 2 aprobadas: local y empaquetada; 13,4 segundos |
| Comprobación independiente de BOM/CRLF, deshacer/rehacer y colores nativos | Correcta |
| Revisión de whitespace del diff | Sin errores |

Las seis omisiones corresponden a pruebas opcionales que requieren una imagen privada. Después de la suite completa, solo cambió la condición que habilita Imprimir desde Markdown; sobre ese estado se reconstruyó el paquete y se verificó la regresión específica en ambos proyectos.

La revisión independiente de un PDF A5 confirmó 12 páginas, 75 párrafos completos, tabla de diez columnas, imagen vertical completa y ausencia de controles impresos. Se comprobaron esquinas blancas en todas las páginas y márgenes de aproximadamente 15 mm. Las dimensiones medidas fueron 148,17 × 209,89 mm por redondeo de Chromium. También se inspeccionaron capturas de temas independientes y ventana estrecha.

Los puentes nuevos conservan el aislamiento del renderer y validan origen, tema y formato en main. La impresión espera la edición actual, usa el formato elegido y mantiene blanco el papel, incluso con Fondo noche. Sus unidades siguen el contrato de [Electron](https://www.electronjs.org/docs/latest/api/web-contents#contentsprintoptions-callback).

## Límites

- La impresión se verificó con simulación del diálogo y generación real de PDF; no se enviaron trabajos a impresoras físicas. El controlador debe admitir el papel elegido.
- Vista impresión es editable, pero no una previsualización paginada. Formato y temas se conservan solo durante la sesión.
- El control conservador heredado puede bloquear la conversión de texto con saltos suaves CRLF cuando difiere de la serialización LF. El original permanece intacto y puede corregirse desde Markdown.
- La revisión de accesibilidad no constituye una certificación WCAG ni una prueba con lector de pantalla.
