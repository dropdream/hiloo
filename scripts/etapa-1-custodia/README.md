# Spike de custodia: firmar DCP sin exponer la clave del agente

Prueba mínima de la decisión de custodia de la etapa 1 (`docs/etapa-1-contrato.md`, sección "Custodia de la clave"). Responde dos preguntas con código que corre en esta máquina:

- **A.** ¿El servicio `ssh-agent` de Windows puede firmar artefactos DCP (bytes crudos con separación de dominio), no solo commits de git? Si sí, la mitad Ed25519 de la clave del agente puede vivir solo ahí, y el MCP (un proceso Node) firma pidiéndoselo por su named pipe, sin tener nunca la clave privada.
- **B.** Si hace falta la mitad poscuántica (ML-DSA-65, firma compuesta DCP v2), ¿sirve un proceso firmante dedicado hecho con Electron sin ventana y `safeStorage` (DPAPI)? ¿Cuánto cuesta arrancarlo?

No toca `~/.ssh`, la configuración de git ni la base de Cerebro. Carga una clave temporal en el `ssh-agent` de Windows y la quita al terminar (`ssh-add -d`); comprueba que `ssh-add -L` ya no la lista.

## Uso

Desde la raíz del repo, con Node 22+ y el servicio `ssh-agent` en marcha (`Get-Service ssh-agent`):

```powershell
node scripts/etapa-1-custodia/spike-custodia.mjs
node scripts/etapa-1-custodia/spike-custodia.mjs --firmas 50 --sandbox C:\temp\custodia
```

Instala `@dcp-ai/sdk@2.1.1` en la sandbox (`.verification/etapa-1-custodia`, ignorada por git), igual que la prueba 0a. Código de salida 0 si todo da ✓. El informe queda en `<sandbox>/informe.md`.

## Qué comprueba

| Id | Comprobación | Resultado 2026-10-24 |
| --- | --- | --- |
| A0 | El servicio `ssh-agent` está en marcha | ✓ |
| A1 | La clave Ed25519 del SDK de DCP entra al agente por stdin, sin escribir la privada | ✓ |
| A2 | El protocolo del agente (`\\.\pipe\openssh-ssh-agent`) lista la identidad desde Node, sin `ssh-keygen` | ✓ |
| A3 | La pública que publica el agente es la del SDK | ✓ |
| A4 | El agente firma los bytes DCP crudos (`domainSeparatedMessage`) y `Ed25519Provider.verify` del SDK acepta la firma | ✓ (10–20 ms) |
| A5 | Empaquetada como `SignedPayload` con `CompositeSignature` `classical_only`, `compositeVerify` y `verifyPayloadHash` la aceptan; el `kid` coincide con `deriveKid` | ✓ |
| A6 | Un payload alterado o un contexto DCP distinto no verifican | ✓ |
| A7 | 20 firmas seguidas por el pipe | ✓ (mediana 10–22 ms) |
| A8 | Un proceso normal del usuario no puede leer las claves que guarda el servicio (`HKLM` y `HKCU\…\OpenSSH\Agent\Keys`: `SecurityException`; el servicio corre como `LocalSystem`) | ✓ |
| A9 | La clave temporal se quita del agente | ✓ |
| B1 | Electron sin ventana expone `safeStorage` y cifra las dos mitades (Ed25519 + ML-DSA-65; blob de 8.353 bytes) | ✓ (listo en 100–400 ms; proceso completo 1,4–1,9 s con la carga del SDK) |
| B2 | Un segundo proceso descifra el blob y firma en compuesto (`pq_over_classical`) | ✓ |
| B3 | Con `ELECTRON_RUN_AS_NODE=1` (como corre el MCP hoy) no existe `safeStorage` | ✓ (`require('electron')` es una ruta) |

## Hallazgos que importan al diseño

- **`ssh-agent` sí firma DCP crudo.** Para `ssh-ed25519` el agente firma los bytes tal cual (PureEdDSA), así que la firma de 64 bytes que devuelve es exactamente la que el SDK de DCP espera. Lo que no sirve es `ssh-keygen -Y sign` (formato SSHSIG con namespace y hash). Hablar el protocolo del agente son 80 líneas (`agente-ssh.mjs`).
- **Custodia real sin administrador.** Las claves del servicio no son legibles por procesos del usuario; se pueden *usar* pero no *extraer* sin elevación. Es más fuerte que DPAPI de usuario (`safeStorage`, Administrador de credenciales): ahí cualquier proceso del mismo usuario descifra.
- **`safeStorage` solo existe en un proceso Electron completo.** El MCP corre como Node (`ELECTRON_RUN_AS_NODE=1`), así que para DPAPI haría falta un proceso aparte (`hiloo.exe` sin ventana). Y ese proceso debe salir con `app.quit()`: con `app.exit()` Electron no llega a escribir `Local State`, donde guarda la clave DPAPI, y el siguiente proceso no puede descifrar (se vio en el spike).
- **ML-DSA-65 no cabe en el `ssh-agent`** (solo tipos SSH) ni en una credencial del Administrador de credenciales (su límite documentado es de 512 bytes en la referencia de `CREDENTIALW`, 2.560 en `wincred.h` recientes; la clave secreta mide 4.032 bytes y el blob cifrado 8.353).

## Archivos

- `agente-ssh.mjs`: cliente mínimo del protocolo `ssh-agent` (listar identidades, firmar) sobre el named pipe de Windows. Candidato a `src/main/firma/agente-ssh.ts` en el frente C.
- `firmante-electron.cjs`: firmante dedicado de prueba (Electron sin ventana, `safeStorage`, firma compuesta con el SDK).
- `spike-custodia.mjs`: el guion.

Los resultados y la recomendación están en `docs/etapa-1-contrato.md` y en la nota `arquitectura/etapa-1-contrato.md` del cuaderno Hiloo.
