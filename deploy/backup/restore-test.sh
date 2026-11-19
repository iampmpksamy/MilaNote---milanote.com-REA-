#!/bin/sh
# Restores a Noteboard backup into a separate, temporary instance to prove it works, without
# touching the running installation. Uses deploy/compose/docker-compose.yml with its own name,
# port (18766) and data folder.
#   sh restore-test.sh /DATA/AppData/noteboard/backups/noteboard-backup-....tar.gz
# Afterwards open http://<server>:18766 and sign in; remove it with:
#   docker compose -p noteboard-restoretest down   (and delete the TEST_DATA folder yourself)
set -eu
BACKUP="${1:?usage: restore-test.sh <backup.tar.gz>}"
HERE="$(cd "$(dirname "$0")/.." && pwd)"
TEST_DATA="${TEST_DATA:-/DATA/AppData/noteboard-restoretest}"
TEST_PORT="${TEST_PORT:-18766}"
IP="$(hostname -I | awk '{print $1}')"
export NB_INSTANCE=noteboard-restoretest DATA_PATH="$TEST_DATA" APP_PORT="$TEST_PORT" APP_BIND=0.0.0.0 APP_PUBLIC_URL="http://$IP:$TEST_PORT" \
  NB_SUBNET_INTERNAL="${TEST_SUBNET_INTERNAL:-172.31.122.0/28}" NB_SUBNET_WEB="${TEST_SUBNET_WEB:-172.31.122.16/28}"
docker compose -p noteboard-restoretest -f "$HERE/compose/docker-compose.yml" up -d --wait
# init has created the backups folder (owned by uid 1000); the copy must be readable by uid 1000.
cp "$BACKUP" "$TEST_DATA/backups/restore.tar.gz"
chmod 0644 "$TEST_DATA/backups/restore.tar.gz"
docker exec noteboard-restoretest-api node cli.js restore /data/backups/restore.tar.gz --confirm
docker restart noteboard-restoretest-api noteboard-restoretest-worker >/dev/null
sleep 5
echo "Restored into the test instance: http://$IP:$TEST_PORT"
