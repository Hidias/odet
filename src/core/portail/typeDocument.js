// Type affiché d'un document de l'espace client (C4, 05/11). La convention d'un groupe inter est publiée sous le type
// « contrat » (0420, la base n'accepte pas d'autre type signable pour un groupe) : elle se reconnaît à son libellé,
// donné par l'application (« Convention de formation ... »), et s'affiche et se signe comme une convention.
export const rubriqueDocument = (d) => (d?.kind === 'contrat' && /^convention/i.test(String(d.label || '').trim()) ? 'convention' : d?.kind)
