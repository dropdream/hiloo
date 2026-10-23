-- Datos para verificar la prueba 0c en el proyecto remoto. No es una migración.
-- Reemplaza SUB_DE_AUTH0 por el sub del usuario de prueba (por ejemplo auth0|abc123)
-- y ejecútalo con: supabase db query --linked -f supabase/prueba-0c-datos.sql
-- Para borrarlo:
--   delete from public.organizaciones where id in ('0c000000-0000-4000-8000-00000000000a', '0c000000-0000-4000-8000-00000000000b');
--   delete from public.humanos where id in ('0c000000-0000-4000-8000-0000000000a1', '0c000000-0000-4000-8000-0000000000b1');

insert into public.organizaciones (id, nombre) values
  ('0c000000-0000-4000-8000-00000000000a', 'Prueba 0c A'),
  ('0c000000-0000-4000-8000-00000000000b', 'Prueba 0c B');

insert into public.humanos (id, auth0_sub) values
  ('0c000000-0000-4000-8000-0000000000a1', 'SUB_DE_AUTH0'),
  ('0c000000-0000-4000-8000-0000000000b1', 'auth0|usuario-ficticio-b');

insert into public.miembros (org_id, humano_id, rol) values
  ('0c000000-0000-4000-8000-00000000000a', '0c000000-0000-4000-8000-0000000000a1', 'admin'),
  ('0c000000-0000-4000-8000-00000000000b', '0c000000-0000-4000-8000-0000000000b1', 'admin');

insert into public.pruebas_0c (org_id, texto) values
  ('0c000000-0000-4000-8000-00000000000a', 'Fila visible para el usuario de prueba'),
  ('0c000000-0000-4000-8000-00000000000b', 'Fila de otra organización: no debe verse');
