# Trajets HDF — V2.10.1

## Détection anticipée des trains W

Les trains W sont identifiés uniquement dans la plage **700000–799999**.

La version ajoute deux niveaux :

1. **W confirmé / prévu Carto Tchoo**
   - s'il est déjà présent dans le tableau de départ Carto Tchoo ;
   - même si son heure de départ est encore dans le futur ;
   - affichage `W prévu / acheminement`.

2. **W en cours / proche**
   - même source, mais départ non futur ;
   - affichage `W / acheminement`.

## Diagnostic

Pour savoir combien de W Carto Tchoo expose à l'avance :

`/api/w-scan?stopArea=stop_area:OCE87342014&hours=12`

La réponse indique :
- `countAllW`
- `countFutureW`
- `futureW`
- `minutesAhead`

Cela permet de mesurer réellement combien de temps avant circulation les W
apparaissent dans Carto Tchoo.

## Itinéraires

Lors d'une recherche entre deux gares, un W 700xxx présent dans Carto Tchoo est
ajouté s'il dessert la gare d'arrivée d'après ses étapes.

## Important

Cette version n'invente pas de W à partir de l'historique. Elle n'affiche comme
`W prévu` qu'une circulation déjà exposée par Carto Tchoo.
