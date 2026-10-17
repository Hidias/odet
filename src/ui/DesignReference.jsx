import { useState } from 'react'
import { Plus, Send, FileText, Inbox, Trash2 } from 'lucide-react'
import {
  Button, Field, Input, Select, Textarea, Card, CardHeader, CardBody, StatusBadge, STATUS, Tabs, PageHeader,
  EmptyState, Spinner, Banner, Sheet, ConfirmInline, ActionBar, DataTable,
} from './index'

// Page de référence interne du système de design (route /design-systeme).
// Montre les jetons et chaque composant commun, en direct, avec les couleurs et réglages de l'organisme.

const BRAND = ['primary', 'accent', 'highlight']
const SEMANTIC = [['success', 'Réussite'], ['warning', 'Attention'], ['danger', 'Alerte'], ['info', 'Information']]

function Section({ id, title, children, note = null }) {
  return (
    <section id={id} className="grid grid-cols-[minmax(0,1fr)] gap-3">
      <div>
        <h2 className="section-title">{title}</h2>
        {note && <p className="text-ui-sm text-gray-500 max-w-2xl">{note}</p>}
      </div>
      {children}
    </section>
  )
}

function Code({ children }) {
  return <pre className="text-ui-sm bg-gray-50 border hairline p-3 overflow-x-auto" style={{ borderRadius: 'var(--radius-ui-sm)' }}><code>{children}</code></pre>
}

const ROWS = [
  { id: 1, date: '19/10', title: 'Gestes et postures', client: 'Client exemple A', n: 9, status: 'confirmed' },
  { id: 2, date: '30/10', title: 'SST, maintien et actualisation', client: 'Client exemple B', n: 6, status: 'planned' },
  { id: 3, date: '02/11', title: 'Habilitation électrique B0H0V', client: 'Client exemple B', n: 4, status: 'draft' },
]

export default function DesignReference() {
  const [tab, setTab] = useState('stagiaires')
  const [sheet, setSheet] = useState(false)
  const [banner, setBanner] = useState(true)

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-8 pb-10" style={{ maxWidth: 1100 }}>
      <PageHeader
        crumbs={[{ label: 'Paramètres', to: '/parametres' }, { label: 'Système de design' }]}
        eyebrow="Référence interne"
        title="Système de design"
        meta={<span>Composants communs de src/ui. Les couleurs, la police et les angles viennent des réglages de l'organisme et de l'affichage de chaque utilisateur.</span>}
      />

      <Section id="couleurs" title="Couleurs" note="Couleurs de marque réglées dans Paramètres › Identité. Les couleurs de sens (réussite, attention, alerte, information) sont fixes ; l'alerte est un rouge brique, distinct du rouge de marque, et s'accompagne toujours d'une icône ou d'un texte.">
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2">
          {BRAND.map((b) => (
            <div key={b} className="surface overflow-hidden">
              <div style={{ height: 44, background: `rgb(var(--c-${b}-500))` }} />
              <div className="p-2 text-ui-sm"><b className="block">{b === 'primary' ? 'Principale' : b === 'accent' ? 'Action' : 'Détail'}</b><span className="text-gray-500">{b}-500</span></div>
            </div>
          ))}
          {SEMANTIC.map(([k, l]) => (
            <div key={k} className="surface overflow-hidden">
              <div style={{ height: 44, background: `rgb(var(--c-${k}))` }} />
              <div className="p-2 text-ui-sm"><b className="block">{l}</b><span className="text-gray-500">{k}</span></div>
            </div>
          ))}
        </div>
      </Section>

      <Section id="typo" title="Typographie et angles" note="Police : Paramètres › Identité › Polices. Taille et espacements : réglage Densité de chaque utilisateur. Angles : réglage Arrondis. Les composants ci-dessous suivent ces trois réglages.">
        <Card><CardBody>
          <div className="grid gap-1">
            <span className="page-title">Titre de page</span>
            <span className="section-title">Titre de section</span>
            <span className="text-ui">Texte courant : convocations à envoyer à 9 stagiaires avant lundi.</span>
            <span className="text-ui-sm text-gray-500 tabular-nums">Texte secondaire, chiffres alignés : 12 480,00 € · 1 l I 0 O</span>
          </div>
        </CardBody></Card>
      </Section>

      <Section id="boutons" title="Boutons" note="Une seule action principale par écran. La suppression n'est jamais à côté de l'action principale.">
        <div className="flex flex-wrap gap-2 items-center">
          <Button variant="primary" icon={Send}>Envoyer les convocations</Button>
          <Button icon={FileText}>Documents</Button>
          <Button variant="ghost">Annuler</Button>
          <Button variant="danger" icon={Trash2}>Supprimer</Button>
          <Button size="sm" icon={Plus}>Ajouter</Button>
          <Button size="lg" variant="primary">Grande cible</Button>
          <Button loading>Enregistrement</Button>
          <Button icon={Plus} aria-label="Ajouter" />
        </div>
        <Code>{`<Button variant="primary" icon={Send}>Envoyer</Button>
<Button size="sm" icon={Plus}>Ajouter</Button>
<Button to="/sessions">Lien en forme de bouton</Button>`}</Code>
      </Section>

      <Section id="champs" title="Champs et sélections">
        <Card><CardBody>
          <div className="grid sm:grid-cols-2 gap-4">
            <Field label="Nom du client" hint="Tel qu'il apparaît sur les documents" required>
              {(id) => <Input id={id} placeholder="Raison sociale" />}
            </Field>
            <Field label="Financement">
              {(id) => <Select id={id} defaultValue="opco"><option value="opco">OPCO</option><option value="client">Client</option></Select>}
            </Field>
            <Field label="SIRET" error="14 chiffres attendus">
              {(id) => <Input id={id} defaultValue="1234" invalid />}
            </Field>
            <Field label="Observation">
              {(id) => <Textarea id={id} rows={2} />}
            </Field>
          </div>
        </CardBody></Card>
        <Code>{`<Field label="SIRET" error={erreur}>{(id) => <Input id={id} value={v} onChange={...} />}</Field>`}</Code>
      </Section>

      <Section id="statuts" title="Statuts" note="Une seule table pour toute l'application : une session ou une facture a la même apparence partout.">
        <div className="grid gap-2">
          {Object.entries(STATUS).map(([kind, map]) => (
            <div key={kind} className="flex flex-wrap items-center gap-x-4 gap-y-1">
              <span className="text-ui-sm text-gray-500 w-20">{kind}</span>
              {Object.keys(map).map((s) => <StatusBadge key={s} kind={kind} status={s} />)}
            </div>
          ))}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <span className="text-ui-sm text-gray-500 w-20">libre</span>
            <StatusBadge tone="warning">Convocations à envoyer</StatusBadge>
          </div>
        </div>
        <Code>{`<StatusBadge kind="invoice" status="overdue" />
<StatusBadge tone="warning">Convocations à envoyer</StatusBadge>`}</Code>
      </Section>

      <Section id="onglets" title="Onglets" note="Au-delà du nombre visible, les onglets passent dans « Plus ». Aucun onglet n'est supprimé.">
        <Tabs value={tab} onChange={setTab} visible={5} tabs={[
          { id: 'stagiaires', label: 'Stagiaires', count: 9 }, { id: 'presence', label: 'Présence' }, { id: 'evaluations', label: 'Évaluations' },
          { id: 'documents', label: 'Documents', count: 6 }, { id: 'financement', label: 'Financement' }, { id: 'materiel', label: 'Matériel' },
          { id: 'couts', label: 'Coûts supplémentaires' }, { id: 'qr', label: 'QR émargement' },
        ]} />
      </Section>

      <Section id="tableau" title="Tableau" note="Tableau sur PC ; une carte par ligne sur téléphone, ou partout si l'utilisateur choisit « Listes en cartes ».">
        <Card>
          <CardHeader title="Prochaines sessions" actions={<Button size="sm" icon={Plus}>Ajouter</Button>} />
          <DataTable rows={ROWS} caption="Prochaines sessions" columns={[
            { key: 'date', label: 'Date', mobile: 'subtitle', className: 'tabular-nums' },
            { key: 'title', label: 'Formation', mobile: 'title' },
            { key: 'client', label: 'Client' },
            { key: 'n', label: 'Inscrits', align: 'right' },
            { key: 'status', label: 'Statut', mobile: 'aside', render: (r) => <StatusBadge kind="session" status={r.status} /> },
          ]} />
        </Card>
      </Section>

      <Section id="cartes" title="Cartes, états vides et chargement">
        <div className="grid md:grid-cols-3 gap-3 items-start">
          <Card><CardHeader title="Avec titre" subtitle="Et sous-titre" /><CardBody>Contenu de la carte.</CardBody></Card>
          <Card><EmptyState icon={Inbox} title="Aucun devis pour ce client" action={<Button size="sm" variant="primary" icon={Plus}>Créer un devis</Button>}>Les devis envoyés apparaîtront ici.</EmptyState></Card>
          <Card><Spinner label="Chargement des sessions" /></Card>
        </div>
      </Section>

      <Section id="bandeaux" title="Bandeaux">
        <div className="grid gap-2">
          {banner && <Banner tone="info" title="Information" onClose={() => setBanner(false)}>Bandeau fermable.</Banner>}
          <Banner tone="success" title="Convention signée">Le document est rangé dans la session.</Banner>
          <Banner tone="warning" title="2 fiches stagiaires incomplètes" action={<Button size="sm">Voir</Button>} />
          <Banner tone="danger" title="2 factures en retard">1 840,00 € TTC, la plus ancienne depuis 12 jours.</Banner>
        </div>
      </Section>

      <Section id="confirmation" title="Confirmation dans l'écran et fenêtre" note="Remplacent window.confirm et les fenêtres faites à la main. useConfirm() s'utilise avec ConfirmProvider.">
        <div className="flex flex-wrap gap-3 items-center">
          <ConfirmInline label="Supprimer la ligne" question="Supprimer cette ligne ?" confirmLabel="Supprimer" danger onConfirm={() => {}} />
          <Button onClick={() => setSheet(true)}>Ouvrir une fenêtre</Button>
        </div>
        {sheet && (
          <Sheet title="Ajouter un stagiaire" onClose={() => setSheet(false)} footer={<><Button variant="ghost" onClick={() => setSheet(false)}>Annuler</Button><Button variant="primary" onClick={() => setSheet(false)}>Ajouter</Button></>}>
            <Field label="Nom">{(id) => <Input id={id} />}</Field>
            <p className="text-ui-sm text-gray-500">En bas de l'écran sur téléphone, centrée sur PC.</p>
          </Sheet>
        )}
      </Section>

      <Section id="actions" title="Barre d'actions" note="Fixe en bas de l'écran sur téléphone, alignée à droite sur PC. L'action principale en dernier.">
        <ActionBar>
          <Button icon={FileText} aria-label="Documents" />
          <Button variant="primary" icon={Send}>Envoyer les convocations (9)</Button>
        </ActionBar>
      </Section>
    </div>
  )
}
