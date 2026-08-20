# Trajets SNCF Hauts-de-France — V2.4

Corrections :
- cars TER corrigés dans la recherche d'itinéraire ;
- même rapprochement OCECar que dans Départs/Arrivées ;
- recherche plus profonde des informations de quai/voie côté API SNCF ;
- affichage explicite « Voie non disponible » si la source ne fournit pas cette information.

Installation :
1. Copier .env.example en .env
2. Ajouter le token SNCF
3. npm install
4. npm start
5. Ouvrir http://localhost:3000
