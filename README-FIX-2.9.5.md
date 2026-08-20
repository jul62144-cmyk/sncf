# Correctif V2.9.5

La recherche de trajets était cassée car `/api/journeys` appelait encore deux
anciennes fonctions supprimées lors du retrait de Gares & Connexions :

- `normalizeTrainNumber()`
- `findTrackForTrain()`

Cela provoquait une erreur serveur avant que les trajets soient renvoyés.

La V2.9.5 :
- rétablit la recherche de trajets ;
- utilise `normalizeTrainNumberTchoo()` ;
- récupère éventuellement les voies via Carto Tchoo ;
- n'empêche jamais l'affichage d'un trajet si la voie est indisponible ;
- conserve Upstash Redis, le Cron Vercel et l'historique persistant de la V2.9.4.
