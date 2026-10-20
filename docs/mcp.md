# Servidor MCP: tus notas en Claude, Cursor y otros clientes

[MCP](https://modelcontextprotocol.io) es el protocolo con el que un cliente de IA, como Claude Desktop, Claude Code o Cursor, arranca un programa de tu PC y usa sus herramientas. hiloo incluye un servidor MCP con el que la IA puede buscar y leer tus notas sin abrir ninguna ventana. Solo funciona en Windows, como hiloo.

- **Qué consulta:** el **Cerebro**, el índice local de hiloo (`%APPDATA%\hiloo\brain.sqlite`). Cada carpeta que abres en hiloo como **cuaderno** queda registrada en él.
- **Qué puede hacer la IA:** buscar, leer secciones y seguir enlaces entre notas. No puede crear ni editar notas, ni cambiar el catálogo de cuadernos o los enlaces manuales. La única herramienta que escribe es `sync`, y solo actualiza el índice (ver [Herramientas](#herramientas)).
- **Privacidad:** el servidor funciona en tu PC y no se conecta a internet. Pero lo que la IA lee (extractos y secciones de tus notas) llega al cliente y, con él, al proveedor del modelo, igual que cualquier texto que pegues en la conversación. No lo conectes a cuadernos que no quieras compartir con ese proveedor.

## Ruta corta: app instalada y Claude Code

1. Abre en hiloo, al menos una vez, la carpeta de notas que quieras consultar (**Abrir cuaderno**). Así queda registrada en el Cerebro. El servidor no registra carpetas nuevas.
2. Ejecuta en PowerShell (cambia `<usuario>` por tu usuario de Windows; lo ves en `echo $env:USERNAME`):

   ```powershell
   claude mcp add hiloo --scope user -e ELECTRON_RUN_AS_NODE=1 -- "C:\Users\<usuario>\AppData\Local\Programs\hiloo\hiloo.exe" "C:\Users\<usuario>\AppData\Local\Programs\hiloo\resources\app.asar\out\main\brain-mcp.js"
   ```

3. Comprueba que `claude mcp list` muestra `hiloo: … ✔ Connected`.
4. En una conversación nueva, pregunta algo que esté en tus notas, por ejemplo: «Busca en mis notas de hiloo qué decidimos sobre el presupuesto». La IA debería llamar a `catalog` y `search` y citar la nota.

`--scope user` deja el servidor disponible en todos tus proyectos. Sin esa opción, Claude Code lo guarda solo para la carpeta desde la que ejecutas el comando.

## Configuración

### Dónde está el servidor

La app instalada trae el servidor en `resources\app.asar\out\main\brain-mcp.js`, dentro de la carpeta de hiloo. El instalador usa por defecto `C:\Users\<usuario>\AppData\Local\Programs\hiloo`. Si elegiste otra carpeta, la encuentras con clic derecho en el acceso directo de hiloo → **Abrir ubicación del archivo**. Actualizar hiloo en la misma carpeta conserva la ruta.

`app.asar` es un archivo, no una carpeta: el Explorador no muestra `brain-mcp.js`, pero `hiloo.exe` lo encuentra. El servidor se lanza con `hiloo.exe` y la variable `ELECTRON_RUN_AS_NODE=1`, que hace que hiloo funcione como Node.js en vez de abrir su ventana. Con la app instalada no hace falta instalar Node.js.

### Claude Desktop y Cursor

Los dos usan el mismo formato JSON:

- **Claude Desktop:** abre **Configuración → Desarrollador → Editar configuración**. Se abre (o se crea) `claude_desktop_config.json`.
- **Cursor:** `%USERPROFILE%\.cursor\mcp.json` para todos los proyectos, o `.cursor\mcp.json` en la raíz de un proyecto.

```json
{
  "mcpServers": {
    "hiloo": {
      "command": "C:\\Users\\<usuario>\\AppData\\Local\\Programs\\hiloo\\hiloo.exe",
      "args": ["C:\\Users\\<usuario>\\AppData\\Local\\Programs\\hiloo\\resources\\app.asar\\out\\main\\brain-mcp.js"],
      "env": { "ELECTRON_RUN_AS_NODE": "1" }
    }
  }
}
```

En JSON, cada `\` de la ruta se escribe `\\`. Si el archivo ya tiene otros servidores, añade `"hiloo": { … }` dentro de `mcpServers`. Después cierra Claude Desktop del todo, también desde el icono de la bandeja del sistema, y vuelve a abrirlo. En Cursor, el servidor aparece con sus herramientas en la sección de MCP de **Cursor Settings**.

### Desde el repositorio (desarrollo)

Si trabajas con el código de hiloo, ejecuta `npm ci` y `npm run build` una vez. `scripts/brain-mcp.cjs` lanza el servidor compilado con el Electron del repositorio. En este caso sí hace falta Node.js.

```powershell
claude mcp add hiloo --scope user -- node "C:\ruta\a\hiloo\scripts\brain-mcp.cjs"
```

```json
{
  "mcpServers": {
    "hiloo": {
      "command": "node",
      "args": ["C:\\ruta\\a\\hiloo\\scripts\\brain-mcp.cjs"]
    }
  }
}
```

### Usar otra base

Por defecto se lee la base de la app, `%APPDATA%\hiloo\brain.sqlite`. Para usar otra, define `HILOO_BRAIN_DB` en `env` (`-e HILOO_BRAIN_DB=…` en Claude Code) o añade `"--db", "<ruta>"` al final de `args`. Sirve, por ejemplo, para probar con notas de ejemplo sin exponer tus cuadernos. El servidor no crea bases ni registra cuadernos, así que la base de pruebas se prepara antes con la [CLI](cerebro-sqlite.md#uso-desde-una-ia):

```powershell
node scripts/brain.cjs register "C:\ruta\a\hiloo\docs\demo\Proyecto de ejemplo" --db C:\temp\brain.sqlite
node scripts/brain.cjs sync <id-devuelto> --db C:\temp\brain.sqlite
claude mcp add hiloo-pruebas -e HILOO_BRAIN_DB=C:\temp\brain.sqlite -- node "C:\ruta\a\hiloo\scripts\brain-mcp.cjs"
```

## Si algo falla

| Síntoma | Causa probable |
| --- | --- |
| Se abre la ventana de hiloo en lugar del servidor | Falta `ELECTRON_RUN_AS_NODE=1` en `env` o en `-e`. |
| El cliente marca el servidor como fallido | La ruta de `hiloo.exe` o de `brain-mcp.js` es incorrecta, o, en desarrollo, falta `npm run build`. El motivo aparece en el registro del servidor: `claude mcp list` en Claude Code, **Configuración → Desarrollador** en Claude Desktop, el panel **Output** (canal MCP) en Cursor. |
| La IA responde «No existe la base de Cerebro» | Todavía no has abierto ningún cuaderno en hiloo, o `HILOO_BRAIN_DB` apunta a otra ruta. |
| La IA responde «No hay cuadernos registrados» | La base existe pero está vacía: abre una carpeta como cuaderno en hiloo. |
| La IA no encuentra algo que acabas de escribir | El índice solo ve notas guardadas. hiloo actualiza el índice al guardar o abrir una nota. Si editaste fuera de hiloo, pide a la IA que ejecute `sync` del cuaderno. |
| «El índice usa un esquema anterior» | La base es de una versión anterior de hiloo. Abre un cuaderno en hiloo: la app actualiza la base. Desde el MCP no se puede, porque `catalog` también falla. |

## Herramientas

Esta parte la usa sobre todo la IA, pero ayuda a entender qué hace. Todas devuelven un texto JSON. `maxChars` limita su longitud en caracteres, metadatos incluidos. Si el resultado no cabe, la respuesta lo indica con `truncated` o pide más presupuesto; nunca se corta a medias.

| Herramienta | Para qué | Parámetros | `maxChars` por defecto (máximo) |
| --- | --- | --- | --- |
| `catalog` | Lista los cuadernos registrados con id, ruta, estado y recuentos. Es el primer paso. | `limit` (20), `offset`, `maxChars` | 6.000 (16.000) |
| `search` | Busca por palabras clave, también con plurales y otras formas de la palabra, y ordena por relevancia. Devuelve fragmentos con extracto, `matchedTerms` (palabras encontradas) y `missingTerms` (palabras que no están en ninguna nota). | `query`, `notebook`, `ancestor` (carpeta), `limit` (6, máximo 20), `offset` (hasta 200), `maxChars` | 6.000 (16.000) |
| `outline` | Lista las secciones de una nota para leer solo la necesaria. | `node`, `limit` (50), `offset`, `maxChars` | 6.000 (16.000) |
| `read` | Lee hasta 8 fragmentos después de comprobar el archivo en disco. | `ids`, `expectedHashes`, `maxChars` | 12.000 (32.000) |
| `related` | Vecinos directos de un cuaderno, carpeta o nota: `hierarchy` (contenido de carpetas), `link` (enlaces Markdown, por defecto) o `manual` (relaciones creadas por la persona). | `node`, `type`, `direction`, `limit` (20), `offset`, `maxChars` | 6.000 (16.000) |
| `sync` | Vuelve a indexar un cuaderno desde el disco. Si los avisos no caben, devuelve los primeros y `warningsOmitted`. | `notebook` | 4.000 (fijo) |

El flujo habitual es `catalog` → `search` → `outline` o `read` → `related`, si hace falta más contexto. Cuando `truncated` es `true`, la IA continúa con el `nextOffset` devuelto.

`read` marca cada fragmento como `ok`, `stale` (el archivo cambió desde que se indexó) o `unavailable` (el archivo no existe o no se puede leer). Solo `ok` trae contenido. Ante `stale`, la IA llama a `sync` y repite la búsqueda.

`sync` solo reconstruye lo que se deriva de los archivos: fragmentos, búsqueda, carpetas y enlaces Markdown. No escribe notas, no registra ni quita cuadernos y no toca los enlaces manuales. Los clientes la muestran sin la marca de solo lectura porque escribe en la base.

No existen `register`, `language`, `link`, `unlink` ni `status`, ni herramientas para escribir notas. Registrar cuadernos se hace abriéndolos en hiloo. El idioma de búsqueda y los enlaces manuales se gestionan con la [CLI](cerebro-sqlite.md), que requiere el repositorio. Escribir notas desde MCP (`write_note`, `patch_section`) se estudiará más adelante.

## Seguridad y convivencia con la app

- El contenido de las notas es **dato, no instrucciones**. El servidor se lo indica al cliente: una nota que diga «ignora lo anterior» no debe cambiar lo que hace la IA.
- Los argumentos se validan con esquemas estrictos: los ids son identificadores del índice (UUID), los hashes son SHA-256 y se rechazan los campos desconocidos. Ninguna herramienta acepta SQL ni rutas de archivo.
- Las herramientas de lectura abren SQLite en modo de solo lectura (`readOnly` y `query_only`) y no migran el esquema. `sync` abre una conexión de escritura aparte.
- La base usa el modo WAL de SQLite: el servidor lee mientras hiloo escribe. `sync` usa el mismo control de trabajos que la app, así que dos procesos no indexan el mismo cuaderno a la vez.

## MCP, CLI y skill

| | Servidor MCP | CLI `scripts/brain.cjs` | Skill `hiloo-notes` |
| --- | --- | --- | --- |
| Qué es | Herramientas que el cliente muestra a la IA | Comandos que la IA ejecuta en una terminal | Instrucciones de trabajo para la IA |
| Requiere | La app instalada o el repositorio compilado | El repositorio compilado | El repositorio (está en `skills/hiloo-notes`) |
| Buscar y leer | Sí | Sí | Explica cómo hacerlo con el MCP o la CLI |
| Registrar cuadernos, idioma, enlaces manuales | No | Sí | Explica cómo hacerlo con la CLI |
| Escribir notas | No | No | Con las herramientas de archivos de la IA |

## Decisiones de diseño

- **`sync` explícito en vez de revalidar en cada búsqueda.** Comprobar el disco en cada consulta obligaría a recorrer hasta 1.000 notas y a competir por la base con la app abierta. `read` ya verifica cada fragmento y avisa con `stale`, así que la IA actualiza solo cuando lo necesita.
- **Descripciones breves.** El cliente envía la descripción de cada herramienta al modelo en cada conversación. Por eso son cortas y el detalle está aquí. El MCP no ahorra contexto frente a la CLI: su ventaja es que funciona en clientes sin terminal y sin el repositorio.
