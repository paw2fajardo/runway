# Runway

Runway is a personal finance dashboard for forecasting cash runway, tracking account balances, and managing upcoming obligations. It gives a clear view of how much liquid cash is available, when bills are due, and whether a shortfall is likely in the near term.

## Overview

The app combines account balances, recurring income, and scheduled bills into a simple forecast. Instead of tracking every detail manually, Runway helps answer a few practical questions:

- How much cash is available right now?
- How long before the next payroll or income event?
- Which bills are coming due and when?
- Is the current spending pace sustainable?
- When is a cash shortfall likely to occur?

## Features

- Cash runway forecasting based on liquid accounts and recurring income streams
- Bill tracking with due dates, grace periods, and settlement states
- Reconciliation of verified account balances against expected totals
- Quick logging for expenses, transfers, and income entries
- Flexible income scheduling: weekly, biweekly, monthly, and custom intervals
- Offline-safe transaction capture using IndexedDB and background sync
- AI-assisted inbox parsing for incoming expense or transaction data
- SQLite persistence for local development and PostgreSQL in production, using Drizzle ORM

## Tech stack

- Next.js 15
- React 19
- TypeScript
- Tailwind CSS
- PostgreSQL 16
- Drizzle ORM
- Dexie for offline queueing
- Vitest for tests

## Prerequisites

- Node.js 22+
- npm
- Docker and Docker Compose (only needed for the PostgreSQL stack)

## Local setup

1. Copy the environment template:

   ```bash
   cp .env.example .env
   ```

2. Install dependencies:

   ```bash
   npm install
   ```

3. Create or update the local SQLite schema:

   ```bash
   npm run db:push
   ```

4. Optionally add sample data with `npm run db:seed`, then start the app:

   ```bash
   npm run dev
   ```

5. Open http://localhost:3000

Local development defaults to `file:runway.sqlite`; no database server is required.
If an existing `.env` or `.env.local` contains a PostgreSQL `DATABASE_URL`, change
it to `file:runway.sqlite` to use SQLite. SQLite files are ignored by Git.
Run `npm run db:push` after schema changes. Generated SQLite migrations go in
`src/db/migrations-sqlite`, separate from the PostgreSQL migrations.

Production continues to use PostgreSQL. Set `DATABASE_URL` to your PostgreSQL
connection URL for production builds, app servers, workers and database commands.
SQLite URLs are rejected when `NODE_ENV=production`. Local SQLite data is
independent of production data; this setup does not migrate or copy either.

## Docker

The repository includes a Docker Compose setup that runs the app and PostgreSQL together:

```bash
cp .env.example .env
docker compose up --build
```

This exposes:

- App: http://localhost:3000
- Postgres: localhost:5433 (or the port configured in `.env`)

## Available scripts

```bash
npm run dev
npm run build
npm run start
npm run lint
npm run test
npm run db:generate
npm run db:push
npm run db:seed
npm run db:studio
```

## Project structure

```text
.
├── src/
│   ├── app/              # Next.js app routes and API endpoints
│   ├── components/       # UI for dashboard, bills, accounts, and forecasts
│   ├── db/               # Drizzle schema and database helpers
│   └── lib/              # Forecasting logic, validation, and offline sync
├── .env.example          # Example environment variables
├── docker-compose.yml    # Local database/app orchestration
├── drizzle.config.ts     # Drizzle configuration
├── package.json          # Scripts and dependencies
├── tailwind.config.ts    # Tailwind configuration
├── tsconfig.json         # TypeScript configuration
├── README.md             # Project overview and setup guide
└── tests/                # Test files
```

## Notes

- Docker continues to configure PostgreSQL 16 for the app, worker and migration service.
- The runway forecast is driven by liquid account balances, enabled income streams, and active bills.
- If no income schedule is configured, the forecast API will return a structured setup error until the required pay settings are added.
- The app is designed for personal finance use and assumes a local or self-hosted environment rather than a multi-tenant platform.
