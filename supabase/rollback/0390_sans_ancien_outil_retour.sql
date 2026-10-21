-- Retour arrière de 0390_sans_ancien_outil.sql : remet les adresses vidées, puis supprime la table de garde. Idempotent.

do $retour$
begin
  if to_regclass('app.retrait_ancien_outil') is null then return; end if;
  update public.courses c set program_url = r.donnees->>'program_url'
  from app.retrait_ancien_outil r where r.table_name = 'courses' and r.row_id = c.id;
  update public.trainers t set signature_url = r.donnees->>'signature_url'
  from app.retrait_ancien_outil r where r.table_name = 'trainers' and r.row_id = t.id;
end
$retour$;

drop table if exists app.retrait_ancien_outil;

delete from public.schema_migrations where version = '0390_sans_ancien_outil';
