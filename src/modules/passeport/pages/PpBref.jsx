// « Le Passeport de prévention en bref » : page d'accueil du module, lisible par quelqu'un qui ne connaît
// pas le sujet. Les dates, délais et sources viennent du réglage versionné (pp_format_versions).

import { Link } from 'react-router-dom'
import { ChevronRight, ExternalLink } from 'lucide-react'
import { frDate } from '../lib/rules'

function Bloc({ title, children, source, className = '' }) {
  return (
    <section className={`card space-y-2 ${className}`}>
      <h2 className="section-title">{title}</h2>
      <div className="text-ui text-gray-700 space-y-2 leading-relaxed">{children}</div>
      {source && <p className="text-ui-sm muted">{source}</p>}
    </section>
  )
}

export default function PpBref({ format, inscriptions, aDeclarer, aCorriger }) {
  const r = format.regles || {}
  const o = r.obligation_of || {}
  const tr = r.delais?.transitoire
  const prets = inscriptions.filter((i) => i.statutAffiche === 'a_declarer' && !i.bloquants.length && i.settings?.declarable).length
  const bloques = inscriptions.filter((i) => i.statutAffiche === 'a_declarer' && i.bloquants.length && i.settings?.declarable).length
  const prochaine = aDeclarer.filter((s) => s.obligatoire).map((s) => s.limite?.date).filter(Boolean).sort()[0]
  const consulte = (format.sources || [])[0]?.consulte_le

  return (
    <div className="space-y-4">
      <Link to="a-declarer" className="card flex items-center gap-4 bg-nav text-nav-fg border-transparent hover:opacity-95">
        <div className="flex-1 grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div><div className="font-display text-2xl font-bold">{aDeclarer.length}</div><div className="text-ui-sm opacity-80">sessions à déclarer</div></div>
          <div><div className="font-display text-2xl font-bold">{prets}</div><div className="text-ui-sm opacity-80">stagiaires prêts</div></div>
          <div><div className="font-display text-2xl font-bold text-highlight-400">{bloques}</div><div className="text-ui-sm opacity-80">stagiaires bloqués</div></div>
          <div><div className="font-display text-xl font-bold">{prochaine ? frDate(prochaine) : 'Aucune'}</div><div className="text-ui-sm opacity-80">prochaine date limite</div></div>
        </div>
        <ChevronRight className="w-5 h-5 flex-none" aria-hidden="true" />
      </Link>
      {aCorriger.length > 0 && (
        <Link to="a-corriger" className="card flex items-center gap-3 border-red-200 bg-red-50 text-red-900">
          <span className="flex-1 text-ui">{aCorriger.length} déclaration{aCorriger.length > 1 ? 's' : ''} rejetée{aCorriger.length > 1 ? 's' : ''} par le portail, à corriger.</span>
          <ChevronRight className="w-5 h-5" aria-hidden="true" />
        </Link>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <Bloc title="Ce que c'est" className="lg:col-span-2"
          source={`Code du travail, art. L4141-5 ; décret n° 2025-748 du 1er août 2025, modifié par le décret n° 2026-496 du 12 juin 2026.${consulte ? ` Consulté le ${frDate(consulte)}.` : ''}`}>
          <p>Un espace en ligne tenu par le ministère du Travail qui rassemble, pour chaque salarié, les formations santé et sécurité qu'il a suivies. Le salarié le garde toute sa carrière ; l'employeur y retrouve les compétences de ses équipes.</p>
          <p>L'organisme de formation l'alimente en déposant des fichiers sur le portail officiel : un par type de déclaration.</p>
        </Bloc>
        <Bloc title="Qui déclare" source="Décret n° 2025-748, art. 2 et 5.">
          <p>L'organisme qui a signé avec l'entreprise. En sous-traitance, c'est l'organisme donneur d'ordre, pas celui qui anime.</p>
          <p>Si l'organisme ne déclare pas dans son délai, l'employeur peut le faire lui-même pendant {r.delais?.employeur_mois ?? 9} mois.</p>
        </Bloc>

        <Bloc title="Quelles formations" source="Décret n° 2025-748, art. 4.">
          <p>Celles qui visent la prévention des risques professionnels, en quatre catégories :</p>
          <ol className="list-decimal pl-5 space-y-0.5">
            {(r.categories || []).map((c) => <li key={c.n}>{c.label}</li>)}
          </ol>
          <p className="text-ui-sm">{r.exclusions}</p>
          <p className="text-ui-sm">Chaque formation du catalogue porte son réglage : <Link to="reglages" className="underline">Réglages</Link>.</p>
        </Bloc>
        <Bloc title="Depuis quand, dans quel délai" source={`Décret n° 2025-748, art. 2 V et 7.${r.sanction ? ' ' + r.sanction : ''}`}>
          <p>Pour l'organisme : catégories 1 et 2 depuis le {frDate(o.categories_1_2_depuis)}, toutes les catégories pour les formations commencées depuis le {frDate(o.toutes_depuis)}. Avant, la déclaration est volontaire.</p>
          <p>Délai : {r.delais?.droit_commun_mois ?? 3} mois après la fin du trimestre où la formation se termine{tr ? ` ; ${tr.mois} mois pour les formations terminées jusqu'au ${frDate(tr.fin_formation_jusqu_au)}` : ''}.
            {tr?.a_confirmer && <span className="badge badge-warning ml-1.5">à confirmer</span>}</p>
        </Bloc>
        <Bloc title="Deux fichiers">
          <p><b>ADF, attestation de formation</b> : participation assidue et complète.</p>
          <p><b>JDR, justificatif de réussite</b> : compétences validées (certificat, habilitation, titre). Exemple : le SST.</p>
          <p>Pour chaque stagiaire : le numéro de sécurité sociale (13 caractères, sans la clé) et le nom de naissance exact. Le portail contrôle le couple.</p>
        </Bloc>

        <Bloc title="Ce que l'outil fait à la place de l'organisme" className="lg:col-span-2">
          <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3 text-ui-sm">
            <div><b className="text-gray-900">1. Collecter</b><br />Le stagiaire donne son nom de naissance et son numéro sur le portail, avec l'usage expliqué. Le numéro est chiffré dès l'envoi.</div>
            <div><b className="text-gray-900">2. Repérer</b><br />Chaque session terminée arrive dans « À déclarer » avec sa date limite et ce qui bloque.</div>
            <div><b className="text-gray-900">3. Contrôler</b><br />Numéro, SIRET de l'employeur, noms en majuscules sans accents : les erreurs sont vues avant le dépôt.</div>
            <div><b className="text-gray-900">4. Fabriquer</b><br />Les fichiers ADF et JDR au format officiel, prêts à déposer, sans passer par un tableur.</div>
            <div><b className="text-gray-900">5. Lire la réponse</b><br />On dépose l'accusé de traitement : succès et rejets se rangent seuls, avec la cause probable.</div>
            <div><b className="text-gray-900">6. Corriger et effacer</b><br />Fichier de correction en un clic ; le numéro est effacé dès que le portail a tout accepté.</div>
          </div>
        </Bloc>
        <Bloc title="Sources officielles" source={`Réglage en vigueur : ${format.label}.`}>
          <ul className="space-y-1 text-ui-sm">
            {(format.sources || []).map((s) => (
              <li key={s.label}>
                <a href={s.url} target="_blank" rel="noreferrer" className="underline inline-flex items-start gap-1">{s.label}<ExternalLink className="w-3 h-3 mt-1 flex-none" aria-hidden="true" /></a>
                {s.note && <span className="muted"> ({s.note})</span>}
              </li>
            ))}
          </ul>
        </Bloc>
      </div>
    </div>
  )
}
