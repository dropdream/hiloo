# Etapa 1: contrato compartido entre los frentes A, B y C

*Paso 1.0 del plan · 2026-10-24 · **Decidido el 2026-10-24** por la persona (custodia en Hiloo con dos claves, `hiloo.exe --mcp` y firma `classical_only` en la etapa 1). El diseño vigente es `arquitectura/diseno-dcp-hiloo.md` del cuaderno Hiloo (secciones 5, 7b, 8, 10, 10b, 11, 12 y 15); este documento lo concreta para la etapa 1 y propone los cambios que salieron de la investigación.*

La etapa 1 (identidad y escritura local, sin nube) se reparte en tres frentes que corren en paralelo:

- **A.** MCP con escritura (`create_note`, `replace_section`, `append_section`), bloqueo local y registro de autoría.
- **B.** Agente Persona (plantilla e instancia), "Conectar agente", custodia de la clave y el firmante dentro de Hiloo.
- **C.** `declarar_intencion`, `firmar`, `preparar_repo` y el registro de commits; depende de B.

Este contrato fija lo que comparten: el pasaporte local, las tablas nuevas del Cerebro (esquema 4), las herramientas MCP, el canal del firmante, el modelo de amenazas y la organización del código. Lo que está implementado en esta rama es el mínimo: tipos en `src/shared/dcp.ts`, la migración a la versión 4 con sus pruebas, el contexto compartido del MCP (`src/main/mcp/contexto.ts`) y el spike de custodia (`scripts/etapa-1-custodia/`). Nada de herramientas ni interfaz.

## 1. Vocabulario y convenciones

| Término | Significado |
| --- | --- |
| **Persona** (plantilla) | Catálogo de la organización: rol, permisos, personalidad. Tabla `personas`. |
| **Agente** (instancia) | Una persona emitida a un responsable humano con nombre propio, clave y vencimiento. Tabla `agentes`. Su **pasaporte** es la carga firmada que describe la instancia. |
| **Firmante** | Código del proceso principal de Hiloo que custodia la clave, aplica la política y firma. Es el único punto de firma DCP. |
| **MCP** | `brain-mcp.js`, proceso Node aparte que usan Claude Code, Cursor y otros. Nunca tiene la clave. |
| **Carga firmada** | Envoltorio `SignedPayload` del SDK de DCP: `{ payload, payload_hash, composite_sig }`. Se firma el JSON canónico (`dcp-jcs-v1`) del `payload` con separación de dominio (`UTF8(contexto) || 0x00 || canónico`). |
| **Cerebro** | `brain.sqlite`. En la etapa 1 también guarda identidad, autoría, intenciones, commits y bloqueos. |

Convenciones comunes a los tres frentes:

- Fechas en ISO 8601 UTC con `Z`. Ids UUID v4 en texto. Hashes de archivo SHA-256 en hex minúsculas (los mismos `sourceHash` que ya devuelve el Cerebro).
- Lo que se firma va en `snake_case` (es JSON canónico que viaja); lo que vive en la app, en `camelCase`. Los tipos están en `src/shared/dcp.ts`.
- DCP es una dependencia externa (`@dcp-ai/sdk@2.1.1`, fijada; en Deno `npm:@dcp-ai/sdk@2.1.1`). No se reimplementa nada: canonicalización, firma, verificación y `deriveKid` son del SDK. Lo que falte se anota como dependencia (sección 10).
- **Nunca** se escriben valores de claves privadas, secretos de emparejamiento, `sub` ni correos en código, notas, commits, logs ni respuestas del MCP.

## 2. Pasaporte local

### 2.1 Persona (plantilla)

Carga `PersonaPayload`. En la etapa 1 se guarda sin firma (`firma_admin` nulo) porque los humanos no tienen clave hasta la etapa 3 (passkey). La estructura ya es la que firmará un admin entonces, como carga propia de Hiloo con el contexto `hiloo.v1.Persona` (ver 2.4).

```json
{
  "hiloo_version": 1,
  "tipo": "persona",
  "id": "7f1c…",
  "org_id": "a0b1…",
  "nombre_plantilla": "Revisor de seguridad",
  "rol": "Agente revisor de seguridad de erpcacem",
  "permisos": {
    "cuadernos": ["9e050d9a-d3e7-415f-9f71-180530855d45"],
    "repos": ["https://github.com/dropdream/erpcacem_dev"],
    "rutas": ["tareas/**", "problemas/**"],
    "nivel_max": "standard"
  },
  "personalidad": { "tono": "directo", "idioma": "es", "detalle": "alto" },
  "version": 1,
  "creada_en": "2026-10-24T12:00:00Z"
}
```

Reglas: `nombre_plantilla` único por organización; `permisos.cuadernos` son ids del Cerebro (en la etapa 3, ids de cuadernos de la organización, que coinciden porque el Cerebro de esa etapa se crea desde Supabase); `rutas` son globs relativos a la raíz del cuaderno o del repo, vacío = sin restricción; cada cambio de la plantilla sube `version` y, desde la etapa 3, exige la firma de un admin. Los agentes conservan `persona_version` para saber con qué versión se emitieron; la política vigente es siempre la versión actual de la plantilla (el cambio aplica a todos sus agentes, como manda la sección 10b).

### 2.2 Agente (instancia): la carga del pasaporte

`PasaportePayload` = `AgentPassportV2` de DCP + un objeto `hiloo` con lo que obliga `registrar` y el check de CI. Calca la fila `agentes` de la sección 8 para que la etapa 3 la suba sin traducir.

```json
{
  "dcp_version": "2.0",
  "agent_id": "c3d4…",
  "session_nonce": "<64 hex, generado al emitir>",
  "keys": [
    { "kid": "<deriveKid('ed25519', pub)>", "alg": "ed25519", "public_key_b64": "<32 bytes>", "created_at": "…", "expires_at": "2027-04-24T00:00:00Z", "status": "active" }
  ],
  "principal_binding_reference": "<id local del humano responsable>",
  "capabilities": ["file_write", "code_exec"],
  "risk_tier": "medium",
  "created_at": "2026-10-24T12:00:00Z",
  "status": "active",
  "hiloo": {
    "org_id": "a0b1…",
    "persona_id": "7f1c…",
    "persona_version": 1,
    "nombre": "claude-recibos",
    "rol": "Agente revisor de seguridad de erpcacem",
    "permisos": { "cuadernos": ["…"], "repos": ["…"], "rutas": ["tareas/**"], "nivel_max": "standard" },
    "restricciones": null,
    "responsable_id": "<id local del humano>",
    "vence_en": "2027-04-24T00:00:00Z",
    "avatar": null,
    "color": "#3b7dd8",
    "org_origen": null,
    "clave_git": { "kid": "<deriveKid de la clave git>", "public_key_b64": "<32 bytes>", "ssh": "ssh-ed25519 AAAA…" }
  }
}
```

- `keys[]` lleva la **clave DCP** del agente (Ed25519; si se adopta la firma compuesta, una segunda entrada `ml-dsa-65`). `hiloo.clave_git` es la **clave de git**, distinta (ver sección 5: por qué dos claves). Ambas son públicas; el pasaporte no contiene nada secreto.
- `capabilities` y `risk_tier` se derivan de los permisos: `file_write` si hay cuadernos, `code_exec` si hay repos; `risk_tier` = `low` para `routine`, `medium` para `standard`, `high` para `elevated` o `maximum`. Son el vocabulario DCP-01; la política real son los permisos de `hiloo`.
- `hiloo.permisos` es una **copia** de los de la plantilla en el momento de emitir; `restricciones` solo puede quitar (subconjunto). La política vigente se calcula como `permisos_plantilla_actual ∩ restricciones`.
- `principal_binding_reference` y `responsable_id` son el id local de `humanos`; en la etapa 3 pasan a ser `humanos.id` de Supabase (misma fila, misma forma).

### 2.3 Qué va firmado y por quién

| Firma | Contexto DCP | Quién | Cuándo |
| --- | --- | --- | --- |
| `composite_sig` del pasaporte (`agentes.pasaporte`) | `DCP-AI.v2.AgentPassport` | La **clave DCP del propio agente** (prueba de posesión) | Al emitir, en "Conectar agente" (B). `binding: classical_only` en la etapa 1. |
| `agentes.firma_emision` | `DCP-AI.v2.AgentPassport` sobre el mismo `payload` | Un **admin** humano (passkey) | Etapa 3. Hasta entonces es nulo y Hiloo confía en su propio Cerebro. |
| `personas.firma_admin` | `hiloo.v1.Persona` | Un admin | Etapa 3. |

Campos que **obligan** (si cambian, se reemite el pasaporte): `nombre`, `rol`, `permisos`, `restricciones`, `vence_en`, `keys`, `clave_git`. Campos que **guían** (se versionan en la plantilla, no obligan): `personalidad`. `avatar` y `color` son presentación.

### 2.4 Cómo se firma y se verifica (SDK de DCP, verificado en el spike)

```ts
import { preparePayload, classicalOnlySign, compositeVerify, verifyPayloadHash, getDefaultRegistry, registerDefaultProviders, DCP_CONTEXTS, deriveKid } from '@dcp-ai/sdk'
registerDefaultProviders()
const registro = getDefaultRegistry()
const { canonicalBytes, payloadHash } = preparePayload(payload)          // sha256:<hex>
const composite_sig = await classicalOnlySign(registro, DCP_CONTEXTS.AgentPassport, canonicalBytes, { kid, alg: 'ed25519', publicKeyB64, secretKeyB64 })
const carga = { payload, payload_hash: payloadHash, composite_sig }       // SignedPayload
// Verificar (cualquier Hiloo, la Edge Function registrar, el check de CI):
verifyPayloadHash(carga) && (await compositeVerify(registro, DCP_CONTEXTS.AgentPassport, preparePayload(carga.payload).canonicalBytes, carga.composite_sig, publicKeyB64)).valid
```

- Contextos: pasaporte `DCP-AI.v2.AgentPassport`; intención `DCP-AI.v2.Intent`; registro de escritura y de commit `DCP-AI.v2.AuditEvent` (son eventos de auditoría DCP-03); desafío del emisor (etapa 3) `DCP-AI.v2.ProofOfPossession`; cargas propias de Hiloo (persona) con el prefijo `hiloo.v1.` (el SDK acepta cualquier cadena como contexto). Las cargas Hiloo se distinguen por `tipo`.
- `kid` = `deriveKid('ed25519', bytes de la pública)` (32 hex). Verificado: coincide con el `kid` que genera `Ed25519Provider.generateKeypair()`.
- En el firmante, la clave DCP no sale de memoria más que lo que dura la firma; se usa `SecureKeyGuard`/`secureZero` del SDK al descartar.
- Los JSON firmados no admiten números con decimales (`assertNoFloats`): todo lo numérico va entero.

## 3. Tablas nuevas del Cerebro (esquema 4)

Implementadas en `src/main/brain/schema.ts` (`schemaV4`), con pruebas en `tests/brain-schema-v4.spec.ts`. La migración solo **crea** tablas: no toca `notebooks`, `nodes`, `chunks`, `links`, `manual_links` ni `jobs`, no reindexa y conserva identidades. Es idempotente. Una base nueva o migrada recibe **una** fila en `organizaciones` de tipo `local`; en la etapa 3 cada Cerebro se crea desde la organización remota (sección 4 del diseño) y esa fila se reemplaza.

| Tabla | Columnas | Claves e índices | Escribe | Lee |
| --- | --- | --- | --- | --- |
| `organizaciones` | `id, nombre, tipo ('local'|'remota'), creada_en` | PK `id` | migración (B en etapa 3) | todos |
| `humanos` | `id, auth0_sub (único, nulo en local), nombre, creado_en` | PK `id` | B ("Conectar agente" crea el responsable local; si hay sesión Auth0, guarda el `sub`) | B, quien_soy |
| `personas` | `id, org_id, nombre_plantilla, rol, permisos (JSON), nivel_max, personalidad (JSON), version, firma_admin (JSON), creada_en, actualizada_en` | PK `id`; `UNIQUE(org_id, nombre_plantilla)`; `UNIQUE(id, org_id)`; FK `org_id` | B | B, firmante, quien_soy |
| `agentes` | `id, org_id, persona_id, persona_version, nombre, avatar, color, restricciones (JSON), responsable_id, clave_publica, kid, clave_pq_publica, kid_pq, secreto_hash, pasaporte (JSON), org_origen, emitido_por, firma_emision, vence_en, revocado_en, revocado_desde, revocado_motivo, creado_en` | PK `id`; `UNIQUE(org_id, nombre)`; `UNIQUE(kid)`; `UNIQUE(id, org_id)`; FK compuesta `(persona_id, org_id)`; índice `(org_id, revocado_en)` | B (emitir, revocar) | firmante, MCP (`quien_soy`, autoría), C |
| `intenciones` | `id, org_id, agente_id, repo, rama, accion, recurso, nivel, payload (JSON), payload_hash, firma (JSON), creada_en` | PK; FK `(agente_id, org_id)`; índices `(org_id, agente_id, creada_en)` y `(repo, rama)`; **solo agregar** (triggers) | firmante (al firmar `declarar_intencion`, C) | C, A (si una escritura cita intención), etapa 2 |
| `commits` | `id, org_id, repo, sha, patch_id, rama, agente_id, intencion_id, fecha_commit, registrado_en, firma (JSON)` | PK; `UNIQUE(repo, sha)`; FK `(agente_id, org_id)` y `(intencion_id, org_id)`; índices por intención y por agente; **solo agregar** | firmante (al registrar un commit, C) | etapa 2, check de CI (etapa 3) |
| `escrituras` | `id, org_id, notebook_id, node_id, ruta, herramienta, cliente, agente_id, intencion_id, hash_antes, hash_despues, firma (JSON), creada_en` | PK; FK `notebook_id`, `node_id`, `(agente_id, org_id)`, `(intencion_id, org_id)`; `CHECK(herramienta)`; índices `(node_id, creada_en)` y `(org_id, agente_id, creada_en)`; **solo agregar** | firmante cuando hay agente; el MCP (A) cuando corre sin `HILOO_AGENTE` (fila sin `agente_id` ni `firma`) | etapa 2 (✓/✗), auditoría |
| `bloqueos` | `artefacto_key (PK), org_id, notebook_id, titular_tipo ('app'|'agente'), titular_id, titular_nombre, pid, vence_en, creado_en` | PK por nota (`pathKey` absoluto en minúsculas, sirve antes de que exista el nodo); índice `vence_en` | A: la app al abrir para editar (30 s renovables) y el MCP en la primera escritura (60 s, se suelta al terminar) | A |

Reglas transversales:

- `commits.fecha_commit` es la que pone git (la controla quien firma); `registrado_en` es el reloj del Cerebro al registrar. Es la mitigación del retrodatado que dejó la prueba 0a: en la etapa 3 el check exige la fila y una ventana razonable entre ambas.
- `escrituras.hash_antes` es el `sourceHash` que el agente leyó (`expectedHash`); `hash_despues`, el del archivo escrito. Con `node_id` nulo solo en el caso límite de que la sincronización falle tras escribir.
- Un bloqueo vencido se trata como inexistente: quien lo encuentra vencido lo reemplaza. Una fila por nota; la app y el MCP comparan `vence_en` con su reloj.
- `secreto_hash` es SHA-256 del secreto de emparejamiento del MCP (sección 6.2). El secreto mismo no se guarda en el Cerebro.

**Cómo probar sin tocar la base de la persona.** El Hiloo instalado usa `%APPDATA%\hiloo\brain.sqlite` con el esquema 3 y **no se migra** en esta etapa (una base en 4 ya no la abre la app instalada: "pertenece a una versión más reciente"). Todo frente trabaja contra una base aparte:

```powershell
$env:HILOO_BRAIN_DB = "C:\temp\etapa1\brain.sqlite"      # o --db en la CLI y el MCP
node scripts/brain.cjs register "C:\ruta\a\docs\demo\Proyecto de ejemplo"
node scripts/brain.cjs sync <id>
claude mcp add hiloo-etapa1 -e HILOO_BRAIN_DB=C:\temp\etapa1\brain.sqlite -e HILOO_ESCRITURA=<id> '--' node "C:\ruta\al\worktree\scripts\brain-mcp.cjs"
```

Las pruebas Playwright usan `testInfo.outputPath('brain.sqlite')`, como las existentes. Cuidado: `npm run brain -- sync` **sin `--db`** desde un worktree con el esquema 4 migraría la base de la app; el comando de sincronización del cuaderno de este proyecto se ejecuta desde el checkout de `main`, que sigue en 3. Propuesta (sección 10): que `scripts/brain.cjs` y `brain-mcp.cjs` avisen por stderr cuando se ejecutan desde un repo y van a abrir la base por defecto.

## 4. Contratos de las herramientas MCP

### 4.1 Cómo sabe el MCP quién es y dónde puede escribir

| Variable (o flag) | Significado | Quién la pone |
| --- | --- | --- |
| `HILOO_BRAIN_DB` / `--db` | Base del Cerebro (ya existe). | Persona o "Conectar agente". |
| `HILOO_AGENTE` / `--agente` | Id (UUID) del agente con el que corre el MCP. Sin ella, el MCP no tiene identidad: lee, y escribe solo como "cliente MCP" sin firma. | "Conectar agente" lo pone en la configuración que entrega. |
| `HILOO_AGENTE_SECRETO` | Secreto de emparejamiento con el firmante (sección 6.2). Solo tiene sentido con `HILOO_AGENTE`. | "Conectar agente". Se entrega una sola vez. |
| `HILOO_ESCRITURA` / `--escritura` | Ids de cuaderno, separados por coma, con escritura habilitada. Vacío = MCP de solo lectura (comportamiento actual). | Persona o "Conectar agente" (desde `permisos.cuadernos`). |

El contexto compartido (`src/main/mcp/contexto.ts`, implementado) valida estas variables al arrancar y expone `config.agenteId` y `config.cuadernosEscritura`. Si `HILOO_AGENTE` apunta a un agente que no existe, está revocado o vencido, las herramientas de lectura siguen funcionando y las demás devuelven `agente_desconocido`, `agente_revocado` o `agente_vencido`.

Permisos efectivos para escribir en un cuaderno: `cuaderno ∈ HILOO_ESCRITURA` **y**, si hay agente, `cuaderno ∈ permisos vigentes del agente`. La primera condición la aplica el MCP; la segunda, el firmante (sección 6.3).

### 4.2 Formato de errores

Todas las herramientas devuelven texto JSON. Un error es `{ "error": "<mensaje>", "codigo": "<código>", "detalle": { … } }` con `isError: true`. Las herramientas de lectura actuales siguen devolviendo `{ "error": … }` sin código. Códigos (`CodigoErrorMcp` en `src/shared/dcp.ts`):

| Código | Cuándo | Detalle |
| --- | --- | --- |
| `escritura_desactivada` | El cuaderno no está en `HILOO_ESCRITURA`. | `cuaderno` |
| `cuaderno_no_permitido` | El agente no tiene ese cuaderno en sus permisos vigentes. | `cuaderno` |
| `ruta_invalida` | Ruta absoluta, con `..`, sin `.md`, nombre reservado de Windows, más de 16 niveles o fuera del cuaderno (reglas de `workspaceEntryName` y `validateWorkspaceNote`). | `ruta` |
| `nota_existente` / `nota_no_encontrada` | `create_note` sobre una ruta que existe; las demás sobre una que no. | `ruta` |
| `seccion_no_encontrada` | El `chunkId` no pertenece a la nota o ya no existe. | `seccion` |
| `hash_desactualizado` | `expectedHash` ≠ hash actual del archivo. El agente relee (`outline`/`read`) y reintenta. | `hashActual` |
| `bloqueada` | La nota está bloqueada por otro titular y el bloqueo no venció. | `titular`, `venceEn` |
| `markdown_no_admitido` | HTML, YAML, notas al pie, referencias, protocolos peligrosos (mismas reglas que al abrir en Hiloo). | `motivo` |
| `demasiado_grande` | Más de 2 MiB por nota (límite del Cerebro) o cuaderno sin margen (1.000 notas). | `limite` |
| `sin_agente` | La herramienta exige `HILOO_AGENTE`. | |
| `agente_desconocido` / `agente_revocado` / `agente_vencido` | Estado del agente en el Cerebro. | `desde` |
| `fuera_de_permisos` | El firmante rechazó por política (repo, ruta, nivel). | `regla` |
| `sin_intencion` | La operación exige una intención abierta del agente y no la hay. | |
| `firmante_no_disponible` | Hiloo no está abierto o no responde en el canal local. Mensaje claro: "Abre Hiloo para firmar". | |
| `clave_no_cargada` | La clave git del agente no está en el `ssh-agent`. | `kid` |
| `repo_invalido` | La ruta no es un repo git, no está en los repos permitidos o es un worktree ajeno. | `ruta` |
| `ssh_agent_detenido` | El servicio `ssh-agent` de Windows no corre. Mensaje con el paso de administrador. | |
| `interno` | Cualquier otro fallo. | |

### 4.3 Herramientas

Todas aceptan `maxChars` como las actuales. `cuaderno` es el id del Cerebro; `nota` el `nodeId`; `seccion` un `chunkId` de `outline`; `expectedHash` el `sourceHash` de `outline`/`search`/`read`. Anotaciones MCP: `readOnlyHint: false`, `destructiveHint: false` (nunca borran), `idempotentHint: false`.

| Herramienta | Frente | Entradas | Salida | Errores propios |
| --- | --- | --- | --- | --- |
| `create_note` | A | `cuaderno`, `ruta` (relativa, `.md`), `contenido` (Markdown), `actualizarIndice` (bool, por defecto `true`: añade la nota al mapa de notas de `indice.md`, bajo la carpeta que corresponde), `intencion` (id, opcional) | `{ nota, ruta, sourceHash, bytes, indiceActualizado, escritura }` | `nota_existente`, `ruta_invalida`, `markdown_no_admitido`, `demasiado_grande`, `escritura_desactivada`, `cuaderno_no_permitido`, `bloqueada` (si `indice.md` está bloqueado) |
| `replace_section` | A | `nota`, `seccion`, `expectedHash`, `contenido`, `intencion` | `{ nota, sourceHash, seccion: { chunkId, heading }, escritura }` | `seccion_no_encontrada`, `hash_desactualizado`, `bloqueada`, `markdown_no_admitido` |
| `append_section` | A | `nota`, `expectedHash`, `contenido`, `bajo` (chunkId de una sección; sin él, al final de la nota), `intencion` | igual que `replace_section` | ídem |
| `declarar_intencion` | C | `accion` (texto corto), `recurso` (texto), `descripcion`, `nivel` (`routine`…`maximum`), `repo` (URL o ruta), `rama`, `cuaderno` | `{ intencion: Intencion }` (carga firmada incluida) | `sin_agente`, `fuera_de_permisos` (nivel > `nivel_max`, repo no permitido), `firmante_no_disponible` |
| `firmar` | C | `tipo` (`'commit'` en la etapa 1; `'mensaje'` en la 4), `datos` tipados según `tipo` (para `commit`: `repo`, `sha`, `rama`, `patchId`, `fechaCommit`, `intencion`) | `{ carga: CargaFirmada<…>, registro }` | `sin_agente`, `sin_intencion`, `fuera_de_permisos`, `firmante_no_disponible`. **No firma bytes arbitrarios** (sección 6.3). |
| `preparar_repo` | C | `ruta` (del worktree), `intencion` (opcional) | `{ repo, rama, configurado: {…}, hook: 'post-commit' }` | `repo_invalido`, `ssh_agent_detenido`, `clave_no_cargada`, `sin_agente` |
| recurso `quien_soy` (`hiloo://agente/quien-soy`) | B | ninguna | `QuienSoy` (sección 2 de `src/shared/dcp.ts`): nombre, rol, permisos vigentes, personalidad, responsable, `esIA: true`, cuadernos con escritura | `sin_agente`, `agente_*` |

Detalles que fijan el comportamiento:

- **Secciones.** El Cerebro parte las notas en fragmentos de ~2.400 caracteres, así que un `chunkId` puede ser un trozo de una sección larga. `replace_section` y `append_section` operan sobre la **sección de encabezado** a la que pertenece el fragmento: desde su encabezado (inclusive) hasta el siguiente de igual o mayor nivel. El fragmento con `heading` vacío es el preámbulo. `contenido` de `replace_section` debe empezar por un encabezado del mismo nivel (puede cambiar el texto) o, para el preámbulo, no tener encabezados de nivel 1. `append_section` con `bajo` inserta al final de esa sección (antes del siguiente encabezado de igual o mayor nivel), con un encabezado de nivel mayor que el de `bajo` o sin encabezado.
- **Orden de una escritura** (A, con agente): 1) validar ruta y Markdown; 2) tomar el bloqueo (60 s) o fallar `bloqueada`; 3) comparar `expectedHash` con el archivo; 4) con agente, pedir al firmante `autorizar` (política, barato); 5) escribir atómicamente (temporal + `rename`, conservando BOM y fin de línea del archivo); 6) `sync` del cuaderno; 7) con agente, pedir al firmante la firma de la carga `EscrituraPayload` (el firmante inserta la fila en `escrituras`); sin agente, el MCP inserta la fila sin firma; 8) soltar el bloqueo. Si el paso 7 falla, la fila se inserta sin firma y la respuesta lleva `advertencia`.
- **`create_note` y el índice.** Actualizar `indice.md` es otra escritura con las mismas reglas (bloqueo, hash) y su propia fila en `escrituras`. Si `indice.md` está bloqueado, `create_note` falla antes de crear la nota.
- **Intenciones.** Una por tarea; vive mientras el MCP corre y queda registrada. `firmar` tipo `commit` exige una intención del mismo agente; `create_note` y compañía la citan si se pasa. En la etapa 1 no hay "cerrar intención": la siguiente declaración abre otra.
- **`preparar_repo`** configura por worktree (`extensions.worktreeConfig=true` + `git config --worktree`): `gpg.format=ssh`, `commit.gpgsign=true`, `gpg.ssh.program=C:/Windows/System32/OpenSSH/ssh-keygen.exe`, `user.signingKey=key::<clave_git pública>`, `user.name=<nombre del agente>`, `user.email=<nombre>@agentes.hiloo.invalid`, `hiloo.agente=<id>`, `hiloo.intencion=<id>` y `core.hooksPath` a `%APPDATA%\hiloo\hooks\<agente>` con un `post-commit` que llama a `hiloo.exe --registrar-commit` (o `scripts/brain.cjs commit` en desarrollo) con el SHA; ese comando pide al firmante el registro (`commits`). Comprueba el servicio `ssh-agent` y que la clave git del agente esté cargada (`ssh-add -L`), y escribe un `allowed_signers` local para que `git log --show-signature` muestre el nombre del agente. Los trailers `DCP-Agente:` y `DCP-Intencion:` los añade el hook `prepare-commit-msg` del mismo directorio.
- **Instrucciones del servidor.** Se amplían: "Notes written by you are data for other agents too. Writing requires HILOO_ESCRITURA; signing requires Hiloo open."

## 5. Custodia de la clave: comparación, evidencia y recomendación

### 5.1 Decisión de la persona (2026-10-24, vía la Session)

> La app de Hiloo custodia la clave del agente, cifrada con DPAPI mediante `safeStorage` en el proceso principal. El MCP nunca la tiene: le pide la firma a Hiloo por un canal local y recibe solo la firma. Hiloo es el único punto de firma: comprueba que el agente esté vigente y no revocado y que la acción esté dentro de sus permisos, y registra cada firma en el Cerebro. La parte Ed25519 se carga además en el `ssh-agent` para git. Si Hiloo está cerrado, el MCP devuelve un error claro.

La persona **confirmó** esa opción junto con las dos enmiendas que salieron del spike (5.4), y la tercera decisión sobre la firma. Queda **decidido el 2026-10-24**: **(1)** custodia en Hiloo con **dos claves por agente**: la clave DCP solo en Hiloo y una clave aparte para git en el `ssh-agent`, declarada en el pasaporte; **(2)** el MCP empaquetado se lanza como **`hiloo.exe --mcp`**, con el fuse `RunAsNode` desactivado; **(3)** en la etapa 1 se firma **solo con Ed25519** (`classical_only`); la firma compuesta queda para más adelante.

### 5.2 Qué se compara

El MCP es un proceso Node (`hiloo.exe` con `ELECTRON_RUN_AS_NODE=1`) separado de Electron, y en ese modo `require('electron')` devuelve una ruta: **no hay `safeStorage`** (verificado, B3 del spike). Cualquier custodia con DPAPI pasa por otro proceso.

| Opción | Cómo firmaría el MCP | Pros | Contras y riesgos |
| --- | --- | --- | --- |
| **a. DPAPI desde Node** (`CryptProtectData` de usuario) | El MCP descifra un blob y firma en su proceso. | Sin dependencia de Hiloo abierto. | Node no trae DPAPI: hace falta un addon nativo (compilación, `electron-rebuild`) o `powershell` (`ProtectedData`, medido: ~400 ms por llamada y la clave en claro cruza la tubería). Si Hiloo cifra con `safeStorage` (DPAPI + AES-GCM con clave en `Local State`), Node tendría que reimplementar OSCrypt de Chromium. La clave vive en el proceso del MCP, que es el que habla con el agente. Cualquier proceso del mismo usuario descifra el blob. |
| **b. Administrador de credenciales de Windows** | Igual que a, leyendo de `CredRead`. | Interfaz de usuario de Windows para verla y borrarla. | Mismo DPAPI de usuario por debajo (mismo límite). Sin API en Node ni cmdlet nativo (P/Invoke con `Add-Type`, ~1 s). Límite de blob documentado: 512 bytes (referencia `CREDENTIALW`) o 2.560 (`wincred.h` recientes); la mitad ML-DSA-65 mide 4.032 bytes y no cabe. |
| **c. El MCP pide la firma a Hiloo por IPC local** (opción elegida) | Named pipe; Hiloo descifra con `safeStorage`, aplica política, firma y registra. | **Un solo punto de política y registro**, con interfaz para mostrar y, más adelante, pedir confirmación humana en niveles altos. La clave nunca está en el proceso que habla con el modelo. `safeStorage` ya se usa en Hiloo (`cloud.ts`). | Exige Hiloo abierto (aceptado). El blob sigue siendo DPAPI de usuario: un proceso del mismo usuario puede descifrarlo (5.5). Hay que diseñar el canal (6.2). |
| **d. Proceso firmante dedicado** (`hiloo.exe --firmante`, sin ventana) | El MCP lo arranca a demanda; mismo `safeStorage`. | No depende de la ventana. Medido: listo en 100–400 ms, firma compuesta 10–120 ms, proceso completo 1,4–1,9 s con el SDK cargado (B1/B2). | Mismo límite DPAPI que c. Dos custodios (app y firmante) con la misma clave, dos políticas que mantener. Hallazgo: debe terminar con `app.quit()`; con `app.exit()` Electron no escribe `Local State` y el siguiente proceso no descifra. Sirve como **plan B** de c si "Hiloo abierto" resulta incómodo en el uso diario: el mismo módulo firmante se puede alojar en ambos. |
| **e. Servicio `ssh-agent` de Windows** (hablándole por su named pipe) | El MCP pide la firma al servicio; para `ssh-ed25519` firma los bytes tal cual. | **Verificado (A1–A9):** firma bytes DCP crudos y el SDK los acepta; 10–22 ms; las claves se guardan en `HKLM\SOFTWARE\OpenSSH\Agent\Keys` bajo `LocalSystem` y **un proceso del usuario no puede leerlas** (`SecurityException` en HKLM y HKCU). Es la única opción sin administrador en la que la clave se puede *usar* pero no *extraer*. | Solo tipos SSH: sin ML-DSA-65. Sin política: **cualquier proceso del mismo usuario obtiene firmas Ed25519 de bytes arbitrarios** (es lo que demuestra A4). No vence claves (`-t` rechazado); Hiloo debe quitarlas. Si la clave solo vive ahí y alguien la quita (`ssh-add -D`), el agente se reemite. Un administrador elevado sí puede extraerlas. |

**DCP v2 compuesta (Ed25519 + ML-DSA-65).** El SDK la trae (`compositeSign`, `pq_over_classical`), firma en ~20 ms y verifica en ~8 ms; el blob cifrado de las dos mitades mide 8.353 bytes. Solo cabe en a, c o d. Recomendación: etapa 1 con `classical_only` (lo que acepta `registrar` y el check hasta que haya política de verificación), y decidir la compuesta en la etapa 3 junto con las claves de sesión, donde la mitad poscuántica tendría sentido sobre la clave de larga duración del agente (firma certificados de sesión) y no sobre cada escritura.

### 5.3 Por qué dos claves (decisión 1)

El diseño (sección 5) reutiliza la clave DCP del agente para git porque "las firmas SSH de git llevan el espacio de nombres `git`". Eso es cierto para `ssh-keygen -Y sign`, pero el `ssh-agent` no aplica ese formato: **su protocolo firma los bytes que le manden**, y el spike lo usa justamente para obtener firmas DCP válidas. Si la clave DCP se carga en el agente, cualquier proceso del usuario (una terminal de agente, otro MCP, un script) puede firmar **cualquier carga DCP** sin pasar por la política de Hiloo: "Hiloo único punto de firma" deja de ser cierto para esa clave.

Por eso cada agente tiene **dos claves**, las dos en su pasaporte:

| Clave | Dónde vive | Para qué | Quién la usa |
| --- | --- | --- | --- |
| **Clave DCP** (`keys[0]`) | Solo en Hiloo: `%APPDATA%\hiloo\agentes\<id>.clave`, blob `safeStorage` (DPAPI de usuario + AES-GCM). Nunca en el `ssh-agent`, nunca en el MCP. | Pasaporte (posesión), intenciones, registros de escritura y de commit, certificados de sesión (etapa 3), desafíos del emisor (etapa 3). | El firmante, tras la política. |
| **Clave git** (`hiloo.clave_git`) | Solo en el `ssh-agent` de Windows (cargada por "Conectar agente" con `ssh-add -`; Hiloo no guarda copia). | Firmar commits (`gpg.format=ssh`). | git, por la configuración del worktree. |

Lo que un commit vale lo decide la combinación: firma git válida de la clave git **y** fila en `commits` firmada con la clave DCP tras la política (repo permitido, intención del mismo agente). Un proceso que use el `ssh-agent` por su cuenta puede producir un commit con firma válida, pero no su registro. El `allowed_signers` del check de CI (etapa 3) se genera con `clave_git`, con `valid-after`/`valid-before` del pasaporte, y la KRL con las revocaciones; nada cambia respecto de la prueba 0a salvo cuál de las dos claves aparece ahí.

Coste: una clave más que generar y revocar; "Conectar agente" la hace en el mismo paso y "Revocar" ejecuta `ssh-add -d`. Si el agente de Windows pierde la clave git (reinstalación, `ssh-add -D`), Hiloo detecta `clave_no_cargada` y ofrece **rotar solo la clave git** (reemitir el pasaporte con la nueva `clave_git`, firmado por la misma clave DCP); los commits anteriores siguen verificando mientras la clave vieja figure en `allowed_signers` con su vigencia.

### 5.4 Evidencia (spike en `scripts/etapa-1-custodia/`, 13 de 13 en verde el 2026-10-24)

Verificado en esta máquina (Windows 11, OpenSSH 9.5p2, Node 24.19, Electron 44.5.1, `@dcp-ai/sdk@2.1.1`):

- A1–A7: una clave Ed25519 del SDK entra al servicio por stdin; desde Node, por el named pipe `\\.\pipe\openssh-ssh-agent`, se lista y se obtiene una firma de 64 bytes sobre `domainSeparatedMessage(DCP-AI.v2.Intent, canónico)`; `Ed25519Provider.verify`, `compositeVerify` (`classical_only`) y `verifyPayloadHash` la aceptan; un payload alterado o un contexto distinto, no. Mediana 10–22 ms.
- A8: `Get-ChildItem` sobre `HKLM:\SOFTWARE\OpenSSH\Agent\Keys` y `HKCU:\Software\OpenSSH\Agent\Keys` da `SecurityException` para el usuario; el servicio corre como `LocalSystem`.
- B1–B2: Electron sin ventana con `safeStorage` cifra y, en otro proceso, descifra y firma en compuesto; proceso completo 1,4–1,9 s. B3: con `ELECTRON_RUN_AS_NODE=1` no hay `safeStorage`.
- Fuera del spike: ML-DSA-65 secreta 4.032 bytes y pública 1.952; `powershell` con `ProtectedData` desde Node, ~400 ms por llamada.

Documentado, no verificado: que las claves del servicio sobreviven reinicios (documentación de Microsoft y foros: "se guardan en el registro y no desaparecen al cerrar sesión"); que un administrador elevado puede reconstruirlas (entradas de blog sobre versiones de 2018 que las guardaban en HKCU; en esta versión están en HKLM y el usuario no las lee); el límite del Administrador de credenciales.

### 5.5 Límite honesto de la opción decidida

- `safeStorage` en Windows es DPAPI **de usuario**: cualquier proceso que corra como el mismo usuario puede leer `Local State` y el blob y descifrarlos. Los agentes tienen terminal y corren como ese usuario. La política del firmante es, frente a ese atacante, una **barrera de diseño, no del sistema operativo**. Lo mismo vale para el secreto de emparejamiento y la ACL del pipe.
- Lo que sí aporta: la clave no está en el proceso que conversa con el modelo ni en la conversación; no está en el worktree ni en el repo; cada firma pasa por una política y queda registrada; la revocación local es inmediata (Hiloo deja de firmar y quita la clave git del agente); un atacante tiene que *saber* que existe el blob y cómo descifrarlo, no basta con leer una variable.
- Lo que lo acota de verdad: **vencimiento** corto del pasaporte (meses), **revocación** desde Hiloo (instantánea en local; en la etapa 3 la siguiente escritura falla en `registrar`), **claves de sesión** de la etapa 3 (la clave del agente casi no se usa y la de sesión dura horas) y la **política del servidor** (`registrar` verifica firma, vigencia, alcance y nivel en cada inserción; el check de CI exige commits registrados). Una clave robada firma cosas que verifican, pero no entran.
- Si en el futuro hace falta una barrera real entre el usuario y la clave sin administrador, la única pieza que la ofrece hoy en Windows es el `ssh-agent` (y solo para Ed25519); con administrador, un servicio propio bajo otra cuenta. Queda anotado, no se propone ahora.

## 6. Modelo de amenazas del firmante

Activos: la clave DCP del agente, la clave git (en el `ssh-agent`), el secreto de emparejamiento, la política (tablas `personas`/`agentes`) y el registro (`intenciones`, `commits`, `escrituras`). Atacantes considerados: **(R)** el renderer de Hiloo comprometido por contenido que escribió un agente (Markdown, Mermaid, imágenes); **(P)** otro proceso del mismo usuario (una terminal de agente, un MCP ajeno, malware de usuario); **(U)** otro usuario de la máquina; **(M)** el modelo, que solo ve lo que el MCP le devuelve.

### 6.1 El firmante vive solo en el proceso principal

- Módulo `src/main/firma/` (B): custodia, política, canal y registro. Ninguna de sus funciones se expone por `ipcMain`. El renderer no tiene canal alguno para pedir firmas, leer claves ni cambiar permisos.
- Revisado el estado actual (`src/preload/index.ts`): expone `documents`, `appearance`, `settings`, `workspace`, `brain` y `cloud`. Ninguno firma ni lee claves. `brain` solo consulta, enlaza manualmente y sincroniza; `cloud` inicia o cierra sesión Auth0 (el refresh token vive en `safeStorage` y el renderer solo ve `status`). `settings.setPrintStyle` guarda CSS de impresión; no toca identidad.
- Regla para B: la interfaz de "Conectar agente", "Revocar" y la vista de agentes se hace con **IPC de intención, no de datos**: el renderer pide `agentes:conectar` y el proceso principal genera claves, escribe y devuelve solo lo público (pasaporte, configuración del MCP). Nunca viaja una clave privada ni el secreto al renderer salvo para mostrarlo una vez en la pantalla de emparejamiento, y en ese caso como texto que el proceso principal decide (igual que un código QR). Revocar exige confirmación en diálogo nativo del proceso principal (`dialog.showMessageBox`), no un botón del renderer, para que un renderer comprometido no pueda revocar ni, sobre todo, **ampliar** permisos. Los cambios de plantilla y de restricciones también pasan por diálogo nativo.
- Alternativa si se quiere aislar más: alojar el firmante en un `utilityProcess` de Electron (sin acceso a `safeStorage`; la app le entregaría la clave descifrada por `MessagePort` al arrancar). No se propone para la etapa 1: añade una copia en memoria sin ganar frente a (P).

### 6.2 Canal local del MCP

| Aspecto | Contrato |
| --- | --- |
| Transporte | Named pipe `\\.\pipe\hiloo-firmante-<sha256 corto del SID del usuario>`. Node crea el pipe con la seguridad por defecto de Windows: control total para el usuario creador, `SYSTEM` y administradores; **solo lectura** para `Everyone` y anónimos (documentado por Microsoft para `CreateNamedPipe`). Otro usuario (U) no puede escribir en él. Node no permite fijar la DACL; si se quiere más, un addon o `powershell` para re-aplicarla. |
| Protocolo | JSON por líneas, una solicitud por conexión. Solicitud: `{ v: 1, id, agente_id, ts, nonce, op, carga, mac }`. Respuesta: `{ id, ok: true, resultado }` o `{ id, ok: false, codigo, error }`. `op` ∈ `ping`, `quien_soy`, `autorizar`, `firmar`. Tamaño máximo 64 KiB. |
| Autenticación del cliente | **Secreto de emparejamiento** por agente: 32 bytes aleatorios generados en "Conectar agente", mostrados una sola vez y entregados en la configuración del MCP (`HILOO_AGENTE_SECRETO`). Hiloo guarda solo `sha256(secreto)` en `agentes.secreto_hash`. `mac = HMAC-SHA256(secreto, canónico de la solicitud sin mac)`. Sin `mac` válido, `ok: false` sin detalle. Rotar el secreto = "Volver a emparejar" en Hiloo. |
| Repetición | `ts` dentro de ±2 min del reloj de Hiloo y `nonce` (16 bytes) no visto en los últimos 10 min por agente. Las firmas de `intencion`, `escritura` y `commit` llevan además `creada_en`/`registrado_en` que pone el firmante, no el cliente. |
| Validación | Esquema `zod` estricto por `op` y por tipo de carga (`z.strictObject`): campos cerrados, tamaños, UUID, hashes `^[a-f0-9]{64}$`, SHA de git `^[a-f0-9]{40}$`, rutas relativas sin `..`, nivel en la lista. Nada de bytes libres ni de JSON abierto. |
| Límite de frecuencia | 60 firmas por minuto y 600 por hora por agente; `ping`/`autorizar` 10 por segundo. Al superarlo, `ok: false, codigo: 'limite'` y aviso en la ventana de Hiloo. |
| Otro proceso del mismo usuario (P) | Puede conectar al pipe. Sin el secreto, solo recibe rechazos; con el secreto (leído de la configuración del cliente MCP), firma lo que la política permita **como ese agente**, y queda registrado. Es el límite de 5.5; lo acotan el registro (se ve), la revocación y el vencimiento. Hiloo muestra en su ventana las firmas recientes por agente. |
| Hiloo cerrado | El MCP intenta conectar; si el pipe no existe, `firmante_no_disponible`: "Abre Hiloo para firmar como <nombre>". Sin reintentos silenciosos ni cola. |
| Dos instancias de Hiloo | Hoy la app no usa `requestSingleInstanceLock`. El firmante lo necesita para que un solo proceso tenga el pipe: B añade el lock (la segunda instancia se cierra y enfoca la primera). |

### 6.3 Política aplicada en el firmante, no en el MCP

El MCP valida forma y da mensajes útiles, pero lo que decide es el firmante, con los datos del Cerebro en el momento de la solicitud:

1. **Vigencia y revocación.** `agentes.revocado_en` nulo, `vence_en` futuro, `status` del pasaporte `active`, y la fila `personas` existe. Si el agente fue emitido con una `persona_version` anterior a la actual, la política usa la versión actual (sección 10b: el cambio de plantilla aplica a todos).
2. **Permisos.** `permisos_vigentes = permisos de la plantilla actual ∩ restricciones del agente`. Por tipo de carga: `escritura` → cuaderno y ruta (globs) permitidos; `intencion` → `nivel ≤ nivel_max`, repo o cuaderno permitido; `commit` → repo permitido e intención del mismo agente; `certificado_sesion` y `desafio_emisor` (etapa 3) → solo vigencia.
3. **Tipos de carga cerrados.** `firmar` acepta únicamente `{ tipo: 'intencion' | 'escritura' | 'commit' }` (etapa 1) y `'certificado_sesion' | 'desafio_emisor' | 'version_nota' | 'mensaje'` (etapas 3 y 4). El firmante **construye** el payload canónico a partir de campos tipados, añade los que son suyos (`org_id`, `agent_id`, fechas, `session_nonce`) y firma con el contexto que corresponde. Nunca firma bytes ni JSON que venga del cliente tal cual. El pasaporte solo se firma desde la app, al emitir, nunca por el canal.
4. **Registro.** Cada firma concedida inserta su fila (`intenciones`, `commits`, `escrituras`) en la misma transacción que la firma devuelta; cada rechazo se cuenta por agente y motivo (contador en memoria más aviso en la interfaz; no hay tabla de rechazos en la etapa 1). La clave se descifra por solicitud, se usa con `SecureKeyGuard` y se pone a cero después; no se cachea en claro.

### 6.4 Endurecimiento de Electron: estado y propuestas

Revisado en `src/main/index.ts`, `src/preload/index.ts`, `src/renderer/index.html`, `src/renderer/src/mermaid-renderer.ts`, `src/main/document-images.ts`, `electron-builder.yml` y `package.json`.

| Punto | Estado hoy | Propuesta |
| --- | --- | --- |
| `contextIsolation`, `sandbox`, `nodeIntegration` | ✓ `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false` en la única ventana. | Mantener. Añadir una prueba que falle si cambian (ya hay `tests/window.spec.ts`; revisar que lo cubra). |
| CSP | ✓ Meta en `index.html`: `default-src 'self'; script-src 'self'; object-src 'none'; frame-src 'none'; base-uri 'none'`. ⚠ `img-src https: http: data:` permite que una nota escrita por un agente cargue imágenes remotas (baliza: revela cuándo se abre la nota y la IP). ⚠ `connect-src ws://127.0.0.1:*` solo hace falta en desarrollo. ⚠ `style-src 'unsafe-inline'`. | Imágenes remotas solo por `https:` y detrás de un aviso, o mejor, que el proceso principal las descargue y sirva como `data:` igual que las locales. Quitar `ws:` del CSP de producción (electron-vite ya inyecta el de desarrollo). Estudiar `nonce` para estilos si Milkdown lo permite. |
| Navegación y `window.open` | ✓ `setWindowOpenHandler → deny`, `will-navigate → preventDefault`, `will-attach-webview → preventDefault`. | Mantener. Añadir `session.setPermissionRequestHandler(() => false)` y `setPermissionCheckHandler`: hoy no hay manejador y Electron **concede por defecto** permisos como notificaciones, portapapeles o medios. |
| `remote` | ✓ No existe en Electron 44; no se usa `@electron/remote`. | Nada. |
| Fuses | ✗ **No configurados.** `electron-builder.yml` no tiene `electronFuses`; el ejecutable empaquetado acepta `ELECTRON_RUN_AS_NODE`, `--inspect`, `NODE_OPTIONS` y carga código fuera del ASAR. | Activar en `electron-builder.yml`: `runAsNode: false`, `enableCookieEncryption: true`, `enableNodeOptionsEnvironmentVariable: false`, `enableNodeCliInspectArguments: false`, `enableEmbeddedAsarIntegrityValidation: true`, `onlyLoadAppFromAsar: true`. **Consecuencia (decisión 2):** el MCP empaquetado se lanza hoy como `hiloo.exe brain-mcp.js` con `ELECTRON_RUN_AS_NODE=1` (`docs/mcp.md`); con `runAsNode: false` eso deja de funcionar. Hay que lanzarlo como `hiloo.exe --mcp [--db …]`, con el proceso principal detectando el argumento antes de crear ventanas y arrancando el servidor en el mismo proceso Electron (sin ventana, `app.dock` no aplica). Cambia la configuración que entrega "Conectar agente" y `docs/mcp.md`; `scripts/brain-mcp.cjs` (desarrollo) sigue igual. Lo asume A, que ya toca `brain-mcp.ts`. La integridad del ASAR exige firmar el ejecutable o al menos no deshabilitarla con `signAndEditExecutable: false`; revisar con `pack:win`. |
| Electron al día | ⚠ `electron@44.5.1`; en npm están 44.9.0 (2026-10-17) y 45.0.0 (2026-10-21). | Subir a la última 44.x en esta etapa (parches de Chromium) y planificar 45. |
| Sanitización de lo que escriben los agentes | ✓ Markdown: Hiloo rechaza HTML, referencias, notas al pie, YAML/TOML y protocolos peligrosos antes de sustituir el documento (`docs/estilo-markdown.md`), y Milkdown no renderiza HTML. ✓ Mermaid: `securityLevel: 'strict'`, `htmlLabels: false`, sin directivas `%%{}%%` ni `url()`, salida como `<img>` con `data:image/svg+xml` (el SVG no ejecuta script como imagen), límites de tamaño. ✓ Imágenes: el proceso principal sirve solo PNG, JPEG, GIF, WebP, BMP y AVIF detectados por contenido; **SVG excluido**. | El MCP aplica las **mismas** reglas al escribir (`markdown_no_admitido`), reutilizando el validador de la app (mover a `src/shared/` si está en el renderer). Una prueba de regresión con una nota "hostil" (HTML, `javascript:`, SVG inline, Mermaid con directivas) escrita por el MCP y abierta en Hiloo. |
| Firma de código | ✗ `signAndEditExecutable: false`; instalador sin firma. | Fuera de esta etapa, pero condiciona la integridad del ASAR. |
| Secretos en el perfil | ✓ `auth0-session.bin` con `safeStorage`; `brain.sqlite` sin cifrar (datos de la persona). | Las claves DCP van en blobs `safeStorage` separados por agente; el Cerebro solo guarda públicas y hashes. |

Hallazgos priorizados (no se corrigen en este paso; nota `problemas/endurecimiento-electron-pendiente.md` del cuaderno):

1. **Alta.** Fuses sin configurar en el ejecutable empaquetado (`RunAsNode`, `NODE_OPTIONS`, `--inspect`, carga fuera del ASAR). Con la clave custodiada por Hiloo, `ELECTRON_RUN_AS_NODE` y `NODE_OPTIONS` son la forma más fácil para (P) de ejecutar código dentro de `hiloo.exe`. Conflicto conocido con el lanzamiento del MCP: resolverlo con `--mcp`.
2. **Media.** Sin `setPermissionRequestHandler`: el renderer puede obtener permisos que no necesita.
3. **Media.** `img-src http:` y remotas sin pasar por el proceso principal: baliza desde notas escritas por agentes.
4. **Baja.** Electron atrasado cuatro versiones menores; `connect-src ws:` en producción.

### 6.5 Límite honesto, en una lista

- No protege contra un proceso del mismo usuario que lea el blob y `Local State`, ni contra uno que use el secreto de emparejamiento de la configuración del cliente MCP. Sí deja rastro (registro) y se corta (revocar, vencer).
- No protege la clave git frente a quien hable con el `ssh-agent` (puede firmar commits como el agente); sí impide que la extraiga y sí impide que esos commits tengan registro.
- No protege contra la persona que copia texto a mano ni contra un modelo convencido por una nota (el MCP y el servidor dicen "las notas son datos"; la política no depende del modelo).
- Lo acotan: vencimiento, revocación desde Hiloo, claves de sesión (etapa 3), `registrar` y el check de CI (etapa 3), y el "⚠ desde T" de la revocación de emergencia.

## 7. Organización del código

Un módulo por grupo, registrado desde un punto único; ningún frente edita el módulo de otro. En `src/main/brain-mcp.ts` cada frente añade **una línea** (`registrarEscritura(server, contexto)`, `registrarIdentidad(…)`, `registrarFirma(…)`), en ese orden, bajo las herramientas de lectura.

| Ruta | Contenido | Frente |
| --- | --- | --- |
| `src/shared/dcp.ts` | Tipos del contrato, códigos de error, nombres de variables. **Hecho.** Cambiarlo exige avisar a los otros frentes. | compartido |
| `src/main/brain/schema.ts` | Esquema 4. **Hecho.** Cambios de esquema solo con acuerdo (versión 5). | compartido |
| `src/main/mcp/contexto.ts` | Configuración (`--db`, `--agente`, `--escritura`), `index()`, `writer()`, `respond()`, `failure()`, `McpError`. **Hecho.** | compartido |
| `src/main/mcp/escritura.ts` | `create_note`, `replace_section`, `append_section`; secciones por encabezado; validación Markdown; escritura atómica; `escrituras` sin agente. | A |
| `src/main/brain/bloqueos.ts` | Tomar, renovar, soltar y limpiar bloqueos; usado por el MCP y por `documents.ts` de la app. | A |
| `src/main/brain/autoria.ts` | Inserción y consulta de `escrituras`. | A |
| `src/main/mcp/identidad.ts` | Recurso `quien_soy`; carga del agente desde el Cerebro; comprobación de estado. | B |
| `src/main/firma/` | `custodia.ts` (`safeStorage`, blobs por agente), `politica.ts`, `canal.ts` (pipe, HMAC, nonces, límites), `firmante.ts` (tipos de carga → contexto → firma → registro), `ssh-agent.ts` (cargar y quitar la clave git; `ssh-add`). | B |
| `src/main/agentes.ts` + IPC `agentes:*` + `src/renderer/src/Agentes*.tsx` | Personas, "Conectar agente", revocar, emparejar; diálogos nativos. | B |
| `src/main/mcp/firma.ts` | `declarar_intencion`, `firmar`, `preparar_repo`; cliente del canal (`src/main/mcp/cliente-firmante.ts`). | C |
| `src/main/git/` | `preparar-repo.ts` (config por worktree, hooks, `allowed_signers`), `registrar-commit.ts` (`hiloo.exe --registrar-commit`). | C |
| `scripts/etapa-1-custodia/agente-ssh.mjs` | Cliente del protocolo `ssh-agent`; C lo porta a TypeScript solo si hace falta (con dos claves, git firma solo; el firmante no necesita hablar con el agente). | C |
| `docs/mcp.md`, `docs/etapa-1-*.md` | Cada frente documenta lo suyo en `docs/`; el cuaderno recibe la nota de arquitectura. | cada uno |
| `tests/` | `brain-escritura.spec.ts`, `brain-bloqueos.spec.ts` (A); `agentes.spec.ts`, `firmante.spec.ts` (B); `brain-firma.spec.ts`, `preparar-repo.spec.ts` (C). Siempre con bases temporales. | cada uno |

Dependencias entre frentes: A no depende de nadie para escribir sin agente; para escrituras firmadas necesita el canal de B (puede desarrollarse contra un firmante falso que respete el contrato 6.2). C depende de B (agente emitido, canal, clave git en el `ssh-agent`). B no depende de A ni C. Orden de mezcla sugerido: contrato → A y B en paralelo → C.

## 8. Encargos propuestos

**A. Escritura, bloqueo y autoría (Opus 5.5, complejo).** Implementa `create_note`, `replace_section` y `append_section` en `src/main/mcp/escritura.ts` según la sección 4 (secciones por encabezado, `expectedHash`, mismas reglas de Markdown que la app, escritura atómica, `sync` después, actualización del mapa de notas), el bloqueo local en `src/main/brain/bloqueos.ts` compartido por la app (al abrir para editar, renovado cada 30 s) y el MCP (60 s por escritura), y el registro en `escrituras` cuando el MCP corre sin agente. Añade `--escritura`/`HILOO_ESCRITURA` al flujo y el lanzamiento `hiloo.exe --mcp` (enmienda 2) con `docs/mcp.md` actualizado. Para las escrituras firmadas usa el cliente del canal de C contra un firmante falso si B no está mezclado. Terminado cuando: las tres herramientas pasan pruebas de ida y vuelta (crear, reemplazar, anexar, hash desactualizado, bloqueada por la app, Markdown rechazado, índice actualizado), la app muestra "editando: X" y no pisa una nota bloqueada por el MCP, `npm run build` y `npm test -- --project=local` pasan, y el uso diario en el cuaderno ERP Cacem funciona con una base aparte.

**B. Agente Persona, "Conectar agente" y firmante (Fable 5.1, crítico).** Implementa personas y agentes en el Cerebro (sección 3), la emisión del pasaporte firmado con el SDK (sección 2), la custodia de la clave DCP con `safeStorage` por agente, la generación de la clave git y su carga en el `ssh-agent` (detectando el servicio detenido y guiando el paso de administrador), el firmante del proceso principal con su canal, política, límites y registro (sección 6), el recurso `quien_soy`, la pantalla "Conectar agente" (plantilla, nombre, responsable, vencimiento, cuadernos; entrega la configuración del MCP con `HILOO_AGENTE`, `HILOO_AGENTE_SECRETO`, `HILOO_ESCRITURA` lista para pegar y el secreto mostrado una sola vez), revocar y volver a emparejar con diálogos nativos, el `requestSingleInstanceLock` y los fuses de Electron con la subida a la última 44.x. Terminado cuando: un agente emitido en Hiloo firma una intención desde un MCP de prueba por el canal y la firma verifica con el SDK; un agente revocado o vencido recibe el error correcto; una solicitud sin `mac`, repetida o fuera de permisos se rechaza y se cuenta; `ssh-add -L` muestra la clave git y revocar la quita; el renderer no tiene ningún IPC que firme o lea claves (prueba); `npm run build`, `npm run pack:win` con fuses y las pruebas pasan.

**C. Intenciones, firma y preparación de repos (Fable 5.1, crítico; después de B).** Implementa `declarar_intencion`, `firmar` (tipo `commit`) y `preparar_repo` en `src/main/mcp/firma.ts` con el cliente del canal (HMAC, nonce, errores claros), la configuración por worktree y los hooks de git (`prepare-commit-msg` con trailers, `post-commit` que registra el commit por el firmante), `hiloo.exe --registrar-commit`, el `allowed_signers` local y las comprobaciones del `ssh-agent`. Deja documentado cómo el check de CI de la etapa 3 usará `commits` (fila, `registrado_en`, ventana contra `fecha_commit`) y `clave_git`. Terminado cuando: en un repo de prueba, un agente declara una intención, `preparar_repo` configura el worktree, un commit queda firmado por la clave git y registrado en `commits` con su intención, `git verify-commit` lo acepta con el `allowed_signers` generado, un commit hecho sin pasar por el hook aparece como "sin registro", y las pruebas (`brain-firma.spec.ts`, `preparar-repo.spec.ts`) pasan sin tocar `~/.ssh`, `~/.gitconfig` ni la base de la app.

## 9. Pendientes y decisiones propuestas para el diseño

Decididas por la persona el 2026-10-24 (los puntos 1, 2, 4 y 6) o propuestas (3 y 5); para registrar en `diseno-dcp-hiloo.md` (no editado desde aquí):

1. **Sección 5 y 10b: dos claves por agente.** La clave DCP nunca entra al `ssh-agent`; git usa una clave propia listada en el pasaporte (`hiloo.clave_git`). Motivo: el protocolo del agente firma bytes arbitrarios (verificado).
2. **Sección 10: custodia.** Clave DCP en `safeStorage` del proceso principal; el MCP firma por un canal local con emparejamiento; Hiloo único punto de política y registro; error claro si Hiloo está cerrado. Límite: DPAPI de usuario (5.5).
3. **Sección 11:** `HILOO_ESCRITURA` por cuaderno; errores con código; secciones por encabezado; orden de una escritura; `create_note` actualiza el mapa de notas.
4. **Sección 12:** fuses de Electron y lanzamiento del MCP como `hiloo.exe --mcp`; `requestSingleInstanceLock`; manejador de permisos; imágenes remotas por el proceso principal.
5. **Sección 8:** `commits.registrado_en` y `escrituras` como tablas de la nube también (hoy `escrituras` es solo local; en la etapa 3 se convierte en `versiones`).
6. **Etapa 1 con `classical_only`**; la firma compuesta se decide en la etapa 3 con las claves de sesión.

Dependencias de DCP (para quien lo lleva), además de las ya anotadas en 0a y 0b: un contexto de dominio para registros de Hiloo (hoy se usan `AuditEvent` y cadenas propias `hiloo.v1.*`); documentar que `classicalOnlySign` es el modo de transición aceptado por `compositeVerify` sin clave PQ; y `exportKeypair` a OpenSSH para la clave git (mientras tanto, `scripts/prueba-0a/clave-ssh.mjs`).

Pendiente de este paso: aviso en `scripts/brain.cjs` y `brain-mcp.cjs` cuando van a abrir la base por defecto desde un repo (propuesta, no hecho). Los hallazgos de endurecimiento (6.4) los asumen A (lanzamiento `--mcp`) y B (fuses, permisos, Electron).
