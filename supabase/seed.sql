-- Semilla solo local (supabase start / db reset). No se aplica al remoto.
-- El emisor local de agentes (supabase functions serve), aceptado por la RLS.
insert into privado.emisores_agentes (iss, nota)
values ('http://127.0.0.1:54321/functions/v1/emisor-agentes', 'emisor local (supabase functions serve)')
on conflict (iss) do nothing;
