begin;
create extension if not exists pgtap with schema extensions;
select plan(22);

-- Datos de prueba como postgres (salta RLS). Carla pertenece a las dos organizaciones.
insert into public.organizaciones (id, nombre) values
  ('00000000-0000-0000-0000-00000000000a', 'Org A'),
  ('00000000-0000-0000-0000-00000000000b', 'Org B');
insert into public.humanos (id, auth0_sub) values
  ('00000000-0000-0000-0000-0000000000a1', 'auth0|ana'),
  ('00000000-0000-0000-0000-0000000000b1', 'auth0|beto'),
  ('00000000-0000-0000-0000-0000000000c1', 'auth0|carla'),
  ('00000000-0000-0000-0000-0000000000d1', 'auth0|nadie');
insert into public.miembros (org_id, humano_id, rol) values
  ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000a1', 'admin'),
  ('00000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-0000000000b1', 'programador'),
  ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000c1', 'auditor'),
  ('00000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-0000000000c1', 'invitado');
insert into public.pruebas_0c (org_id, texto) values
  ('00000000-0000-0000-0000-00000000000a', 'fila de A'),
  ('00000000-0000-0000-0000-00000000000b', 'fila de B 1'),
  ('00000000-0000-0000-0000-00000000000b', 'fila de B 2');

select ok((select relrowsecurity from pg_class where oid = 'public.pruebas_0c'::regclass), 'pruebas_0c tiene RLS');
select ok((select relrowsecurity from pg_class where oid = 'public.miembros'::regclass), 'miembros tiene RLS');
select ok((select relrowsecurity from pg_class where oid = 'public.humanos'::regclass), 'humanos tiene RLS');
select ok((select relrowsecurity from pg_class where oid = 'public.organizaciones'::regclass), 'organizaciones tiene RLS');
select throws_ok($$insert into public.humanos (auth0_sub) values ('auth0|ana')$$, '23505', null, 'auth0_sub es único');

-- Ana, de la organización A, con token de Auth0.
set local role authenticated;
select set_config('request.jwt.claims', json_build_object(
  'iss', 'https://dev-v6vadakchitq3tq7.us.auth0.com/', 'sub', 'auth0|ana', 'role', 'authenticated')::text, true);

select results_eq('select texto from public.pruebas_0c', $$values ('fila de A')$$, 'Ana lee solo las filas de A');
select results_eq('select nombre from public.organizaciones', $$values ('Org A')$$, 'Ana ve solo su organización');
select results_eq('select auth0_sub from public.humanos order by auth0_sub', $$values ('auth0|ana'), ('auth0|carla')$$, 'Ana ve a sí misma y a sus compañeros de A');
select results_eq('select count(*)::int from public.miembros', $$values (2)$$, 'Ana ve solo las membresías de A');
select is_empty($$select 1 from public.pruebas_0c where org_id = '00000000-0000-0000-0000-00000000000b'$$, 'Ana no lee filas de B aunque las pida');
select throws_ok($$insert into public.pruebas_0c (org_id, texto) values ('00000000-0000-0000-0000-00000000000a', 'x')$$,
  '42501', null, 'authenticated no inserta directo');
select throws_ok($$insert into public.miembros (org_id, humano_id, rol) values ('00000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-0000000000a1', 'admin')$$,
  '42501', null, 'Ana no se agrega a otra organización');
select throws_ok($$update public.humanos set auth0_sub = 'auth0|otro'$$, '42501', null, 'Ana no cambia su auth0_sub');

-- Beto, de la organización B.
select set_config('request.jwt.claims', json_build_object(
  'iss', 'https://dev-v6vadakchitq3tq7.us.auth0.com/', 'sub', 'auth0|beto', 'role', 'authenticated')::text, true);
select results_eq('select texto from public.pruebas_0c order by texto', $$values ('fila de B 1'), ('fila de B 2')$$, 'Beto lee solo las filas de B');

-- Carla, en las dos organizaciones.
select set_config('request.jwt.claims', json_build_object(
  'iss', 'https://dev-v6vadakchitq3tq7.us.auth0.com/', 'sub', 'auth0|carla', 'role', 'authenticated')::text, true);
select results_eq('select count(*)::int from public.pruebas_0c', $$values (3)$$, 'Carla lee las filas de sus dos organizaciones');

-- Mismo sub que Ana, pero de otro emisor (por ejemplo, el de agentes).
select set_config('request.jwt.claims', json_build_object(
  'iss', 'https://otro-emisor.example/', 'sub', 'auth0|ana', 'role', 'authenticated')::text, true);
select is_empty('select 1 from public.pruebas_0c', 'Otro emisor con el mismo sub no lee nada');
select is_empty('select 1 from public.humanos', 'Otro emisor con el mismo sub no ve humanos');

-- Humano registrado sin membresía.
select set_config('request.jwt.claims', json_build_object(
  'iss', 'https://dev-v6vadakchitq3tq7.us.auth0.com/', 'sub', 'auth0|nadie', 'role', 'authenticated')::text, true);
select is_empty('select 1 from public.pruebas_0c', 'Humano sin membresía no lee nada');
select is_empty('select 1 from public.organizaciones', 'Humano sin membresía no ve organizaciones');

-- Sin token válido (rol anon): sin permiso.
reset role;
set local role anon;
select set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
select throws_ok('select 1 from public.pruebas_0c', '42501', null, 'anon no lee pruebas_0c');
select throws_ok('select 1 from public.humanos', '42501', null, 'anon no lee humanos');
select throws_ok('select privado.mis_organizaciones()', '42501', null, 'anon no usa las funciones privadas');

reset role;
select * from finish();
rollback;
