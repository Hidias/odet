// Signataire prévu par un document de l'espace client (0496, décision de H du 06/11) : nom proposé, modifiable ; un
// autre nom est signalé à l'écran, écrit dans la preuve et rappelé côté organisme. Accents, majuscules et espaces ne
// comptent pas.

const plat = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim()

export const signeALaPlace = (nom, prevu) => !!(prevu?.name && plat(nom) && plat(nom) !== plat(prevu.name))

/** « à la place de Alice MARTIN » quand le signataire diffère du signataire prévu, sinon '' (côté organisme) */
export const aLaPlaceDe = (nom, prevu) => (signeALaPlace(nom, prevu) ? ` à la place de ${String(prevu.name).trim()}` : '')
