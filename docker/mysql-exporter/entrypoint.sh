#!/bin/sh
set -eu

: "${MYSQLD_EXPORTER_USER:?MYSQLD_EXPORTER_USER is required}"
: "${MYSQLD_EXPORTER_PASSWORD:?MYSQLD_EXPORTER_PASSWORD is required}"

case "$MYSQLD_EXPORTER_USER" in
    *[!a-zA-Z0-9_]*|'') echo "Invalid exporter username." >&2; exit 1 ;;
esac
case "$MYSQLD_EXPORTER_PASSWORD" in
    *[!a-fA-F0-9]*|'') echo "Exporter password must be hexadecimal." >&2; exit 1 ;;
esac
if [ "${#MYSQLD_EXPORTER_PASSWORD}" -lt 32 ]; then
    echo "Exporter password must be at least 32 hexadecimal characters." >&2
    exit 1
fi

umask 077
printf '[client]\nuser=%s\npassword=%s\nhost=mysql\nport=3306\n' \
    "$MYSQLD_EXPORTER_USER" "$MYSQLD_EXPORTER_PASSWORD" > /tmp/.my.cnf
unset MYSQLD_EXPORTER_PASSWORD
exec /usr/local/bin/mysqld_exporter --config.my-cnf=/tmp/.my.cnf --web.listen-address=:9104
