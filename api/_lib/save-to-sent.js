// ═══════════════════════════════════════════════════════════
// Helper : Copier un email envoyé dans le dossier "Envoyés" via IMAP
// Usage non-bloquant : si ça échoue, l'email a quand même été envoyé
// ═══════════════════════════════════════════════════════════

import { ImapFlow } from 'imapflow'
import MailComposer from 'nodemailer/lib/mail-composer/index.js'

/**
 * Détermine le host IMAP à partir du host SMTP
 */
function getImapHost(smtpHost) {
  if (smtpHost?.includes('exchange')) return 'exchange.ionos.eu'
  return 'imap.ionos.fr'
}

/**
 * Copie un email envoyé dans le dossier "Envoyés" du compte IMAP
 * @param {Object} emailConfig - config depuis user_email_configs (email, smtp_host)
 * @param {string} smtpPassword - mot de passe déchiffré
 * @param {Object} mailOptions - les options passées à nodemailer (from, to, subject, html, attachments...)
 */
export async function saveToSentFolder(emailConfig, smtpPassword, mailOptions) {
  let client = null
  try {
    const imapHost = getImapHost(emailConfig.smtp_host)
    console.log(`[save-to-sent] Connecting to ${imapHost} for ${emailConfig.email}`)

    // Construire le message RFC822 complet (avec pièces jointes)
    const composer = new MailComposer(mailOptions)
    const rawMessage = await composer.compile().build()

    // Se connecter en IMAP
    client = new ImapFlow({
      host: imapHost,
      port: 993,
      secure: true,
      auth: {
        user: emailConfig.email,
        pass: smtpPassword,
      },
      logger: false,
    })

    await client.connect()

    // Trouver le dossier Envoyés
    const mailboxes = await client.list()
    let sentFolder = null

    // D'abord par attribut spécial
    for (const mb of mailboxes) {
      if (mb.specialUse === '\\Sent') {
        sentFolder = mb.path
        break
      }
    }

    // Sinon par nom
    if (!sentFolder) {
      for (const tryName of ['Sent', 'Sent Items', 'INBOX.Sent', 'Éléments envoyés', 'Objets envoyés']) {
        const found = mailboxes.find(mb => mb.path === tryName)
        if (found) {
          sentFolder = found.path
          break
        }
      }
    }

    if (!sentFolder) {
      console.warn('[save-to-sent] Dossier Envoyés non trouvé. Dossiers disponibles:', mailboxes.map(m => m.path).join(', '))
      await client.logout()
      return
    }

    // Appender le message dans le dossier Envoyés avec le flag \Seen (lu)
    await client.append(sentFolder, rawMessage, ['\\Seen'], new Date())
    console.log(`[save-to-sent] ✅ Email copié dans "${sentFolder}" pour ${emailConfig.email}`)

    await client.logout()
  } catch (err) {
    console.warn('[save-to-sent] ⚠️ Erreur (non-bloquant):', err.message)
    if (client) {
      try { await client.logout() } catch (e) { /* ignore */ }
    }
  }
}
