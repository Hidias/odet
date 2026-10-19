import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { ShieldCheck, ClipboardCheck, Users, CalendarClock, FileText, FolderCheck, Loader2, Plus, Upload, Download, ExternalLink } from 'lucide-react'
import { supabase } from '../../../core/supabase'
import { buildStorageFileName } from '../../../core/storageUtils'
import { buildDossierControlePDF } from '../pdf/dossierControlePDF'

// Registre de sécurité d'un client (fonction 11, 0140), même vue pour l'espace entreprise et la fiche client.
// Rubriques : dossier de contrôle, vérifications, exercices, personnel formé, échéances, documents. Des faits datés et
// des échéances calculées, jamais une note de conformité.
// Props : charger(site) → données ; mode 'entreprise' | 'organisme' ; orgPourPdf() → identité pour le PDF ;
// clientId et companyId (dépôt de fichiers, chemin <société>/<client>/...).

const fr = (d) => (d ? new Date(String(d).length === 10 ? `${d}T12:00:00` : d).toLocaleDateString('fr-FR') : '')
const PASTILLES = {
  a_jour: ['bg-[rgb(var(--c-success-bg))] text-[rgb(var(--c-success))]', 'À jour'],
  a_prevoir: ['bg-[rgb(var(--c-warning-bg))] text-[rgb(var(--c-warning))]', 'À prévoir'],
  depasse: ['bg-[rgb(var(--c-danger-bg))] text-[rgb(var(--c-danger))]', 'Dépassé'],
  manquant: ['bg-[rgb(var(--c-danger-bg))] text-[rgb(var(--c-danger))]', 'Manquant'],
}
const KINDS = { consigne_incendie: 'Consigne incendie', plan_evacuation: 'Plan d\'évacuation', rapport_organisme_agree: 'Rapport d\'un organisme agréé', permis: 'Permis', autre: 'Autre document' }

const Pastille = ({ etat }) => { const p = PASTILLES[etat] || PASTILLES.a_jour; return <span className={`text-xs px-2 py-0.5 rounded-full shrink-0 ${p[0]}`}>{p[1]}</span> }

function pire(etats) {
  if (etats.some((e) => e === 'depasse' || e === 'manquant')) return 'depasse'
  if (etats.some((e) => e === 'a_prevoir')) return 'a_prevoir'
  return 'a_jour'
}

export default function RegistreVue({ charger, mode, orgPourPdf, clientId, companyId }) {
  const [site, setSite] = useState(null)
  const [r, setR] = useState(null)
  const [erreur, setErreur] = useState(null)
  const [ouvert, setOuvert] = useState('dossier')
  const [form, setForm] = useState(null)
  const [busy, setBusy] = useState(false)
  const [exercices, setExercices] = useState([])

  const load = async (s = site) => {
    try { setR(await charger(s)); setErreur(null) } catch (e) { setErreur(e.message || 'Registre indisponible') }
  }
  useEffect(() => { load(site) }, [site])
  useEffect(() => {
    if (mode !== 'entreprise') supabase.from('obligation_rules').select('id, label').eq('kind', 'exercice').eq('is_active', true).order('label').then(({ data }) => setExercices(data || []))
  }, [mode])

  if (erreur) return <p className="text-sm text-gray-500">{erreur}</p>
  if (!r) return <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-gray-400" /></div>

  const pdf = async () => {
    setBusy(true)
    try {
      const ORG = await orgPourPdf()
      buildDossierControlePDF(ORG, r).save(`Dossier_controle_${(r.client?.name || 'client').replace(/[^A-Za-z0-9]+/g, '_')}.pdf`)
    } catch (e) { toast.error(`PDF impossible : ${e.message}`) } finally { setBusy(false) }
  }

  const ouvrirFichier = async (d) => {
    const { data, error } = await supabase.storage.from('registre').createSignedUrl(d.file_path, 300)
    if (error || !data?.signedUrl) return toast.error('Fichier introuvable')
    window.open(data.signedUrl, '_blank', 'noopener')
  }

  const ajouterExercice = async () => {
    if (!form.rule || !form.date) return toast.error('Type et date requis')
    setBusy(true)
    const siteId = form.site || site || null
    const { error } = mode === 'entreprise'
      ? await supabase.rpc('ent_exercice_ajouter', { p_site: siteId, p_rule: form.rule, p_date: form.date, p_participants: form.participants ? Number(form.participants) : null, p_observations: form.observations || null })
      : await supabase.from('client_safety_checks').insert({ client_id: clientId, site_id: siteId, rule_id: form.rule, done_on: form.date, done_by: form.done_by || 'Organisme', participants: form.participants ? Number(form.participants) : null, observations: form.observations || null })
    setBusy(false)
    if (error) return toast.error(error.message)
    toast.success('Exercice enregistré')
    setForm(null)
    load()
  }

  const deposer = async () => {
    if (!form.file || !form.title?.trim()) return toast.error('Fichier et titre requis')
    if (form.file.size > 15 * 1024 * 1024) return toast.error('Fichier trop lourd (15 Mo au plus)')
    setBusy(true)
    const path = `${companyId}/${clientId}/${buildStorageFileName(form.file.name)}`
    const { error: up } = await supabase.storage.from('registre').upload(path, form.file, { contentType: form.file.type })
    if (up) { setBusy(false); return toast.error(`Dépôt impossible : ${up.message}`) }
    const siteId = form.site || site || null
    const { error } = mode === 'entreprise'
      ? await supabase.rpc('ent_document_ajouter', { p_site: siteId, p_kind: form.kind, p_title: form.title.trim(), p_path: path, p_file_name: form.file.name, p_issued_on: form.issued_on || null, p_valid_until: form.valid_until || null })
      : await supabase.from('client_documents').insert({ client_id: clientId, site_id: siteId, kind: form.kind, title: form.title.trim(), file_path: path, file_name: form.file.name, issued_on: form.issued_on || null, valid_until: form.valid_until || null, source: 'organisme' })
    setBusy(false)
    if (error) return toast.error(error.message)
    toast.success('Document déposé')
    setForm(null)
    load()
  }

  const etatsEch = (r.echeances || []).map((e) => e.status)
  const rubriques = [
    ['dossier', 'Dossier de contrôle', FolderCheck, pire((r.dossier || []).map((p) => p.etat))],
    ['verifications', 'Vérifications', ShieldCheck, pire(etatsEch.filter((_, i) => r.echeances[i].kind === 'materiel'))],
    ['exercices', 'Exercices et essais', ClipboardCheck, pire(etatsEch.filter((_, i) => r.echeances[i].kind === 'exercice'))],
    ['personnel', 'Personnel formé', Users, pire(etatsEch.filter((_, i) => r.echeances[i].kind === 'formation'))],
    ['echeances', 'Échéances', CalendarClock, pire(etatsEch)],
    ['documents', 'Documents', FileText, null],
  ]
  const exTypes = mode === 'entreprise' ? (r.types_exercice || []) : exercices

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {(r.sites || []).length > 1 && (
          <select className="input w-auto" value={site || ''} onChange={(e) => setSite(e.target.value || null)} aria-label="Site">
            <option value="">Tous les sites</option>
            {r.sites.map((s) => <option key={s.id} value={s.id}>{s.name}{s.city ? ` · ${s.city}` : ''}</option>)}
          </select>
        )}
        <button type="button" className="btn btn-secondary ml-auto" onClick={pdf} disabled={busy}>{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />} Préparer le dossier (PDF)</button>
      </div>

      {rubriques.map(([k, label, Icon, etat]) => (
        <div key={k} className="bg-white rounded-ui-lg border border-gray-200">
          <button type="button" className="w-full flex items-center gap-2 p-3 text-left" onClick={() => setOuvert(ouvert === k ? null : k)} aria-expanded={ouvert === k}>
            <Icon className="w-5 h-5 text-primary-700" />
            <span className="font-medium text-gray-900 flex-1">{label}</span>
            {etat && <Pastille etat={etat} />}
          </button>
          {ouvert === k && (
            <div className="px-3 pb-3 space-y-2 text-sm">
              {k === 'dossier' && (r.dossier || []).map((p) => (
                <div key={p.piece} className="flex items-start justify-between gap-2">
                  <span className="text-gray-800">{p.piece}{p.ref ? <span className="text-gray-400"> · {p.ref}</span> : null}</span>
                  <Pastille etat={p.etat} />
                </div>
              ))}

              {k === 'verifications' && (
                <>
                  {r.parc?.appareils > 0 && <p className="text-gray-600">{r.parc.appareils} appareil{r.parc.appareils > 1 ? 's' : ''} suivi{r.parc.appareils > 1 ? 's' : ''}, prochaine vérification {fr(r.parc.prochaine_verification) || 'à planifier'}{r.parc.en_retard ? `, ${r.parc.en_retard} en retard` : ''}.</p>}
                  {(r.verifications || []).length === 0 ? <p className="text-gray-500">Aucune vérification enregistrée par l'organisme. Le rapport d'un autre prestataire se dépose dans Documents.</p>
                    : r.verifications.map((v) => (
                      <div key={v.id} className="flex items-start justify-between gap-2">
                        <span className="text-gray-800">{fr(v.date)} · {v.reference}{v.site ? ` · ${v.site}` : ''}</span>
                        <span className="text-gray-500 shrink-0">{v.conformes}/{v.appareils} conformes{v.a_remplacer ? `, ${v.a_remplacer} à remplacer` : ''}</span>
                      </div>
                    ))}
                </>
              )}

              {k === 'exercices' && (
                <>
                  {(r.exercices || []).length === 0 && <p className="text-gray-500">Aucun exercice enregistré (au moins tous les six mois, R4227-39).</p>}
                  {(r.exercices || []).map((e) => (
                    <div key={e.id} className="border-b border-gray-100 pb-1.5">
                      <div className="flex items-start justify-between gap-2"><span className="text-gray-800">{fr(e.done_on)} · {e.label}</span>{e.declared_by_client && <span className="text-xs text-gray-400 shrink-0">déclaré par l'entreprise</span>}</div>
                      <div className="text-gray-500">{[e.done_by, e.participants != null ? `${e.participants} participants` : null, e.observations].filter(Boolean).join(' · ')}</div>
                    </div>
                  ))}
                  {!form && exTypes.length > 0 && <button type="button" className="btn btn-sm btn-secondary" onClick={() => setForm({ type: 'exercice', rule: exTypes[0]?.id || '', date: new Date().toISOString().slice(0, 10), site: site || r.sites?.[0]?.id || '' })}><Plus className="w-4 h-4" /> Ajouter un exercice</button>}
                  {form?.type === 'exercice' && (
                    <div className="space-y-2 bg-gray-50 rounded-ui-sm p-2">
                      <select className="input w-full" value={form.rule} onChange={(e) => setForm((f) => ({ ...f, rule: e.target.value }))} aria-label="Type d'exercice">
                        {exTypes.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
                      </select>
                      {(r.sites || []).length > 1 && (
                        <select className="input w-full" value={form.site} onChange={(e) => setForm((f) => ({ ...f, site: e.target.value }))} aria-label="Site de l'exercice">
                          {r.sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                        </select>
                      )}
                      <div className="grid grid-cols-2 gap-2">
                        <input type="date" className="input" value={form.date} max={new Date().toISOString().slice(0, 10)} onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))} aria-label="Date" />
                        <input className="input" inputMode="numeric" placeholder="Participants" value={form.participants || ''} onChange={(e) => setForm((f) => ({ ...f, participants: e.target.value.replace(/\D/g, '') }))} aria-label="Participants" />
                      </div>
                      <textarea className="input w-full min-h-[64px]" placeholder="Observations (durée d'évacuation, difficultés…)" value={form.observations || ''} onChange={(e) => setForm((f) => ({ ...f, observations: e.target.value }))} aria-label="Observations" />
                      <div className="flex gap-2 justify-end">
                        <button type="button" className="btn btn-sm btn-ghost" onClick={() => setForm(null)}>Annuler</button>
                        <button type="button" className="btn btn-sm btn-primary" onClick={ajouterExercice} disabled={busy}>{busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Enregistrer</button>
                      </div>
                    </div>
                  )}
                </>
              )}

              {k === 'personnel' && ((r.personnel || []).length === 0 ? <p className="text-gray-500">Aucune formation enregistrée pour le personnel.</p> : r.personnel.map((p) => (
                <div key={p.id} className="border-b border-gray-100 pb-1.5">
                  <div className="text-gray-900">{(p.last_name || '').toUpperCase()} {p.first_name}<span className="text-gray-400">{p.job_title ? ` · ${p.job_title}` : ''}</span></div>
                  {(p.validites || []).map((v, i) => (
                    <div key={i} className="flex items-start justify-between gap-2 text-gray-600">
                      <span>{v.label}{v.echeance ? ` · jusqu'au ${fr(v.echeance)}` : v.valide_le ? ` · le ${fr(v.valide_le)}` : ''}</span>
                      <Pastille etat={v.statut} />
                    </div>
                  ))}
                </div>
              )))}

              {k === 'echeances' && ((r.echeances || []).length === 0 ? <p className="text-gray-500">Aucune échéance suivie.</p> : r.echeances.map((e, i) => (
                <div key={i} className="flex items-start justify-between gap-2">
                  <span className="text-gray-800">{fr(e.due_on)} · {e.label}{e.objet ? ` · ${e.objet}` : ''}{e.site ? ` · ${e.site}` : ''}</span>
                  <Pastille etat={e.status} />
                </div>
              )))}

              {k === 'documents' && (
                <>
                  {(r.documents || []).length === 0 && <p className="text-gray-500">Aucun document déposé (consigne incendie, plan d'évacuation, rapport d'un organisme agréé…).</p>}
                  {(r.documents || []).map((d) => (
                    <div key={d.id} className="flex items-start justify-between gap-2">
                      <span className="text-gray-800">{d.title}<span className="text-gray-400"> · {KINDS[d.kind]}{d.valid_until ? ` · jusqu'au ${fr(d.valid_until)}` : ''}{d.source === 'entreprise' ? ' · déposé par l\'entreprise' : ''}</span></span>
                      {d.file_path && <button type="button" className="btn btn-sm btn-ghost" onClick={() => ouvrirFichier(d)} aria-label="Ouvrir"><ExternalLink className="w-4 h-4" /></button>}
                    </div>
                  ))}
                  {!form && <button type="button" className="btn btn-sm btn-secondary" onClick={() => setForm({ type: 'document', kind: 'consigne_incendie', title: KINDS.consigne_incendie, site: site || r.sites?.[0]?.id || '' })}><Upload className="w-4 h-4" /> Déposer un document</button>}
                  {form?.type === 'document' && (
                    <div className="space-y-2 bg-gray-50 rounded-ui-sm p-2">
                      <select className="input w-full" value={form.kind} onChange={(e) => setForm((f) => ({ ...f, kind: e.target.value, title: f.title === KINDS[f.kind] ? KINDS[e.target.value] : f.title }))} aria-label="Type de document">
                        {Object.entries(KINDS).map(([kk, v]) => <option key={kk} value={kk}>{v}</option>)}
                      </select>
                      <input className="input w-full" placeholder="Titre" value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} aria-label="Titre" />
                      <input type="file" className="input w-full" accept="application/pdf,image/jpeg,image/png,image/webp" onChange={(e) => setForm((f) => ({ ...f, file: e.target.files?.[0] || null }))} aria-label="Fichier" />
                      <div className="grid grid-cols-2 gap-2">
                        <label className="text-xs text-gray-500">Date du document<input type="date" className="input mt-0.5" value={form.issued_on || ''} onChange={(e) => setForm((f) => ({ ...f, issued_on: e.target.value }))} /></label>
                        <label className="text-xs text-gray-500">Valable jusqu'au<input type="date" className="input mt-0.5" value={form.valid_until || ''} onChange={(e) => setForm((f) => ({ ...f, valid_until: e.target.value }))} /></label>
                      </div>
                      <div className="flex gap-2 justify-end">
                        <button type="button" className="btn btn-sm btn-ghost" onClick={() => setForm(null)}>Annuler</button>
                        <button type="button" className="btn btn-sm btn-primary" onClick={deposer} disabled={busy}>{busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Déposer</button>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      ))}
      {r.duerp && <p className="text-xs text-gray-500">Document unique : {r.duerp.reference || ''} version {r.duerp.version || 1}{r.duerp.date_prochaine_maj ? `, mise à jour prévue le ${fr(r.duerp.date_prochaine_maj)}` : ''}.</p>}
      <p className="text-xs text-gray-400">Ce registre rassemble les éléments enregistrés ; il alimente les registres légaux sans les remplacer. Les exercices déclarés par l'entreprise restent sous sa responsabilité.</p>
    </div>
  )
}
