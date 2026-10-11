// ════════════════════════════════════════════════════════════════
// prospectEmailTemplates.js — Modèles de mail prospect (phoning)
// Déplacés tels quels depuis MarinePhoning.jsx pour être partagés
// avec le mode session. Texte inchangé.
// ════════════════════════════════════════════════════════════════

import { orgName } from '../../../core/org/currentOrg'
import { apiFetch } from '../../../core/api'
import { supabase } from '../../../core/supabase'

export const EMAIL_TEMPLATES = {
  suite_echange: {
    subject: (name) => 'Suite à notre échange – formations santé & sécurité',
    body: (name, contact) => `<p>Bonjour${contact ? ' ' + contact : ''},</p>
<p>Merci encore d'avoir pris le temps d'échanger avec moi aujourd'hui 😊</p>
<p>Comme évoqué au téléphone, ${orgName()} accompagne les entreprises de Bretagne et Pays de la Loire sur les sujets de santé et sécurité au travail, avec une approche très terrain et sur mesure.</p>
<p>Nous intervenons notamment sur :</p>
<ul>
<li>le secourisme (SST, MAC SST)</li>
<li>la prévention incendie (EPI, extincteurs, évacuation)</li>
<li>les gestes et postures / TMS</li>
<li>les habilitations électriques (B0 / H0V)</li>
<li>la conduite de chariots et gerbeurs (R485 / R489)</li>
</ul>
<p>Notre particularité : des formations intra-entreprise, directement sur site, animées par l'un de nos deux formateurs, avec des contenus concrets, participatifs, et pensés pour être utiles au quotidien (pas de format descendant ou ennuyeux).</p>
<p>Nous sommes également certifiés <strong>Qualiopi</strong>, ce qui permet, selon les cas, un financement via les OPCO.</p>
<p>Si vous le souhaitez, nous proposons un <strong>diagnostic gratuit de 20 minutes</strong>, afin de cadrer vos besoins, vos contraintes et voir ensemble si cela a du sens d'aller plus loin.</p>
<p>Nous restons bien entendu à votre disposition pour échanger, et nous vous souhaitons une très bonne journée !</p>`,
  },
  nrp: {
    subject: (name) => 'Vos formations sécurité sont-elles à jour ?',
    body: (name, contact) => `<p>Bonjour${contact ? ' ' + contact : ''},</p>
<p>Je me permets de vous contacter par mail, car j'ai tenté de vous joindre ce jour, sans succès.</p>
<p>Je souhaitais échanger avec vous pour vous présenter <strong>${orgName()}</strong>, organisme de formation spécialisé en santé et sécurité au travail, intervenant en Bretagne et Pays de la Loire.</p>
<p>Nous intervenons notamment sur :</p>
<ul>
<li>le secourisme (SST, MAC SST)</li>
<li>la prévention incendie (EPI, extincteurs, évacuation)</li>
<li>les gestes et postures / TMS</li>
<li>les habilitations électriques (B0 / H0V)</li>
<li>la conduite de chariots et gerbeurs (R485 / R489)</li>
</ul>
<p>Notre particularité : des formations intra-entreprise, directement sur site, animées par l'un de nos deux formateurs, avec des contenus concrets, participatifs, et pensés pour être utiles au quotidien (pas de format descendant ou ennuyeux).</p>
<p>Nous sommes également certifiés <strong>Qualiopi</strong>, ce qui permet, selon les cas, un financement via les OPCO.</p>
<p>Si vous le souhaitez, nous proposons un <strong>diagnostic gratuit de 20 minutes</strong>, afin de cadrer vos besoins, vos contraintes et voir ensemble si cela a du sens d'aller plus loin.</p>
<p>Nous restons bien entendu à votre disposition pour échanger, et nous vous souhaitons une très bonne journée !</p>`,
  },
  relance: {
    subject: (name) => 'Relance – formations santé & sécurité',
    body: (name, contact) => `<p>Bonjour${contact ? ' ' + contact : ''},</p>
<p>Je me permets de revenir vers vous suite à mon précédent message.</p>
<p>Nous accompagnons les entreprises de Bretagne et Pays de la Loire en formations santé et sécurité : SST, incendie, gestes et postures, habilitations électriques, conduite de chariots et gerbeurs (R485/R489).</p>
<p>Nos formations sont <strong>100% intra-entreprise</strong>, directement chez vous, avec des contenus concrets et participatifs. Nous sommes certifiés <strong>Qualiopi</strong> (financement OPCO possible).</p>
<p>Seriez-vous disponible pour un échange rapide de 10 minutes cette semaine ? Belle journée !</p>`,
  },
  relance_2: {
    subject: (name) => `Une dernière chose… – ${orgName()}`,
    body: (name, contact) => `<p>Bonjour${contact ? ' ' + contact : ''},</p>
<p>Je reviens vers vous une toute dernière fois, promis, c’est la dernière 😊</p>
<p>Depuis nos précédents échanges, nous avons accompagné plusieurs entreprises de la région en formations santé et sécurité au travail : SST, prévention incendie, gestes et postures, habilitations électriques, conduite de chariots (R485/R489).</p>
<p>Si le sujet n’est vraiment pas d’actualité pour vous, je comprends tout à fait, et je vous souhaite une excellente continuation !</p>
<p>En revanche, si vous avez ne serait-ce qu’une petite question ou un besoin, même ponctuel, n’hésitez pas à nous recontacter : nous sommes là.</p>
<p>Nous sommes certifiés <strong>Qualiopi</strong> et intervenons uniquement en intra-entreprise, directement chez vous (financement OPCO possible). Belle journée !</p>`,
  },
  camping_tiede: {
    subject: () => 'Suite à notre échange — initiation premiers secours pour vos vacanciers',
    body: () => `<p>Bonjour,</p>
<p>Merci pour notre échange de ce jour.</p>
<p>Comme évoqué, nous proposons une animation <strong>"Initiation aux gestes de premiers secours"</strong> de 2 heures, animée directement dans votre camping pour vos vacanciers cet été.</p>
<p>Un camping breton a fait appel à nous cette saison, et nous avons souhaité proposer la même chose à ses voisins.</p>
<p>Programme : réanimation cardio-pulmonaire, défibrillateur, désobstruction des voies aériennes, conduite à tenir en cas de noyade.<br>
Format : 2h, 10 à 15 personnes, salle commune ou espace extérieur, matériel pédagogique fourni.<br>
Tarif : 250 € HT par session.</p>
<p>Je vous adresse notre plaquette de présentation détaillée, et reste disponible pour caler une date qui vous convient sur juillet-août.</p>
<p>Belle journée,</p>`,
  },
  camping_nrp: {
    subject: () => 'Initiation aux premiers secours pour vos vacanciers — été 2026',
    body: () => `<p>Bonjour,</p>
<p>J'ai tenté de vous joindre ce jour sans succès. Je me permets de revenir vers vous par email.</p>
<p>Nous proposons aux campings une animation <strong>"Initiation aux gestes de premiers secours"</strong> de 2 heures pour vos vacanciers cet été.</p>
<p>Un camping breton a fait appel à nous cette saison, et nous avons souhaité proposer la même chose à ses voisins.</p>
<p>Programme : réanimation cardio-pulmonaire, défibrillateur, désobstruction des voies aériennes, conduite à tenir en cas de noyade.<br>
Format : 2h, 10 à 15 personnes, salle commune ou espace extérieur, matériel pédagogique fourni.<br>
Tarif : 250 € HT par session.</p>
<p>N'hésitez pas à me recontacter pour en discuter ou convenir d'un créneau.</p>
<p>Belle journée,</p>`,
  },
  remerciement: {
    subject: (name) => `Merci pour votre retour – ${orgName()}`,
    body: (name, contact) => `<p>Bonjour${contact ? ' ' + contact : ''},</p>
<p>Je vous remercie pour le temps que vous nous avez accordé au téléphone.</p>
<p>Nous avons bien noté que les formations en santé et sécurité ne correspondent pas à vos besoins actuels, et nous respectons tout à fait cette décision.</p>
<p>Sachez toutefois que nos services restent à votre disposition si vos besoins venaient à évoluer : SST, prévention incendie, gestes et postures, habilitations électriques, conduite de chariots et gerbeurs (R485/R489)…</p>
<p>Nous intervenons en <strong>intra-entreprise</strong>, directement sur site, et sommes certifiés <strong>Qualiopi</strong> (financement OPCO possible).</p>
<p>N'hésitez pas à revenir vers nous si vos besoins venaient à évoluer. Nous vous souhaitons une très bonne continuation !</p>`,
  },
}

export const FIXED_ATTACHMENTS = [
  { filename: 'Catalogue_Formation.pdf', path: 'Catalogue_Formation.pdf', label: 'Catalogue' },
  { filename: 'AFProgrammes.pdf', path: 'AFProgrammes.pdf', label: 'Programmes' },
]

// Mail déjà envoyé à ce SIREN dans les 30 derniers jours ?
export async function lastProspectEmail(siren) {
  if (!siren || String(siren).startsWith('MANUAL_')) return null
  const since = new Date(Date.now() - 30 * 86400000).toISOString()
  const { data } = await supabase.from('prospect_email_logs')
    .select('sent_at, template_type')
    .eq('prospect_siren', siren)
    .gte('sent_at', since)
    .order('sent_at', { ascending: false })
    .limit(1)
  return data?.[0] || null
}

// Envoi d'un mail prospect, identique au phoning (mêmes pièces jointes, même API)
export async function sendProspectEmail({ to, subject, body, caller, prospect, clientId = null, templateType, signatureVariant = 'standard' }) {
  const attachments = []
  for (const pj of FIXED_ATTACHMENTS) {
    try {
      const { data: fileData, error } = await supabase.storage.from('email-attachments').download(pj.path)
      if (error || !fileData) continue
      const arrayBuf = await fileData.arrayBuffer()
      const base64 = btoa(new Uint8Array(arrayBuf).reduce((acc, b) => acc + String.fromCharCode(b), ''))
      attachments.push({ filename: pj.filename, base64, contentType: 'application/pdf' })
    } catch (e) {
      console.warn('Pièce jointe introuvable :', pj.path, e)
    }
  }
  if (prospect?.id && to && to !== prospect.email) {
    await supabase.from('prospection_massive').update({ email: to, updated_at: new Date().toISOString() }).eq('id', prospect.id)
  }
  const res = await apiFetch('/api/send-prospect-email', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      to, subject, body, caller, signatureVariant,
      prospectSiren: prospect?.siren || null,
      clientId,
      prospectName: prospect?.name || null,
      templateType,
      attachments: attachments.length > 0 ? attachments : undefined,
    }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || 'Erreur envoi')
  return { attachments: attachments.length }
}
