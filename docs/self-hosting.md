# Self-hosting

Sofra is one Node process. It needs a persistent directory for its data and, if people
reach it over the internet, a reverse proxy with TLS that forwards WebSocket upgrades on
`/collab`.

## Reverse proxy

Caddy:

```
sofra.example.com {
    reverse_proxy localhost:8787
}
```

Caddy forwards WebSocket upgrades on its own.

nginx:

```nginx
server {
    listen 443 ssl;
    server_name sofra.example.com;
    # ssl_certificate ...;

    client_max_body_size 11m;

    location /collab {
        proxy_pass http://127.0.0.1:8787;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 1h;
    }

    location / {
        proxy_pass http://127.0.0.1:8787;
        proxy_set_header Host $host;
    }
}
```

Behind a proxy every request comes from the proxy's address. Set `SOFRA_TRUST_PROXY_HOPS`
to the number of proxies in front of Sofra (1 for Caddy, nginx or Coolify alone, 2 with
Cloudflare in front) so rate limits see the real client address.

## Backups

Everything lives in the data directory (`/data` in Docker):

- `sofra.db` (SQLite, WAL mode; back up `sofra.db-wal` too, or stop the server first)
- `secret` (signs tokens for password-protected spaces; losing it only means members type
  the password again)
- `files/` (uploads)

A consistent copy while running: `sqlite3 sofra.db ".backup backup.db"`, plus `files/`.

## Upgrading

Pull the new code, rebuild and restart:

```sh
git pull
docker compose up -d --build
```

Open documents are saved on shutdown (SIGTERM), so a normal restart loses nothing.
