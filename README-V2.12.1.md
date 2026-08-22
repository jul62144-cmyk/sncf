# V2.12.1 — correctif taxis

La V2.12 ne proposait que les taxis du roulement MRA multiples valable à partir
du 31/08/2026. Pour une recherche faite avant cette date, notamment le
22/08/2026, le résultat était donc volontairement vide.

Cette version intègre deux périodes :

- LNS 171 été : 04/07/2026 -> 30/08/2026
- MRA multiples automne : 31/08/2026 -> 12/12/2026

Les taxis sont automatiquement sélectionnés dans le roulement applicable à la
date de la recherche.

Le visualiseur de JS sait également ouvrir le graphique correspondant au bon
roulement.
