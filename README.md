# Trajets HDF V2.7

V2.7 ajoute une seconde tentative de récupération des voies SNCF Gares & Connexions directement depuis le navigateur.

Le tableau indique désormais combien de voies ont réellement été récupérées :
`X circulation(s) affichée(s) • Y voie(s) récupérée(s).`

Important : si le navigateur bloque l'appel cross-origin (CORS) ou si Gares & Connexions exige sa protection DataDome, Y restera à 0. Cela permet de diagnostiquer précisément le problème sans afficher de fausses voies.

Installation :
1. conserver/remettre `.env`
2. `npm install`
3. `npm start`
4. ouvrir l'application et tester Départs > Arras
