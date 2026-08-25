# V2.13.3 — archive Vercel FLAT

Cette archive est volontairement construite sans dossier parent.

À la racine du ZIP se trouvent directement :
- package.json
- server.js
- vercel.json
- api/
- public/

Le but est que « Add files via upload » remplace directement les fichiers
existants du dépôt, notamment `public/index.html`, au lieu d'ajouter un
sous-dossier `trajet-sncf-hdf-v2.3/`.

Le badge visible doit afficher `v2.13.3`.

Redeploi force depuis le commit sain restaure.
