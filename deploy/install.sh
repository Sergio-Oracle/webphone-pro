#!/usr/bin/env bash
# =============================================================================
#  SENDT Webphone Pro — Script d'installation automatisée
#  Testé sur : Ubuntu 22.04 LTS (Jammy) / Ubuntu 20.04 LTS (Focal)
#  Usage :  sudo bash deploy/install.sh
# =============================================================================
set -euo pipefail

# ── Couleurs ──────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'
info()    { echo -e "${CYAN}[INFO]${NC}  $*"; }
success() { echo -e "${GREEN}[OK]${NC}    $*"; }
warn()    { echo -e "${YELLOW}[WARN]${NC}  $*"; }
error()   { echo -e "${RED}[ERROR]${NC} $*"; exit 1; }
ask()     { echo -en "${YELLOW}[?]${NC} $* : "; }

# ── Vérifications préalables ──────────────────────────────────────────────────
[[ $EUID -ne 0 ]] && error "Ce script doit être exécuté en tant que root : sudo bash deploy/install.sh"
. /etc/os-release
[[ "$ID" != "ubuntu" ]] && warn "Ce script est optimisé pour Ubuntu. Continuez à vos risques."

echo ""
echo "============================================================"
echo "   SENDT Webphone Pro — Installation automatisée"
echo "============================================================"
echo ""

# ── Collecte des variables de configuration ───────────────────────────────────
ask "Domaine de l'application (ex: telephone.exemple.com)"
read -r APP_DOMAIN

ask "Domaine du serveur Matrix (ex: matrix.exemple.com)"
read -r MATRIX_DOMAIN

ask "Email administrateur (pour Let's Encrypt)"
read -r ADMIN_EMAIL

ask "URL WebSocket LiveKit (ex: wss://livekit.exemple.com)"
read -r LIVEKIT_URL

ask "LiveKit API Key"
read -r LIVEKIT_API_KEY

ask "LiveKit API Secret"
read -rs LIVEKIT_API_SECRET
echo ""

ask "Email SMTP (pour les notifications Matrix)"
read -r SMTP_USER

ask "Mot de passe SMTP"
read -rs SMTP_PASS
echo ""

ask "Activer les inscriptions sur le serveur Matrix ? (oui/non) [oui]"
read -r ENABLE_REG
ENABLE_REG=${ENABLE_REG:-oui}
[[ "$ENABLE_REG" == "oui" ]] && ENABLE_REGISTRATION="true" || ENABLE_REGISTRATION="false"

# Génération des secrets
MATRIX_REGISTRATION_SECRET=$(openssl rand -hex 32)
MATRIX_MACAROON_SECRET=$(openssl rand -hex 32)
TURN_SHARED_SECRET=$(openssl rand -hex 32)

info "Configuration collectée. Début de l'installation..."

# ── 1. Dépendances système ─────────────────────────────────────────────────────
info "Installation des paquets système..."
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq \
    nginx \
    certbot \
    python3-certbot-nginx \
    fail2ban \
    curl \
    wget \
    git \
    lsb-release \
    apt-transport-https \
    gnupg \
    ufw \
    openssl

success "Paquets de base installés."

# ── 2. Node.js 20.x ──────────────────────────────────────────────────────────
info "Installation de Node.js 20.x..."
if ! command -v node &>/dev/null || [[ "$(node -v | cut -d. -f1 | tr -d 'v')" -lt 18 ]]; then
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash - -qq
    apt-get install -y -qq nodejs
fi
success "Node.js $(node -v) installé."

# ── 3. Matrix Synapse ─────────────────────────────────────────────────────────
info "Installation de Matrix Synapse..."
wget -qO /usr/share/keyrings/matrix-org-archive-keyring.gpg \
    https://packages.matrix.org/debian/matrix-org-archive-keyring.gpg
echo "deb [signed-by=/usr/share/keyrings/matrix-org-archive-keyring.gpg] \
https://packages.matrix.org/debian/ $(lsb_release -cs) main" \
    > /etc/apt/sources.list.d/matrix-org.list
apt-get update -qq
apt-get install -y -qq matrix-synapse-py3
success "Matrix Synapse installé."

# ── 4. Dossiers de l'application ──────────────────────────────────────────────
info "Déploiement des fichiers de l'application..."
APP_DIR="/var/www/html/webphone-pro"
if [[ ! -d "$APP_DIR/.git" ]]; then
    git clone https://github.com/Sergio-Oracle/webphone-pro.git "$APP_DIR"
else
    git -C "$APP_DIR" pull origin main
fi

# Ajuster les permissions
chown -R www-data:www-data "$APP_DIR"
chmod -R 755 "$APP_DIR"

# Patcher config.js avec les domaines réels
sed -i "s|https://jn\.rtn\.sn|https://${MATRIX_DOMAIN}|g" "$APP_DIR/js/config.js"
sed -i "s|jn\.rtn\.sn|${MATRIX_DOMAIN}|g"                 "$APP_DIR/js/config.js"
sed -i "s|wss://livekit\.ec2lt\.sn|${LIVEKIT_URL}|g"      "$APP_DIR/js/config.js"
sed -i "s|https://telephone\.rtn\.sn|https://${APP_DOMAIN}|g" "$APP_DIR/js/config.js"

success "Fichiers de l'application déployés dans $APP_DIR."

# ── 5. Serveur de tokens LiveKit ──────────────────────────────────────────────
info "Configuration du serveur de tokens LiveKit..."
TOKEN_DIR="/opt/livekit-token-server"
mkdir -p "$TOKEN_DIR"

# Copier le code si présent dans le repo (dossier deploy/livekit-token-server)
if [[ -f "$APP_DIR/deploy/livekit-token-server/server.js" ]]; then
    cp "$APP_DIR/deploy/livekit-token-server/server.js" "$TOKEN_DIR/"
    cp "$APP_DIR/deploy/livekit-token-server/package.json" "$TOKEN_DIR/"
fi

# Créer le fichier .env (600 root:root — jamais accessible depuis le web)
cat > "$TOKEN_DIR/.env" <<ENV
LIVEKIT_API_KEY=${LIVEKIT_API_KEY}
LIVEKIT_API_SECRET=${LIVEKIT_API_SECRET}
LIVEKIT_URL=${LIVEKIT_URL}
MATRIX_HOMESERVER=https://${MATRIX_DOMAIN}
PORT=3001
ENV
chmod 600 "$TOKEN_DIR/.env"
chown root:root "$TOKEN_DIR/.env"

# Installer les dépendances Node.js
cd "$TOKEN_DIR" && npm install --quiet
cd -

# Créer le service systemd
cat > /etc/systemd/system/livekit-token-server.service <<SVC
[Unit]
Description=SENDT LiveKit Token Server
After=network.target

[Service]
Type=simple
User=www-data
WorkingDirectory=${TOKEN_DIR}
ExecStart=/usr/local/bin/node server.js
Restart=on-failure
RestartSec=5
EnvironmentFile=${TOKEN_DIR}/.env

[Install]
WantedBy=multi-user.target
SVC

systemctl daemon-reload
systemctl enable livekit-token-server
success "Serveur de tokens LiveKit configuré."

# ── 6. Configuration Nginx ────────────────────────────────────────────────────
info "Configuration de Nginx..."

# Désactiver le vhost par défaut
rm -f /etc/nginx/sites-enabled/default

# Créer la config temporaire (HTTP) pour Certbot
cat > /etc/nginx/sites-available/webphone-temp.conf <<NGINX_TMP
server {
    listen 80;
    server_name ${APP_DOMAIN} ${MATRIX_DOMAIN};
    root /var/www/html;
    location /.well-known/acme-challenge/ { try_files \$uri =404; }
    location / { return 301 https://\$host\$request_uri; }
}
NGINX_TMP
ln -sf /etc/nginx/sites-available/webphone-temp.conf /etc/nginx/sites-enabled/webphone-temp.conf
nginx -t && systemctl reload nginx
success "Nginx temporaire configuré."

# ── 7. Certificats SSL (Let's Encrypt) ───────────────────────────────────────
info "Génération des certificats SSL..."
certbot certonly --nginx --non-interactive --agree-tos \
    -m "$ADMIN_EMAIL" \
    -d "$APP_DOMAIN" \
    -d "$MATRIX_DOMAIN" \
    || warn "Certbot a échoué — vérifiez que $APP_DOMAIN et $MATRIX_DOMAIN pointent vers ce serveur."

success "Certificats SSL générés."

# ── 8. Nginx — configuration finale HTTPS ─────────────────────────────────────
info "Configuration Nginx HTTPS..."
rm -f /etc/nginx/sites-enabled/webphone-temp.conf
rm -f /etc/nginx/sites-available/webphone-temp.conf

cat > /etc/nginx/sites-available/webphone.conf <<NGINX
# ── Rate limiting ─────────────────────────────────────────────────────────────
limit_req_zone \$binary_remote_addr zone=livekit_token:10m rate=10r/m;
limit_req_zone \$binary_remote_addr zone=spa_general:20m  rate=60r/m;

# ── HTTP → HTTPS ──────────────────────────────────────────────────────────────
server {
    listen 80;
    server_name ${APP_DOMAIN};
    return 301 https://\$host\$request_uri;
}

# ── HTTPS Application ──────────────────────────────────────────────────────────
server {
    listen 443 ssl http2;
    server_name ${APP_DOMAIN};

    root  ${APP_DIR};
    index index.html;

    ssl_certificate     /etc/letsencrypt/live/${APP_DOMAIN}/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/${APP_DOMAIN}/privkey.pem;
    include /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;

    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    add_header X-Frame-Options "DENY" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;
    add_header Permissions-Policy "camera=(self), microphone=(self), geolocation=(self), display-capture=(self)" always;
    add_header Cross-Origin-Opener-Policy "same-origin" always;
    add_header Content-Security-Policy "default-src 'self'; script-src 'self' https://cdnjs.cloudflare.com https://cdn.jsdelivr.net https://unpkg.com; style-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com; font-src 'self' https://cdnjs.cloudflare.com; img-src 'self' data: blob: https://${MATRIX_DOMAIN} https://*.tile.openstreetmap.org; media-src 'self' blob:; connect-src 'self' https://${MATRIX_DOMAIN} wss://${MATRIX_DOMAIN} https://${APP_DOMAIN} ${LIVEKIT_URL} https://stun.l.google.com; worker-src 'self' blob:; frame-ancestors 'none'; object-src 'none'; base-uri 'self';" always;

    location /api/ {
        limit_req zone=livekit_token burst=5 nodelay;
        proxy_pass         http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header   Host       \$host;
        proxy_set_header   X-Real-IP  \$remote_addr;
        proxy_set_header   Authorization \$http_authorization;
        proxy_pass_header  Authorization;
        add_header Cache-Control "no-store" always;
    }

    location = /index.html {
        add_header Cache-Control "no-store, no-cache, must-revalidate" always;
    }

    location ~* \.(js|css|woff2?|ttf|svg|png|jpg|webp|mp3|ico|wasm)\$ {
        add_header Cache-Control "public, max-age=31536000, immutable" always;
    }

    location / {
        limit_req zone=spa_general burst=30 nodelay;
        try_files \$uri \$uri/ /index.html;
        add_header Cache-Control "no-store, no-cache, must-revalidate" always;
    }
}

# ── HTTPS Matrix Synapse ───────────────────────────────────────────────────────
server {
    listen 443 ssl http2;
    server_name ${MATRIX_DOMAIN};

    ssl_certificate     /etc/letsencrypt/live/${APP_DOMAIN}/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/${APP_DOMAIN}/privkey.pem;
    include /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;

    location / {
        proxy_pass         http://127.0.0.1:8008;
        proxy_http_version 1.1;
        proxy_set_header   Host       \$host;
        proxy_set_header   X-Real-IP  \$remote_addr;
        proxy_set_header   X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto \$scheme;
        proxy_set_header   Upgrade    \$http_upgrade;
        proxy_set_header   Connection \$connection_upgrade;
        client_max_body_size 100M;
    }
}
NGINX

# Map WebSocket
cat > /etc/nginx/conf.d/websocket.conf <<MAP
map \$http_upgrade \$connection_upgrade {
    default upgrade;
    ''      close;
}
MAP

ln -sf /etc/nginx/sites-available/webphone.conf /etc/nginx/sites-enabled/webphone.conf
nginx -t && systemctl reload nginx
success "Nginx HTTPS configuré."

# ── 9. Configuration Matrix Synapse ──────────────────────────────────────────
info "Configuration de Matrix Synapse..."

# Générer la config de base
python3 -m synapse.app.homeserver \
    --server-name "${MATRIX_DOMAIN}" \
    --config-path "/etc/matrix-synapse/homeserver.yaml" \
    --generate-config \
    --report-stats no 2>/dev/null || true

# Appliquer la configuration personnalisée
cat > /etc/matrix-synapse/homeserver.yaml <<SYNAPSE
server_name: "${MATRIX_DOMAIN}"
pid_file: "/var/run/matrix-synapse.pid"

listeners:
  - bind_addresses: ["127.0.0.1", "::1"]
    port: 8008
    resources:
      - names: [client, federation]
        compress: false
    tls: false
    type: http
    x_forwarded: true

database:
  name: sqlite3
  args:
    database: /var/lib/matrix-synapse/homeserver.db

log_config: "/etc/matrix-synapse/log.yaml"
media_store_path: /var/lib/matrix-synapse/media
signing_key_path: "/etc/matrix-synapse/homeserver.signing.key"

enable_registration: ${ENABLE_REGISTRATION}
enable_registration_without_verification: false
registrations_require_3pid:
  - email
registration_shared_secret: "${MATRIX_REGISTRATION_SECRET}"

password_config:
  enabled: true
  minimum_length: 8
  require_digit: true

email:
  smtp_host: smtp.gmail.com
  smtp_port: 587
  smtp_user: "${SMTP_USER}"
  smtp_pass: "${SMTP_PASS}"
  require_transport_security: true
  notif_from: "SENDT <${SMTP_USER}>"
  app_name: "SENDT"
  enable_notifs: false
  subjects:
    email_validation: "Confirmez votre adresse email — SENDT"
    password_reset: "Réinitialisation de votre mot de passe — SENDT"
    email_already_in_use: "Votre adresse email est déjà utilisée — SENDT"

trusted_key_servers:
  - server_name: "matrix.org"
SYNAPSE

# Générer la clé de signature si elle n'existe pas
[[ ! -f /etc/matrix-synapse/homeserver.signing.key ]] && \
    python3 -m synapse.app.homeserver \
        --server-name "${MATRIX_DOMAIN}" \
        --config-path "/etc/matrix-synapse/homeserver.yaml" \
        --generate-keys 2>/dev/null || true

systemctl enable matrix-synapse
systemctl restart matrix-synapse
success "Matrix Synapse configuré et démarré."

# ── 10. Fail2ban ──────────────────────────────────────────────────────────────
info "Configuration de Fail2ban..."

cat > /etc/fail2ban/filter.d/matrix-synapse.conf <<F2B_FILTER
[Definition]
failregex = ^<HOST> .* "POST /_matrix/client/v3/login HTTP.*" (400|401|403|429)
ignoreregex =
F2B_FILTER

cat > /etc/fail2ban/filter.d/nginx-sendt.conf <<F2B_FILTER2
[Definition]
failregex = ^<HOST> .* "GET /api/ HTTP.*" (400|401|403|429)
ignoreregex =
F2B_FILTER2

cat > /etc/fail2ban/jail.d/sendt.conf <<F2B_JAIL
[DEFAULT]
bantime  = 3600
findtime = 600
maxretry = 10
backend  = auto

[sshd]
enabled = true

[matrix-synapse]
enabled  = true
filter   = matrix-synapse
logpath  = /var/log/nginx/webphone-access.log
maxretry = 5
bantime  = 3600
findtime = 300
action   = iptables-multiport[name=matrix-synapse, port="80,443", protocol=tcp]

[nginx-sendt]
enabled  = true
filter   = nginx-sendt
logpath  = /var/log/nginx/webphone-access.log
maxretry = 20
bantime  = 1800
findtime = 300
action   = iptables-multiport[name=nginx-sendt, port="80,443", protocol=tcp]

[nginx-botsearch]
enabled  = true
logpath  = /var/log/nginx/webphone-error.log
maxretry = 5
F2B_JAIL

systemctl enable fail2ban
systemctl restart fail2ban
success "Fail2ban configuré."

# ── 11. Pare-feu UFW ──────────────────────────────────────────────────────────
info "Configuration du pare-feu UFW..."
ufw --force enable
ufw allow ssh
ufw allow 80/tcp
ufw allow 443/tcp
ufw reload
success "Pare-feu configuré (SSH, HTTP, HTTPS autorisés)."

# ── 12. Démarrage des services ────────────────────────────────────────────────
info "Démarrage des services..."
systemctl start livekit-token-server
systemctl start matrix-synapse
systemctl reload nginx
success "Tous les services démarrés."

# ── 13. Vérification finale ───────────────────────────────────────────────────
echo ""
echo "============================================================"
echo "   Vérification de l'installation"
echo "============================================================"

check_service() {
    if systemctl is-active --quiet "$1"; then
        success "$1 : actif"
    else
        warn "$1 : INACTIF — vérifiez : journalctl -u $1"
    fi
}

check_service nginx
check_service matrix-synapse
check_service livekit-token-server
check_service fail2ban

echo ""
echo "============================================================"
echo "   Installation terminée !"
echo "============================================================"
echo ""
echo "  Application  : https://${APP_DOMAIN}"
echo "  Matrix API   : https://${MATRIX_DOMAIN}/_matrix/client/versions"
echo "  Token Server : https://${APP_DOMAIN}/api/connection-details"
echo ""
echo "  Secrets générés (CONSERVEZ-LES EN LIEU SÛR) :"
echo "  Matrix Registration Secret : ${MATRIX_REGISTRATION_SECRET}"
echo "  TURN Shared Secret         : ${TURN_SHARED_SECRET}"
echo ""
echo "  Prochaines étapes :"
echo "  1. Ajouter votre serveur TURN dans /etc/matrix-synapse/homeserver.yaml"
echo "  2. Créer le premier compte administrateur :"
echo "     register_new_matrix_user -c /etc/matrix-synapse/homeserver.yaml https://${MATRIX_DOMAIN}"
echo "  3. Vérifier les logs : journalctl -u matrix-synapse -f"
echo ""
