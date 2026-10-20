# Cuadernos y Cerebro

Un **Cuaderno** es una carpeta local. Su listado incluye archivos `.md` y `.markdown` de sus subcarpetas. Cada cuaderno tiene su propio listado y grafo; no se crean conexiones hacia notas fuera de su raíz.

La vista gráfica descrita aquí corresponde al cuaderno activo. El [índice global SQLite para IA](cerebro-sqlite.md) añade un catálogo independiente y relaciones entre cuadernos, carpetas y notas, consultables mediante la CLI. La [skill hiloo-notes](../skills/hiloo-notes/SKILL.md) empieza por consultar ese catálogo antes de buscar o guardar.

## Explorar y abrir notas

- El botón **Mostrar cuaderno**, a la izquierda del título, despliega el panel lateral. **Abrir cuaderno** permite elegir una carpeta.
- El panel muestra un árbol compacto de carpetas plegables y archivos. **Buscar notas** filtra por nombre y ruta relativa, sin distinguir mayúsculas ni tildes, y conserva las carpetas de las coincidencias. No busca en el contenido.
- Seleccionar una nota la abre en la pestaña actual, con las mismas validaciones y opciones Guardar, Descartar y Cancelar que la apertura habitual. Si esa nota ya está abierta en otra pestaña, se enfoca esa pestaña sin preguntar.
- El clic derecho sobre una nota (o Mayús+F10 con el foco en ella) abre un menú con **Abrir en nueva pestaña**, que conserva la pestaña actual y sus cambios.
- **Cambiar cuaderno** sustituye la carpeta activa. Tras confirmar los cambios pendientes de cada pestaña, una carpeta distinta cierra todas las pestañas y deja una vacía. Cancelar conserva las pestañas y el cuaderno actuales.
- Abrir un archivo independiente establece su carpeta como cuaderno si no pertenece al actual. Abrir una nota de una subcarpeta del cuaderno conserva la raíz.
- **Actualizar cuaderno** vuelve a leer el disco. Abrir o guardar una nota también actualiza el listado. No hay vigilancia automática de archivos.

En ventanas estrechas el panel se superpone al editor y se cierra al abrir una nota. Escape cierra el panel desde sus controles y devuelve el foco al botón del título. El panel no aparece en la impresión.

## Pestañas

Una barra delgada sobre la barra de herramientas muestra los documentos abiertos. Cada pestaña lleva el nombre del archivo y su ruta completa en el tooltip; un punto de acento indica cambios sin guardar (para lectores de pantalla, la descripción «Cambios sin guardar»).

- **Abren pestaña nueva:** **Abrir en nueva pestaña** del panel, **Nueva nota .md** y la creación de `indice.md`. Si la nota ya está abierta, se enfoca su pestaña. Si la pestaña actual es un documento vacío sin título y sin cambios, se reutiliza.
- **Reemplazan la pestaña actual:** el clic en el panel, **Abrir**, **Documentos recientes** y **Abrir nota** de Cerebro, con la confirmación habitual de cambios pendientes. Si el archivo ya está en otra pestaña, se enfoca esa.
- **Cambiar:** clic en la pestaña, Ctrl+Tab y Ctrl+Mayús+Tab. Con el foco en la barra, las flechas, Inicio y Fin recorren las pestañas e Intro o Espacio activan la elegida.
- **Cerrar:** botón ×, clic central, Ctrl+W o Supr con el foco en la pestaña. Si tiene cambios, hiloo la muestra y pregunta Guardar, Descartar o Cancelar, igual que al cambiar de documento; Cancelar la deja abierta y activa. Cerrar la última deja una pestaña vacía.
- Cada pestaña conserva su contenido sin guardar, su historial de deshacer y rehacer y su posición de desplazamiento. El modo Markdown o Vista impresión es común a todas.
- Con muchas pestañas, estas se comprimen hasta un ancho mínimo y luego la barra se desplaza en horizontal, sin cambiar de altura; la pestaña activa siempre queda visible.
- Cerrar la ventana pregunta por cada pestaña con cambios, una a una.

Las pestañas con archivo y la activa se guardan en `open-tabs.json`, dentro del perfil, y se restauran al reabrir hiloo. Los documentos sin título no se guardan. Si una nota ya no existe o no puede abrirse al restaurar, se omite sin aviso. Restaurar la pestaña activa también establece su carpeta como cuaderno, como al abrirla.

No hay vigilancia de archivos: un cambio externo o un cambio de nombre en una pestaña inactiva se detecta al guardarla, igual que en la pestaña activa, y la sobrescritura se bloquea con la opción de usar Guardar como.

## Menú del panel

La parte superior del panel lateral tiene dos entradas desplegables:

- **Documentos recientes** muestra los últimos diez archivos Markdown abiertos o guardados, con nombre, ruta y la marca **Actual**. Seleccionar uno lo abre sin el selector de Windows y ofrece Guardar, Descartar o Cancelar si hay cambios pendientes. Si el archivo ya no existe, se muestra un aviso y se conserva el documento actual. La lista persiste entre sesiones en `recent-documents.json` del perfil y su apertura exige un identificador registrado.
- **Configuraciones** reúne los ajustes de la aplicación. Su primera opción, **CSS de impresión**, se describe en [Vistas e impresión](vistas-e-impresion.md#css-de-impresión).

Escape desde una lista la pliega y devuelve el foco a su entrada del menú.

## Cuadernos recientes

**Cuadernos recientes**, debajo del encabezado del panel lateral, despliega los últimos diez cuadernos abiertos, del más reciente al más antiguo. Está disponible también al iniciar sin cuaderno. Cada entrada muestra el nombre y la ruta para distinguir carpetas que se llaman igual; **Actual** identifica el cuaderno activo.

Seleccionar una entrada vuelve a abrir esa carpeta sin usar el selector de Windows. Cambiar a otro cuaderno ofrece Guardar, Descartar o Cancelar si hay cambios pendientes. Cancelar o intentar abrir una carpeta que ya no está disponible conserva la edición y el cuaderno actuales. La lista se pliega al abrir correctamente; en ventanas estrechas el panel permanece abierto para elegir una nota. Escape desde la lista la pliega y devuelve el foco a **Cuadernos recientes**.

La lista se guarda localmente en `recent-workspaces.json`, dentro del directorio de datos de hiloo, y permanece al reiniciar la aplicación. Solo registra carpetas elegidas con **Abrir cuaderno**, **Cambiar cuaderno** o la propia lista; abrir o guardar documentos sueltos no añade sus carpetas. Volver a abrir un cuaderno lo coloca primero sin duplicarlo. No se abre automáticamente el último cuaderno al iniciar.

## Índice del cuaderno

Al elegir una carpeta con **Abrir cuaderno**, **Cambiar cuaderno** o **Cuadernos recientes**, hiloo pregunta **¿Qué uso le darás al cuaderno?** si su raíz no contiene ya `indice.md`, `índice.md` o `index.md` (sin distinguir mayúsculas). No pregunta al abrir un documento suelto, al actualizar ni al crear notas, ni cuando se cancela el selector o la confirmación de cambios pendientes.

Cada opción crea `indice.md` en la raíz y lo abre en una pestaña nueva:

- **IA**: título `Índice — <cuaderno>`, una sección **Instrucciones para IA** con reglas para agentes (leer primero el índice, una nota por tema, enlaces Markdown relativos para Cerebro, no borrar ni sobrescribir sin petición, mantener el mapa, escribir en español y consultar primero el catálogo de la [skill hiloo-notes](../skills/hiloo-notes/SKILL.md) cuando esté disponible) y un **Mapa de notas**.
- **Humano**: título con el nombre del cuaderno, **Introducción** y **Secciones** con apartados de ejemplo pendientes de escribir, y la lista de **Notas**.
- **Ambos**: las instrucciones para IA, que permiten completar los apartados pendientes a petición de la persona, seguidas de las secciones para la persona y el **Mapa de notas**.

El mapa enlaza las notas existentes con rutas relativas codificadas, por ejemplo `[clientes/Caso uno](clientes/Caso%20uno.md)`, hasta 200 notas; si hay más, una línea indica que la lista es parcial. Esos enlaces aparecen como conexiones en Cerebro. El contenido usa solo Markdown admitido por el editor visual.

**Ahora no** o Escape cierran el diálogo sin crear nada; volverá a ofrecerse la próxima vez que se elija ese cuaderno sin índice. El archivo se crea en modo exclusivo: nunca sustituye un índice existente, incluso si aparece mientras el diálogo está abierto; en ese caso se muestra un aviso y el diálogo permanece abierto. Como al crear notas, el listado debe estar completo y dentro de sus límites. El renderer solo envía el identificador del cuaderno activo y el uso elegido; ruta y contenido se calculan en el proceso principal. hiloo no actualiza el índice después: al crear, mover o renombrar notas, mantenlo a mano o pídeselo a tu IA.

## Crear carpetas y notas

**Nueva carpeta** y **Nueva nota .md** abren un formulario con nombre y **Carpeta de destino**. Elige la raíz del cuaderno o una subcarpeta; seleccionar una carpeta en el árbol la propone como destino. Las carpetas vacías también aparecen en el árbol.

Escribe solo el nombre, sin una ruta. Para notas se añade `.md` si falta. **Crear** nunca sustituye un archivo o una carpeta existente. Crear una carpeta conserva el documento actual; crear una nota la abre en una pestaña nueva, vacía y lista para escribir, sin tocar la pestaña actual ni sus cambios pendientes. **Cancelar** no crea nada.

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

La lectura reside en el proceso principal. El renderer recibe identificadores opacos y rutas relativas para las notas, y solo puede abrir notas del cuaderno activo. Los recientes incluyen la ruta de la carpeta para mostrarla, pero su apertura exige un identificador registrado; no acepta rutas arbitrarias desde el renderer. El grafo utiliza Cytoscape.js empaquetado localmente, sin servicio remoto. El [índice del cuaderno](#índice-del-cuaderno) solo se crea a petición al elegir un cuaderno y no se mantiene automáticamente. Esta entrega no mueve archivos y no implementa historial persistente de versiones de documentos.
