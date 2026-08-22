# V2.13 — résultats jusqu'à la fin de journée

## Départs / Arrivées
Le tableau SNCF n'est plus limité à 2 heures :
- la période va de l'heure choisie jusqu'à 23:59 ;
- jusqu'à 250 circulations SNCF peuvent être récupérées ;
- les cars TER GTFS ne sont plus limités à 30 résultats.

## Itinéraires
La recherche récupère les trains SNCF de l'heure choisie jusqu'à la fin du
même jour, avec collecte successive si l'API limite la taille d'une réponse.

Les limites artificielles ont également été retirées pour :
- cars TER ;
- taxis ADC ;
- taxis ASCT ;
- trains W issus des roulements.

Les circulations après minuit ne sont pas ajoutées à la journée sélectionnée.
