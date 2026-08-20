# Trajets SNCF Hauts-de-France — V2.6

## Nouveautés
- nouvelle interface inspirée du tableau validé dans la conversation ;
- numéro de train affiché dans Départs / Arrivées ;
- voie/quai récupéré directement depuis le tableau public SNCF Gares & Connexions ;
- Gares & Connexions devient la source prioritaire du tableau train ;
- API SNCF publique utilisée comme solution de repli ;
- cars TER HDF toujours fusionnés avec les trains ;
- numéro de train et voies départ/arrivée ajoutés aux détails d'itinéraire lorsqu'ils sont disponibles.

## Sources
- API SNCF publique
- GTFS officiel TER Hauts-de-France
- SNCF Gares & Connexions : `/schedule-table/Departures/<UIC>` et `/schedule-table/Arrivals/<UIC>`

## Installation
1. Copier `.env.example` en `.env`
2. Ajouter le token : `SNCF_API_TOKEN=...`
3. `npm install`
4. `npm start`
5. Ouvrir `http://localhost:3000`

## Remarque
Le tableau Gares & Connexions est surtout destiné aux circulations proches de l'heure courante.
Pour une date/heure future non couverte par ce tableau, l'application peut revenir aux données API SNCF.
