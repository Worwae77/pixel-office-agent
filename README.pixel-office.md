# Pixel Office Agent

This fork turns Pixel Agents into a self-hosted multi-agent office for a
homelab. The upstream application remains intact while the provider registry,
stable roster, role orchestration, and deployment layers are added in stages.

## Current baseline

- Standalone Fastify server and browser SPA from upstream.
- Docker/Compose deployment on port `3100`.
- Persistent application state in the `pixel-office-state` volume.
- Target roster documented in `config/agents.example.json`.

## Run from source

Node.js 24.11 or newer is required by the current dependency graph.

```bash
npm ci
npm run package
npm run start:office
```

Open `http://localhost:3100`.

Use `--no-manage-hooks` when the server must receive hook events without
modifying CLI settings on the same machine. The container enables this flag by
default because agent CLIs normally run on the Docker host, not in the office
container.

## Run with Docker Compose

```bash
docker compose up --build -d
docker compose ps
```

Before exposing the service beyond a trusted LAN, put it behind TLS and an
authenticated reverse proxy. See `docs/pixel-office-architecture.md` for the
provider and security plan.
