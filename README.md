# microscape-app

Gatekeeper web app in front of pipeline outputs from
[microscape-nf](https://github.com/rec3141/microscape-nf) and
[danaseq](https://github.com/rec3141/danaseq). Presents authenticated users
a list of the pipeline runs they have access to and streams per-run artifacts
through an auth check into an nginx-backed file delivery path.

Stack inherits from
[SampleTown-org/eDNA-SampleTown](https://github.com/SampleTown-org/eDNA-SampleTown):
SvelteKit 2 + Svelte 5 runes + Tailwind + `better-sqlite3` + `arctic` GitHub
OAuth (with a local bcrypt fallback) + `adapter-node`, deployed as a systemd
Node service behind nginx.

## Quick start

```bash
cp .env.example .env   # edit ORIGIN + GitHub OAuth credentials
npm install
npm run dev
```

On first boot the schema is applied and a seeded `admin`/`admin` account is
created (forced password change on first login). See the upstream SampleTown
docs for the shared auth/tenancy patterns.

## Access model

A user can see a run when any of:

- `run.is_public = 1` (no ACL check)
- they are an active member of the run's lab (`lab_memberships`)
- they hold a `run_access` row for the run (explicit cross-lab grant)

File delivery goes through `/runs/<id>/files/<subpath>`; on an ACL hit the
handler emits `X-Accel-Redirect` into an `internal` nginx location so nginx
serves the bytes, not Node.

## Deploy

See `microscape-app.service` and `deploy.sh`. Production config expects an
nginx reverse proxy with an `internal` `/_protected/` alias mapped into the
runs data directory.
