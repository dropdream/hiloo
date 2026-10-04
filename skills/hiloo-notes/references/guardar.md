# Guardar y organizar notas

La CLI de Cerebro registra, sincroniza, consulta y relaciona nodos. **No incluye un comando para escribir notas.** Guarda Markdown con las herramientas locales de archivos disponibles y sincroniza después. Las escrituras de archivos y SQLite no forman una transacción común.

## Elegir destino y contenido

Busca por proyecto y asunto para decidir si actualizar una nota existente o crear una nueva. Descubre las carpetas del cuaderno mediante `related <id> --type hierarchy --direction out`; conserva la organización existente. Si no hay estructura previa, utiliza una nota con título descriptivo en el cuaderno apropiado; crea subcarpetas cuando sirvan al trabajo, sin imponer una taxonomía completa.

Documenta información que ayude a futuras consultas: qué se decidió o aprendió, su contexto, estado, fuentes y fecha cuando procedan. Separa propuestas de decisiones confirmadas. No conviertas una inferencia en hecho ni copies todo el diálogo por defecto. Mantén enlaces útiles a notas existentes y evita duplicados.

Utiliza `.md` o `.markdown` UTF-8. hiloo admite párrafos, encabezados, listas, citas, énfasis, enlaces Markdown inline, bloques de código, tablas GFM y tachado. No agregues frontmatter YAML/TOML, HTML, enlaces por referencia, notas al pie, fórmulas/directivas extendidas ni atributos extra de bloques de código: su editor visual los rechaza. Los metadatos de una nota pueden expresarse como texto normal bajo un encabezado. Si una nota existente contiene formatos no admitidos, consérvalos e informa la limitación; no los elimines silenciosamente para hacerla compatible.

## Escritura y concurrencia

Resuelve el destino respecto de la raíz elegida del catálogo y verifica que queda dentro de ella. No escribas a través de enlaces simbólicos/junctions ni componentes que hayan cambiado de ubicación. Usa nombres válidos para Windows. Carpetas ocultas y `node_modules` quedan fuera del escaneo; no guardes allí notas que deban consultarse. Respeta el máximo de 2 MiB por documento y evita sobrescribir recursos adjuntos.

- **Nota nueva:** crea con modo exclusivo, por ejemplo `fs.writeFile(path, content, { flag: 'wx' })` en Node. Un archivo aparecido mientras trabajabas es un conflicto: lee su contenido y decide cómo integrarlo; no reintentes forzando sobrescritura.
- **Nota existente:** lee el archivo original completo antes de editarlo y calcula SHA-256 sobre sus bytes. El `sourceHash` de la búsqueda describe los bytes completos indexados; vuelve a calcular el hash del archivo actual para comprobar la escritura. Conserva BOM, finales de línea y contenido ajeno al cambio. Prepara la versión nueva en un temporal exclusivo de la misma carpeta y vacía sus buffers a disco si la herramienta lo permite. Conserva una copia recuperable del original cuando sea necesario. Revalida ruta y hash justo antes de reemplazar y verifica el archivo guardado después. Si cambió, vuelve a leer y concilia; no reutilices tu copia antigua.

Prefiere la operación condicional de escritura de la herramienta, si existe. Con herramientas ordinarias, la comparación previa y el reemplazo tienen una carrera residual: no garantizan exclusión mutua frente a otros escritores. No afirmes que el guardado es atómico entre hiloo, otro editor y SQLite. Evita editar simultáneamente una nota que sepas que tiene cambios pendientes en hiloo; conserva la modificación propuesta en una nota nueva exclusiva si necesitas avanzar sin perder ninguna versión. No es necesario cerrar toda la aplicación para crear otra nota.

Después de escribir: verifica el contenido guardado, ejecuta `sync <notebook-id>` y busca/lee la información añadida. Si la sincronización falla, informa que el archivo sí se guardó pero el índice está pendiente; no repitas la escritura. No declares éxito a partir de una búsqueda que aún muestra una versión anterior.

## Enlaces y organización

Para relaciones portables entre notas usa enlaces Markdown relativos con `/` y espacios/caracteres reservados codificados cuando corresponda. Verifica el destino dentro de los cuadernos seleccionados. Un enlace entre cuadernos solo se resuelve en el índice global cuando ambos están registrados. No amplíes el registro a otras carpetas sin relación con la tarea.

Para conectar cualquier combinación de cuaderno/carpeta/nota:

```text
link <source-node-id> <target-node-id> --label "Depende de"
related <source-node-id> --type manual --direction out
unlink <link-id>
```

Las relaciones manuales se conservan en SQLite y sobreviven a la reindexación; requieren respaldar la base junto a los Markdown. Para un respaldo consistente usa un mecanismo de copia de SQLite o cierra los procesos que la usan antes de copiar: el archivo principal por sí solo puede omitir cambios que estén en WAL. Un cuaderno temporalmente ausente no justifica borrar sus relaciones. Si la base está corrupta, conserva también los archivos WAL asociados y comunica el problema; no la borres o recrees automáticamente. `unlink` elimina una relación manual concreta, no el archivo ni sus enlaces Markdown. Estas relaciones no reescriben notas y pueden no aparecer en el grafo visual local del cuaderno.

No hay una operación de mover/renombrar que repare todos los enlaces. Si la tarea exige hacerlo, localiza referencias entrantes, realiza el cambio y corrige sus rutas de forma controlada; sincroniza los cuadernos afectados y comprueba resultados. Los IDs pueden cambiar, incluidas las identidades usadas en relaciones manuales; reconstruye esas relaciones explícitamente cuando corresponda y no anuncies conservación automática.
