# Trajets SNCF Hauts-de-France

Petite application web pour rechercher un trajet SNCF entre deux gares, avec horaires, durée et correspondances.

## Prérequis
- Node.js 18 ou plus récent
- Un token de l'API SNCF

## Installation sous Windows

1. Décompresse le dossier.
2. Ouvre un terminal dans le dossier `trajet-sncf-hdf`.
3. Lance :
   npm install
4. Copie `.env.example` et renomme la copie en `.env`.
5. Dans `.env`, remplace :
   SNCF_API_TOKEN=colle_ton_token_api_sncf_ici
   par ton token SNCF.
6. Lance :
   npm start
7. Ouvre :
   http://localhost:3000

## Utilisation
- Commence à taper une gare, par exemple `Arras`.
- Clique obligatoirement sur la gare proposée.
- Choisis la gare d'arrivée.
- Sélectionne date et heure.
- Clique sur `Rechercher les trains`.
- Clique sur un résultat pour afficher le détail.

## Architecture
- `server.js` : petit serveur Node/Express et passerelle vers l'API SNCF.
- `public/index.html` : interface.
- `public/app.js` : recherche de gares et affichage des itinéraires.
- `public/style.css` : mise en page.

Le token API reste côté serveur et n'est donc pas exposé dans le navigateur.
