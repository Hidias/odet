// Conditions commerciales hors formation (0443, pilotage de H du 24/10) : maintenance et vérification, vente de
// matériel, installation et travaux, garanties du matériel, périmètre de la maintenance. Documents versionnés comme
// les documents qualité (Qualité › Documents, famille « Conditions commerciales »), joints aux devis selon le métier.
// Chaque document a ses articles réservés aux particuliers (cond « particuliers ») et aux professionnels
// (cond « professionnels ») : un seul document, deux variantes, une seule histoire de versions.
//
// PROJETS À FAIRE VALIDER PAR L'EXPERT (avocat, juriste, comptable, expert du métier… selon l'entreprise) : chaque clause sensible porte un encadré « À valider par l'expert ». Les
// passages entre crochets sont à compléter par l'organisme avant validation. Références légales vérifiées le
// 24/10/2026, à relire à la source à la validation.

const note = (text) => ({ t: 'note', text: `À valider par l'expert : ${text}` })
const p = (text) => ({ t: 'p', text })
const ul = (...items) => ({ t: 'ul', items })

// Articles communs, repris dans chaque jeu de conditions
const PAIEMENT_PRO = {
  id: 'paiement-professionnels',
  title: 'Retard de paiement (professionnels)',
  cond: 'professionnels',
  blocks: [
    p('Tout retard de paiement entraîne de plein droit, dès le lendemain de l\'échéance, des pénalités au taux de la Banque centrale européenne majoré de 10 points, et une indemnité forfaitaire de 40 € pour frais de recouvrement (articles L441-10 et D441-5 du Code de commerce), sans préjudice d\'une indemnisation complémentaire sur justificatifs.'),
  ],
}
const PAIEMENT_PART = {
  id: 'paiement-particuliers',
  title: 'Retard de paiement (particuliers)',
  cond: 'particuliers',
  blocks: [
    p('En cas de retard de paiement, et après une mise en demeure restée sans effet, les sommes dues portent intérêt au taux légal. Aucune indemnité forfaitaire de recouvrement n\'est due par un consommateur.'),
  ],
}
const RETRACTATION = (exceptions) => ({
  id: 'retractation-particuliers',
  title: 'Droit de rétractation (particuliers)',
  cond: 'particuliers',
  blocks: [
    p('Lorsque le contrat est conclu hors établissement (à votre domicile, sur votre lieu de travail, après démarchage) ou à distance, vous disposez d\'un délai de **14 jours** pour vous rétracter, sans avoir à motiver votre décision ni à payer de pénalité (article L221-18 du Code de la consommation). Le délai court à compter de la conclusion du contrat pour une prestation de services, et de la réception du bien pour une vente.'),
    p('Pour l\'exercer, adressez avant l\'expiration du délai le formulaire de rétractation joint au devis, ou toute déclaration dénuée d\'ambiguïté, à {{org.email}} ou par courrier à {{org.siege}}. Les sommes versées sont remboursées au plus tard 14 jours après réception de votre décision.'),
    p('Si vous demandez expressément que la prestation commence avant la fin du délai, vous restez libre de vous rétracter, mais vous devez le montant correspondant au service fourni jusqu\'à votre décision (article L221-25).'),
    p('Pour un contrat conclu hors établissement, aucun paiement ni acompte ne peut être exigé avant l\'expiration d\'un délai de **7 jours** à compter de sa conclusion (article L221-10), sauf exceptions prévues par la loi.'),
    ...(exceptions ? [p(exceptions)] : []),
    note('liste des exceptions au droit de rétractation retenues (article L221-28), point de départ du délai, et texte du formulaire type (annexe à l\'article R221-1) joint au devis.'),
  ],
})
const MEDIATION = {
  id: 'mediation-particuliers',
  title: 'Médiation de la consommation (particuliers)',
  cond: 'particuliers',
  blocks: [
    p('En cas de litige non résolu par une réclamation écrite préalable, le client consommateur peut recourir gratuitement au médiateur de la consommation dont relève l\'entreprise (articles L612-1 et L616-1 du Code de la consommation) : [nom du médiateur], [adresse postale], [site internet].'),
  ],
}
const FORCE_MAJEURE = {
  id: 'force-majeure',
  title: 'Force majeure',
  blocks: [p('Aucune des parties n\'est responsable d\'un manquement dû à un événement de force majeure au sens de l\'article 1218 du Code civil. La partie empêchée prévient l\'autre sans délai ; les délais sont prolongés de la durée de l\'empêchement.')],
}
const DONNEES = {
  id: 'donnees-personnelles',
  title: 'Données personnelles',
  blocks: [p('Les données des contacts du client sont traitées pour l\'établissement des devis, l\'exécution des prestations, la facturation et le suivi de la relation, conformément au règlement général sur la protection des données. Elles sont conservées pendant la durée de la relation puis le temps des obligations légales. Toute demande d\'accès, de rectification ou d\'effacement est adressée à {{org.email}}.')],
}
const RECLAMATIONS = {
  id: 'reclamations',
  title: 'Réclamations',
  blocks: [p('Toute réclamation est adressée par écrit à {{org.email}} ou par courrier à {{org.siege}}. Un accusé de réception est envoyé sous 48 heures et une réponse sous 10 jours ouvrés.')],
}
const DROIT = {
  id: 'droit-applicable',
  title: 'Droit applicable et litiges',
  blocks: [
    p('Les présentes conditions sont soumises au droit français. À défaut d\'accord amiable, tout litige avec un client professionnel relève de la compétence exclusive du {{org.tribunal}}. Pour un client consommateur, les règles légales de compétence s\'appliquent.'),
    p('Version du [date].'),
  ],
}

// Titres sans numéro : les articles sont numérotés à l'impression parmi ceux de la variante remise (numeroter: true),
// sans trou de numéro entre la version des professionnels et celle des particuliers. Aucun renvoi par numéro d'article.
const numeroter = (sections) => sections

const CGV_MAINTENANCE = {
  id: 'cgv-maintenance',
  num: 'C02',
  code: 'COM-CGM',
  numeroter: true,
  name: 'Conditions générales de maintenance et de vérification',
  family: 'commerce',
  indicators: [],
  pilote: '',
  scope: 'Jointes aux devis et contrats de maintenance, de vérification et de dépannage',
  // Questions ouvertes posées aux relecteurs au lancement du circuit de validation (0455)
  questions: [
    { section: 'duree', q: 'Durée initiale du contrat de maintenance ?', choix: ['3 ans', '5 ans', '1 an, reconduit chaque année'] },
  ],
  sections: numeroter([
    { id: 'objet', title: 'Objet et champ d\'application', blocks: [
      p('Les présentes conditions s\'appliquent aux prestations de maintenance préventive, de vérification périodique, d\'intervention ponctuelle et de dépannage réalisées par {{org.nom}} sur les équipements de sécurité du client : extincteurs, éclairage de sécurité, systèmes d\'alarme et de détection, désenfumage, robinets d\'incendie armés, matériel de premiers secours et équipements listés au contrat.'),
      p('L\'acceptation du devis ou du contrat vaut acceptation des présentes conditions, qui prévalent sur tout autre document du client sauf accord écrit contraire.'),
    ] },
    { id: 'documents', title: 'Documents contractuels', blocks: [
      p('Le contrat se compose, par ordre de priorité : des avenants signés, du devis ou du contrat signé et de la liste des équipements couverts, du périmètre des prestations, puis des présentes conditions.'),
    ] },
    { id: 'duree', title: 'Durée et reconduction', blocks: [
      p('Le contrat est conclu pour la durée indiquée au contrat (un, trois ou cinq ans) à compter de sa date d\'effet. Lorsque le contrat le prévoit, il est reconduit tacitement à son terme par périodes de la durée indiquée au contrat, sauf dénonciation par l\'une des parties, par lettre recommandée avec avis de réception ou par écrit électronique avec accusé de réception, au moins avant le préavis indiqué au contrat (par défaut **[3] mois**) avant son échéance. Sans reconduction prévue, il prend fin à son terme.'),
      note('durées proposées, préavis de dénonciation, et forme de la dénonciation (pour un particulier, la résiliation par voie électronique doit rester possible, article L215-1-1).'),
    ] },
    { id: 'reconduction-particuliers', title: 'Information sur la reconduction (particuliers)', cond: 'particuliers', blocks: [
      p('Conformément à l\'article L215-1 du Code de la consommation, nous vous informons par écrit, au plus tôt trois mois et au plus tard un mois avant le terme de la période autorisant le rejet de la reconduction, de la possibilité de ne pas reconduire le contrat. À défaut, vous pouvez mettre fin gratuitement au contrat à tout moment à compter de la date de reconduction ; les avances versées pour la période postérieure à la résiliation sont remboursées dans un délai de trente jours.'),
      p('Vous pouvez résilier le contrat par les mêmes moyens que ceux utilisés pour le conclure, notamment par voie électronique (article L215-1-1).'),
      note('rédaction de l\'information L215-1 et L215-1-1, et application aux non-professionnels (article L215-3).'),
    ] },
    { id: 'resiliation', title: 'Résiliation', blocks: [
      p('En cas de manquement grave de l\'une des parties à ses obligations, notamment le défaut de paiement des prestations et fournitures, non réparé dans les trente jours d\'une mise en demeure écrite, l\'autre partie peut résilier le contrat de plein droit. Les prestations réalisées jusqu\'à la résiliation restent dues.'),
      p('Le contrat prend fin également lorsque les équipements couverts disparaissent (cession, destruction, retrait définitif du site), à la date où le client en informe le prestataire.'),
      p('Lorsqu\'une facture reste impayée après une mise en demeure restée sans effet, le prestataire peut suspendre les visites jusqu\'au règlement, après en avoir informé le client par écrit.'),
      note('cas de résiliation ; sort des sommes payées d\'avance ; montant de l\'indemnité de résiliation anticipée des professionnels (clause pénale que le juge peut réduire si elle est manifestement excessive, article 1231-5 du Code civil), écartée pour les particuliers (risque de clause abusive) ; suspension des visites en cas d\'impayé (exception d\'inexécution, article 1219 du Code civil) ; résiliation en cas de procédure collective du client (encadrée par le Code de commerce).'),
    ] },
    { id: 'resiliation-anticipee', title: 'Résiliation anticipée (professionnels)', cond: 'professionnels', blocks: [
      p('Lorsque le client professionnel met fin au contrat avant son terme en dehors des cas ci-dessus, il doit le prix des visites restant à effectuer jusqu\'au terme de la période en cours, majoré de **[120 € TTC]** de frais de résiliation.'),
    ] },
    { id: 'resiliation-particuliers', title: 'Résiliation (particuliers)', cond: 'particuliers', blocks: [
      p('Le client particulier qui met fin au contrat ne doit que les prestations déjà réalisées ; aucune indemnité de résiliation ne lui est demandée. Il peut résilier par écrit ou en ligne depuis son espace client, et reçoit un accusé de réception.'),
    ] },
    { id: 'prix', title: 'Prix et révision', blocks: [
      p('Le prix annuel est indiqué au devis ou au contrat, hors taxes. Il comprend les opérations décrites dans le périmètre des prestations pour les équipements listés. Les pièces, recharges, remplacements et opérations non comprises font l\'objet d\'un devis préalable, sauf urgence liée à la sécurité acceptée par le client.'),
      p('Le prix est révisé à chaque date anniversaire selon la formule P = P0 × (I / I0), où I0 est la dernière valeur connue de l\'indice [indice de révision] à la date du contrat et I sa dernière valeur connue à la date de révision. Le nouveau prix est communiqué au client au moins un mois avant son application.'),
      p('Les opérations hors forfait (recharges, requalifications, échanges standard, pièces détachées, maintenances quinquennales et décennales) sont facturées au tarif en vigueur remis avec le contrat, révisé dans les mêmes conditions.'),
      p('Aucun frais de dossier, de facture ou de suivi n\'est facturé. Seule la reprise du matériel remplacé, à la demande du client, est facturée **[8 € HT]** par appareil.'),
      note('choix de l\'indice de révision (intitulé exact de la série INSEE à relever à la source), plafond éventuel, faculté de résiliation du client en cas de hausse ; montant de la reprise du matériel.'),
    ] },
    { id: 'execution', title: 'Exécution des prestations', blocks: [
      p('Les visites ont lieu selon la périodicité prévue au contrat, à deux mois près, aux jours et heures ouvrés, à une date convenue à l\'avance ; un avis de passage est adressé au client. Le client donne accès aux locaux et aux équipements, désigne un interlocuteur, signale tout équipement ajouté, déplacé ou retiré, et communique les consignes de sécurité de son site. Lorsque la réglementation l\'exige, un plan de prévention est établi avant l\'intervention (articles R4512-6 et suivants du Code du travail).'),
      p('Le client s\'engage en outre à :'),
      ul(
        'désigner un interlocuteur et son suppléant, joignables pendant les interventions ;',
        'donner accès aux locaux, aux équipements, et le cas échéant aux codes, mots de passe et logiciels nécessaires à leur maintenance ;',
        'sauvegarder les paramètres et enregistrements de ses systèmes avant toute intervention, lorsqu\'il en a la maîtrise ;',
        'fournir à ses frais, si le contrat prévoit une maintenance à distance, l\'accès réseau nécessaire ;',
        'ne pas déplacer, modifier ni faire modifier les équipements couverts sans l\'accord écrit du prestataire.',
      ),
      p('Une panne imputable au client (mauvaise utilisation, choc, modification non autorisée, coupure d\'alimentation, défaut de son réseau) donne lieu à une intervention facturée au tarif en vigueur.'),
      p('Pour les systèmes de vidéoprotection, le technicien n\'accède aux images et aux enregistrements que dans la mesure nécessaire à la maintenance, en présence ou avec l\'accord du client, sans en conserver de copie.'),
      p('Une visite qui ne peut pas avoir lieu du fait du client (absence, accès impossible, équipements inaccessibles) est reprogrammée ; le déplacement inutile est facturé [montant] € HT.'),
      note('obligations du client ; facturation du déplacement inutile ; accès aux images de vidéoprotection (données personnelles des personnes filmées).'),
    ] },
    { id: 'rapport', title: 'Rapport et non-conformités', blocks: [
      p('Après chaque visite, un rapport est remis au client. Il indique les équipements vérifiés, les opérations réalisées, leur résultat et les anomalies constatées. Les non-conformités et les équipements à remplacer sont signalés par écrit, avec, le cas échéant, un devis.'),
      p('Il appartient au client, en sa qualité d\'employeur ou d\'exploitant, de faire procéder aux remplacements et mises en conformité signalés, et de tenir à jour son registre de sécurité. Les obligations réglementaires de vérification et de maintien en état des équipements restent les siennes.'),
      note('portée du signalement des non-conformités et transfert de la charge de la mise en conformité.'),
    ] },
    { id: 'modification-parc', title: 'Modification des équipements couverts', blocks: [
      p('Les équipements ajoutés, remplacés ou retirés sur le site figurent au rapport de l\'intervention qui les constate. Lorsque le prix du contrat en est modifié, un avenant indiquant le nouveau prix est soumis au client ; il s\'applique à partir de sa signature. Sans avenant signé, le prix et la liste des équipements couverts restent inchangés.'),
    ] },
    { id: 'exclusivite', title: 'Interventions d\'un tiers', cond: 'professionnels', blocks: [
      p('Pendant la durée du contrat, le client ne fait intervenir aucun tiers sur les équipements couverts sans l\'accord écrit du prestataire. À défaut, le prestataire n\'est plus responsable des équipements sur lesquels un tiers est intervenu, et la garantie de ses propres interventions cesse pour eux.'),
      note('portée de l\'exclusivité et effet sur la garantie.'),
    ] },
    { id: 'sinistre', title: 'Sinistre', blocks: [
      p('Si un équipement couvert ne fonctionne pas lors d\'un début d\'incendie ou d\'un accident ayant eu des conséquences dommageables, le client en avertit le prestataire dès que possible et au plus tard dans les **[5] jours ouvrés** (**[2] jours ouvrés** en cas de vol, avec la copie du dépôt de plainte), par lettre recommandée avec avis de réception ou par écrit électronique avec accusé de réception. L\'équipement en cause est conservé en l\'état, sans aucune intervention, pour permettre son expertise ; si nécessaire, il est placé sous scellés par un commissaire de justice et confié à un laboratoire d\'essai indépendant.'),
      p('La responsabilité du prestataire ne peut être recherchée que si le client a respecté les obligations mises à sa charge par le contrat. L\'existence du contrat n\'emporte aucune présomption de responsabilité du prestataire : la preuve d\'une faute de sa part incombe au client.'),
      note('délai de déclaration (24 heures retenues dans le carnet, 5 et 2 jours ouvrés observés dans d\'autres contrats du métier), conservation et expertise de l\'équipement, charge de la preuve (opposabilité à un particulier).'),
    ] },
    { id: 'cession', title: 'Cession du site ou des équipements', blocks: [
      p('En cas de cession du site, du fonds ou des équipements couverts, le client en informe le prestataire dans les **[8] jours** et lui communique les coordonnées du repreneur. Le contrat peut être transféré au repreneur avec son accord ; à défaut, il prend fin dans les conditions prévues pour la disparition des équipements.'),
      note('transfert du contrat au repreneur (une cession de contrat suppose l\'accord du repreneur et du prestataire, article 1216 du Code civil).'),
    ] },
    { id: 'responsabilite', title: 'Responsabilité', blocks: [
      p('Le prestataire est tenu d\'une obligation de moyens. Sa responsabilité est limitée aux équipements et aux opérations figurant au rapport, dans l\'état constaté au jour de la visite. Elle ne peut être engagée pour un équipement non déclaré, déplacé, utilisé, modifié ou endommagé après la visite, ni pour les conséquences d\'une non-conformité signalée et non corrigée.'),
      p('Envers un client professionnel, la responsabilité du prestataire, toutes causes confondues, est limitée au montant hors taxes payé au titre de la période annuelle en cours, et exclut les dommages indirects (perte d\'exploitation, de chiffre d\'affaires, d\'image). Ces limites ne s\'appliquent pas en cas de faute lourde ou dolosive, ni aux dommages corporels.'),
      note('limitation de responsabilité (article 1170 du Code civil, obligation essentielle), plafond, et opposabilité au particulier (interdiction des clauses abusives, article R212-1).'),
    ] },
    { id: 'assurance', title: 'Assurance', blocks: [
      p('Le prestataire est assuré en responsabilité civile professionnelle auprès de [assureur], contrat n° [numéro]. L\'attestation est remise sur demande.'),
    ] },
    { id: 'facturation', title: 'Facturation et paiement', blocks: [
      p('Le prix annuel est facturé selon la périodicité indiquée au contrat : mensuelle, trimestrielle, annuelle ou à chaque visite, en début ou en fin de période. La première période est facturée au prorata du temps couru. Les interventions hors contrat sont facturées à leur réalisation.'),
      p('Les factures sont payables à l\'échéance indiquée, par virement, ou par prélèvement SEPA lorsque le client a signé un mandat ; chaque prélèvement est alors notifié au moins **[14] jours** avant son exécution.'),
      p('Pour un client public, les factures sont déposées sur Chorus Pro avec le numéro d\'engagement de l\'exercice et réglées par mandat administratif ; le prélèvement ne s\'applique pas.'),
      note('délai de notification préalable du prélèvement (14 jours par défaut du recueil SEPA, réductible par accord), type de prélèvement (CORE ou interentreprises), frais en cas de rejet.'),
    ] },
    PAIEMENT_PRO,
    PAIEMENT_PART,
    { id: 'depannage', title: 'Interventions ponctuelles et dépannage', blocks: [
      p('Sur demande du client, le prestataire intervient pour une réparation ou un dépannage, du [lundi au vendredi, de 8 h à 18 h]. Sauf urgence liée à la sécurité, un devis est établi avant l\'intervention. Le déplacement et la main-d\'œuvre sont facturés au tarif en vigueur, les pièces en sus, sauf ce que le contrat déclare compris.'),
      p('Lorsque le contrat indique un délai d\'intervention pour un dépannage urgent, le technicien arrive sur le site dans ce délai à compter de la demande. Une astreinte en dehors des horaires peut être prévue au contrat, en option.'),
      note('horaires de dépannage, portée du délai d\'intervention (obligation de moyens ou de résultat), astreinte.'),
    ] },
    RETRACTATION('Le droit de rétractation ne s\'applique pas aux travaux d\'entretien ou de réparation à réaliser en urgence à votre domicile et expressément sollicités par vous, dans la limite des pièces de rechange et travaux strictement nécessaires pour répondre à l\'urgence (article L221-28, 8°).'),
    { id: 'retractation-petits-pros', title: 'Droit de rétractation (petits professionnels)', cond: 'professionnels', blocks: [
      p('Le client professionnel qui emploie cinq salariés au plus, lorsque le contrat est conclu hors établissement et que son objet n\'entre pas dans le champ de son activité principale, bénéficie des mêmes règles que le consommateur pour l\'information préalable et le droit de rétractation de 14 jours (article L221-3 du Code de la consommation). Le formulaire de rétractation lui est remis avec le devis.'),
      note('application de l\'article L221-3 (effectif, champ de l\'activité principale, preuve) et remise du formulaire.'),
    ] },
    FORCE_MAJEURE,
    DONNEES,
    RECLAMATIONS,
    MEDIATION,
    DROIT,
  ]),
}

const CGV_VENTE = {
  id: 'cgv-vente',
  num: 'C03',
  code: 'COM-CGVM',
  numeroter: true,
  name: 'Conditions générales de vente de matériel',
  family: 'commerce',
  indicators: [],
  pilote: '',
  scope: 'Jointes aux devis de vente de matériel (extincteurs, éclairage de sécurité, signalétique, premiers secours)',
  sections: numeroter([
    { id: 'objet', title: 'Objet et champ d\'application', blocks: [
      p('Les présentes conditions s\'appliquent aux ventes de matériel de sécurité par {{org.nom}} : extincteurs, blocs d\'éclairage de sécurité, détecteurs, signalétique, matériel de premiers secours et autres équipements. Lorsque la vente comprend une pose, les conditions générales d\'installation et de travaux s\'appliquent aussi.'),
      p('L\'acceptation du devis vaut acceptation des présentes conditions, qui prévalent sur tout autre document du client sauf accord écrit contraire.'),
    ] },
    { id: 'commande', title: 'Commande', blocks: [
      p('La commande est ferme à la réception du devis accepté. Lorsque le devis le prévoit, un acompte est versé à la commande.'),
    ] },
    { id: 'prix', title: 'Prix', blocks: [
      p('Les prix sont indiqués en euros hors taxes, pour la durée de validité du devis, sous réserve de disponibilité du matériel. Au-delà, ils peuvent être révisés en fonction des tarifs du fournisseur ; le client en est informé avant toute commande ferme.'),
      p('Le prix comprend l\'éco-participation due au titre des filières de responsabilité élargie du producteur (équipements électriques et électroniques ; petits appareils extincteurs), indiquée sur le devis et la facture.'),
      note('révision du prix entre devis et livraison ; affichage de l\'éco-participation.'),
    ] },
    { id: 'livraison', title: 'Livraison et délais', blocks: [
      p('Le délai de livraison ou de mise à disposition est indiqué au devis. Pour un client professionnel, il est donné à titre indicatif ; un retard ne peut donner lieu ni à pénalité ni à annulation, sauf retard de plus de [30] jours après mise en demeure.'),
    ] },
    { id: 'livraison-particuliers', title: 'Délai de livraison (particuliers)', cond: 'particuliers', blocks: [
      p('Le bien est livré à la date ou dans le délai indiqué au devis, ou à défaut au plus tard trente jours après la commande (article L216-1 du Code de la consommation). En cas de dépassement, vous pouvez, après nous avoir enjoint d\'effectuer la livraison dans un délai supplémentaire raisonnable, résoudre le contrat (article L216-6).'),
    ] },
    { id: 'risques', title: 'Transfert des risques', blocks: [
      p('Pour un client professionnel, les risques sont transférés à la remise du matériel (livraison ou enlèvement). Pour un consommateur, ils sont transférés lorsqu\'il prend physiquement possession du bien (article L216-4 du Code de la consommation).'),
    ] },
    { id: 'reserve-propriete', title: 'Réserve de propriété', blocks: [
      p('Le matériel reste la propriété du vendeur jusqu\'au paiement intégral du prix, en principal et accessoires (article 2367 du Code civil). À défaut de paiement à l\'échéance, le vendeur peut en demander la restitution, aux frais du client. Les risques restent à la charge du client dès la remise.'),
      note('clause de réserve de propriété (acceptation écrite au plus tard à la livraison), sort du matériel posé ou incorporé.'),
    ] },
    { id: 'reception', title: 'Réception et réclamations', blocks: [
      p('Le client vérifie le matériel à la livraison. En cas d\'avarie ou de manquant, il émet des réserves précises auprès du transporteur et les confirme dans les trois jours (article L133-3 du Code de commerce). Les défauts apparents ou non-conformités à la commande sont signalés au vendeur par écrit dans les [8] jours de la livraison.'),
    ] },
    { id: 'garanties', title: 'Garanties', blocks: [
      p('Le matériel bénéficie de la garantie du fabricant, dont la durée et les conditions figurent sur la fiche technique et dans le document « Garanties du matériel vendu » joint au devis.'),
    ] },
    { id: 'garanties-particuliers', title: 'Garanties légales (particuliers)', cond: 'particuliers', blocks: [
      p('Vous bénéficiez de la garantie légale de conformité pendant deux ans à compter de la délivrance du bien (articles L217-3 et suivants du Code de la consommation) et de la garantie contre les vices cachés (articles 1641 à 1649 du Code civil). Ces garanties s\'appliquent indépendamment de la garantie commerciale du fabricant. Leur texte figure dans le document « Garanties du matériel vendu ».'),
      note('reproduction à l\'identique de l\'encadré réglementaire de la garantie légale (article D211-2 du Code de la consommation).'),
    ] },
    { id: 'retours', title: 'Retours', blocks: [
      p('Hors droit de rétractation et garanties, aucun retour n\'est accepté sans accord préalable écrit. Un matériel standard retourné avec accord doit être neuf, non utilisé, dans son emballage d\'origine ; [frais de reprise].'),
    ] },
    { id: 'paiement', title: 'Paiement', blocks: [
      p('Les factures sont payables à l\'échéance indiquée, par virement.'),
    ] },
    PAIEMENT_PRO,
    PAIEMENT_PART,
    RETRACTATION('Le droit de rétractation ne s\'applique pas aux biens confectionnés selon vos spécifications ou nettement personnalisés (article L221-28, 3°).'),
    FORCE_MAJEURE,
    DONNEES,
    RECLAMATIONS,
    MEDIATION,
    DROIT,
  ]),
}

const CGV_INSTALLATION = {
  id: 'cgv-installation',
  num: 'C04',
  code: 'COM-CGIT',
  numeroter: true,
  name: 'Conditions générales d\'installation et de travaux',
  family: 'commerce',
  indicators: [],
  pilote: '',
  scope: 'Jointes aux devis d\'installation et de travaux (alarme, éclairage de sécurité, désenfumage, électricité, ventilation, sûreté)',
  sections: numeroter([
    { id: 'objet', title: 'Objet et champ d\'application', blocks: [
      p('Les présentes conditions s\'appliquent aux travaux d\'installation et de mise en service réalisés par {{org.nom}} : systèmes d\'alarme et de détection incendie, éclairage de sécurité, désenfumage, vidéoprotection, contrôle d\'accès, travaux d\'électricité et de ventilation.'),
      p('L\'acceptation du devis vaut acceptation des présentes conditions, qui prévalent sur tout autre document du client sauf accord écrit contraire.'),
    ] },
    { id: 'devis', title: 'Devis et informations du client', blocks: [
      p('Le devis est établi d\'après une visite préalable ou, à défaut, d\'après les informations transmises par le client (photos, plans, nombre d\'équipements). Dans ce cas, il est établi sous réserve de vérification lors d\'une visite préalable ou le jour de l\'intervention ; tout écart constaté fait l\'objet d\'un avenant chiffré, soumis à l\'accord du client avant exécution.'),
      note('clause du devis établi à distance et de l\'avenant.'),
    ] },
    { id: 'commande', title: 'Commande et acompte', blocks: [
      p('La commande est ferme à la réception du devis accepté. Un acompte de [30] % est versé à la commande, sauf disposition contraire du devis ; le solde est payable à la réception des travaux.'),
      note('montant de l\'acompte, échéancier pour les chantiers longs.'),
    ] },
    { id: 'delais', title: 'Délais', blocks: [
      p('La date de début et la durée des travaux sont indiquées au devis. Elles sont prolongées en cas d\'intempéries, de retard ou de modification du fait du client, d\'indisponibilité des locaux ou de force majeure.'),
    ] },
    { id: 'client', title: 'Obligations du client', blocks: [
      p('Le client donne accès aux locaux et aux zones de travail, met à disposition l\'alimentation électrique nécessaire, communique les informations sur les réseaux existants et sur la présence éventuelle d\'amiante (repérage avant travaux à la charge du donneur d\'ordre, article R4412-97 du Code du travail), et obtient les autorisations nécessaires (copropriété, bailleur, autorités administratives). Pour un établissement recevant du public, il reste responsable des démarches auprès de la commission de sécurité.'),
      note('répartition des obligations (amiante, autorisations, établissement recevant du public).'),
    ] },
    { id: 'modifications', title: 'Modifications et travaux supplémentaires', blocks: [
      p('Toute modification ou tout travail supplémentaire fait l\'objet d\'un avenant écrit, chiffré et signé par le client avant son exécution, sauf urgence liée à la sécurité des personnes, signalée sans délai au client.'),
    ] },
    { id: 'reception', title: 'Réception des travaux', blocks: [
      p('À l\'achèvement, les travaux sont réceptionnés contradictoirement, avec ou sans réserves, par un procès-verbal signé des deux parties (article 1792-6 du Code civil). Les réserves sont levées dans le délai convenu au procès-verbal. La prise de possession de l\'ouvrage et le paiement du solde sans réserve écrite valent réception.'),
      note('réception tacite, délai de convocation à la réception et sort des réserves.'),
    ] },
    { id: 'garanties', title: 'Garanties légales et assurance', blocks: [
      p('Selon la nature des travaux, le client bénéficie de la garantie de parfait achèvement d\'un an à compter de la réception (article 1792-6 du Code civil), de la garantie de bon fonctionnement de deux ans pour les éléments d\'équipement dissociables (article 1792-3) et de la garantie décennale (articles 1792 et 1792-4-1).'),
      p('L\'entreprise est assurée en responsabilité civile professionnelle et, pour les travaux qui l\'exigent, en responsabilité civile décennale (article L241-1 du Code des assurances). Le nom de l\'assureur, les coordonnées, le numéro de contrat et la couverture géographique figurent sur le devis et l\'attestation jointe.'),
      note('travaux relevant de la garantie décennale, mentions de l\'assurance sur le devis et la facture.'),
    ] },
    { id: 'reserve-propriete', title: 'Réserve de propriété', blocks: [
      p('Le matériel fourni reste la propriété de l\'entreprise jusqu\'au paiement intégral du prix, tant qu\'il peut être repris sans dommage (article 2367 du Code civil).'),
      note('portée de la réserve de propriété sur un matériel incorporé à l\'ouvrage.'),
    ] },
    { id: 'dechets', title: 'Déchets de chantier', blocks: [
      p('Le devis précise l\'estimation de la quantité de déchets produits, leurs modalités de gestion et d\'enlèvement, le point de collecte prévu et le coût associé (article L541-21-2-3 du Code de l\'environnement).'),
      note('mentions déchets sur le devis pour les travaux concernés.'),
    ] },
    { id: 'sous-traitance', title: 'Sous-traitance', blocks: [
      p('L\'entreprise peut sous-traiter une partie des travaux dans le respect de la loi n° 75-1334 du 31 décembre 1975. Elle reste responsable de l\'ensemble des travaux envers le client.'),
    ] },
    { id: 'paiement', title: 'Paiement', blocks: [
      p('Les factures sont payables à l\'échéance indiquée, par virement. [Retenue de garantie : le cas échéant, dans la limite de 5 % et dans les conditions de la loi n° 71-584 du 16 juillet 1971.]'),
    ] },
    PAIEMENT_PRO,
    PAIEMENT_PART,
    { id: 'tva-particuliers', title: 'Taux réduit de TVA (particuliers)', cond: 'particuliers', blocks: [
      p('Pour des travaux dans un logement achevé depuis plus de deux ans, le taux réduit de TVA s\'applique lorsque le client certifie, par la mention portée sur le devis signé, que les conditions prévues par les articles 279-0 bis et 278-0 bis A du Code général des impôts sont remplies. Le client qui certifie à tort est solidairement tenu au paiement du complément de taxe.'),
      note('rédaction de la mention (à valider aussi par l\'expert-comptable).'),
    ] },
    RETRACTATION('Le droit de rétractation ne s\'applique pas aux travaux d\'entretien ou de réparation à réaliser en urgence à votre domicile et expressément sollicités par vous (article L221-28, 8°).'),
    FORCE_MAJEURE,
    DONNEES,
    RECLAMATIONS,
    MEDIATION,
    DROIT,
  ]),
}

const GARANTIE = {
  id: 'garantie-vente',
  num: 'C05',
  code: 'COM-GAR',
  numeroter: true,
  name: 'Garanties du matériel vendu',
  family: 'commerce',
  indicators: [],
  pilote: '',
  scope: 'Jointes aux devis de vente de matériel',
  sections: numeroter([
    { id: 'fabricant', title: 'Garantie du fabricant', blocks: [
      p('Le matériel neuf vendu bénéficie de la garantie commerciale de son fabricant, dont la durée figure sur la fiche technique. Elle couvre les défauts de fabrication, dans des conditions normales d\'utilisation, sous réserve d\'une installation et d\'une maintenance conformes aux prescriptions du fabricant et à l\'usage de la profession.'),
    ] },
    { id: 'exclusions', title: 'Exclusions', blocks: [
      ul('les dommages dus à un choc, une chute, un acte de vandalisme ou une mauvaise utilisation ;', 'le défaut de maintenance périodique ou une maintenance réalisée par une personne non qualifiée ;', 'la recharge d\'un extincteur après utilisation, les consommables (batteries, lampes, piles, scellés) ;', 'les modifications ou réparations réalisées sans accord.'),
    ] },
    { id: 'mise-en-oeuvre', title: 'Mise en œuvre', blocks: [
      p('Le client signale le défaut à {{org.email}} en précisant la référence du matériel et la date d\'achat. Après examen, le matériel est réparé ou remplacé.'),
    ] },
    { id: 'legales-particuliers', title: 'Garanties légales (particuliers)', cond: 'particuliers', blocks: [
      p('Indépendamment de la garantie commerciale, le vendeur reste tenu de la garantie légale de conformité (articles L217-3 à L217-20 du Code de la consommation) et de la garantie des vices cachés (articles 1641 à 1649 du Code civil).'),
      p('[Texte de l\'encadré réglementaire de la garantie légale de conformité, à reproduire à l\'identique (article D211-2 du Code de la consommation).]'),
      note('texte exact de l\'encadré réglementaire et présentation de la garantie commerciale (article L217-22).'),
    ] },
  ]),
}

const PERIMETRE = {
  id: 'perimetre-maintenance',
  num: 'C06',
  code: 'COM-PER',
  name: 'Périmètre des prestations de maintenance',
  family: 'commerce',
  indicators: [],
  pilote: '',
  scope: 'Joint aux devis et contrats de maintenance : ce que comprend la visite, et ce qui est en sus',
  sections: [
    { id: 'principe', title: 'Principe', blocks: [
      p('Ce document précise, par famille d\'équipements, les opérations comprises dans le prix de la visite et celles qui font l\'objet d\'un devis. Les opérations suivent l\'usage de la profession (normes et référentiels de la profession, cités comme usage et non comme obligation légale) et les prescriptions des fabricants. Les obligations réglementaires de vérification restent celles de l\'employeur ou de l\'exploitant.'),
    ] },
    { id: 'tableau', title: 'Opérations par famille', blocks: [
      { t: 'table', head: ['Équipements', 'Compris dans la visite', 'En sus, sur devis'], rows: [
        ['Extincteurs', 'Vérification périodique, contrôle de l\'accessibilité et de la signalisation, scellé et étiquette de contrôle, mention au rapport', 'Recharge après utilisation, pièces, maintenance additionnelle et révision selon l\'âge, remplacement des appareils réformés'],
        ['Éclairage de sécurité', 'Essai de fonctionnement, contrôle de l\'autonomie selon la périodicité convenue, mention au rapport', 'Batteries, lampes, remplacement de blocs'],
        ['Alarme et détection', 'Essai des déclencheurs et des diffuseurs, contrôle de l\'équipement de contrôle, mention au rapport', 'Pièces, modifications de l\'installation, extension'],
        ['Désenfumage', 'Essai des commandes et des ouvrants, mention au rapport', 'Pièces, motorisations, remise en état'],
        ['Robinets d\'incendie armés', 'Contrôle de l\'état et de la pression, mention au rapport', 'Pièces, remplacement de tuyau'],
        ['Premiers secours', 'Contrôle du contenu et des dates de péremption', 'Consommables et produits remplacés'],
      ] },
      note('rédaction du périmètre par famille, à relire avec l\'équipe technique.'),
    ] },
    { id: 'hors-perimetre', title: 'Hors périmètre', blocks: [
      p('Ne sont pas compris : les équipements non listés au contrat, les interventions demandées entre deux visites, les mises en conformité réglementaires, et les travaux d\'installation, qui relèvent des conditions générales d\'installation et de travaux.'),
    ] },
  ],
}

const TEMPLATES_COMMERCE = {
  [CGV_MAINTENANCE.id]: CGV_MAINTENANCE,
  [CGV_VENTE.id]: CGV_VENTE,
  [CGV_INSTALLATION.id]: CGV_INSTALLATION,
  [GARANTIE.id]: GARANTIE,
  [PERIMETRE.id]: PERIMETRE,
}

export default TEMPLATES_COMMERCE
