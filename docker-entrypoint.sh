#!/bin/sh
set -eu

APP_UID="${PUID:-1000}"
APP_GID="${PGID:-1000}"

export NODE_ENV="${NODE_ENV:-production}"
export DATABASE_URL="${DATABASE_URL:-file:/app/data/labstock.db}"
export UPLOAD_DIR="${UPLOAD_DIR:-/app/uploads}"
export BACKUP_DIR="${BACKUP_DIR:-/app/backups}"

case "$DATABASE_URL" in
  file:*)
    DB_PATH="${DATABASE_URL#file:}"
    ;;
  *)
    echo "[entrypoint] Only SQLite file: DATABASE_URL values are supported in this image." >&2
    exit 1
    ;;
esac

case "$DB_PATH" in
  /*)
    ;;
  *)
    DB_PATH="/app/prisma/$DB_PATH"
    ;;
esac

DB_DIR="$(dirname "$DB_PATH")"
SESSION_DB_PATH="${SESSION_DB_PATH:-$DB_DIR/sessions.db}"
SESSION_DB_DIR="$(dirname "$SESSION_DB_PATH")"

echo "[entrypoint] Preparing writable directories"
mkdir -p "$DB_DIR" "$SESSION_DB_DIR" "$UPLOAD_DIR" "$BACKUP_DIR"

if ! chown -R "$APP_UID:$APP_GID" "$DB_DIR" "$SESSION_DB_DIR" "$UPLOAD_DIR" "$BACKUP_DIR" 2>/dev/null; then
  echo "[entrypoint] Warning: chown failed. Check Synology folder ownership/ACLs for mounted paths." >&2
fi

chmod -R u+rwX,g+rwX "$DB_DIR" "$SESSION_DB_DIR" "$UPLOAD_DIR" "$BACKUP_DIR" 2>/dev/null || true

touch "$DB_PATH" "$SESSION_DB_PATH"
chown "$APP_UID:$APP_GID" "$DB_PATH" "$SESSION_DB_PATH" 2>/dev/null || true

su-exec "$APP_UID:$APP_GID" sh -c '
  set -eu
  for dir in "$1" "$2" "$3" "$4"; do
    test_file="$dir/.labstock-write-test"
    touch "$test_file"
    rm -f "$test_file"
  done
' sh "$DB_DIR" "$SESSION_DB_DIR" "$UPLOAD_DIR" "$BACKUP_DIR"

echo "[entrypoint] Running Prisma migrations"
su-exec "$APP_UID:$APP_GID" ./node_modules/.bin/prisma migrate deploy

echo "[entrypoint] Starting LabStock as uid=$APP_UID gid=$APP_GID"
exec su-exec "$APP_UID:$APP_GID" "$@"
