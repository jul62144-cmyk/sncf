# V2.12.5 — recherche par abréviation SNCF

La recherche de gare utilise maintenant le lexique SNCF fourni.

Exemples :
- `LNS` -> `LNS-BV — Lens (gare)`
- `SPT` -> `SPT — Saint-Pol-sur-Ternoise`
- `LE` -> `LE — Lille Flandres`
- `LSA` -> `LSA — Lille Saint-Sauveur`

Une abréviation de gare normale est résolue vers le vrai stop_area SNCF afin
que les itinéraires restent utilisables.

Chantiers maintenus :
- LNS-TR -> Lens Triage
- LNS-DT / LNS-DP -> Lens Dépôt
- LE-RT -> Garages TER
