// Évaluations à froid (0482, option C validée par H le 04/11) : page unique des non-répondants.
// La nuit prépare les premiers envois et les relances dus ; ici on relit, on coche, on valide en un clic.
// Rien ne part seul : l'interrupteur « Questionnaires à froid » de la Console reste le verrou général.
import { useEffect, useMemo, useState } from 'react'
import { Clock, Eye, Loader2, Mail, RefreshCw, Send, Settings2, XCircle } from 'lucide-react'
import toast from 'react-hot-toast'
import { supabase } from '../../../core/supabase'
import { callApi } from '../../../core/api'
import { useDroits } from '../../../core/rights/useDroit'
import { libelleEnvoi, filtrerEnvois, grouperParSession } from '../lib/froid'
import ReglagesFroid from '../components/ReglagesFroid'

const dateFr = (d) => (d ? new Date(`${String(d).slice(0, 10)}T12:00:00`).toLocaleDateString('fr-FR') : '')
const STATUTS = { prepare: 'À envoyer', en_cours: 'En cours', envoye: 'Envoyé', ignore: 'Écarté', erreur: 'En erreur' }

export default function EvaluationsFroid() {
  const d = useDroits({
    gerer: 'formation.suivi.gerer',
    envoyer: 'formation.convocations.envoyer',
    reglages: ['parametres.organisme.modifier', 'plateforme.administrer'],
  })
  const [donnees, setDonnees] = useState(null)
  const [vue, setVue] = useState('prepare')
  const [anciennete, setAnciennete] = useState('tout')
  const [coches, setCoches] = useState(new Set())
  const [apercu, setApercu] = useState(null)
  const [enCours, setEnCours] = useState(false)
  const [reglages, setReglages] = useState(false)

  const charger = async () => {
    const { data, error } = await supabase.rpc('froid_suivi')
    if (error) { toast.error(error.message); setDonnees({ envois: [], reglages: [], anciennes: [] }); return }
    setDonnees(data || { envois: [], reglages: [], anciennes: [] })
    setCoches(new Set())
  }
  useEffect(() => { charger() }, [])

  const liste = useMemo(() => filtrerEnvois(donnees?.envois || [], { vue, anciennete }), [donnees, vue, anciennete])
  const groupes = useMemo(() => grouperParSession(liste), [liste])
  const aEnvoyer = liste.filter((e) => e.statut === 'prepare')
  const basculer = (id) => setCoches((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  const toutCocher = () => setCoches(new Set(aEnvoyer.map((e) => e.id)))
  const ids = [...coches]

  const preparer = async () => {
    setEnCours(true)
    const { data, error } = await supabase.rpc('froid_preparer_maintenant')
    setEnCours(false)
    if (error) return toast.error(error.message)
    toast.success(`${data?.premiers_envois || 0} premier(s) envoi(s) et ${data?.relances || 0} relance(s) préparés`)
    charger()
  }
  const voirApercu = async () => {
    try { setApercu(await callApi('/api/evaluations-froid', { ids, apercu: true })) } catch (e) { toast.error(e.message) }
  }
  const testerSurMoi = async () => {
    try { const r = await callApi('/api/evaluations-froid', { ids: ids.slice(0, 1), test: true }); toast.success(`Exemple envoyé à ${r.test}`) } catch (e) { toast.error(e.message) }
  }
  const envoyer = async () => {
    setEnCours(true)
    try {
      const r = await callApi('/api/evaluations-froid', { ids })
      const refus = (r.refus || []).length
      toast.success(`${r.envoyes} mail(s) envoyé(s)${r.erreurs ? `, ${r.erreurs} en erreur` : ''}${refus ? `, ${refus} non envoyé(s) (voir le motif)` : ''}`)
      if (refus) toast((r.refus || []).slice(0, 3).map((x) => x.raison).join(' ; '))
    } catch (e) { toast.error(e.message) }
    setEnCours(false)
    setApercu(null)
    charger()
  }
  const ecarter = async () => {
    const { data, error } = await supabase.rpc('froid_ecarter', { p_ids: ids, p_motif: 'Écarté à la main' })
    if (error) return toast.error(error.message)
    toast.success(`${data} envoi(s) écarté(s)`)
    charger()
  }
  const remettre = async () => {
    const { data, error } = await supabase.rpc('froid_remettre', { p_ids: ids })
    if (error) return toast.error(error.message)
    toast.success(`${data} envoi(s) remis à envoyer`)
    charger()
  }
  const inclure = async (s, v) => {
    const { error } = await supabase.rpc('froid_inclure_session', { p_session: s.session_id, p_inclure: v })
    if (error) return toast.error(error.message)
    toast.success(v ? 'Session incluse : appuyez sur « Préparer maintenant »' : 'Session de nouveau exclue')
    charger()
  }

  if (!donnees) return <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold flex items-center gap-2"><Clock className="w-5 h-5" />Évaluations à froid</h1>
          <p className="text-ui text-gray-500 mt-1">Préparées chaque nuit, envoyées seulement après votre validation. Un mail par personne, aucun autre destinataire visible.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {d.gerer && <button type="button" className="btn btn-secondary btn-sm flex items-center gap-1" onClick={preparer} disabled={enCours}><RefreshCw className="w-4 h-4" />Préparer maintenant</button>}
          {d.reglages && <button type="button" className="btn btn-secondary btn-sm flex items-center gap-1" onClick={() => setReglages((v) => !v)}><Settings2 className="w-4 h-4" />Réglages</button>}
        </div>
      </div>

      {reglages && <ReglagesFroid reglages={donnees.reglages} onEnregistre={charger} />}

      <div className="flex flex-wrap items-center gap-2">
        {[['prepare', 'À envoyer'], ['envoye', 'Envoyés'], ['ignore', 'Écartés'], ['erreur', 'En erreur'], ['tous', 'Tous']].map(([k, l]) => (
          <button key={k} type="button" onClick={() => { setVue(k); setCoches(new Set()) }} className={`btn btn-sm ${vue === k ? 'btn-primary' : 'btn-secondary'}`}>{l}</button>
        ))}
        <select className="input text-ui w-auto" value={anciennete} onChange={(e) => setAnciennete(e.target.value)} aria-label="Ancienneté de la session">
          <option value="tout">Toutes les sessions</option>
          <option value="90">Terminées depuis moins de 3 mois</option>
          <option value="180">Terminées depuis 3 à 6 mois</option>
          <option value="365">Terminées depuis 6 mois à 1 an</option>
          <option value="plus">Terminées depuis plus d'un an</option>
        </select>
      </div>

      {vue === 'prepare' && aEnvoyer.length > 0 && d.envoyer && (
        <div className="card flex flex-wrap items-center gap-2">
          <button type="button" className="btn btn-secondary btn-sm" onClick={toutCocher}>Tout cocher ({aEnvoyer.length})</button>
          <span className="text-ui-sm text-gray-500">{ids.length} sélectionné(s)</span>
          <button type="button" className="btn btn-secondary btn-sm flex items-center gap-1" disabled={!ids.length} onClick={voirApercu}><Eye className="w-4 h-4" />Aperçu</button>
          <button type="button" className="btn btn-secondary btn-sm flex items-center gap-1" disabled={!ids.length} onClick={testerSurMoi}><Mail className="w-4 h-4" />M'envoyer un exemple</button>
          {d.gerer && <button type="button" className="btn btn-secondary btn-sm flex items-center gap-1" disabled={!ids.length} onClick={ecarter}><XCircle className="w-4 h-4" />Écarter</button>}
          <button type="button" className="btn btn-primary btn-sm flex items-center gap-1 ml-auto" disabled={!ids.length || enCours} onClick={envoyer}>
            {enCours ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}Envoyer la sélection
          </button>
        </div>
      )}
      {vue === 'erreur' && liste.length > 0 && d.envoyer && (
        <div className="card flex flex-wrap items-center gap-2">
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => setCoches(new Set(liste.map((e) => e.id)))}>Tout cocher</button>
          <button type="button" className="btn btn-secondary btn-sm" disabled={!ids.length} onClick={remettre}>Remettre à envoyer</button>
        </div>
      )}

      {apercu && (
        <div className="card space-y-3">
          <div className="flex items-center justify-between"><h2 className="font-semibold">Aperçu ({apercu.textes.length} mail{apercu.textes.length > 1 ? 's' : ''})</h2><button type="button" className="btn btn-secondary btn-sm" onClick={() => setApercu(null)}>Fermer</button></div>
          {apercu.textes.slice(0, 5).map((t) => (
            <div key={t.ids.join()} className="border rounded-ui-sm p-3 text-ui">
              <div className="text-ui-sm text-gray-500">À : {t.destinataire}</div>
              <div className="font-medium mb-2">{t.sujet}</div>
              <pre className="whitespace-pre-wrap font-sans text-gray-700">{t.corps}</pre>
            </div>
          ))}
          {apercu.textes.length > 5 && <p className="text-ui-sm text-gray-500">et {apercu.textes.length - 5} autre(s), sur le même modèle.</p>}
        </div>
      )}

      {groupes.length === 0 ? (
        <div className="card text-center text-gray-500 py-10">{vue === 'prepare' ? 'Rien à envoyer pour le moment. La préparation passe chaque nuit.' : 'Aucune ligne.'}</div>
      ) : groupes.map((g) => (
        <div key={g.session_id} className="card">
          <div className="flex flex-wrap items-baseline justify-between gap-2 mb-2">
            <div className="font-medium">{g.formation || 'Formation'} <span className="text-ui-sm text-gray-500">· {g.session_ref} · terminée le {dateFr(g.fin)}</span></div>
            <a href={`#/sessions/${g.session_id}`} className="text-ui-sm text-primary-700">Ouvrir la session</a>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-ui">
              <thead><tr className="border-b text-left text-gray-500"><th className="py-1 w-8"></th><th className="py-1">Personne</th><th className="py-1">Entreprise</th><th className="py-1">Envoi</th><th className="py-1">Destinataire</th><th className="py-1">État</th></tr></thead>
              <tbody>
                {g.lignes.map((e) => (
                  <tr key={e.id} className="border-b last:border-0">
                    <td className="py-2">{(e.statut === 'prepare' || e.statut === 'erreur') && d.envoyer && <input type="checkbox" className="w-4 h-4" checked={coches.has(e.id)} onChange={() => basculer(e.id)} aria-label={`Choisir ${e.destinataire_nom || ''}`} />}</td>
                    <td className="py-2">{e.cible === 'employeur' ? 'Employeur' : e.destinataire_nom || (e.cible === 'contact' ? 'Stagiaire sans adresse' : '')}</td>
                    <td className="py-2">{e.entreprise || ''}</td>
                    <td className="py-2">{libelleEnvoi(e)}</td>
                    <td className="py-2 break-all">{e.destinataire || <span className="text-gray-400">aucune</span>}</td>
                    <td className="py-2">{STATUTS[e.statut] || e.statut}{e.envoye_le ? ` le ${dateFr(e.envoye_le)}` : ''}{e.motif ? <div className="text-ui-sm text-gray-500">{e.motif}</div> : null}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}

      {(donnees.anciennes || []).length > 0 && (
        <div className="card">
          <h2 className="font-semibold mb-1">Sessions de plus d'un an</h2>
          <p className="text-ui-sm text-gray-500 mb-2">Exclues par défaut. Incluez-les une par une si vous le souhaitez.</p>
          <div className="space-y-1">
            {donnees.anciennes.map((s) => (
              <label key={s.session_id} className="flex items-center gap-2 text-ui">
                <input type="checkbox" className="w-4 h-4" checked={!!s.inclure} disabled={!d.gerer} onChange={(e) => inclure(s, e.target.checked)} />
                {s.formation || 'Formation'} · {s.session_ref} · terminée le {dateFr(s.fin)}
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
