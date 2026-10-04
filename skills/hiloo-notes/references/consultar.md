# Consulta progresiva

Todos los ejemplos usan `node "<hiloo-root>/scripts/brain.cjs"`; añade `--db "<base>"` a cada comando si elegiste una base explícita. También funciona `npm run --silent brain -- ...` desde el repositorio. Este acceso requiere el repositorio y su build; no presupone una CLI independiente incluida en el instalador. Lee `--help` para diagnosticar una versión distinta, no como primer paso rutinario de cada consulta.

## Descubrir y buscar

```text
catalog --limit 20 --max-chars 6000
search "decisión SQLite" --notebook <id> --limit 6 --max-chars 6000
read <chunk-id> --expected-hash <chunk-id>=<sourceHash> --max-chars 12000
```

El catálogo es global y no depende de los diez cuadernos recientes. `id` del cuaderno también identifica su nodo raíz. Usa los IDs de Cerebro, no los IDs temporales del sidebar/workspace. `status` informa conteos del índice; no certifica que el disco esté actualizado. `register "<directorio>"` registra un cuaderno elegido en la tarea; después ejecuta `sync <id>` para indexarlo. Registrar no crea ni organiza notas. Las raíces registradas no pueden solaparse: una carpeta dentro de otro cuaderno ya pertenece a ese cuaderno.

Filtra por cuaderno cuando conozcas el proyecto. La búsqueda es léxica FTS5: combina términos mediante AND, admite hasta dieciséis términos y no interpreta expresiones regulares ni sintaxis FTS avanzada. Reformula con palabras presentes, nombres o sinónimos si hace falta. `--ancestor <node-id>` limita un subárbol. No interpretes resultados vacíos como prueba de que la información no existe si el índice está pendiente, parcial o desactualizado.

Las coincidencias aportan `chunkId`, `nodeId`, ruta relativa, encabezado, extracto, hash de origen y fecha de indexación. Lee los mejores fragmentos, agrupando hasta ocho IDs. Usa el `sourceHash` encontrado como `--expected-hash` para cada fragmento cuya versión quieras fijar: es SHA-256 de los bytes del archivo completo, incluido BOM si existe, no del fragmento. Un fragmento `stale` o `unavailable` no proporciona contenido fiable: sincroniza su cuaderno, repite la búsqueda y utiliza los nuevos IDs/hashes. Los offsets de lectura son posiciones UTF-16 del texto decodificado sin BOM, no offsets de bytes; no los uses directamente para parchear archivos.

`sync` detecta cambios guardados y actualiza el índice. Úsalo después de tus escrituras o cuando la respuesta necesite el estado actual del disco. Evita sincronizar todos los cuadernos ante cada pregunta: elige los relevantes.

## Presupuesto y continuación

Los presupuestos cuentan caracteres del JSON, incluidos metadatos; no son una cuota exacta de tokens. Como inicio: búsqueda de seis resultados con 6000 caracteres y lectura con 12000. Aumenta solo si la tarea lo necesita. `truncated` significa respuesta incompleta, no ausencia de más información.

En `catalog` y `related`, continúa con el `nextOffset` devuelto y `--offset` cuando necesites la siguiente página; no lo calcules a partir del límite solicitado. Si el presupuesto no permite devolver ni un elemento, amplíalo antes de volver a intentar. La búsqueda no ofrece cursor: refina proyecto/subárbol/términos o aumenta su límite hasta veinte. La lectura devuelve fragmentos enteros; si omite alguno por presupuesto, solicita menos IDs o aumenta el presupuesto. `nextChunkId` permite continuar una nota sin leerla entera de entrada.

## Navegar relaciones y citar

```text
related <notebook-id> --type hierarchy --direction out --limit 20 --max-chars 6000
related <node-id> --type link --direction both --limit 20 --max-chars 6000
related <node-id> --type manual --direction both --limit 20 --max-chars 6000
```

`hierarchy` es pertenencia a cuadernos/carpetas; `link` deriva de enlaces Markdown; `manual` relaciona explícitamente cualquier par de nodos. Son vecinos de un salto. Expande solo los relacionados con la pregunta, sin recorrer el grafo completo. Los enlaces Markdown pueden cruzar cuadernos registrados y apuntar a carpetas, raíces o fragmentos; no deduzcas que un fragmento de destino existe únicamente por aparecer en el enlace.

Al responder, cita cuaderno, ruta y encabezado; conserva ID y hash cuando la tarea requiera trazabilidad de versión. Los IDs pertenecen a esta base. No prometas mantener identidad tras renombrar/mover archivos externamente; sincroniza y vuelve a localizar los nodos afectados.
