# Trajets HDF — V2.8 publique

Version publique propre et stable.

## Fonctions
- recherche d'itinéraires SNCF ;
- cars TER Hauts-de-France ;
- tableaux Départs et Arrivées ;
- numéro de train / ligne ;
- temps réel lorsque fourni par l'API SNCF ;
- favoris ;
- PWA installable ;
- interface mobile.

## Voies / quais
La colonne Voie / Quai est conservée.
Elle est renseignée uniquement lorsqu'une source publique utilisée par l'application fournit réellement cette information.
Sinon, l'application affiche `—`.

Aucun accès Geopulse ou InPulse n'est utilisé.
Aucun cookie ou jeton SNCF professionnel n'est nécessaire.

## Sources
- API SNCF publique ;
- GTFS officiel TER Hauts-de-France.

## Installation
1. Copier `.env.example` vers `.env`
2. Ajouter `SNCF_API_TOKEN=...`
3. `npm install`
4. `npm start`
5. Ouvrir `http://localhost:3000`

Cette version est celle recommandée pour GitHub et l'hébergement public.
