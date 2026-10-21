# Installing OpenBulkAds (instructions for AI agents)

You are installing OpenBulkAds, a self-hosted Meta bulk-ad tool, on the user's machine with Docker. Follow these steps in order, run the checks, and stop at the first failure. The human-facing guide (Spanish) is [docs/deploy.md](docs/deploy.md).

## Rules

- **Never print, log, paste or commit secret values.** `~/openbulkads/.env` holds `POSTGRES_PASSWORD`, `BETTER_AUTH_SECRET` and `TOKEN_ENCRYPTION_KEY`. Do not `cat` it. To list keys safely use `sed 's/=.*/=<hidden>/' .env`. To check a file did not change, compare a hash (`sha256sum .env`).
- **Do not run `docker compose down -v`** or delete `~/openbulkads`: that destroys the database. Only the human decides that.
- **Do not open `/setup` yourself and do not create the administrator.** The human must do it (step 6).
- Do not change the defaults (`OPENBULKADS_BIND=127.0.0.1`) unless the human asked for access from other devices.
- Messages shown to the human by the installer are in Spanish (Rioplatense). Keep talking to the human in their language.

## 1. Check prerequisites

```bash
docker --version                 # expected: Docker version 2x.x.x or newer
docker compose version           # expected: Docker Compose version v2.x.x (v2 or newer)
docker info >/dev/null && echo docker-ok   # expected output: docker-ok
```

- `docker: command not found` or no `compose` subcommand: ask the human to install Docker (https://docs.docker.com/get-docker/). Do not install it unprompted.
- `docker info` fails with "permission denied": do not use `sudo` for the installer (HOME becomes /root, variables are dropped); ask the human to add their user to the `docker` group (`sudo usermod -aG docker $USER`, then re-login or `newgrp docker`) and rerun.

Optional: check the port is free (default 3000): `ss -ltn | grep ':3000 '` should print nothing. If it is taken, pick another and pass `OPENBULKADS_PORT=<port>` below.

## 2. Decide the options with the human (only if non-default)

| Variable | Meaning | Default |
| --- | --- | --- |
| `OPENBULKADS_DIR` | install directory | `~/openbulkads` |
| `OPENBULKADS_PORT` | host port | `3000` |
| `OPENBULKADS_BIND` | host address it listens on | `127.0.0.1` |
| `OPENBULKADS_URL` | exact URL the human types in the browser (becomes `BETTER_AUTH_URL`) | `http://localhost:<port>` |
| `OPENBULKADS_VERSION` | image tag | `latest` |

For access from other devices (for example over Tailscale) set `OPENBULKADS_BIND` to the Tailscale IP and `OPENBULKADS_URL` to the address the human will use. Login only works from that exact origin; plain `http://` is fine on `localhost` and on a private network.

## 3. Run the installer

```bash
curl -fsSL https://raw.githubusercontent.com/matiads/openbulkads/main/install.sh | sh
# with options:
# curl -fsSL https://raw.githubusercontent.com/matiads/openbulkads/main/install.sh | OPENBULKADS_PORT=3500 sh
```

Expected: exit code 0 and, near the end, `Listo, OpenBulkAds está funcionando.` followed by `Abrí ahora: <url>/setup`. The installer already waits for readiness. Re-running it is safe: an existing `.env` is kept and secrets are not rotated.

If it exits non-zero, read the `Error:` line (Spanish), fix the cause and rerun. For startup failures run `cd ~/openbulkads && docker compose logs --tail 100 app` (logs do not contain secrets, but do not forward `.env`).

## 4. Verify

```bash
cd ~/openbulkads
docker compose ps -a
```

Expected: `postgres` and `app` are `running` (`healthy`); `migrate` and `media-init` show `exited (0)`.

```bash
curl -fsS http://127.0.0.1:3000/api/ready
```

Expected body: `{"ready":true,"database":true,"media":true}` (use your port/bind address). If `database` or `media` is `false`, check `docker compose logs app`.

```bash
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3000/setup
```

Expected: `200` (an HTTP redirect such as `307` also means the app is serving).

Check that the secrets file is private without reading it: `stat -c '%a' ~/openbulkads/.env` should print `600`.

## 5. Check idempotency (optional)

```bash
cd ~/openbulkads && h=$(sha256sum .env)
curl -fsSL https://raw.githubusercontent.com/matiads/openbulkads/main/install.sh | sh
[ "$h" = "$(sha256sum .env)" ] && echo secrets-unchanged
```

Expected last line: `secrets-unchanged`.

## 6. Hand over to the human

Tell the human, in their language:

1. Open `<url>/setup` **now** and create the first administrator. Until an administrator exists, `/setup` is open to anyone who can reach that address.
2. Back up `~/openbulkads/.env` somewhere private. Without `TOKEN_ENCRYPTION_KEY` the stored Meta tokens cannot be decrypted.
3. Useful commands (inside `~/openbulkads`): `docker compose logs -f`, update with `docker compose pull && docker compose up -d`, stop with `docker compose down`.

Never complete `/setup` on their behalf and never ask them to paste secrets back to you.
