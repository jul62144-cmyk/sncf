# Trajets SNCF Hauts-de-France — V2.5

Nouveautés :
- ajout de SNCF Gares & Connexions comme source publique des voies ;
- fusion par numéro de train entre le tableau SNCF et Gares & Connexions ;
- `platform.track` est utilisé pour afficher la voie ;
- `platform.isTrackactive` est indiqué par un ✓ ;
- cars TER HDF conservés dans Itinéraire, Départs et Arrivées ;
- aucune donnée Geopulse ou authentification interne.

Sources :
- API SNCF publique : horaires et circulations ;
- GTFS officiel Hauts-de-France : cars TER ;
- Gares & Connexions public : voies/quais.

Installation :
1. Copier `.env.example` vers `.env`
2. Ajouter `SNCF_API_TOKEN`
3. `npm install`
4. `npm start`
5. Ouvrir `http://localhost:3000`

Remarque :
Si Gares & Connexions refuse une requête serveur (protection anti-bot ou changement de format),
l'application continue de fonctionner avec les autres sources et affiche la voie comme indisponible.
