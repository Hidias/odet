// Modèles d'emails tout prêts (décision de H du 19/10 au soir) : ils ne dépendent d'aucun service extérieur.
// Ton professionnel et courtois, vouvoiement. La signature est ajoutée à l'envoi selon la boîte de l'expéditeur.
// Chaque modèle renvoie { subject, body } en texte simple, modifiable avant l'envoi.

const euros = (n) => `${(Number(n) || 0).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`
const date = (d) => (d ? new Date(d).toLocaleDateString('fr-FR') : '')
const bonjour = (nom) => (nom ? `Bonjour ${nom},` : 'Bonjour,')

// Envoi d'un devis. `formation` : le devis porte une formation (programmes joints possibles).
export function modeleEnvoiDevis({ quote, contactName, org, programmes = [], formation = false }) {
  const objet = quote?.object ? ` : ${quote.object}` : ''
  const pj = programmes.length
    ? `notre devis ${quote.reference}, ainsi que ${programmes.length > 1 ? 'les programmes des formations' : 'le programme de la formation'} (${programmes.join(', ')})`
    : `notre devis ${quote.reference}`
  const validite = quote?.validity_date ? ` Il est valable jusqu'au ${date(quote.validity_date)}.` : ''
  return {
    subject: `Devis ${quote.reference}${objet} - ${org}`,
    body: `${bonjour(contactName)}\n\nSuite à notre échange, veuillez trouver ci-joint ${pj}.${validite}\n\n${formation
      ? 'Nous pouvons organiser la formation dans vos locaux ou dans les nôtres, aux dates qui vous conviennent.'
      : 'Nous restons à votre disposition pour planifier l\'intervention dès votre accord.'}\n\nPour l'accepter, il suffit de nous le retourner signé, ou de nous répondre par email.\n\nNous restons à votre disposition pour tout complément d'information.\n\nBien cordialement,`,
  }
}

// Relance d'un devis sans réponse (1re, 2e, 3e relance)
export function modeleRelanceDevis({ quote, contactName, org, numero = 1 }) {
  const montant = euros(quote?.total_ht)
  const envoye = date(quote?.quote_date)
  const corps = numero <= 1
    ? `Je me permets de revenir vers vous au sujet de notre devis ${quote.reference} d'un montant de ${montant} HT, envoyé le ${envoye}.\n\nAvez-vous pu en prendre connaissance ? Je reste à votre disposition pour en parler, ou pour l'ajuster si besoin.`
    : numero === 2
      ? `Je reviens vers vous au sujet du devis ${quote.reference} (${montant} HT). Cette proposition vous convient-elle, ou souhaitez-vous que nous l'adaptions ?\n\nJe peux aussi vous appeler si vous préférez en parler de vive voix.`
      : `Sans nouvelles de votre part, je me permets une dernière relance au sujet de notre proposition ${quote.reference} (${montant} HT).\n\nSi ce projet n'est plus d'actualité, un simple mot de retour nous permettra de clore le dossier. Dans le cas contraire, je reste disponible pour finaliser les modalités.`
  return {
    subject: `${numero > 1 ? 'Relance : ' : ''}Devis ${quote.reference} - ${org}`,
    body: `${bonjour(contactName)}\n\n${corps}\n\nBien cordialement,`,
  }
}
