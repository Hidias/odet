// Avis après formation (0396) : habilitation électrique (NF C18-510) ou conduite d'engins (R4323-56).
// L'organisme donne à l'employeur un avis par stagiaire : symboles ou catégories proposés, résultat, observations.
// L'employeur délivre ensuite le titre ou l'autorisation (l'outil le fait pour ses propres salariés dans Personnel).

import { useCallback, useEffect, useState } from 'react'
import { leMot } from '../../../core/genre'
import toast from 'react-hot-toast'
import { FileDown, Loader2, Save } from 'lucide-react'
import jsPDF from 'jspdf'
import { supabase } from '../../../core/supabase'
import { useDroits } from '../../../core/rights/useDroit'
import { startDocument } from '../../../core/pdf/layout'
import { loadPdfOrg } from '../../../core/pdf/pdfOrg'
import { SYMBOLES_HABILITATION, CATEGORIES_CONDUITE } from '../../rh/lib/rhDocuments'

export const KINDS_AVIS = {
  habilitation_electrique: { label: 'Habilitation électrique', base: 'norme NF C18-510', mots: 'Symboles proposés', liste: SYMBOLES_HABILITATION, titre: "titre d'habilitation" },
  autorisation_conduite: { label: 'Conduite d\'engins', base: 'article R4323-56 du code du travail', mots: 'Catégories proposées', liste: CATEGORIES_CONDUITE, titre: 'autorisation de conduite' },
}
export const RESULTATS_AVIS = {
  favorable: { label: 'Avis favorable', badge: 'badge-success' },
  reserve: { label: 'Favorable avec réserves', badge: 'badge-warning' },
  defavorable: { label: 'Avis défavorable', badge: 'badge-danger' },
}
const frDate = (d) => (d ? new Date(`${String(d).slice(0, 10)}T12:00:00`).toLocaleDateString('fr-FR') : '')

/** PDF : une page par stagiaire, pour l'employeur */
export async function genererAvisPDF({ session, kind, lignes, trainerName, trainerGender }) {
  const ORG = await loadPdfOrg(true)
  const k = KINDS_AVIS[kind]
  const doc = new jsPDF({ compress: true })
  lignes.forEach((l, i) => {
    if (i > 0) doc.addPage()
    const f = startDocument(doc, ORG, { code: 'AVIS', docLabel: 'Avis après formation', title: 'Avis après formation', subtitle: `${k.label} : avis remis à l'employeur (${k.base})` })
    f.section('Formation')
    f.fields([{ label: 'Formation', value: session?.courses?.title || '', w: 3 }, { label: 'Référence', value: session?.reference || '' }])
    f.fields([{ label: 'Du', value: frDate(session?.start_date) }, { label: 'Au', value: frDate(session?.end_date || session?.start_date) },
      { label: 'Entreprise', value: session?.clients?.name || '', w: 2 }])
    f.section('Stagiaire')
    f.fields([{ label: 'Nom et prénom', value: `${l.first_name || ''} ${(l.last_name || '').toUpperCase()}`.trim(), w: 3 }, { label: 'Avis du', value: frDate(l.decided_on) }])
    f.section('Avis du formateur')
    f.fields([{ label: 'Résultat', value: RESULTATS_AVIS[l.result]?.label || '', w: 2 }, { label: k.mots, value: (l.symbols || []).join(', ') || '-', w: 2 }])
    if (kind === 'habilitation_electrique') f.fields([{ label: 'Domaine de tension', value: l.voltage || '-', w: 2 }, { label: 'Ouvrages ou installations', value: l.scope || '-', w: 2 }])
    else f.fields([{ label: 'Engins et conditions', value: l.scope || '-', w: 4 }])
    if (l.observations) f.para(`Observations : ${l.observations}`)
    f.note(`Cet avis ne vaut pas ${k.titre} : l'employeur le délivre au salarié après s'être assuré de son aptitude médicale${kind === 'autorisation_conduite' ? ' et de sa connaissance des lieux et des instructions' : ''}, en s'appuyant sur cet avis.`)
    f.signatures([{ label: leMot('formateur', trainerGender, { majuscule: true }), name: trainerName || l.trainer_name || '' }])
    f.finish()
  })
  return doc.output('blob')
}

export default function AvisFormationTab({ session, sessionTrainees, trainer }) {
  const kind = session?.courses?.avis_kind
  const k = KINDS_AVIS[kind]
  const d = useDroits({ suivi: ['formation.suivi.gerer', 'formation.sessions.modifier_siennes'] })
  const [avis, setAvis] = useState(null)
  const [brouillons, setBrouillons] = useState({})
  const [busy, setBusy] = useState(null)
  const trainerName = trainer ? `${trainer.first_name || ''} ${trainer.last_name || ''}`.trim() : ''

  const charger = useCallback(async () => {
    const { data, error } = await supabase.from('training_avis').select('*').eq('session_id', session.id)
    if (error) { toast.error(error.message); setAvis([]); return }
    setAvis(data || [])
  }, [session?.id])
  useEffect(() => { if (session?.id) charger() }, [charger, session?.id])

  if (!k) return <div className="card text-ui-sm text-gray-700">Cette formation ne donne pas lieu à un avis : réglez « Avis après formation » sur la fiche du catalogue.</div>
  if (avis === null) return <div className="flex justify-center py-10"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>

  const valeur = (t) => brouillons[t.id] || avis.find((a) => a.trainee_id === t.id) || { result: 'favorable', symbols: [], voltage: kind === 'habilitation_electrique' ? 'Basse tension (BT)' : '', scope: '', observations: '', decided_on: session?.end_date || new Date().toISOString().slice(0, 10) }
  const maj = (t, patch) => setBrouillons((b) => ({ ...b, [t.id]: { ...valeur(t), ...patch } }))
  const basculer = (t, s) => { const v = valeur(t); maj(t, { symbols: v.symbols.includes(s) ? v.symbols.filter((x) => x !== s) : [...v.symbols, s] }) }

  const enregistrer = async (t) => {
    const v = valeur(t)
    if (v.result !== 'defavorable' && !v.symbols.length) return toast.error(`${k.mots} : au moins un`)
    setBusy(t.id)
    try {
      const ligne = { session_id: session.id, trainee_id: t.id, kind, result: v.result, symbols: v.symbols, voltage: v.voltage || null, scope: v.scope?.trim() || null, observations: v.observations?.trim() || null, decided_on: v.decided_on, trainer_name: trainerName || null }
      const { error } = await supabase.from('training_avis').upsert(ligne, { onConflict: 'session_id,trainee_id' })
      if (error) throw error
      setBrouillons((b) => { const n = { ...b }; delete n[t.id]; return n })
      await charger()
      toast.success('Avis enregistré')
    } catch (e) { toast.error(e.message) }
    setBusy(null)
  }
  const pdf = async (seulement = null) => {
    const lignes = sessionTrainees.filter((t) => !seulement || t.id === seulement).map((t) => ({ ...t, ...avis.find((a) => a.trainee_id === t.id) })).filter((l) => l.result)
    if (!lignes.length) return toast.error('Aucun avis enregistré')
    setBusy('pdf')
    try {
      const blob = await genererAvisPDF({ session, kind, lignes, trainerName, trainerGender: trainer?.gender })
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = `Avis-apres-formation-${session?.reference || 'session'}.pdf`
      document.body.appendChild(a); a.click(); a.remove()
    } catch (e) { toast.error(e.message) }
    setBusy(null)
  }

  return (
    <div className="space-y-4">
      <div className="card flex flex-wrap items-center gap-3">
        <div className="flex-1 min-w-[14rem]">
          <h3 className="section-title">Avis après formation : {k.label}</h3>
          <p className="text-ui-sm text-gray-600">Un avis par stagiaire, remis à l'employeur, qui délivre ensuite le {k.titre} ({k.base}).</p>
        </div>
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => pdf()} disabled={busy === 'pdf' || !avis.length}>
          {busy === 'pdf' ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileDown className="w-4 h-4" />}Avis de tous (PDF)
        </button>
      </div>
      {sessionTrainees.map((t) => {
        const v = valeur(t)
        const enBase = avis.find((a) => a.trainee_id === t.id)
        return (
          <section key={t.id} className="card space-y-3">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-semibold text-ui flex-1">{t.first_name} {t.last_name}</span>
              {enBase ? <span className={`badge ${RESULTATS_AVIS[enBase.result].badge}`}>{RESULTATS_AVIS[enBase.result].label}</span> : <span className="badge badge-neutral">À donner</span>}
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block"><span className="label">Résultat</span>
                <select className="select" value={v.result} disabled={!d.suivi} onChange={(e) => maj(t, { result: e.target.value })}>
                  {Object.entries(RESULTATS_AVIS).map(([c, r]) => <option key={c} value={c}>{r.label}</option>)}
                </select>
              </label>
              <label className="block"><span className="label">Avis du</span>
                <input className="input" type="date" value={v.decided_on || ''} disabled={!d.suivi} onChange={(e) => maj(t, { decided_on: e.target.value })} />
              </label>
            </div>
            <div>
              <span className="label">{k.mots}</span>
              <div className="flex flex-wrap gap-1.5">
                {k.liste.map((s) => (
                  <button key={s} type="button" disabled={!d.suivi} onClick={() => basculer(t, s)} aria-pressed={v.symbols.includes(s)}
                    className={`badge ${v.symbols.includes(s) ? 'bg-gray-900 text-white' : 'badge-neutral'}`} style={{ height: 30, padding: '0 10px' }}>{s}</button>
                ))}
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {kind === 'habilitation_electrique' && (
                <label className="block"><span className="label">Domaine de tension</span>
                  <select className="select" value={v.voltage || ''} disabled={!d.suivi} onChange={(e) => maj(t, { voltage: e.target.value })}>
                    {['Basse tension (BT)', 'Haute tension (HT)', 'BT et HT', 'Très basse tension (TBT)'].map((x) => <option key={x}>{x}</option>)}
                  </select>
                </label>
              )}
              <label className={`block ${kind === 'habilitation_electrique' ? '' : 'sm:col-span-2'}`}><span className="label">{kind === 'habilitation_electrique' ? 'Ouvrages ou installations' : 'Engins et conditions'}</span>
                <input className="input" maxLength={300} value={v.scope || ''} disabled={!d.suivi} onChange={(e) => maj(t, { scope: e.target.value })} />
              </label>
            </div>
            <label className="block"><span className="label">Observations</span>
              <textarea className="textarea" rows={2} maxLength={1500} value={v.observations || ''} disabled={!d.suivi} onChange={(e) => maj(t, { observations: e.target.value })} />
            </label>
            <div className="flex gap-2 justify-end flex-wrap">
              {enBase && <button type="button" className="btn btn-ghost btn-sm" onClick={() => pdf(t.id)} disabled={busy === 'pdf'}><FileDown className="w-4 h-4" />Son avis (PDF)</button>}
              {d.suivi && <button type="button" className="btn btn-primary btn-sm" onClick={() => enregistrer(t)} disabled={busy === t.id}>{busy === t.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}Enregistrer</button>}
            </div>
          </section>
        )
      })}
    </div>
  )
}
