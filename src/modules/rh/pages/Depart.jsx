// Départ d'un salarié (0515) : date et motif, puis le bilan de tout ce qui sera fait, cases cochées par défaut ;
// rien n'est écrit avant « Confirmer le départ » (décisions de H du 08/11). Bandeau du départ en attente sur la fiche.
import { useState } from 'react'
import toast from 'react-hot-toast'
import { AlertTriangle, CheckCircle2, ListTodo, LogOut } from 'lucide-react'
import { Sheet } from '../../../ui/Sheet'
import { confirmer } from '../../../ui/Confirm'
import {
  MOTIFS_DEPART, CHOIX_DEFAUT, bilanDepart, enregistrerDepart, annulerDepart, erreurDepart, blocsBilan, casesUtiles,
  texteCompte, resumeDepart, frJour,
} from '../lib/rhDepart'

const aujourdhui = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Paris' })

const LIBELLES_CASES = {
  vehicules: 'Rendre le véhicule à la date de départ',
  absences: 'Annuler les absences qui commencent après le départ',
  actions: 'Créer une action de l\'équipe pour chaque point à reprendre',
  archiver: 'Archiver la fiche et couper le compte le lendemain du départ',
}

export function DepartSheet({ personne, nom, onClose, onSaved }) {
  const [jour, setJour] = useState(aujourdhui())
  const [motif, setMotif] = useState('')
  const [bilan, setBilan] = useState(null)
  const [choix, setChoix] = useState(CHOIX_DEFAUT)
  const [busy, setBusy] = useState(false)
  const erreur = erreurDepart(jour, motif)

  const voirBilan = async (e) => {
    e.preventDefault()
    if (erreur) { toast.error(erreur); return }
    setBusy(true)
    try { setBilan(await bilanDepart(personne.id, jour)); setChoix(CHOIX_DEFAUT) } catch (err) { toast.error(err.message) } finally { setBusy(false) }
  }
  const confirmer_ = async () => {
    setBusy(true)
    try {
      const r = await enregistrerDepart(personne.id, jour, motif.trim(), choix)
      toast.success(resumeDepart(r), { duration: 8000 })
      onSaved()
    } catch (err) { toast.error(err.message) } finally { setBusy(false) }
  }

  const blocs = blocsBilan(bilan)
  const cases = casesUtiles(bilan)
  const actif = (b) => !b.choix || choix[b.choix]

  const footer = bilan ? (
    <div className="flex gap-2 justify-end flex-wrap">
      <button type="button" className="btn btn-ghost" onClick={() => setBilan(null)} disabled={busy}>Retour</button>
      <button type="button" className="btn btn-primary" onClick={confirmer_} disabled={busy || !!bilan.bloquant}>
        <LogOut className="w-4 h-4" aria-hidden="true" />Confirmer le départ
      </button>
    </div>
  ) : (
    <div className="flex gap-2 justify-end flex-wrap">
      <button type="button" className="btn btn-ghost" onClick={onClose}>Annuler</button>
      <button type="submit" form="depart-form" className="btn btn-primary" disabled={busy}>Voir ce qui sera fait</button>
    </div>
  )

  return (
    <Sheet title={`Départ de ${nom}`} onClose={onClose} footer={footer}>
      {!bilan ? (
        <form id="depart-form" onSubmit={voirBilan} className="space-y-3">
          <p className="text-ui-sm muted">Rien n'est enregistré à cette étape : vous verrez d'abord tout ce que le départ va faire.</p>
          <label className="block"><span className="label">Dernier jour de la personne</span>
            <input type="date" className="input" value={jour} onChange={(e) => setJour(e.target.value)} required />
          </label>
          <label className="block"><span className="label">Motif du départ</span>
            <input className="input" list="motifs-depart" value={motif} maxLength={200} onChange={(e) => setMotif(e.target.value)} required
              placeholder="Choisissez ou écrivez le motif" />
            <datalist id="motifs-depart">{MOTIFS_DEPART.map((m) => <option key={m} value={m} />)}</datalist>
          </label>
        </form>
      ) : (
        <div className="space-y-3">
          <p className="text-ui">Dernier jour : <strong>{frJour(bilan.jour)}</strong> · Motif : <strong>{motif.trim()}</strong></p>
          {bilan.bloquant && (
            <p role="alert" className="text-ui text-[rgb(var(--c-danger))] flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 flex-none mt-0.5" aria-hidden="true" />{bilan.bloquant}
            </p>
          )}
          {bilan.depart_en_attente && (
            <p className="text-ui-sm text-[rgb(var(--c-warning))]">Un départ au {frJour(bilan.depart_en_attente.le)} est déjà enregistré : il sera remplacé.</p>
          )}
          {blocs.length === 0 && <p className="text-ui-sm muted">Aucun contrat en cours, véhicule, absence à venir, EPI ou affectation à venir sur cette fiche.</p>}
          {blocs.map((b) => (
            <section key={b.cle} className={actif(b) ? '' : 'opacity-50'}>
              <h3 className="text-ui font-medium flex items-center gap-2">
                {b.effet === 'fait' ? <CheckCircle2 className="w-4 h-4 flex-none" aria-hidden="true" /> : <ListTodo className="w-4 h-4 flex-none" aria-hidden="true" />}
                {b.titre}
              </h3>
              <ul className="ml-6 list-disc text-ui-sm">{b.lignes.map((l, i) => <li key={i} className="[overflow-wrap:anywhere]">{l}</li>)}</ul>
              {b.effet === 'action' && <p className="ml-6 text-ui-sm muted">{actif(b) ? 'Une action de l\'équipe est créée : rien n\'est réaffecté d\'office.' : 'Aucune action créée (case décochée).'}</p>}
            </section>
          ))}
          <section>
            <h3 className="text-ui font-medium">Compte de connexion</h3>
            <p className="text-ui-sm">{texteCompte(bilan.compte, choix.archiver)}</p>
          </section>
          <fieldset className="space-y-1 border-t pt-2">
            <legend className="text-ui font-medium">Ce que fait le départ</legend>
            {Object.keys(LIBELLES_CASES).filter((k) => cases[k]).map((k) => (
              <label key={k} className="flex items-start gap-2 text-ui min-h-[44px] py-1">
                <input type="checkbox" className="mt-1" checked={!!choix[k]} onChange={(e) => setChoix({ ...choix, [k]: e.target.checked })} />
                <span>{LIBELLES_CASES[k]}{k === 'archiver' && choix.archiver ? ` (le ${frJour(bilan.archivage_le)})` : ''}</span>
              </label>
            ))}
          </fieldset>
        </div>
      )}
    </Sheet>
  )
}

// Bandeau d'un départ enregistré que la nuit n'a pas encore traité
export function BandeauDepart({ personne, peutGerer, onChange }) {
  if (!personne?.departure_on || personne.departure_applied_at) return null
  const lendemain = new Date(`${personne.departure_on}T12:00:00`)
  lendemain.setDate(lendemain.getDate() + 1)
  const annuler = async () => {
    if (!(await confirmer('Annuler ce départ ?\n\nLa fiche ne sera pas archivée et le compte ne sera pas coupé. Le contrat clos, le véhicule rendu, les absences annulées et les actions créées restent tels quels : corrigez-les à la main si besoin.'))) return
    try { await annulerDepart(personne.id); toast.success('Départ annulé'); onChange() } catch (e) { toast.error(e.message) }
  }
  return (
    <div role="status" className="card flex items-start gap-2 flex-wrap">
      <LogOut className="w-4 h-4 flex-none mt-1" aria-hidden="true" />
      <p className="text-ui flex-1 min-w-0">
        Départ enregistré : dernier jour le <strong>{frJour(personne.departure_on)}</strong>{personne.departure_reason ? ` (${personne.departure_reason})` : ''}.{' '}
        {personne.departure_auto
          ? `La fiche sera archivée et le compte coupé le ${frJour(lendemain.toLocaleDateString('sv-SE'))}, au cours de la nuit.`
          : 'La fiche ne sera pas archivée automatiquement.'}
      </p>
      {peutGerer && <button type="button" className="btn btn-ghost btn-sm" onClick={annuler}>Annuler le départ</button>}
    </div>
  )
}
