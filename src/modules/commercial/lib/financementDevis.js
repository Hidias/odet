// Financement prévu dans le devis (0397) : liste des financeurs, champs enregistrés et mention imprimée.

export const FINANCEURS_DEVIS = [
  { value: '', label: 'L\'entreprise paie (pas de financeur)' },
  { value: 'opco', label: 'OPCO' },
  { value: 'cpf', label: 'CPF (Mon compte formation)' },
  { value: 'france_travail', label: 'France Travail' },
  { value: 'region', label: 'Région' },
  { value: 'autre', label: 'Autre financeur' },
]

/** Champs du devis à enregistrer */
export function champsFinancement(q) {
  const type = q.funding_type || null
  const montant = parseFloat(String(q.funding_amount_ht ?? '').replace(',', '.'))
  return {
    funding_type: type,
    funding_client_id: type === 'opco' ? (q.funding_client_id || null) : null,
    funding_name: type ? (q.funding_name || null) : null,
    funding_agreement_ref: type ? (q.funding_agreement_ref || null) : null,
    funding_agreement_date: type ? (q.funding_agreement_date || null) : null,
    funding_subrogation: type === 'opco' ? !!q.funding_subrogation : false,
    funding_amount_ht: type && Number.isFinite(montant) && montant >= 0 ? montant : null,
  }
}

/** Mention du devis imprimé, ou null */
export function mentionFinancement(q) {
  if (!q?.funding_type) return null
  const nom = q.funding_name || (FINANCEURS_DEVIS.find((f) => f.value === q.funding_type)?.label ?? 'financeur')
  const accord = q.funding_agreement_ref ? ` (dossier ${q.funding_agreement_ref})` : ''
  if (q.funding_type !== 'opco') return `Financement prévu : ${nom}${accord}.`
  return q.funding_subrogation
    ? `Financement prévu : ${nom}${accord}, en subrogation : l'OPCO règle directement l'organisme de formation la part qu'il prend en charge.`
    : `Financement prévu : ${nom}${accord}. La facture est adressée à l'entreprise, TVA comprise ; l'entreprise la règle et l'OPCO lui rembourse sa prise en charge hors taxes.`
}
