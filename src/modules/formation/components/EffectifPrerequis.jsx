import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { AlertTriangle, CheckCircle2, FileText, Upload, Receipt } from 'lucide-react'
import { supabase } from '../../../core/supabase'
import { etatEffectif, statutCertificat, finValiditeInterne, decouperGroupes } from '../lib/effectifPrerequis'
import { joursAvant } from './SeuilMaintien'

// Effectif imposé et certificat exigé à l'entrée (0479, CGV formation, fin de l'article 8, décision de H du 04/11).
// Tout vient de la fiche formation : effectif_strict, min et max, prerequis_certificat_mois. Rien ne s'affiche pour
// une formation sans ces réglages. L'outil n'envoie rien : il signale, propose et prépare la facture.

const fmt = (d) => (d ? new Date(`${String(d).slice(0, 10)}T12:00:00`).toLocaleDateString('fr-FR') : '')
const BADGES = {
  valide: { t: 'Valide', c: 'bg-green-50 text-green-800' },
  tolere: { t: 'Expiré, toléré', c: 'bg-amber-50 text-amber-800' },
  refuse: { t: 'Refusé : formation initiale', c: 'bg-red-50 text-red-800' },
  manquant: { t: 'Justificatif manquant', c: 'bg-gray-100 text-gray-700' },
}

export default function EffectifPrerequis({ session, peutModifier, peutFacturer }) {
  const navigate = useNavigate()
  const [course, setCourse] = useState(null)
  const [lignes, setLignes] = useState([])
  const [internes, setInternes] = useState({})
  const [busy, setBusy] = useState(null)
  const [demande, setDemande] = useState('')

  const charger = async () => {
    if (!session?.course_id) return
    const { data: co, error } = await supabase.from('courses')
      .select('id, min_participants, max_participants, effectif_strict, prerequis_certificat_mois').eq('id', session.course_id).maybeSingle()
    if (error || !co) return setCourse(null) // base pas encore à jour (0479) : rien n'est affiché
    setCourse(co)
    const { data: st } = await supabase.from('session_trainees')
      .select('id, trainee_id, absent, prerequis_valid_until, prerequis_file_path, trainees(first_name, last_name)')
      .eq('session_id', session.id)
    setLignes(st || [])
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
    const estInterne = !!interne && !l.prerequis_file_path && l.prerequis_valid_until === interne
    return { l, interne, ...statutCertificat({ validUntil: l.prerequis_valid_until, filePath: l.prerequis_file_path, interne: estInterne, debutFormation: session.start_date, toleranceMois: course.prerequis_certificat_mois }) }
  }) : []
  const aRegler = statuts.filter((s) => s.statut === 'manquant' || s.statut === 'refuse')

  const majLigne = async (id, champs) => {
    setBusy(id)
    const { data: u } = await supabase.auth.getUser()
    const { error } = await supabase.from('session_trainees')
      .update({ ...champs, prerequis_checked_at: new Date().toISOString(), prerequis_checked_by: u?.user?.id || null }).eq('id', id)
    setBusy(null)
    if (error) return toast.error('Enregistrement impossible : ' + error.message)
    charger()
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
          {proche && aRegler.length > 0 && (
            <p className="text-ui-sm text-amber-800 mt-1 flex items-center gap-1"><AlertTriangle className="w-4 h-4" />
              À J-{j} : {aRegler.length} participant{aRegler.length > 1 ? 's' : ''} sans justificatif valable. Demandez la copie à l'entreprise ; sinon, formation initiale.</p>
          )}
          {presents.length === 0 ? <p className="text-ui-sm text-gray-500 mt-1">Aucun participant inscrit.</p> : (
            <ul className="divide-y divide-gray-100 mt-2">
              {statuts.map(({ l, interne, statut, limite }) => (
                <li key={l.id} className="py-2 flex flex-wrap items-center gap-2 text-ui">
                  <span className="min-w-[10rem] text-gray-900">{l.trainees?.first_name} {(l.trainees?.last_name || '').toUpperCase()}</span>
                  <span className={`px-2 py-0.5 rounded text-ui-sm ${BADGES[statut].c}`}>{BADGES[statut].t}{statut === 'tolere' && limite ? ` (jusqu'au ${fmt(limite)})` : ''}</span>
                  {peutModifier ? (
                    <>
                      <label className="text-ui-sm text-gray-600 sr-only" htmlFor={`fin-${l.id}`}>Fin de validité</label>
                      <input id={`fin-${l.id}`} type="date" className="input w-40" value={l.prerequis_valid_until || ''} disabled={busy === l.id}
                        onChange={(e) => majLigne(l.id, { prerequis_valid_until: e.target.value || null })} title="Fin de validité du certificat" />
                      {l.prerequis_file_path
                        ? <button type="button" className="btn btn-ghost text-ui-sm" onClick={() => ouvrir(l.prerequis_file_path)}><FileText className="w-4 h-4" />Copie</button>
                        : (
                          <label className="btn btn-ghost text-ui-sm cursor-pointer"><Upload className="w-4 h-4" />Déposer la copie
                            <input type="file" accept="application/pdf,image/*" className="hidden" onChange={(e) => deposer(l, e.target.files?.[0])} />
                          </label>
                        )}
                      {interne && l.prerequis_valid_until !== interne && (
                        <button type="button" className="btn btn-ghost text-ui-sm" onClick={() => majLigne(l.id, { prerequis_valid_until: interne })}>
                          Certificat délivré ici : fin le {fmt(interne)}
                        </button>
                      )}
                    </>
                  ) : (l.prerequis_valid_until && <span className="text-ui-sm text-gray-600">fin de validité le {fmt(l.prerequis_valid_until)}</span>)}
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
