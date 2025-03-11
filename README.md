# Telegram Speed Dating Bot

Un bot Telegram permettant aux utilisateurs de faire des rencontres de manière anonyme.

## Fonctionnalités

- `/start` - Enregistrement et obtention d'un ID anonyme
- `/contact @pseudo` ou `/contact #numéro` - Envoyer une demande de contact
- `/report @pseudo` - Signaler un utilisateur suspect

## Installation

1. Clonez le repository
2. Installez les dépendances :
```bash
npm install
```

3. Créez un fichier `.env` à la racine du projet avec les variables suivantes :
```
BOT_TOKEN=your_telegram_bot_token_here
DATABASE_PATH=./data/database.sqlite
```

4. Démarrez le bot :
```bash
npm start
```

Pour le développement, utilisez :
```bash
npm run dev
```

## Structure du Projet

```
├── src/
│   ├── config/
│   │   └── database.js
│   ├── utils/
│   │   └── logger.js
│   └── index.js
├── data/
│   └── database.sqlite
├── logs/
├── .env
├── .gitignore
├── package.json
└── README.md
```

## Sécurité

- Les données des utilisateurs sont stockées de manière sécurisée dans SQLite
- Système de signalement intégré
- Communication anonyme via pseudonymes ou IDs

## Logs

Les logs sont stockés dans le dossier `logs/` :
- `error.log` - Erreurs uniquement
- `combined.log` - Tous les logs
