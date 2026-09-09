# English Quest V5

Application PWA pour apprendre l'anglais avec parcours général et espace ferroviaire.

## Frontend
- A1 à B2
- test de niveau
- exercices, audio, reconnaissance vocale
- XP, séries, badges, progression
- 773+ exercices
- espace ferroviaire : vocabulaire, annonces, conducteur, dialogues
- Professeur IA : général + ferroviaire
- fallback local si le backend IA n'est pas encore connecté

## Professeur IA sécurisé
Le frontend ne contient jamais la clé API.

Le backend Node est dans `/backend`.
Variables à définir sur l'hébergeur du backend :
- `OPENAI_API_KEY`
- `OPENAI_MODEL` (optionnel)
- `ALLOWED_ORIGINS`

Une fois le backend déployé, modifier `config.js` :
```js
window.ENGLISH_QUEST_CONFIG = {
  AI_API_URL: "https://votre-backend.example.com"
};
```

## GitHub Pages
Le frontend peut être servi depuis GitHub Pages.
GitHub Pages ne peut pas exécuter le backend Node : celui-ci doit être hébergé sur un service serveur/serverless séparé.
