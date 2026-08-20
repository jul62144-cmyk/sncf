# Correctif V2.9.6 — Cars TER dans les itinéraires

La V2.9.6 rend la recherche des cars plus robuste sur Vercel.

## Changements

- la recherche d'itinéraires continue d'utiliser le GTFS officiel TER HDF ;
- ajout d'un fallback API SNCF avec les physical modes `Coach` et `Bus` ;
- le navigateur transmet désormais les IDs SNCF de la gare de départ et d'arrivée ;
- les résultats GTFS + SNCF sont fusionnés et dédupliqués ;
- le statut de recherche indique le nombre de cars TER trouvés ;
- si le GTFS échoue lors d'un cold start Vercel, l'application ne masque plus silencieusement le problème.

L'historique Redis/Upstash et les voies Carto Tchoo sont inchangés.
