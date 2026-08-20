# V2.9.7 — correctif cars TER / PWA

Cause probable du problème :
la V2.9.6 avait changé la réponse de `/api/bus-journeys` d'un tableau vers un
objet `{ journeys, diagnostics }`.

Une PWA déjà installée pouvait encore exécuter un ancien `app.js`, qui attendait
toujours un tableau. Résultat : les cars étaient reçus par le serveur mais
ignorés par l'interface.

Correctifs :
- `/api/bus-journeys` renvoie de nouveau TOUJOURS un tableau ;
- compatibilité avec les anciens frontends restaurée ;
- les diagnostics sont placés dans des headers HTTP ;
- les routes `/api/*` ne doivent plus être servies depuis le cache du service worker ;
- GTFS TER HDF + fallback SNCF Coach/Bus conservés ;
- Redis/Upstash et historique des voies inchangés.

Après déploiement, faire une fois Ctrl+F5 dans le navigateur ou fermer/réouvrir
la PWA pour charger le nouveau service worker.
