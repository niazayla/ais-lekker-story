# Lekker Story ERP

A static ERP and POS web app designed for restaurant accounting workflows, including cashier operations, inventory, procure-to-pay (P2P), general ledger, reporting, and lecturer/demo modes.

## Project overview

This project is built as a front-end application with Firebase for authentication and data storage. It is intended to run as a static site and can be deployed to GitHub Pages, Vercel, Netlify, or Firebase Hosting.

## Key features

- POS and cashier workflow
- Inventory and stock management
- Purchase orders, GRN, and AP workflow
- Double-entry accounting and trial balance
- Financial statements and monitoring dashboard
- Demo mode for lecturer evaluation
- Local web-server requirement to avoid file:// loading issues

## Repository structure

```text
ais-lekker-story/
├── index.html                  # Generated app entry file
├── index (3).html              # Legacy backup / earlier monolith
├── assets/
│   ├── css/
│   │   └── main.css
│   └── js/
│       ├── app.js
│       └── config/
│           ├── firebase.config.example.js
│           └── firebase.config.js   # local-only, ignored by Git
├── docs/
│   ├── ACCOUNTING.md
│   └── LECTURER_GUIDE.md
├── partials/
│   └── body.html
├── scripts/
│   ├── build-index.ps1
│   └── index-head.html
├── README.md
├── start-server.bat
├── vercel.json
└── .gitignore
```

## Roles in the demo app

| Role | Demo email | Main access |
|------|------------|-------------|
| Cashier | cashier@lekker.id | POS, shift closing, cash reconciliation |
| Manager | manager@lekker.id | Dashboard, inventory, purchasing, recipes |
| Finance | finance@lekker.id | AP, GL, financial statements |

Default demo password: password123

## Quick start

> Important: do not open the app directly with index.html in the browser. Use a local web server.

### Option 1: Windows shortcut

Double-click start-server.bat in the project folder. It will launch:

http://localhost:8080

### Option 2: Python

```bash
cd path/to/ais-lekker-story
python -m http.server 8080
```

Then open:

http://localhost:8080

### Option 3: Node.js

```bash
cd path/to/ais-lekker-story
npx serve -l 8080
```

### Demo mode

Add the URL parameter ?demo=1 to enable lecturer/demo functions:

http://localhost:8080/?demo=1

This is helpful for testing reset flows and sample data loading.

## Firebase setup for GitHub upload

Before uploading to GitHub, keep your real Firebase credentials local and do not commit them.

1. Copy the example file to your local config:

```bash
copy assets\js\config\firebase.config.example.js assets\js\config\firebase.config.js
```

2. Update the values in assets/js/config/firebase.config.js with your own Firebase project settings.
3. Keep this file local; it is ignored by Git via .gitignore.

If you are publishing a public repository, rotate the credentials if they were already exposed before.

## Deployment notes

### Vercel

1. Push the repo to GitHub.
2. In Vercel, choose Import Project.
3. Use the repository root as the project root.
4. The included vercel.json already sets the build command and static output.

### Other static hosts

- Firebase Hosting: use the project root as the public directory.
- Netlify / GitHub Pages: use the same root folder after building index.html.

## Documentation

- docs/ACCOUNTING.md – accounting checklist and operational notes
- docs/LECTURER_GUIDE.md – demo and evaluation guidance

## Tech stack

- HTML5
- Tailwind CSS via CDN
- Vanilla JavaScript (ES modules)
- Firebase Auth, Firestore, and Storage
- Chart.js for dashboards

## GitHub upload steps

```bash
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO.git
git push -u origin main
```

If you want, I can also help you set up the repository name and generate the exact Git commands for your GitHub account.
