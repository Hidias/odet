-- Retour arrière de 0261_registre_migrations.sql : retire l'inscription faite par 0261. Idempotent.
-- 0190 n'est retirée que si elle a été inscrite par 0261 (même instant d'inscription, même transaction) :
-- une inscription faite par 0190 elle-même reste en place.

delete from public.schema_migrations s
where s.version = '0190_passeport_prevention'
  and exists (select 1 from public.schema_migrations r
              where r.version = '0261_registre_migrations' and r.applied_at = s.applied_at)
  and (select count(*) from public.schema_migrations x
       where x.applied_at = s.applied_at) = 2;

delete from public.schema_migrations where version = '0261_registre_migrations';
