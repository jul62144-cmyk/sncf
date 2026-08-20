# Trajets HDF — V2.9.4 Vercel

Cette version remplace la collecte `setInterval()` et le fichier JSON temporaire
par une architecture adaptée à Vercel.

## Fonctionnement

- Lorsqu'une gare est consultée, toute voie officielle Carto Tchoo observée est
  enregistrée immédiatement dans l'historique.
- L'historique est stocké dans **Upstash Redis** sur Vercel et reste donc présent
  après un redéploiement ou une nouvelle exécution serverless.
- Un Cron Vercel appelle `/api/collect-platforms` une fois par jour à 16:00 UTC.
- En local, si Redis n'est pas configuré, `platform-history.json` reste utilisé.

Priorité :
1. voie officielle Carto Tchoo ;
2. estimation Carto Tchoo >= 50 % ;
3. estimation issue de l'historique persistant ;
4. aucune voie.

## Vercel Hobby

Le fichier `vercel.json` contient un cron quotidien :

```json
{
  "path": "/api/collect-platforms",
  "schedule": "0 16 * * *"
}
```

Cela respecte la fréquence quotidienne du plan Hobby.

## Ajouter Upstash Redis dans Vercel

Dans Vercel :
1. ouvrir le projet ;
2. **Storage / Marketplace** ;
3. ajouter **Upstash for Redis** ;
4. connecter la base au projet.

L'intégration doit fournir :
- `KV_REST_API_URL`
- `KV_REST_API_TOKEN`

La V2.9.4 accepte également :
- `UPSTASH_REDIS_REST_URL`
- `UPSTASH_REDIS_REST_TOKEN`

## Sécuriser le Cron

Ajouter dans **Settings > Environment Variables** :

`CRON_SECRET=une_longue_valeur_aleatoire`

Lorsque cette variable existe, `/api/collect-platforms` exige
`Authorization: Bearer <CRON_SECRET>`.

## Variables à conserver

`SNCF_API_TOKEN=...`

## Diagnostic

État du stockage/historique :

`/api/platform-history-status`

Collecte manuelle (si CRON_SECRET n'est pas défini localement) :

`/api/collect-platforms`

Test voies Arras :

`/api/tchoo-test?stopArea=stop_area:OCE87342014`

## Important

Le cron quotidien enrichit surtout une photographie des trains présents au moment
de son passage. Les consultations normales de l'application continuent donc à
alimenter l'historique tout au long de la journée.
