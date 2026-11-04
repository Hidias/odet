import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { AlertTriangle, CheckCircle2, FileText, Upload, Receipt } from 'lucide-react'
import { supabase } from '../../../core/supabase'
import { etatEffectif, statutDate, dateFinImpossible, finValiditeInterne, decouperGroupes } from '../lib/effectifPrerequis'
import { confirmer } from '../../../ui/Confirm'
import { joursAvant } from './SeuilMaintien'

// Effectif imposé et certificat exigé à l'entrée (0479, CGV formation, fin de l'article 8, décision de H du 04/11).
// Tout vient de la fiche formation : effectif_strict, min et max, prerequis_certificat_mois. Rien ne s'affiche pour
// une formation sans ces réglages. L'outil n'envoie rien : il signale, propose et prépare la facture.

const fmt = (d) => (d ? new Date(`${String(d).slice(0, 10)}T12:00:00`).toLocaleDateString('fr-FR') : '')
// Deux statuts séparés (04/11) : la date (alerte dès la saisie) et la preuve (copie ou certificat délivré ici)
const BADGES = {
  valide: { t: 'Valide', c: 'bg-green-50 text-green-800' },
  tolere: { t: 'Expiré, toléré', c: 'bg-amber-50 text-amber-800' },
  refuse: { t: 'Refusé : formation initiale', c: 'bg-red-50 text-red-800' },
  sans_date: { t: 'Date à saisir', c: 'bg-gray-100 text-gray-700' },
}
const fmtHeure = (d) => (d ? new Date(d).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).replace(' ', ' à ') : '')

export default function EffectifPrerequis({ session, peutModifier, peutFacturer }) {
  const navigate = useNavigate()
  const [course, setCourse] = useState(null)
  const [lignes, setLignes] = useState([])
  const [internes, setInternes] = useState({})
  const [busy, setBusy] = useState(null)
  const [demande, setDemande] = useState('')
  const [brouillons, setBrouillons] = useState({})
  const [auteurs, setAuteurs] = useState({})

  const charger = async () => {
    if (!session?.course_id) return
    const { data: co, error } = await supabase.from('courses')
      .select('id, min_participants, max_participants, effectif_strict, prerequis_certificat_mois').eq('id', session.course_id).maybeSingle()
    if (error || !co) return setCourse(null) // base pas encore à jour (0479) : rien n'est affiché
    setCourse(co)
    const { data: st } = await supabase.from('session_trainees')
      .select('id, trainee_id, absent, prerequis_valid_until, prerequis_file_path, prerequis_checked_at, prerequis_checked_by, trainees(first_name, last_name)')
      .eq('session_id', session.id)
    setLignes(st || [])
    setBrouillons({})
    // Qui a modifié en dernier (trace visible sous la ligne)
    const ids = [...new Set((st || []).map((x) => x.prerequis_checked_by).filter(Boolean))]
    if (ids.length) {
      const { data: pr } = await supabase.from('profiles').select('id, first_name, last_name, display_name').in('id', ids)
      setAuteurs(Object.fromEntries((pr || []).map((x) => [x.id, [x.first_name, x.last_name].filter(Boolean).join(' ') || x.display_name || ''])))
    }
    if (co.prerequis_certificat_mois != null && st?.length) {
      // Certificats délivrés par l'organisme lui-même : repris sans demander de copie (pas de double saisie)
      const { data: certs } = await supabase.from('sst_certifications')
        .select('trainee_id, date_certification').in('trainee_id', st.map((x) => x.trainee_id))
        .eq('candidat_certifie', true).not('date_certification', 'is', null)
        .order('date_certification', { ascending: false })
      const m = {}
      ;(certs || []).forEach((c) => { if (!m[c.trainee_id]) m[c.trainee_id] = finValiditeInterne(c.date_certification) })
      setInternes(m)
    }
  }
  useEffect(() => { charger() }, [session?.id, session?.course_id, session?.session_trainees?.length]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!course || ['cancelled', 'annulee'].includes(session?.status || '')) {
    return course && ['cancelled', 'annulee'].includes(session?.status || '') && course.effectif_strict && peutFacturer
      ? <BlocDedommagement session={session} navigate={navigate} /> : null
  }
  const strict = !!course.effectif_strict
  const exige = course.prerequis_certificat_mois != null
  if (!strict && !exige) return null

  const presents = lignes.filter((l) => !l.absent)
  const eff = strict ? etatEffectif(presents.length, course) : null
  const j = session?.start_date ? joursAvant(session.start_date) : null
  const proche = j != null && j >= 0 && j <= 7

  const statuts = exige ? presents.map((l) => {
    const interne = internes[l.trainee_id]
    // Certificat délivré ici : repris d'office tant qu'aucune autre date ni copie n'est saisie (pas de double saisie)
    const estInterne = !!interne && !l.prerequis_file_path && (!l.prerequis_valid_until || l.prerequis_valid_until === interne)
    const fin = estInterne ? interne : l.prerequis_valid_until
    const preuve = estInterne || !!l.prerequis_file_path
    return { l, interne, estInterne, preuve, ...statutDate({ validUntil: fin, debutFormation: session.start_date, toleranceMois: course.prerequis_certificat_mois }) }
  }) : []
  const refuses = statuts.filter((s) => s.statut === 'refuse')
  const incomplets = statuts.filter((s) => s.statut === 'sans_date' || !s.preuve)

  const majLigne = async (id, champs) => {
    setBusy(id)
    const { data: u } = await supabase.auth.getUser()
    const { error } = await supabase.from('session_trainees')
      .update({ ...champs, prerequis_checked_at: new Date().toISOString(), prerequis_checked_by: u?.user?.id || null }).eq('id', id)
    setBusy(null)
    if (error) { toast.error('Enregistrement impossible : ' + error.message); return false }
    toast.success('Enregistré')
    charger()
    return true
  }
  // Date saisie : contrôlée, puis enregistrée à la sortie du champ ; remplacer une date déjà saisie se confirme
  const validerDate = async (l, valeur) => {
    const nouvelle = valeur || null
    if (nouvelle === (l.prerequis_valid_until || null)) return
    if (nouvelle) {
      const erreur = dateFinImpossible(nouvelle, new Date().toISOString())
      if (erreur) { toast.error(erreur); setBrouillons((b) => { const c = { ...b }; delete c[l.id]; return c }); return }
    }
    if (l.prerequis_valid_until) {
      const ok = await confirmer(nouvelle
        ? `Remplacer la fin de validité du ${fmt(l.prerequis_valid_until)} par le ${fmt(nouvelle)} ?`
        : `Effacer la fin de validité du ${fmt(l.prerequis_valid_until)} ?`)
      if (!ok) { setBrouillons((b) => { const c = { ...b }; delete c[l.id]; return c }); return }
    }
    majLigne(l.id, { prerequis_valid_until: nouvelle })
  }
  const deposer = async (l, file) => {
    if (!file) return
    if (file.size > 10 * 1024 * 1024) return toast.error('Fichier trop lourd (10 Mo au plus)')
    setBusy(l.id)
    const ext = (file.name.split('.').pop() || 'pdf').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 5) || 'pdf'
    const chemin = `prerequis/${session.id}/${l.trainee_id}-${Date.now()}.${ext}`
    const { error } = await supabase.storage.from('documents').upload(chemin, file, { upsert: false, contentType: file.type || undefined })
    setBusy(null)
    if (error) return toast.error('Dépôt impossible : ' + error.message)
    majLigne(l.id, { prerequis_file_path: chemin })
  }
  const ouvrir = async (chemin) => {
    const onglet = window.open('', '_blank')
    const { data, error } = await supabase.storage.from('documents').createSignedUrl(chemin, 300)
    if (error || !data?.signedUrl) { if (onglet) onglet.close(); return toast.error('Copie indisponible') }
    if (onglet) onglet.location.href = data.signedUrl; else window.location.href = data.signedUrl
  }

  const nDemande = Number(demande) || 0
  const groupes = strict && nDemande > (course.max_participants || 0) ? decouperGroupes(nDemande, course.min_participants || 1, course.max_participants) : null

  return (
    <div className="card p-4 mb-4 space-y-3">
      {strict && eff && (
        <div className="flex items-start gap-3">
          {eff.niveau === 'ok' ? <CheckCircle2 className="w-5 h-5 text-green-600 shrink-0 mt-0.5" /> : <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />}
          <div className="text-ui">
            <p className="font-medium text-gray-900">Effectif imposé : {eff.min} à {eff.max} participants par formateur, {eff.n} inscrit{eff.n > 1 ? 's' : ''}</p>
            {eff.niveau === 'insuffisant' && <p className="text-gray-600">Il manque {eff.manque} participant{eff.manque > 1 ? 's' : ''} : sous le minimum, la formation ne peut pas avoir lieu (CGV, article 8).</p>}
            {eff.niveau === 'depasse' && <p className="text-gray-600">Au-delà du maximum : répartissez en {eff.groupes?.length || 2} sessions ({(eff.groupes || []).join(' + ')}).</p>}
            {eff.niveau === 'ok' && eff.n >= eff.max && <p className="text-gray-600">Session complète : tout participant de plus va sur une seconde session.</p>}
            {peutModifier && (
              <div className="flex flex-wrap items-center gap-2 mt-2">
                <label className="text-ui-sm text-gray-600" htmlFor="effectif-demande">Participants demandés par le client</label>
                <input id="effectif-demande" type="number" min="1" max="200" className="input w-24" value={demande} onChange={(e) => setDemande(e.target.value)} />
                {groupes && <span className="text-ui-sm text-gray-700">{groupes.length} sessions : {groupes.join(' + ')}</span>}
                {nDemande > 0 && !groupes && nDemande >= (course.min_participants || 1) && <span className="text-ui-sm text-gray-700">Une seule session suffit</span>}
                {nDemande > 0 && nDemande < (course.min_participants || 1) && <span className="text-ui-sm text-amber-700">Sous le minimum de {course.min_participants}</span>}
              </div>
            )}
          </div>
        </div>
      )}

      {exige && (
        <div>
          <p className="font-medium text-gray-900 text-ui">Certificat exigé à l'entrée, accepté jusqu'à {course.prerequis_certificat_mois} mois après sa fin de validité</p>
          {refuses.length > 0 && (
            <p className="text-ui-sm text-red-800 bg-red-50 rounded px-2 py-1 mt-1 flex items-center gap-1"><AlertTriangle className="w-4 h-4 shrink-0" />
              {refuses.length} participant{refuses.length > 1 ? 's' : ''} refusé{refuses.length > 1 ? 's' : ''} : certificat expiré depuis plus de {course.prerequis_certificat_mois} mois. Proposez la formation initiale au client.</p>
          )}
          {proche && incomplets.length > 0 && (
            <p className="text-ui-sm text-amber-800 mt-1 flex items-center gap-1"><AlertTriangle className="w-4 h-4 shrink-0" />
              À J-{j} : {incomplets.length} participant{incomplets.length > 1 ? 's' : ''} sans date ou sans copie. Demandez-les à l'entreprise.</p>
          )}
          {presents.length === 0 ? <p className="text-ui-sm text-gray-500 mt-1">Aucun participant inscrit.</p> : (
            <ul className="divide-y divide-gray-100 mt-2">
              {statuts.map(({ l, interne, estInterne, preuve, statut, limite }) => (
                <li key={l.id} className="py-2 flex flex-wrap items-center gap-2 text-ui">
                  <span className="min-w-[10rem] text-gray-900">{l.trainees?.first_name} {(l.trainees?.last_name || '').toUpperCase()}</span>
                  <span className={`px-2 py-0.5 rounded text-ui-sm ${BADGES[statut].c}`}>{BADGES[statut].t}{statut === 'tolere' && limite ? ` (jusqu'au ${fmt(limite)})` : ''}</span>
                  <span className={`px-2 py-0.5 rounded text-ui-sm ${preuve ? 'bg-green-50 text-green-800' : 'bg-gray-100 text-gray-700'}`}>{estInterne ? 'Délivré ici' : preuve ? 'Copie reçue' : 'Copie à demander'}</span>
                  {peutModifier ? (
                    <>
                      <label className="text-ui-sm text-gray-600 sr-only" htmlFor={`fin-${l.id}`}>Fin de validité</label>
                      <input id={`fin-${l.id}`} type="date" className="input w-40" disabled={busy === l.id} title="Fin de validité du certificat"
                        value={brouillons[l.id] ?? (l.prerequis_valid_until || (estInterne ? interne : ''))}
                        onChange={(e) => setBrouillons((b) => ({ ...b, [l.id]: e.target.value }))}
                        onBlur={(e) => { if (brouillons[l.id] !== undefined) validerDate(l, e.target.value) }} />
                      {estInterne
                        ? <span className="text-ui-sm text-gray-600">Certificat délivré ici, fin le {fmt(interne)}</span>
                        : l.prerequis_file_path
                        ? <button type="button" className="btn btn-ghost text-ui-sm" onClick={() => ouvrir(l.prerequis_file_path)}><FileText className="w-4 h-4" />Copie</button>
                        : (
                          <label className="btn btn-ghost text-ui-sm cursor-pointer"><Upload className="w-4 h-4" />Déposer la copie
                            <input type="file" accept="application/pdf,image/*" className="hidden" onChange={(e) => deposer(l, e.target.files?.[0])} />
                          </label>
                        )}
                      {interne && !estInterne && (
                        <button type="button" className="btn btn-ghost text-ui-sm" onClick={() => majLigne(l.id, { prerequis_valid_until: interne })}>
                          Certificat délivré ici : fin le {fmt(interne)}
                        </button>
                      )}
                    </>
                  ) : (l.prerequis_valid_until && <span className="text-ui-sm text-gray-600">fin de validité le {fmt(l.prerequis_valid_until)}</span>)}
                  {l.prerequis_checked_at && (
                    <span className="basis-full text-ui-sm text-gray-500">Modifié le {fmtHeure(l.prerequis_checked_at)}{auteurs[l.prerequis_checked_by] ? ` par ${auteurs[l.prerequis_checked_by]}` : l.prerequis_checked_by ? '' : ' par l\'entreprise'}</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}

// Session annulée d'une formation à effectif imposé : facture de dédommagement préparée (brouillon, rien n'est envoyé)
function BlocDedommagement({ session, navigate }) {
  const intra = session.session_type !== 'inter'
  const aller = (cas) => navigate(`/factures?from_session=${session.id}&dedommagement=${cas}`)
  return (
    <div className="card p-4 mb-4 text-ui">
      <p className="font-medium text-gray-900 flex items-center gap-2"><Receipt className="w-4 h-4" />Session annulée : dédommagement (CGV, article 8)</p>
      <p className="text-gray-600 mt-1">La facture est préparée en brouillon, hors formation professionnelle et hors financeur. Montant modifiable, geste commercial possible.</p>
      <div className="flex flex-wrap gap-2 mt-2">
        {intra ? (
          <>
            <button type="button" className="btn btn-secondary" onClick={() => aller('intra_annulation')}>Annulation : 100 % du prix</button>
            <button type="button" className="btn btn-secondary" onClick={() => aller('intra_report')}>Report choisi : frais de 50 %</button>
          </>
        ) : (
          <button type="button" className="btn btn-secondary" onClick={() => aller('inter_places')}>Client défaillant : places non honorées</button>
        )}
      </div>
    </div>
  )
}
