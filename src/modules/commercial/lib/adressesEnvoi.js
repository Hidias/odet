/** Adresses proposées à l'envoi d'un devis : contacts du client puis contact principal de la fiche, chacune une seule
 *  fois (même adresse en majuscules ou avec des espaces comprise). Le contact principal est souvent aussi un contact
 *  de la liste : il n'apparaît alors qu'une fois, sous le nom du contact (A11, 07/11). */
export function adressesProposees(contacts = [], client = null) {
  const vues = new Set()
  const liste = []
  const ajouter = (email, libelle) => {
    const e = String(email || '').trim()
    const cle = e.toLowerCase()
    if (!e || vues.has(cle)) return
    vues.add(cle)
    liste.push({ email: e, libelle })
  }
  for (const c of contacts || []) {
    const nom = `${c.first_name || ''} ${c.last_name || c.name || ''}`.replace(/\s+/g, ' ').trim()
    ajouter(c.email, nom ? `${nom} - ${String(c.email || '').trim()}` : String(c.email || '').trim())
  }
  if (client?.contact_email) ajouter(client.contact_email, `Contact principal - ${String(client.contact_email).trim()}`)
  return liste
}
