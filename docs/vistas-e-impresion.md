# Vistas y formato de impresión

![Vista impresión con papel blanco, tema Noche y formato A5](images/vista-impresion.png)

## Markdown y Vista impresión

La barra permite alternar entre **Markdown**, para editar el código fuente, y **Vista impresión**, para trabajar con el documento formateado. Esta vista comienza con **Papel blanco** y texto oscuro, como en papel; **Fondo noche** permite leer y editar sobre azul oscuro. Ambas vistas representan el mismo documento. Cambiar de vista o de fondo sin editar no modifica el archivo ni lo marca como pendiente de guardar.

El selector **Día / Noche** cambia el tema de la interfaz, los controles de ventana, los diálogos y el editor Markdown. Noche conserva el azul original; Día usa fondo blanco. El fondo de Vista impresión se elige por separado: cambiar el tema del sistema no cambia esa elección. La impresión real siempre usa papel blanco, incluso al ver el documento con Fondo noche. El tema comienza en Noche y las preferencias se mantienen durante la sesión, sin modificar el archivo ni persistir al cerrar la aplicación.

La barra de formato de texto actúa sobre la vista visual. En Markdown se escribe la sintaxis directamente. Abrir, Guardar y Guardar como mantienen los atajos y las comprobaciones de cambios externos existentes.

El código debe pertenecer al [Markdown admitido](estilo-markdown.md) para convertirse a la vista visual e imprimirse. Si una conversión alteraría su estructura, se conserva el código y se muestra un aviso para corregirlo. No se ejecuta HTML escrito en el documento. La edición visual puede normalizar la sintaxis al modificar el contenido; alternar las vistas por sí solo conserva el original.

## Formato de página

**Formato de página** abre un diálogo con tamaños predefinidos y un formato personalizado. Las medidas se muestran en milímetros:

| Formato | Ancho × alto |
| --- | --- |
| Carta | 215,9 × 279,4 mm |
| Oficio | 216 × 330 mm |
| Legal | 215,9 × 355,6 mm |
| A4, inicial | 210 × 297 mm |
| A5 | 148 × 210 mm |
| Personalizado | 50–1000 mm por dimensión, hasta un decimal |

Oficio y Legal tienen medidas distintas. Para otro papel denominado «oficio» por una impresora, usar Personalizado e introducir sus medidas. Un formato personalizado puede ser horizontal usando un ancho mayor que el alto.

Aplicar confirma el formato; Cancelar o Escape descarta los cambios del diálogo. El formato se mantiene durante la sesión de la ventana, no se incorpora al Markdown ni se conserva después de cerrar la aplicación. Elegir papel no marca el documento como editado.

## Imprimir

**Imprimir** o **Ctrl+P** prepara el contenido visual actual y abre el diálogo de impresión del sistema. Puede iniciarse desde cualquiera de las vistas, sin guardar el archivo primero. Se espera la sincronización de las ediciones antes de imprimir.

La salida usa el tamaño elegido y márgenes de 15 mm, texto oscuro sobre fondo blanco y reglas propias para tablas, imágenes y código. Excluye barras, botones, avisos y el editor de código. El contenido largo fluye entre páginas; la vista de edición no es una previsualización paginada.

La aplicación solicita las medidas al controlador de impresión; la impresora y su controlador deben admitir el papel seleccionado. Revisar en el diálogo nativo cualquier ajuste del controlador. Cancelar la impresión conserva el contenido y permite continuar editando. La aplicación no guarda el documento como efecto de imprimir ni envía trabajos silenciosos.

La integración usa el puente acotado `documents.print`, validación de origen IPC y validación de formato en el proceso principal. Las unidades de Electron se documentan en [webContents.print](https://www.electronjs.org/docs/latest/api/web-contents#contentsprintoptions-callback).
