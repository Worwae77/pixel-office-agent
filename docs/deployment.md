# Pixel Office Agent Deployment Guide

This guide provides instructions for deploying the Pixel Office Agent in a hardened production environment.

## TLS Termination via Reverse Proxy

In production, you should expose the Pixel Office server over HTTPS. Since the Fastify server runs inside a Docker container (defaulting to port `3100`), you should place a reverse proxy like Nginx, Caddy, or Traefik in front of it to handle TLS termination.

### Nginx Example Configuration

```nginx
server {
    listen 443 ssl http2;
    server_name pixel-office.example.com;

    ssl_certificate /etc/letsencrypt/live/pixel-office.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/pixel-office.example.com/privkey.pem;

    # WebSocket support
    location /ws {
        proxy_pass http://127.0.0.1:3100;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 86400s; # Prevent close on idle connections
    }

    # REST APIs
    location / {
        proxy_pass http://127.0.0.1:3100;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

---

## Rotating the Hook Token

The token used to authenticate incoming hook event requests is configured via the `PIXEL_OFFICE_HOOK_TOKEN` environment variable. To rotate this token:

1. Generate a new cryptographically secure random string (e.g., via `openssl rand -hex 32`).
2. Update the environment configuration:
   - If using docker-compose: Update `PIXEL_OFFICE_HOOK_TOKEN` in your `.env` file on the host.
3. Restart the container to apply the new environment:
   ```bash
   docker compose down
   docker compose up -d
   ```
4. Update any hook scripts or upstream clients with the new token. Any request with the old token will receive a `401 Unauthorized` response and trigger an audit log entry.

---

## Backup of `~/.pixel-agents/`

All persistent data, including character layouts, configuration persistence, and the JSONL audit logs, are stored in the state directory `~/.pixel-agents/` (inside the container, this is mounted to `/root/.pixel-agents`).

To ensure no data loss, you should regularly back up this directory.

### Backup Strategy

1. **Volume Backup**:
   If using the default `compose.yaml`, the volume `pixel-office-state` is mounted to `/root/.pixel-agents`. You can back up this volume directly using a temporary helper container:
   ```bash
   docker run --rm --volumes-from pixel-office-agent -v /var/backups/pixel-office:/backup alpine tar czf /backup/pixel-office-backup-$(date +%F).tar.gz /root/.pixel-agents
   ```

2. **Audit Log Rotation**:
   The `audit.log` appends JSONL data and can grow over time. You should configure `logrotate` on the host to rotate it. An example configuration:
   ```logrotate
   /var/lib/docker/volumes/poa_pixel-office-state/_data/audit.log {
       daily
       rotate 7
       compress
       delaycompress
       missingok
       notifempty
       copytruncate
   }
   ```
