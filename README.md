<p align="center">
  <img src="docs/logo.svg" alt="Collabitat logo" width="96">
</p>

<h1 align="center">Collabitat API</h1>

<p align="center">Backend for Collabitat, an app for shared households: split costs, rotate chores, plan meals.</p>

<p align="center">
  <a href="https://github.com/fly-die/collabitat-api/actions/workflows/ci.yml"><img src="https://github.com/fly-die/collabitat-api/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="https://sonarcloud.io/summary/new_code?id=fly-die_collabitat-api"><img src="https://sonarcloud.io/api/project_badges/measure?project=fly-die_collabitat-api&metric=alert_status" alt="Quality gate"></a>
</p>

Frontend: [collabitat-web](https://github.com/fly-die/collabitat-web)

## Run locally

With Docker:

```sh
docker compose up --build
```

Without Docker (Node 24+):

```sh
npm install
npm run dev
```

The API listens on `http://localhost:3000`. Check it with `curl localhost:3000/health`.

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/health` | Health check |
| `POST` | `/households` | Create a household (`{ "name": "..." }`) |
| `GET` | `/households/:householdId` | Get a household with its members |
| `POST` | `/households/:householdId/members` | Add a member (`{ "name": "..." }`) |
| `DELETE` | `/households/:householdId/members/:memberId` | Remove a member |

Data is kept in memory for now and resets on restart.

## Scripts

| Command | Purpose |
|---|---|
| `npm run dev` | Start with reload |
| `npm test` | Run tests |
| `npm run test:coverage` | Run tests with coverage |
| `npm run lint` | Lint |
| `npm run build` | Compile to `dist` |

## Stack

Fastify, TypeScript, Vitest.

## License

[MIT](LICENSE). Logo uses the "cottage" icon from [Material Symbols](https://github.com/google/material-design-icons) (Apache 2.0).
