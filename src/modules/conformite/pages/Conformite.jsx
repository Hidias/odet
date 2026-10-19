import { useCallback, useEffect, useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import { Plus, RefreshCw, FileDown, ShieldCheck, Loader2 } from 'lucide-react'
import { supabase } from '../../../core/supabase'
import { useAuthStore } from '../../../core/store'
import { loadPdfOrg } from '../../../core/pdf/pdfOrg'
import { PageHeader } from '../../../ui/PageHeader'
import { Tabs } from '../../../ui/Tabs'
import { DataTable } from '../../../ui/DataTable'
import { StatusBadge } from '../../../ui/StatusBadge'
import { Banner } from '../../../ui/Banner'
import { EmptyState } from '../../../ui/EmptyState'
import { Sheet } from '../../../ui/Sheet'
import { confirmer } from '../../../ui/Confirm'
import { buildRegistreRgpdPDF } from '../pdf/registreRgpdPDF'

// Conformité RGPD (chantier F, 0340), tenue par société : registre des traitements (pré-rempli depuis les modules
// actifs, à valider), demandes des personnes (un mois), violations (72 h), sous-traitants, preuves d'information et
// analyses d'impact. Les échéances sont calculées par la base ; l'écran ne fait que les montrer.

const fr = (d) => (d ? new Date(String(d).length === 10 ? `${d}T12:00:00` : d).toLocaleDateString('fr-FR') : '—')
const frh = (d) => (d ? new Date(d).toLocaleString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—')
const STATUT_TR = { a_revoir: ['warning', 'À revoir'], valide: ['success', 'Validé'], archive: ['neutral', 'Archivé'] }
const AIPD = { requise: 'Requise', recommandee: 'Recommandée', non_requise: 'Non requise' }
const DROITS = { acces: 'Accès', rectification: 'Rectification', effacement: 'Effacement', limitation: 'Limitation', opposition: 'Opposition', portabilite: 'Portabilité' }
const STATUT_DEM = { recue: ['warning', 'Reçue'], en_cours: ['info', 'En cours'], repondue: ['success', 'Répondue'], refusee: ['neutral', 'Refusée'] }
const TRANSFERT = { aucun: 'Aucun', adequation: 'Pays adéquat', dpf: 'Data Privacy Framework', clauses_types: 'Clauses types', a_verifier: 'À vérifier' }
const NATURES = { confidentialite: 'Confidentialité', integrite: 'Intégrité', disponibilite: 'Disponibilité' }
const RISQUES = { aucun: 'Aucun risque', risque: 'Risque', eleve: 'Risque élevé' }
const MODES = { main_propre: 'Remise en main propre', email: 'Email', affichage: 'Affichage', portail: 'Portail', courrier: 'Courrier', autre: 'Autre' }
const CRITERES = {
  evaluation: 'Évaluation ou notation', decision_auto: 'Décision automatique', surveillance: 'Surveillance systématique',
  sensibles: 'Données sensibles', grande_echelle: 'Grande échelle', croisement: 'Croisement de données',
  vulnerables: 'Personnes vulnérables (dont salariés)', innovant: 'Usage innovant', exclusion: 'Empêche d\'exercer un droit',
}

const joursAvant = (d) => (d ? Math.ceil((new Date(String(d).length === 10 ? `${d}T23:59:59` : d) - new Date()) / 86400000) : null)
const heuresAvant = (d) => (d ? Math.round((new Date(d) - new Date()) / 3600000) : null)

// Champs de chaque fiche : { k, label, type: text | textarea | date | datetime | select | tags | multi | bool | number, options }
const CHAMPS = {
  traitement: [
    { k: 'nom_traitement', label: 'Traitement', type: 'text', requis: true },
    { k: 'finalite', label: 'Finalité', type: 'textarea', requis: true },
    { k: 'base_legale', label: 'Base légale', type: 'text', requis: true },
    { k: 'base_legale_article', label: 'Article ou texte', type: 'text' },
    { k: 'categories_personnes', label: 'Personnes concernées', type: 'tags' },
    { k: 'categories_donnees', label: 'Données', type: 'tags' },
    { k: 'donnees_sensibles', label: 'Données sensibles', type: 'tags' },
    { k: 'destinataires', label: 'Destinataires', type: 'tags' },
    { k: 'sous_traitants', label: 'Sous-traitants', type: 'multi', options: 'sous_traitants' },
    { k: 'transfert_hors_ue', label: 'Transfert hors de l\'Union européenne', type: 'bool' },
    { k: 'garanties_transfert', label: 'Garanties du transfert', type: 'text' },
    { k: 'duree_conservation', label: 'Durée de conservation', type: 'textarea' },
    { k: 'mesures_securite', label: 'Mesures de sécurité', type: 'textarea' },
    { k: 'aipd', label: 'Analyse d\'impact', type: 'select', options: AIPD },
    { k: 'notes', label: 'Notes', type: 'textarea' },
  ],
  demande: [
    { k: 'nom', label: 'Personne', type: 'text', requis: true },
    { k: 'email', label: 'Email', type: 'text' },
    { k: 'personne_type', label: 'Elle est', type: 'select', options: { stagiaire: 'Stagiaire', contact: 'Contact client', prospect: 'Prospect', salarie: 'Salarié', formateur: 'Formateur', autre: 'Autre' } },
    { k: 'droit', label: 'Droit exercé', type: 'select', options: DROITS, requis: true },
    { k: 'canal', label: 'Reçue par', type: 'text' },
    { k: 'recue_le', label: 'Reçue le', type: 'date', requis: true },
    { k: 'identite_verifiee', label: 'Identité vérifiée (comment)', type: 'text' },
    { k: 'statut', label: 'Statut', type: 'select', options: Object.fromEntries(Object.entries(STATUT_DEM).map(([k, v]) => [k, v[1]])) },
    { k: 'actions', label: 'Actions faites', type: 'textarea' },
    { k: 'prolongee', label: 'Délai prolongé de deux mois (demande complexe ou nombreuse)', type: 'bool' },
    { k: 'prolongation_motif', label: 'Motif de la prolongation', type: 'text' },
    { k: 'personne_prevenue_le', label: 'Personne prévenue de la prolongation le', type: 'date' },
    { k: 'reponse_le', label: 'Réponse envoyée le', type: 'date' },
  ],
  violation: [
    { k: 'decouverte_le', label: 'Découverte le', type: 'datetime', requis: true },
    { k: 'decouverte_par', label: 'Découverte par', type: 'text' },
    { k: 'description', label: 'Ce qui s\'est passé', type: 'textarea', requis: true },
    { k: 'nature', label: 'Nature', type: 'multi', options: NATURES },
    { k: 'categories', label: 'Données et personnes touchées', type: 'textarea' },
    { k: 'personnes_nb', label: 'Nombre approximatif de personnes', type: 'number' },
    { k: 'consequences', label: 'Conséquences probables', type: 'textarea' },
    { k: 'mesures', label: 'Mesures prises', type: 'textarea' },
    { k: 'risque', label: 'Niveau de risque', type: 'select', options: RISQUES },
    { k: 'risque_justification', label: 'Justification du niveau de risque', type: 'textarea' },
    { k: 'notifiee_le', label: 'Notifiée à la CNIL le', type: 'datetime' },
    { k: 'numero_notification', label: 'Numéro de notification', type: 'text' },
    { k: 'personnes_informees_le', label: 'Personnes informées le', type: 'datetime' },
    { k: 'motif_non_notification', label: 'Motif de non-notification', type: 'textarea' },
    { k: 'statut', label: 'Statut', type: 'select', options: { ouverte: 'Ouverte', close: 'Close' } },
  ],
  sous_traitant: [
    { k: 'nom', label: 'Sous-traitant', type: 'text', requis: true },
    { k: 'role', label: 'Rôle', type: 'text' },
    { k: 'pays_siege', label: 'Pays du siège', type: 'text' },
    { k: 'hebergement', label: 'Hébergement des données', type: 'text' },
    { k: 'transfert', label: 'Garantie de transfert', type: 'select', options: TRANSFERT },
    { k: 'dpa_url', label: 'Lien vers le contrat (DPA)', type: 'text' },
    { k: 'contrat_signe_le', label: 'Contrat signé le', type: 'date' },
    { k: 'notes', label: 'Notes', type: 'textarea' },
    { k: 'actif', label: 'Utilisé', type: 'bool' },
  ],
  information: [
    { k: 'notice_titre', label: 'Notice', type: 'text', requis: true },
    { k: 'notice_version', label: 'Version', type: 'text' },
    { k: 'traitement_id', label: 'Traitement', type: 'select', options: 'traitements' },
    { k: 'destinataires', label: 'Remise à', type: 'text' },
    { k: 'remise_le', label: 'Remise le', type: 'date', requis: true },
    { k: 'mode', label: 'Comment', type: 'select', options: MODES },
    { k: 'preuve_url', label: 'Preuve (lien)', type: 'text' },
    { k: 'notes', label: 'Notes', type: 'textarea' },
  ],
  aipd: [
    { k: 'titre', label: 'Analyse', type: 'text', requis: true },
    { k: 'traitement_id', label: 'Traitement', type: 'select', options: 'traitements' },
    { k: 'criteres', label: 'Critères du CEPD (deux ou plus : analyse requise)', type: 'multi', options: CRITERES },
    { k: 'conclusion', label: 'Conclusion', type: 'select', options: AIPD },
    { k: 'justification', label: 'Justification', type: 'textarea' },
    { k: 'description', label: 'Description du traitement', type: 'textarea' },
    { k: 'necessite', label: 'Nécessité et proportionnalité', type: 'textarea' },
    { k: 'risques', label: 'Risques', type: 'textarea' },
    { k: 'mesures', label: 'Mesures', type: 'textarea' },
    { k: 'avis', label: 'Avis', type: 'textarea' },
    { k: 'statut', label: 'Statut', type: 'select', options: { brouillon: 'Brouillon', validee: 'Validée' } },
    { k: 'revision_le', label: 'Révision prévue le', type: 'date' },
  ],
}

const TABLES = { traitement: 'rgpd_traitements', demande: 'rgpd_demandes', violation: 'rgpd_violations', sous_traitant: 'rgpd_sous_traitants', information: 'rgpd_informations', aipd: 'rgpd_aipd' }
const TITRES = { traitement: 'Traitement', demande: 'Demande', violation: 'Violation', sous_traitant: 'Sous-traitant', information: 'Preuve d\'information', aipd: 'Analyse d\'impact' }

const versLocal = (v) => {
  if (!v) return ''
  const d = new Date(v)
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}

function FicheSheet({ kind, ligne, options, onClose, onSaved, peut }) {
  const champs = CHAMPS[kind]
  const [f, setF] = useState(() => Object.fromEntries(champs.map((c) => {
    const v = ligne?.[c.k]
    if (c.type === 'tags') return [c.k, (v || []).join(', ')]
    if (c.type === 'multi') return [c.k, v || []]
    if (c.type === 'bool') return [c.k, c.k === 'actif' ? v !== false : !!v]
    if (c.type === 'datetime') return [c.k, versLocal(v || (c.k === 'decouverte_le' && !ligne ? new Date() : null))]
    if (c.type === 'date') return [c.k, v || (c.requis && !ligne ? new Date().toISOString().slice(0, 10) : '')]
    return [c.k, v ?? '']
  })))
  const [busy, setBusy] = useState(false)
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }))

  const ligneSql = () => {
    const out = {}
    for (const c of champs) {
      const v = f[c.k]
      if (c.type === 'tags') out[c.k] = String(v || '').split(',').map((x) => x.trim()).filter(Boolean)
      else if (c.type === 'multi' || c.type === 'bool') out[c.k] = v
      else if (c.type === 'number') out[c.k] = v === '' ? null : Number(v)
      else if (c.type === 'datetime') out[c.k] = v ? new Date(v).toISOString() : null
      else out[c.k] = v === '' ? null : v
    }
    return out
  }

  const enregistrer = async (extra = {}) => {
    const manque = champs.find((c) => c.requis && (f[c.k] === '' || f[c.k] == null))
    if (manque) return toast.error(`${manque.label} : à remplir`)
    setBusy(true)
    const donnees = { ...ligneSql(), ...extra }
    const r = ligne?.id ? await supabase.from(TABLES[kind]).update(donnees).eq('id', ligne.id) : await supabase.from(TABLES[kind]).insert(donnees)
    setBusy(false)
    if (r.error) return toast.error(r.error.message.includes('prolongation') ? 'Indiquez le motif de la prolongation' : r.error.message)
    toast.success('Enregistré')
    onSaved()
    onClose()
  }

  const opts = (c) => (typeof c.options === 'string' ? options[c.options] || {} : c.options)

  return (
    <Sheet title={ligne?.id ? `${TITRES[kind]} · ${ligne.nom_traitement || ligne.nom || ligne.notice_titre || ligne.titre || frh(ligne.decouverte_le)}` : `Nouveau : ${TITRES[kind].toLowerCase()}`}
      onClose={onClose} size="lg"
      footer={peut ? <>
        {kind === 'traitement' && ligne?.id && ligne.statut !== 'archive' && <button type="button" className="btn btn-ghost mr-auto" disabled={busy}
          onClick={async () => { if (await confirmer('Archiver ce traitement ? Il ne figurera plus au registre exporté.')) enregistrer({ statut: 'archive' }) }}>Archiver</button>}
        {kind === 'traitement' && ligne?.statut === 'archive' && <button type="button" className="btn btn-ghost mr-auto" disabled={busy} onClick={() => enregistrer({ statut: 'a_revoir' })}>Remettre au registre</button>}
        <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>Annuler</button>
        {kind === 'traitement' && ligne?.statut !== 'valide' && <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => enregistrer({ statut: 'valide' })}>Enregistrer et valider</button>}
        <button type="button" className="btn btn-primary" onClick={() => enregistrer()} disabled={busy}>{busy && <Loader2 className="w-4 h-4 animate-spin" />}Enregistrer</button>
      </> : <button type="button" className="btn btn-secondary" onClick={onClose}>Fermer</button>}>
      {kind === 'traitement' && ligne?.origine === 'modele' && ligne.statut === 'a_revoir' && (
        <Banner tone="info">Proposé par l'outil à partir des modules actifs : relisez, adaptez à votre organisation, puis validez.</Banner>
      )}
      <div className="grid sm:grid-cols-2 gap-3">
        {champs.map((c) => {
          const id = `cf-${kind}-${c.k}`
          const large = ['textarea', 'tags', 'multi'].includes(c.type) || c.k === 'nom_traitement' || c.k === 'notice_titre' || c.k === 'titre' || c.k === 'description'
          return (
            <div key={c.k} className={large ? 'sm:col-span-2' : ''}>
              {c.type === 'bool' ? (
                <label className="inline-flex items-center gap-2 text-ui"><input type="checkbox" checked={!!f[c.k]} disabled={!peut} onChange={(e) => set(c.k, e.target.checked)} />{c.label}</label>
              ) : <>
                <label className="label" htmlFor={id}>{c.label}{c.requis ? ' *' : ''}</label>
                {c.type === 'textarea' && <textarea id={id} className="input min-h-[72px]" value={f[c.k]} disabled={!peut} onChange={(e) => set(c.k, e.target.value)} />}
                {['text', 'date', 'number'].includes(c.type) && <input id={id} type={c.type === 'text' ? 'text' : c.type} className="input" value={f[c.k]} disabled={!peut} onChange={(e) => set(c.k, e.target.value)} />}
                {c.type === 'datetime' && <input id={id} type="datetime-local" className="input" value={f[c.k]} disabled={!peut} onChange={(e) => set(c.k, e.target.value)} />}
                {c.type === 'tags' && <input id={id} className="input" value={f[c.k]} disabled={!peut} placeholder="Séparés par des virgules" onChange={(e) => set(c.k, e.target.value)} />}
                {c.type === 'select' && (
                  <select id={id} className="select" value={f[c.k] || ''} disabled={!peut} onChange={(e) => set(c.k, e.target.value)}>
                    <option value="">—</option>
                    {Object.entries(opts(c)).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                )}
                {c.type === 'multi' && (
                  <div className="flex flex-wrap gap-x-4 gap-y-1.5">
                    {Object.entries(opts(c)).map(([k, v]) => (
                      <label key={k} className="inline-flex items-center gap-1.5 text-ui">
                        <input type="checkbox" checked={(f[c.k] || []).includes(k)} disabled={!peut}
                          onChange={(e) => set(c.k, e.target.checked ? [...(f[c.k] || []), k] : (f[c.k] || []).filter((x) => x !== k))} />{v}
                      </label>
                    ))}
                  </div>
                )}
              </>}
            </div>
          )
        })}
      </div>
    </Sheet>
  )
}

export default function Conformite() {
  const can = useAuthStore((s) => s.can)
  const d = {
    registre: can('conformite.rgpd.gerer') !== false,
    demandes: can('conformite.demandes.gerer') !== false,
    violations: can('conformite.violations.gerer') !== false,
    purges: can('conformite.purges.valider') !== false,
  }
  const [onglet, setOnglet] = useState('registre')
  const [data, setData] = useState({})
  const [erreur, setErreur] = useState(null)
  const [fiche, setFiche] = useState(null) // { kind, ligne }
  const [archives, setArchives] = useState(false)
  const [busy, setBusy] = useState(false)

  const charger = useCallback(async () => {
    const lire = (t, ordre, asc = true) => supabase.from(t).select('*').order(ordre, { ascending: asc }).limit(1000)
    const [tr, st, de, vi, inf, ai] = await Promise.all([
      lire('rgpd_traitements', 'nom_traitement'), lire('rgpd_sous_traitants', 'nom'), lire('rgpd_demandes', 'recue_le', false),
      lire('rgpd_violations', 'decouverte_le', false), lire('rgpd_informations', 'remise_le', false), lire('rgpd_aipd', 'created_at', false),
    ])
    if (st.error && tr.error) { setErreur('La conformité RGPD n\'est pas encore disponible sur cette instance (migration 0340).'); setData({}); return }
    const [pr, pp] = await Promise.all([lire('rgpd_purge_regles', 'cle'), lire('rgpd_purge_passages', 'cree_le', false)])
    setData({ traitements: tr.data || [], sous_traitants: st.data || [], demandes: de.data || [], violations: vi.data || [], informations: inf.data || [], aipd: ai.data || [],
      purge_regles: pr.error ? [] : pr.data || [], purge_passages: pp.error ? [] : pp.data || [] })
  }, [])
  useEffect(() => { charger() }, [charger])

  const options = useMemo(() => ({
    sous_traitants: Object.fromEntries((data.sous_traitants || []).map((s) => [s.cle, s.nom])),
    traitements: Object.fromEntries((data.traitements || []).filter((t) => t.statut !== 'archive').map((t) => [t.id, t.nom_traitement])),
  }), [data])

  const traitements = (data.traitements || []).filter((t) => archives || t.statut !== 'archive')
  const aRevoir = (data.traitements || []).filter((t) => t.statut === 'a_revoir').length
  const demandesOuvertes = (data.demandes || []).filter((x) => ['recue', 'en_cours'].includes(x.statut))
  const violationsOuvertes = (data.violations || []).filter((x) => x.statut === 'ouverte')

  const proposer = async () => {
    setBusy(true)
    const { data: n, error } = await supabase.rpc('rgpd_proposer_modeles')
    setBusy(false)
    if (error) return toast.error(error.message)
    toast.success(n ? `${n} traitement${n > 1 ? 's' : ''} proposé${n > 1 ? 's' : ''} (à revoir)` : 'Registre déjà à jour avec les modules actifs')
    charger()
  }
  const exporter = async () => {
    try {
      const ORG = await loadPdfOrg()
      buildRegistreRgpdPDF(ORG, data.traitements || [], data.sous_traitants || []).save('registre-traitements.pdf')
    } catch (e) { toast.error(e.message) }
  }

  const ouvrir = (kind, ligne = null) => setFiche({ kind, ligne })

  const colonnes = {
    registre: [
      { key: 'nom', label: 'Traitement', mobile: 'title', render: (t) => t.nom_traitement },
      { key: 'base', label: 'Base légale', mobile: 'subtitle', render: (t) => t.base_legale },
      { key: 'sens', label: 'Données sensibles', render: (t) => (t.donnees_sensibles || []).join(', ') || '—' },
      { key: 'duree', label: 'Conservation', render: (t) => <span className="line-clamp-2">{t.duree_conservation || '—'}</span> },
      { key: 'statut', label: 'Statut', mobile: 'aside', render: (t) => <StatusBadge tone={STATUT_TR[t.statut]?.[0]}>{STATUT_TR[t.statut]?.[1] || t.statut}</StatusBadge> },
    ],
    demandes: [
      { key: 'nom', label: 'Personne', mobile: 'title', render: (x) => x.nom },
      { key: 'droit', label: 'Droit', mobile: 'subtitle', render: (x) => DROITS[x.droit] },
      { key: 'recue', label: 'Reçue le', render: (x) => fr(x.recue_le) },
      { key: 'echeance', label: 'Répondre avant le', render: (x) => {
        const j = joursAvant(x.echeance)
        const ouverte = ['recue', 'en_cours'].includes(x.statut)
        return <span>{fr(x.echeance)}{ouverte && j != null && <StatusBadge className="ml-2" tone={j < 0 ? 'danger' : j <= 10 ? 'warning' : 'neutral'}>{j < 0 ? `${-j} j de retard` : `${j} j`}</StatusBadge>}</span>
      } },
      { key: 'statut', label: 'Statut', mobile: 'aside', render: (x) => <StatusBadge tone={STATUT_DEM[x.statut][0]}>{STATUT_DEM[x.statut][1]}</StatusBadge> },
    ],
    violations: [
      { key: 'quand', label: 'Découverte', mobile: 'title', render: (x) => frh(x.decouverte_le) },
      { key: 'desc', label: 'Ce qui s\'est passé', mobile: 'subtitle', render: (x) => <span className="line-clamp-2">{x.description}</span> },
      { key: 'risque', label: 'Risque', render: (x) => RISQUES[x.risque] || 'À évaluer' },
      { key: 'cnil', label: 'Notification CNIL', render: (x) => {
        if (x.notifiee_le) return `Notifiée le ${frh(x.notifiee_le)}`
        if (x.risque === 'aucun' || x.statut === 'close') return 'Non notifiée (justifiée)'
        const h = heuresAvant(x.echeance_notification)
        return <StatusBadge tone={h < 0 ? 'danger' : h <= 24 ? 'warning' : 'info'}>{h < 0 ? `Délai de 72 h dépassé de ${-h} h` : `${h} h restantes`}</StatusBadge>
      } },
      { key: 'statut', label: 'Statut', mobile: 'aside', render: (x) => <StatusBadge tone={x.statut === 'ouverte' ? 'warning' : 'neutral'}>{x.statut === 'ouverte' ? 'Ouverte' : 'Close'}</StatusBadge> },
    ],
    sous_traitants: [
      { key: 'nom', label: 'Sous-traitant', mobile: 'title', render: (s) => s.nom },
      { key: 'role', label: 'Rôle', mobile: 'subtitle', render: (s) => s.role || '—' },
      { key: 'heb', label: 'Hébergement', render: (s) => s.hebergement || '—' },
      { key: 'tr', label: 'Transfert', render: (s) => TRANSFERT[s.transfert] || s.transfert },
      { key: 'contrat', label: 'Contrat', mobile: 'aside', render: (s) => (s.contrat_signe_le ? <StatusBadge tone="success">Signé le {fr(s.contrat_signe_le)}</StatusBadge> : <StatusBadge tone="warning">À signer</StatusBadge>) },
    ],
    informations: [
      { key: 'notice', label: 'Notice', mobile: 'title', render: (x) => [x.notice_titre, x.notice_version].filter(Boolean).join(' · ') },
      { key: 'qui', label: 'Remise à', mobile: 'subtitle', render: (x) => x.destinataires || '—' },
      { key: 'quand', label: 'Le', render: (x) => fr(x.remise_le) },
      { key: 'mode', label: 'Comment', mobile: 'aside', render: (x) => MODES[x.mode] || x.mode },
    ],
    aipd: [
      { key: 'titre', label: 'Analyse', mobile: 'title', render: (x) => x.titre },
      { key: 'crit', label: 'Critères', render: (x) => `${(x.criteres || []).length} / 9` },
      { key: 'concl', label: 'Conclusion', mobile: 'subtitle', render: (x) => AIPD[x.conclusion] || 'À conclure' },
      { key: 'statut', label: 'Statut', mobile: 'aside', render: (x) => <StatusBadge tone={x.statut === 'validee' ? 'success' : 'warning'}>{x.statut === 'validee' ? 'Validée' : 'Brouillon'}</StatusBadge> },
    ],
  }

  const onglets = [
    d.registre && { id: 'registre', label: 'Registre', count: aRevoir || null },
    d.demandes && { id: 'demandes', label: 'Demandes', count: demandesOuvertes.length || null },
    d.violations && { id: 'violations', label: 'Violations', count: violationsOuvertes.length || null },
    d.registre && { id: 'sous_traitants', label: 'Sous-traitants' },
    d.registre && { id: 'informations', label: 'Information des personnes' },
    d.registre && { id: 'aipd', label: 'Analyses d\'impact' },
    (d.purges || d.registre) && { id: 'purges', label: 'Durées et purges', count: (data.purge_passages || []).filter((p) => p.statut === 'a_valider').length || null },
  ].filter(Boolean)
  const actif = onglets.some((o) => o.id === onglet) ? onglet : onglets[0]?.id
  const kindOnglet = { registre: 'traitement', demandes: 'demande', violations: 'violation', sous_traitants: 'sous_traitant', informations: 'information', aipd: 'aipd' }
  const lignes = { registre: traitements, demandes: data.demandes, violations: data.violations, sous_traitants: data.sous_traitants, informations: data.informations, aipd: data.aipd }
  const vides = {
    registre: 'Proposez les traitements de vos modules actifs avec « Mettre à jour depuis les modules ».',
    demandes: 'Une demande d\'accès, de rectification ou d\'effacement reçue par email, courrier ou téléphone s\'enregistre ici : la réponse est due sous un mois.',
    violations: 'Toute violation de données (perte, vol, accès non autorisé) s\'inscrit ici, même sans notification : la CNIL doit être prévenue sous 72 h s\'il y a un risque.',
    sous_traitants: 'Les services utilisés par l\'outil apparaissent ici.',
    informations: 'Enregistrez ici chaque notice d\'information remise (salariés, stagiaires, prospects) et sa preuve.',
    aipd: 'Une analyse d\'impact est nécessaire quand au moins deux critères du CEPD sont réunis (par exemple suivi des véhicules en direct).',
  }

  const decider = async (passage, decision) => {
    const question = decision === 'executer'
      ? `${passage.nb} ligne${passage.nb > 1 ? 's' : ''} seront ${regleDe(passage)?.action === 'anonymiser' ? 'anonymisées' : 'supprimées'} définitivement. Continuer ?`
      : 'Ignorer ce passage ? Il sera proposé de nouveau la nuit prochaine si les lignes sont toujours concernées.'
    if (!(await confirmer(question))) return
    const { data: r, error } = await supabase.rpc('rgpd_purge_decider', { p_passage: passage.id, p_decision: decision })
    if (error) return toast.error(error.message)
    toast.success(decision === 'executer' ? `${r?.traites ?? 0} ligne(s) traitée(s)` : 'Passage ignoré')
    charger()
  }
  const regleDe = (passage) => (data.purge_regles || []).find((r) => r.id === passage.regle_id)
  const majRegle = async (regle, patch) => {
    const { error } = await supabase.from('rgpd_purge_regles').update(patch).eq('id', regle.id)
    if (error) return toast.error(error.message.includes('delai') ? `Délai minimum : ${regle.delai_minimum} mois` : error.message)
    charger()
  }

  if (onglets.length === 0) return <Banner tone="warning">Cette page demande un droit de conformité (registre, demandes ou violations).</Banner>

  return (
    <div className="space-y-4">
      <PageHeader title="Conformité RGPD" meta={<span>Registre de la société, demandes des personnes, violations et preuves.</span>}
        actions={actif === 'registre' && d.registre && <div className="flex flex-wrap gap-2">
          <button type="button" className="btn btn-secondary" onClick={exporter}><FileDown className="w-4 h-4" />Exporter le registre</button>
          <button type="button" className="btn btn-secondary" onClick={proposer} disabled={busy}>{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}Mettre à jour depuis les modules</button>
        </div>} />
      {erreur && <Banner tone="warning">{erreur}</Banner>}
      {violationsOuvertes.some((v) => !v.notifiee_le && v.risque !== 'aucun' && heuresAvant(v.echeance_notification) <= 24) && (
        <Banner tone="danger">Une violation ouverte arrive au délai de 72 h : évaluez le risque et notifiez la CNIL si nécessaire (cnil.fr, téléservice de notification).</Banner>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <Tabs tabs={onglets} value={actif} onChange={setOnglet} visible={7} />
        {actif === 'registre' && <label className="ml-auto inline-flex items-center gap-2 text-ui-sm text-gray-600">
          <input type="checkbox" checked={archives} onChange={(e) => setArchives(e.target.checked)} />Afficher les archivés
        </label>}
        {actif !== 'purges' && <button type="button" className={`btn btn-primary btn-sm ${actif === 'registre' ? '' : 'ml-auto'}`} onClick={() => ouvrir(kindOnglet[actif])}>
          <Plus className="w-4 h-4" />{actif === 'violations' ? 'Déclarer une violation' : actif === 'demandes' ? 'Nouvelle demande' : 'Ajouter'}
        </button>}
      </div>
      {actif === 'purges' ? (
        <div className="space-y-4">
          <div className="card p-4 space-y-2">
            <div className="font-semibold">Passages à valider</div>
            <p className="text-ui-sm text-gray-500">Préparés chaque nuit : rien n'est supprimé ni anonymisé sans votre décision. Les lignes sont recalculées au moment d'exécuter.</p>
            {(data.purge_passages || []).filter((p) => p.statut === 'a_valider').length === 0
              ? <div className="text-ui-sm text-gray-600">Aucun passage à valider.</div>
              : (data.purge_passages || []).filter((p) => p.statut === 'a_valider').map((p) => (
                <div key={p.id} className="flex flex-wrap items-center gap-3 border-t border-gray-100 pt-2">
                  <div className="flex-1 min-w-0">
                    <div className="font-medium">{regleDe(p)?.libelle || p.cle} : {p.nb} ligne{p.nb > 1 ? 's' : ''}</div>
                    <div className="text-ui-sm text-gray-500">{regleDe(p)?.objet} · préparé le {fr(p.cree_le)}</div>
                  </div>
                  {d.purges && <>
                    <button type="button" className="btn btn-secondary btn-sm" onClick={() => decider(p, 'ignorer')}>Ignorer</button>
                    <button type="button" className="btn btn-danger btn-sm" onClick={() => decider(p, 'executer')}>{regleDe(p)?.action === 'anonymiser' ? 'Anonymiser' : 'Supprimer'}</button>
                  </>}
                </div>
              ))}
          </div>
          <div className="card p-4 space-y-2">
            <div className="font-semibold">Règles de conservation</div>
            {(data.purge_regles || []).map((r) => (
              <div key={r.id} className="flex flex-wrap items-center gap-3 border-t border-gray-100 pt-2">
                <div className="flex-1 min-w-0">
                  <div className="font-medium">{r.libelle}</div>
                  <div className="text-ui-sm text-gray-500">{r.objet}{r.derniere_validation_le ? ` · dernière purge validée le ${fr(r.derniere_validation_le)}` : ''}</div>
                </div>
                <label className="text-ui-sm text-gray-600 inline-flex items-center gap-1.5">Délai
                  <input type="number" min={r.delai_minimum} className="input w-20" defaultValue={r.delai_mois} disabled={!(d.purges || d.registre)}
                    onBlur={(e) => { const v = parseInt(e.target.value, 10); if (v && v !== r.delai_mois) majRegle(r, { delai_mois: v }) }} />mois
                </label>
                <label className="text-ui-sm text-gray-600 inline-flex items-center gap-1.5">
                  <input type="checkbox" checked={r.active} disabled={!(d.purges || d.registre)} onChange={(e) => majRegle(r, { active: e.target.checked })} />Active
                </label>
              </div>
            ))}
            {(data.purge_regles || []).length === 0 && <div className="text-ui-sm text-gray-600">Les règles de conservation apparaîtront après la migration 0344.</div>}
          </div>
        </div>
      ) : (
      <div className="card">
        <DataTable columns={colonnes[actif]} rows={lignes[actif] || []} loading={!data.traitements && !erreur} onRowClick={(l) => ouvrir(kindOnglet[actif], l)}
          caption={onglets.find((o) => o.id === actif)?.label}
          empty={<EmptyState icon={ShieldCheck} title="Rien pour l'instant" compact>{vides[actif]}</EmptyState>} />
      </div>
      )}
      {fiche && <FicheSheet kind={fiche.kind} ligne={fiche.ligne} options={options} onClose={() => setFiche(null)} onSaved={charger}
        peut={fiche.kind === 'demande' ? d.demandes : fiche.kind === 'violation' ? d.violations : d.registre} />}
    </div>
  )
}
