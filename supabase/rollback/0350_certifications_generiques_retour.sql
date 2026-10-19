-- Retour arrière de 0350_certifications_generiques.sql : retire les certifications de la société, la face interne,
-- les colonnes génériques des référentiels et le squelette APSAD. Idempotent.
-- Refusé si une société a créé son propre référentiel ou importé des exigences APSAD : sans la colonne company_id, ces
-- lignes deviendraient lisibles par toutes les sociétés.

do $$
begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'cert_referentials' and column_name = 'company_id')
     and exists (select 1 from public.cert_referentials where company_id is not null) then
    raise exception 'Retour arrière refusé : des référentiels appartiennent à une société (à exporter puis supprimer d''abord)';
  end if;
  if exists (select 1 from public.cert_criteria where referential_code = 'apsad-i4nf285')
     or exists (select 1 from public.cert_indicators where referential_code = 'apsad-i4nf285') then
    raise exception 'Retour arrière refusé : des exigences APSAD ont été importées';
  end if;
end $$;

-- Départ d'une nouvelle société : version de 0344
create or replace function app.societe_referentiels_depart()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.subcontractor_doc_types_depart(new.id);
  if to_regprocedure('app.obligation_rules_depart(uuid)') is not null then
    execute 'select app.obligation_rules_depart($1)' using new.id;
  end if;
  if to_regprocedure('app.commercial_lists_depart(uuid)') is not null then
    execute 'select app.commercial_lists_depart($1)' using new.id;
  end if;
  if to_regprocedure('app.rgpd_sous_traitants_depart(uuid)') is not null then
    execute 'select app.rgpd_sous_traitants_depart($1)' using new.id;
  end if;
  if to_regprocedure('app.rgpd_purge_regles_depart(uuid)') is not null then
    execute 'select app.rgpd_purge_regles_depart($1)' using new.id;
  end if;
  return null;
end
$$;
revoke all on function app.societe_referentiels_depart() from public, anon, authenticated;

drop function if exists public.cert_importer_texte(text, jsonb);
drop function if exists app.cert_pitfalls_depart(uuid);
drop table if exists public.cert_pitfalls;
drop function if exists app.cert_valid(uuid, text);
drop table if exists public.cert_company_certifications;
drop function if exists app.cert_maj();

do $$
declare t text;
begin
  foreach t in array array['cert_referentials', 'cert_criteria', 'cert_indicators'] loop
    execute format('drop policy if exists %I on public.%I', t || '_societe_lire', t);
    execute format('drop policy if exists %I on public.%I', t || '_societe_creer', t);
    execute format('drop policy if exists %I on public.%I', t || '_societe_modifier', t);
    execute format('drop policy if exists %I on public.%I', t || '_societe_supprimer', t);
  end loop;
end $$;
drop function if exists app.cert_ref_lisible(text);
drop function if exists app.cert_ref_ecriture(text);

delete from public.cert_referentials where code = 'apsad-i4nf285';
alter table public.cert_indicators drop column if exists imported_from;
alter table public.cert_indicators drop column if exists code;
alter table public.cert_criteria drop column if exists code;
alter table public.cert_referentials drop constraint if exists cert_referentials_kind_check;
alter table public.cert_referentials drop constraint if exists cert_referentials_text_source_check;
alter table public.cert_referentials drop column if exists company_id;
alter table public.cert_referentials drop column if exists text_source;
alter table public.cert_referentials drop column if exists issuer;
alter table public.cert_referentials drop column if exists kind;

delete from public.schema_migrations where version = '0350_certifications_generiques';
