# Trajets SNCF Hauts-de-France — V2.3

Nouveautés :
- cars TER ajoutés aux tableaux Départs et Arrivées ;
- fusion chronologique trains + cars ;
- affichage de la voie/quai lorsqu'une source la fournit ;
- conservation de l'itinéraire Train + Car de la V2.2 ;
- PWA et favoris conservés.

Important : si l'API/GTFS ne fournit aucune voie, l'application n'en invente pas.

Installation :
1. Copier .env.example en .env
2. Ajouter le token SNCF
3. npm install
4. npm start
5. Ouvrir http://localhost:3000
