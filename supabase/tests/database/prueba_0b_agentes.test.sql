begin;
create extension if not exists pgtap with schema extensions;
select plan(45);

-- Datos de prueba como postgres (salta RLS). Claves públicas con la forma correcta, no reales.
insert into public.organizaciones (id, nombre) values
  ('00000000-0000-0000-0000-00000000000a', 'Org A'),
  ('00000000-0000-0000-0000-00000000000b', 'Org B');
insert into public.humanos (id, auth0_sub) values
  ('00000000-0000-0000-0000-0000000000a1', 'auth0|ana');
insert into public.miembros (org_id, humano_id, rol) values
  ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000a1', 'admin');
insert into public.agentes (id, org_id, nombre, clave_publica, revocado_en) values
  ('00000000-0000-0000-0000-0000000000aa', '00000000-0000-0000-0000-00000000000a', 'agente-a', repeat('A', 43) || '=', null),
  ('00000000-0000-0000-0000-0000000000bb', '00000000-0000-0000-0000-00000000000b', 'agente-b', repeat('B', 43) || '=', null),
  ('00000000-0000-0000-0000-0000000000cc', '00000000-0000-0000-0000-00000000000a', 'agente-revocado', repeat('C', 43) || '=', now());
insert into public.pruebas_0b (org_id, cuaderno_id, texto) values
  ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000e1', 'fila de A'),
  ('00000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-0000000000e2', 'fila de B');
insert into privado.emisores_agentes (iss, nota)
  values ('http://127.0.0.1:54321/functions/v1/emisor-agentes', 'prueba') on conflict (iss) do nothing;

select ok((select relrowsecurity from pg_class where oid = 'public.agentes'::regclass), 'agentes tiene RLS');
select ok((select relrowsecurity from pg_class where oid = 'public.pruebas_0b'::regclass), 'pruebas_0b tiene RLS');
select throws_ok($$insert into public.agentes (org_id, nombre, clave_publica) values ('00000000-0000-0000-0000-00000000000a', 'agente-a', repeat('D', 43) || '=')$$,
  '23505', null, 'El nombre del agente es único por organización');
select throws_ok($$insert into public.agentes (org_id, nombre, clave_publica) values ('00000000-0000-0000-0000-00000000000a', 'otro', 'clave mala')$$,
  '23514', null, 'La clave pública debe ser Ed25519 en base64');

-- El trigger de Broadcast from Database deja el aviso en realtime.messages (id y organización, sin contenido).
insert into public.pruebas_0b (id, org_id, cuaderno_id, texto)
  values ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000e1', 'fila nueva de A');
select results_eq(
  $$select event, private, payload ->> 'id', payload ? 'texto' from realtime.messages
    where topic = 'org:00000000-0000-0000-0000-00000000000a:cuaderno:00000000-0000-0000-0000-0000000000e1'
      and payload ->> 'id' = '00000000-0000-0000-0000-0000000000f1'$$,
  $$values ('nueva_fila', true, '00000000-0000-0000-0000-0000000000f1', false)$$,
  'Insertar en pruebas_0b envía un aviso al canal privado de la organización y el cuaderno');

-- Agente A, con token del emisor local.
set local role authenticated;
select set_config('request.jwt.claims', json_build_object(
  'iss', 'http://127.0.0.1:54321/functions/v1/emisor-agentes', 'sub', '00000000-0000-0000-0000-0000000000aa',
  'role', 'authenticated', 'aud', 'authenticated', 'org_id', '00000000-0000-0000-0000-00000000000a',
  'agente_id', '00000000-0000-0000-0000-0000000000aa', 'tipo', 'agente')::text, true);

select results_eq('select texto from public.pruebas_0b order by texto', $$values ('fila de A'), ('fila nueva de A')$$, 'El agente A lee solo las filas de A');
select results_eq('select nombre from public.organizaciones', $$values ('Org A')$$, 'El agente A ve solo su organización');
select results_eq('select nombre from public.agentes order by nombre', $$values ('agente-a'), ('agente-revocado')$$, 'El agente A ve a los agentes de A');
select is_empty('select 1 from public.humanos', 'El agente no ve humanos');
select is_empty('select 1 from public.miembros', 'El agente no ve membresías');
select is_empty($$select 1 from public.pruebas_0b where org_id = '00000000-0000-0000-0000-00000000000b'$$, 'El agente A no lee filas de B aunque las pida');
select throws_ok($$insert into public.pruebas_0b (org_id, cuaderno_id, texto) values ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000e1', 'x')$$,
  '42501', null, 'El agente no inserta directo');
select throws_ok($$update public.agentes set revocado_en = null$$, '42501', null, 'El agente no cambia agentes');
select throws_ok($$select public.emisor_crear_desafio('00000000-0000-0000-0000-0000000000aa', '{}'::jsonb, now())$$,
  '42501', null, 'authenticated no ejecuta las RPC del emisor');

-- Canales privados: el agente A usa org:A:cuaderno:*, no org:B ni temas con otra forma.
select set_config('realtime.topic', 'org:00000000-0000-0000-0000-00000000000a:cuaderno:00000000-0000-0000-0000-0000000000e1', true);
select ok(privado.puede_usar_tema(), 'El agente A puede usar un canal de A');
select lives_ok($$insert into realtime.messages (topic, extension, payload, event, private)
  values ('org:00000000-0000-0000-0000-00000000000a:cuaderno:00000000-0000-0000-0000-0000000000e1', 'broadcast', '{"hola": 1}', 'prueba', true)$$,
  'El agente A envía un broadcast en un canal de A');
select results_eq(
  $$select count(*)::int from realtime.messages where topic like 'org:00000000-0000-0000-0000-00000000000a:%'$$,
  $$values (3)$$, 'El agente A recibe los mensajes del canal de A (dos avisos del trigger y el suyo)');
select set_config('realtime.topic', 'org:00000000-0000-0000-0000-00000000000b:cuaderno:00000000-0000-0000-0000-0000000000e2', true);
select ok(not privado.puede_usar_tema(), 'El agente A no puede usar un canal de B');
select throws_ok($$insert into realtime.messages (topic, extension, payload, event, private)
  values ('org:00000000-0000-0000-0000-00000000000b:cuaderno:00000000-0000-0000-0000-0000000000e2', 'broadcast', '{"hola": 1}', 'prueba', true)$$,
  '42501', null, 'El agente A no envía en un canal de B');
select is_empty('select 1 from realtime.messages', 'Con el tema de B puesto, el agente A no recibe nada');
select set_config('realtime.topic', 'org:00000000-0000-0000-0000-00000000000a', true);
select ok(not privado.puede_usar_tema(), 'Un tema sin la forma org:<id>:cuaderno:<id> no se usa');
select set_config('realtime.topic', 'org:00000000-0000-0000-0000-00000000000a:cuaderno:00000000-0000-0000-0000-0000000000e1', true);
select throws_ok($$insert into realtime.messages (topic, extension, payload, event, private)
  values ('org:00000000-0000-0000-0000-00000000000a:cuaderno:00000000-0000-0000-0000-0000000000e1', 'postgres_changes', '{}', 'prueba', true)$$,
  '42501', null, 'Solo se permiten broadcast y presencia');

-- Agente B.
select set_config('request.jwt.claims', json_build_object(
  'iss', 'http://127.0.0.1:54321/functions/v1/emisor-agentes', 'sub', '00000000-0000-0000-0000-0000000000bb',
  'role', 'authenticated', 'org_id', '00000000-0000-0000-0000-00000000000b',
  'agente_id', '00000000-0000-0000-0000-0000000000bb', 'tipo', 'agente')::text, true);
select results_eq('select texto from public.pruebas_0b', $$values ('fila de B')$$, 'El agente B lee solo las filas de B');
select results_eq('select nombre from public.agentes', $$values ('agente-b')$$, 'El agente B ve solo a los agentes de B');

-- Mismos claims de agente, pero emitidos por Auth0: la RLS no los acepta como agente.
select set_config('request.jwt.claims', json_build_object(
  'iss', 'https://dev-v6vadakchitq3tq7.us.auth0.com/', 'sub', '00000000-0000-0000-0000-0000000000aa',
  'role', 'authenticated', 'org_id', '00000000-0000-0000-0000-00000000000a',
  'agente_id', '00000000-0000-0000-0000-0000000000aa', 'tipo', 'agente')::text, true);
select is_empty('select 1 from public.pruebas_0b', 'Un token de Auth0 con claims de agente no lee pruebas');
select is_empty('select 1 from public.organizaciones', 'Un token de Auth0 con claims de agente no ve organizaciones');

-- Emisor desconocido.
select set_config('request.jwt.claims', json_build_object(
  'iss', 'https://otro-emisor.example/', 'sub', '00000000-0000-0000-0000-0000000000aa',
  'role', 'authenticated', 'org_id', '00000000-0000-0000-0000-00000000000a', 'tipo', 'agente')::text, true);
select is_empty('select 1 from public.pruebas_0b', 'Un emisor desconocido no lee nada');

-- Emisor correcto, sin el claim tipo.
select set_config('request.jwt.claims', json_build_object(
  'iss', 'http://127.0.0.1:54321/functions/v1/emisor-agentes', 'sub', '00000000-0000-0000-0000-0000000000aa',
  'role', 'authenticated', 'org_id', '00000000-0000-0000-0000-00000000000a')::text, true);
select is_empty('select 1 from public.pruebas_0b', 'Sin el claim tipo=agente no lee nada');

-- org_id con forma inválida: no lee nada y no falla.
select set_config('request.jwt.claims', json_build_object(
  'iss', 'http://127.0.0.1:54321/functions/v1/emisor-agentes', 'sub', '00000000-0000-0000-0000-0000000000aa',
  'role', 'authenticated', 'org_id', 'no-es-uuid', 'tipo', 'agente')::text, true);
select lives_ok('select 1 from public.pruebas_0b', 'Un org_id mal formado no provoca un error');
select is_empty('select 1 from public.pruebas_0b', 'Un org_id mal formado no lee nada');

-- Ana (Auth0, miembro de A) con un org_id de B inventado en el token: manda la membresía.
select set_config('request.jwt.claims', json_build_object(
  'iss', 'https://dev-v6vadakchitq3tq7.us.auth0.com/', 'sub', 'auth0|ana', 'role', 'authenticated',
  'org_id', '00000000-0000-0000-0000-00000000000b', 'tipo', 'agente')::text, true);
select results_eq('select texto from public.pruebas_0b order by texto', $$values ('fila de A'), ('fila nueva de A')$$, 'Ana lee las filas de A por membresía, no las de B del claim');
select results_eq('select nombre from public.agentes order by nombre', $$values ('agente-a'), ('agente-revocado')$$, 'Ana ve a los agentes de A');
select set_config('realtime.topic', 'org:00000000-0000-0000-0000-00000000000a:cuaderno:00000000-0000-0000-0000-0000000000e1', true);
select ok(privado.puede_usar_tema(), 'Ana puede usar un canal de A');
select set_config('realtime.topic', 'org:00000000-0000-0000-0000-00000000000b:cuaderno:00000000-0000-0000-0000-0000000000e2', true);
select ok(not privado.puede_usar_tema(), 'Ana no puede usar un canal de B');

-- anon: sin permisos.
reset role;
set local role anon;
select set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
select throws_ok('select 1 from public.agentes', '42501', null, 'anon no lee agentes');
select throws_ok('select 1 from public.pruebas_0b', '42501', null, 'anon no lee pruebas_0b');
select throws_ok($$select public.emisor_consumir_desafio(repeat('0', 64), '00000000-0000-0000-0000-0000000000aa')$$,
  '42501', null, 'anon no ejecuta las RPC del emisor');

-- RPC del emisor, como service_role (la Edge Function).
reset role;
set local role service_role;
select results_eq(
  $$select public.emisor_crear_desafio('00000000-0000-0000-0000-0000000000aa',
    json_build_object('kid', 'k', 'agent_id', '00000000-0000-0000-0000-0000000000aa', 'timestamp', 't', 'nonce', repeat('1', 64))::jsonb,
    now() + interval '60 seconds')$$,
  $$values ('00000000-0000-0000-0000-00000000000a'::uuid)$$,
  'Crear un desafío para un agente vigente devuelve su organización');
select throws_ok(
  $$select public.emisor_crear_desafio('00000000-0000-0000-0000-0000000000cc', json_build_object('nonce', repeat('2', 64))::jsonb, now() + interval '60 seconds')$$,
  '42501', null, 'No se crea un desafío para un agente revocado');
select throws_ok(
  $$select public.emisor_crear_desafio('00000000-0000-0000-0000-0000000000aa', json_build_object('nonce', repeat('3', 64))::jsonb, now() + interval '1 day')$$,
  '22023', null, 'No se crea un desafío con vencimiento lejano');
select results_eq(
  $$select org_id, desafio ->> 'nonce', clave_publica from public.emisor_consumir_desafio(repeat('1', 64), '00000000-0000-0000-0000-0000000000aa')$$,
  $$values ('00000000-0000-0000-0000-00000000000a'::uuid, repeat('1', 64), repeat('A', 43) || '=')$$,
  'Consumir el desafío devuelve organización, desafío y clave pública');
select is_empty(
  $$select 1 from public.emisor_consumir_desafio(repeat('1', 64), '00000000-0000-0000-0000-0000000000aa')$$,
  'Un desafío no se consume dos veces');
select public.emisor_crear_desafio('00000000-0000-0000-0000-0000000000aa', json_build_object('nonce', repeat('4', 64))::jsonb, now() + interval '60 seconds');
select is_empty(
  $$select 1 from public.emisor_consumir_desafio(repeat('4', 64), '00000000-0000-0000-0000-0000000000bb')$$,
  'Otro agente no consume el desafío');
select public.emisor_crear_desafio('00000000-0000-0000-0000-0000000000aa', json_build_object('nonce', repeat('5', 64))::jsonb, now() - interval '1 second');
select is_empty(
  $$select 1 from public.emisor_consumir_desafio(repeat('5', 64), '00000000-0000-0000-0000-0000000000aa')$$,
  'Un desafío vencido no se consume');
select throws_ok($$select 1 from privado.desafios_agente$$, '42501', null, 'service_role no lee los desafíos directo');

reset role;
select * from finish();
rollback;
