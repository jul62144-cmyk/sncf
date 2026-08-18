# Trajets HDF V2 — version Vercel

Cette archive est la V2 adaptée à Vercel.

## Fichiers à envoyer sur GitHub
Envoie tout le contenu de ce dossier dans le dépôt `trajets-hdf`.

Ne publie PAS ton fichier `.env`.

## Variable à ajouter dans Vercel
Dans le projet Vercel :
Settings → Environment Variables

Nom :
SNCF_API_TOKEN

Valeur :
ton token API SNCF

Active la variable pour Production (et Preview si souhaité), puis sauvegarde.

## Redéploiement
Après mise à jour du dépôt GitHub, Vercel redéploie normalement automatiquement.
Si nécessaire :
Deployments → dernier déploiement → Redeploy.

## Test
Une fois le déploiement terminé :
1. ouvre l'URL Vercel ;
2. cherche une gare de départ ;
3. choisis une proposition ;
4. cherche une gare d'arrivée ;
5. lance la recherche.

Le token SNCF reste côté serveur et n'est pas envoyé au navigateur.
