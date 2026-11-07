-- Essai de 0508 : contacts en « NOM Prénom ». Rouge sans 0508.
-- Données d'essai créées ici (une société existante seulement), tout est annulé.
begin;
set local client_min_messages = warning;

do $$
declare
  v_cie uuid; v_cl uuid; v_cl2 uuid; c1 uuid; c2 uuid; c3 uuid; c4 uuid; c5 uuid; c6 uuid; v_n text; v_f text; v_l text;
begin
  select id into v_cie from public.companies limit 1;
  insert into public.clients (name, company_id) values ('ESSAI 0508', v_cie) returning id into v_cl;

  -- 1. Nom et prénom saisis : nom en majuscules (accents et particules), prénom composé remis en forme, nom affiché « NOM Prénom »
  insert into public.client_contacts (client_id, name, last_name, first_name, is_primary)
    values (v_cl, 'x', '  le   régent ', 'jEAN-pierre  marie', true) returning id into c1;
  select name, first_name, last_name into v_n, v_f, v_l from public.client_contacts where id = c1;
  if v_l is distinct from 'LE RÉGENT' then raise exception '1. nom : %', v_l; end if;
  if v_f is distinct from 'Jean-Pierre Marie' then raise exception '1. prénom : %', v_f; end if;
  if v_n is distinct from 'LE RÉGENT Jean-Pierre Marie' then raise exception '1. nom affiché : %', v_n; end if;
  -- recopié sur la fiche client par client_contact_to_client (contact principal)
  if (select contact_name from public.clients where id = v_cl) is distinct from 'LE RÉGENT Jean-Pierre Marie' then
    raise exception '1. fiche client : %', (select contact_name from public.clients where id = v_cl); end if;

  -- 2. Nom seul (« Mme Martin ») : nom affiché « MARTIN », civilité gardée ; prénom seul : « Olga »
  insert into public.client_contacts (client_id, name, civilite, last_name) values (v_cl, 'Mme Martin', 'Mme', 'martin') returning id into c2;
  if (select name from public.client_contacts where id = c2) is distinct from 'MARTIN' then raise exception '2. nom seul'; end if;
  insert into public.client_contacts (client_id, name, first_name) values (v_cl, 'olga', ' olga ') returning id into c3;
  if (select name from public.client_contacts where id = c3) is distinct from 'Olga' then raise exception '2. prénom seul'; end if;

  -- 3. Sans nom ni prénom séparés : nom libre gardé tel quel
  insert into public.client_contacts (client_id, name) values (v_cl, 'Contact général') returning id into c4;
  if (select name from public.client_contacts where id = c4) is distinct from 'Contact général' then raise exception '3. nom libre changé'; end if;

  -- 4. Modification du prénom : nom affiché recalculé
  update public.client_contacts set first_name = 'claire' where id = c2;
  if (select name from public.client_contacts where id = c2) is distinct from 'MARTIN Claire' then raise exception '4. recalcul'; end if;

  -- 5. Nom libre écrit seul (champ « contact » de la fiche client) : il l'emporte, nom et prénom séparés vidés
  update public.clients set contact_name = 'Paul Durand' where id = v_cl;
  select name, first_name, last_name into v_n, v_f, v_l from public.client_contacts where id = c1;
  if v_n is distinct from 'Paul Durand' or v_f is not null or v_l is not null then
    raise exception '5. nom libre : % / % / %', v_n, v_f, v_l; end if;

  -- 6. Autre colonne modifiée : rien ne bouge (ni nom libre, ni séparés)
  update public.client_contacts set email = 'essai.0508@example.invalid' where id in (c2, c4);
  if (select name from public.client_contacts where id = c2) is distinct from 'MARTIN Claire'
     or (select name from public.client_contacts where id = c4) is distinct from 'Contact général' then
    raise exception '6. nom changé par une autre colonne'; end if;

  -- 7. Nom et prénom vidés tous deux par l'écran : le nom affiché reste le dernier connu (jamais vide, colonne obligatoire)
  insert into public.client_contacts (client_id, name, last_name) values (v_cl, 'x', 'durand') returning id into c5;
  update public.client_contacts set last_name = '  ' where id = c5;
  select name, last_name into v_n, v_l from public.client_contacts where id = c5;
  if v_n is distinct from 'DURAND' or v_l is not null then raise exception '7. vidé : % / %', v_n, v_l; end if;
  -- 8. Espace insécable (copier-coller, import) traité comme un espace
  insert into public.client_contacts (client_id, name, last_name, first_name)
    values (v_cl, 'x', U&'\00A0durand\00A0', U&'jean\00A0pierre') returning id into c6;
  if (select name from public.client_contacts where id = c6) is distinct from 'DURAND Jean Pierre' then
    raise exception '8. espace insécable : %', (select name from public.client_contacts where id = c6); end if;
  update public.client_contacts set first_name = U&'\FEFFjean\202Fpierre\200B' where id = c6;
  if (select name from public.client_contacts where id = c6) is distinct from 'DURAND Jean Pierre' then
    raise exception '8. espaces fines et invisibles : %', (select name from public.client_contacts where id = c6); end if;
  -- tirets : « Jean Pierre Durand » renvoyé sur « DURAND Jean-Pierre » ne vide rien
  update public.client_contacts set first_name = 'jean-pierre' where id = c6;
  update public.client_contacts set name = 'Jean Pierre Durand' where id = c6;
  if (select first_name from public.client_contacts where id = c6) is distinct from 'Jean-Pierre' then raise exception '8. tiret'; end if;

  -- 9. Même nom renvoyé dans un autre ordre ou une autre casse (écran, inscription « Paul DURAND ») : rien n'est vidé
  insert into public.client_contacts (client_id, name, last_name, first_name) values (v_cl, 'x', 'durand', 'paul') returning id into c5;
  update public.client_contacts set name = 'Paul DURAND', email = 'q.0508@example.invalid' where id = c5;
  select name, first_name, last_name into v_n, v_f, v_l from public.client_contacts where id = c5;
  if v_n is distinct from 'DURAND Paul' or v_f is distinct from 'Paul' or v_l is distinct from 'DURAND' then
    raise exception '9. même nom renvoyé : % / % / %', v_n, v_f, v_l; end if;

  -- 10. Fiche client pas rechargée (ancien « Paul Durand » renvoyé), puis téléphone seul changé : nom et prénom gardés
  insert into public.clients (name, company_id, contact_name, contact_email) values ('ESSAI 0508 B', v_cie, 'Paul Durand', 'b.0508@example.invalid') returning id into v_cl2;
  update public.client_contacts set last_name = 'durand', first_name = 'paul' where client_id = v_cl2 and is_primary;
  if (select contact_name from public.clients where id = v_cl2) is distinct from 'DURAND Paul' then raise exception '10. fiche non recopiée'; end if;
  update public.clients set contact_name = 'Paul Durand', notes = 'note' where id = v_cl2;
  update public.clients set contact_phone = '0600000000' where id = v_cl2;
  update public.clients set contact_phone = '0600000001' where id = v_cl2;
  select name, first_name, last_name into v_n, v_f, v_l from public.client_contacts where client_id = v_cl2 and is_primary;
  if v_n is distinct from 'DURAND Paul' or v_f is distinct from 'Paul' or v_l is distinct from 'DURAND' then
    raise exception '10. fiche périmée : % / % / %', v_n, v_f, v_l; end if;
end
$$;

rollback;
