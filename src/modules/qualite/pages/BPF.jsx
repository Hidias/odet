// BPF : bilan pédagogique et financier, Cerfa n° 10443*17 (notice n° 50199#17, vérifiés le 29/10/2026).
// Le calcul se fait en base (bpf_calculer, 0477), société par société, sur l'exercice réglé dans Réglages › Sociétés.
// Ici : lecture du calcul, saisies là où la base ne sait pas (cadre D, certains dispositifs), contrôles de la notice,
// enregistrement de la déclaration. Une saisie l'emporte sur le calcul ; un recalcul ne l'efface jamais.
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import toast from 'react-hot-toast'
import { Calculator, Save, CheckCircle, RotateCcw } from 'lucide-react'
import { supabase } from '../../../core/supabase'
import { PageHeader, Banner } from '../../../ui'
import { confirmer } from '../../../ui/Confirm'
import { LIGNES_BPF, CADRES_BPF, valeursRetenues, controlesBpf } from '../../formation/lib/bpf'

const ANNEE_DEFAUT = new Date().getFullYear() - 1 // le BPF porte sur le dernier exercice clos
const fmtDate = (d) => (d ? new Date(`${String(d).slice(0, 10)}T12:00:00`).toLocaleDateString('fr-FR') : '')
const fmtNombre = (n) => Number(n || 0).toLocaleString('fr-FR')

export default function BPF() {
  const [annee, setAnnee] = useState(ANNEE_DEFAUT)
  const [declaration, setDeclaration] = useState(null)
  const [calcul, setCalcul] = useState(null)
  const [saisies, setSaisies] = useState({})
  const [specialites, setSpecialites] = useState([])
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    supabase.from('bpf_specialites').select('code, libelle').then(({ data }) => setSpecialites(data || []))
  }, [])

  // Déclaration enregistrée de l'année (la base ne montre que celles de la société courante)
  useEffect(() => {
    let annule = false
    setCalcul(null); setDeclaration(null); setSaisies({})
    supabase.from('bpf_declarations').select('*').eq('year', annee).maybeSingle().then(({ data, error }) => {
      if (annule) return
      if (error) { toast.error(`BPF non chargé : ${error.message}`); return }
      if (data) { setDeclaration(data); setCalcul(data.calcul || null); setSaisies(data.saisies || {}) }
    })
    return () => { annule = true }
  }, [annee])

  const retenues = useMemo(() => valeursRetenues(calcul?.lignes || {}, saisies), [calcul, saisies])
  const f4 = calcul?.lignes?.['F-4'] || {}
  const ecarts = calcul ? controlesBpf(retenues, f4.total, calcul.part_ca) : []
  const libelleSpec = (code) => specialites.find((s) => s.code === code)?.libelle || ''
  const depose = !!declaration?.submitted_at

  const calculer = async () => {
    setBusy(true)
    const { data, error } = await supabase.rpc('bpf_calculer', { p_annee: annee })
    setBusy(false)
    if (error) { toast.error(error.message); return }
    setCalcul(data)
    toast.success('Calcul à jour')
  }

  const enregistrer = async () => {
    if (!calcul) return
    setBusy(true)
    const ligne = {
      company_id: calcul.societe, year: annee, cerfa_version: calcul.cerfa || '10443*17', calcul, saisies,
      exercice_start: calcul.exercice?.debut || null, exercice_end: calcul.exercice?.fin || null,
      calculated_at: calcul.calcule_le || new Date().toISOString(), ca_total: retenues.C || 0,
      stagiaires_total: retenues['F-1']?.stagiaires || 0, heures_stagiaires_total: retenues['F-1']?.heures || 0,
    }
    const { data, error } = await supabase.from('bpf_declarations').upsert(ligne, { onConflict: 'company_id,year' }).select().single()
    setBusy(false)
    if (error) { toast.error(`Non enregistré : ${error.message}`); return }
    setDeclaration(data)
    toast.success('BPF enregistré')
  }

  const marquerDepose = async () => {
    if (!declaration?.id) return
    if (ecarts.length && !await confirmer(`Contrôles non satisfaits :\n${ecarts.join('\n')}\n\nNoter quand même le BPF comme déposé ?`)) return
    if (!await confirmer('Noter le BPF comme déposé sur Mon Activité Formation ? Il ne sera plus modifiable ici.')) return
    const { data, error } = await supabase.from('bpf_declarations').update({ submitted_at: new Date().toISOString(), status: 'submitted' }).eq('id', declaration.id).select().single()
    if (error) { toast.error(error.message); return }
    setDeclaration(data)
    toast.success('BPF noté comme déposé')
  }

  const saisir = (code, champ, v) => setSaisies((s) => {
    const n = { ...s }
    if (champ == null) { if (v === '') delete n[code]; else n[code] = Number(v) }
    else {
      const o = { ...(n[code] || {}) }
      if (v === '') delete o[champ]; else o[champ] = Number(v)
      if (Object.keys(o).length) n[code] = o; else delete n[code]
    }
    return n
  })

  // Fonctions d'affichage (pas des composants) : un champ ne perd pas la main à chaque frappe
  const cellule = (l, champ) => {
    const calc = champ == null ? calcul?.lignes?.[l.code] : calcul?.lignes?.[l.code]?.[champ]
    const saisie = champ == null ? saisies[l.code] : saisies[l.code]?.[champ]
    const retenu = champ == null ? retenues[l.code] : retenues[l.code]?.[champ]
    if (l.total) return <span className="font-semibold tabular-nums">{fmtNombre(retenu)}</span>
    return (
      <div className="flex items-center gap-2 justify-end">
        <input type="number" min="0" step="1" inputMode="numeric" className="input w-24 text-right tabular-nums" disabled={depose}
          placeholder={fmtNombre(Math.round(Number(calc) || 0))} value={saisie ?? ''}
          aria-label={`${l.code} ${champ || ''}`} onChange={(e) => saisir(l.code, champ, e.target.value)} />
        {saisie != null && <span className="text-ui-sm text-[rgb(var(--c-warning))]" title={`Calcul : ${fmtNombre(Math.round(Number(calc) || 0))}`}>saisi</span>}
      </div>
    )
  }

  const cadreBpf = (cadre, titre) => {
    if (cadre === 'F-4') {
      return (
        <section className="card">
          <h3 className="font-semibold mb-2">{titre}</h3>
          <div className="overflow-x-auto"><table className="w-full text-ui">
            <thead><tr className="text-gray-500 text-left"><th className="py-1">Spécialité</th><th className="text-right">Stagiaires</th><th className="text-right">Heures</th></tr></thead>
            <tbody className="divide-y">
              {(f4.principales || []).map((p) => (
                <tr key={p.code}><td className="py-1.5">{p.code} {libelleSpec(p.code)}</td><td className="text-right tabular-nums">{fmtNombre(p.stagiaires)}</td><td className="text-right tabular-nums">{fmtNombre(p.heures)}</td></tr>
              ))}
              <tr><td className="py-1.5">Autres spécialités</td><td className="text-right tabular-nums">{fmtNombre(f4.autres?.stagiaires)}</td><td className="text-right tabular-nums">{fmtNombre(f4.autres?.heures)}</td></tr>
              <tr className="font-semibold"><td className="py-1.5">Total</td><td className="text-right tabular-nums">{fmtNombre(f4.total?.stagiaires)}</td><td className="text-right tabular-nums">{fmtNombre(f4.total?.heures)}</td></tr>
            </tbody>
          </table></div>
          <p className="text-ui-sm text-gray-500 mt-2">D&apos;après la spécialité de chaque formation (fiche formation), les 5 principales par heures.</p>
        </section>
      )
    }
    const lignes = LIGNES_BPF.filter((l) => l.cadre === cadre)
    const type = lignes[0]?.type
    const champs = type === 'montant' ? [null] : type === 'ph' ? ['personnes', 'heures'] : ['stagiaires', 'heures']
    return (
      <section className="card">
        <h3 className="font-semibold mb-2">{titre}</h3>
        <div className="overflow-x-auto"><table className="w-full text-ui">
          {type !== 'montant' && <thead><tr className="text-gray-500"><th /><th className="text-right">{type === 'ph' ? 'Personnes' : 'Stagiaires'}</th><th className="text-right">Heures</th></tr></thead>}
          <tbody className="divide-y">
            {lignes.map((l) => (
              <tr key={l.code} className={l.total ? 'bg-gray-50' : ''}>
                <td className={`py-1.5 pr-3 ${l.sous ? 'pl-4 text-gray-600' : ''} ${l.total ? 'font-semibold' : ''}`}>
                  <span className="text-ui-sm text-gray-400 mr-2">{l.code}</span>{l.label}
                  {(calcul?.a_saisir || []).includes(l.code) && <span className="ml-2 text-ui-sm text-[rgb(var(--c-info))]">à saisir</span>}
                </td>
                {champs.map((c) => <td key={c || 'm'} className="py-1.5">{cellule(l, c)}</td>)}
              </tr>
            ))}
          </tbody>
        </table></div>
        {cadre === 'C' && calcul && <p className="text-ui-sm text-gray-500 mt-2">Part du chiffre d&apos;affaires venant de la formation : {calcul.part_ca == null ? 'sans objet' : `${calcul.part_ca} %`}. {calcul.detail?.hors_formation ? `${calcul.detail.hors_formation} facture(s) hors formation comptée(s) dans le chiffre d'affaires total seulement.` : ''}</p>}
        {cadre === 'D' && <p className="text-ui-sm text-gray-500 mt-2">Montants de la comptabilité (à demander à l&apos;expert-comptable).</p>}
      </section>
    )
  }

  return (
    <div className="space-y-4">
      <PageHeader title="Bilan pédagogique et financier" eyebrow="Cerfa n° 10443*17"
        meta={calcul?.exercice ? `Exercice du ${fmtDate(calcul.exercice.debut)} au ${fmtDate(calcul.exercice.fin)}` : 'Dépôt avant le 30 avril sur Mon Activité Formation'}
        actions={(
          <div className="flex flex-wrap gap-2">
            <select className="select" value={annee} onChange={(e) => setAnnee(Number(e.target.value))} aria-label="Exercice">
              {Array.from({ length: 6 }, (_, i) => ANNEE_DEFAUT + 1 - i).map((a) => <option key={a} value={a}>Exercice {a}</option>)}
            </select>
            <button type="button" className="btn btn-secondary" onClick={calculer} disabled={busy || depose}><Calculator className="w-4 h-4" />{calcul ? 'Recalculer' : 'Calculer'}</button>
            <button type="button" className="btn btn-primary" onClick={enregistrer} disabled={busy || !calcul || depose}><Save className="w-4 h-4" />Enregistrer</button>
          </div>
        )} />

      {depose && <Banner tone="success" title="BPF déposé">Noté comme déposé le {fmtDate(declaration.submitted_at)}. Il n&apos;est plus modifiable ici.</Banner>}
      {!calcul && <Banner tone="info" title="Aucun calcul pour cet exercice">Lancez le calcul : il lit vos factures et vos sessions de l&apos;exercice, réglé dans Réglages › Sociétés (mois de début).</Banner>}

      {calcul && (
        <>
          {(calcul.a_classer?.objectif?.length > 0 || calcul.a_classer?.specialite?.length > 0) && (
            <Banner tone="warning" title="Formations à classer avant le dépôt">
              {calcul.a_classer.objectif?.length > 0 && <p>Objectif manquant : {calcul.a_classer.objectif.join(', ')}.</p>}
              {calcul.a_classer.specialite?.length > 0 && <p>Spécialité manquante : {calcul.a_classer.specialite.join(', ')}.</p>}
              <p className="mt-1"><Link to="/formations" className="underline">Compléter les fiches formation</Link>, puis recalculer.</p>
            </Banner>
          )}
          {calcul.detail?.heures_prevues > 0 && (
            <Banner tone="info">{calcul.detail.heures_prevues} participation(s) sans document émis : la durée prévue de la formation est comptée. Émettez les attestations pour compter les heures réellement suivies.</Banner>
          )}
          {ecarts.length > 0 && <Banner tone="warning" title="Contrôles de la notice">{ecarts.map((e) => <p key={e}>{e}</p>)}</Banner>}
          {ecarts.length === 0 && <Banner tone="success">Contrôles de la notice satisfaits (totaux F-1, F-3 et F-4 identiques).</Banner>}

          {CADRES_BPF.map((c) => <div key={c.cadre}>{cadreBpf(c.cadre, c.titre)}</div>)}

          <section className="card">
            <h3 className="font-semibold mb-1">Hypothèses du calcul</h3>
            <ul className="list-disc pl-5 text-ui text-gray-600">{(calcul.hypotheses || []).map((h) => <li key={h}>{h}</li>)}</ul>
            <p className="text-ui-sm text-gray-500 mt-2">Calculé le {new Date(calcul.calcule_le).toLocaleString('fr-FR')}. Le formulaire officiel se remplit sur Mon Activité Formation.</p>
          </section>

          <div className="flex flex-wrap gap-2 justify-end">
            {Object.keys(saisies).length > 0 && !depose && (
              <button type="button" className="btn btn-ghost" onClick={async () => { if (await confirmer('Effacer toutes les saisies et revenir au calcul ?')) setSaisies({}) }}><RotateCcw className="w-4 h-4" />Effacer les saisies</button>
            )}
            {declaration?.id && !depose && <button type="button" className="btn btn-secondary" onClick={marquerDepose}><CheckCircle className="w-4 h-4" />Noter comme déposé</button>}
          </div>
        </>
      )}
    </div>
  )
}
