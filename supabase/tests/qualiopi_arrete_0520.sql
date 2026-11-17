-- Essai de 0520 : nouveaux entrants du référentiel au 1er novembre 2026 selon l'arrêté du 28 octobre 2026,
-- référentiel de 2019 inchangé, plus aucune mention « non paru ». Rouge sans 0520. Aucune donnée créée.
begin;
do $$
declare v text;
begin
  select string_agg(number::text, ',' order by number) into v from public.cert_indicators
   where referential_code = 'rnq-2026' and new_entrant_light;
  if v is distinct from '2,3,11,13,14,19,24,25,26' then raise exception '1. nouveaux entrants 2026 : %', v; end if;
  select string_agg(number::text, ',' order by number) into v from public.cert_indicators
   where referential_code = 'rnq-2019' and new_entrant_light;
  if v is distinct from '2,3,11,13,14,19,22,24,25,26,32' then raise exception '2. référentiel 2019 touché : %', v; end if;
  if exists (select 1 from public.cert_indicators where referential_code = 'rnq-2026' and change_note ilike '%non paru%')
     or exists (select 1 from public.cert_referentials where code = 'rnq-2026' and notes ilike '%non paru%') then
    raise exception '3. mention « non paru » restée';
  end if;
  if not exists (select 1 from public.cert_indicators where referential_code = 'rnq-2026' and number = 19 and change_note like '%huit intervenants%')
     or not exists (select 1 from public.cert_indicators where referential_code = 'rnq-2026' and number = 20 and change_note like '%50 %%') then
    raise exception '4. seuils absents';
  end if;
end
$$;
rollback;
