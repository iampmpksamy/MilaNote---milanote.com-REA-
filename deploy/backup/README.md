# Backups and restore

## What is in a backup

`noteboard-backup-YYYYMMDD-HHMMSS-<kind>.tar.gz` (time in UTC), in `DATA/backups`, mode 0600:

| Part | Content |
| --- | --- |
| `db/*.ndjson` | every collection (settings, users, workspaces, boards, assets, tokens, audit, meta, backups) as MongoDB Extended JSON |
| `uploads/` | every uploaded picture and the branding files (local storage; with S3 the bucket is not copied — back it up with your provider) |
| `config/keys.json` | the encryption key and session secret: needed to read two-step sign-in secrets and the SMTP password after a restore |
| `manifest.json` | app version, database schema version, counts |

Because it holds those keys, **treat a backup like a password file**. Only the super administrator
can download one (with two-step sign-in), and every download is audited.

Kinds: `scheduled` (daily), `manual` (Back up now / `cli.js backup`), `pre-migration` (taken
automatically before a database change older versions can't read), `pre-restore`.

## Schedule and retention

Daily at `BACKUP_TIME` (default 03:00) in `TZ` (default Asia/Kolkata), by the worker. Kept: the newest
scheduled backup of each of the last 7 days, 4 ISO weeks and 6 months; the last 10 manual; the last
5 safety backups. Change these in `/admin → Settings → Backups` (or `BACKUP_KEEP_*` before install).

## Off-host copies (do this)

A backup on the same disk as the data does not survive that disk failing, a fire, theft or
ransomware. Keep at least one copy on another machine:

- `offsite-copy.sh user@other-host:/srv/noteboard-backups` from cron (rsync over SSH, never deletes);
- `rclone copy /DATA/AppData/noteboard/backups remote:noteboard-backups` (Backblaze B2, S3, Google
  Drive, OneDrive…; use rclone's `crypt` remote if the provider shouldn't read them);
- or a Syncthing folder to another device (send-only on the server).

## Restore

Restoring is done on purpose from the server console, never from the web page.

**Try it first in a separate test instance** (doesn't touch the running app):

```sh
sh deploy/backup/restore-test.sh /DATA/AppData/noteboard/backups/noteboard-backup-....tar.gz
# → http://<server>:18766 ; afterwards:  docker compose -p noteboard-restoretest down
```

**Into a new, empty installation** (e.g. a new disk or machine): install Noteboard, do not run the
setup wizard, copy the backup into its `backups` folder, then

```sh
docker exec noteboard-api node cli.js restore /data/backups/<file>.tar.gz --confirm
docker restart noteboard-api noteboard-worker
```

**Over an installation that already has accounts** (rolling back): add `--replace`. A `pre-restore`
backup of the current state is taken first. Everyone is signed out.

Restores refuse backups from a newer database schema than the image knows (upgrade first).
