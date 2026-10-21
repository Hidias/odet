-- Retour arrière de 0408_reunions.sql. Les réunions et trames saisies sont effacées ; le point de la semaine reprend
-- sa préparation de 0407 (la personne choisie à la main n'est plus gardée). Idempotent.

drop table if exists public.meetings;
drop table if exists public.meeting_templates;
drop function if exists app.meetings_maj();
drop function if exists app.meeting_templates_maj();

create or replace function app.point_preparer(p_company uuid, p_week date, p_kind text, p_by uuid)
returns public.weekly_briefs
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  w date := date_trunc('week', p_week)::date;
  v_old jsonb;
  v_new jsonb;
  r public.weekly_briefs;
begin
  if p_kind not in ('point', 'bilan') then raise exception 'Type inconnu' using errcode = '22023'; end if;
  select lines into v_old from public.weekly_briefs where company_id = p_company and week_start = w and kind = p_kind;
  v_old := coalesce(v_old, '[]'::jsonb);
  select coalesce(jsonb_agg(a.l || coalesce((
      select jsonb_strip_nulls(jsonb_build_object('retire', o->'retire', 'suite', o->'suite', 'action_id', o->'action_id', 'note', o->'note'))
      from jsonb_array_elements(v_old) o where o->>'id' = a.l->>'id' limit 1), '{}'::jsonb) order by a.n), '[]'::jsonb)
    into v_new
  from jsonb_array_elements(app.point_lignes(p_company, w, p_kind)) with ordinality a(l, n);
  v_new := v_new || coalesce((select jsonb_agg(o) from jsonb_array_elements(v_old) o
                              where coalesce((o->>'manuel')::boolean, false)
                                and not exists (select 1 from jsonb_array_elements(v_new) x where x->>'id' = o->>'id')), '[]'::jsonb);
  insert into public.weekly_briefs (company_id, week_start, kind, lines, prepared_at, prepared_by)
  values (p_company, w, p_kind, v_new, now(), p_by)
  on conflict (company_id, week_start, kind) do update set lines = excluded.lines, prepared_at = now(), prepared_by = p_by
  returning * into r;
  return r;
end
$$;
revoke all on function app.point_preparer(uuid, date, text, uuid) from public, anon, authenticated;

delete from public.schema_migrations where version = '0408_reunions';
