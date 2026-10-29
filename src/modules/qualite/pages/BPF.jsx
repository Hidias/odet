// BPF : bilan pédagogique et financier, Cerfa n° 10443*17 (notice n° 50199#17, vérifiés le 29/10/2026).
// Le calcul se fait en base (bpf_calculer, 0477), société par société, sur l'exercice réglé dans Réglages › Sociétés.
// Ici : lecture du calcul, saisies là où la base ne sait pas (cadre D, certains dispositifs), contrôles de la notice,
// enregistrement de la déclaration. Une saisie l'emporte sur le calcul ; un recalcul ne l'efface jamais.
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import toast from 'react-hot-toast'
import { Calculator, Save, CheckCircle, RotateCcw, Unlock, FileDown } from 'lucide-react'
import { supabase } from '../../../core/supabase'
import { PageHeader, Banner } from '../../../ui'
import { confirmer } from '../../../ui/Confirm'
import { LIGNES_BPF, CADRES_BPF, valeursRetenues, controlesBpf, dernierExerciceClos } from '../../formation/lib/bpf'

const fmtDate = (d) => (d ? new Date(`${String(d).slice(0, 10)}T12:00:00`).toLocaleDateString('fr-FR') : '')
const fmtNombre = (n) => Number(n || 0).toLocaleString('fr-FR')

export default function BPF() {
  // Société courante et son mois de début d'exercice (Réglages › Sociétés) ; null en vue groupe
  const [societe, setSociete] = useState(undefined)
  const [annee, setAnnee] = useState(() => dernierExerciceClos(1))
  const [declaration, setDeclaration] = useState(null)
  const [calcul, setCalcul] = useState(null)
  const [saisies, setSaisies] = useState({})
  const [specialites, setSpecialites] = useState([])
  const [busy, setBusy] = useState(false)
  const anneeDefaut = dernierExerciceClos(societe?.fiscal_year_start_month)

  useEffect(() => {
    supabase.from('bpf_specialites').select('code, libelle').then(({ data }) => setSpecialites(data || []))
    ;(async () => {
      const { data: ctx } = await supabase.rpc('my_company_context')
      const id = ctx?.vue_groupe ? null : ctx?.current
      if (!id) { setSociete(null); return }
      const { data, error } = await supabase.from('companies').select('id, fiscal_year_start_month').eq('id', id).maybeSingle()
      if (error) toast.error(`Société non chargée : ${error.message}`)
      setSociete(data || null)
      if (data) setAnnee(dernierExerciceClos(data.fiscal_year_start_month))
    })()
  }, [])

  // Déclaration enregistrée de l'exercice, pour la société courante seulement (un compte peut en lire plusieurs)
  useEffect(() => {
    let annule = false
    setCalcul(null); setDeclaration(null); setSaisies({})
    if (!societe?.id) return undefined
    supabase.from('bpf_declarations').select('*').eq('company_id', societe.id).eq('year', annee).maybeSingle().then(({ data, error }) => {
      if (annule) return
      if (error) { toast.error(`BPF non chargé : ${error.message}`); return }
      if (data) { setDeclaration(data); setCalcul(data.calcul || null); setSaisies(data.saisies || {}) }
    })
    return () => { annule = true }
  }, [annee, societe?.id])

  const retenues = useMemo(() => valeursRetenues(calcul?.lignes || {}, saisies), [calcul, saisies])
  const f4 = calcul?.lignes?.['F-4'] || {}
  const ecarts = calcul ? controlesBpf(retenues, f4.total, calcul.part_ca) : []
  const libelleSpec = (code) => specialites.find((s) => s.code === code)?.libelle || ''
  const depose = !!declaration?.submitted_at

  // Exercice affiché au moment de la réponse : un calcul lancé pour une autre année est ignoré
  const anneeAffichee = useRef(annee)
  anneeAffichee.current = annee
  const calculer = async () => {
    const pour = annee
    setBusy(true)
    const { data, error } = await supabase.rpc('bpf_calculer', { p_annee: pour })
    setBusy(false)
    if (anneeAffichee.current !== pour) return
    if (error) { toast.error(error.message); return }
    setCalcul(data)
    toast.success('Calcul à jour')
  }

  // Ligne enregistrée : toujours les chiffres affichés à l'écran (calcul et saisies du moment)
  const ligneDeclaration = () => ({
    company_id: calcul.societe, year: calcul.annee ?? annee, cerfa_version: calcul.cerfa || '10443*17', calcul, saisies,
    exercice_start: calcul.exercice?.debut || null, exercice_end: calcul.exercice?.fin || null,
    calculated_at: calcul.calcule_le || new Date().toISOString(), ca_total: retenues.C || 0,
    stagiaires_total: retenues['F-1']?.stagiaires || 0, heures_stagiaires_total: retenues['F-1']?.heures || 0,
  })

  const enregistrer = async () => {
    if (!calcul) return
    setBusy(true)
    const { data, error } = await supabase.from('bpf_declarations').upsert(ligneDeclaration(), { onConflict: 'company_id,year' }).select().single()
    setBusy(false)
    if (error) { toast.error(`Non enregistré : ${error.message}`); return }
    setDeclaration(data)
    toast.success('BPF enregistré')
  }

  // Le dépôt enregistre en même temps les chiffres affichés : rien de périmé ne reste figé
  const marquerDepose = async () => {
    if (!declaration?.id || !calcul) return
    if (ecarts.length && !await confirmer(`Contrôles non satisfaits :\n${ecarts.join('\n')}\n\nNoter quand même le BPF comme déposé ?`)) return
    if (!await confirmer('Noter le BPF comme déposé sur Mon Activité Formation, avec les chiffres affichés ? Il ne sera plus modifiable ici.')) return
    setBusy(true)
    const { data, error } = await supabase.from('bpf_declarations')
      .update({ ...ligneDeclaration(), submitted_at: new Date().toISOString(), status: 'submitted' })
      .eq('id', declaration.id).select().single()
    setBusy(false)
    if (error) { toast.error(error.message); return }
    setDeclaration(data)
    toast.success('BPF enregistré et noté comme déposé')
  }

  // Chiffres à l'écran différents de ceux enregistrés (recalcul ou saisie depuis le dernier enregistrement).
  // Comparaison à clés triées : la base (jsonb) ne garde pas l'ordre des clés.
  const stable = (v) => (v && typeof v === 'object' && !Array.isArray(v)
    ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stable(v[k])}`).join(',')}}`
    : JSON.stringify(v ?? null))
  const nonEnregistre = !!declaration?.id && !!calcul && (
    (declaration.calcul?.calcule_le || null) !== (calcul.calcule_le || null) || stable(declaration.saisies || {}) !== stable(saisies || {}))

  // Document de travail PDF (lot 1c) : valeurs retenues affichées, à reporter sur Mon Activité Formation
  const exporterPdf = async () => {
    if (!calcul) return
    setBusy(true)
    try {
      // Libellés officiels des spécialités (F-4) : relus s'ils ne sont pas encore arrivés (relecture de #261)
      let specs = specialites
      if (!specs.length) {
        const { data, error } = await supabase.from('bpf_specialites').select('code, libelle')
        if (error || !data?.length) { toast.error(`Spécialités non chargées${error ? ` : ${error.message}` : ''}`); return }
        specs = data
        setSpecialites(data)
      }
      const libelle = (code) => specs.find((s) => s.code === code)?.libelle || ''
      const { buildBpfPDF } = await import('../pdf/bpfPDF')
      const { doc, filename } = await buildBpfPDF({ calcul, retenues, saisies, ecarts, declaration, nonEnregistre, libelleSpec: libelle })
      doc.save(filename)
    } catch (e) {
      toast.error(`PDF non généré : ${e.message}`)
    } finally {
      setBusy(false)
    }
  }

  // Réouverture d'un BPF déposé par erreur : seule la date de dépôt est retirée (la base refuse tout autre changement)
  const rouvrir = async () => {
    if (!declaration?.id) return
    if (!await confirmer('Rouvrir ce BPF ? Il redevient modifiable ; pensez à le noter de nouveau comme déposé une fois corrigé.')) return
    setBusy(true)
    const { data, error } = await supabase.from('bpf_declarations').update({ submitted_at: null, status: 'draft' }).eq('id', declaration.id).select().single()
    setBusy(false)
    if (error) { toast.error(error.message); return }
    setDeclaration(data)
    toast.success('BPF rouvert')
  }

  // Cadre B-2 : calcul (session à distance non annulée dans l'exercice), réponse modifiable
  const b2Calcul = !!calcul?.lignes?.['B-2']
  const b2 = typeof saisies['B-2'] === 'boolean' ? saisies['B-2'] : b2Calcul
  const changerB2 = (v) => setSaisies((s) => {
    const n = { ...s }
    if (v === b2Calcul) delete n['B-2']; else n['B-2'] = v
    return n
  })

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
              {Array.from({ length: 6 }, (_, i) => anneeDefaut + 1 - i).map((a) => <option key={a} value={a}>Exercice {a}</option>)}
            </select>
            <button type="button" className="btn btn-secondary" onClick={calculer} disabled={busy || depose}><Calculator className="w-4 h-4" />{calcul ? 'Recalculer' : 'Calculer'}</button>
            <button type="button" className="btn btn-primary" onClick={enregistrer} disabled={busy || !calcul || depose}><Save className="w-4 h-4" />Enregistrer</button>
            <button type="button" className="btn btn-secondary" onClick={exporterPdf} disabled={busy || !calcul}><FileDown className="w-4 h-4" />PDF</button>
          </div>
        )} />

      {depose && <Banner tone="success" title="BPF déposé">Noté comme déposé le {fmtDate(declaration.submitted_at)}. Il n&apos;est plus modifiable ici.
        <button type="button" className="btn btn-ghost btn-sm mt-2" onClick={rouvrir} disabled={busy}><Unlock className="w-4 h-4" />Rouvrir</button></Banner>}
      {societe === null && <Banner tone="warning" title="Choisissez une société">Le BPF se déclare société par société : sélectionnez-en une (pas la vue groupe).</Banner>}
      {societe && !calcul && <Banner tone="info" title="Aucun calcul pour cet exercice">Lancez le calcul : il lit vos factures et vos sessions de l&apos;exercice, réglé dans Réglages › Sociétés (mois de début).</Banner>}

      {calcul && (
        <>
          {(calcul.a_classer?.objectif?.length > 0 || calcul.a_classer?.specialite?.length > 0) && (
            <Banner tone="warning" title="Formations à classer avant le dépôt">
              {calcul.a_classer.objectif?.length > 0 && <p>Objectif manquant : {calcul.a_classer.objectif.join(', ')}.</p>}
              {calcul.a_classer.specialite?.length > 0 && <p>Spécialité manquante : {calcul.a_classer.specialite.join(', ')}.</p>}
              <p className="mt-1"><Link to="/formations" className="underline">Compléter les fiches formation</Link>, puis recalculer.</p>
            </Banner>
          )}
          {calcul.detail?.factures_a_verifier?.length > 0 && (
            <Banner tone="warning" title="Factures à vérifier">
              Facturées à l&apos;entreprise sans subrogation alors qu&apos;une prise en charge OPCO est prévue : rangées en C-1 (employeur). Vérifiez qui a payé : {calcul.detail.factures_a_verifier.join(', ')}. Si l&apos;OPCO a payé, saisissez le montant en C-2-h et retirez-le de C-1.
            </Banner>
          )}
          {calcul.detail?.heures_inconnues?.length > 0 && (
            <Banner tone="warning" title="Sous-traitance reçue sans durée">
              Stagiaires comptés en G sans heures (formation hors catalogue) : {calcul.detail.heures_inconnues.join(', ')}. Saisissez les heures du cadre G.
            </Banner>
          )}
          {calcul.detail?.heures_prevues > 0 && (
            <Banner tone="info">{calcul.detail.heures_prevues} participation(s) sans document émis : la durée prévue de la formation est comptée. Émettez les attestations pour compter les heures réellement suivies.</Banner>
          )}
          {ecarts.length > 0 && <Banner tone="warning" title="Contrôles de la notice">{ecarts.map((e) => <p key={e}>{e}</p>)}</Banner>}
          {ecarts.length === 0 && <Banner tone="success">Contrôles de la notice satisfaits (totaux F-1, F-3 et F-4 identiques).</Banner>}

          <section className="card">
            <h3 className="font-semibold mb-2">B-2. Formation à distance</h3>
            <label className="flex items-center gap-2 text-ui">
              <input type="checkbox" className="w-4 h-4" checked={b2} disabled={depose} onChange={(e) => changerB2(e.target.checked)} />
              Actions de formation à distance (e-learning, classes virtuelles) pendant l&apos;exercice
              {typeof saisies['B-2'] === 'boolean' && <span className="text-ui-sm text-[rgb(var(--c-warning))]">saisi</span>}
            </label>
            <p className="text-ui-sm text-gray-500 mt-1">Calcul : {b2Calcul ? 'oui' : 'non'}, d&apos;après les sessions à distance non annulées de l&apos;exercice.</p>
          </section>

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
