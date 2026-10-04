# Cuadernos y Cerebro

Un **Cuaderno** es una carpeta local. Su listado incluye archivos `.md` y `.markdown` de sus subcarpetas. Cada cuaderno tiene su propio listado y grafo; no se crean conexiones hacia notas fuera de su raíz.

## Explorar y abrir notas

- El botón **Mostrar cuaderno**, a la izquierda del título, despliega el panel lateral. **Abrir cuaderno** permite elegir una carpeta.
- El panel muestra un árbol compacto de carpetas plegables y archivos. **Buscar notas** filtra por nombre y ruta relativa, sin distinguir mayúsculas ni tildes, y conserva las carpetas de las coincidencias. No busca en el contenido.
- Seleccionar una nota la abre en el editor central, con las mismas validaciones y opciones Guardar, Descartar y Cancelar que la apertura habitual.
- **Cambiar cuaderno** sustituye la carpeta activa. Tras confirmar los cambios pendientes, una carpeta distinta deja el editor vacío. Cancelar conserva la nota y el cuaderno actuales.
- Abrir un archivo independiente establece su carpeta como cuaderno si no pertenece al actual. Abrir una nota de una subcarpeta del cuaderno conserva la raíz.
- **Actualizar cuaderno** vuelve a leer el disco. Abrir o guardar una nota también actualiza el listado. No hay vigilancia automática de archivos ni catálogo persistente de cuadernos.

En ventanas estrechas el panel se superpone al editor y se cierra al abrir una nota. Escape cierra el panel desde sus controles y devuelve el foco al botón del título. El panel no aparece en la impresión.

## Crear carpetas y notas

**Nueva carpeta** y **Nueva nota .md** abren un formulario con nombre y **Carpeta de destino**. Elige la raíz del cuaderno o una subcarpeta; seleccionar una carpeta en el árbol la propone como destino. Las carpetas vacías también aparecen en el árbol.

Escribe solo el nombre, sin una ruta. Para notas se añade `.md` si falta. **Crear** nunca sustituye un archivo o una carpeta existente. Crear una carpeta conserva el documento actual; crear una nota confirma primero sus cambios pendientes y luego abre el archivo nuevo, vacío y listo para escribir. **Cancelar** no crea nada.

Si el listado está incompleto o ha alcanzado sus límites, la creación se bloquea con un aviso para evitar añadir elementos que no puedan aparecer en el árbol. Un nombre inválido o repetido mantiene el formulario abierto para corregirlo.

## Enlazar dos notas

En la vista visual, pulsa **Enlace** en la barra de herramientas y elige **Nota del cuaderno**. Busca por nombre o carpeta, selecciona el archivo y pulsa **Insertar**. Hiloo calcula la ruta automáticamente, incluso entre subcarpetas o con nombres que contienen espacios. Guarda la nota para actualizar las conexiones de Cerebro.

Si seleccionaste texto antes de pulsar Enlace, ese texto se conserva. Con el cursor vacío se usa el nombre de la nota elegida; puedes personalizarlo en **Texto**. Las carpetas que aparecen junto a los nombres permiten distinguir archivos que se llaman igual. La nota actual debe estar guardada en el cuaderno; las notas creadas con **Nueva nota .md** ya cumplen ese requisito.

Para un sitio web o una dirección escrita a mano, elige **Dirección web o manual**. Al editar un enlace existente se conserva su dirección hasta que la cambies o selecciones otra nota.

La selección de archivo guarda enlaces Markdown estándar. También puedes escribirlos directamente en la vista **Markdown**:

```markdown
[Agenda](agenda.md)
[Caso del cliente](clientes/caso.md)
[Volver al inicio](../inicio.md)
[Caso con espacios](clientes/Caso%20uno.md)
```

El primer ejemplo enlaza una nota de la misma carpeta; el segundo, una subcarpeta; el tercero sube un nivel. El destino debe existir dentro del mismo cuaderno para aparecer conectado en Cerebro. No se crea un archivo al escribir el enlace. En el editor visual, pulsar el enlace permite editarlo; para abrir la nota usa el árbol o su vista previa en Cerebro. `[[wikilinks]]` todavía no se interpreta como conexión.

## Cerebro

**Cerebro** muestra una nota por nodo y una flecha por enlace Markdown hacia otra nota del cuaderno, por ejemplo `[Agenda](reuniones/agenda.md#octubre)`. Se agrupan enlaces repetidos entre el mismo origen y destino. Las notas sin conexiones también aparecen.

El grafo usa el contenido **guardado en disco**. No interpreta relaciones por similitud, wikilinks ni texto libre. Omite imágenes, ejemplos de código, enlaces web, destinos inexistentes y conexiones al exterior. Las referencias Markdown se reconocen para construir el grafo, aunque el editor visual todavía no admite ese formato.

Los nombres se muestran pequeños y tenues. Al pasar el puntero, el nodo crece y aparece un botón de información. Pulsar un nodo o ese botón muestra una vista previa del contenido guardado, sin sustituir la nota actual ni descartar ediciones. **Abrir nota** pasa de la vista previa al editor y comprueba los cambios pendientes.

La vista previa muestra el texto Markdown, hasta 24.000 caracteres, y avisa si se trata de un extracto. Se puede cerrar con Escape desde sus controles.

Se puede acercar, alejar y ajustar el encuadre. **Notas y conexiones** ofrece navegación equivalente con teclado. Volver al documento conserva la edición sin guardar. La impresión sigue correspondiendo al documento, no al grafo ni a la vista previa.

## Límites y aislamiento

La exploración está limitada a 1.000 notas, 10.000 entradas, 16 niveles de subcarpetas y 32 MiB leídos por actualización; cada nota admite hasta 2 MiB y el grafo hasta 10.000 conexiones. Los avisos indican resultados parciales. Se omiten nombres que comienzan por punto, `node_modules` y enlaces simbólicos o junctions.

La lectura reside en el proceso principal. El renderer recibe identificadores opacos y rutas relativas, y solo puede abrir notas del cuaderno activo. El grafo utiliza Cytoscape.js empaquetado localmente, sin servicio remoto. Esta entrega no crea índices automáticos, no mueve archivos y no implementa historial persistente.
