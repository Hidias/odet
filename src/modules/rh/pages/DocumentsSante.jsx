// Module RH, documents et santé au travail (chantier 12, 0301) : sections de la fiche du personnel et de « Mon espace ».
//   - DocumentsFiche : documents de la personne (bucket privé, liens signés, consultation journalisée) ;
//   - HabilitationsFiche : habilitations et titres, avec leur échéance ;
//   - SanteFiche : suivi de santé au travail, administratif seulement (aucune donnée médicale).
// Chaque section n'apparaît que si la base la permet ; les boutons suivent les droits, la base décide.

import { useCallback, useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { Plus, FileText, Upload, Trash2, Pencil, ExternalLink, Archive, ShieldCheck, HeartPulse, Lock } from 'lucide-react'
import { Sheet } from '../../../ui/Sheet'
import { supabase } from '../../../core/supabase'
import PadSimple from '../../../ui/signature/PadSimple'
import MaSignature from '../../../core/signatures/MaSignature'
import { chargerSignatures } from '../../../core/signatures/signatures'
import { genererTitrePDF } from '../lib/rhTitres'
import { OPTIONS_ADAPTE } from '../../../core/branding/presets'
import { confirmer } from '../../../ui/Confirm'
import {
  CATEGORIES_DOC, CONFIDENTIALITES, TYPES_HABILITATION, TYPES_VISITE, CONCLUSIONS, TYPES_FICHIER, TAILLE_MAX,
  SYMBOLES_HABILITATION, CATEGORIES_CONDUITE, TYPES_CONSIGNE, ISSUES_INAPTITUDE, chargerConsignes, enregistrerConsigne, supprimerConsigne,
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

const HAB_VIDE = { kind: 'habilitation_electrique', label: '', obtained_on: '', expires_on: '', issuer: '', notes: '', document_id: '', symbols: [], scope: '' }

// Cases à cocher des symboles ou catégories (un appui par symbole, lisible sur téléphone)
function ChoixSymboles({ liste, valeur, onChange }) {
  const v = Array.isArray(valeur) ? valeur : []
  return (
    <div className="flex flex-wrap gap-1.5">
      {liste.map((x) => {
        const on = v.includes(x)
        return (
          <button key={x} type="button" aria-pressed={on} onClick={() => onChange(on ? v.filter((y) => y !== x) : [...v, x])}
            className={`px-2.5 py-1 rounded-ui-sm border text-ui-sm ${on ? 'bg-accent-600 text-white border-accent-600' : 'bg-white text-gray-700 border-gray-300'}`}>{x}</button>
        )
      })}
    </div>
  )
}

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
          {(v.kind === 'habilitation_electrique' || v.kind === 'autorisation_conduite') && (
            <Champ label={v.kind === 'habilitation_electrique' ? 'Symboles' : 'Catégories'} className="sm:col-span-2"
              aide="Ils servent au contrôle d'affectation : un technicien sans le bon symbole n'est pas affecté au matériel qui l'exige.">
              <ChoixSymboles liste={v.kind === 'habilitation_electrique' ? SYMBOLES_HABILITATION : CATEGORIES_CONDUITE} valeur={v.symbols} onChange={(x) => setV({ ...v, symbols: x })} />
            </Champ>
          )}
          {(v.kind === 'habilitation_electrique' || v.kind === 'autorisation_conduite') && (
            <Champ label={v.kind === 'habilitation_electrique' ? 'Domaine et ouvrages' : 'Engins et lieux'} className="sm:col-span-2">
              <input className="input" value={v.scope} onChange={m('scope')} placeholder={v.kind === 'habilitation_electrique' ? 'Ex. : basse tension, BAES et tableaux des sites clients' : 'Ex. : chariots du dépôt, quai de chargement'} />
            </Champ>
          )}
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

// Édition du titre par l'employeur (0387) : signataire choisi parmi les signatures enregistrées, signature du
// salarié sur place (ou sur papier), document PDF rangé dans le dossier de la personne
function TitreSheet({ companyId, personId, hab, onClose, onSaved }) {
  const elec = hab.kind === 'habilitation_electrique'
  const [sigs, setSigs] = useState(null)
  const [signataire, setSignataire] = useState('')
  const [salarie, setSalarie] = useState(null)
  const [surPapier, setSurPapier] = useState(false)
  const [lieux, setLieux] = useState(false)
  const [delivre, setDelivre] = useState(new Date().toISOString().slice(0, 10))
  const [busy, setBusy] = useState(false)
  const [ctx, setCtx] = useState(null)
  const chargerSigs = useCallback(() => chargerSignatures(companyId).then((l) => { setSigs(l); if (l.length === 1) setSignataire(l[0].profile_id) }).catch(() => setSigs([])), [companyId])
  useEffect(() => { chargerSigs() }, [chargerSigs])
  useEffect(() => {
    (async () => {
      const [{ data: person }, { data: emp }, nciRes] = await Promise.all([
        supabase.from('hr_people').select('first_name, last_name, birth_date').eq('id', personId).maybeSingle(),
        supabase.from('hr_employments').select('job_title, start_on').eq('person_id', personId).order('start_on', { ascending: false }).limit(1),
        supabase.from('hr_medical_followups').select('visit_on, next_due_on, nci_scope').eq('person_id', personId).eq('visit_type', 'non_contre_indication').order('visit_on', { ascending: false }).limit(5),
      ])
      const scope = elec ? 'electrique' : 'conduite'
      const nci = (nciRes.data || []).find((n) => (n.nci_scope || []).includes(scope)) || null
      setCtx({ person, jobTitle: emp?.[0]?.job_title || '', nci, nciLisible: !nciRes.error })
    })()
  }, [personId, elec])
  const sig = (sigs || []).find((x) => x.profile_id === signataire)
  const manque = [
    !hab.expires_on && "la date de fin de validité du titre (modifier l'habilitation)",
    !(hab.symbols || []).length && (elec ? 'les symboles' : 'les catégories') + " (modifier l'habilitation)",
    !sig && "le signataire de l'employeur",
    !surPapier && !salarie && 'la signature du salarié (ou cocher « sur papier »)',
    !elec && !lieux && 'la confirmation de la connaissance des lieux',
  ].filter(Boolean)
  const editer = async () => {
    if (manque.length) { toast.error(`Il manque : ${manque.join(', ')}`); return }
    setBusy(true)
    try {
      const blob = await genererTitrePDF({ kind: hab.kind, person: ctx.person, jobTitle: ctx.jobTitle, qual: hab, nci: ctx.nci,
        signer: { nom: sig.nom, titre: sig.signer_title, image: sig.image }, employeeSignature: surPapier ? null : salarie, deliveredOn: delivre, lieuxConnus: lieux })
      const nomFichier = `${elec ? 'Titre-habilitation' : 'Autorisation-conduite'}-${ctx.person?.last_name || 'salarie'}-${delivre}.pdf`
      const file = new File([blob], nomFichier, { type: 'application/pdf' })
      const d = await deposerDocument({ companyId, personId, file, category: 'titre', confidentiality: 'normal', title: `${elec ? "Titre d'habilitation électrique" : 'Autorisation de conduite'} du ${fr(delivre)}`, docDate: delivre })
      await supabase.from('hr_qualifications').update({ delivered_at: delivre, delivered_by: signataire, employee_signed_at: surPapier ? null : new Date().toISOString(), title_document_id: d.id, document_id: hab.document_id || d.id }).eq('id', hab.id)
      window.open(URL.createObjectURL(blob), '_blank', 'noopener')
      toast.success('Titre édité et rangé dans les documents de la personne')
      onSaved()
    } catch (e) { toast.error(e.message) }
    setBusy(false)
  }
  return (
    <Sheet title={elec ? "Éditer le titre d'habilitation" : "Éditer l'autorisation de conduite"} onClose={onClose}
      footer={<><button type="button" className="btn btn-secondary" onClick={onClose}>Annuler</button><button type="button" className="btn btn-primary" onClick={editer} disabled={busy || !ctx}>Éditer et ranger le titre</button></>}>
      <div className="space-y-4 text-ui">
        <div className="text-gray-800"><span className="font-semibold">{hab.label}</span>{(hab.symbols || []).length ? ` · ${hab.symbols.join(', ')}` : ''}{hab.expires_on ? ` · jusqu'au ${fr(hab.expires_on)}` : ''}</div>
        {ctx && (
          <div className={`rounded-ui-sm p-2.5 text-ui-sm ${ctx.nci ? 'bg-[rgb(var(--c-success-bg))]' : 'bg-[rgb(var(--c-warning-bg))]'}`}>
            {ctx.nci ? `Attestation de non contre-indication du ${fr(ctx.nci.visit_on)}, valable jusqu'au ${fr(ctx.nci.next_due_on)}.`
              : ctx.nciLisible ? "Aucune attestation de non contre-indication valable pour ce titre : le titre l'indiquera « à joindre » (articles R4323-56 et R4544-10)."
                : "Attestation de non contre-indication non lisible avec vos droits : le titre l'indiquera « à joindre »."}
          </div>
        )}
        <Champ label="Délivré le"><input className="input" type="date" value={delivre} onChange={(e) => setDelivre(e.target.value)} /></Champ>
        <Champ label="Signataire pour l'employeur" aide="Un associé dont la signature est enregistrée (Mon espace › Ma signature).">
          {sigs === null ? <span className="muted">…</span> : sigs.length === 0
            ? <span className="text-ui-sm text-[rgb(var(--c-warning))]">Aucune signature enregistrée.</span>
            : <select className="select" value={signataire} onChange={(e) => setSignataire(e.target.value)}><option value="">Choisir</option>{sigs.map((x) => <option key={x.profile_id} value={x.profile_id}>{x.nom}{x.signer_title ? `, ${x.signer_title}` : ''}</option>)}</select>}
        </Champ>
        {sigs !== null && <details className="text-ui-sm"><summary className="cursor-pointer text-gray-600">Enregistrer ma signature ici</summary><div className="mt-2"><MaSignature companyId={companyId} compact onSaved={chargerSigs} /></div></details>}
        {!elec && (
          <label className="flex items-start gap-2"><input type="checkbox" className="mt-1" checked={lieux} onChange={(e) => setLieux(e.target.checked)} />
            <span>Le salarié connaît les lieux et les instructions à respecter sur les sites où il conduit.</span></label>
        )}
        <div className="space-y-2">
          <div className="label">Signature du salarié</div>
          <label className="flex items-center gap-2 text-ui-sm"><input type="checkbox" checked={surPapier} onChange={(e) => setSurPapier(e.target.checked)} />Il signera sur papier (titre imprimé)</label>
          {!surPapier && <PadSimple onChange={setSalarie} label="Le salarié signe dans le cadre" />}
        </div>
      </div>
    </Sheet>
  )
}

export function HabilitationsFiche({ companyId, personId, peutGerer = false }) {
  const [liste, setListe] = useState(null)
  const [edite, setEdite] = useState(null)
  const [titre, setTitre] = useState(null)
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
              <div className="font-semibold text-ui flex flex-wrap items-center gap-1.5">{h.label}{h.suspended_at && <span className="badge badge-danger">Suspendue</span>}</div>
              {Array.isArray(h.symbols) && h.symbols.length > 0 && <div className="text-ui-sm text-gray-700">{h.symbols.join(' · ')}</div>}
              {h.suspended_at && <div className="text-ui-sm text-[rgb(var(--c-danger))]">{h.suspended_reason || 'Suspendue'}</div>}
              {h.delivered_at && <div className="text-ui-sm text-gray-600">Titre délivré le {fr(h.delivered_at)}{h.employee_signed_at ? ', signé par le salarié' : ', signature du salarié sur papier'}</div>}
              <div className="text-ui-sm text-gray-600">
                {[TYPES_HABILITATION[h.kind] !== h.label && TYPES_HABILITATION[h.kind], h.obtained_on && `obtenue le ${fr(h.obtained_on)}`,
                  h.expires_on ? `échéance le ${fr(h.expires_on)}` : 'sans échéance', h.issuer].filter(Boolean).join(' · ')}
              </div>
            </div>
            <Echeance iso={h.expires_on} />
            {peutGerer && (h.kind === 'habilitation_electrique' || h.kind === 'autorisation_conduite') && !h.suspended_at && (
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => setTitre(h)}>{h.delivered_at ? 'Rééditer le titre' : 'Éditer le titre'}</button>
            )}
            {peutGerer && <button type="button" className="btn btn-ghost btn-icon" aria-label={`Modifier ${h.label}`} onClick={() => setEdite(h)}><Pencil className="w-4 h-4" /></button>}
            {peutGerer && <button type="button" className="btn btn-ghost btn-icon" aria-label={`Archiver ${h.label}`} onClick={() => archiver(h)}><Archive className="w-4 h-4" /></button>}
          </li>
        ))}
      </ul>
      {edite && <HabilitationSheet companyId={companyId} personId={personId} hab={edite.id ? edite : null} onClose={() => setEdite(null)} onSaved={() => { setEdite(null); charger() }} />}
      {titre && <TitreSheet companyId={companyId} personId={personId} hab={titre} onClose={() => setTitre(null)} onSaved={() => { setTitre(null); charger() }} />}
    </section>
  )
}

// ─── Santé au travail (administratif) ───

const SANTE_VIDE = { visit_type: 'periodique', visit_on: '', next_due_on: '', conclusion: '', accommodation: '', document_id: '', nci_scope: [], inaptitude_outcome: '', inaptitude_closed_on: '' }
const unMoisApres = (iso) => { if (!iso) return ''; const d = new Date(`${String(iso).slice(0, 10)}T12:00:00`); d.setMonth(d.getMonth() + 1); return d.toISOString().slice(0, 10) }
const plus5ans = (iso) => { if (!iso) return ''; const d = new Date(`${iso}T12:00:00`); d.setFullYear(d.getFullYear() + 5); return d.toISOString().slice(0, 10) }

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
          <Champ label="Date de la visite"><input className="input" type="date" value={v.visit_on}
            onChange={(e) => setV({ ...v, visit_on: e.target.value, ...(v.visit_type === 'non_contre_indication' && !v.next_due_on ? { next_due_on: plus5ans(e.target.value) } : {}) })} /></Champ>
          <Champ label="Prochaine visite au plus tard"><input className="input" type="date" value={v.next_due_on} onChange={m('next_due_on')} /></Champ>
        </div>
        {v.visit_type === 'non_contre_indication' && (
          <Champ label="L'attestation vaut pour" aide="Valable 5 ans (articles R4323-56 et R4544-10 du code du travail). Elle conditionne les autorisations de conduite et les habilitations électriques.">
            <div className="flex flex-wrap gap-3">
              {[['conduite', "La conduite d'engins"], ['electrique', "L'habilitation électrique"]].map(([k, l]) => (
                <label key={k} className="flex items-center gap-2 text-ui"><input type="checkbox" checked={(v.nci_scope || []).includes(k)}
                  onChange={(e) => setV({ ...v, nci_scope: e.target.checked ? [...(v.nci_scope || []), k] : (v.nci_scope || []).filter((x) => x !== k) })} />{l}</label>
              ))}
            </div>
          </Champ>
        )}
        {v.conclusion === 'inapte' && (
          <div className="rounded-ui border border-[rgb(var(--c-danger)/0.3)] bg-[rgb(var(--c-danger-bg))] p-3 space-y-3 text-ui-sm text-gray-800">
            <p>À l'enregistrement, les habilitations électriques et autorisations de conduite sont suspendues et la personne n'est plus affectée aux travaux qui les exigent. Reclassement ou licenciement à décider dans le mois qui suit l'avis ; à défaut, le salaire reprend (articles L1226-4 et L1226-11 du code du travail).</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <Champ label="Suite donnée">
                <select className="select" value={v.inaptitude_outcome} onChange={m('inaptitude_outcome')}><option value="">À décider</option>{Object.entries(ISSUES_INAPTITUDE).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
              </Champ>
              <Champ label="Dossier clos le"><input className="input" type="date" value={v.inaptitude_closed_on} onChange={m('inaptitude_closed_on')} /></Champ>
            </div>
          </div>
        )}
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
                {Array.isArray(s.nci_scope) && s.nci_scope.length > 0 && <div className="text-ui-sm text-gray-600">Vaut pour : {s.nci_scope.map((x) => (x === 'conduite' ? "conduite d'engins" : 'habilitation électrique')).join(', ')}</div>}
                {s.conclusion === 'inapte' && !s.inaptitude_closed_on && <div className="text-ui-sm text-[rgb(var(--c-danger))]">Suite à décider avant le {fr(unMoisApres(s.visit_on || s.created_at))}</div>}
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

// ─── Consignes de travail (0386) : sans motif médical, visibles de qui planifie ───

const CONSIGNE_VIDE = { kind: 'hauteur', label: '', starts_on: '', ends_on: '' }

export function ConsignesFiche({ companyId, personId, peutGerer = false }) {
  const [liste, setListe] = useState(null)
  const [edite, setEdite] = useState(null)
  const [busy, setBusy] = useState(false)
  const charger = useCallback(() => { chargerConsignes(personId).then(setListe).catch(() => setListe([])) }, [personId])
  useEffect(() => { charger() }, [charger])
  if (liste === null) return null
  if (!liste.length && !peutGerer) return null
  const today = new Date().toISOString().slice(0, 10)
  const enregistrer = async (e) => {
    e.preventDefault()
    setBusy(true)
    try {
      await enregistrerConsigne({ ...(edite.id ? { id: edite.id } : { company_id: companyId, person_id: personId }), kind: edite.kind, label: edite.label, starts_on: edite.starts_on, ends_on: edite.ends_on })
      toast.success('Consigne enregistrée'); setEdite(null); charger()
    } catch (err) { toast.error(err.message) }
    setBusy(false)
  }
  return (
    <section className="card space-y-2">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h2 className="section-title">Consignes de travail</h2>
        {peutGerer && <button type="button" className="btn btn-secondary btn-sm" onClick={() => setEdite({ ...CONSIGNE_VIDE, starts_on: today })}><Plus className="w-4 h-4" aria-hidden="true" />Ajouter</button>}
      </div>
      <p className="text-ui-sm muted">Ce que la personne ne doit pas faire, d'après le service de santé au travail. Jamais de motif médical. Le planning en tient compte.</p>
      {liste.length === 0 && <p className="text-ui-sm muted">Aucune consigne.</p>}
      <ul className="divide-y divide-gray-100">
        {liste.map((c) => {
          const active = c.starts_on <= today && (!c.ends_on || c.ends_on >= today)
          return (
            <li key={c.id} className="py-2 flex items-start gap-2">
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-ui">{TYPES_CONSIGNE[c.kind]}{c.label ? ` : ${c.label}` : ''}</div>
                <div className="text-ui-sm text-gray-600">Depuis le {fr(c.starts_on)}{c.ends_on ? `, jusqu'au ${fr(c.ends_on)}` : ', sans date de fin'}</div>
              </div>
              <span className={`badge flex-none ${active ? 'badge-warning' : 'badge-neutral'}`}>{active ? 'En cours' : 'Terminée'}</span>
              {peutGerer && <button type="button" className="btn btn-ghost btn-icon" aria-label="Modifier la consigne" onClick={() => setEdite({ ...c, label: c.label || '', ends_on: c.ends_on || '' })}><Pencil className="w-4 h-4" /></button>}
              {peutGerer && <button type="button" className="btn btn-ghost btn-icon" aria-label="Supprimer la consigne" onClick={async () => { if (await confirmer('Supprimer cette consigne saisie par erreur ?')) { try { await supprimerConsigne(c.id); charger() } catch (e) { toast.error(e.message) } } }}><Trash2 className="w-4 h-4" /></button>}
            </li>
          )
        })}
      </ul>
      {edite && (
        <Sheet title={edite.id ? 'Modifier la consigne' : 'Ajouter une consigne'} onClose={() => setEdite(null)}
          footer={<><button type="button" className="btn btn-secondary" onClick={() => setEdite(null)}>Annuler</button><button type="submit" form="rh-consigne" className="btn btn-primary" disabled={busy}>Enregistrer</button></>}>
          <form id="rh-consigne" onSubmit={enregistrer} className="space-y-3">
            <Champ label="Consigne">
              <select className="select" value={edite.kind} onChange={(e) => setEdite({ ...edite, kind: e.target.value })}>{Object.entries(TYPES_CONSIGNE).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
            </Champ>
            <Champ label="Précision (facultatif)" aide="Consigne seulement, jamais de motif médical (200 caractères au plus)">
              <input className="input" maxLength={200} value={edite.label} onChange={(e) => setEdite({ ...edite, label: e.target.value })} placeholder="Ex. : pas plus de 10 kg" />
            </Champ>
            <div className="grid gap-3 sm:grid-cols-2">
              <Champ label="À partir du"><input className="input" type="date" value={edite.starts_on} onChange={(e) => setEdite({ ...edite, starts_on: e.target.value })} required /></Champ>
              <Champ label="Jusqu'au (facultatif)"><input className="input" type="date" value={edite.ends_on} onChange={(e) => setEdite({ ...edite, ends_on: e.target.value })} /></Champ>
            </div>
          </form>
        </Sheet>
      )}
    </section>
  )
}

// ─── Affichage adapté de la personne (0388) : réglé par elle-même, la RH ou la direction, jamais de motif ───
export function AffichageAdapteFiche({ profileId }) {
  const [v, setV] = useState(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (!profileId) return
    supabase.rpc('affichage_adapte_lire', { p_profile: profileId }).then(({ data, error }) => setV(error ? false : (data || {})))
  }, [profileId])
  if (!profileId || v === null || v === false) return null
  const changer = async (k, on) => {
    setBusy(true)
    const { data, error } = await supabase.rpc('affichage_adapte_regler', { p_profile: profileId, p_adapte: { ...v, [k]: on } })
    setBusy(false)
    if (error) { toast.error(error.message); return }
    setV(data || {})
  }
  return (
    <section className="card space-y-2">
      <h2 className="section-title">Affichage adapté</h2>
      <p className="text-ui-sm muted">Pour une personne qui lit mal le français, voit mal ou préfère des écrans plus simples. Aucun motif n'est demandé ni enregistré ; la personne peut aussi le régler elle-même (menu Affichage).</p>
      <div className="grid gap-1 sm:grid-cols-2">
        {OPTIONS_ADAPTE.map((o) => (
          <label key={o.key} className="flex items-start gap-2 py-1 text-ui cursor-pointer">
            <input type="checkbox" className="mt-1" disabled={busy} checked={!!v[o.key]} onChange={(e) => changer(o.key, e.target.checked)} />
            <span><span className="font-medium text-gray-900">{o.label}</span><span className="block text-ui-sm text-gray-500 leading-tight">{o.aide}</span></span>
          </label>
        ))}
      </div>
    </section>
  )
}
