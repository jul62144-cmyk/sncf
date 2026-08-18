# Trajets SNCF Hauts-de-France — V2.2

Fonctions :
- Itinéraire train + cars TER directs (fonction V2.1)
- Tableau des départs d'une gare
- Tableau des arrivées d'une gare
- Heure, numéro/libellé, destination/origine
- Retard affiché lorsque l'API SNCF renvoie une heure réelle différente de l'heure de base
- PWA installable, favoris et interface mobile

## Installation
1. Copier `.env.example` en `.env`.
2. Remettre le token SNCF dans `.env`.
3. npm install
4. npm start
5. Ouvrir http://localhost:3000

Les tableaux Départs/Arrivées SNCF utilisent l'API SNCF.
Les cars TER de la recherche d'itinéraire utilisent le GTFS officiel Hauts-de-France.
