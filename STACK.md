# hiloo — Definición inicial del producto y stack

Fecha: 2026-10-04. Estado: entregas 1 y 2, navegación básica de cuadernos, recientes persistentes, Cerebro e índice global SQLite para IA implementados localmente; índices Markdown automáticos, historial persistente y exportación pendientes.

## Identidad y objetivo

**hiloo** se pronuncia «hilo». Su mascota se llama **loo**; su diseño está pendiente.

Lector y editor visual de Markdown para Windows, sencillo de usar como un bloc de notas con barra de formato. El usuario escribe sobre texto estilizado y la aplicación guarda documentos `.md` legibles desde otras herramientas. Los documentos pueden organizarse en cuadernos y relacionarse entre sí.

La aplicación no integra un modelo de IA. El skill independiente [hiloo-notes](skills/hiloo-notes/SKILL.md) permite a herramientas de IA externas descubrir el catálogo, consultar y guardar notas con las capacidades actuales.

## Stack de partida

| Capa | Tecnología | Responsabilidad |
| --- | --- | --- |
| Escritorio | Electron | Ventanas, menús, integración con Windows e impresión. |
| Lenguaje | TypeScript | Interfaz y lógica local de la aplicación. |
| Interfaz | React | Navegación, barra de herramientas, búsqueda y ajustes. |
| Estilos de interfaz | CSS Modules + variables CSS | Estilos propios por componente y temas configurables mediante variables públicas. |
| Controles interactivos | Radix Primitives | Base sin apariencia impuesta para menús, diálogos, tooltips y otros controles; integración de teclado, foco y accesibilidad. |
| Desarrollo y compilación | electron-vite | Entorno de desarrollo y compilación de Electron con React y TypeScript. |
| Edición visual | Milkdown CommonMark, basado en ProseMirror | Edición visual y lectura/escritura de formatos admitidos; integración directa sin Crepe. |
| Documentos | Sistema de archivos: carpetas y `.md` | Almacenamiento principal, accesible por humanos y herramientas externas. |
| Índice global para IA | SQLite integrado en Electron + FTS5 | Catálogo, fragmentos, búsqueda y enlaces manuales; CLI y puente restringido. |
| Historial persistente | SQLite | Base propuesta para versiones anteriores y registro de operaciones; no reemplaza los documentos Markdown. |
| Preferencias | JSON local | Ajustes de la aplicación y últimos cuadernos. |
| Exportación | HTML + CSS personalizado | Documentos compartibles, estilos corporativos y preparación para impresión. |
| Distribución | electron-builder con instalador NSIS | Instalador de Windows y registro de asociaciones de archivos. |

La entrega 1 usa Electron 44.5.1, electron-vite 5.0.0, Vite 7.3.6, React/React DOM 19.3.0, TypeScript 5.9.3, electron-builder 26.15.3 y Playwright 1.63.0. Las versiones exactas están fijadas en `package.json` y `package-lock.json`. Vite 7 mantiene compatibilidad con electron-vite 5 y el plugin React 5. La entrega 2 incorpora Milkdown 7.22.2 y Radix Toolbar 1.1.19, Select 2.3.7 y Tooltip 1.2.16. SQLite se utiliza para el índice global mediante node:sqlite del runtime de Electron, sin controlador externo; el historial de versiones sigue pendiente. El manifiesto y el lockfile fijan todas las versiones.

## Tecnología visual confirmada

**Decisión confirmada: React + CSS Modules + Radix Primitives + variables CSS para temas.** CSS Modules organizará los estilos propios de los componentes; Radix aportará comportamiento interactivo y las variables CSS expondrán las opciones de personalización.

La entrega 2 concreta una superficie azul marino #183550, barra #203F5D, tipografía Segoe UI, iconos SVG y distribución adaptable. El diseño de loo sigue pendiente.

Habrá dos ámbitos de personalización independientes: el tema de la aplicación y la presentación de los documentos Markdown. El CSS del documento tendrá alcance delimitado para no alterar barras, menús ni otros controles de hiloo. La exportación HTML incluirá el tema del documento y sus reglas de impresión.

## Documentación pública requerida

La base implementada de los dos contratos CSS está en [tema de interfaz](docs/tema-interfaz.md) y [estilo Markdown](docs/estilo-markdown.md), con variables, selectores, ejemplos y límites actuales. El siguiente alcance ampliado de personalización permanece como planificación; la versión inicial del skill externo ya está disponible. Se documentarán al detalle los siguientes tres contratos. Esta sección define su alcance; los nombres finales de variables, selectores, archivos y comandos se concretarán y verificarán al implementarlos. Los ejemplos se mantendrán sincronizados con la aplicación.

### 1. CSS para temas del sistema

«Sistema» significa la interfaz de hiloo: ventanas, paneles, navegación, barras, menús y diálogos.

- Catálogo de variables CSS públicas: finalidad, tipo de valor, valor predeterminado, alcance y ejemplos para cada variable.
- Colores de superficies, texto, bordes, acentos y estados; tipografía, espaciados, radios y otros valores que se decida exponer.
- Temas claros y oscuros, preferencia del sistema operativo, precedencia entre configuraciones y comportamiento cuando falta una variable.
- Estados de interacción: foco visible, selección, hover, controles deshabilitados y errores; criterios de contraste y navegación con teclado.
- Estructura de un tema, instalación, activación, restauración del tema predeterminado y ejemplos completos para autores.
- Reglas de compatibilidad y versionado. Las clases generadas por CSS Modules serán internas; los temas externos usarán variables y puntos de personalización públicos estables.
- Aplicación coherente del tema a controles renderizados en portales, como menús y diálogos de Radix.

### 2. CSS para visualización de Markdown

Este contrato cubrirá la presentación del contenido en lectura, edición visual, HTML exportado e impresión, indicando las diferencias admitidas entre esos contextos.

- Contenedor y selectores públicos estables para títulos, párrafos, énfasis, enlaces, listas, citas, código, tablas e imágenes, según los formatos finalmente admitidos.
- Variables para tipografía del documento, ancho de lectura, interlineado, separación de bloques, colores y demás opciones expuestas.
- Alcance y precedencia de estilos; relación con el tema claro u oscuro de la aplicación y aislamiento respecto de sus controles.
- Compatibilidad con el editor: cursor, selección y herramientas deben seguir siendo utilizables al cambiar el tema del contenido.
- Reglas de exportación e impresión: CSS incluido en el HTML, recursos y fuentes, márgenes, saltos de página y estilos específicos de impresión.
- Ejemplos completos: tema de lectura, tema corporativo y documento de prueba con todos los elementos soportados.
- Importación, selección, validación, límites admitidos y distribución de temas comunitarios; compatibilidad entre versiones de hiloo.

El Markdown conservará la estructura y el contenido. La presentación se definirá en el tema para que cambiar de estilo no requiera reescribir las notas.

### 3. Skill para herramientas de IA

Se entrega [hiloo-notes](skills/hiloo-notes/SKILL.md), con referencias de consulta y guardado, para trabajar desde herramientas externas sin un modelo integrado en hiloo. Empieza consultando el catálogo SQLite de cuadernos registrados. El siguiente listado conserva el alcance ampliado del producto; los índices Markdown automáticos, el mantenimiento automático al mover notas y el historial de versiones siguen pendientes.

- Propósito, cuándo usarlo, instalación o activación y limitaciones de las herramientas compatibles.
- Cómo localizar la raíz del cuaderno, leer su documento de orientación y recorrer el índice antes de modificar notas.
- Estructura de carpetas, archivos reservados, formatos Markdown admitidos y reglas para nombres, rutas y enlaces relativos.
- Procedimientos para buscar, leer, crear, editar, relacionar, mover y renombrar notas, manteniendo el índice y los enlaces.
- Tratamiento de recursos adjuntos, secciones generadas automáticamente y contenido escrito por el usuario.
- Coordinación con hiloo y otras herramientas: detectar cambios concurrentes y evitar sobrescrituras silenciosas; explicar qué versiones puede recuperar realmente la aplicación.
- Límites de modificación: operar sobre documentos y mecanismos públicos; no editar directamente la base privada de historial.
- Ejemplos completos y verificaciones posteriores: enlaces existentes, índice coherente y contenido preservado.

El skill documenta el comportamiento implementado y distingue las operaciones manuales de las funcionalidades todavía pendientes.

## Organización de cuadernos

La navegación básica ya permite abrir una carpeta como cuaderno, crear subcarpetas y notas `.md`, buscar por nombre/ruta en sus subcarpetas y abrir notas desde el sidebar o Cerebro. El árbol incluye carpetas vacías; la creación permite elegir el destino sin sustituir archivos existentes. Cambiar cuaderno mantiene separados los listados y grafos y confirma cambios pendientes. Véase [cuadernos y Cerebro](docs/cuadernos-y-cerebro.md). El índice, la orientación para IA y el resto de las operaciones de organización descritas a continuación siguen siendo planificación.

- Un cuaderno corresponde a una carpeta; sus secciones son subcarpetas.
- Cada nota es un archivo `.md`, con enlaces relativos a otras notas y recursos.
- Un índice Markdown en la raíz relaciona los documentos del cuaderno.
- Un documento de orientación explica a las herramientas de IA cómo navegar y mantener esa estructura.
- La aplicación actualizará el índice y los enlaces afectados por movimientos o cambios de nombre realizados desde hiloo.
- También se podrán abrir y editar documentos sueltos, sin crear un cuaderno.

Ejemplo orientativo; los nombres reservados se definirán antes de implementar:

```text
Mi cuaderno/
├── INDICE.md
├── LEEME-IA.md
├── Proyectos/
│   └── Ideas.md
├── Reuniones/
│   └── Reunion inicial.md
└── Recursos/
    └── diagrama.png
```

El skill explicará el punto de entrada, los enlaces y las reglas de modificación. La mera presencia de un archivo no garantiza que cualquier IA lo lea automáticamente.

## Edición, guardado y recuperación

La barra permitirá elegir párrafo o título y aplicar negrita, cursiva, listas, citas y enlaces a otros documentos. El subrayado está solicitado, pero su representación sigue pendiente: Markdown estándar no tiene una sintaxis propia y habría que evaluar HTML como `<u>` o una extensión compatible.

Se distinguen tres mecanismos:

1. **Deshacer y rehacer:** historial de Milkdown/ProseMirror durante la edición.
2. **Versiones anteriores:** copias persistentes en SQLite, inicialmente completas, con fecha, identidad, ruta y contenido. Restaurar una versión conservará antes el estado actual.
3. **Operaciones sobre archivos:** papelera y registro para recuperar eliminaciones o revertir movimientos cuando sea posible.

El autoguardado y el historial deberán coordinarse sin sobrescribir cambios externos silenciosamente. Se detectarán modificaciones realizadas por otros editores o herramientas de IA. No se promete recuperar estados intermedios que hiloo nunca haya registrado.

Quedan pendientes frecuencia y retención de versiones, ubicación de la base, identificación de documentos y tratamiento de conflictos. Las transacciones de SQLite no incluyen automáticamente las escrituras de archivos `.md`.

## Arquitectura local e integración con Windows

La interfaz React se ejecuta en el renderer, aislado y sin acceso directo a Node. Desde la entrega 2, el proceso principal gestiona diálogos y archivos mediante preload/contextBridge e IPC acotados y validados. Milkdown se ejecuta en el renderer con sandbox. El índice global SQLite y su CLI están implementados; el historial de versiones y la integración adicional con el sistema siguen pendientes.

El instalador registrará compatibilidad con `.md` y `.markdown` para aparecer en «Abrir con». El usuario decidirá si hiloo será la aplicación predeterminada. Se recibirán rutas tanto al arrancar como cuando una instancia ya esté abierta.

La exportación producirá HTML con el CSS seleccionado. La integración del visualizador ya permite alternar código Markdown y edición visual, elegir formato de página e imprimir mediante Electron con CSS de impresión. La exportación directa HTML/PDF y una vista previa paginada siguen pendientes. Véase [vistas e impresión](docs/vistas-e-impresion.md).

## Entregas iniciales

### Entrega 1: ventana base — implementada localmente

Ventana vacía con un color sólido, sin contenido ni elementos decorativos. «Sin fondo» significa sin imágenes ni decoración, no una ventana transparente. El color se define mediante una variable CSS; su valor visual definitivo sigue pendiente.

Se muestran los controles nativos de minimizar, maximizar/restaurar y cerrar mediante `titleBarStyle: hidden` y `titleBarOverlay`. La región superior vacía usa `-webkit-app-region: drag`; la ventana permite redimensionar, empieza en 1000 × 700 unidades lógicas y tiene un mínimo de 400 × 300. No hay texto visible, menú, editor ni decoración.

La variable CSS implementada es `--hiloo-window-background`, inicializada con `#f2f2f2` desde `src/shared/window.ts`. La misma fuente configura el fondo inicial de `BrowserWindow` y el overlay. Cambiar únicamente CSS en ejecución no sincroniza los controles nativos. No hay todavía importación de temas ni contrato completo de personalización. El procedimiento real está en `README.md`.

`README.md` en español, scripts npm, lockfile y configuración Windows x64/NSIS están implementados. La consolidación de la entrega 2 incorpora el código y la documentación a main del repositorio privado [dropdream/hiloo](https://github.com/dropdream/hiloo). No se ha publicado una release ni instalado la aplicación en el sistema.

Verificación local del 2026-10-03, en Windows x64 10.0.26300:

- `npm ci` completado desde el lockfile; comprobación de tipos y compilación correctas mediante `npm run pack:win` y `npm run dist:win`.
- Arranque real de `electron-vite dev` y conexión Playwright/CDP: renderer servido en `http://127.0.0.1:5173/`, React montado, contenido vacío, fondo `#f2f2f2`, sin acceso a Node ni errores JavaScript observados. Captura: `.verification/development.png`; resultados: `.verification/development.json`.
- `npm test`: dos pruebas aprobadas sobre Electron local y `dist/win-unpacked/hiloo.exe`. Verificados por API: minimizar/restaurar, maximizar/restaurar, posición/tamaño, límites mínimos y cierre, además de aislamiento, sandbox y ausencia de menú. La captura del renderer se comprobó píxel a píxel como una superficie uniforme. Registro: `.verification/tests.log`.
- Captura real de la ventana empaquetada mediante `desktopCapturer`: `.verification/packaged-native-window.png`. Se observaron únicamente los tres controles nativos y el fondo neutro uniforme. Tamaño inicial medido: 1000 × 700 unidades lógicas.
- Instalador local generado: `dist/hiloo-0.1.0-x64-setup.exe`; firma comprobada como `NotSigned`. No se ejecutó el instalador. El archivo `app.asar` contiene el código compilado y excluye pruebas, documentación y evidencias; conserva la política de scripts de producción. Registro: `.verification/package-check.json`.
- Límite de verificación: el controlador Computer Use no pudo conectarse a su canal nativo después de reintentos y reinicio. No se acreditan clics físicos en botones, arrastre, redimensionado con ratón ni Windows Snap. Las operaciones de ventana anteriores fueron comprobadas por API. Tampoco se realizó una medición temporal del primer fotograma para certificar ausencia absoluta de destellos.
- `npm audit --omit=dev`: cero vulnerabilidades reportadas. Los ocho avisos altos de la auditoría completa se propagan desde un único aviso en `http-cache-semantics`. Esa dependencia no está en el paquete distribuido y el descargador configurado no activa la caché HTTP de Got requerida por el fallo; no se identificó una ruta de explotación en este uso. No hay parche compatible publicado. Se conserva el lockfile sin overrides ni downgrade del empaquetador. `README.md`, sección «Auditoría de dependencias», documenta evidencia, alternativas y condiciones para actualizar; el análisis no equivale a corregir la dependencia vulnerable.

Las evidencias locales están en `.verification/`, ignorado por Git y excluido de distribución. La descarga inicial del binario de Electron superó una vez el límite de la prueba; `npm test` ahora ejecuta `install-electron` como preparación antes de iniciar Playwright. No quedaron servidores de desarrollo abiertos tras la verificación.

### Entrega 2: edición básica de Markdown — implementada localmente

Entrega 2 (versión inicial 0.1.0 conservada, sin release): abrir, editar visualmente, guardar, guardar como y reabrir desde disco; párrafos, títulos 1–6, negrita, cursiva, listas y citas. Historial de texto/formato durante la sesión. Barra Radix, nombres y tooltips accesibles, estados activos, atajos y fondo azul marino. Archivo inicial vacío y botones Windows nativos.

IO acotado en el proceso principal, guardado mediante temporal y comprobación de cambios externos; confirmación de cambios pendientes al abrir/cerrar. Cancelar conserva la edición. Se preservan los bytes de documentos sin editar; editar normaliza Markdown y conserva BOM/estilo CRLF. Formatos fuera del alcance se rechazan y la comparación semántica de conversión bloquea casos incompatibles. Límites y carrera residual entre comparación/reemplazo: [documentación Markdown](docs/estilo-markdown.md).

Las pruebas Electron cubren edición, historial, persistencia, cancelaciones, conflictos externos, revisiones durante el guardado, orden IPC, rechazo por tamaño, copia exclusiva, atajos, formatos, enlaces sin navegación, aislamiento y ventana por API. Capturas revisadas a 1000 × 700 y 420 × 700 y una captura nativa. Evidencia exacta y resultado final: .verification/editor-report.md. Los diálogos se controlan mediante respuestas de prueba; no se certifican interacciones físicas nativas. El instalador actualizado es dist/hiloo-0.1.0-x64-setup.exe, generado sin instalar ni publicar.

No incluye inserción de enlaces mediante diálogo, imágenes, tablas, subrayado, cuadernos, autoguardado ni historial persistente. No se repite la investigación del aviso de electron-builder de la entrega 1: se conserva su evaluación y no se fuerza ninguna remediación.

### Validaciones posteriores

Tras validar el editor, ampliar a cuadernos, mantenimiento de índices y enlaces, cambios externos, versiones persistentes y exportación e impresión con CSS personalizado. Medir arranque y memoria con documentos representativos conforme crezca la aplicación.

## Cerebro — navegación básica implementada

Vista de grafo local por cuaderno mediante [Cytoscape.js](https://js.cytoscape.org/), empaquetado con la aplicación. Cada `.md` o `.markdown` es un nodo y sus enlaces Markdown relativos hacia otras notas del mismo cuaderno son conexiones dirigidas. El grafo se reconstruye desde las versiones guardadas, sin IA ni servicio online.

El diálogo **Enlace** permite buscar y seleccionar una nota del cuaderno sin escribir rutas. La dirección relativa se calcula y valida en el proceso principal; el archivo conserva un enlace Markdown estándar. La nota de origen debe estar guardada. Los enlaces web y la edición manual siguen disponibles.

Incluye etiquetas discretas, información al pasar el puntero, vista previa por clic y apertura explícita de la nota, zoom, ajuste y lista de notas/conexiones accesible con teclado; la búsqueda por nombre/ruta está en el árbol del sidebar. Los destinos inexistentes o exteriores se omiten, y Actualizar vuelve a explorar el disco. Los límites y exclusiones están en [cuadernos y Cerebro](docs/cuadernos-y-cerebro.md).

Siguen pendientes los filtros por sección, la vista local de vecinos, el mantenimiento de enlaces al mover/renombrar archivos y la exclusión de relaciones de un futuro índice automático. La lista de los últimos diez cuadernos se conserva en JSON local; no hay vigilancia automática. La visualización de diagramas dentro de una nota es otro alcance: [investigación de Mermaid, D2 y PlantUML](docs/investigacion-diagramas.md).

## Referencias técnicas

- [Electron](https://www.electronjs.org/docs/latest/)
- [electron-vite](https://electron-vite.org/guide/)
- [CSS Modules en Vite](https://vite.dev/guide/features.html#css-modules)
- [Radix Primitives](https://www.radix-ui.com/primitives/docs/overview/introduction)
- [Milkdown Crepe](https://milkdown.dev/docs/guide/using-crepe)
- [ProseMirror](https://prosemirror.net/docs/guide/)
- [SQLite](https://www.sqlite.org/lang_transaction.html)
- [electron-builder / NSIS](https://www.electron.build/docs/nsis/)

## Índice global para IA — implementación inicial

El catálogo SQLite conserva cuadernos registrados, nodos de carpetas/notas y relaciones manuales entre ellos. Los fragmentos, FTS5 y enlaces Markdown se actualizan desde disco. La CLI permite descubrir cuadernos primero, buscar con presupuestos de caracteres y leer solo fragmentos verificados. La base contiene información durable: reindexar no equivale a borrarla. La vista gráfica actual sigue limitada al cuaderno activo. Detalles, límites y comandos: [Cerebro SQLite](docs/cerebro-sqlite.md). El skill externo [hiloo-notes](skills/hiloo-notes/SKILL.md) describe consulta y guardado con las capacidades implementadas.
