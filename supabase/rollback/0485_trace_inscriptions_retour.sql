-- Retour arrière de 0485 : retrait du déclencheur et de sa fonction. Les lignes déjà écrites au journal d'audit
-- restent (le journal ne se modifie pas).
drop trigger if exists zz_trace_inscription on public.session_trainees;
drop function if exists app.trace_inscription();
delete from public.schema_migrations where version = '0485_trace_inscriptions';
