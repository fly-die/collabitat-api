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

With Docker (API and Postgres):

```sh
docker compose up --build
```

Without Docker (Node 24+), data is kept in memory:

```sh
npm install
npm run dev
```

Set `DATABASE_URL` to use Postgres instead. Migrations run on startup.

The API listens on `http://localhost:3000`. Check it with `curl localhost:3000/health`.

## Deploy

Runs on any Ubuntu 24.04 server: Postgres, the API and [Caddy](https://caddyserver.com) for HTTPS, defined in `deploy/`.

1. Prepare the server once, with the public half of a deploy key:

   ```sh
   ssh root@<host> 'bash -s' -- "$(cat deploy_key.pub)" < deploy/setup-server.sh
   ```

2. In the repository settings under Actions, set:

   | Name | Kind | Value |
   |---|---|---|
   | `DEPLOY_SSH_KEY` | secret | Private half of the deploy key |
   | `DEPLOY_HOST` | variable | Server address |
   | `DEPLOY_KNOWN_HOSTS` | variable | Output of `ssh-keyscan <host>` |
   | `API_DOMAIN` | variable | Domain pointing to the server, e.g. `203-0-113-7.sslip.io` |
   | `WEB_ORIGINS` | variable | Optional, defaults to `https://fly-die.github.io` |

Every push to `main` that passes CI is then deployed. Without `API_DOMAIN` the deploy job is skipped.

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/health` | Health check |
| `POST` | `/households` | Create a household and an account (`{ "name": "...", "memberName": "...", "email": "...", "password": "..." }`) |
| `GET` | `/invites/:inviteCode` | Household name and flatmates who have not joined yet |
| `POST` | `/invites/:inviteCode/members` | Join under a new name with an account (`{ "name": "...", "email": "...", "password": "..." }`) |
| `POST` | `/invites/:inviteCode/members/:memberId/join` | Join as a flatmate someone already added (`{ "email": "...", "password": "..." }`) |
| `POST` | `/sessions` | Log in (`{ "email": "...", "password": "..." }`), 5 tries per email per minute |
| `DELETE` | `/session` | Log out |
| `POST` | `/household/account` | Add an account for a flatmate who joined before accounts existed |
| `GET` | `/household` | Your household with its members |
| `POST` | `/household/members` | Add a flatmate (`{ "name": "..." }`) |
| `DELETE` | `/household/members/:memberId` | Remove a flatmate who is not part of any expense |
| `GET` | `/household/expenses` | Expenses (newest first) and everyone's balance |
| `POST` | `/household/expenses` | Add an expense, split equally (see below) |
| `DELETE` | `/household/expenses/:expenseId` | Delete an expense |

Creating, joining or logging in returns a `token`. Send it as `Authorization: Bearer <token>` to the `/household` endpoints.

An expense looks like `{ "description": "Groceries", "amountCents": 4550, "paidByMemberId": "...", "splitBetweenMemberIds": ["..."], "spentOn": "2026-10-30" }`. Amounts are whole cents. Leftover cents of an uneven split go to the first members, so shares always add up. A positive balance means the household owes that member.

## Scripts

| Command | Purpose |
|---|---|
| `npm run dev` | Start with reload |
| `npm test` | Run tests |
| `npm run test:coverage` | Run tests with coverage |
| `npm run lint` | Lint |
| `npm run build` | Compile to `dist` |

## Stack

Fastify, TypeScript, PostgreSQL, Drizzle, Vitest.

## License

[MIT](LICENSE). Logo uses the "cottage" icon from [Material Symbols](https://github.com/google/material-design-icons) (Apache 2.0).
