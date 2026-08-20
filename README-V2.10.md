# Trajets HDF — V2.10 Vercel

## Trains W via Carto Tchoo

Les circulations dont le numéro est compris entre **700000 et 799999** sont
identifiées comme des **W / acheminements**.

### Départs / Arrivées
La V2.10 fusionne :
- les trains voyageurs API SNCF ;
- les cars TER ;
- les circulations W 700xxx présentes dans le tableau Carto Tchoo.

Un W peut donc apparaître même s'il est absent de l'API voyageurs SNCF.

### Itinéraires
Lors d'une recherche, la V2.10 consulte également les départs Carto Tchoo de la
gare d'origine. Si un W 700xxx dessert la gare d'arrivée dans ses étapes, il est
ajouté aux résultats avec le badge `W / acheminement`.

Les W restent visuellement séparés des trains commerciaux.

### Voies
Les voies Carto Tchoo officielles / estimées / historiques sont conservées.

### Diagnostic
Exemple Arras :
`/api/tchoo-test?stopArea=stop_area:OCE87342014`

La réponse comporte maintenant :
- `wTrains`
- `wSample`

## Important
La V2.10 ne classe comme W que les numéros **700000–799999**. Elle ne transforme
pas les autres circulations techniques en W.
