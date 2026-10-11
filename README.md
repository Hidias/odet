# odet

Nom de code du produit porté par Access Dev : plateforme de gestion pour organismes de formation (version OF) et pour entreprises de sécurité incendie (version entreprise), en marque blanche, une instance par client.

- Front : React 18, Vite, Tailwind, Zustand
- Base : Supabase (Postgres, Auth, Storage), une instance par client
- API : fonctions Vercel dans `api/`
- Aucune donnée d'organisme dans le code : tout vient de la configuration de l'instance

## Structure

```
src/
  app/        coque applicative (App, Layout, PublicLayout, styles)
  core/       socle commun : auth, organisation, paramètres, audit, PDF (polices)
  ui/         composants d'interface partagés
  modules/    un dossier par module métier (formation, portail, prévention, qualité,
              commercial, prospection, mailing, finance, duerp, social, dashboard)
api/          fonctions serveur (Vercel)
supabase/     migrations versionnées et données de référence
docs/         documentation, notes de version
```

## Démarrage

1. Copier `.env.example` en `.env` et renseigner l'instance.
2. `npm install` puis `npm run dev`.
3. Appliquer les migrations de `supabase/migrations/` sur le projet Supabase de l'instance.

## Versions

Versionnage sémantique à partir de 1.0.0. Branche `main` = développement, `stable` = production des clients.
