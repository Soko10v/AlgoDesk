#!/usr/bin/env bash
# One-shot VPS bootstrap for AlgoDesk (Hostkey / Ubuntu).
# Run on the server as root:
#   cd /root/AlgoDesk && bash infra/setup-vps.sh
set -euo pipefail


DOMAIN="${DOMAIN:-algodesk.pro}"
REPO_DIR="${REPO_DIR:-/root/AlgoDesk}"
INFRA_DIR="$REPO_DIR/infra"
EMAIL="${CERTBOT_EMAIL:-}"

log() { printf '\n[setup] %s\n' "$*"; }
die() { printf '\n[setup] ERROR: %s\n' "$*" >&2; exit 1; }

[[ "$(id -u)" -eq 0 ]] || die "Run as root"

[[ -d "$INFRA_DIR" ]] || die "Repo not found at $REPO_DIR — clone AlgoDesk first"

# --- Docker ---
if ! command -v docker >/dev/null 2>&1; then
  log "Installing Docker..."
  apt-get update -qq
  apt-get install -y ca-certificates curl
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
    > /etc/apt/sources.list.d/docker.list
  apt-get update -qq
  apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
  systemctl enable --now docker
else
  log "Docker already installed"
fi

# --- Swap (helps docker build on 2–4 GB RAM) ---
if ! swapon --show | grep -q .; then
  log "Adding 2G swap..."
  fallocate -l 2G /swapfile 2>/dev/null || dd if=/dev/zero of=/swapfile bs=1M count=2048 status=none
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  grep -q '/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

# --- .env ---
cd "$INFRA_DIR"
if [[ ! -f .env ]]; then
  log "Creating infra/.env from .env.example"
  cp .env.example .env
fi

gen_secret() {
  python3 -c "import secrets; print(secrets.token_urlsafe(48))"
}
gen_fernet() {
  python3 -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
}

set_env() {
  local key="$1" val="$2"
  grep -v "^${key}=" .env > .env.tmp 2>/dev/null || true
  echo "${key}=${val}" >> .env.tmp
  mv .env.tmp .env
}

get_env() {
  grep -E "^${1}=" .env 2>/dev/null | cut -d= -f2- || true
}

# Generate secrets if still placeholders
[[ "$(get_env SECRET_KEY)" == "change_me" || -z "$(get_env SECRET_KEY)" ]] && set_env SECRET_KEY "$(gen_secret)"
[[ -z "$(get_env FERNET_KEY)" ]] && set_env FERNET_KEY "$(gen_fernet)"

# Production defaults
set_env DEV_AUTH "false"
set_env RUN_DB_MIGRATIONS "false"
set_env REDIS_URL "redis://redis:6379/0"
set_env FRONTEND_ORIGIN "https://${DOMAIN}"
set_env BACKEND_ORIGIN "https://${DOMAIN}"
set_env PUBLIC_BASE_URL "https://${DOMAIN}"

# Required manual values
missing=()
for key in DATABASE_URL SUPABASE_URL SUPABASE_ANON_KEY VITE_SUPABASE_URL VITE_SUPABASE_ANON_KEY; do
  val="$(get_env "$key")"
  if [[ -z "$val" || "$val" == *"[PROJECT-REF]"* || "$val" == *"[PASSWORD]"* ]]; then
    missing+=("$key")
  fi
done

if ((${#missing[@]} > 0)); then
  cat >&2 <<EOF

[setup] Fill these in $INFRA_DIR/.env before continuing:
  ${missing[*]}

  nano $INFRA_DIR/.env
  # Then re-run: bash infra/setup-vps.sh

  Tip: copy .env from the old VPS if you still have it.
EOF
  exit 1
fi

# --- Host nginx (TLS termination → docker frontend on :8080) ---
if ! command -v nginx >/dev/null 2>&1; then
  log "Installing nginx + certbot..."
  apt-get install -y nginx certbot python3-certbot-nginx
fi

mkdir -p /etc/nginx/snippets
cp "$INFRA_DIR/nginx-security-snippet.conf" /etc/nginx/snippets/algodesk-security.conf

NGINX_SITE="/etc/nginx/sites-available/algodesk"
cat > "$NGINX_SITE" <<EOF
server {
    listen 80;
    server_name ${DOMAIN} www.${DOMAIN};

    client_max_body_size 20m;
    include /etc/nginx/snippets/algodesk-security.conf;

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 86400;
    }
}
EOF

ln -sf "$NGINX_SITE" /etc/nginx/sites-enabled/algodesk
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl enable --now nginx
systemctl reload nginx

# --- App ---
log "Building and starting containers (this may take several minutes)..."
docker compose build
docker compose run --rm -T backend alembic upgrade head
docker compose up -d --remove-orphans
docker compose ps

# --- TLS ---
if [[ -n "$EMAIL" ]]; then
  log "Requesting Let's Encrypt certificate for ${DOMAIN}..."
  certbot --nginx -d "$DOMAIN" -d "www.${DOMAIN}" --non-interactive --agree-tos -m "$EMAIL" --redirect
  systemctl reload nginx
else
  log "Skipping certbot (set CERTBOT_EMAIL=you@mail.com to enable HTTPS auto-setup)"
  log "Or run manually: certbot --nginx -d ${DOMAIN} -d www.${DOMAIN}"
fi

log "Done. Open https://${DOMAIN} (or http://${DOMAIN} if no cert yet)"
log "App container listens on 127.0.0.1:8080 — do not expose it publicly, use host nginx."
