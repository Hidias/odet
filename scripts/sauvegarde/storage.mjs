// Copie des fichiers du Storage Supabase (logos, signatures, conventions signées...).
// Les fichiers ne sont pas dans l'export de la base : seule leur fiche (storage.objects) y est.
//
//   node storage.mjs telecharger <dossier>   lit SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY
//   node storage.mjs envoyer <dossier>       lit RESTORE_SUPABASE_URL et RESTORE_SERVICE_ROLE_KEY
//
// Aucune dépendance : Node 18 ou plus (fetch intégré).

import { mkdir, writeFile, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

const [mode, dossier] = process.argv.slice(2)
if (!['telecharger', 'envoyer'].includes(mode) || !dossier) {
  console.error('Usage : node storage.mjs telecharger|envoyer <dossier>')
  process.exit(2)
}

const url = (mode === 'telecharger' ? process.env.SUPABASE_URL : process.env.RESTORE_SUPABASE_URL || '').replace(/\/$/, '')
const cle = mode === 'telecharger' ? process.env.SUPABASE_SERVICE_ROLE_KEY : process.env.RESTORE_SERVICE_ROLE_KEY
if (!url || !cle) {
  console.error('URL du projet ou clé service_role manquante.')
  process.exit(2)
}

const entetes = { apikey: cle, Authorization: `Bearer ${cle}` }
const encoder = (chemin) => chemin.split('/').map(encodeURIComponent).join('/')

async function appel(methode, chemin, corps, extra = {}) {
  const rep = await fetch(`${url}/storage/v1${chemin}`, {
    method: methode,
    headers: { ...entetes, ...extra },
    body: corps,
  })
  return rep
}

async function json(methode, chemin, corps) {
  const rep = await appel(methode, chemin, corps ? JSON.stringify(corps) : undefined, { 'Content-Type': 'application/json' })
  if (!rep.ok) throw new Error(`${methode} ${chemin} : HTTP ${rep.status} ${await rep.text()}`)
  return rep.json()
}

async function lister(bucket, prefixe = '') {
  const fichiers = []
  for (let offset = 0; ; offset += 100) {
    const lot = await json('POST', `/object/list/${encodeURIComponent(bucket)}`, {
      prefix: prefixe, limit: 100, offset, sortBy: { column: 'name', order: 'asc' },
    })
    for (const e of lot) {
      const chemin = prefixe ? `${prefixe}/${e.name}` : e.name
      if (e.id === null) fichiers.push(...(await lister(bucket, chemin)))
      else fichiers.push({ chemin, type: e.metadata?.mimetype || 'application/octet-stream', taille: e.metadata?.size ?? null })
    }
    if (lot.length < 100) break
  }
  return fichiers
}

async function telecharger() {
  const buckets = await json('GET', '/bucket')
  const inventaire = { buckets: [], fichiers: [] }
  let total = 0
  for (const b of buckets) {
    inventaire.buckets.push({ id: b.id, name: b.name, public: b.public, file_size_limit: b.file_size_limit, allowed_mime_types: b.allowed_mime_types })
    for (const f of await lister(b.id)) {
      const rep = await appel('GET', `/object/${encodeURIComponent(b.id)}/${encoder(f.chemin)}`)
      if (!rep.ok) throw new Error(`Téléchargement ${b.id}/${f.chemin} : HTTP ${rep.status}`)
      const contenu = Buffer.from(await rep.arrayBuffer())
      const cible = join(dossier, 'fichiers', b.id, f.chemin)
      await mkdir(dirname(cible), { recursive: true })
      await writeFile(cible, contenu)
      inventaire.fichiers.push({ bucket: b.id, chemin: f.chemin, type: f.type, octets: contenu.length })
      total += contenu.length
    }
  }
  await mkdir(dossier, { recursive: true })
  await writeFile(join(dossier, 'inventaire.json'), JSON.stringify(inventaire, null, 2))
  console.log(`Storage : ${inventaire.buckets.length} buckets, ${inventaire.fichiers.length} fichiers, ${total} octets`)
}

async function envoyer() {
  const inventaire = JSON.parse(await readFile(join(dossier, 'inventaire.json'), 'utf8'))
  for (const b of inventaire.buckets) {
    const rep = await appel('POST', '/bucket', JSON.stringify(b), { 'Content-Type': 'application/json' })
    if (!rep.ok && rep.status !== 409 && rep.status !== 400) {
      throw new Error(`Création du bucket ${b.id} : HTTP ${rep.status} ${await rep.text()}`)
    }
  }
  for (const f of inventaire.fichiers) {
    const contenu = await readFile(join(dossier, 'fichiers', f.bucket, f.chemin))
    const rep = await appel('POST', `/object/${encodeURIComponent(f.bucket)}/${encoder(f.chemin)}`, contenu, {
      'Content-Type': f.type, 'x-upsert': 'true',
    })
    if (!rep.ok) throw new Error(`Envoi ${f.bucket}/${f.chemin} : HTTP ${rep.status} ${await rep.text()}`)
  }
  // Contrôle : chaque fichier doit se relire avec la même taille.
  for (const f of inventaire.fichiers) {
    const rep = await appel('GET', `/object/${encodeURIComponent(f.bucket)}/${encoder(f.chemin)}`)
    const n = rep.ok ? (await rep.arrayBuffer()).byteLength : -1
    if (n !== f.octets) throw new Error(`Contrôle ${f.bucket}/${f.chemin} : ${n} octets relus, ${f.octets} attendus`)
  }
  console.log(`Storage : ${inventaire.fichiers.length} fichiers restaurés et relus`)
}

;(mode === 'telecharger' ? telecharger() : envoyer()).catch((e) => {
  console.error(e.message)
  process.exit(1)
})
