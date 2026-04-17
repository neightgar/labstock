#!/usr/bin/env bash
# LabStock installer — Linux (Ubuntu/Debian) + Synology NAS
# Usage: curl -fsSL https://raw.githubusercontent.com/neightgar/labstock/main/install.sh | bash
set -euo pipefail

# ── Constants ────────────────────────────────────────────────
GITHUB_USER="neightgar"
GITHUB_REPO="labstock"
IMAGE="ghcr.io/${GITHUB_USER}/${GITHUB_REPO}:latest"
PORT=3120
NODE_VERSION="20"

# ── Colours ──────────────────────────────────────────────────
RED='\033[0;31m'; YELLOW='\033[1;33m'; GREEN='\033[0;32m'; NC='\033[0m'
ok()   { echo -e "${GREEN}✅ $*${NC}"; }
warn() { echo -e "${YELLOW}⚠️  $*${NC}"; }
err()  { echo -e "${RED}❌ $*${NC}" >&2; }

# ── Banner ───────────────────────────────────────────────────
cat <<'BANNER'

   _          _     ____  _             _
  | |    __ _| |__ / ___|| |_ ___   ___| | __
  | |   / _` | '_ \\___ \| __/ _ \ / __| |/ /
  | |__| (_| | |_) |___) | || (_) | (__|   <
  |_____\__,_|_.__/|____/ \__\___/ \___|_|\_\

         Self-hosted Lab Inventory System
BANNER
echo

# ── Cleanup trap ─────────────────────────────────────────────
INSTALL_PATH=""
_CLEANUP_NEEDED=false

cleanup() {
  if [[ "$_CLEANUP_NEEDED" == "true" && -n "$INSTALL_PATH" && -d "$INSTALL_PATH" ]]; then
    warn "Installation interrupted — removing incomplete directory: $INSTALL_PATH"
    rm -rf "$INSTALL_PATH"
  fi
}
trap cleanup EXIT INT TERM

# ─────────────────────────────────────────────────────────────
# STEP 1 — Detect platform
# ─────────────────────────────────────────────────────────────
echo "[1/6] Detecting platform..."

PLATFORM="linux"
PLATFORM_LABEL="Linux"

if [[ -f /etc/synoinfo.conf ]]; then
  PLATFORM="synology"
  DSM_VERSION=$(grep -oP 'majorversion="\K[^"]+' /etc/synoinfo.conf 2>/dev/null || echo "?")
  PLATFORM_LABEL="Synology DSM ${DSM_VERSION}.x"
elif [[ -f /etc/os-release ]]; then
  # shellcheck source=/dev/null
  . /etc/os-release
  PLATFORM_LABEL="${PRETTY_NAME:-Linux}"
fi

ok "Detected: $PLATFORM_LABEL"

# ─────────────────────────────────────────────────────────────
# STEP 2 — Detect install method
# ─────────────────────────────────────────────────────────────
echo "[2/6] Checking dependencies..."

INSTALL_METHOD=""

if command -v docker &>/dev/null; then
  if docker compose version &>/dev/null 2>&1; then
    INSTALL_METHOD="docker"
    ok "Docker + Compose v2 found"
  elif docker-compose --version &>/dev/null 2>&1; then
    # Old standalone docker-compose — we'll upgrade to plugin below
    INSTALL_METHOD="docker"
    warn "Found legacy docker-compose — will install Compose v2 plugin"
  else
    INSTALL_METHOD="docker"
    warn "Docker found but no Compose plugin — will install it"
  fi
else
  if [[ "$PLATFORM" == "synology" ]]; then
    err "Docker not found on Synology NAS."
    echo
    echo "  Please install Docker via Synology Package Center:"
    echo "  1. Open Package Center"
    echo "  2. Search for 'Container Manager' (DSM 7.2+) or 'Docker'"
    echo "  3. Install and re-run this script"
    exit 1
  else
    INSTALL_METHOD="bare_metal"
    warn "Docker not found — will use Bare metal (Node.js + PM2)"
  fi
fi

# ─────────────────────────────────────────────────────────────
# STEP 3 — Set paths and generate secrets
# ─────────────────────────────────────────────────────────────
echo "[3/6] Preparing configuration..."

if [[ "$PLATFORM" == "synology" ]]; then
  INSTALL_PATH="/volume1/docker/${GITHUB_REPO}"
else
  INSTALL_PATH="/opt/${GITHUB_REPO}"
fi

SESSION_SECRET=$(openssl rand -hex 32)
ok "Install path:  $INSTALL_PATH"
ok "Port:          $PORT"
ok "Session secret generated"

# ─────────────────────────────────────────────────────────────
# STEP 4 — Install
# ─────────────────────────────────────────────────────────────
echo "[4/6] Installing LabStock (method: $INSTALL_METHOD)..."
_CLEANUP_NEEDED=true

# ── Helper: need sudo? ────────────────────────────────────────
_sudo() {
  if [[ $EUID -eq 0 ]]; then
    "$@"
  else
    sudo "$@"
  fi
}

# ═══════════════════════════════════════════════════════════
# BRANCH A — Docker
# ═══════════════════════════════════════════════════════════
if [[ "$INSTALL_METHOD" == "docker" ]]; then

  # Ensure Compose v2 plugin
  if ! docker compose version &>/dev/null 2>&1; then
    if [[ "$PLATFORM" == "linux" ]]; then
      echo "  Installing Docker Compose v2 plugin..."
      _sudo apt-get update -qq
      _sudo apt-get install -y docker-compose-plugin
    else
      err "Cannot auto-install Compose plugin on this platform."
      err "Please install 'docker-compose-plugin' manually and re-run."
      exit 1
    fi
  fi

  # Create directories
  _sudo mkdir -p \
    "${INSTALL_PATH}/data" \
    "${INSTALL_PATH}/uploads" \
    "${INSTALL_PATH}/backups"

  if [[ $EUID -ne 0 ]]; then
    sudo chown -R "$(id -u):$(id -g)" "$INSTALL_PATH"
  fi

  # Write .env
  cat > "${INSTALL_PATH}/.env" <<EOF
NODE_ENV=production
DATABASE_URL=file:/app/data/labstock.db
SESSION_SECRET=${SESSION_SECRET}
PORT=3000
EOF

  # Write docker-compose.yml
  cat > "${INSTALL_PATH}/docker-compose.yml" <<EOF
services:
  labstock:
    image: ${IMAGE}
    container_name: labstock
    restart: unless-stopped
    ports:
      - "${PORT}:3000"
    volumes:
      - ${INSTALL_PATH}/data:/app/data
      - ${INSTALL_PATH}/uploads:/app/uploads
      - ${INSTALL_PATH}/backups:/app/backups
    env_file:
      - ${INSTALL_PATH}/.env
EOF

  ok "Configuration files created"

  echo "  Pulling image (this may take a moment)..."
  cd "$INSTALL_PATH"
  docker compose pull
  docker compose up -d
  ok "Container started"

# ═══════════════════════════════════════════════════════════
# BRANCH B — Bare metal (Linux only)
# ═══════════════════════════════════════════════════════════
else

  # Node.js
  if ! command -v node &>/dev/null || [[ "$(node -e 'process.stdout.write(process.version.split(\".\")[0].slice(1))')" -lt "$NODE_VERSION" ]]; then
    echo "  Installing Node.js ${NODE_VERSION}.x..."
    curl -fsSL "https://deb.nodesource.com/setup_${NODE_VERSION}.x" | _sudo bash -
    _sudo apt-get install -y nodejs
  else
    ok "Node.js $(node --version) already installed"
  fi

  # git
  if ! command -v git &>/dev/null; then
    echo "  Installing git..."
    _sudo apt-get install -y git
  else
    ok "git $(git --version | awk '{print $3}') already installed"
  fi

  # Clone / update
  if [[ -d "$INSTALL_PATH/.git" ]]; then
    warn "Directory exists — pulling latest changes"
    git -C "$INSTALL_PATH" pull
  else
    git clone "https://github.com/${GITHUB_USER}/${GITHUB_REPO}.git" "$INSTALL_PATH"
  fi

  cd "$INSTALL_PATH"
  mkdir -p data uploads backups

  # Dependencies
  echo "  Installing npm dependencies..."
  npm install --omit=dev --silent

  # .env
  cat > "${INSTALL_PATH}/.env" <<EOF
NODE_ENV=production
DATABASE_URL=file:${INSTALL_PATH}/data/labstock.db
SESSION_SECRET=${SESSION_SECRET}
PORT=${PORT}
EOF

  ok "Configuration file created"

  # Migrations
  echo "  Applying database migrations..."
  npm run db:migrate

  # PM2
  if ! command -v pm2 &>/dev/null; then
    echo "  Installing PM2..."
    npm install -g pm2 --silent
  else
    ok "PM2 $(pm2 --version) already installed"
  fi

  pm2 delete labstock 2>/dev/null || true
  pm2 start src/server.js --name labstock
  pm2 save

  echo "  Configuring PM2 startup..."
  STARTUP_CMD=$(pm2 startup systemd -u "$USER" --hp "$HOME" 2>&1 | grep -E "sudo|env" | tail -1 || true)
  if [[ -n "$STARTUP_CMD" ]]; then
    eval "$STARTUP_CMD" || warn "Could not auto-configure startup — run manually: $STARTUP_CMD"
  fi

  ok "PM2 process started and saved"
fi

# ─────────────────────────────────────────────────────────────
# STEP 5 — Health check
# ─────────────────────────────────────────────────────────────
echo "[5/6] Waiting for LabStock to start (10s)..."
sleep 10

echo "[6/6] Checking health endpoint..."
if curl -sf "http://localhost:${PORT}/health" &>/dev/null; then
  ok "Health check passed"
  _CLEANUP_NEEDED=false
else
  err "Health check failed — LabStock did not respond on port ${PORT}"
  echo
  echo "  View logs:"
  if [[ "$INSTALL_METHOD" == "docker" ]]; then
    echo "    docker compose -f ${INSTALL_PATH}/docker-compose.yml logs"
  else
    echo "    pm2 logs labstock"
  fi
  echo
  _CLEANUP_NEEDED=false   # keep files for debugging
  exit 1
fi

# ─────────────────────────────────────────────────────────────
# Final message
# ─────────────────────────────────────────────────────────────
METHOD_LABEL="Docker"
[[ "$INSTALL_METHOD" == "bare_metal" ]] && METHOD_LABEL="Bare metal (PM2)"

echo
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
ok " LabStock successfully installed!"
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo
echo "   Method:    ${METHOD_LABEL}"
echo "   Platform:  ${PLATFORM_LABEL}"
echo
echo -e "🌐 Open:    ${GREEN}http://YOUR_IP:${PORT}${NC}"
echo "📁 Data:    ${INSTALL_PATH}"
echo -e "🔑 Secret:  ${YELLOW}${SESSION_SECRET}${NC}"
echo "            (save this in a safe place)"
echo
echo "   First run: open the URL in your browser and complete"
echo "   the Setup Wizard to create an admin account."
echo
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

if [[ "$INSTALL_METHOD" == "docker" ]]; then
  cat <<EOF

Update:
  cd ${INSTALL_PATH}
  docker compose pull && docker compose up -d

Remove:
  docker compose -f ${INSTALL_PATH}/docker-compose.yml down
  rm -rf ${INSTALL_PATH}
EOF
else
  cat <<EOF

Update:
  cd ${INSTALL_PATH}
  git pull && npm install --omit=dev
  npm run db:migrate && pm2 restart labstock

Remove:
  pm2 delete labstock
  rm -rf ${INSTALL_PATH}
EOF
fi
echo
