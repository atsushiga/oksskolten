# Deploying to [Fly.io](http://Fly.io)

This guide walks through deploying Oksskolten on [Fly.io](https://fly.io) with [Turso](https://turso.tech) as the database. Both services offer free tiers that are more than enough for a personal RSS reader.

## Why Fly.io + Turso?

Oksskolten uses SQLite (via libsql), which means it needs a persistent disk. Fly.io's volumes work but are tied to a specific host — if the VM moves, you lose your data. Turso solves this by hosting your libsql database as a managed service. The app already supports Turso out of the box (no code changes needed).


| Component | Service                      | Free Tier                        |
| --------- | ---------------------------- | -------------------------------- |
| App       | Fly.io                       | 3 shared VMs, 256MB each         |
| Database  | Turso                        | 9GB storage, 10B row reads/month |
| Search    | Meilisearch Cloud (optional) | 10K documents                    |


## Prerequisites

```bash
brew install flyctl        # Fly.io CLI
brew install tursodatabase/tap/turso  # Turso CLI
```

## 1. Create a Turso Database

Turso **location IDs** are not the same as Fly.io region codes. For example Fly uses `nrt` (Tokyo area) in `fly.toml`, but `turso db create ... --location nrt` will fail — use an ID from Turso’s list instead.

List supported IDs (add `--show-latencies` to rank them from your network):

```bash
turso auth login
turso db locations
```

Create the database:

```bash
# Default: Turso picks the closest region to you
turso db create oksskolten

# Or pick a region explicitly (replace <location-id> with a value from `turso db locations`)
turso db create oksskolten --location <location-id>
```

If you use [database groups](https://docs.turso.tech/cli/db/create), create a group in a specific location first, then create the DB in that group:

```bash
turso group create oksskolten-group --location <location-id>
turso db create oksskolten --group oksskolten-group
```

Tokens and connection URL:

```bash
turso db tokens create oksskolten
turso db show oksskolten --url              # Copy the libsql:// URL
```

## 2. Set Up Fly.io

```bash
fly auth login
```

Create `fly.toml` in the project root (or use the one shipped with this repo):

```toml
app = "oksskolten"
primary_region = "nrt"

[build]
  dockerfile = "Dockerfile"

[env]
  NODE_ENV = "production"
  PORT = "3000"

[http_service]
  internal_port = 3000
  force_https = true
  auto_stop_machines = false    # Keep running for cron
  auto_start_machines = true
  min_machines_running = 1

[[vm]]
  size = "shared-cpu-1x"
  memory = "512mb"
```

Note: `auto_stop_machines = false` is important — Oksskolten runs a cron job (feed fetching every 5 minutes) that needs the VM to stay alive.

Create the Fly app **before** creating volumes or deploying. The name must match the `app` field in `fly.toml`:

```bash
fly apps create oksskolten   # or: fly apps create <name-from-fly.toml>
```

If you use **Turso** as in section 1, you **do not** need Fly volumes or a `[mounts]` block — skip the following and keep `DATABASE_URL` pointed at Turso (omit `[mounts]` from `fly.toml` if your file still has it).

If `fly.toml` includes `[mounts]` (persistent disk for **local SQLite on Fly**, instead of Turso), create the volume **after** the app exists, from the project root (so `fly.toml` is picked up) or with `-a <app>`:

```bash
fly volumes create oksskolten_data --size 1 --region nrt -a <app>
```

Use the same values as `source` in `[mounts]` and `primary_region` in `fly.cotoml` (example above uses `oksskolten_data` and `nrt`).

## 3. Set Secrets

```bash
fly secrets set \
  DATABASE_URL=libsql://oksskolten-<your-org>.turso.io \
  TURSO_AUTH_TOKEN=<token> \
  JWT_SECRET=$(openssl rand -hex 32)
```

## 4. Deploy

```bash
fly deploy
```

That's it. Visit `https://oksskolten.fly.dev` and create your account.

## Optional Services

All sidecar services (Meilisearch, RSS Bridge, FlareSolverr) are **optional**. The app runs fine without them — features degrade gracefully:


| Service      | Without It                               | With It                         |
| ------------ | ---------------------------------------- | ------------------------------- |
| Meilisearch  | No full-text search                      | Search across all articles      |
| RSS Bridge   | No feed auto-discovery for non-RSS sites | CSS selector-based feeds        |
| FlareSolverr | JS-heavy sites may fail to fetch         | Bot bypass via headless browser |


To add Meilisearch later, sign up for [Meilisearch Cloud](https://www.meilisearch.com/cloud) and set:

```bash
fly secrets set MEILI_URL=https://ms-xxx.meilisearch.io MEILI_MASTER_KEY=<key>
```

## Useful Commands

```bash
fly status          # Check app status
fly logs            # Tail logs
fly ssh console     # SSH into the VM
fly secrets list    # List configured secrets
```

## Troubleshooting

### `failed to list volumes: app not found`

`fly volumes create` attaches a volume to a Fly **application**. The CLI resolves the app from `fly.toml` in the current directory (or `-a <app>`). This error means Fly.io has **no app with that name** for your logged-in account (or you are on the wrong org / wrong directory).

**Check:**

1. `fly apps list` — confirm the app from `fly.toml` appears.
2. Run volume commands from the project root where `fly.toml` lives, or pass `-a <app>` explicitly.
3. `fly orgs list` / dashboard — confirm you are using the intended organization.

**Fix:** Create the app first, then create the volume:

```bash
fly apps create <app>   # same as `app` in fly.toml
fly volumes create <volume-name> --size 1 --region <primary_region> -a <app>
```

Then deploy with `fly deploy` (or your CI workflow).

## Comparison with Docker Compose


|            | Docker Compose (NAS/VPS) | Fly.io + Turso            |
| ---------- | ------------------------ | ------------------------- |
| Setup      | `docker compose up`      | `fly deploy`              |
| Database   | Local SQLite file        | Managed Turso             |
| Sidecars   | All included             | Add individually          |
| Search     | Meilisearch container    | Meilisearch Cloud or skip |
| Cost       | Hardware/VPS cost        | Free tier                 |
| Backup     | Manual                   | Turso handles it          |
| Monitoring | `docker compose logs`    | `fly logs` + dashboard    |


