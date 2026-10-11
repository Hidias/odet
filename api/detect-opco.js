// api/detect-opco.js
// Détection OPCO + enrichissement adresse via multi-sources
// Table IDCC→OPCO mise à jour avec nouvelles conventions 2024-2025

const IDCC_TO_OPCO = {
  // ══════ AFDAS ══════
  86:'AFDAS',214:'AFDAS',306:'AFDAS',394:'AFDAS',509:'AFDAS',598:'AFDAS',
  693:'AFDAS',698:'AFDAS',716:'AFDAS',781:'AFDAS',892:'AFDAS',1016:'AFDAS',1018:'AFDAS',
  1083:'AFDAS',1194:'AFDAS',1281:'AFDAS',1285:'AFDAS',1307:'AFDAS',1480:'AFDAS',
  1563:'AFDAS',1618:'AFDAS',1631:'AFDAS',1734:'AFDAS',1790:'AFDAS',1874:'AFDAS',
  1895:'AFDAS',1909:'AFDAS',1922:'AFDAS',2021:'AFDAS',2121:'AFDAS',2148:'AFDAS',
  2257:'AFDAS',2372:'AFDAS',2397:'AFDAS',2411:'AFDAS',2412:'AFDAS',2511:'AFDAS',
  2642:'AFDAS',2683:'AFDAS',2717:'AFDAS',2770:'AFDAS',3090:'AFDAS',3097:'AFDAS',
  3221:'AFDAS',3225:'AFDAS',3230:'AFDAS',

  // ══════ AKTO ══════
  158:'AKTO',275:'AKTO',573:'AKTO',635:'AKTO',731:'AKTO',1266:'AKTO',1311:'AKTO',
  1351:'AKTO',1383:'AKTO',1391:'AKTO',1413:'AKTO',1501:'AKTO',1516:'AKTO',1671:'AKTO',
  1944:'AKTO',1979:'AKTO',2002:'AKTO',2060:'AKTO',2101:'AKTO',2147:'AKTO',2149:'AKTO',
  2378:'AKTO',2408:'AKTO',2583:'AKTO',2691:'AKTO',3043:'AKTO',3218:'AKTO',3219:'AKTO',
  7509:'AKTO',7520:'AKTO',

  // ══════ ATLAS ══════
  438:'ATLAS',478:'ATLAS',653:'ATLAS',787:'ATLAS',1468:'ATLAS',1486:'ATLAS',1672:'ATLAS',
  1679:'ATLAS',1801:'ATLAS',2120:'ATLAS',2230:'ATLAS',2247:'ATLAS',2335:'ATLAS',
  2357:'ATLAS',2543:'ATLAS',2622:'ATLAS',2931:'ATLAS',3210:'ATLAS',3213:'ATLAS',5005:'ATLAS',

  // ══════ Constructys ══════
  1596:'Constructys',1597:'Constructys',1702:'Constructys',1947:'Constructys',
  2420:'Constructys',2609:'Constructys',2614:'Constructys',3212:'Constructys',3216:'Constructys',

  // ══════ L'Opcommerce ══════
  43:"L'Opcommerce",468:"L'Opcommerce",500:"L'Opcommerce",675:"L'Opcommerce",
  706:"L'Opcommerce",1314:"L'Opcommerce",1431:"L'Opcommerce",1487:"L'Opcommerce",
  1505:"L'Opcommerce",1517:"L'Opcommerce",1539:"L'Opcommerce",1557:"L'Opcommerce",
  1606:"L'Opcommerce",1686:"L'Opcommerce",1760:"L'Opcommerce",1880:"L'Opcommerce",
  2156:"L'Opcommerce",2198:"L'Opcommerce",2216:"L'Opcommerce",3168:"L'Opcommerce",3205:"L'Opcommerce",

  // ══════ OCAPIAT ══════
  112:'OCAPIAT',200:'OCAPIAT',493:'OCAPIAT',1077:'OCAPIAT',1396:'OCAPIAT',1405:'OCAPIAT',
  1513:'OCAPIAT',1534:'OCAPIAT',1586:'OCAPIAT',1659:'OCAPIAT',1747:'OCAPIAT',
  1930:'OCAPIAT',1938:'OCAPIAT',1987:'OCAPIAT',2075:'OCAPIAT',2494:'OCAPIAT',
  2728:'OCAPIAT',3109:'OCAPIAT',3203:'OCAPIAT',5619:'OCAPIAT',
  7001:'OCAPIAT',7002:'OCAPIAT',7003:'OCAPIAT',7004:'OCAPIAT',7005:'OCAPIAT',
  7006:'OCAPIAT',7007:'OCAPIAT',7008:'OCAPIAT',7009:'OCAPIAT',7010:'OCAPIAT',
  7012:'OCAPIAT',7013:'OCAPIAT',7014:'OCAPIAT',7017:'OCAPIAT',7018:'OCAPIAT',
  7019:'OCAPIAT',7020:'OCAPIAT',7021:'OCAPIAT',7023:'OCAPIAT',7501:'OCAPIAT',
  7502:'OCAPIAT',7503:'OCAPIAT',7508:'OCAPIAT',7513:'OCAPIAT',7514:'OCAPIAT',
  7515:'OCAPIAT',8115:'OCAPIAT',8435:'OCAPIAT',

  // ══════ OPCO 2i ══════
  18:'OPCO 2i',44:'OPCO 2i',45:'OPCO 2i',83:'OPCO 2i',87:'OPCO 2i',135:'OPCO 2i',
  176:'OPCO 2i',207:'OPCO 2i',211:'OPCO 2i',247:'OPCO 2i',292:'OPCO 2i',303:'OPCO 2i',
  363:'OPCO 2i',489:'OPCO 2i',567:'OPCO 2i',637:'OPCO 2i',669:'OPCO 2i',700:'OPCO 2i',
  707:'OPCO 2i',715:'OPCO 2i',802:'OPCO 2i',832:'OPCO 2i',833:'OPCO 2i',925:'OPCO 2i',
  998:'OPCO 2i',1044:'OPCO 2i',1170:'OPCO 2i',1256:'OPCO 2i',1388:'OPCO 2i',1411:'OPCO 2i',
  1423:'OPCO 2i',1492:'OPCO 2i',1495:'OPCO 2i',1555:'OPCO 2i',1558:'OPCO 2i',
  1580:'OPCO 2i',1607:'OPCO 2i',1821:'OPCO 2i',1942:'OPCO 2i',2089:'OPCO 2i',
  2528:'OPCO 2i',3224:'OPCO 2i',3227:'OPCO 2i',5001:'OPCO 2i',
  // Nouvelles conventions métallurgie 2024
  3248:'OPCO 2i',

  // ══════ OPCO EP ══════
  184:'OPCO EP',240:'OPCO EP',454:'OPCO EP',614:'OPCO EP',733:'OPCO EP',
  759:'OPCO EP',843:'OPCO EP',915:'OPCO EP',953:'OPCO EP',959:'OPCO EP',
  992:'OPCO EP',993:'OPCO EP',1000:'OPCO EP',1043:'OPCO EP',1147:'OPCO EP',
  1267:'OPCO EP',1286:'OPCO EP',1404:'OPCO EP',1408:'OPCO EP',1412:'OPCO EP',
  1483:'OPCO EP',1499:'OPCO EP',1504:'OPCO EP',1512:'OPCO EP',1527:'OPCO EP',
  1589:'OPCO EP',1605:'OPCO EP',1611:'OPCO EP',1619:'OPCO EP',1621:'OPCO EP',
  1850:'OPCO EP',1875:'OPCO EP',1921:'OPCO EP',1951:'OPCO EP',1978:'OPCO EP',
  1982:'OPCO EP',1996:'OPCO EP',2098:'OPCO EP',2111:'OPCO EP',2205:'OPCO EP',
  2219:'OPCO EP',2272:'OPCO EP',2329:'OPCO EP',2332:'OPCO EP',2395:'OPCO EP',
  2564:'OPCO EP',2596:'OPCO EP',2697:'OPCO EP',2706:'OPCO EP',2785:'OPCO EP',
  2978:'OPCO EP',3013:'OPCO EP',3032:'OPCO EP',3127:'OPCO EP',

  // ══════ OPCO Mobilités ══════
  3:'OPCO Mobilités',16:'OPCO Mobilités',412:'OPCO Mobilités',538:'OPCO Mobilités',
  779:'OPCO Mobilités',1090:'OPCO Mobilités',1182:'OPCO Mobilités',1424:'OPCO Mobilités',
  1536:'OPCO Mobilités',1710:'OPCO Mobilités',1974:'OPCO Mobilités',2174:'OPCO Mobilités',
  2972:'OPCO Mobilités',3017:'OPCO Mobilités',3217:'OPCO Mobilités',3223:'OPCO Mobilités',
  3228:'OPCO Mobilités',5521:'OPCO Mobilités',5554:'OPCO Mobilités',5555:'OPCO Mobilités',
  5556:'OPCO Mobilités',5557:'OPCO Mobilités',

  // ══════ OPCO Santé ══════
  29:'OPCO Santé',405:'OPCO Santé',413:'OPCO Santé',783:'OPCO Santé',897:'OPCO Santé',
  1001:'OPCO Santé',2046:'OPCO Santé',2104:'OPCO Santé',2264:'OPCO Santé',

  // ══════ Uniformation ══════
  218:'Uniformation',1031:'Uniformation',1261:'Uniformation',1278:'Uniformation',
  1316:'Uniformation',1420:'Uniformation',1518:'Uniformation',1588:'Uniformation',
  1794:'Uniformation',2128:'Uniformation',2150:'Uniformation',2190:'Uniformation',
  2336:'Uniformation',2526:'Uniformation',2603:'Uniformation',2666:'Uniformation',
  2668:'Uniformation',2727:'Uniformation',2768:'Uniformation',2793:'Uniformation',
  2796:'Uniformation',2797:'Uniformation',2798:'Uniformation',2847:'Uniformation',
  2941:'Uniformation',3016:'Uniformation',3105:'Uniformation',3220:'Uniformation',
}

// Normaliser les noms OPCO depuis sources externes vers nos noms standards
function normalizeOpcoName(raw) {
  if (!raw) return null
  const lower = raw.toLowerCase()
  if (lower.includes('afdas')) return 'AFDAS'
  if (lower.includes('akto') || lower.includes('forte intensité')) return 'AKTO'
  if (lower.includes('atlas')) return 'ATLAS'
  if (lower.includes('construct')) return 'Constructys'
  if (lower.includes('commerce') || lower.includes('opcommerce')) return "L'Opcommerce"
  if (lower.includes('ocapiat')) return 'OCAPIAT'
  if (lower.includes('2i') || lower.includes('opco2i')) return 'OPCO 2i'
  if (lower.includes('proximité') || lower.includes('opco ep')) return 'OPCO EP'
  if (lower.includes('mobilité')) return 'OPCO Mobilités'
  if (lower.includes('santé')) return 'OPCO Santé'
  if (lower.includes('uniformation') || lower.includes('cohésion')) return 'Uniformation'
  return raw // retourne tel quel si pas reconnu
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  const { siret } = req.query
  if (!siret || siret.replace(/\s/g, '').length < 9) {
    return res.status(400).json({ error: 'SIRET invalide (min 9 chiffres)' })
  }
  const cleanSiret = siret.replace(/\s/g, '')

  try {
    let idcc = null
    let conventionTitle = ''
    let entrepriseInfo = null

    // ── SOURCE 1 : recherche-entreprises.api.gouv.fr (base DSN, la plus complète) ──
    try {
      const r = await fetch(`https://recherche-entreprises.api.gouv.fr/search?q=${cleanSiret}&per_page=1`)
      if (r.ok) {
        const d = await r.json()
        const ent = d?.results?.[0]
        if (ent) {
          const etab = ent.matching_etablissements?.find(e => e.siret === cleanSiret)
            || ent.matching_etablissements?.[0]
            || ent.siege

          entrepriseInfo = {
            name: ent.nom_complet || ent.nom_raison_sociale || null,
            naf: etab?.activite_principale || ent.activite_principale || null,
            address: etab?.adresse || ent.siege?.adresse || null,
            postal_code: etab?.code_postal || ent.siege?.code_postal || null,
            city: etab?.libelle_commune || ent.siege?.libelle_commune || null,
          }

          if (etab?.liste_idcc?.length > 0) idcc = parseInt(etab.liste_idcc[0])
          if (!idcc && ent.siege?.liste_idcc?.length > 0) idcc = parseInt(ent.siege.liste_idcc[0])
          if (!idcc && ent.complements?.convention_collective_renseignee) {
            const cc = ent.complements.convention_collective_renseignee
            if (typeof cc === 'string') idcc = parseInt(cc)
            else if (cc.idcc) idcc = parseInt(cc.idcc)
          }
        }
      }
    } catch (e) { console.log('[detect-opco] recherche-entreprises error:', e.message) }

    // ── SOURCE 2 : siret2idcc (base KALI) si pas d'IDCC ──
    if (!idcc) {
      try {
        const r = await fetch(`https://siret2idcc.fabrique.social.gouv.fr/api/v2/${cleanSiret}`)
        if (r.ok) {
          const d = await r.json()
          const entry = Array.isArray(d) ? d[0] : d
          const conv = (entry?.conventions || []).find(c => c.active) || (entry?.conventions || [])[0]
          if (conv?.num) {
            idcc = parseInt(conv.num)
            conventionTitle = conv.shortTitle || conv.title || ''
          }
        }
      } catch (e) {}
    }

    // ── RÉSOLUTION IDCC → OPCO via table embarquée ──
    if (idcc) {
      const opcoName = IDCC_TO_OPCO[idcc] || null
      if (opcoName) {
        return res.status(200).json({
          opco_name: opcoName, status: 'OK',
          idcc, convention: conventionTitle,
          entreprise: entrepriseInfo,
        })
      }
    }

    // ── SOURCE 3 : CFADOCK comme fallback (a son propre mapping IDCC→OPCO) ──
    try {
      const r = await fetch(`https://www.cfadock.fr/api/opcos?siret=${cleanSiret}`, {
        headers: { 'Accept': 'application/json' }
      })
      if (r.ok) {
        const d = await r.json()
        if (d.OpcoName) {
          const normalized = normalizeOpcoName(d.OpcoName)
          return res.status(200).json({
            opco_name: normalized, status: 'OK',
            idcc: d.Idcc ? parseInt(d.Idcc) : idcc,
            convention: conventionTitle,
            entreprise: entrepriseInfo,
            source: 'cfadock'
          })
        }
      }
    } catch (e) {}

    // ── Dernière chance : IDCC trouvé mais pas dans notre table ni CFADOCK ──
    if (idcc) {
      return res.status(200).json({
        opco_name: null, status: 'IDCC_FOUND_NO_OPCO',
        idcc, convention: conventionTitle,
        entreprise: entrepriseInfo,
        message: `Convention trouvée (IDCC ${idcc}) mais OPCO non référencé. Vérifiez sur quel-est-mon-opco.francecompetences.fr`
      })
    }

    // Rien trouvé mais on a peut-être des infos entreprise
    return res.status(200).json({
      opco_name: null,
      status: entrepriseInfo ? 'NO_CONVENTION' : 'NOT_FOUND',
      entreprise: entrepriseInfo,
      message: entrepriseInfo
        ? 'Entreprise trouvée mais aucune convention collective déclarée'
        : 'SIRET non trouvé dans les bases de données'
    })

  } catch (err) {
    console.error('[detect-opco] Erreur:', err)
    return res.status(500).json({ error: 'Erreur: ' + err.message })
  }
}
