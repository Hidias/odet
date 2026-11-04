// Espace entreprise (0486) : analyse du besoin de chaque formation dans vos locaux. L'entreprise décrit son besoin,
// l'organisme le relit, écrit son analyse et valide. Handicap : oui ou non et une personne à contacter, sans détail.
import { useEffect, useState } from 'react'
import { CheckCircle, ClipboardList } from 'lucide-react'
import toast from 'react-hot-toast'
import { supabase } from '../../../core/supabase'
import { MOTIFS, PROFILS, NIVEAUX, ETATS_BESOIN, LONGUEURS, depuisReponses, verifierReponses } from '../../formation/lib/besoinClient'

const dateFr = (d) => (d ? new Date(`${String(d).slice(0, 10)}T12:00:00`).toLocaleDateString('fr-FR') : '')
const periode = (a, b) => (!b || String(a).slice(0, 10) === String(b).slice(0, 10) ? `le ${dateFr(a)}` : `du ${dateFr(a)} au ${dateFr(b)}`)

function OuiNon({ name, value, onChange }) {
  return (
    <div className="flex gap-4 mt-1">
      {[[true, 'Oui'], [false, 'Non']].map(([v, l]) => (
        <label key={l} className="flex items-center gap-2 text-sm"><input type="radio" name={name} checked={value === v} onChange={() => onChange(v)} />{l}</label>
      ))}
    </div>
  )
}

// Questions du besoin, partagées entre l'analyse d'une session (0486) et la demande « Formation intra » (0487)
export function ChampsBesoin({ r, setR, id }) {
  const maj = (k, v) => setR((x) => ({ ...x, [k]: v }))
  const basculer = (k, v) => setR((x) => ({ ...x, [k]: x[k].includes(v) ? x[k].filter((y) => y !== v) : [...x[k], v] }))
  const champ = 'w-full px-3 py-2 border border-gray-300 rounded-ui-sm text-sm'
  return (
    <div className="space-y-4 text-sm">
      <fieldset>
        <legend className="font-medium text-gray-900">Pourquoi cette formation ? *</legend>
        <div className="mt-1 space-y-1">
          {MOTIFS.map((m) => (
            <label key={m.value} className="flex items-center gap-2"><input type="checkbox" checked={r.context_reasons.includes(m.value)} onChange={() => basculer('context_reasons', m.value)} />{m.label}</label>
          ))}
        </div>
        {r.context_reasons.includes('autre') && (
          <input className={`${champ} mt-2`} maxLength={LONGUEURS.context_other} value={r.context_other} onChange={(e) => maj('context_other', e.target.value)} placeholder="Précisez" aria-label="Autre motif" />
        )}
      </fieldset>
      <label className="block">
        <span className="font-medium text-gray-900">Ce que vous attendez de la formation *</span>
        <textarea className={`${champ} mt-1`} rows={3} maxLength={LONGUEURS.objectives_description} value={r.objectives_description} onChange={(e) => maj('objectives_description', e.target.value)}
          placeholder="Ce que vos salariés devront savoir faire à la fin" />
      </label>
      <label className="block">
        <span className="font-medium text-gray-900">Enjeux pour votre entreprise</span>
        <textarea className={`${champ} mt-1`} rows={2} maxLength={LONGUEURS.context_stakes} value={r.context_stakes} onChange={(e) => maj('context_stakes', e.target.value)} />
      </label>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label className="block">
          <span className="font-medium text-gray-900">Nombre de participants *</span>
          <input className={`${champ} mt-1`} inputMode="numeric" maxLength={3} value={r.participants_count} onChange={(e) => maj('participants_count', e.target.value.replace(/\D/g, ''))} />
        </label>
        <label className="block">
          <span className="font-medium text-gray-900">Niveau du groupe</span>
          <select className={`${champ} mt-1`} value={r.level} onChange={(e) => maj('level', e.target.value)}>
            <option value="">Je ne sais pas</option>
            {NIVEAUX.map((n) => <option key={n.value} value={n.value}>{n.label}</option>)}
          </select>
        </label>
      </div>
      <fieldset>
        <legend className="font-medium text-gray-900">Métiers des participants</legend>
        <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
          {PROFILS.map((p) => (
            <label key={p.value} className="flex items-center gap-2"><input type="checkbox" checked={r.participants_profiles.includes(p.value)} onChange={() => basculer('participants_profiles', p.value)} />{p.label}</label>
          ))}
        </div>
        <label className="flex items-center gap-2 mt-2"><input type="checkbox" checked={r.particularities_non_french} onChange={(e) => maj('particularities_non_french', e.target.checked)} />Des participants ne parlent pas bien le français</label>
      </fieldset>
      <fieldset className="rounded-ui-sm bg-gray-50 p-3">
        <legend className="font-medium text-gray-900">Un participant a-t-il besoin d'une adaptation (handicap, santé) ? *</legend>
        <OuiNon name={`psh-${id}`} value={r.psh_adaptation} onChange={(v) => maj('psh_adaptation', v)} />
        {r.psh_adaptation && (
          <label className="block mt-2">
            <span className="text-gray-700">Personne à contacter (nom, téléphone ou e-mail) *</span>
            <input className={`${champ} mt-1`} maxLength={LONGUEURS.psh_contact} value={r.psh_contact} onChange={(e) => maj('psh_contact', e.target.value)} />
          </label>
        )}
        <p className="text-xs text-gray-500 mt-2">N'écrivez aucun détail de santé ici : notre référent handicap prendra contact pour prévoir l'adaptation.</p>
      </fieldset>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <span className="font-medium text-gray-900">Matériel de l'entreprise utilisable</span>
          <OuiNon name={`mat-${id}`} value={r.company_equipment} onChange={(v) => maj('company_equipment', v)} />
          {r.company_equipment && (
            <input className={`${champ} mt-2`} maxLength={LONGUEURS.company_equipment_details} value={r.company_equipment_details} onChange={(e) => maj('company_equipment_details', e.target.value)} placeholder="Lequel ?" aria-label="Matériel disponible" />
          )}
        </div>
        <div>
          <span className="font-medium text-gray-900">Équipements de protection fournis aux participants</span>
          <OuiNon name={`epi-${id}`} value={r.ppe_provided} onChange={(v) => maj('ppe_provided', v)} />
        </div>
      </div>
      <label className="block">
        <span className="font-medium text-gray-900">Horaires souhaités</span>
        <input className={`${champ} mt-1`} maxLength={LONGUEURS.preferred_schedule} value={r.preferred_schedule} onChange={(e) => maj('preferred_schedule', e.target.value)} />
      </label>
      <label className="block">
        <span className="font-medium text-gray-900">Autres contraintes (organisation, accès, sécurité du site)</span>
        <textarea className={`${champ} mt-1`} rows={2} maxLength={LONGUEURS.other_constraints} value={r.other_constraints} onChange={(e) => maj('other_constraints', e.target.value)} />
      </label>
    </div>
  )
}

function Formulaire({ besoin, onFermer, onEnvoye }) {
  const [r, setR] = useState(() => depuisReponses(besoin.reponses))
  const [busy, setBusy] = useState(false)
  const [erreur, setErreur] = useState('')
  const envoyer = async () => {
    const msg = verifierReponses(r)
    if (msg) { setErreur(msg); return }
    setBusy(true); setErreur('')
    const { error } = await supabase.rpc('ent_besoin_enregistrer', { p_session: besoin.session_id, p_reponses: r })
    setBusy(false)
    if (error) { setErreur(error.message || 'Envoi impossible, réessayez'); return }
    toast.success('Analyse envoyée à votre organisme')
    onEnvoye()
  }
  return (
    <div className="mt-3 space-y-4 text-sm">
      <ChampsBesoin r={r} setR={setR} id={besoin.session_id} />
      {erreur && <p role="alert" className="text-[rgb(var(--c-danger))]">{erreur}</p>}
      <div className="flex flex-wrap gap-2 justify-end">
        <button type="button" className="btn btn-secondary" onClick={onFermer} disabled={busy}>Annuler</button>
        <button type="button" className="btn btn-primary" onClick={envoyer} disabled={busy}>{busy ? 'Envoi…' : 'Envoyer à mon organisme'}</button>
      </div>
    </div>
  )
}

export default function AnalyseBesoin({ Carte, onChange }) {
  const [liste, setListe] = useState(null)
  const [ouvert, setOuvert] = useState(null)
  const charger = () => supabase.rpc('ent_besoins').then(({ data, error }) => setListe(error || !Array.isArray(data) ? [] : data))
  useEffect(() => { charger() }, [])
  if (!liste || liste.length === 0) return null
  return (
    <section>
      <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">Analyse du besoin</h2>
      <div className="space-y-2">
        {liste.map((b) => (
          <Carte key={b.session_id}>
            <div className="flex items-start gap-2">
              <ClipboardList className="w-4 h-4 mt-0.5 text-gray-400 shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="font-medium text-gray-900">{b.formation || 'Formation'}</div>
                <div className="text-sm text-gray-500">{periode(b.start_date, b.end_date)}</div>
                <div className={`text-sm mt-1 ${b.etat === 'validee' ? 'text-[rgb(var(--c-success))]' : b.etat === 'a_completer' ? 'text-[rgb(var(--c-warning))]' : 'text-gray-600'}`}>
                  {b.etat === 'validee' && <CheckCircle className="w-4 h-4 inline mr-1" />}
                  {ETATS_BESOIN[b.etat] || ''}{b.etat === 'a_valider' && b.envoyee_le ? ` (envoyée le ${dateFr(b.envoyee_le)})` : ''}
                </div>
              </div>
            </div>
            {ouvert === b.session_id ? (
              <Formulaire besoin={b} onFermer={() => setOuvert(null)} onEnvoye={() => { setOuvert(null); charger(); onChange?.() }} />
            ) : b.modifiable && (
              <button type="button" className={`btn btn-sm mt-2 ${b.etat === 'a_completer' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setOuvert(b.session_id)}>
                {b.etat === 'a_completer' ? 'Remplir' : 'Modifier'}
              </button>
            )}
          </Carte>
        ))}
      </div>
    </section>
  )
}
