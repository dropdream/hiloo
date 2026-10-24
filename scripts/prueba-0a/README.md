# Prueba 0a: commits firmados por un agente DCP

Demuestra de punta a punta, en local, la cadena de firma del diseño DCP + Hiloo:

1. una clave Ed25519 generada con `@dcp-ai/sdk` sirve como clave SSH;
2. cargada en un `ssh-agent`, firma un commit sin escribir la privada en disco;
3. `git verify-commit` la acepta con un `allowed_signers` con `valid-after` / `valid-before`;
4. rechaza otra clave, una vigencia vencida, un commit fechado fuera de vigencia y una clave revocada;
5. un certificado de sesión (`ssh-keygen -s`, `cert-authority`) verifica y deja de verificar al vencer o al revocarse.

Todo ocurre en un repo de prueba dentro de una sandbox. No toca `~/.gitconfig`, `~/.ssh` ni el repo de Hiloo.

## Uso

Desde la raíz del repo, en Windows con Node 22+ y Git for Windows:

```powershell
node scripts/prueba-0a/prueba-0a.mjs
```

Opciones:

| Opción | Valores | Qué hace |
| --- | --- | --- |
| `--agente` | `auto` (default), `windows`, `git`, `ninguno` | `windows`: servicio `ssh-agent` de Windows (requiere que esté corriendo; el script no lo habilita). `git`: arranca un `ssh-agent` temporal de Git for Windows y lo detiene al final. `ninguno`: sin agente, las privadas de prueba se escriben en la sandbox y se borran al terminar. `auto` elige `windows` si el servicio corre y, si no, `git`. |
| `--clave` | `sdk` (default), `ssh-keygen` | Origen de las claves del agente y de sesión. Con `sdk` instala `@dcp-ai/sdk@2.1.1` en la sandbox y convierte su clave con `clave-ssh.mjs`. Con `ssh-keygen` se salta el SDK (camino B). |
| `--sandbox <dir>` | ruta | Carpeta de trabajo. Default `.verification/prueba-0a` (ignorada por git). Se borra y recrea en cada corrida. |
| `--limpiar` | | Borra la sandbox al terminar. Sin esta opción se conserva el repo de prueba, los `allowed_signers`, las KRL y las claves públicas, nunca las privadas. |
| `--salida <archivo>` | ruta | Guarda el informe también en ese archivo. |
| `--traza` | | Muestra cada comando ejecutado y la traza de `git verify-commit`. |

Código de salida: 0 si los cinco puntos dan ✓, 1 si alguno da ✗, 2 si se pidió `--agente windows` con el servicio detenido.

## Qué hace por dentro

- Genera tres claves: la del agente `claude-recibos` y la de sesión (SDK de DCP o `ssh-keygen`) y una intrusa (`ssh-keygen`).
- Carga las privadas en el agente por stdin con `ssh-add -t 1800 -`; el agente de Windows rechaza `-t`, así que ahí se cargan sin vencimiento y se quitan al final con `ssh-add -d`. El certificado de sesión entra junto con su clave gracias a que `ssh-add -` busca `(stdin)-cert.pub` en el directorio actual.
- Emite el certificado de sesión con `ssh-keygen -s <agente.pub> -U` (la CA está en el agente), principal `claude-recibos`, serie numérica y vigencia de 2 horas.
- Crea un repo con `git config --worktree`: `gpg.format=ssh`, `commit.gpgsign=true`, `gpg.ssh.program` explícito y `user.signingKey=key::ssh-ed25519 …`.
- Hace cinco commits firmados con trailers `DCP-Agente` y `DCP-Intencion`: agente, intrusa, agente con fecha futura, certificado de sesión, certificado con fecha futura.
- Verifica cada uno con `git verify-commit` contra un `allowed_signers` vigente y uno vencido, y con dos KRL (`gpg.ssh.revocationFile`): la clave del agente revocada, y el certificado revocado por serie.

## Archivos

- `prueba-0a.mjs`: el script.
- `clave-ssh.mjs`: convierte la clave del SDK (secreto tweetnacl de 64 bytes, semilla + pública) a `OPENSSH PRIVATE KEY` y a línea `ssh-ed25519 …`. No usa nada de DCP; solo empaqueta bytes.

Los resultados y sus implicaciones están en la nota `pruebas/prueba-0a-firma-git.md` del cuaderno Hiloo.
