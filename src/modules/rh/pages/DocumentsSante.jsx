// Module RH, documents et santé au travail (chantier 12, 0301) : sections de la fiche du personnel et de « Mon espace ».
//   - DocumentsFiche : documents de la personne (bucket privé, liens signés, consultation journalisée) ;
//   - HabilitationsFiche : habilitations et titres, avec leur échéance ;
//   - SanteFiche : suivi de santé au travail, administratif seulement (aucune donnée médicale).
// Chaque section n'apparaît que si la base la permet ; les boutons suivent les droits, la base décide.

import { useCallback, useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { Plus, FileText, Upload, Trash2, Pencil, ExternalLink, Archive, ShieldCheck, HeartPulse, Lock } from 'lucide-react'
import { Sheet } from '../../../ui/Sheet'
import { confirmer } from '../../../ui/Confirm'
import {
  CATEGORIES_DOC, CONFIDENTIALITES, TYPES_HABILITATION, TYPES_VISITE, CONCLUSIONS, TYPES_FICHIER, TAILLE_MAX,
  etatEcheance, chargerDocuments, deposerDocument, ouvrirDocument, supprimerDocument,
  chargerHabilitations, enregistrerHabilitation, archiverHabilitation,
  chargerSuivisSante, enregistrerSuiviSante, supprimerSuiviSante,
} from '../lib/rhDocuments'

const fr = (d) => (d ? new Date(`${String(d).slice(0, 10)}T12:00:00`).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' }) : '')
const taille = (n) => (n ? (n > 1048576 ? `${(n / 1048576).toFixed(1).replace('.', ',')} Mo` : `${Math.max(1, Math.round(n / 1024))} Ko`) : '')

function Champ({ label, children, className = '', aide = null }) {
  return (
    <label className={`block ${className}`}>
      <span className="label">{label}</span>
      {children}
      {aide && <span className="block text-ui-sm muted mt-0.5">{aide}</span>}
    </label>
  )
}

function Echeance({ iso }) {
  const e = etatEcheance(iso)
  if (!e) return null
  return <span className={`badge ${e.badge}`}>{e.label}</span>
}

// ─── Documents ───

/** Catégories qu'on peut déposer : la personne seulement ses justificatifs ; sans « restreints », pas de
 *  justificatif, santé ni bulletin */
function categoriesPermises({ peutGerer, peutRestreints, estMoi }) {
  if (peutGerer) return Object.keys(CATEGORIES_DOC).filter((k) => peutRestreints || CATEGORIES_DOC[k].conf === 'normal' || CATEGORIES_DOC[k].conf === null)
  if (estMoi) return ['justificatif']
  return []
}

function DepotSheet({ companyId, personId, categories, peutRestreints, onClose, onSaved, categorieDefaut = null }) {
  const [v, setV] = useState({ category: categorieDefaut || categories[0], confidentiality: 'normal', title: '', doc_date: '' })
  const [file, setFile] = useState(null)
  const [busy, setBusy] = useState(false)
  const imposee = CATEGORIES_DOC[v.category]?.conf
  const conf = imposee || v.confidentiality
  const deposer = async (e) => {
    e.preventDefault()
    if (!file) { toast.error('Choisissez un fichier'); return }
    if (file.size > TAILLE_MAX) { toast.error('Fichier trop lourd (15 Mo au plus)'); return }
    setBusy(true)
    try {
      await deposerDocument({ companyId, personId, file, category: v.category, confidentiality: conf, title: v.title, docDate: v.doc_date })
      toast.success('Document déposé')
      onSaved()
    } catch (err) { toast.error(err.message) }
    setBusy(false)
  }
  return (
    <Sheet title="Déposer un document" onClose={onClose}
      footer={<><button type="button" className="btn btn-secondary" onClick={onClose}>Annuler</button><button type="submit" form="rh-depot" className="btn btn-primary" disabled={busy}><Upload className="w-4 h-4" aria-hidden="true" />{busy ? 'Envoi…' : 'Déposer'}</button></>}>
      <form id="rh-depot" onSubmit={deposer} className="space-y-3">
        <Champ label="Fichier" aide="PDF ou photo, 15 Mo au plus">
          <input className="input" type="file" accept={TYPES_FICHIER} required onChange={(e) => setFile(e.target.files?.[0] || null)} />
        </Champ>
        <div className="grid gap-3 sm:grid-cols-2">
          {categories.length > 1 && (
            <Champ label="Type de document">
              <select className="select" value={v.category} onChange={(e) => setV({ ...v, category: e.target.value })}>
                {categories.map((k) => <option key={k} value={k}>{CATEGORIES_DOC[k].label}</option>)}
              </select>
            </Champ>
          )}
          <Champ label="Date du document"><input className="input" type="date" value={v.doc_date} onChange={(e) => setV({ ...v, doc_date: e.target.value })} /></Champ>
        </div>
        <Champ label="Titre"><input className="input" value={v.title} onChange={(e) => setV({ ...v, title: e.target.value })} placeholder={CATEGORIES_DOC[v.category]?.label} /></Champ>
        {!imposee && peutRestreints ? (
          <Champ label="Confidentialité" aide={CONFIDENTIALITES[v.confidentiality].aide}>
            <select className="select" value={v.confidentiality} onChange={(e) => setV({ ...v, confidentiality: e.target.value })}>
              <option value="normal">Dossier</option>
              <option value="restreint">Restreint</option>
            </select>
          </Champ>
        ) : (
          <p className="text-ui-sm text-gray-600 flex gap-2 items-start">
            <span className={`badge ${CONFIDENTIALITES[conf].badge} flex-none`}>{CONFIDENTIALITES[conf].label}</span>
            <span>{CONFIDENTIALITES[conf].aide}</span>
          </p>
        )}
        {v.category === 'sante' && <p className="text-ui-sm muted">Seulement des documents administratifs (avis d'aptitude, convocation). Jamais de diagnostic, de compte rendu médical ni d'arrêt de travail détaillé.</p>}
      </form>
    </Sheet>
  )
}

export function DocumentsFiche({ companyId, personId, peutGerer = false, peutRestreints = false, estMoi = false, titre = 'Documents' }) {
  const [docs, setDocs] = useState(null)
  const [depot, setDepot] = useState(false)
  const charger = useCallback(() => { chargerDocuments(personId).then(setDocs).catch(() => setDocs([])) }, [personId])
  useEffect(() => { charger() }, [charger])
  const categories = categoriesPermises({ peutGerer, peutRestreints, estMoi })

  const ouvrir = async (d) => { try { await ouvrirDocument(d.id) } catch (e) { toast.error(e.message) } }
  const supprimer = async (d) => {
    if (!(await confirmer(`Supprimer « ${d.title} » ? Le fichier est effacé.`))) return
    try { await supprimerDocument(d); charger() } catch (e) { toast.error(e.message) }
  }
  if (docs === null) return null
  if (!docs.length && !categories.length) return null

  return (
    <section className="card space-y-2">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h2 className="section-title">{titre}</h2>
        {categories.length > 0 && (
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => setDepot(true)}>
            <Plus className="w-4 h-4" aria-hidden="true" />{categories.length === 1 && categories[0] === 'justificatif' ? 'Déposer un justificatif' : 'Déposer un document'}
          </button>
        )}
      </div>
      {docs.length === 0 && <p className="text-ui-sm muted">Aucun document.</p>}
      <ul className="divide-y divide-gray-100">
        {docs.map((d) => {
          const c = CONFIDENTIALITES[d.confidentiality]
          return (
            <li key={d.id} className="py-2 flex items-start gap-2">
              <FileText className="w-4 h-4 mt-1 text-gray-400 flex-none" aria-hidden="true" />
              <button type="button" className="flex-1 min-w-0 text-left" onClick={() => ouvrir(d)}>
                <span className="block font-semibold text-ui truncate">{d.title}</span>
                <span className="block text-ui-sm text-gray-600">
                  {[CATEGORIES_DOC[d.category]?.label, fr(d.doc_date || d.created_at), taille(d.size_bytes)].filter(Boolean).join(' · ')}
                </span>
              </button>
              {d.confidentiality !== 'normal' && <span className={`badge ${c.badge} flex-none`} title={c.aide}><Lock className="w-3 h-3" aria-hidden="true" />{c.label}</span>}
              <button type="button" className="btn btn-ghost btn-icon" aria-label={`Ouvrir ${d.title}`} onClick={() => ouvrir(d)}><ExternalLink className="w-4 h-4" /></button>
              {peutGerer && (d.confidentiality === 'normal' || peutRestreints) && (
                <button type="button" className="btn btn-ghost btn-icon" aria-label={`Supprimer ${d.title}`} onClick={() => supprimer(d)}><Trash2 className="w-4 h-4" /></button>
              )}
            </li>
          )
        })}
      </ul>
      {depot && (
        <DepotSheet companyId={companyId} personId={personId} categories={categories} peutRestreints={peutRestreints}
          onClose={() => setDepot(false)} onSaved={() => { setDepot(false); charger() }} />
      )}
    </section>
  )
}

// ─── Habilitations ───

const HAB_VIDE = { kind: 'habilitation_electrique', label: '', obtained_on: '', expires_on: '', issuer: '', notes: '', document_id: '' }

function HabilitationSheet({ companyId, personId, hab = null, onClose, onSaved }) {
  const [v, setV] = useState(() => ({ ...HAB_VIDE, ...Object.fromEntries(Object.entries(hab || {}).filter(([k]) => k in HAB_VIDE).map(([k, x]) => [k, x ?? ''])) }))
  const [docs, setDocs] = useState([])
  const [busy, setBusy] = useState(false)
  useEffect(() => { chargerDocuments(personId).then((d) => setDocs(d.filter((x) => x.confidentiality === 'normal'))).catch(() => {}) }, [personId])
  const m = (k) => (e) => setV({ ...v, [k]: e.target.value })
  const enregistrer = async (e) => {
    e.preventDefault()
    setBusy(true)
    try {
      await enregistrerHabilitation({ ...(hab?.id ? { id: hab.id } : { company_id: companyId, person_id: personId }), ...v, label: v.label || TYPES_HABILITATION[v.kind] })
      toast.success('Habilitation enregistrée')
      onSaved()
    } catch (err) { toast.error(err.message) }
    setBusy(false)
  }
  return (
    <Sheet title={hab ? 'Modifier l\'habilitation' : 'Ajouter une habilitation'} onClose={onClose}
      footer={<><button type="button" className="btn btn-secondary" onClick={onClose}>Annuler</button><button type="submit" form="rh-hab" className="btn btn-primary" disabled={busy}>Enregistrer</button></>}>
      <form id="rh-hab" onSubmit={enregistrer} className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <Champ label="Type">
            <select className="select" value={v.kind} onChange={m('kind')}>{Object.entries(TYPES_HABILITATION).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
          </Champ>
          <Champ label="Intitulé" aide={v.kind === 'habilitation_electrique' ? 'Ex. : B1V BR BC H0V' : null}>
            <input className="input" value={v.label} onChange={m('label')} placeholder={TYPES_HABILITATION[v.kind]} />
          </Champ>
          <Champ label="Obtenue le"><input className="input" type="date" value={v.obtained_on} onChange={m('obtained_on')} /></Champ>
          <Champ label="Échéance"><input className="input" type="date" value={v.expires_on} onChange={m('expires_on')} /></Champ>
          <Champ label="Organisme"><input className="input" value={v.issuer} onChange={m('issuer')} /></Champ>
          {docs.length > 0 && (
            <Champ label="Document (titre, attestation)">
              <select className="select" value={v.document_id} onChange={m('document_id')}><option value="">Aucun</option>{docs.map((d) => <option key={d.id} value={d.id}>{d.title}</option>)}</select>
            </Champ>
          )}
        </div>
        <Champ label="Notes"><textarea className="input" rows={2} value={v.notes} onChange={m('notes')} /></Champ>
      </form>
    </Sheet>
  )
}

export function HabilitationsFiche({ companyId, personId, peutGerer = false }) {
  const [liste, setListe] = useState(null)
  const [edite, setEdite] = useState(null)
  const charger = useCallback(() => { chargerHabilitations(personId).then(setListe).catch(() => setListe([])) }, [personId])
  useEffect(() => { charger() }, [charger])
  const archiver = async (h) => {
    if (!(await confirmer(`Archiver « ${h.label} » ? Elle ne compte plus dans les échéances, rien n'est effacé.`))) return
    try { await archiverHabilitation(h.id); charger() } catch (e) { toast.error(e.message) }
  }
  if (liste === null) return null
  if (!liste.length && !peutGerer) return null
  return (
    <section className="card space-y-2">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h2 className="section-title">Habilitations et titres</h2>
        {peutGerer && <button type="button" className="btn btn-secondary btn-sm" onClick={() => setEdite({})}><Plus className="w-4 h-4" aria-hidden="true" />Ajouter</button>}
      </div>
      {liste.length === 0 && <p className="text-ui-sm muted">Aucune habilitation saisie.</p>}
      <ul className="divide-y divide-gray-100">
        {liste.map((h) => (
          <li key={h.id} className="py-2 flex items-start gap-2">
            <ShieldCheck className="w-4 h-4 mt-1 text-gray-400 flex-none" aria-hidden="true" />
            <div className="flex-1 min-w-0">
              <div className="font-semibold text-ui">{h.label}</div>
              <div className="text-ui-sm text-gray-600">
                {[TYPES_HABILITATION[h.kind] !== h.label && TYPES_HABILITATION[h.kind], h.obtained_on && `obtenue le ${fr(h.obtained_on)}`,
                  h.expires_on ? `échéance le ${fr(h.expires_on)}` : 'sans échéance', h.issuer].filter(Boolean).join(' · ')}
              </div>
            </div>
            <Echeance iso={h.expires_on} />
            {peutGerer && <button type="button" className="btn btn-ghost btn-icon" aria-label={`Modifier ${h.label}`} onClick={() => setEdite(h)}><Pencil className="w-4 h-4" /></button>}
            {peutGerer && <button type="button" className="btn btn-ghost btn-icon" aria-label={`Archiver ${h.label}`} onClick={() => archiver(h)}><Archive className="w-4 h-4" /></button>}
          </li>
        ))}
      </ul>
      {edite && <HabilitationSheet companyId={companyId} personId={personId} hab={edite.id ? edite : null} onClose={() => setEdite(null)} onSaved={() => { setEdite(null); charger() }} />}
    </section>
  )
}

// ─── Santé au travail (administratif) ───

const SANTE_VIDE = { visit_type: 'periodique', visit_on: '', next_due_on: '', conclusion: '', accommodation: '', document_id: '' }

function SanteSheet({ companyId, personId, suivi = null, onClose, onSaved }) {
  const [v, setV] = useState(() => ({ ...SANTE_VIDE, ...Object.fromEntries(Object.entries(suivi || {}).filter(([k]) => k in SANTE_VIDE).map(([k, x]) => [k, x ?? ''])) }))
  const [docs, setDocs] = useState([])
  const [busy, setBusy] = useState(false)
  useEffect(() => { chargerDocuments(personId).then((d) => setDocs(d.filter((x) => x.category === 'sante'))).catch(() => {}) }, [personId])
  const m = (k) => (e) => setV({ ...v, [k]: e.target.value })
  const enregistrer = async (e) => {
    e.preventDefault()
    if (!v.visit_on && !v.next_due_on) { toast.error('Indiquez la date de la visite ou sa prochaine échéance'); return }
    setBusy(true)
    try {
      await enregistrerSuiviSante({ ...(suivi?.id ? { id: suivi.id } : { company_id: companyId, person_id: personId }), ...v })
      toast.success('Suivi enregistré')
      onSaved()
    } catch (err) { toast.error(err.message) }
    setBusy(false)
  }
  return (
    <Sheet title={suivi ? 'Modifier la visite' : 'Ajouter une visite'} onClose={onClose}
      footer={<><button type="button" className="btn btn-secondary" onClick={onClose}>Annuler</button><button type="submit" form="rh-sante" className="btn btn-primary" disabled={busy}>Enregistrer</button></>}>
      <form id="rh-sante" onSubmit={enregistrer} className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <Champ label="Type de visite">
            <select className="select" value={v.visit_type} onChange={m('visit_type')}>{Object.entries(TYPES_VISITE).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
          </Champ>
          <Champ label="Conclusion">
            <select className="select" value={v.conclusion} onChange={m('conclusion')}><option value="">Pas encore connue</option>{Object.entries(CONCLUSIONS).map(([k, c]) => <option key={k} value={k}>{c.label}</option>)}</select>
          </Champ>
          <Champ label="Date de la visite"><input className="input" type="date" value={v.visit_on} onChange={m('visit_on')} /></Champ>
          <Champ label="Prochaine visite au plus tard"><input className="input" type="date" value={v.next_due_on} onChange={m('next_due_on')} /></Champ>
        </div>
        {(v.conclusion === 'apte_amenagements' || v.accommodation) && (
          <Champ label="Aménagement à respecter" aide={`${v.accommodation.length} / 300 · consigne de travail seulement, jamais de motif médical`}>
            <textarea className="input" rows={2} maxLength={300} value={v.accommodation} onChange={m('accommodation')} placeholder="Ex. : pas de port de charge de plus de 10 kg" />
          </Champ>
        )}
        {docs.length > 0 && (
          <Champ label="Avis ou convocation (document restreint)">
            <select className="select" value={v.document_id} onChange={m('document_id')}><option value="">Aucun</option>{docs.map((d) => <option key={d.id} value={d.id}>{d.title}</option>)}</select>
          </Champ>
        )}
        <p className="text-ui-sm muted">Suivi administratif seulement : dates, type de visite, conclusion et aménagement. L'avis complet reste chez le service de santé au travail.</p>
      </form>
    </Sheet>
  )
}

export function SanteFiche({ companyId, personId, peutGerer = false }) {
  const [liste, setListe] = useState(null)
  const [edite, setEdite] = useState(null)
  const charger = useCallback(() => { chargerSuivisSante(personId).then(setListe).catch(() => setListe([])) }, [personId])
  useEffect(() => { charger() }, [charger])
  const supprimer = async (s) => {
    if (!(await confirmer('Supprimer cette visite saisie par erreur ?'))) return
    try { await supprimerSuiviSante(s.id); charger() } catch (e) { toast.error(e.message) }
  }
  if (liste === null) return null
  if (!liste.length && !peutGerer) return null
  const prochaine = liste.map((s) => s.next_due_on).filter(Boolean).sort().pop()
  return (
    <section className="card space-y-2">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h2 className="section-title flex items-center gap-2"><HeartPulse className="w-4 h-4 text-gray-400" aria-hidden="true" />Santé au travail</h2>
        <div className="flex items-center gap-2">
          {prochaine && <span className="text-ui-sm text-gray-600">Prochaine visite : {fr(prochaine)}</span>}
          {prochaine && <Echeance iso={prochaine} />}
          {peutGerer && <button type="button" className="btn btn-secondary btn-sm" onClick={() => setEdite({})}><Plus className="w-4 h-4" aria-hidden="true" />Ajouter une visite</button>}
        </div>
      </div>
      {liste.length === 0 && <p className="text-ui-sm muted">Aucune visite saisie.</p>}
      <ul className="divide-y divide-gray-100">
        {liste.map((s) => {
          const c = CONCLUSIONS[s.conclusion]
          return (
            <li key={s.id} className="py-2 flex items-start gap-2">
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-ui">{TYPES_VISITE[s.visit_type]}{s.visit_on ? ` du ${fr(s.visit_on)}` : ' (à planifier)'}</div>
                {s.accommodation && <div className="text-ui-sm text-gray-600">Aménagement : {s.accommodation}</div>}
                {s.next_due_on && <div className="text-ui-sm text-gray-600">Prochaine au plus tard le {fr(s.next_due_on)}</div>}
              </div>
              {c && <span className={`badge ${c.badge} flex-none`}>{c.label}</span>}
              {peutGerer && <button type="button" className="btn btn-ghost btn-icon" aria-label="Modifier la visite" onClick={() => setEdite(s)}><Pencil className="w-4 h-4" /></button>}
              {peutGerer && <button type="button" className="btn btn-ghost btn-icon" aria-label="Supprimer la visite" onClick={() => supprimer(s)}><Trash2 className="w-4 h-4" /></button>}
            </li>
          )
        })}
      </ul>
      {edite && <SanteSheet companyId={companyId} personId={personId} suivi={edite.id ? edite : null} onClose={() => setEdite(null)} onSaved={() => { setEdite(null); charger() }} />}
    </section>
  )
}
