# Docker deployment

This guide deploys Runway to a Docker host with Portainer and PostgreSQL. The app and payday worker use separate images built from the repository's multi-stage `Dockerfile`. PostgreSQL data is stored in a named volume.

## 1. Build and publish the images

On a machine with Docker running, from the repository root:

```sh
docker login
sh ./docker_deploy.sh
```

The script builds and pushes both images:

- `paw2fajardo/runway:latest` — Next.js app
- `paw2fajardo/runway-worker:latest` — payday worker and Drizzle CLI

Wait for both pushes to finish successfully before deploying. Keep `docker_deploy.sh` saved with LF line endings so it runs correctly under Bash on Windows.

## 2. Deploy the Portainer stack

In Portainer, create or update a Stack and use this Compose file. Replace the database password and session secret with strong unique values. The password in `DATABASE_URL` must be URL-encoded if it contains reserved URL characters such as `@`, `:`, `/`, `?`, or `#`; keep the original password in `POSTGRES_PASSWORD`.

```yaml
services:
  db:
    image: postgres:16-alpine
    restart: unless-stopped
    environment:
      POSTGRES_USER: app_user
      POSTGRES_PASSWORD: REPLACE_WITH_STRONG_DATABASE_PASSWORD
      POSTGRES_DB: finance_platform
    volumes:
      - postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U \"$${POSTGRES_USER}\" -d \"$${POSTGRES_DB}\""]
      interval: 5s
      timeout: 5s
      retries: 5

  migrate:
    image: paw2fajardo/runway-worker:latest
    restart: "no"
    depends_on:
      db:
        condition: service_healthy
    environment:
      DATABASE_URL: "postgres://app_user:URL_ENCODED_DATABASE_PASSWORD@db:5432/finance_platform"
    command: ["npm", "run", "db:push", "--", "--config=drizzle.config.ts"]

  app:
    image: paw2fajardo/runway:latest
    restart: unless-stopped
    depends_on:
      migrate:
        condition: service_completed_successfully
    environment:
      DATABASE_URL: "postgres://app_user:URL_ENCODED_DATABASE_PASSWORD@db:5432/finance_platform"
      NEXTAUTH_SECRET: REPLACE_WITH_LONG_RANDOM_SECRET
      APP_ORIGIN: "https://runway.fajioautomata.com"
      OPENROUTER_API_KEY: ""
      PORT: "3000"
    ports:
      - "9999:3000"

  payday-worker:
    image: paw2fajardo/runway-worker:latest
    restart: unless-stopped
    depends_on:
      migrate:
        condition: service_completed_successfully
    environment:
      DATABASE_URL: "postgres://app_user:URL_ENCODED_DATABASE_PASSWORD@db:5432/finance_platform"
      VAPID_PUBLIC_KEY: ""
      VAPID_PRIVATE_KEY: ""
      VAPID_SUBJECT: "mailto:admin@localhost"

volumes:
  postgres_data:
```

The `migrate` service applies the Drizzle schema before the app or worker starts. Its logs should end with `[✓] Changes applied`, and the container should exit with code `0`. If migration fails, inspect its logs and resolve that before starting the app or worker.

The app listens on container port `3000`; this example publishes host port `9999`. Change `9999` if another service already uses it, and configure Cloudflare Tunnel or your reverse proxy to send HTTPS traffic to that host port. Set `APP_ORIGIN` to the exact public HTTPS origin, with no path or trailing slash. The app image must include code that reads `APP_ORIGIN` for requests behind a reverse proxy.

Do not publish PostgreSQL's port to the internet. The app and worker connect to it over the stack's internal network using hostname `db`.

## 3. Refresh a deployment

After changing the source, publish both images again:

```sh
sh ./docker_deploy.sh
```

In Portainer, use **Pull and redeploy** (or enable **Re-pull image**) so the host fetches the new `latest` images. Confirm the migration exits successfully, then check that `app` and `payday-worker` are running.

## 4. Data and backups

The `postgres_data` named volume keeps database files across container recreation and stack redeploys. Do not remove the volume when updating the stack. Before schema upgrades or other maintenance, make a database backup and keep it somewhere outside the Docker host's container storage.

## Local Compose

The repository's `docker-compose.yml` builds images locally and is useful for development. Its database health check only confirms that PostgreSQL accepts connections; it does not apply the Drizzle schema. For deployments, use the Portainer stack above so the one-shot `migrate` service runs before the app and worker.
