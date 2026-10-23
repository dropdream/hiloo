-- rls_auto_enable() es la función del trigger de evento ensure_rls (RLS automático en public).
-- Los triggers de evento no revisan EXECUTE al dispararse, así que nadie más necesita el permiso.
-- Condicional: la función existe en el proyecto remoto, no en el stack local.
do $$
begin
  if to_regprocedure('public.rls_auto_enable()') is not null then
    revoke execute on function public.rls_auto_enable() from public, anon, authenticated;
  end if;
end
$$;
