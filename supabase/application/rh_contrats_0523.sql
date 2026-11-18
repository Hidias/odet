-- FICHIER GÉNÉRÉ par scripts/migrations/fabriquer_lot.py (rh_contrats_0523) : ne pas modifier à la main.
-- APPLICATION RÉELLE sur l'instance : 0523_rh_contrats.sql. Une seule transaction : si une instruction échoue,
-- rien n'est appliqué. Retour arrière : supabase/rollback/0523_rh_contrats_retour.sql
select set_config('lock_timeout', '5s', true), set_config('statement_timeout', '300s', true);

-- ===== supabase/migrations/0523_rh_contrats.sql =====
-- 0523 : contrats de travail et avenants (CDI, CDD, avenant) générés en PDF depuis la fiche du personnel.
-- Conception validée par H : claude/odet-rh-contrats-conception-2026-11-18.md ; plan : claude/odet-rh-contrats-plan-0523.md.
-- Choix de H (18/11) : signature papier scannée d'abord ; aucun modèle existant, la base proposée attend l'avocat ;
-- convention collective : Métallurgie, IDCC 3248 (saisie par la société, rien n'est posé ici).
-- Sources (lues le 18/11/2026) :
--   - L1221-5-1, R1221-34 (informations à remettre), R1221-35 (délai de 7 jours pour 1° à 5°, 7°, 11° et 12° ; renvoi aux
--     textes permis pour 7° à 12° et 14° ; le reste sous un mois), en vigueur le 01/11/2023.
--   - L1242-2 (cas de recours au CDD), L1242-7 (CDD sans terme précis), L1242-12 (mentions du CDD), L1242-13 (CDD transmis
--     au plus tard dans les deux jours ouvrables suivant l'embauche), L1243-13 et L1243-13-1 (renouvellement).
--   - L4154-2 (postes à risques particuliers, formation renforcée à la sécurité).
-- Règles :
--   1. hr_settings : nom de la convention collective (l'IDCC est celui de la société, companies.idcc, sans double saisie),
--      caisse de retraite complémentaire, organisme de prévoyance, modalités de paie. Rien n'est inventé : tout est saisi.
--   2. hr_employments : lieux de travail, motif du CDD (L1242-2 : remplacement, accroissement, saisonnier, chef
--      d'entreprise), salarié remplacé, durée minimale (sans terme précis : remplacement ou saisonnier, L1242-7),
--      renouvelable, poste à risques (L4154-2), contrat remis le, contrat signé (document).
--   3. hr_contract_models : un modèle par société, type et version ; statut « projet » tant que l'avocat n'a pas validé ;
--      validé : texte figé (nouvelle version pour toute modification), validateur et date obligatoires. v1 posée en
--      « projet » pour chaque société (app.hr_modeles_contrat_depart, rejouable par public.hr_modeles_contrat_poser).
--      Texte : seulement les mentions imposées, renvois aux textes permis par R1221-35 ; aucune clause facultative.
--   4. hr_contract_amendments : avenant rattaché au contrat (date d'effet, objet, lignes avant et après), document
--      généré et document signé, remis le. Lu par la personne ou avec « Documents restreints » (un avenant peut changer
--      la rémunération), tenu avec « Tenir les dossiers » et « Documents restreints ».
--   5. hr_documents : generated_from (type@version:statut) et content_sha256 (empreinte du PDF généré).
--   6. Contrat signé déposé : la ligne « Contrat signé et rangé dans les documents » de la liste d'arrivée se coche seule.
--   7. v_hr_echeances : « contrat_remis » (contrat écrit à remettre) : CDD à début + 2 jours ouvrables (dimanches et jours
--      fériés chômés de la société exclus), CDI, apprentissage et professionnalisation à début + 7 jours (R1221-35) ;
--      tant que « remis le » est vide, pour les contrats commencés depuis 30 jours au plus. Corps des huit autres
--      branches repris de 0522 à l'identique.
-- Additive. Idempotente. Retour arrière : supabase/rollback/0523_rh_contrats_retour.sql

-- ── 1. Paramètres RH ──
alter table public.hr_settings add column if not exists collective_agreement_name text;
alter table public.hr_settings add column if not exists retirement_fund text;
alter table public.hr_settings add column if not exists prevoyance_org text;
alter table public.hr_settings add column if not exists pay_terms text;
alter table public.hr_settings drop constraint if exists hr_settings_contrats_longueurs;
alter table public.hr_settings add constraint hr_settings_contrats_longueurs check (
  (collective_agreement_name is null or length(collective_agreement_name) <= 300)
  and (retirement_fund is null or length(retirement_fund) <= 300)
  and (prevoyance_org is null or length(prevoyance_org) <= 300)
  and (pay_terms is null or length(pay_terms) <= 300));
comment on column public.hr_settings.collective_agreement_name is 'Intitulé de la convention collective (L1242-12, R1221-34 13°) ; l''IDCC est companies.idcc';
comment on column public.hr_settings.retirement_fund is 'Caisse de retraite complémentaire : nom et adresse (L1242-12)';
comment on column public.hr_settings.prevoyance_org is 'Organisme de prévoyance, le cas échéant : nom et adresse (L1242-12)';
comment on column public.hr_settings.pay_terms is 'Périodicité et mode de paiement de la rémunération (R1221-34 11°)';

-- ── 2. Contrats : champs des mentions obligatoires ──
alter table public.hr_employments add column if not exists work_places text;
alter table public.hr_employments add column if not exists cdd_reason text;
alter table public.hr_employments add column if not exists cdd_replaced_name text;
alter table public.hr_employments add column if not exists cdd_replaced_qualification text;
alter table public.hr_employments add column if not exists cdd_min_end_on date;
alter table public.hr_employments add column if not exists cdd_renewable boolean not null default false;
alter table public.hr_employments add column if not exists risky_post boolean not null default false;
alter table public.hr_employments add column if not exists contract_handed_on date;
alter table public.hr_employments add column if not exists signed_document_id uuid references public.hr_documents(id) on delete set null;
alter table public.hr_employments drop constraint if exists hr_employments_contrat_ecrit;
alter table public.hr_employments add constraint hr_employments_contrat_ecrit check (
  (work_places is null or length(work_places) <= 500)
  and (cdd_replaced_name is null or length(cdd_replaced_name) <= 200)
  and (cdd_replaced_qualification is null or length(cdd_replaced_qualification) <= 200)
  and (cdd_reason is null or (contract_type = 'cdd' and cdd_reason in (
        'remplacement_absence', 'remplacement_temps_partiel', 'remplacement_suspension', 'remplacement_depart',
        'remplacement_attente_cdi', 'accroissement', 'saisonnier', 'remplacement_chef_entreprise')))
  -- Sans terme précis (L1242-7) : remplacement ou emploi saisonnier, et pas de date de fin
  and (cdd_min_end_on is null or (contract_type = 'cdd' and end_on is null and cdd_min_end_on >= start_on
        and coalesce(cdd_reason, '') <> 'accroissement'))
  and (contract_type = 'cdd' or not cdd_renewable));
comment on column public.hr_employments.cdd_reason is 'Motif du CDD (L1242-2) : remplacement (5 cas), accroissement, saisonnier, remplacement d''un chef d''entreprise';
comment on column public.hr_employments.cdd_min_end_on is 'CDD sans terme précis (L1242-7) : fin de la durée minimale';
comment on column public.hr_employments.risky_post is 'Poste sur la liste des postes à risques particuliers (L4154-2)';
comment on column public.hr_employments.contract_handed_on is 'Contrat écrit remis au salarié le (L1242-13 pour le CDD, R1221-35)';
comment on column public.hr_employments.signed_document_id is 'Contrat signé (scan) dans les documents RH';

-- Document signé : celui de la personne ; déposé, la ligne « Contrat signé » de la liste d'arrivée se coche
create or replace function app.hr_contrat_document()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.signed_document_id is not null and (tg_op = 'INSERT' or new.signed_document_id is distinct from old.signed_document_id) then
    if not exists (select 1 from public.hr_documents d where d.id = new.signed_document_id and d.person_id = new.person_id) then
      raise exception 'Ce document n''est pas celui de cette personne' using errcode = '22023';
    end if;
    update public.hr_checklists l
       set items = (select coalesce(jsonb_agg(case when x->>'label' = 'Contrat signé et rangé dans les documents' and coalesce(x->>'done_on', '') = ''
                                              then x || jsonb_build_object('done_on', (now() at time zone 'Europe/Paris')::date, 'done_by', auth.uid())
                                              else x end order by o), '[]'::jsonb)
                    from jsonb_array_elements(l.items) with ordinality as t(x, o))
     where l.person_id = new.person_id and l.kind = 'arrivee'
       and exists (select 1 from jsonb_array_elements(l.items) x where x->>'label' = 'Contrat signé et rangé dans les documents' and coalesce(x->>'done_on', '') = '');
  end if;
  return new;
end
$$;
revoke all on function app.hr_contrat_document() from public, anon, authenticated;
drop trigger if exists hr_employments_document on public.hr_employments;
create trigger hr_employments_document before insert or update on public.hr_employments
  for each row execute function app.hr_contrat_document();

-- ── 3. Documents générés : traçabilité ──
alter table public.hr_documents add column if not exists generated_from text;
alter table public.hr_documents add column if not exists content_sha256 text;
alter table public.hr_documents drop constraint if exists hr_documents_genere;
alter table public.hr_documents add constraint hr_documents_genere check (
  (generated_from is null or generated_from ~ '^(cdi|cdd|avenant)@[0-9]+:(projet|valide)$')
  and (content_sha256 is null or content_sha256 ~ '^[0-9a-f]{64}$'));
comment on column public.hr_documents.generated_from is 'Modèle qui a produit le document : type@version:statut (0523)';
comment on column public.hr_documents.content_sha256 is 'Empreinte SHA-256 du PDF généré (0523)';

-- ── 4. Modèles ──
create table if not exists public.hr_contract_models (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default app.company_default() references public.companies(id) on delete cascade,
  kind text not null check (kind in ('cdi', 'cdd', 'avenant')),
  version int not null default 1 check (version >= 1),
  title text not null check (length(btrim(title)) > 0 and length(title) <= 200),
  -- [{ "titre": "...", "texte": "... {{champ}} ...", "si": "condition" }] ; conditions lues par rhContrats.js
  articles jsonb not null check (jsonb_typeof(articles) = 'array' and jsonb_array_length(articles) between 1 and 60),
  status text not null default 'projet' check (status in ('projet', 'valide')),
  validated_on date,
  validated_by_name text check (validated_by_name is null or length(validated_by_name) <= 200),
  note text check (note is null or length(note) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, kind, version),
  constraint hr_contract_models_validation check (
    (status = 'projet' and validated_on is null and validated_by_name is null)
    or (status = 'valide' and validated_on is not null and length(btrim(coalesce(validated_by_name, ''))) > 0))
);
create index if not exists hr_contract_models_company_idx on public.hr_contract_models (company_id);
comment on table public.hr_contract_models is 'Modèles de contrat (CDI, CDD) et d''avenant par société ; « projet » tant que l''avocat n''a pas validé, texte figé une fois validé';

create or replace function app.hr_modele_avant()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if old.status = 'valide' then
      raise exception 'Modèle validé : il ne se supprime pas (il a pu servir à des contrats)' using errcode = '22023';
    end if;
    return old;
  end if;
  if tg_op = 'UPDATE' then
    if old.status = 'valide' and (new.status <> 'valide' or new.articles is distinct from old.articles or new.kind <> old.kind
        or new.version <> old.version or new.title <> old.title or new.validated_on is distinct from old.validated_on
        or new.validated_by_name is distinct from old.validated_by_name) then
      raise exception 'Modèle validé : son texte est figé ; créez une nouvelle version' using errcode = '22023';
    end if;
    new.created_at := old.created_at; new.company_id := old.company_id;
  else
    new.created_at := now();
  end if;
  new.updated_at := now();
  return new;
end
$$;
revoke all on function app.hr_modele_avant() from public, anon, authenticated;
drop trigger if exists hr_contract_models_avant on public.hr_contract_models;
create trigger hr_contract_models_avant before insert or update or delete on public.hr_contract_models
  for each row execute function app.hr_modele_avant();

-- Modèles de départ (v1, « projet ») : mentions imposées seulement, à valider par l'avocat
create or replace function app.hr_modeles_contrat_depart(p_company uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.hr_contract_models (company_id, kind, version, title, articles, status, note)
  select p_company, m.kind, 1, m.title, m.articles, 'projet', 'Base proposée le 18/11/2026 (0523) : mentions imposées par le Code du travail, à valider par l''avocat avant tout usage'
  from (values
    ('cdi', 'Contrat de travail à durée indéterminée', $j$[
      {"titre": "Engagement", "texte": "{{employeur_nom}}, {{employeur_forme}}, SIREN {{employeur_siren}}, dont le siège est situé {{employeur_adresse}}, ci-après l'employeur, engage {{salarie_nom}}, demeurant {{salarie_adresse}}, ci-après le salarié, par contrat de travail à durée indéterminée à compter du {{date_debut}}."},
      {"titre": "Poste et qualification", "texte": "Le salarié occupe l'emploi de {{poste_intitule}}, qualification ou catégorie : {{qualification}}."},
      {"titre": "Fonctions", "texte": "{{poste_fonctions}}", "si": "fonctions"},
      {"titre": "Lieu de travail", "texte": "{{lieux_travail}}"},
      {"titre": "Période d'essai", "texte": "Le contrat comporte une période d'essai qui prend fin le {{essai_fin}}. Ses conditions sont celles des articles L1221-19 et suivants du Code du travail et de la convention collective applicable.", "si": "essai"},
      {"titre": "Durée du travail", "texte": "{{duree_travail}} Les heures supplémentaires et leurs majorations suivent les articles L3121-28 et suivants du Code du travail et la convention collective applicable."},
      {"titre": "Rémunération", "texte": "Le salarié perçoit une rémunération brute de {{remuneration}}. Elle est versée {{paie_modalites}}."},
      {"titre": "Congés payés", "texte": "Le salarié bénéficie des congés payés prévus par les articles L3141-1 et suivants du Code du travail et par la convention collective applicable."},
      {"titre": "Formation", "texte": "Le salarié bénéficie des actions de formation assurées par l'employeur en application de l'article L6321-1 du Code du travail."},
      {"titre": "Convention collective", "texte": "Le contrat relève de la convention collective {{convention_nom}} (IDCC {{convention_idcc}})."},
      {"titre": "Protection sociale", "texte": "Caisse de retraite complémentaire : {{caisse_retraite}}."},
      {"titre": "Prévoyance", "texte": "Organisme de prévoyance : {{prevoyance}}.", "si": "prevoyance"},
      {"titre": "Rupture du contrat", "texte": "En cas de rupture du contrat, la procédure et le préavis sont ceux des articles L1231-1 et suivants du Code du travail et de la convention collective applicable."}
    ]$j$::jsonb),
    ('cdd', 'Contrat de travail à durée déterminée', $j$[
      {"titre": "Engagement", "texte": "{{employeur_nom}}, {{employeur_forme}}, SIREN {{employeur_siren}}, dont le siège est situé {{employeur_adresse}}, ci-après l'employeur, engage {{salarie_nom}}, demeurant {{salarie_adresse}}, ci-après le salarié, par contrat de travail à durée déterminée conclu en application de l'article L1242-2 du Code du travail."},
      {"titre": "Motif du recours", "texte": "Le contrat est conclu pour le motif suivant : {{motif_cdd}}."},
      {"titre": "Salarié remplacé", "texte": "Le salarié remplace {{remplace_nom}}, qualification : {{remplace_qualification}}.", "si": "remplacement"},
      {"titre": "Durée du contrat", "texte": "Le contrat débute le {{date_debut}} et prend fin le {{date_fin}}.", "si": "terme_precis"},
      {"titre": "Durée du contrat", "texte": "Le contrat débute le {{date_debut}}. Il est conclu sans terme précis pour une durée minimale allant jusqu'au {{duree_minimale}} ; il prend fin à la fin de l'absence de la personne remplacée ou à la réalisation de l'objet pour lequel il a été conclu (article L1242-7 du Code du travail).", "si": "sans_terme"},
      {"titre": "Renouvellement", "texte": "Le contrat peut être renouvelé dans les conditions des articles L1243-13 et L1243-13-1 du Code du travail ; le renouvellement fait l'objet d'un avenant soumis au salarié avant le terme initialement prévu.", "si": "renouvelable"},
      {"titre": "Poste et qualification", "texte": "Le salarié occupe l'emploi de {{poste_intitule}}, qualification ou catégorie : {{qualification}}."},
      {"titre": "Fonctions", "texte": "{{poste_fonctions}}", "si": "fonctions"},
      {"titre": "Poste à risques particuliers", "texte": "Le poste figure sur la liste des postes présentant des risques particuliers pour la santé ou la sécurité (article L4154-2 du Code du travail) ; le salarié bénéficie d'une formation renforcée à la sécurité.", "si": "poste_risque"},
      {"titre": "Lieu de travail", "texte": "{{lieux_travail}}"},
      {"titre": "Période d'essai", "texte": "Le contrat comporte une période d'essai qui prend fin le {{essai_fin}}. Ses conditions sont celles de l'article L1242-10 du Code du travail et de la convention collective applicable.", "si": "essai"},
      {"titre": "Durée du travail", "texte": "{{duree_travail}} Les heures supplémentaires et leurs majorations suivent les articles L3121-28 et suivants du Code du travail et la convention collective applicable."},
      {"titre": "Rémunération", "texte": "Le salarié perçoit une rémunération brute de {{remuneration}}. Elle est versée {{paie_modalites}}."},
      {"titre": "Congés payés", "texte": "Le salarié bénéficie des congés payés prévus par les articles L3141-1 et suivants du Code du travail et par la convention collective applicable."},
      {"titre": "Formation", "texte": "Le salarié bénéficie des actions de formation assurées par l'employeur en application de l'article L6321-1 du Code du travail."},
      {"titre": "Convention collective", "texte": "Le contrat relève de la convention collective {{convention_nom}} (IDCC {{convention_idcc}})."},
      {"titre": "Protection sociale", "texte": "Caisse de retraite complémentaire : {{caisse_retraite}}."},
      {"titre": "Prévoyance", "texte": "Organisme de prévoyance : {{prevoyance}}.", "si": "prevoyance"},
      {"titre": "Rupture anticipée", "texte": "Le contrat ne peut être rompu avant son terme que dans les cas prévus aux articles L1243-1 et suivants du Code du travail."}
    ]$j$::jsonb),
    ('avenant', 'Avenant au contrat de travail', $j$[
      {"titre": "Parties", "texte": "{{employeur_nom}}, {{employeur_forme}}, SIREN {{employeur_siren}}, dont le siège est situé {{employeur_adresse}}, ci-après l'employeur, et {{salarie_nom}}, demeurant {{salarie_adresse}}, ci-après le salarié, conviennent du présent avenant au contrat de travail ({{contrat_type}}) qui a pris effet le {{date_debut}}."},
      {"titre": "Objet", "texte": "{{avenant_objet}}"},
      {"titre": "Modifications", "texte": "À compter du {{avenant_date_effet}}, les dispositions du contrat sont modifiées comme indiqué dans le tableau ci-dessous."},
      {"titre": "Autres dispositions", "texte": "Les autres dispositions du contrat de travail restent inchangées."}
    ]$j$::jsonb)
  ) as m(kind, title, articles)
  where not exists (select 1 from public.hr_contract_models x where x.company_id = p_company and x.kind = m.kind)
$$;
revoke all on function app.hr_modeles_contrat_depart(uuid) from public, anon, authenticated;
select app.hr_modeles_contrat_depart(c.id) from public.companies c;

-- Rejouable par qui règle les RH (société créée après 0523, ou modèle d'un type absent)
create or replace function public.hr_modeles_contrat_poser(p_company uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_company is null or p_company not in (select app.societes_avec_droit('rh.parametres.gerer')) then
    raise exception 'Droit « Configurer les RH » requis' using errcode = '42501';
  end if;
  perform app.hr_modeles_contrat_depart(p_company);
end
$$;
revoke all on function public.hr_modeles_contrat_poser(uuid) from public, anon;
grant execute on function public.hr_modeles_contrat_poser(uuid) to authenticated;

-- ── 5. Avenants ──
create table if not exists public.hr_contract_amendments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default app.company_default() references public.companies(id) on delete cascade,
  employment_id uuid not null references public.hr_employments(id) on delete cascade,
  person_id uuid not null references public.hr_people(id) on delete cascade,
  effective_on date not null,
  subject text not null check (length(btrim(subject)) > 0 and length(subject) <= 500),
  -- [{ "label": "...", "before": "...", "after": "..." }]
  changes jsonb not null default '[]'::jsonb check (jsonb_typeof(changes) = 'array' and jsonb_array_length(changes) between 1 and 20),
  generated_document_id uuid references public.hr_documents(id) on delete set null,
  signed_document_id uuid references public.hr_documents(id) on delete set null,
  handed_on date,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists hr_contract_amendments_employment_idx on public.hr_contract_amendments (employment_id);
create index if not exists hr_contract_amendments_company_idx on public.hr_contract_amendments (company_id);
comment on table public.hr_contract_amendments is 'Avenants au contrat de travail : date d''effet, objet, lignes avant et après, document généré et signé, remis le';

create or replace function app.hr_avenant_avant()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  select e.company_id, e.person_id into new.company_id, new.person_id from public.hr_employments e where e.id = new.employment_id;
  if new.person_id is null then
    raise exception 'Contrat introuvable' using errcode = 'P0002';
  end if;
  if tg_op = 'UPDATE' and new.company_id <> old.company_id then
    raise exception 'RH : le contrat appartient à une autre société' using errcode = '23514';
  end if;
  if exists (select 1 from jsonb_array_elements(new.changes) c
             where jsonb_typeof(c) <> 'object' or length(btrim(coalesce(c->>'label', ''))) = 0 or length(btrim(coalesce(c->>'after', ''))) = 0
                or length(coalesce(c->>'label', '')) > 200 or length(coalesce(c->>'before', '')) > 1000 or length(coalesce(c->>'after', '')) > 1000) then
    raise exception 'Chaque modification a un libellé et une nouvelle valeur' using errcode = '22023';
  end if;
  if (new.generated_document_id is not null and not exists (select 1 from public.hr_documents d where d.id = new.generated_document_id and d.person_id = new.person_id))
     or (new.signed_document_id is not null and not exists (select 1 from public.hr_documents d where d.id = new.signed_document_id and d.person_id = new.person_id)) then
    raise exception 'Ce document n''est pas celui de cette personne' using errcode = '22023';
  end if;
  -- Avenant signé : son contenu ne change plus (un nouvel avenant le corrige)
  if tg_op = 'UPDATE' and old.signed_document_id is not null
     and (new.effective_on <> old.effective_on or new.subject <> old.subject or new.changes is distinct from old.changes
          or new.employment_id <> old.employment_id) then
    raise exception 'Avenant signé : il ne se modifie plus' using errcode = '22023';
  end if;
  if tg_op = 'INSERT' then
    new.created_at := now(); new.created_by := coalesce(auth.uid(), new.created_by);
  else
    new.created_at := old.created_at; new.created_by := old.created_by;
  end if;
  new.updated_at := now();
  return new;
end
$$;
revoke all on function app.hr_avenant_avant() from public, anon, authenticated;
drop trigger if exists hr_contract_amendments_avant on public.hr_contract_amendments;
create trigger hr_contract_amendments_avant before insert or update on public.hr_contract_amendments
  for each row execute function app.hr_avenant_avant();

-- ── Droits ──
alter table public.hr_contract_models enable row level security;
alter table public.hr_contract_amendments enable row level security;
revoke all on table public.hr_contract_models, public.hr_contract_amendments from public, anon, authenticated;
grant select, insert, update, delete on table public.hr_contract_models, public.hr_contract_amendments to authenticated;
grant all on table public.hr_contract_models, public.hr_contract_amendments to service_role;

do $$
begin
  -- Modèles : comme les postes (0513) ; lus avec « Voir les dossiers » ou « Configurer les RH », tenus avec « Configurer les RH »
  drop policy if exists hr_contract_models_lire on public.hr_contract_models;
  drop policy if exists hr_contract_models_creer on public.hr_contract_models;
  drop policy if exists hr_contract_models_modifier on public.hr_contract_models;
  drop policy if exists hr_contract_models_supprimer on public.hr_contract_models;
  create policy hr_contract_models_lire on public.hr_contract_models for select to authenticated
    using ((company_id in (select app.societes_avec_droit('rh.dossiers.voir')) or company_id in (select app.societes_avec_droit('rh.parametres.gerer'))));
  create policy hr_contract_models_creer on public.hr_contract_models for insert to authenticated
    with check (company_id in (select app.societes_avec_droit('rh.parametres.gerer')));
  create policy hr_contract_models_modifier on public.hr_contract_models for update to authenticated
    using (company_id in (select app.societes_avec_droit('rh.parametres.gerer')))
    with check (company_id in (select app.societes_avec_droit('rh.parametres.gerer')));
  create policy hr_contract_models_supprimer on public.hr_contract_models for delete to authenticated
    using (company_id in (select app.societes_avec_droit('rh.parametres.gerer')));
  -- Avenants : la personne, ou « Documents restreints » (rémunération possible) ; tenus avec « Tenir les dossiers » et « Documents restreints »
  drop policy if exists hr_contract_amendments_lire on public.hr_contract_amendments;
  drop policy if exists hr_contract_amendments_creer on public.hr_contract_amendments;
  drop policy if exists hr_contract_amendments_modifier on public.hr_contract_amendments;
  drop policy if exists hr_contract_amendments_supprimer on public.hr_contract_amendments;
  create policy hr_contract_amendments_lire on public.hr_contract_amendments for select to authenticated
    using ((company_id in (select app.societes_avec_droit('rh.documents.restreints')) or person_id in (select app.hr_mes_personnes())));
  create policy hr_contract_amendments_creer on public.hr_contract_amendments for insert to authenticated
    with check ((company_id in (select app.societes_avec_droit('rh.dossiers.gerer')) and company_id in (select app.societes_avec_droit('rh.documents.restreints'))));
  create policy hr_contract_amendments_modifier on public.hr_contract_amendments for update to authenticated
    using ((company_id in (select app.societes_avec_droit('rh.dossiers.gerer')) and company_id in (select app.societes_avec_droit('rh.documents.restreints'))))
    with check ((company_id in (select app.societes_avec_droit('rh.dossiers.gerer')) and company_id in (select app.societes_avec_droit('rh.documents.restreints'))));
  create policy hr_contract_amendments_supprimer on public.hr_contract_amendments for delete to authenticated
    using ((company_id in (select app.societes_avec_droit('rh.dossiers.gerer')) and company_id in (select app.societes_avec_droit('rh.documents.restreints'))));
end $$;

-- Vue groupe en lecture seule (0516) : verrou posé sur les nouvelles tables
select app.vue_groupe_poser();

-- Journal
do $$
declare r record;
begin
  for r in select * from (values ('hr_contract_models', 'parametres_rh'), ('hr_contract_amendments', 'personnel')) as t(nom, type) loop
    execute format('drop trigger if exists zz_audit_row on public.%I', r.nom);
    execute format('create trigger zz_audit_row after insert or update or delete on public.%I for each row execute function app.audit_row(%L)', r.nom, r.type);
  end loop;
end $$;

-- ── 6. Échéances ──
-- n-ième jour ouvrable après p_jour (dimanches et jours fériés chômés de la société exclus ; L1242-13)
create or replace function app.hr_jour_ouvrable_apres(p_company uuid, p_jour date, p_n int)
returns date
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v date := p_jour; i int := 0;
begin
  if p_jour is null or p_n is null or p_n < 0 or p_n > 60 then return null; end if;
  while i < p_n loop
    v := v + 1;
    if extract(isodow from v) <> 7
       and not exists (select 1 from public.hr_public_holidays h where h.company_id = p_company and h.day = v and not h.is_worked) then
      i := i + 1;
    end if;
  end loop;
  return v;
end
$$;
revoke all on function app.hr_jour_ouvrable_apres(uuid, date, int) from public, anon;
grant execute on function app.hr_jour_ouvrable_apres(uuid, date, int) to authenticated;

create or replace view public.v_hr_echeances with (security_invoker = true) as
  -- Contrat le plus récent par personne non archivée, en cours ou qui commence dans les 30 jours
  with courant as (
    select distinct on (e.person_id) e.*
    from public.hr_employments e
    join public.hr_people p on p.id = e.person_id and p.archived_at is null
    where (e.end_on is null or e.end_on >= current_date) and e.start_on <= current_date + 30
    order by e.person_id, e.start_on desc, e.created_at desc)
  select q.company_id, q.person_id, 'habilitation'::text as kind, q.label, q.expires_on as due_on, q.id as source_id
  from public.hr_qualifications q
  where q.archived_at is null and q.expires_on is not null
  union all
  select m.company_id, m.person_id, 'visite', 'Visite de santé au travail', m.next_due_on, m.id
  from public.hr_medical_followups m
  where m.next_due_on is not null
    and not exists (select 1 from public.hr_medical_followups m2
                    where m2.person_id = m.person_id and m2.visit_on is not null and m2.visit_on >= m.next_due_on)
  union all
  select e.company_id, e.person_id, 'fin_contrat', 'Fin de contrat', e.end_on, e.id
  from public.hr_employments e
  where e.end_on is not null and e.end_on >= current_date - 30
  union all
  select e.company_id, e.person_id, 'fin_essai', 'Fin de la période d''essai', e.trial_end_on, e.id
  from public.hr_employments e
  where e.trial_end_on is not null and e.trial_end_on >= current_date - 30
  union all
  select r.company_id, r.person_id, 'entretien',
         case r.kind when 'parcours' then 'Entretien de parcours professionnel' when 'bilan' then 'Bilan du parcours professionnel'
                     when 'annuel' then 'Entretien annuel' else 'Entretien' end,
         coalesce(case when r.done_on is null then r.planned_on end, r.next_due_on), r.id
  from public.hr_reviews r
  where coalesce(case when r.done_on is null then r.planned_on end, r.next_due_on) is not null
    and not exists (select 1 from public.hr_reviews r2 where r2.person_id = r.person_id and r2.kind = r.kind
                    and r2.done_on is not null and r2.done_on > coalesce(r.done_on, r.planned_on, r.next_due_on))
  union all
  select e.company_id, e.person_id, 'dpae', 'Déclaration préalable à l''embauche (DPAE)', e.start_on, e.id
  from public.hr_employments e
  where e.dpae_sent_on is null
    and e.contract_type in ('cdi', 'cdd', 'apprentissage', 'professionnalisation')
    and e.start_on >= current_date - 30
  union all
  -- Contrat le plus récent de la personne (non archivée), sans accueil signé pour son poste depuis ce contrat ou les
  -- contrats enchaînés sur le même poste (app.hr_debut_continu) ; mandataire : sans objet
  select c.company_id, c.person_id, 'accueil_securite',
         case when coalesce((select i.job_id from public.hr_safety_inductions i where i.person_id = c.person_id and i.signed_at is not null
                             order by i.done_on desc, i.signed_at desc limit 1), c.job_id) is distinct from c.job_id
              then 'Accueil sécurité à refaire (changement de poste)' else 'Accueil sécurité' end,
         c.start_on, c.id
  from courant c
  where c.contract_type <> 'mandataire'
    and not exists (select 1 from public.hr_safety_inductions i
                    where i.person_id = c.person_id and i.signed_at is not null
                      and i.job_id is not distinct from c.job_id
                      and i.done_on >= app.hr_debut_continu(c.id) - 30)
  union all
  -- Poste « seul » sans mesure, ou mesure DATI sans DATI remis et non rendu ; daté du début du contrat
  select c.company_id, c.person_id, 'travail_isole',
         case when cardinality(j.lone_work_measures) = 0 then 'Travail isolé : aucune mesure sur le poste ' || j.name
              else 'Travail isolé : DATI à remettre' end,
         c.start_on, c.id
  from courant c
  join public.hr_jobs j on j.id = c.job_id and j.lone_work
  where cardinality(j.lone_work_measures) = 0
     or ('dati' = any (j.lone_work_measures) and not app.hr_dati_remis(c.person_id))
  union all
  -- Contrat écrit à remettre : CDD sous 2 jours ouvrables (L1242-13), autres contrats de salarié sous 7 jours (R1221-35)
  select e.company_id, e.person_id, 'contrat_remis',
         case when e.contract_type = 'cdd' then 'Contrat écrit à remettre (CDD : 2 jours ouvrables)' else 'Contrat écrit à remettre' end,
         case when e.contract_type = 'cdd' then app.hr_jour_ouvrable_apres(e.company_id, e.start_on, 2) else e.start_on + 7 end,
         e.id
  from public.hr_employments e
  join public.hr_people p on p.id = e.person_id and p.archived_at is null
  where e.contract_handed_on is null
    and e.contract_type in ('cdi', 'cdd', 'apprentissage', 'professionnalisation')
    and e.start_on >= current_date - 30
;
comment on view public.v_hr_echeances is 'Échéances RH (habilitations, visites, fins de CDD et d''essai, entretiens, DPAE, accueil sécurité, travail isolé, contrat écrit à remettre), aux droits du lecteur';
revoke all on public.v_hr_echeances from public, anon;
grant select on public.v_hr_echeances to authenticated;

insert into public.schema_migrations (version) values ('0523_rh_contrats') on conflict (version) do nothing;
