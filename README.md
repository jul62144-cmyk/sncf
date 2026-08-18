# Trajets SNCF Hauts-de-France — Version 2

Cette version ajoute :
- installation comme application PWA sur smartphone/tablette ;
- icône Trajets HDF ;
- interface mobile améliorée ;
- gares favorites mémorisées ;
- accès depuis les appareils du réseau local.

## Installation sur le PC

1. Décompresse le ZIP.
2. Ouvre un terminal dans le dossier `trajet-sncf-hdf-v2`.
3. Lance :
   npm install
4. Copie `.env.example` et renomme la copie en `.env`.
5. Mets ton token SNCF dans `.env`.
6. Lance :
   npm start
7. Ouvre :
   http://localhost:3000

## Depuis smartphone ou tablette sur le même Wi-Fi

Sur le PC, lance :

   ipconfig

Repère l'adresse IPv4 du PC, par exemple `192.168.1.25`.

Sur le smartphone/tablette, ouvre alors :

   http://192.168.1.25:3000

## Installation sur l'écran d'accueil

### Android / Chrome
Menu ⋮ → Ajouter à l'écran d'accueil / Installer l'application.

### iPhone / iPad / Safari
Partager → Sur l'écran d'accueil → Ajouter.

## Important

Pour une installation PWA complète, les navigateurs modernes exigent généralement HTTPS,
sauf en accès local sur `localhost`. Sur un smartphone accédant au PC via une IP locale en HTTP,
l'application fonctionne dans le navigateur mais l'installation PWA peut être limitée selon le navigateur.

Pour que l'application soit installable partout et fonctionne même PC éteint, il faudra l'héberger en HTTPS.
