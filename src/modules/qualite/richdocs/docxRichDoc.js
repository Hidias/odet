// Export Word et réimport des documents qualité au nouveau modèle (pilotage de H du 24/10 : conditions générales
// relues par l'avocat). Aucun service extérieur : le fichier .docx est construit et relu dans le navigateur (jszip).
//
// Export : un titre, puis une section par article (titre en « Titre 2 »), les articles réservés aux particuliers ou
// aux professionnels marqués [particuliers] / [professionnels] dans leur titre, les listes en puces, les tableaux en
// tableaux Word, les encadrés « À valider par l'avocat ». Les champs entre accolades ({{org.nom}}…) restent tels
// quels : l'outil les remplit à l'impression.
// Réimport : le fichier relu (modifications suivies acceptées, commentaires ignorés) redevient un contenu au même
// modèle ; la comparaison section par section montre ce que l'avocat a changé avant de l'enregistrer en brouillon.

import JSZip from 'jszip'

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

// Texte avec **gras** en « runs » Word
function runs(text) {
  return String(text ?? '').split(/(\*\*[^*]+\*\*)/g).filter(Boolean).map((part) => {
    const bold = /^\*\*[^*]+\*\*$/.test(part)
    const t = bold ? part.slice(2, -2) : part
    return `<w:r>${bold ? '<w:rPr><w:b/></w:rPr>' : ''}<w:t xml:space="preserve">${esc(t)}</w:t></w:r>`
  }).join('')
}
const para = (text, style) => `<w:p>${style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : ''}${runs(text)}</w:p>`

function table(head, rows) {
  const cell = (t, bold) => `<w:tc><w:tcPr><w:tcW w:w="0" w:type="auto"/></w:tcPr><w:p>${bold ? runs(`**${String(t ?? '').replace(/\*\*/g, '')}**`) : runs(t)}</w:p></w:tc>`
  const tr = (cells, bold) => `<w:tr>${cells.map((c) => cell(c, bold)).join('')}</w:tr>`
  return `<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/><w:tblW w:w="0" w:type="auto"/><w:tblBorders>${['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map((b) => `<w:${b} w:val="single" w:sz="4" w:space="0" w:color="999999"/>`).join('')}</w:tblBorders></w:tblPr>${head?.length ? tr(head, true) : ''}${(rows || []).map((r) => tr(r, false)).join('')}</w:tbl><w:p/>`
}

export const MARQUE_COND = { particuliers: '[particuliers]', professionnels: '[professionnels]' }

/** Blocs d'une section en XML Word */
function blocsXml(blocks) {
  return (blocks || []).map((b) => {
    if (b.t === 'p') return para(b.text)
    if (b.t === 'h') return para(b.text, 'Heading3')
    if (b.t === 'note') return para(b.text, 'Note')
    if (b.t === 'quote') return (b.paras || []).map((x) => para(x, 'Quote')).join('')
    if (b.t === 'ul') return (b.items || []).map((x) => para(`• ${x}`)).join('')
    if (b.t === 'ol') return (b.items || []).map((x, i) => para(`${(b.start || 1) + i}. ${x}`)).join('')
    if (b.t === 'check') return (b.items || []).map((x) => para(`☐ ${x}`)).join('')
    if (b.t === 'table') return table(b.head, b.rows)
    return ''
  }).join('')
}

/** Corps Word d'un document (titre de niveau 1 et ses sections) */
export function documentXml({ titre, sections, avant = [] }) {
  return [
    titre ? para(titre, 'Heading1') : '',
    ...avant.map((t) => para(t, 'Note')),
    ...(sections || []).map((s) => para(`${s.title || 'Introduction'}${s.cond ? ` ${MARQUE_COND[s.cond] || ''}` : ''}`, 'Heading2') + blocsXml(s.blocks)),
  ].join('')
}

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/><w:sz w:val="22"/><w:lang w:val="fr-FR"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="360" w:after="160"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:sz w:val="32"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="240" w:after="80"/><w:outlineLvl w:val="1"/></w:pPr><w:rPr><w:b/><w:sz w:val="26"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading3"><w:name w:val="heading 3"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:pPr><w:keepNext/><w:outlineLvl w:val="2"/></w:pPr><w:rPr><w:b/></w:rPr></w:style>
<w:style w:type="paragraph" w:customStyle="1" w:styleId="Note"><w:name w:val="Note"/><w:basedOn w:val="Normal"/><w:pPr><w:shd w:val="clear" w:color="auto" w:fill="FFF4D6"/><w:ind w:left="200" w:right="200"/></w:pPr><w:rPr><w:i/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Quote"><w:name w:val="Quote"/><w:basedOn w:val="Normal"/><w:pPr><w:ind w:left="400"/></w:pPr><w:rPr><w:i/></w:rPr></w:style>
<w:style w:type="table" w:styleId="TableGrid"><w:name w:val="Table Grid"/><w:tblPr><w:tblCellMar><w:left w:w="80" w:type="dxa"/><w:right w:w="80" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style>
</w:styles>`

/** Fichier .docx (Blob) à partir du corps Word */
export async function fichierDocx(corps) {
  const zip = new JSZip()
  zip.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>')
  zip.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>')
  zip.file('word/_rels/document.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>')
  zip.file('word/styles.xml', STYLES)
  zip.file('word/document.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${corps}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="567" w:footer="567" w:gutter="0"/></w:sectPr></w:body></w:document>`)
  return zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' })
}

/** Document qualité en Word, prêt pour l'avocat */
export function exportDocx({ tpl, content, code }) {
  return fichierDocx(documentXml({
    titre: `${tpl.name}${code ? ` (${code})` : ''}`,
    avant: [
      `Version ${content?.version ? `${content.version} validée` : 'de travail'} exportée le ${new Date().toLocaleDateString('fr-FR')} pour relecture. Modifiez directement le texte (les modifications suivies sont acceptées) ; ne changez pas les titres d'article ni les marques [particuliers] et [professionnels], qui disent à qui s'adresse chaque article.`,
      'Les champs entre accolades ({{org.nom}}, {{org.siret}}…) sont remplis par l\'outil à l\'impression : gardez-les tels quels. Les passages entre crochets sont à compléter.',
    ],
    sections: content?.sections || [],
  }))
}

// ── Réimport ──
const texteNoeud = (n) => {
  // Texte d'un paragraphe Word : runs, avec le gras ; insertions suivies gardées, suppressions suivies écartées
  let out = ''
  const walk = (el) => {
    for (const c of Array.from(el.childNodes || [])) {
      const nom = c.localName
      if (nom === 'del' || nom === 'moveFrom' || nom === 'commentReference' || nom === 'pPr') continue
      if (nom === 'r') {
        const gras = !!Array.from(c.getElementsByTagNameNS('*', 'b')).find((b) => b.parentNode?.localName === 'rPr' && b.getAttribute('w:val') !== '0' && b.getAttribute('w:val') !== 'false')
        let t = ''
        for (const x of Array.from(c.childNodes)) {
          if (x.localName === 't') t += x.textContent
          else if (x.localName === 'tab') t += ' '
          else if (x.localName === 'br') t += ' '
        }
        if (t) out += gras && t.trim() ? `**${t}**` : t
      } else walk(c)
    }
  }
  walk(n)
  return out.replace(/\*\*\*\*/g, '').replace(/\s+/g, ' ').trim()
}
const styleDe = (p) => {
  const ps = Array.from(p.getElementsByTagNameNS('*', 'pStyle'))[0]
  return ps ? ps.getAttribute('w:val') || '' : ''
}

/**
 * Contenu (sections) relu depuis un fichier .docx exporté par l'outil.
 * @param {ArrayBuffer} buf fichier .docx
 * @param {object[]} actuelles sections actuelles (identifiants gardés quand le titre correspond)
 */
export async function importDocx(buf, actuelles = []) {
  const zip = await JSZip.loadAsync(buf)
  const xml = await zip.file('word/document.xml')?.async('string')
  if (!xml) throw new Error('Fichier Word illisible')
  const dom = new DOMParser().parseFromString(xml, 'application/xml')
  const body = dom.getElementsByTagNameNS('*', 'body')[0]
  if (!body) throw new Error('Fichier Word illisible')
  const sections = []
  let cur = null
  const parTitre = new Map((actuelles || []).map((s) => [normTitre(s.title), s]))
  const ajoute = (b) => {
    if (!cur) return
    const last = cur.blocks[cur.blocks.length - 1]
    if (b.t === 'ul' || b.t === 'ol' || b.t === 'check' || b.t === 'quote') {
      if (last && last.t === b.t) { if (b.t === 'quote') last.paras.push(...b.paras); else last.items.push(...b.items); return }
    }
    cur.blocks.push(b)
  }
  for (const n of Array.from(body.childNodes)) {
    if (n.localName === 'p') {
      const st = styleDe(n)
      const t = texteNoeud(n)
      if (/^(Heading|Titre)1$|^Title$/i.test(st)) continue
      if (/^(Heading|Titre)2$/i.test(st)) {
        let titre = t.replace(/\*\*/g, '')
        let cond
        for (const [k, m] of Object.entries(MARQUE_COND)) if (titre.includes(m)) { cond = k; titre = titre.replace(m, '').trim() }
        const ref = parTitre.get(normTitre(titre))
        cur = { id: ref?.id || `s-imp-${sections.length + 1}`, title: titre === 'Introduction' ? '' : titre, ...(cond ? { cond } : {}), blocks: [] }
        sections.push(cur)
        continue
      }
      if (!t) continue
      if (/^(Heading|Titre)3$/i.test(st)) ajoute({ t: 'h', text: t })
      else if (/^Note$/i.test(st) || /^À valider par l'avocat/i.test(t)) ajoute({ t: 'note', text: t })
      else if (/^Quote$|^Citation$/i.test(st)) ajoute({ t: 'quote', paras: [t] })
      else if (/^[•·▪-]\s/.test(t)) ajoute({ t: 'ul', items: [t.replace(/^[•·▪-]\s+/, '')] })
      else if (/^☐\s/.test(t)) ajoute({ t: 'check', items: [t.replace(/^☐\s+/, '')] })
      else if (/^\d+\.\s/.test(t)) ajoute({ t: 'ol', items: [t.replace(/^\d+\.\s+/, '')] })
      else ajoute({ t: 'p', text: t })
    } else if (n.localName === 'tbl' && cur) {
      const lignes = Array.from(n.getElementsByTagNameNS('*', 'tr')).map((tr) => Array.from(tr.getElementsByTagNameNS('*', 'tc')).map((tc) => Array.from(tc.getElementsByTagNameNS('*', 'p')).map(texteNoeud).filter(Boolean).join(' ')))
      if (lignes.length) {
        const head = lignes[0].map((h) => h.replace(/^\*\*|\*\*$/g, ''))
        ajoute({ t: 'table', head, rows: lignes.slice(1) })
      }
    }
  }
  if (!sections.length) throw new Error('Aucun article trouvé : importez un fichier exporté par l\'outil (titres d\'article en « Titre 2 »)')
  return { sections }
}

function normTitre(t) {
  return String(t || '').replace(/^Article\s+\d+\.\s*/i, '').replace(/\[(particuliers|professionnels)\]/g, '').toLowerCase().replace(/\s+/g, ' ').trim()
}

// ── Comparaison ──
const texteSection = (s) => (s?.blocks || []).map((b) => {
  if (b.t === 'p' || b.t === 'h' || b.t === 'note') return b.text
  if (b.t === 'quote') return (b.paras || []).join(' ')
  if (b.t === 'table') return [...(b.head || []), ...(b.rows || []).flat()].join(' | ')
  return (b.items || []).join(' ; ')
}).join('\n')

/** Différence mot à mot : [{ t: '=' | '+' | '-', s }] */
export function diffMots(a, b) {
  const A = String(a || '').split(/(\s+)/).filter((x) => x !== '')
  const B = String(b || '').split(/(\s+)/).filter((x) => x !== '')
  if (A.length * B.length > 4_000_000) return [{ t: '-', s: a }, { t: '+', s: b }]
  const n = A.length, m = B.length
  const L = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1))
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = A[i] === B[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1])
  const out = []
  const push = (t, s) => { const l = out[out.length - 1]; if (l && l.t === t) l.s += s; else out.push({ t, s }) }
  let i = 0, j = 0
  while (i < n && j < m) {
    if (A[i] === B[j]) { push('=', A[i]); i++; j++ } else if (L[i + 1][j] >= L[i][j + 1]) { push('-', A[i]); i++ } else { push('+', B[j]); j++ }
  }
  while (i < n) push('-', A[i++])
  while (j < m) push('+', B[j++])
  return out
}

/** Changements section par section entre le document actuel et la version relue */
export function comparerSections(avant, apres) {
  const out = []
  const parId = new Map((avant || []).map((s) => [s.id, s]))
  const vus = new Set()
  for (const s of apres || []) {
    const a = parId.get(s.id)
    if (!a) { out.push({ type: 'ajout', title: s.title, cond: s.cond, diff: [{ t: '+', s: texteSection(s) }] }); continue }
    vus.add(s.id)
    const ta = texteSection(a), tb = texteSection(s)
    const condChange = (a.cond || '') !== (s.cond || '')
    if (ta === tb && a.title === s.title && !condChange) out.push({ type: 'identique', title: s.title, cond: s.cond })
    else out.push({ type: 'modif', title: s.title, titreAvant: a.title !== s.title ? a.title : null, cond: s.cond, condChange, diff: diffMots(ta, tb) })
  }
  for (const a of avant || []) if (!vus.has(a.id)) out.push({ type: 'retrait', title: a.title, cond: a.cond, diff: [{ t: '-', s: texteSection(a) }] })
  return out
}

// ── Dossier pour l'avocat ──
// Points à faire valider par métier (pilotage de H du 24/10), repris en tête du dossier
export const POINTS_AVOCAT = [
  { titre: 'Maintenance et vérification', points: ['Durée du contrat et reconduction tacite, avec l\'information obligatoire du particulier (articles L215-1 et suivants du Code de la consommation)', 'Résiliation', 'Révision du prix (indice, formule, information du client)', 'Accès au site et obligations du client', 'Responsabilité limitée aux appareils vérifiés, au jour de la visite', 'Non-conformités signalées et charge de la mise en conformité'] },
  { titre: 'Vente de matériel', points: ['Réserve de propriété', 'Transfert des risques (professionnel, consommateur)', 'Garanties (fabricant, garantie légale de conformité, vices cachés) et encadré réglementaire', 'Retours et droit de rétractation'] },
  { titre: 'Installation et travaux', points: ['Réception (expresse, tacite) et réserves', 'Garanties légales (parfait achèvement, bon fonctionnement, décennale) et mentions d\'assurance', 'Acompte et paiement du particulier démarché (délai de 7 jours)', 'Déchets de chantier'] },
  { titre: 'Formation', points: ['Annulation et dédit', 'Absences et heures non suivies', 'Report du fait du client ou de l\'organisme', 'Contrat de formation du particulier (rétractation de 10 jours, acompte)'] },
  { titre: 'Tous les devis', points: ['Clause du devis établi à distance (informations du client, vérification, écart)', 'Avenant : écart chiffré soumis à l\'accord du client avant exécution, signé en ligne', 'Mention « L\'acceptation du devis vaut acceptation des conditions générales jointes » et case à cocher en signature en ligne', 'Taux réduit de TVA : attestation du client sur le devis (à valider aussi par l\'expert-comptable)'] },
]

/** Dossier Word pour l'avocat : points à valider, chaque jeu de conditions, mentions des devis */
const LIBELLES_MENTIONS = {
  cgv: 'Acceptation des conditions générales (près de la signature)', distance: 'Devis établi à distance', materiel: 'Prix du matériel',
  acompte: 'Acompte à la commande', delai: 'Délai de livraison ou d\'intervention', eco: 'Éco-participation',
  retractation: 'Rétractation (particulier)', garanties: 'Garanties légales (particulier)', tva_reduite: 'Taux réduit de TVA (attestation du particulier)',
  rc_pro: 'Assurance responsabilité civile professionnelle', decennale: 'Assurance décennale', dechets: 'Déchets de chantier', avenant: 'Avenant au devis signé',
}

export function dossierAvocatDocx({ docs = [], mentions = {}, libellesMentions = LIBELLES_MENTIONS }) {
  const parts = [
    para('Dossier de relecture des conditions commerciales', 'Heading1'),
    para(`Préparé le ${new Date().toLocaleDateString('fr-FR')}. Chaque document peut être relu ici, ou séparément (export Word depuis Qualité › Documents) puis réimporté dans l'outil, qui montre les changements avant de les enregistrer. Les passages marqués « À valider par l'avocat » sont des projets.`, 'Note'),
    para('Points à valider, par métier', 'Heading1'),
    ...POINTS_AVOCAT.flatMap((g) => [para(g.titre, 'Heading2'), ...g.points.map((x) => para(`• ${x}`))]),
  ]
  for (const d of docs) {
    parts.push(documentXml({ titre: `${d.tpl.name}${d.code ? ` (${d.code})` : ''}${d.content?.version ? `, version ${d.content.version}` : ', projet'}`, sections: d.content?.sections || [] }))
  }
  const cles = Object.keys(mentions || {})
  if (cles.length) {
    parts.push(para('Mentions imprimées sur les devis', 'Heading1'))
    parts.push(para('Textes réglables dans Paramètres › Banque et facturation › Devis. Les champs entre accolades sont remplis par l\'outil.', 'Note'))
    for (const k of cles) {
      parts.push(para(libellesMentions[k] || k, 'Heading2'))
      parts.push(para(String(mentions[k] || '')))
    }
  }
  return fichierDocx(parts.join(''))
}
