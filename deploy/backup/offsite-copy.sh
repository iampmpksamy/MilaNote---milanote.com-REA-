#!/bin/sh
# Copies Noteboard backups to another machine, so a failed disk doesn't take the backups with it.
# Run from cron on the Docker host, e.g. daily at 04:00 (after the 03:00 backup):
#   0 4 * * *  sh /path/to/offsite-copy.sh user@backup-host:/srv/noteboard-backups
# Uses rsync over SSH (key login). Never deletes anything at the destination.
# For cloud storage use rclone instead:  rclone copy "$SRC" remote:noteboard-backups
set -eu
DEST="${1:?usage: offsite-copy.sh user@host:/path}"
SRC="${NOTEBOARD_BACKUPS:-/DATA/AppData/noteboard/backups}"
# Backups are owned by uid 1000 with mode 0600: run this as root or as uid 1000.
rsync -a --chmod=F600 --include='noteboard-backup-*.tar.gz' --exclude='*' "$SRC/" "$DEST/"
echo "copied $(ls "$SRC"/noteboard-backup-*.tar.gz 2>/dev/null | wc -l) backup file(s) to $DEST"
