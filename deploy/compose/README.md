# Noteboard with Docker Compose (or a Portainer stack)

```sh
cp .env.example .env        # adjust: APP_PUBLIC_URL, APP_PORT, DATA_PATH, TZ …
docker compose up -d --wait
docker exec noteboard-api node cli.js setup-token   # then open http://<server>:8765/
```

- Same images, services and data layout as the CasaOS package (`../casaos/`); you can move between
  them by pointing both at the same `DATA_PATH` (stop one before starting the other).
- `.env` holds no passwords. The init service creates the secrets in `$DATA_PATH/config/secrets` on
  first start and never replaces them.
- Several instances on one host: give each its own `NB_INSTANCE`, `APP_PORT`, `DATA_PATH`,
  `NB_SUBNET_INTERNAL` and `NB_SUBNET_WEB`, and run with `-p <name>`.
- Portainer: Stacks → Add stack → upload this file and the `.env`, or paste `../casaos/docker-compose.yml`
  (values written in).
- Update: change `NOTEBOARD_SERVER_IMAGE` / `NOTEBOARD_GATEWAY_IMAGE` (or the version in the file) and
  `docker compose up -d --wait`. See `../backup/README.md` for backups.
