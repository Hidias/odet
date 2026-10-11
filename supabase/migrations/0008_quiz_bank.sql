-- 0008_quiz_bank.sql : banque de questions enrichie pour le moteur de quiz
--   - types 'open' (réponse libre, positionnement uniquement) et 'survey' (auto-évaluation, non notée)
--   - explications sur les questions notées existantes (affichées en entraînement et en évaluation)
--   - questions de niveau moyen et difficile par thème (le niveau n'est jamais montré au stagiaire)

alter table public.theme_questions drop constraint if exists theme_questions_kind_check;
alter table public.theme_questions
  add constraint theme_questions_kind_check check (kind in ('single', 'truefalse', 'order', 'image', 'open', 'survey'));

-- Questions ouvertes : positionnement seulement (pas de correction automatique)
update public.theme_questions set kind = 'open', for_evaluation = false, xp = 0
where question_type = 'open';

-- Questions d'auto-évaluation (sans bonne réponse) : positionnement seulement, non notées
update public.theme_questions set kind = 'survey', for_evaluation = false, xp = 0
where question_type = 'single_choice' and correct_index is null;

-- ------------------------------------------------------------
-- Explications des questions notées existantes (par thème et position)
-- ------------------------------------------------------------
create or replace function pg_temp.set_expl(p_code text, p_pos int, p_expl text) returns void language sql as $$
  update public.theme_questions q set explanation = p_expl
  from public.training_themes t
  where t.id = q.theme_id and t.code = p_code and q.position = p_pos;
$$;

select pg_temp.set_expl('SST', 5, $q$Protéger, Examiner, Alerter (ou faire alerter), Secourir : on sécurise d'abord la zone pour éviter un suraccident, puis on examine la victime avant d'alerter et d'agir.$q$);
select pg_temp.set_expl('SST', 6, $q$Un message d'alerte efficace donne le lieu précis, la nature de l'accident, le nombre de victimes et leur état. On ne raccroche jamais le premier.$q$);
select pg_temp.set_expl('SST', 7, $q$Une victime inconsciente qui respire est placée en position latérale de sécurité pour garder ses voies aériennes libres en attendant les secours.$q$);
select pg_temp.set_expl('SST', 8, $q$Pas de réponse, pas de respiration : on alerte (ou on fait alerter), on commence les compressions thoraciques et on utilise un défibrillateur dès qu'il est disponible.$q$);
select pg_temp.set_expl('SST', 9, $q$Face à une hémorragie importante, on comprime directement la plaie (ou on fait comprimer par la victime) et on alerte sans relâcher la compression.$q$);
select pg_temp.set_expl('SST', 10, $q$On refroidit une brûlure simple à l'eau tempérée pendant au moins 10 minutes puis on la protège. Jamais de glace directe ni de cloques percées.$q$);

select pg_temp.set_expl('INCENDIE', 0, $q$Alerter et se mettre en sécurité passe avant toute tentative d'extinction : l'alarme déclenche l'évacuation et prévient les secours.$q$);
select pg_temp.set_expl('INCENDIE', 1, $q$L'équipier de première intervention agit immédiatement avec les moyens disponibles sur place et participe à l'évacuation. Il ne remplace pas les sapeurs-pompiers.$q$);
select pg_temp.set_expl('INCENDIE', 2, $q$On repère toujours son issue de repli avant d'attaquer un feu, et on s'assure que l'alarme a été déclenchée.$q$);
select pg_temp.set_expl('INCENDIE', 3, $q$Les fumées sont toxiques et opaques : on n'engage pas, on ferme la porte si possible pour limiter la propagation, on alerte et on évacue par un chemin sûr.$q$);
select pg_temp.set_expl('INCENDIE', 4, $q$Classe A : solides, B : liquides, C : gaz, D : métaux, F : huiles et graisses de cuisson.$q$);
select pg_temp.set_expl('INCENDIE', 5, $q$Le CO2 n'est pas conducteur et ne laisse pas de résidu : il convient aux feux d'origine électrique. L'eau en jet plein est dangereuse sous tension.$q$);

select pg_temp.set_expl('ELEC', 0, $q$L'habilitation est délivrée par l'employeur pour un domaine de tension et des opérations définis. Ce n'est ni un diplôme, ni une autorisation générale.$q$);
select pg_temp.set_expl('ELEC', 1, $q$Les risques électriques majeurs sont l'électrisation (voire l'électrocution) et l'arc électrique, avec brûlures et projections.$q$);
select pg_temp.set_expl('ELEC', 2, $q$B0 et H0 concernent les travaux d'ordre non électrique réalisés à proximité d'installations, en respectant les zones et consignes.$q$);
select pg_temp.set_expl('ELEC', 3, $q$On ne répare pas sans habilitation : on balise, on éloigne les personnes, on alerte le responsable et on n'intervient pas.$q$);
select pg_temp.set_expl('ELEC', 4, $q$Le BS réalise des interventions élémentaires en basse tension, selon des procédures et des limites définies (remplacement, raccordement simple).$q$);
select pg_temp.set_expl('ELEC', 5, $q$BE Manœuvre couvre les manœuvres d'exploitation (mise sous ou hors tension, réarmement) selon les consignes, sans travaux.$q$);

select pg_temp.set_expl('R489', 1, $q$Sur un nouveau site, on prend connaissance des consignes, du plan de circulation et des risques spécifiques avant de conduire.$q$);
select pg_temp.set_expl('R489', 2, $q$La prise de poste comprend les contrôles visuels et fonctionnels : état général, organes de sécurité, avertisseur, freins, direction.$q$);
select pg_temp.set_expl('R489', 3, $q$La plaque de charge indique la capacité du chariot selon la hauteur de levée, le centre de gravité de la charge et l'équipement monté.$q$);
select pg_temp.set_expl('R489', 4, $q$En virage, la force centrifuge et le déport de la charge peuvent faire basculer le chariot : on ralentit et on garde la charge basse.$q$);
select pg_temp.set_expl('R489', 5, $q$Charge basse et inclinée vers l'arrière, vitesse adaptée, visibilité assurée (marche arrière si la charge masque la vue).$q$);
select pg_temp.set_expl('R489', 6, $q$Le piéton a toujours la priorité : on s'arrête, on avertit et on garantit la séparation entre les flux.$q$);

select pg_temp.set_expl('R485', 1, $q$Les vérifications de prise de poste conditionnent la sécurité : toute anomalie est signalée avant utilisation.$q$);
select pg_temp.set_expl('R485', 2, $q$La stabilité du gerbeur dépend de la charge, de son centre de gravité, de la hauteur de levée et de l'état du sol.$q$);
select pg_temp.set_expl('R485', 3, $q$On ralentit, on avertit et on respecte les cheminements : le piéton reste prioritaire.$q$);
select pg_temp.set_expl('R485', 4, $q$Une charge au plus près du sol abaisse le centre de gravité et limite le risque de renversement.$q$);
select pg_temp.set_expl('R485', 5, $q$Une fuite est une anomalie : on immobilise l'engin, on balise si nécessaire et on signale.$q$);

select pg_temp.set_expl('PREV', 0, $q$Le DUERP recense et évalue les risques professionnels et sert de base au plan d'action de prévention.$q$);
select pg_temp.set_expl('PREV', 1, $q$Un risque se cote selon la fréquence d'exposition et la gravité potentielle du dommage.$q$);
select pg_temp.set_expl('PREV', 2, $q$L'absence ou la non mise à jour du DUERP expose à une amende de 1 500 euros pour une personne physique (3 000 euros en cas de récidive).$q$);
select pg_temp.set_expl('PREV', 3, $q$Mise à jour au moins annuelle à partir de 11 salariés, et dans tous les cas lors d'une décision d'aménagement important ou d'une information nouvelle.$q$);
select pg_temp.set_expl('PREV', 4, $q$Dès le premier salarié, l'employeur doit évaluer les risques et mettre en place des actions de prévention.$q$);
select pg_temp.set_expl('PREV', 5, $q$L'employeur est responsable de la santé et de la sécurité de ses salariés, donc de l'évaluation des risques.$q$);
select pg_temp.set_expl('PREV', 6, $q$On commence par identifier et évaluer les risques : les mesures de prévention en découlent.$q$);
select pg_temp.set_expl('PREV', 7, $q$Le DUERP est tenu à disposition des salariés, du CSE, du médecin du travail et de l'inspection du travail.$q$);

select pg_temp.set_expl('ERGO', 0, $q$Efforts, postures contraignantes et gestes répétitifs sont les facteurs biomécaniques majeurs des TMS.$q$);
select pg_temp.set_expl('ERGO', 1, $q$La première logique est d'éviter ou de réduire la manutention manuelle (aides mécaniques, organisation).$q$);
select pg_temp.set_expl('ERGO', 2, $q$Charge proche du corps, appuis stables, dos droit et trajet préparé limitent les contraintes sur la colonne.$q$);
select pg_temp.set_expl('ERGO', 3, $q$Un aménagement de poste réduit les contraintes : hauteurs de travail, distances de préhension, efforts.$q$);
select pg_temp.set_expl('ERGO', 5, $q$La démarche observe et analyse la situation de travail pour proposer des améliorations concrètes.$q$);
select pg_temp.set_expl('ERGO', 8, $q$Une douleur ou un engourdissement récurrent est un signal d'alerte à remonter sans attendre.$q$);

-- ------------------------------------------------------------
-- Nouvelles questions (moyen / difficile)
-- ------------------------------------------------------------
create or replace function pg_temp.add_q(
  p_code text, p_kind text, p_difficulty text, p_text text, p_options jsonb, p_correct int, p_expl text, p_order jsonb default null
) returns void language plpgsql as $$
declare v_theme uuid; v_pos int;
begin
  select id into v_theme from public.training_themes where code = p_code;
  if v_theme is null then return; end if;
  if exists (select 1 from public.theme_questions where theme_id = v_theme and question_text = p_text) then return; end if;
  select coalesce(max(position), -1) + 1 into v_pos from public.theme_questions where theme_id = v_theme;
  insert into public.theme_questions (theme_id, question_text, question_type, options, correct_index, position, score, kind, difficulty, explanation, xp, for_positioning, for_evaluation, correct_order)
  values (v_theme, p_text, 'single_choice', p_options, p_correct, v_pos, 1, p_kind, p_difficulty, p_expl,
          case p_difficulty when 'facile' then 10 when 'moyen' then 15 else 25 end, true, true, p_order);
end $$;

-- SST
select pg_temp.add_q('SST', 'order', 'moyen', $q$Remettez dans l'ordre les 4 étapes de l'action du SST.$q$,
  '["Alerter", "Secourir", "Protéger", "Examiner"]', null,
  $q$Protéger, Examiner, Alerter, Secourir : la protection évite le suraccident, l'examen oriente l'alerte et les gestes.$q$, '[2, 3, 0, 1]');
select pg_temp.add_q('SST', 'single', 'moyen', $q$Une victime se plaint d'une douleur à la poitrine qui serre, elle est consciente. Que faites-vous ?$q$,
  '["La mettre au repos dans la position où elle se sent le mieux et alerter le 15", "La faire marcher pour faire passer la douleur", "Lui donner un verre d''eau et attendre"]', 0,
  $q$Un malaise avec douleur thoracique peut être cardiaque : repos strict, position confortable, alerte immédiate du SAMU et surveillance.$q$);
select pg_temp.add_q('SST', 'truefalse', 'moyen', $q$Le DAE peut être utilisé sur une victime allongée sur un sol mouillé sans aucune précaution.$q$,
  '["Vrai", "Faux"]', 1,
  $q$Faux : on déplace la victime hors de l'eau ou on sèche son thorax avant de poser les électrodes, pour que le choc soit efficace et sans danger.$q$);
select pg_temp.add_q('SST', 'single', 'difficile', $q$Adulte qui s'étouffe totalement (ne peut ni parler, ni tousser, ni respirer). Quelle séquence est correcte ?$q$,
  '["Jusqu''à 5 claques dans le dos, puis jusqu''à 5 compressions abdominales, en alternant", "Compressions thoraciques immédiates comme pour un arrêt cardiaque", "Lui faire boire de l''eau pour faire descendre l''objet"]', 0,
  $q$Obstruction totale : jusqu'à 5 claques dans le dos, puis jusqu'à 5 compressions abdominales (méthode de Heimlich), en alternant jusqu'à désobstruction. Si la victime perd connaissance, on passe à la réanimation.$q$);
select pg_temp.add_q('SST', 'single', 'difficile', $q$Lors des compressions thoraciques sur un adulte, le rythme et la profondeur recommandés sont :$q$,
  '["100 à 120 compressions par minute, 5 à 6 cm de profondeur", "60 compressions par minute, 2 cm de profondeur", "150 compressions par minute, le plus fort possible"]', 0,
  $q$On comprime au centre du thorax, 5 à 6 cm, à 100 à 120 par minute, en laissant le thorax remonter entre chaque compression, avec 2 insufflations toutes les 30 compressions.$q$);

-- INCENDIE
select pg_temp.add_q('INCENDIE', 'single', 'moyen', $q$Pour qu'un feu se déclare et se maintienne, il faut réunir :$q$,
  '["Un combustible, un comburant et une énergie d''activation", "Un combustible et de l''eau", "Uniquement une source de chaleur"]', 0,
  $q$C'est le triangle du feu : combustible, comburant (l'oxygène de l'air) et énergie d'activation. Supprimer un des trois éteint le feu.$q$);
select pg_temp.add_q('INCENDIE', 'single', 'moyen', $q$Un feu de friteuse se déclare en cuisine. Quel moyen est adapté ?$q$,
  '["Une couverture anti-feu ou un extincteur de classe F", "Un seau d''eau", "Souffler fort dessus"]', 0,
  $q$Jamais d'eau sur de l'huile en feu : elle provoque une projection explosive. On étouffe avec une couverture anti-feu ou un extincteur classe F.$q$);
select pg_temp.add_q('INCENDIE', 'truefalse', 'moyen', $q$Lors d'une évacuation, on peut utiliser l'ascenseur si la sortie est proche.$q$,
  '["Vrai", "Faux"]', 1,
  $q$Faux : l'ascenseur peut se bloquer entre deux niveaux et la cage se remplir de fumée. On évacue toujours par les escaliers.$q$);
select pg_temp.add_q('INCENDIE', 'single', 'difficile', $q$Avec un extincteur à eau pulvérisée avec additif (classe A et B), la bonne technique d'attaque est :$q$,
  '["Attaquer la base des flammes, en balayant, en se tenant à distance de sécurité et dos à l''issue", "Viser le haut des flammes de près", "Vider l''extincteur d''un coup sur le centre du feu"]', 0,
  $q$On vise la base des flammes en balayant, à distance de sécurité, en gardant son issue de repli derrière soi, et on cesse si le feu ne régresse pas.$q$);
select pg_temp.add_q('INCENDIE', 'single', 'difficile', $q$Vous êtes bloqué dans un local par des fumées dans le couloir. Que faites-vous ?$q$,
  '["Fermer la porte, calfeutrer le bas avec un linge humide, se signaler à la fenêtre et alerter", "Ouvrir la fenêtre en grand et la porte pour faire un courant d''air", "Traverser le couloir en apnée"]', 0,
  $q$On se confine : porte fermée et calfeutrée, on se manifeste à la fenêtre et on prévient les secours de sa position. Ouvrir la porte alimenterait le feu en oxygène.$q$);

-- ELEC
select pg_temp.add_q('ELEC', 'single', 'moyen', $q$Les cinq étapes de la consignation électrique sont, dans l'ordre :$q$,
  '["Séparation, condamnation, identification, vérification d''absence de tension, mise à la terre et en court-circuit", "Identification, séparation, mise à la terre, condamnation, vérification", "Vérification d''absence de tension, séparation, condamnation, identification, mise à la terre"]', 0,
  $q$Séparer, condamner, identifier, vérifier l'absence de tension (VAT), puis mettre à la terre et en court-circuit si nécessaire. La VAT se fait toujours avec un appareil testé avant et après.$q$);
select pg_temp.add_q('ELEC', 'truefalse', 'moyen', $q$Une tension de 48 V alternatif est considérée comme sans danger en milieu humide.$q$,
  '["Vrai", "Faux"]', 1,
  $q$Faux : en milieu mouillé, la limite de tension de sécurité descend à 25 V alternatif (50 V en milieu sec). 48 V peut être dangereux.$q$);
select pg_temp.add_q('ELEC', 'single', 'difficile', $q$Un électricien habilité B1V travaille au voisinage renforcé en basse tension. Il doit :$q$,
  '["Porter les EPI adaptés (gants isolants, écran facial) et travailler sous la responsabilité d''un chargé de travaux", "Travailler seul sans consigne particulière car il est habilité", "Mettre hors tension lui-même sans en informer personne"]', 0,
  $q$Le B1V est un exécutant : il travaille sous la direction d'un chargé de travaux (B2V), avec les EPI et les mesures prévues pour le voisinage renforcé.$q$);
select pg_temp.add_q('ELEC', 'single', 'difficile', $q$Le symbole BR correspond à :$q$,
  '["Chargé d''intervention générale en basse tension (dépannage, mesurage, essais)", "Travaux hors tension en haute tension", "Opérations non électriques en basse tension"]', 0,
  $q$BR désigne le chargé d'intervention générale : dépannage, connexion, mesurage et essais en basse tension, sous sa propre responsabilité.$q$);

-- R489
select pg_temp.add_q('R489', 'single', 'moyen', $q$Un chariot est annoncé à 2 000 kg à 500 mm de centre de gravité. La palette mesure 1 200 mm de profondeur avec une charge homogène. Que se passe-t-il ?$q$,
  '["Le centre de gravité est à 600 mm : la capacité réelle est inférieure à 2 000 kg", "La capacité reste de 2 000 kg quelle que soit la palette", "La capacité augmente car la palette est plus longue"]', 0,
  $q$Avec une charge homogène de 1 200 mm, le centre de gravité est à 600 mm, au-delà des 500 mm de référence : la capacité réelle baisse. On lit la plaque de charge.$q$);
select pg_temp.add_q('R489', 'truefalse', 'moyen', $q$Il est autorisé de lever une personne sur les fourches pour une intervention rapide en hauteur.$q$,
  '["Vrai", "Faux"]', 1,
  $q$Faux : le levage de personnes avec un chariot est interdit, sauf avec une nacelle homologuée fixée au chariot et prévue par le constructeur.$q$);
select pg_temp.add_q('R489', 'single', 'difficile', $q$Vous descendez une pente avec une charge. Vous roulez :$q$,
  '["En marche arrière, charge vers l''amont, à vitesse réduite", "En marche avant pour voir où vous allez", "En roue libre pour économiser le carburant"]', 0,
  $q$En pente, la charge est toujours orientée vers l'amont : on monte en marche avant et on descend en marche arrière, à vitesse réduite, sans tourner dans la pente.$q$);

-- R485
select pg_temp.add_q('R485', 'single', 'moyen', $q$Avec un gerbeur accompagnant, le conducteur se place :$q$,
  '["À côté du timon, jamais devant l''engin en déplacement, pieds hors de l''emprise", "Devant l''engin pour le guider", "Sur les fourches pour gagner du temps"]', 0,
  $q$Le conducteur marche à côté du timon, hors de la trajectoire et des roues, pour ne pas être écrasé ni heurté en cas d'arrêt brusque.$q$);
select pg_temp.add_q('R485', 'truefalse', 'moyen', $q$Le bouton de sécurité au bout du timon (inverseur de marche) sert à arrêter l'engin et inverser son sens s'il heurte le conducteur.$q$,
  '["Vrai", "Faux"]', 0,
  $q$Vrai : ce bouton, parfois appelé bouton ventre, stoppe le gerbeur et le fait reculer brièvement pour dégager l'opérateur.$q$);
select pg_temp.add_q('R485', 'single', 'difficile', $q$Vous devez gerber une palette à 3 mètres de hauteur. Avant de lever, vous :$q$,
  '["Immobilisez l''engin, le mât vertical, sur un sol plan, et vérifiez l''absence de personne autour", "Levez pendant le déplacement pour gagner du temps", "Inclinez le mât vers l''avant pour mieux voir"]', 0,
  $q$On ne lève jamais en roulant. Engin immobilisé sur sol plan, mât vertical, zone dégagée, puis on gerbe en surveillant la stabilité de la pile.$q$);

-- PREV
select pg_temp.add_q('PREV', 'single', 'moyen', $q$Parmi les neuf principes généraux de prévention, lequel passe avant les autres ?$q$,
  '["Éviter les risques", "Donner des équipements de protection individuelle", "Former les salariés"]', 0,
  $q$Le premier principe est d'éviter le risque. Les protections individuelles arrivent en dernier, après les mesures collectives.$q$);
select pg_temp.add_q('PREV', 'truefalse', 'moyen', $q$Le DUERP doit être conservé pendant au moins 40 ans avec ses versions successives.$q$,
  '["Vrai", "Faux"]', 0,
  $q$Vrai : depuis 2022, le DUERP et ses mises à jour sont conservés 40 ans pour assurer la traçabilité des expositions.$q$);
select pg_temp.add_q('PREV', 'single', 'difficile', $q$Un risque est coté fréquence 4 et gravité 3, avec une maîtrise jugée bonne. Que fait-on en priorité ?$q$,
  '["On traite ce risque dans le plan d''action car le risque brut reste élevé, en vérifiant que la maîtrise est réelle", "On l''ignore, la maîtrise suffit", "On le supprime du document"]', 0,
  $q$Un risque brut élevé reste à surveiller même bien maîtrisé : on vérifie l'efficacité des mesures et on le garde dans le plan d'action.$q$);

-- ERGO
select pg_temp.add_q('ERGO', 'single', 'moyen', $q$Une charge de 25 kg portée régulièrement par un salarié correspond, selon la norme, à :$q$,
  '["La limite acceptable sous conditions, au-delà de laquelle une aide est recommandée", "Une charge sans risque quelle que soit la fréquence", "Une charge interdite en toute circonstance"]', 0,
  $q$La norme NF X35-109 fixe 15 kg comme valeur acceptable et 25 kg comme limite sous conditions. Au-delà, aide mécanique ou organisation.$q$);
select pg_temp.add_q('ERGO', 'truefalse', 'moyen', $q$Une ceinture lombaire suffit à prévenir les lombalgies en manutention.$q$,
  '["Vrai", "Faux"]', 1,
  $q$Faux : la ceinture ne remplace ni l'organisation, ni les aides techniques, ni les bonnes pratiques de manutention.$q$);
select pg_temp.add_q('ERGO', 'single', 'difficile', $q$Pour analyser une situation de travail à risque de TMS, la démarche la plus pertinente est :$q$,
  '["Observer l''activité réelle, écouter l''opérateur, identifier les déterminants, puis proposer des pistes techniques et organisationnelles", "Changer le mobilier sans observer", "Demander à l''opérateur de faire des étirements"]', 0,
  $q$On part de l'activité réelle et du vécu de l'opérateur pour identifier les déterminants, puis on agit sur la technique et l'organisation.$q$);

insert into public.schema_migrations (version) values ('0008_quiz_bank') on conflict (version) do nothing;
