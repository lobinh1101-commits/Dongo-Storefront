#!/bin/bash
set -euo pipefail

: "${MYSQL_MONITOR_USER:?MYSQL_MONITOR_USER is required}"
: "${MYSQL_MONITOR_PASSWORD:?MYSQL_MONITOR_PASSWORD is required}"

if [[ ! "$MYSQL_MONITOR_USER" =~ ^[a-zA-Z0-9_]{1,32}$ ]]; then
    echo "MYSQL_MONITOR_USER must contain only letters, digits, and underscores." >&2
    exit 1
fi
if [[ ! "$MYSQL_MONITOR_PASSWORD" =~ ^[a-fA-F0-9]{32,}$ ]]; then
    echo "MYSQL_MONITOR_PASSWORD must be at least 32 hexadecimal characters." >&2
    exit 1
fi

mysql --protocol=socket --user=root --password="$MYSQL_ROOT_PASSWORD" <<SQL
CREATE USER IF NOT EXISTS '${MYSQL_MONITOR_USER}'@'%' IDENTIFIED BY '${MYSQL_MONITOR_PASSWORD}';
GRANT PROCESS, REPLICATION CLIENT, SELECT ON *.* TO '${MYSQL_MONITOR_USER}'@'%';
SQL
