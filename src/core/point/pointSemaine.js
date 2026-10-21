// Point de la semaine et bilan (0407) : sections, lignes visibles, email. Partagé par la page et la route d'envoi.

export const SECTIONS = [
  { id: 'urgent', titre: 'Urgent', pt: true, bi: true },
  { id: 'semaine', titre: 'Cette semaine', pt: true, bi: true },
  { id: 'non_fait', titre: 'Pas fait la semaine passée', pt: true, bi: true },
  { id: 'relancer', titre: 'À relancer', pt: true, bi: true },
  { id: 'bravo', titre: 'Bravo', pt: true, bi: true },
  { id: 'anniversaire', titre: 'Anniversaires clients', pt: true, bi: false },
  { id: 'divers', titre: 'Divers', pt: true, bi: true },
]

export const SUITES = [
  { id: 'fait', libelle: 'Fait' },
  { id: 'reporte', libelle: 'Reporté' },
  { id: 'abandonne', libelle: 'Abandonné' },
]

const pad = (n) => String(n).padStart(2, '0')
export const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

/** Lundi de la semaine d'une date (AAAA-MM-JJ) */
export function lundi(date = new Date()) {
  const d = typeof date === 'string' ? new Date(`${date}T12:00:00`) : new Date(date)
  const j = (d.getDay() + 6) % 7
  d.setDate(d.getDate() - j)
  return iso(d)
}

export function decaler(semaine, jours) {
  const d = new Date(`${semaine}T12:00:00`)
  d.setDate(d.getDate() + jours)
  return iso(d)
}

export const jjmm = (s) => (s ? `${s.slice(8, 10)}/${s.slice(5, 7)}` : '')

export function titreSemaine(semaine) {
  return `Semaine du ${jjmm(semaine)} au ${jjmm(decaler(semaine, 6))}`
}

/** Lignes gardées (non retirées), rangées par section, dans l'ordre des sections */
export function parSection(lignes, kind = 'point') {
  return SECTIONS.filter((s) => (kind === 'bilan' ? s.bi : s.pt))
    .map((s) => ({ ...s, lignes: visibles(lignes).filter((l) => (l.section || 'divers') === s.id) }))
    .filter((s) => s.lignes.length)
}

/** Lignes non retirées ; une action déjà rattachée à une autre ligne du point n'apparaît pas une seconde fois */
export function visibles(lignes) {
  const liste = lignes || []
  const rattachees = new Set(liste.filter((l) => l.action_id && l.id !== `act:${l.action_id}`).map((l) => String(l.action_id)))
  return liste.filter((l) => !l.retire && !(String(l.id).startsWith('act:') && rattachees.has(String(l.id).slice(4))))
}

const esc = (s) => String(s ?? '').replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]))
const SUITE_TXT = { fait: 'fait', reporte: 'reporté', abandonne: 'abandonné' }

/** Email du point ou du bilan : sections, responsable de chaque ligne, suite (bilan), note de la direction */
export function emailPoint(brief, { appUrl = '', couleur = '#1f2937', bonjour = 'Bonjour,', signature = '' } = {}) {
  const kind = brief.kind === 'bilan' ? 'bilan' : 'point'
  const sections = parSection(brief.lines, kind)
  const intro = kind === 'bilan'
    ? `Voici le bilan de la ${titreSemaine(brief.week_start).toLowerCase()}.`
    : `Voici le point de la ${titreSemaine(brief.week_start).toLowerCase()}.`
  const blocs = sections.map((s) => `
    <h3 style="font-size:15px;margin:18px 0 6px;color:${esc(couleur)};">${esc(s.titre)} (${s.lignes.length})</h3>
    <ul style="margin:0;padding-left:18px;">
      ${s.lignes.map((l) => {
        const lien = l.lien && appUrl ? `${appUrl}/#${l.lien}` : ''
        const qui = l.owner_nom ? ` <span style="color:#6b7280;">(${esc(l.owner_nom)})</span>` : ''
        const suite = kind === 'bilan' && l.suite ? ` <strong>${esc(SUITE_TXT[l.suite] || '')}</strong>` : ''
        const texte = lien ? `<a href="${esc(lien)}" style="color:#111827;">${esc(l.texte)}</a>` : esc(l.texte)
        return `<li style="font-size:14px;line-height:1.5;margin-bottom:4px;">${texte}${qui}${suite}</li>`
      }).join('')}
    </ul>`).join('')
  const note = brief.note ? `<p style="font-size:14px;line-height:1.6;white-space:pre-line;border-left:3px solid ${esc(couleur)};padding-left:10px;">${esc(brief.note)}</p>` : ''
  return `<div style="font-family:Arial,sans-serif;color:#111827;max-width:680px;">
    <p style="font-size:15px;">${esc(bonjour)}</p>
    <p style="font-size:15px;">${esc(intro)}</p>
    ${note}
    ${blocs || '<p style="font-size:14px;">Rien à signaler.</p>'}
    <p style="font-size:12px;color:#9ca3af;margin-top:24px;">${esc(signature)}</p>
  </div>`
}

export function objetEmail(brief, nomOrganisme = '') {
  const t = brief.kind === 'bilan' ? 'Bilan' : 'Point'
  return `${t} de la semaine du ${jjmm(brief.week_start)}${nomOrganisme ? ` : ${nomOrganisme}` : ''}`
}
