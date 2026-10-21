// Onglet « Certifications » : chaque référentiel (Qualiopi, déclaration d'activité, APSAD…) avec le statut de la
// société, ses dates d'audit et de validité, et l'import du texte d'un référentiel payant depuis son exemplaire.

import { useCallback, useEffect, useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import { Loader2, Pencil, Upload, ExternalLink } from 'lucide-react'
import { DueBadge } from '../components/ui'
import { frDate } from '../lib/certData'
import {
  NATURES, SOURCES_TEXTE, STATUTS, CHAMPS_CERTIF, statut, certValide, prochaineEcheance, lireExigences,
  chargerCertifications, enregistrerCertification, importerTexte,
} from '../lib/certSociete'

export function FormCertif({ refe, certif, onFini }) {
  const [v, setV] = useState(() => ({ statut: certif?.statut || 'visee', ...Object.fromEntries(CHAMPS_CERTIF.map((c) => [c.k, certif?.[c.k] || ''])) }))
  const [busy, setBusy] = useState(false)
  const maj = (k, x) => setV((o) => ({ ...o, [k]: x }))
  const enregistrer = async (e) => {
    e.preventDefault()
    setBusy(true)
    try {
      await enregistrerCertification(refe.code, certif, v)
      toast.success('Certification enregistrée')
      onFini(true)
    } catch (err) { toast.error(err.message || String(err)) }
    setBusy(false)
  }
  return (
    <form onSubmit={enregistrer} className="space-y-3 border-t hairline pt-3">
      <label className="block">
        <span className="label">Où en êtes-vous ?</span>
        <select className="input" value={v.statut} onChange={(e) => maj('statut', e.target.value)}>
          {STATUTS.map((s) => <option key={s.v} value={s.v}>{s.label}</option>)}
        </select>
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        {CHAMPS_CERTIF.filter((c) => c.type !== 'textarea').map((c) => (
          <label key={c.k} className="block">
            <span className="label">{c.label}</span>
            <input className="input" type={c.type} value={v[c.k] || ''} onChange={(e) => maj(c.k, e.target.value)} />
          </label>
        ))}
      </div>
      {CHAMPS_CERTIF.filter((c) => c.type === 'textarea').map((c) => (
        <label key={c.k} className="block">
          <span className="label">{c.label}</span>
          <textarea className="input" rows={2} value={v[c.k] || ''} onChange={(e) => maj(c.k, e.target.value)} />
        </label>
      ))}
      <div className="flex gap-2 justify-end">
        <button type="button" className="btn btn-secondary" onClick={() => onFini(false)}>Annuler</button>
        <button type="submit" className="btn btn-primary" disabled={busy}>Enregistrer</button>
      </div>
    </form>
  )
}

export function ImportTexte({ refe, copie, onFini }) {
  const [texte, setTexte] = useState('')
  const [busy, setBusy] = useState(false)
  const lues = useMemo(() => lireExigences(texte), [texte])
  const chapitres = new Set(lues.map((x) => x.chapitre)).size
  const importer = async () => {
    setBusy(true)
    try {
      await importerTexte(refe.code, lues)
      toast.success(`${lues.length} exigence${lues.length > 1 ? 's' : ''} importée${lues.length > 1 ? 's' : ''}`)
      onFini(true)
    } catch (err) { toast.error(err.message || String(err)) }
    setBusy(false)
  }
  return (
    <div className="space-y-3 border-t hairline pt-3">
      <p className="text-ui-sm text-gray-700">
        Collez le texte de votre exemplaire, une exigence par ligne. Une ligne qui commence par « # » ouvre un chapitre
        (par exemple « # 5 Organisation »). Séparez le numéro, le titre et le texte par un point-virgule :
        « 5.2 ; Contrat ; Le prestataire établit un contrat… ». Le texte reste propre à votre société.
      </p>
      {copie?.exigences > 0 && (
        <p className="text-ui-sm text-[rgb(var(--c-warning))]">Un texte est déjà importé ({copie.exigences} exigences) : il sera remplacé.</p>
      )}
      <textarea className="input font-mono text-ui-sm" rows={8} value={texte} onChange={(e) => setTexte(e.target.value)}
        aria-label={`Texte du référentiel ${refe.label}`} />
      <div className="flex items-center gap-2 justify-between flex-wrap">
        <span className="text-ui-sm muted">{lues.length ? `${lues.length} exigence${lues.length > 1 ? 's' : ''} dans ${chapitres} chapitre${chapitres > 1 ? 's' : ''}` : 'Rien à importer pour l\'instant'}</span>
        <div className="flex gap-2">
          <button type="button" className="btn btn-secondary" onClick={() => onFini(false)}>Annuler</button>
          <button type="button" className="btn btn-primary" disabled={busy || !lues.length} onClick={importer}>Importer</button>
        </div>
      </div>
    </div>
  )
}

export default function CertSociete({ canWrite, settings }) {
  const [data, setData] = useState(null)
  const [ouvert, setOuvert] = useState(null) // { code, mode: 'certif' | 'import' }
  const [erreur, setErreur] = useState(null)

  const charger = useCallback(async () => {
    try { setData(await chargerCertifications()) } catch (e) { setErreur(e.message || String(e)) }
  }, [])
  useEffect(() => { charger() }, [charger])

  if (erreur) return <div className="card text-[rgb(var(--c-danger))]">Impossible de charger les certifications : {erreur}</div>
  if (!data) return <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>

  // Référentiels communs, avec la copie importée par la société s'il y en a une ; puis les référentiels propres
  const communs = data.refs.filter((r) => !r.company_id)
  const copieDe = (r) => data.refs.find((x) => x.company_id && x.code.startsWith(`${r.code}-`))
  const propres = data.refs.filter((r) => r.company_id && !communs.some((c) => r.code.startsWith(`${c.code}-`)))
  const lignes = [...communs, ...propres]
  const fini = (recharger) => { setOuvert(null); if (recharger) charger() }

  return (
    <div className="space-y-3">
      <p className="text-ui-sm text-gray-600">
        Une ligne par certification que vous avez ou visez : où vous en êtes, les dates d'audit et la validité.
        Les documents réservés aux certifiés ne sont produits que si la certification est obtenue et en cours de validité.
      </p>
      {lignes.map((r) => {
        const certif = data.certifs.find((c) => c.referential_code === r.code)
        const copie = copieDe(r)
        const ech = prochaineEcheance(certif)
        const st = statut(certif?.statut)
        const estOuvert = ouvert?.code === r.code
        return (
          <section key={r.code} className="card space-y-2">
            <div className="flex items-start gap-3 flex-wrap">
              <div className="flex-1 min-w-0">
                <h2 className="section-title">{r.label}</h2>
                <p className="text-ui-sm muted">
                  {[NATURES[r.kind], r.issuer, SOURCES_TEXTE[r.text_source]].filter(Boolean).join(' · ')}
                </p>
              </div>
              <span className={`badge ${certif ? st.badge : 'badge-neutral'}`}>{certif ? st.label : 'Non suivie'}</span>
              {certValide(certif) && <span className="badge badge-success">Valide</span>}
            </div>
            {!certif && r.kind === 'qualiopi' && settings?.referential_code === r.code && (settings.certified_at || settings.certifier_name) && (
              <p className="text-ui-sm text-gray-700">
                Onglet Qualiopi : {settings.certified_at ? `certifié depuis le ${frDate(settings.certified_at)}` : 'avant l\'audit initial'}
                {settings.certifier_name ? `, ${settings.certifier_name}` : ''}. Cliquez sur « Suivre cette certification » pour les dates d'audit et la validité.
              </p>
            )}
            {certif && (
              <p className="text-ui-sm text-gray-700">
                {[certif.certificateur, certif.numero ? `n° ${certif.numero}` : null,
                  certif.valable_jusqu_au ? `valable jusqu'au ${frDate(certif.valable_jusqu_au)}` : null].filter(Boolean).join(', ') || 'Aucun détail saisi.'}
              </p>
            )}
            {ech && (
              <div className="flex items-center gap-2 text-ui-sm">
                <span className="text-gray-700">{ech.label} : {frDate(ech.d)}</span>
                <DueBadge date={ech.d} />
              </div>
            )}
            {r.text_source === 'a_saisir' && (
              <p className="text-ui-sm muted">
                {copie?.exigences ? `Texte de votre exemplaire importé : ${copie.exigences} exigences.` : 'Aucun texte importé : l\'outil ne fournit pas ce texte payant.'}
              </p>
            )}
            {!estOuvert && (
              <div className="flex gap-2 flex-wrap">
                {canWrite && (
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => setOuvert({ code: r.code, mode: 'certif' })}>
                    <Pencil className="w-4 h-4" aria-hidden="true" />{certif ? 'Modifier' : 'Suivre cette certification'}
                  </button>
                )}
                {canWrite && r.text_source === 'a_saisir' && (
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => setOuvert({ code: r.code, mode: 'import' })}>
                    <Upload className="w-4 h-4" aria-hidden="true" />{copie?.exigences ? 'Remplacer le texte' : 'Importer le texte'}
                  </button>
                )}
                {r.source_url && (
                  <a className="btn btn-ghost btn-sm" href={r.source_url} target="_blank" rel="noreferrer">
                    <ExternalLink className="w-4 h-4" aria-hidden="true" />Source
                  </a>
                )}
              </div>
            )}
            {estOuvert && ouvert.mode === 'certif' && <FormCertif refe={r} certif={certif} onFini={fini} />}
            {estOuvert && ouvert.mode === 'import' && <ImportTexte refe={r} copie={copie} onFini={fini} />}
          </section>
        )
      })}
    </div>
  )
}
