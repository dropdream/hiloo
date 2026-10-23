// Action de Auth0 (Login / Post Login) para que Supabase acepte el ID token de hiloo.
// Se pega en el panel de Auth0: Actions → Library → Create Action → Build from scratch.
exports.onExecutePostLogin = async (event, api) => {
  // Supabase elige el rol de Postgres con este claim; sin él, la petición corre como anon.
  // Va en el ID token: Auth0 quita de los access tokens los claims sin espacio de nombres.
  api.idToken.setCustomClaim('role', 'authenticated')

  // Etapa 3: organización activa, cuando se use Auth0 Organizations.
  // El UUID de la tabla organizaciones iría en los metadatos de la organización de Auth0.
  // const orgId = event.organization?.metadata?.org_id
  // if (orgId) api.idToken.setCustomClaim('org_id', orgId)
}
