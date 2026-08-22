# V2.12.6 — trains techniques 600xxx / 900xxx depuis le roulement

Le problème des versions précédentes était que les règles 600xxx/900xxx ne
faisaient que reclasser des trains déjà trouvés par SNCF/Carto Tchoo. Comme
LSA et LE-RT sont des points opérationnels, ces trains n'étaient généralement
jamais renvoyés par ces API.

La V2.12.6 ajoute une vraie source `roster-technical-trains.json`, extraite des
deux roulements Orcades intégrés.

Recherche :
- LSA <-> LE : affiche les 900000-999999 du roulement.
- LE-RT <-> LE : affiche les 600000-699999 du roulement.

Chaque résultat indique le numéro, la JS et donne accès directement au
graphique plein écran de la JS.

Les horaires sont reconstruits à partir du graphique Orcades et sont donc
signalés comme issus du roulement.
