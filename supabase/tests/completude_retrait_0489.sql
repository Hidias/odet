-- Essai local de 0489 : detect_completude_blockers n'existe plus ; les tables de complétude restent en place.
begin;
do $$
begin
  if to_regprocedure('public.detect_completude_blockers()') is not null then
    raise exception 'detect_completude_blockers existe encore';
  end if;
  if to_regclass('public.completude_alerts') is null or to_regclass('public.completude_tracking') is null then
    raise exception 'table de complétude retirée à tort';
  end if;
  if not exists (select 1 from public.schema_migrations where version = '0489_completude_retrait') then
    raise exception '0489 non inscrite';
  end if;
end $$;
rollback;
