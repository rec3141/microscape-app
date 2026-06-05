# microscape-app

Web portal in front of bioinformatics-pipeline outputs: lab-admins register
pipeline runs, grant access, and pipelines push new output bundles directly
from CI via a bearer-token API. The primary deployment serves
[microscape.app](https://microscape.app) as the permissioned portal for the
[microscape-nf](https://github.com/rec3141/microscape-nf) and
[danaseq](https://github.com/rec3141/danaseq) pipelines.

## Stack

Inherits its auth/tenancy machinery from
[SampleTown-org/eDNA-SampleTown](https://github.com/SampleTown-org/eDNA-SampleTown):
SvelteKit 2 + Svelte 5 runes + Tailwind + `better-sqlite3` + `arctic` GitHub
OAuth (with a local bcrypt fallback) + `adapter-node`, deployed as a systemd
Node service behind nginx, with on-disk run directories under a `RUNS_ROOT`
tree served via `X-Accel-Redirect` so bulk bytes never flow through Node.

## Access model

Every run belongs to one lab and carries one `visibility` value. None of
the visibility modes move the run between labs — audience is a property
of the run itself, decoupled from ownership.

**Visibility modes** (`runs.visibility`):

- `private` (default) — only members of the owning lab can read.
- `shared` — any signed-in user, in any lab, can read.
- `public` — anyone on the internet can read, no login required.

**Per-user grants** (`run_access`) overlay additional read access on top
of the visibility mode — e.g. a `private` run with two specific
cross-lab collaborators invited explicitly.

**Edit access** is unchanged: only admins of the owning lab
(`lab_memberships.role = 'admin'`) can reach `/settings/runs/<id>`.
Visibility never grants edit rights; per-user grants are read-only.

Runs are reached at two URLs, both with identical visibility checks:

| URL | Purpose |
|---|---|
| `/<slug>/` | Canonical user-facing URL. What lab viz SPAs are built to target. |
| `/runs/<id>/files/` | Id-addressed equivalent, useful for stable deep-links. |

Both trailing-slash-redirect bare slug URLs so relative asset URLs in SPAs
(`./assets/…`, `./data/…`) resolve correctly.

## Admin surface

Lab-admin-only, under `/settings/`:

- **Runs** — register/edit/delete runs, set visibility (private / all
  signed-in users / public web), manage per-user read grants.
- **Invites** — one-time invite URLs scoped to a role + lab.
- **Users** — list members, change roles, reset local passwords, remove
  members.
- **API keys** — mint bearer tokens for pipelines to deploy runs (see below).
- **Feedback** — triage messages submitted via the in-app feedback form.

## Pipeline ingest API

Pipelines push built run bundles through a single-request tarball upload.

```
POST /api/v1/deploy
Authorization: Bearer mk_...
Content-Type: application/gzip
X-Microscape-Slug: <run-slug>                (required)
X-Microscape-Pipeline: <pipeline-slug>       (required, e.g. danaseq-nanopore-live)
X-Microscape-Name: "<display name>"          (optional, defaults to slug)
X-Microscape-Description: "<one-liner>"      (optional)
X-Microscape-Visibility: private|shared|public  (optional, default 'private')
<body: tar.gz of the deploy tree>
```

Tarball layout (flat root):

```
index.html
assets/...
data/*.json.gz        # viz data, pre-compressed (see below)
```

The server streams the body through `tar -xzf -` into an isolated temp
directory under `INGEST_TMP` (defaults to `/data/tmp`), then
`rsync -a --delete` into `<RUNS_ROOT>/<slug>/` for a near-atomic swap. On
success the `runs` row is upserted (same slug → same row), and the response
returns the run id, URL, and file count:

```json
{ "run_id": "…", "slug": "genice_ci", "url": "https://microscape.app/genice_ci/", "files": 42 }
```

**Visibility values:**

- `private` (default) — lab-only.
- `shared` — any signed-in user, in any lab, can read; login wall still applies.
- `public` — anyone on the internet can read. The run STAYS in the key's owning
  lab — only the audience changes. Requires the API key to have
  `can_publish_public=1` (toggle per-key at `/settings/api-keys`); a key without
  that capability is rejected with 403.

**Mint a key** at `/settings/api-keys` — it's shown once, stored sha256-hashed
server-side. Keys are lab-scoped (any key in a lab has the same deploy
surface as a lab-admin). Revoked keys stop authenticating on the next
request.

**Serving .gz data files**: files ending in `.<known>.gz` (`.json.gz`,
`.tsv.gz`, …) are served with `Content-Type: <inner>` and
`Content-Encoding: gzip`, so the browser decodes transparently. Pipelines
that ship plain `.json` files will also work but should gzip on build:

```bash
find <deploy-root>/data -type f \( -name '*.json' -o -name '*.tsv' \) \
  -exec gzip -f {} +
```

### Example: danaseq

See `nanopore_live/viz/deploy.sh` in
[rec3141/danaseq](https://github.com/rec3141/danaseq) for the canonical
pipeline-side deploy driver (build viz → bundle preprocess JSONs into
`dist/data/` → tar → POST). The run's `preprocess.py` output directory and
the slug are the only required inputs.

## Environment

| Var | Default | Notes |
|---|---|---|
| `DB_PATH` | `data/microscape.db` | SQLite file |
| `ORIGIN` | `http://localhost:5173` | Public URL; must match exactly for CSRF + cookie-Secure |
| `AUTH_MODE` | `local` | `local`, `github`, or `hybrid` |
| `GITHUB_CLIENT_ID` / `_SECRET` | — | Required if `AUTH_MODE` is `github`/`hybrid` |
| `DEFAULT_LAB_NAME` | `microscape` | Seed label for the first lab created on a fresh DB |
| `RUNS_ROOT` | — | Directory under which runs are served + ingested. Required in prod. |
| `X_ACCEL_PREFIX` | — | Internal nginx URI prefix for file delivery (e.g. `/_protected/`). When unset, Node streams files itself (dev only). |
| `INGEST_TMP` | `/data/tmp` | Scratch dir for tarball extraction; must be on the same filesystem as `RUNS_ROOT` for fast rsync moves |
| `BODY_SIZE_LIMIT` | — | Bump to `10000000000` (10 GB) to allow large run uploads |
| `ADDRESS_HEADER` / `XFF_DEPTH` | — | Set when running behind nginx so rate-limiting sees real client IPs |

## Dev

```bash
cp .env.example .env        # set ORIGIN, AUTH_MODE, etc.
npm install
npm run dev
```

First boot seeds a default lab and an `admin/admin` user; the first login
forces a password change. Bootstrap from a private network before exposing
the app publicly.

## Production (reference deploy: arbutus)

Build + service:

```
# On the server
git clone https://github.com/rec3141/microscape-app /opt/microscape-app
cd /opt/microscape-app
npm ci
npm run build

# systemd unit — see microscape-app.service in this repo
sudo cp microscape-app.service /etc/systemd/system/
sudo systemctl enable --now microscape-app
```

nginx configuration must:

- `proxy_pass` the public vhost to `127.0.0.1:3100` (or whatever `PORT` is)
- Provide an `internal` location pointed at `RUNS_ROOT` for
  `X-Accel-Redirect` to resolve against:

  ```nginx
  location /_protected/ {
      internal;
      alias /data/web/microscape.app/;  # = RUNS_ROOT with trailing slash
      autoindex off;
  }
  ```

- Raise `client_max_body_size` (e.g. `10G`) and the proxy read/send timeouts
  (30 min) so large ingest uploads don't truncate.

For subsequent deploys: `./deploy.sh` at the repo root (expects `arbutus`
ssh alias and push access to the repo). Pulls, rebuilds, restarts the unit.

## Repo layout

```
src/
├── hooks.server.ts                 auth + CSP + gating
├── lib/server/
│   ├── auth.ts  db.ts  github.ts   session, users, per-lab GitHub backup
│   ├── api-keys.ts                 mint + verify bearer tokens
│   ├── serve-run-file.ts           shared file-serving w/ X-Accel + .gz handling
│   └── schemas/                    zod bodies for every API endpoint
├── routes/
│   ├── [slug]/[...subpath]/        slug-based file delivery (public)
│   ├── runs/[id]/                  run view + /files/ id-addressed delivery
│   ├── api/
│   │   ├── runs/  keys/            admin CRUD for runs + API keys
│   │   └── v1/deploy/              bearer-token tarball ingest
│   └── settings/                   admin UIs (runs / invites / users / keys / feedback)
└── app.html  app.css               chrome
```
