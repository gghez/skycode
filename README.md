# skycode

A platform to control code review processes across multiple repositories.

## Setup

Requirements: Node.js 20+, Docker.

```bash
npm install
cp .env.example .env          # then set BETTER_AUTH_SECRET
npm run db:up                 # start postgres
npm run db:migrate            # create tables
npm run dev                   # http://localhost:3000
```

## Tests

```bash
npm test         # unit (Vitest)
npm run test:e2e # end-to-end (Playwright); requires db up + migrated
```
