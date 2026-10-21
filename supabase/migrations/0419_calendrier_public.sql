-- 0419 : calendrier public des sessions inter (série du 21/10, n° 27). Une page publique de l'outil liste les
-- sessions inter publiées : formation, dates, horaires, ville, places restantes, prix par personne (ou « sur
-- demande »), avec la réserve de maintien choisie par l'organisme (décision de H du 21/10 : sessions publiées
-- directement, avec une mention qui couvre l'organisme en cas d'annulation). La même page s'intègre dans le site de
-- l'organisme (bloc à copier depuis les paramètres).
--   1. organization_settings : calendrier publié ou non (non par défaut), réserve de maintien (texte modifiable).
--   2. public.public_calendrier() : lecture publique, seulement si le calendrier est publié ; aucune donnée
--      personnelle (ni stagiaire, ni client, ni adresse précise).
-- Les sessions sont publiées une par une (sessions.is_public, prix public par personne : colonnes existantes).
-- Migration additive. Idempotente. Retour arrière : supabase/rollback/0419_calendrier_public_retour.sql

alter table public.organization_settings add column if not exists calendrier_public boolean not null default false;
alter table public.organization_settings add column if not exists mention_maintien text
  default 'Session maintenue sous réserve d''un nombre minimum d''inscrits et de la disponibilité du formateur. En cas de report ou d''annulation par l''organisme, l''inscription est sans frais pour vous et d''autres dates vous sont proposées.';
comment on column public.organization_settings.calendrier_public is 'Calendrier public des sessions inter publié (page publique et bloc pour le site)';
comment on column public.organization_settings.mention_maintien is 'Réserve de maintien des sessions inter, affichée au calendrier public, à l''inscription et sur les conventions';

create or replace function public.public_calendrier()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  o record;
  v_societe uuid := app.company_default();
begin
  select os.calendrier_public, os.name, os.phone, os.email, os.website, os.mention_maintien into o
    from public.organization_settings os limit 1;
  if not coalesce(o.calendrier_public, false) then
    return jsonb_build_object('publie', false);
  end if;
  return jsonb_build_object(
    'publie', true,
    'organisme', jsonb_build_object('name', o.name, 'phone', o.phone, 'email', o.email, 'website', o.website),
    'mention_maintien', o.mention_maintien,
    'sessions', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', s.id, 'reference', s.reference, 'course_id', s.course_id, 'title', co.title, 'code', co.code,
               'duration_hours', co.duration_hours, 'duration_days', co.duration_days,
               'start_date', s.start_date, 'end_date', coalesce(s.end_date, s.start_date),
               'start_time', s.start_time, 'end_time', s.end_time,
               'city', s.location_city, 'postal_code', s.location_postal_code, 'is_remote', coalesce(s.is_remote, false),
               'price_per_person', s.public_price_per_person,
               'places', case when s.max_participants is null then null
                              else greatest(s.max_participants - (select count(*) from public.session_trainees st
                                                                   where st.session_id = s.id and not coalesce(st.absent, false)), 0) end)
             order by s.start_date, co.title)
      from public.sessions s left join public.courses co on co.id = s.course_id
      where s.company_id = v_societe and s.session_type = 'inter' and coalesce(s.is_public, false)
        and s.start_date >= (now() at time zone 'Europe/Paris')::date
        and coalesce(s.status, '') not in ('cancelled', 'annulee')), '[]'::jsonb)
  );
end
$$;
revoke all on function public.public_calendrier() from public;
grant execute on function public.public_calendrier() to anon, authenticated;

insert into public.schema_migrations (version) values ('0419_calendrier_public') on conflict (version) do nothing;
