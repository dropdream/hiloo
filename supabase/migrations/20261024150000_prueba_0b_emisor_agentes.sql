-- Prueba 0b: agentes con token del emisor propio leen solo su organización y usan canales privados de Realtime.
-- Tablas de la sección 8 del diseño que necesita la prueba (agentes, con un subconjunto de columnas);
-- el resto del modelo llega en la etapa 3. Los agentes no escriben directo: eso irá por la Edge Function registrar.

-- Emisores de tokens de agentes que acepta la RLS. Supabase solo valida la firma contra el JWKS
-- registrado y no mira iss, así que la RLS tiene que comprobarlo (sección 10 del diseño).
create table privado.emisores_agentes (
  iss text primary key check (iss ~ '^https?://'),
  nota text,
  creado_en timestamptz not null default now()
);
insert into privado.emisores_agentes (iss, nota) values
  ('https://uixyyqejezffjkihieql.supabase.co/functions/v1/emisor-agentes', 'Edge Function emisor-agentes del proyecto hiloo');

create table public.agentes (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizaciones (id) on delete cascade,
  nombre text not null check (length(nombre) between 1 and 100),
  clave_publica text not null check (clave_publica ~ '^[A-Za-z0-9+/]{43}=$'), -- Ed25519 pública (32 bytes) en base64
  responsable_id uuid references public.humanos (id),
  vence_en timestamptz,
  revocado_en timestamptz,
  creado_en timestamptz not null default now(),
  unique (org_id, nombre),
  unique (id, org_id)
);
create index agentes_org_id_idx on public.agentes (org_id);

-- Desafíos del emisor: nonce de un solo uso, 60 s. No se expone por la API: vive en privado.
create table privado.desafios_agente (
  nonce text primary key check (nonce ~ '^[0-9a-f]{64}$'),
  org_id uuid not null,
  agente_id uuid not null,
  desafio jsonb not null,
  vence_en timestamptz not null,
  usado_en timestamptz,
  creado_en timestamptz not null default now(),
  foreign key (agente_id, org_id) references public.agentes (id, org_id) on delete cascade
);

create table public.pruebas_0b (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizaciones (id) on delete cascade,
  cuaderno_id uuid not null,
  texto text not null,
  creada_en timestamptz not null default now(),
  unique (id, org_id)
);
create index pruebas_0b_org_id_idx on public.pruebas_0b (org_id);

-- Solo cuenta el org_id de un token de agente emitido por un emisor aceptado.
-- Un token de Auth0 con un claim org_id inventado devuelve null.
create function privado.org_id_agente()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when auth.jwt() ->> 'tipo' = 'agente'
     and auth.jwt() ->> 'role' = 'authenticated'
     and (auth.jwt() ->> 'org_id') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     and exists (select 1 from privado.emisores_agentes e where e.iss = auth.jwt() ->> 'iss')
    then (auth.jwt() ->> 'org_id')::uuid
  end
$$;

-- Organización de un tema de Realtime con la forma org:<uuid>:cuaderno:<uuid>; null si el tema no tiene esa forma.
create function privado.org_de_tema()
returns uuid
language sql
stable
set search_path = ''
as $$
  select case
    when realtime.topic() ~ '^org:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:cuaderno:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then split_part(realtime.topic(), ':', 2)::uuid
  end
$$;

-- Quién puede usar un tema: el agente de esa organización o un humano miembro de ella.
create function privado.puede_usar_tema()
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(
    privado.org_de_tema() is not null
    and (privado.org_de_tema() = privado.org_id_agente()
         or privado.org_de_tema() in (select privado.mis_organizaciones())),
    false)
$$;

revoke all on function privado.org_id_agente() from public, anon;
revoke all on function privado.org_de_tema() from public, anon;
revoke all on function privado.puede_usar_tema() from public, anon;
grant execute on function privado.org_id_agente() to authenticated;
grant execute on function privado.org_de_tema() to authenticated;
grant execute on function privado.puede_usar_tema() to authenticated;

-- RPC del emisor (Edge Function con service_role). Nadie más las ejecuta.
create function public.emisor_crear_desafio(p_agente_id uuid, p_desafio jsonb, p_vence_en timestamptz)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
begin
  select a.org_id into v_org
  from public.agentes a
  where a.id = p_agente_id
    and a.revocado_en is null
    and (a.vence_en is null or a.vence_en > now());
  if v_org is null then
    raise exception 'agente no vigente' using errcode = '42501';
  end if;
  if p_vence_en > now() + interval '5 minutes' then
    raise exception 'vencimiento del desafío demasiado lejano' using errcode = '22023';
  end if;
  delete from privado.desafios_agente where vence_en < now() - interval '1 hour';
  insert into privado.desafios_agente (nonce, org_id, agente_id, desafio, vence_en)
  values (p_desafio ->> 'nonce', v_org, p_agente_id, p_desafio, p_vence_en);
  return v_org;
end
$$;

-- Marca el desafío como usado y devuelve lo necesario para verificar la firma. Vacío si no sirve.
create function public.emisor_consumir_desafio(p_nonce text, p_agente_id uuid)
returns table (org_id uuid, desafio jsonb, clave_publica text)
language sql
security definer
set search_path = ''
as $$
  with usado as (
    update privado.desafios_agente d
    set usado_en = now()
    where d.nonce = p_nonce
      and d.agente_id = p_agente_id
      and d.usado_en is null
      and d.vence_en > now()
    returning d.org_id, d.agente_id, d.desafio
  )
  select u.org_id, u.desafio, a.clave_publica
  from usado u
  join public.agentes a on a.id = u.agente_id and a.org_id = u.org_id
  where a.revocado_en is null
    and (a.vence_en is null or a.vence_en > now())
$$;

revoke all on function public.emisor_crear_desafio(uuid, jsonb, timestamptz) from public, anon, authenticated;
revoke all on function public.emisor_consumir_desafio(text, uuid) from public, anon, authenticated;
grant execute on function public.emisor_crear_desafio(uuid, jsonb, timestamptz) to service_role;
grant execute on function public.emisor_consumir_desafio(text, uuid) to service_role;

alter table public.agentes enable row level security;
alter table public.pruebas_0b enable row level security;
revoke all on public.agentes, public.pruebas_0b from anon, authenticated;
grant select on public.agentes, public.pruebas_0b to authenticated;
-- Las tablas nuevas ya no se exponen solas a service_role (valor nuevo por defecto en la nube y en la CLI).
-- El emisor (Edge Function) solo necesita leer agentes; el resto lo hace por las RPC.
grant select on public.agentes to service_role;

create policy "Agentes leen su organización" on public.organizaciones
  for select to authenticated
  using (id = (select privado.org_id_agente()));

create policy "Agentes ven a los agentes de su organización" on public.agentes
  for select to authenticated
  using (org_id = (select privado.org_id_agente()));

create policy "Miembros ven a los agentes de su organización" on public.agentes
  for select to authenticated
  using (org_id in (select privado.mis_organizaciones()));

create policy "Agentes leen las pruebas de su organización" on public.pruebas_0b
  for select to authenticated
  using (org_id = (select privado.org_id_agente()));

create policy "Miembros leen las pruebas de su organización" on public.pruebas_0b
  for select to authenticated
  using (org_id in (select privado.mis_organizaciones()));

-- Canales privados org:<id>:cuaderno:<id> (sección 9 del diseño): recibir y enviar avisos y presencia.
create policy "Agentes y miembros reciben en los canales de su organización" on realtime.messages
  for select to authenticated
  using (realtime.messages.extension in ('broadcast', 'presence') and (select privado.puede_usar_tema()));

create policy "Agentes y miembros envían en los canales de su organización" on realtime.messages
  for insert to authenticated
  with check (realtime.messages.extension in ('broadcast', 'presence') and (select privado.puede_usar_tema()));

-- Broadcast from Database: el aviso lleva solo id y organización; el contenido se pide aparte.
create function privado.avisar_prueba_0b()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform realtime.send(
    jsonb_build_object('id', new.id, 'org_id', new.org_id),
    'nueva_fila',
    'org:' || new.org_id || ':cuaderno:' || new.cuaderno_id,
    true
  );
  return new;
end
$$;

create trigger pruebas_0b_avisar
  after insert on public.pruebas_0b
  for each row execute function privado.avisar_prueba_0b();
