# Trajets HDF — V2.9.3 publique

## Collecte automatique des voies

La V2.9.3 enrichit l'historique même si aucune gare n'est recherchée dans l'application.

Tant que le serveur Node reste démarré, il interroge automatiquement toutes les 5 minutes :

- Arras
- Lens
- Douai
- Lille Flandres
- Béthune
- Hazebrouck
- Amiens
- Calais Ville
- Boulogne Ville
- Valenciennes
- Cambrai
- Saint-Quentin

Pour chaque gare, les départs et arrivées Carto Tchoo sont consultés.
Seules les voies officielles sont enregistrées dans `platform-history.json`.

## Prudence avec la source

Une pause de 500 ms est ajoutée entre les gares pour éviter d'enchaîner trop rapidement
les requêtes vers la source publique.

## Priorité d'affichage

1. voie officielle Carto Tchoo ;
2. estimation Carto Tchoo >= 50 % ;
3. estimation locale issue de l'historique ;
4. aucune voie.

## Diagnostic

Etat de la collecte automatique :

`http://localhost:3000/api/platform-history-status`

Historique et voies d'Arras :

`http://localhost:3000/api/tchoo-test?stopArea=stop_area:OCE87342014`

Important : si l'ordinateur est éteint ou le serveur `npm start` arrêté, la collecte automatique
s'arrête aussi. Sur un hébergement permanent, elle continue tant que le service Node tourne.
