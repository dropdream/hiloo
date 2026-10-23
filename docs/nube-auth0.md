# Nube: inicio de sesión con Auth0 y lectura en Supabase

Estado: **prueba 0c**, experimental. hiloo inicia sesión con Auth0 y lee de Supabase con las reglas RLS del usuario. Todavía no sincroniza notas.

## Cómo funciona

1. **Cuenta en la nube** (barra de herramientas) → **Iniciar sesión** abre el navegador del sistema en Auth0.
2. hiloo usa Authorization Code con PKCE y recibe el código en `http://127.0.0.1:47615/callback` (o `47616` si el primero está ocupado). No usa el Client Secret.
3. Auth0 entrega un ID token y un refresh token. El ID token vive solo en memoria; el refresh token se guarda cifrado con DPAPI (`safeStorage`) en `%APPDATA%\hiloo\auth0-session.bin`.
4. El proceso principal crea el cliente de `@supabase/supabase-js` con la opción `accessToken`, que entrega el ID token y lo renueva un minuto antes de que venza. El renderer nunca ve los tokens.
5. Supabase valida el token con el JWKS del tenant (integración Third-Party Auth de Auth0) y las políticas RLS filtran por el `sub` del token y su `iss`.

**Cerrar sesión** borra el archivo y revoca el refresh token en Auth0.

## Configuración

Al compilar, `electron.vite.config.ts` lee del `.env` solo estos valores públicos: `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `AUTH0_DOMAIN` y `AUTH0_CLIENT_ID`. La clave secreta de Supabase nunca entra al paquete. Sin esos valores, el diálogo indica que la nube no está configurada.

En Auth0, la aplicación nativa necesita:

- Allowed Callback URLs: `http://127.0.0.1:47615/callback, http://127.0.0.1:47616/callback`. Auth0 compara la URL completa, puerto incluido.
- Grant types: Authorization Code y Refresh Token.
- La Action de [`auth0/actions/post-login-supabase.js`](../auth0/actions/post-login-supabase.js), que agrega `role: authenticated` al ID token.

En Supabase, `supabase/config.toml` activa `[auth.third_party.auth0]` para el stack local. En el proyecto remoto se activa desde el panel (Authentication → Third-Party Auth), porque `supabase config push` no envía esa sección. Ya está activada.

## Esquema y pruebas

- Migración: `supabase/migrations/*_prueba_0c_auth0.sql` (`organizaciones`, `humanos`, `miembros`, `pruebas_0c` y RLS), aplicada al proyecto remoto el 2026-10-23.
- Migración `*_revocar_rls_auto_enable.sql`: quita `EXECUTE` a `anon` y `authenticated` sobre `public.rls_auto_enable()`, la función del trigger de evento que activa RLS en tablas nuevas de `public`. El trigger no necesita ese permiso.
- Pruebas pgTAP: `supabase db start` y después `supabase test db`.
- Pruebas de la app: `tests/cloud.spec.ts` simula Auth0 dentro del proceso principal.
