// api/sync-sent-emails.js
// CRON: Lit les dossiers "Envoyés" IMAP des 3 comptes IONOS
// → Match destinataire avec contacts clients → insert dans timeline
// → Pas de match → notification pour association manuelle

import { ImapFlow } from 'imapflow'
import { createClient } from '@supabase/supabase-js'
import crypto from 'crypto'
import { requireCronOrUser } from './_lib/auth.js'

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

function decrypt(encryptedText) {
  const algorithm = 'aes-256-cbc'
  const key = Buffer.from(process.env.ENCRYPTION_KEY, 'hex')
  const [ivHex, encrypted] = encryptedText.split(':')
  const iv = Buffer.from(ivHex, 'hex')
  const decipher = crypto.createDecipheriv(algorithm, key, iv)
  let decrypted = decipher.update(encrypted, 'hex', 'utf8')
  decrypted += decipher.final('utf8')
  return decrypted
}

// Convertir SMTP host → IMAP host
function getImapHost(smtpHost) {
  // Exchange IONOS : exchange.ionos.eu (IMAP port 993 SSL)
  if (smtpHost?.includes('exchange')) return 'exchange.ionos.eu'
  // Mail Basic IONOS : imap.ionos.fr
  return 'imap.ionos.fr'
}

// Nom expéditeur à partir de l'adresse
function getSenderName(email) {
  const map = {
    'hicham.saidi@accessformation.pro': 'Hicham',
    'maxime.langlais@accessformation.pro': 'Maxime',
    'entreprise@accessformation.pro': 'Marine',
  }
  return map[email] || email.split('@')[0]
}

// Extraire les adresses email d'un champ To/Cc
function extractEmails(addressList) {
  if (!addressList) return []
  return addressList.map(a => a.address?.toLowerCase()).filter(Boolean)
}

// Chercher un client par email destinataire
async function findClientByEmail(toEmail) {
  // 1. Chercher dans client_contacts.email
  const { data: contacts } = await supabase
    .from('client_contacts')
    .select('client_id, name, clients(id, name)')
    .ilike('email', toEmail)
    .limit(1)

  if (contacts?.length > 0) {
    return {
      client_id: contacts[0].client_id,
      client_name: contacts[0].clients?.name || '',
      contact_name: contacts[0].name || '',
    }
  }

  // 2. Chercher dans clients.contact_email
  const { data: clients } = await supabase
    .from('clients')
    .select('id, name, contact_name')
    .ilike('contact_email', toEmail)
    .limit(1)

  if (clients?.length > 0) {
    return {
      client_id: clients[0].id,
      client_name: clients[0].name,
      contact_name: clients[0].contact_name || '',
    }
  }

  // 3. Match par domaine (si pas gmail/hotmail/etc)
  const domain = toEmail.split('@')[1]
  const genericDomains = ['gmail.com','hotmail.com','yahoo.com','outlook.com','orange.fr','free.fr','sfr.fr','wanadoo.fr','laposte.net','live.fr','icloud.com']
  if (domain && !genericDomains.includes(domain)) {
    // Chercher un client dont un contact a le même domaine
    const { data: domainContacts } = await supabase
      .from('client_contacts')
      .select('client_id, name, email, clients(id, name)')
      .ilike('email', `%@${domain}`)
      .limit(1)

    if (domainContacts?.length > 0) {
      return {
        client_id: domainContacts[0].client_id,
        client_name: domainContacts[0].clients?.name || '',
        contact_name: domainContacts[0].name || '',
        matched_by: 'domain',
      }
    }
  }

  return null
}

// Vérifier si email déjà synchronisé (déduplication)
async function isDuplicate(messageId, fromEmail, toEmail, subject, sentDate) {
  // 1. Par Message-ID (le plus fiable)
  if (messageId) {
    const { data } = await supabase
      .from('prospect_email_logs')
      .select('id')
      .eq('message_id', messageId)
      .limit(1)
    if (data?.length > 0) return true
  }

  // 2. Par from + to + subject + date (±2 min) pour les emails envoyés depuis Campus
  if (sentDate && subject) {
    const d = new Date(sentDate)
    const before = new Date(d.getTime() - 120000).toISOString()
    const after = new Date(d.getTime() + 120000).toISOString()
    const { data } = await supabase
      .from('prospect_email_logs')
      .select('id')
      .eq('to_email', toEmail)
      .eq('from_email', fromEmail)
      .gte('sent_at', before)
      .lte('sent_at', after)
      .limit(1)
    if (data?.length > 0) return true
  }

  return false
}

// Traiter un compte email
async function syncAccount(emailConfig, cursor) {
  const password = decrypt(emailConfig.smtp_password_encrypted)
  const imapHost = getImapHost(emailConfig.smtp_host)
  const senderName = getSenderName(emailConfig.email)

  const client = new ImapFlow({
    host: imapHost,
    port: 993,
    secure: true,
    auth: { user: emailConfig.email, pass: password },
    logger: false,
    tls: { rejectUnauthorized: false },
  })

  let synced = 0, matched = 0, notified = 0, skipped = 0

  try {
    await client.connect()

    // Trouver le dossier Envoyés (tester plusieurs noms)
    let sentFolder = null
    const mailboxes = await client.list()
    for (const mb of mailboxes) {
      // Chercher par attribut \Sent ou par nom
      if (mb.specialUse === '\\Sent' || 
          /^(sent|sent items|envoy|elements envoy)/i.test(mb.name) ||
          /^(sent|sent items|envoy)/i.test(mb.path)) {
        sentFolder = mb.path
        break
      }
    }
    if (!sentFolder) {
      // Fallback : tester les noms courants
      for (const tryName of ['Sent', 'Sent Items', 'INBOX.Sent', 'Éléments envoyés']) {
        try {
          const lock = await client.getMailboxLock(tryName)
          lock.release()
          sentFolder = tryName
          break
        } catch (e) { /* pas ce dossier */ }
      }
    }

    if (!sentFolder) {
      console.log(`[${emailConfig.email}] Dossier Envoyés introuvable`)
      await client.logout()
      return { synced: 0, error: 'Sent folder not found' }
    }

    console.log(`[${emailConfig.email}] Dossier: ${sentFolder}, dernier UID: ${cursor.last_uid}`)

    // 1. Lecture IMAP seule : on récupère au plus 50 nouveaux messages, sans interrompre une commande en cours
    //    (interrompre une boucle fetch laissait la connexion bloquée : le curseur n'avançait plus et les mêmes
    //    emails étaient retraités, avec une notification à chaque passage).
    const lock = await client.getMailboxLock(sentFolder)
    const collected = []
    try {
      const newUids = cursor.last_uid > 0
        ? await client.search({ uid: `${cursor.last_uid + 1}:*` }, { uid: true })
        : await client.search({ all: true }, { uid: true })
      const batch = (newUids || []).filter(u => u > cursor.last_uid).sort((a, b) => a - b).slice(0, 50)
      if (batch.length > 0) {
        for await (const msg of client.fetch(batch.join(','), { uid: true, envelope: true }, { uid: true })) {
          collected.push({ uid: msg.uid, envelope: msg.envelope })
        }
      }
    } finally {
      lock.release()
    }
    await client.logout()

    // 2. Traitement en base, message par message, le curseur avançant au fur et à mesure
    let maxUid = cursor.last_uid
    collected.sort((a, b) => a.uid - b.uid)
    {
      for (const msg of collected) {
        // Curseur avancé avant le traitement : un message qui ferait échouer le traitement n'est jamais
        // retraité en boucle (pas de notification répétée)
        maxUid = msg.uid
        await supabase.from('email_sync_cursors')
          .update({ last_uid: maxUid, last_synced_at: new Date().toISOString() })
          .eq('email', emailConfig.email)

        const envelope = msg.envelope
        if (!envelope) continue

        const toEmails = extractEmails(envelope.to)
        const ccEmails = extractEmails(envelope.cc)
        const allRecipients = [...toEmails, ...ccEmails]
        const subject = envelope.subject || '(sans objet)'
        const sentDate = envelope.date
        const messageId = envelope.messageId

        // Ignorer les emails internes et les adresses personnelles connues
        const IGNORED_RECIPIENTS = [
          '@accessformation.pro',
          'hichamsaidi@msn.com',
          'hichamsaidi@hotmail.com',
          'hichamsaidi@gmail.com',
          'maxime.langlais@gmail.com',
        ]
        const externalRecipients = allRecipients.filter(e => 
          !IGNORED_RECIPIENTS.some(ignored => 
            ignored.startsWith('@') ? e.endsWith(ignored) : e === ignored
          )
        )
        if (externalRecipients.length === 0) {
          skipped++
          continue
        }

        // Pour chaque destinataire externe
        for (const toEmail of externalRecipients) {
          // Déduplication
          const dup = await isDuplicate(messageId, emailConfig.email, toEmail, subject, sentDate)
          if (dup) { skipped++; continue }

          // Chercher le client
          const match = await findClientByEmail(toEmail)

          if (match) {
            // ✅ Match → insérer dans prospect_email_logs
            await supabase.from('prospect_email_logs').insert({
              client_id: match.client_id,
              prospect_name: match.client_name,
              to_email: toEmail,
              from_email: emailConfig.email,
              subject: subject,
              template_type: 'external',
              body_preview: `Email envoyé depuis boîte ${senderName} → ${match.contact_name || toEmail}`,
              sent_by: senderName,
              status: 'sent',
              source: 'imap_sync',
              message_id: messageId,
            })
            matched++
          } else {
            // Pas de match → une seule notification par destinataire sur 30 jours, lue ou non
            // (avant : une nouvelle notification dès que la précédente était lue)
            const since = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString()
            const { data: existingNotif } = await supabase
              .from('notifications')
              .select('id')
              .eq('type', 'email_sync')
              .gte('created_at', since)
              .contains('metadata', { to_email: toEmail })
              .limit(1)

            if (!existingNotif?.length) {
              await supabase.from('notifications').insert({
                type: 'email_sync',
                title: 'Email non associé',
                message: `${senderName} → ${toEmail} : "${subject.substring(0, 80)}"`,
                link: `/clients?email_to_link=${encodeURIComponent(toEmail)}&subject=${encodeURIComponent(subject.substring(0, 80))}&from=${encodeURIComponent(emailConfig.email)}&date=${sentDate ? new Date(sentDate).toISOString() : ''}&message_id=${encodeURIComponent(messageId || '')}`,
                metadata: {
                  to_email: toEmail,
                  from_email: emailConfig.email,
                  subject: subject,
                  sent_at: sentDate ? new Date(sentDate).toISOString() : null,
                  message_id: messageId,
                  sender_name: senderName,
                },
              })
              notified++
            } else {
              skipped++ // notification déjà existante
            }
          }
          synced++
        }

      }
    }
    await supabase.from('email_sync_cursors')
      .update({ last_synced_at: new Date().toISOString() })
      .eq('email', emailConfig.email)
  } catch (err) {
    console.error(`[${emailConfig.email}] Erreur IMAP:`, err.message)
    try { await client.logout() } catch (e) {}
    return { synced, matched, notified, skipped, error: err.message }
  }

  return { synced, matched, notified, skipped }
}

export default async function handler(req, res) {
  if (!(await requireCronOrUser(req, res))) return
  console.log('=== SYNC SENT EMAILS START ===')

  try {
    // Charger les configs email actives
    const { data: configs } = await supabase
      .from('user_email_configs')
      .select('*')
      .eq('is_active', true)

    if (!configs?.length) {
      return res.status(200).json({ message: 'Aucune config email active' })
    }

    // Charger les curseurs
    const { data: cursors } = await supabase
      .from('email_sync_cursors')
      .select('*')

    const results = {}

    for (const config of configs) {
      // Trouver le curseur correspondant
      let cursor = cursors?.find(c => c.email === config.email)
      if (!cursor) {
        // Créer le curseur s'il n'existe pas
        const { data: newCursor } = await supabase
          .from('email_sync_cursors')
          .insert({ email: config.email, last_uid: 0, folder: 'Sent' })
          .select()
          .single()
        cursor = newCursor || { email: config.email, last_uid: 0, folder: 'Sent' }
      }

      console.log(`Sync ${config.email}...`)
      results[config.email] = await syncAccount(config, cursor)
      console.log(`  →`, JSON.stringify(results[config.email]))
    }

    console.log('=== SYNC SENT EMAILS END ===')
    return res.status(200).json({ success: true, results })

  } catch (error) {
    console.error('Erreur globale sync-sent-emails:', error)
    return res.status(500).json({ error: error.message })
  }
}
