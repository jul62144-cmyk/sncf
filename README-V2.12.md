# Trajets HDF V2.12 — Taxis et chantiers du roulement

## Taxis Orcades

Les trajets marqués `TAXI` dans le graphique MRA multiples sont extraits avec :
- la JS ;
- la page du roulement ;
- le lieu de départ et d'arrivée ;
- l'horaire imprimé dans le graphique ;
- les jours de circulation ;
- les mentions `SF`, `JQ`, `AP` et les dates exclues.

Ils sont proposés dans **Itinéraires** lorsque le départ et l'arrivée
correspondent à la recherche.

## Normalisation des chantiers

Les chantiers restent visibles, mais sont rattachés à leur gare principale.

Exemples :
- `LNS TR` -> gare de Lens, chantier TR ;
- `LNS DT` -> gare de Lens, chantier DT.

Ainsi une recherche `Lens -> Arras` peut retrouver un taxi dont le roulement
mentionne `LNS TR -> ARR`.

## Graphique de la JS

Chaque taxi comporte un bouton `JS ... / Roulement` qui ouvre directement
la page graphique Orcades et surligne la ligne de la JS concernée.

## Période

Roulement intégré : 31/08/2026 -> 12/12/2026.
