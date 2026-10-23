-- Prueba 0c: humanos de Auth0 leen solo las filas de sus organizaciones.
-- Tablas de la sección 8 del diseño que necesita la prueba; el resto del modelo llega en la etapa 3.

create schema if not exists privado;
revoke all on schema privado from public, anon, authenticated;
grant usage on schema privado to authenticated;

create table public.organizaciones (
  id uuid primary key default gen_random_uuid(),
  nombre text not null check (length(nombre) between 1 and 200),
  plan text,
  creada_en timestamptz not null default now()
);

-- Una cuenta humana puede pertenecer a varias organizaciones (sección 4 del diseño).
create table public.humanos (
  id uuid primary key default gen_random_uuid(),
  auth0_sub text not null unique check (length(auth0_sub) between 1 and 255),
  clave_publica text, -- passkey, etapa 3
  creado_en timestamptz not null default now()
);

create table public.miembros (
  org_id uuid not null references public.organizaciones (id) on delete cascade,
  humano_id uuid not null references public.humanos (id) on delete cascade,
  rol text not null check (rol in ('admin', 'auditor', 'programador', 'invitado')),
  creado_en timestamptz not null default now(),
  primary key (org_id, humano_id)
);
create index miembros_humano_id_idx on public.miembros (humano_id);

create table public.pruebas_0c (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizaciones (id) on delete cascade,
  texto text not null,
  creada_en timestamptz not null default now(),
  unique (id, org_id)
);
create index pruebas_0c_org_id_idx on public.pruebas_0c (org_id);

-- Solo cuenta el sub de un token emitido por el tenant de Auth0 (humanos).
-- Los agentes tendrán otro iss y nunca pasan por esta función.
create function privado.auth0_sub()
returns text
language sql
stable
set search_path = ''
as $$
  select case
    when auth.jwt() ->> 'iss' = 'https://dev-v6vadakchitq3tq7.us.auth0.com/'
    then nullif(auth.jwt() ->> 'sub', '')
  end
$$;

-- security definer para leer humanos y miembros sin pasar por sus propias políticas.
create function privado.mi_humano_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select h.id from public.humanos h where h.auth0_sub = privado.auth0_sub()
$$;

create function privado.mis_organizaciones()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select m.org_id from public.miembros m where m.humano_id = privado.mi_humano_id()
$$;

revoke all on function privado.auth0_sub() from public, anon;
revoke all on function privado.mi_humano_id() from public, anon;
revoke all on function privado.mis_organizaciones() from public, anon;
grant execute on function privado.auth0_sub() to authenticated;
grant execute on function privado.mi_humano_id() to authenticated;
grant execute on function privado.mis_organizaciones() to authenticated;

alter table public.organizaciones enable row level security;
alter table public.humanos enable row level security;
alter table public.miembros enable row level security;
alter table public.pruebas_0c enable row level security;

-- Por ahora solo lectura: las escrituras irán por la Edge Function registrar.
revoke all on public.organizaciones, public.humanos, public.miembros, public.pruebas_0c from anon, authenticated;
grant select on public.organizaciones, public.humanos, public.miembros, public.pruebas_0c to authenticated;

create policy "Miembros leen su organización" on public.organizaciones
  for select to authenticated
  using (id in (select privado.mis_organizaciones()));

create policy "Humanos se ven a sí mismos y a sus compañeros" on public.humanos
  for select to authenticated
  using (
    id = (select privado.mi_humano_id())
    or id in (select m.humano_id from public.miembros m where m.org_id in (select privado.mis_organizaciones()))
  );

create policy "Miembros ven a su organización" on public.miembros
  for select to authenticated
  using (org_id in (select privado.mis_organizaciones()));

create policy "Miembros leen las pruebas de su organización" on public.pruebas_0c
  for select to authenticated
  using (org_id in (select privado.mis_organizaciones()));
