-- Retour arrière de 0446_devis_avenant.sql. Idempotent. Refusé s'il existe déjà des avenants (ce seraient des devis
-- sans rattachement) : les retirer d'abord.
do $do$
declare
  v_def text := pg_get_functiondef('app.devis_signe_sessions()'::regprocedure);
begin
  if to_regclass('public.quotes') is not null and exists (select 1 from information_schema.columns where table_name = 'quotes' and column_name = 'amendment_of')
     and exists (select 1 from public.quotes where amendment_of is not null) then
    raise exception 'Des avenants existent : retour arrière refusé';
  end if;
  if position('amendment_of is null' in v_def) > 0 then
    execute replace(replace(v_def, $b$  -- Un avenant (0446) ne prépare pas de session : seul le devis le fait
$b$, ''), 'if new.amendment_of is null and new.status in', 'if new.status in');
  end if;
end
$do$;
revoke all on function app.devis_signe_sessions() from public, anon, authenticated;
drop function if exists public.devis_avenant(uuid, text);
update public.billing_settings set mentions_devis = mentions_devis - 'avenant';
alter table public.billing_settings alter column mentions_devis set default $j${
  "cgv": "L'acceptation du devis vaut acceptation des conditions générales jointes.",
  "distance": "Devis établi sur la base des informations transmises par le client le {date} ({infos}), sous réserve de vérification lors d'une visite préalable ou le jour de l'intervention. Tout écart fera l'objet d'un avenant soumis à votre accord avant exécution.",
  "materiel": "Prix du matériel sous réserve de disponibilité et de variation des tarifs du fournisseur au-delà de la durée de validité du devis.",
  "acompte": "Acompte de {pct} % à la commande, solde à la livraison ou à la réception des travaux.",
  "delai": "Délai de livraison ou d'intervention : {delai}.",
  "eco": "Dont éco-participation : {montant} HT.",
  "retractation": "Contrat conclu hors établissement ou à distance : vous disposez d'un délai de rétractation de 14 jours (article L221-18 du Code de la consommation). Un formulaire de rétractation est joint au devis.",
  "garanties": "Le matériel vendu bénéficie de la garantie légale de conformité de deux ans (articles L217-3 et suivants du Code de la consommation) et de la garantie des vices cachés (articles 1641 et suivants du Code civil).",
  "tva_reduite": "En qualité de preneur de la prestation, j'atteste que les travaux se rapportent à des locaux à usage d'habitation achevés depuis plus de deux ans et qu'ils respectent les conditions prévues par les articles 279-0 bis et 278-0 bis A du code général des impôts.",
  "decennale": "Assurance responsabilité civile décennale : {assureur}, contrat n° {contrat}, couverture géographique : {couverture}.",
  "rc_pro": "Assurance responsabilité civile professionnelle : {assureur}, contrat n° {contrat}, couverture géographique : {couverture}.",
  "dechets": "Déchets de chantier : {dechets}."
}$j$::jsonb;
drop index if exists public.quotes_amendment_of_idx;
alter table public.quotes drop constraint if exists quotes_avenant_motif_check;
alter table public.quotes drop constraint if exists quotes_avenant_check;
alter table public.quotes drop column if exists amendment_reason;
alter table public.quotes drop column if exists amendment_number;
alter table public.quotes drop column if exists amendment_of;
delete from public.schema_migrations where version = '0446_devis_avenant';
