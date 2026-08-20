# Trajets HDF — V2.9 publique

## Nouveauté principale : voies via Carto Tchoo

L'analyse du frontend Carto Tchoo a montré que son tableau de gare utilise
l'endpoint public :

`https://api.tchoo.net/api/carto.php?action=deparr&uic=<UIC>`

La V2.9 interroge cet endpoint côté serveur et fusionne les informations avec
les trains SNCF par numéro de train.

Quand une voie est trouvée via Carto Tchoo, la colonne Voie / Quai l'affiche
avec la mention `Tchoo`.

## Sécurité / robustesse

- aucune authentification SNCF interne ;
- aucun cookie InPulse ou Geopulse ;
- cache de 30 secondes pour limiter les appels ;
- si Carto Tchoo est indisponible ou change de format, l'application continue
  à fonctionner avec API SNCF + GTFS HDF ;
- un extracteur tolérant recherche plusieurs structures de réponse afin de
  supporter les variations de format.

## Test diagnostic

Après `npm start`, ouvrir par exemple :

`http://localhost:3000/api/tchoo-test?stopArea=stop_area:OCE87342014`

La réponse indique :
- `count` : trains détectés ;
- `withPlatform` : trains avec voie ;
- `sample` : exemples train → voie.

## Fonctions conservées
- itinéraires trains + cars TER ;
- départs / arrivées ;
- numéros de train ;
- favoris de gares dans la colonne de gauche ;
- origine / destination ;
- PWA installable.
