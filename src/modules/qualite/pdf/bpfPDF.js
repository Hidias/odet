// BPF, document de travail (lot 1c) : les valeurs retenues ligne par ligne, prêtes à reporter sur Mon Activité Formation.
// Ce n'est pas le formulaire officiel (Cerfa n° 10443*17, rempli en ligne) : aucune imitation de sa mise en page.
// Valeurs retenues = saisie quand elle existe, sinon calcul (valeursRetenues), comme à l'écran.
// Mise en page commune (core/pdf/layout.js), identité lue dans organization_settings.

import jsPDF from 'jspdf'
import 'jspdf-autotable'
import { startDocument, numberPages } from '../../../core/pdf/layout'
import { loadPdfOrg } from '../../../core/pdf/pdfOrg'
import { LIGNES_BPF, CADRES_BPF } from '../../formation/lib/bpf'

// Espaces insécables (séparateur des milliers) non rendus par les polices standard de jsPDF
const nombre = (n) => Number(n || 0).toLocaleString('fr-FR', { maximumFractionDigits: 0 }).replace(/[  ]/g, ' ')
const euros = (n) => `${nombre(n)} ${String.fromCharCode(8364)}`
const date = (d) => (d ? new Date(`${String(d).slice(0, 10)}T12:00:00`).toLocaleDateString('fr-FR') : '')

function estSaisi(saisies, code, champ) {
  const s = saisies?.[code]
  if (s == null) return false
  return champ == null ? typeof s === 'number' : s[champ] != null
}

/** État affiché : les chiffres modifiés depuis le dernier enregistrement ne passent jamais pour enregistrés */
export function etatDeclaration(declaration, nonEnregistre = false) {
  if (declaration?.submitted_at) return `Noté comme déposé le ${date(declaration.submitted_at)}`
  if (!declaration?.id) return 'Non enregistré'
  return nonEnregistre ? 'Modifié depuis le dernier enregistrement : chiffres non enregistrés' : 'Enregistré, non déposé'
}

/** Lignes d'un cadre prêtes pour le tableau : [code, libellé, valeurs..., origine] */
export function lignesCadre(cadre, retenues, saisies) {
  const lignes = LIGNES_BPF.filter((l) => l.cadre === cadre)
  const type = lignes[0]?.type
  return {
    type,
    corps: lignes.map((l) => {
      const v = retenues[l.code]
      if (type === 'montant') return [l.code, l.label, euros(v), l.total ? 'total' : estSaisi(saisies, l.code) ? 'saisi' : 'calcul']
      const k = type === 'ph' ? 'personnes' : 'stagiaires'
      // Origine champ par champ : une ligne à moitié saisie le dit (relecture de #261)
      const saisis = [k, 'heures'].filter((c) => estSaisi(saisies, l.code, c))
      const origine = l.total ? 'total' : saisis.length === 2 ? 'saisi' : saisis.length === 1 ? `${saisis[0]} saisi${saisis[0] === 'heures' ? 'es' : 's'}` : 'calcul'
      return [l.code, l.label, nombre(v?.[k]), nombre(v?.heures), origine]
    }),
  }
}

export async function buildBpfPDF({ calcul, retenues, saisies = {}, ecarts = [], declaration = null, nonEnregistre = false, libelleSpec = () => '' }) {
  const ORG = await loadPdfOrg(true)
  const doc = new jsPDF({ compress: true })
  const ex = calcul?.exercice || {}
  const f = startDocument(doc, ORG, {
    docLabel: 'Bilan pédagogique et financier', code: 'BPF',
    title: `Bilan pédagogique et financier, exercice ${calcul?.annee ?? ''}`.trim(),
    subtitle: `Du ${date(ex.debut)} au ${date(ex.fin)}. Document de travail : valeurs à reporter sur Mon Activité Formation (Cerfa n° 10443*17).`,
  })

  f.kv([
    ['Calculé le', calcul?.calcule_le ? new Date(calcul.calcule_le).toLocaleString('fr-FR') : null],
    ['État', etatDeclaration(declaration, nonEnregistre)],
    ['Saisies', Object.keys(saisies || {}).length ? `${Object.keys(saisies).length} ligne(s) saisie(s), prioritaires sur le calcul` : 'Aucune : toutes les valeurs viennent du calcul'],
    ['Part du CA formation', calcul?.part_ca == null ? 'Sans objet' : `${calcul.part_ca} %`],
  ].filter((r) => r[1]), { labelW: 40 })

  const b2Saisi = typeof saisies['B-2'] === 'boolean'
  const b2 = b2Saisi ? saisies['B-2'] : !!calcul?.lignes?.['B-2']
  f.section('B-2. Formation à distance')
  f.para(`${b2 ? 'Oui' : 'Non'} (${b2Saisi ? 'saisi' : 'calcul'}) : actions de formation à distance pendant l'exercice.`)

  const f4 = calcul?.lignes?.['F-4'] || {}
  for (const { cadre, titre } of CADRES_BPF) {
    f.section(titre)
    if (cadre === 'F-4') {
      const corps = (f4.principales || []).map((p) => [p.code, libelleSpec(p.code), nombre(p.stagiaires), nombre(p.heures)])
      corps.push(['', 'Autres spécialités', nombre(f4.autres?.stagiaires), nombre(f4.autres?.heures)])
      corps.push(['', 'Total', nombre(f4.total?.stagiaires), nombre(f4.total?.heures)])
      f.table(['Code', 'Spécialité', 'Stagiaires', 'Heures'], corps, {
        columnStyles: { 0: { cellWidth: 16 }, 2: { cellWidth: 24, halign: 'right' }, 3: { cellWidth: 24, halign: 'right' } },
      })
      continue
    }
    const { type, corps } = lignesCadre(cadre, retenues, saisies)
    if (type === 'montant') {
      f.table(['Ligne', 'Libellé', 'Montant HT', 'Origine'], corps, {
        columnStyles: { 0: { cellWidth: 18 }, 2: { cellWidth: 30, halign: 'right' }, 3: { cellWidth: 18 } },
      })
    } else {
      f.table(['Ligne', 'Libellé', type === 'ph' ? 'Personnes' : 'Stagiaires', 'Heures', 'Origine'], corps, {
        columnStyles: { 0: { cellWidth: 18 }, 2: { cellWidth: 22, halign: 'right' }, 3: { cellWidth: 22, halign: 'right' }, 4: { cellWidth: 28 } },
      })
    }
  }

  f.section('Contrôles de la notice')
  if (ecarts.length) f.bullets(ecarts)
  else f.para((retenues?.C || 0) > 0
    ? 'Satisfaits : totaux F-1, F-3 et F-4 identiques, part du chiffre d\'affaires renseignée.'
    : 'Satisfaits : totaux F-1, F-3 et F-4 identiques. Part du chiffre d\'affaires sans objet (aucun produit de formation).')

  const points = []
  const d = calcul?.detail || {}
  if (d.factures_a_verifier?.length) points.push(`Factures à vérifier (entreprise sans subrogation, prise en charge OPCO prévue, rangées en C-1) : ${d.factures_a_verifier.join(', ')}.`)
  if (d.heures_inconnues?.length) points.push(`Sous-traitance reçue sans durée connue (heures du cadre G à saisir) : ${d.heures_inconnues.join(', ')}.`)
  if (calcul?.a_classer?.objectif?.length) points.push(`Formations sans objectif : ${calcul.a_classer.objectif.join(', ')}.`)
  if (calcul?.a_classer?.specialite?.length) points.push(`Formations sans spécialité : ${calcul.a_classer.specialite.join(', ')}.`)
  if (d.heures_prevues > 0) points.push(`${d.heures_prevues} participation(s) comptée(s) sur la durée prévue, faute de document émis.`)
  if (points.length) { f.section('Points à vérifier avant le dépôt'); f.bullets(points) }

  if (calcul?.hypotheses?.length) { f.section('Hypothèses du calcul'); f.bullets(calcul.hypotheses) }
  f.space(2)
  f.note('Le bilan pédagogique et financier se déclare en ligne sur Mon Activité Formation. Ce document sert à préparer et à conserver la déclaration ; il ne la remplace pas.')
  f.finish()
  numberPages(doc, ORG)
  return { doc, filename: `BPF_${calcul?.annee ?? 'exercice'}_${String(ex.debut || '').slice(0, 10)}_${String(ex.fin || '').slice(0, 10)}.pdf` }
}
