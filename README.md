# Lekker Story ERP

A restaurant accounting and operations dashboard built as a static web app for cashier, manager, and finance workflows. The project combines POS, inventory, procurement, accounting, and demo evaluation features in one interface.

## Overview

Lekker Story ERP is a front-end ERP prototype for a food and beverage business. It uses Firebase for authentication and data persistence, and is designed to run as a static site on local servers or hosted platforms such as Vercel, Netlify, or Firebase Hosting.

## Features

- POS and cashier sales workflow
- Inventory and stock tracking
- Procurement and purchasing process
- Double-entry accounting and general ledger flow
- Financial statements and reporting
- Audit-friendly demo mode for evaluation
- Clean static deployment structure

## Project structure

```text
ais-lekker-story/
├── index.html                  # Main app entry point
├── assets/
│   ├── css/
│   │   └── main.css
│   └── js/
│       ├── app.js
│       ├── menu-catalog.js
│       └── config/
│           ├── firebase.config.example.js
│           └── firebase.config.js   # local-only config, not committed
├── docs/
│   ├── ACCOUNTING.md
│   └── LECTURER_GUIDE.md
├── partials/
│   └── body.html
├── scripts/
│   ├── build-index.ps1
│   ├── gen-menu-catalog.js
│   └── index-head.html
├── .gitignore
├── README.md
├── start-server.bat
├── vercel.json
└── LICENSE (optional if added later)
```

## Demo roles

| Role | Demo email | Access |
|------|------------|--------|
| Cashier | cashier@lekker.id | POS and cash reconciliation |
| Manager | manager@lekker.id | Dashboard, inventory, procurement |
| Finance | finance@lekker.id | Accounting, AP, financial reporting |

Default password: password123

## Run locally

> Do not open the app by double-clicking index.html directly. Use a local web server instead.

### Option 1: Windows shortcut

Double-click start-server.bat in the project folder.

Then open:

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

Use the query parameter ?demo=1 to enable extra evaluation features:

```text
http://localhost:8080/?demo=1
```

## Firebase setup

This project expects a local Firebase config file that is not committed to GitHub.

1. Copy the example file:

```bash
copy assets\js\config\firebase.config.example.js assets\js\config\firebase.config.js
```

2. Fill in your Firebase project values in assets/js/config/firebase.config.js.
3. Keep this file local and private.

If the project is public, rotate any previously exposed Firebase keys before publishing.

## Deployment

### Vercel

1. Push this repo to GitHub.
2. Import the repository in Vercel.
3. Use the project root as the root directory.
4. The included vercel.json handles the static build output.

### Other static host providers

- Firebase Hosting
- Netlify
- GitHub Pages

## Documentation

- docs/ACCOUNTING.md — accounting checklist and system notes
- docs/LECTURER_GUIDE.md — lecturer/demo instructions and evaluation workflow

## Tech stack

- HTML5
- Tailwind CSS
- Vanilla JavaScript
- Firebase Auth, Firestore, and Storage
- Chart.js

## Repository status

This repo is intended to be a clean public GitHub project. The legacy duplicate file has been removed, and the current main entry point is index.html.

## License

This project does not currently include a license file. If you intend to publish it publicly, consider adding an appropriate license such as MIT.
