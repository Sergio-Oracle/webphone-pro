# SENDT Webphone Pro

Application de communication sécurisée basée sur le protocole Matrix, avec chiffrement de bout en bout (E2EE Olm/Megolm), appels vidéo de groupe via LiveKit, et interface SPA responsive.

---

## Sommaire

- [Architecture](#architecture)
- [Prérequis](#prérequis)
- [Installation rapide](#installation-rapide)
- [Installation manuelle pas à pas](#installation-manuelle-pas-à-pas)
- [Configuration](#configuration)
- [Variables d'environnement](#variables-denvironnement)
- [Maintenance](#maintenance)
- [Résolution de problèmes](#résolution-de-problèmes)

---

## Architecture

```
Navigateur utilisateur
        │
        │ HTTPS (443)
        ▼
┌───────────────────────────────────────┐
│              Nginx                    │
│  telephone.votre-domaine.com          │
│                                       │
│  /          → Fichiers statiques SPA  │
│  /api/      → Proxy → Token Server    │
│                         (port 3001)   │
└───────────────────────────────────────┘
        │                    │
        │ WebSocket/HTTP      │ HTTP interne
        ▼                    ▼
┌──────────────┐    ┌─────────────────────┐
│  Matrix      │    │  LiveKit Token      │
│  Synapse     │    │  Server (Node.js)   │
│  (port 8008) │    │  (port 3001)        │
└──────────────┘    └─────────────────────┘
                             │ JWT
                             ▼
                    ┌─────────────────────┐
                    │  Serveur LiveKit    │
                    │  (WebRTC/SFU)       │
                    │  Cloud ou auto-héb. │
                    └─────────────────────┘
```

### Composants

| Composant | Rôle | Port |
|-----------|------|------|
| **Nginx** | Reverse proxy, SSL, rate limiting, fichiers statiques | 80, 443 |
| **Matrix Synapse** | Serveur de messagerie Matrix (comptes, rooms, E2EE key backup) | 8008 (interne) |
| **LiveKit Token Server** | Génère des JWT après vérification du token Matrix | 3001 (interne) |
| **LiveKit** | Serveur SFU pour les appels vidéo de groupe | Externe (wss) |
| **Fail2ban** | Protection contre le brute-force | — |

### Stack technologique

- **Frontend** : HTML5, CSS3, JavaScript ES2022 (SPA, aucun framework)
- **Protocole messagerie** : Matrix (via `matrix-js-sdk` browserifié)
- **Chiffrement** : Olm/Megolm E2EE (WASM), backup de clés côté serveur
- **Appels de groupe** : LiveKit (WebRTC SFU)
- **Appels 1:1** : WebRTC natif (STUN/TURN)
- **Serveur de messagerie** : Matrix Synapse (Python)
- **Token server** : Node.js 20.x
- **Reverse proxy** : Nginx avec HTTP/2
- **SSL** : Let's Encrypt (Certbot)
- **Sécurité** : Fail2ban, UFW, CSP, HSTS, rate limiting

---

## Prérequis

### Serveur

- **OS** : Ubuntu 22.04 LTS (recommandé) ou Ubuntu 20.04 LTS
- **RAM** : 2 Go minimum (4 Go recommandés pour > 50 utilisateurs)
- **CPU** : 1 vCPU minimum (2+ recommandés)
- **Disque** : 20 Go minimum
- **Accès** : root SSH, ports 80 et 443 ouverts

### Noms de domaine

Deux sous-domaines doivent pointer vers l'IP de votre serveur **avant** l'installation (nécessaire pour Let's Encrypt) :

| Domaine | Rôle |
|---------|------|
| `telephone.votre-domaine.com` | Application web (SPA) |
| `matrix.votre-domaine.com` | API Matrix Synapse |

### Services externes

| Service | Obligatoire | Rôle |
|---------|-------------|------|
| **LiveKit Cloud** ou auto-hébergé | Oui | Appels vidéo de groupe |
| **Serveur SMTP** | Optionnel | Vérification email à l'inscription |
| **Serveur TURN** | Optionnel | Relais WebRTC en réseau restrictif |

---

## Installation rapide

```bash
# 1. Cloner le dépôt
git clone https://github.com/Sergio-Oracle/webphone-pro.git
cd webphone-pro

# 2. Lancer le script d'installation interactif
sudo bash deploy/install.sh
```

Le script demande de façon interactive :
- Domaine de l'application (`telephone.exemple.com`)
- Domaine Matrix (`matrix.exemple.com`)
- Email administrateur (Let's Encrypt)
- URL LiveKit WebSocket (`wss://...`)
- Clé et secret API LiveKit
- Email et mot de passe SMTP (optionnel)

**Durée estimée : 10–20 minutes**

---

## Installation manuelle pas à pas

### 1. Dépendances système

```bash
sudo apt update && sudo apt install -y \
    nginx certbot python3-certbot-nginx \
    fail2ban ufw curl wget git openssl

# Node.js 20.x
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
```

### 2. Serveur Matrix (Synapse)

```bash
# Ajouter le dépôt Matrix
wget -qO /usr/share/keyrings/matrix-org-archive-keyring.gpg \
    https://packages.matrix.org/debian/matrix-org-archive-keyring.gpg

echo "deb [signed-by=/usr/share/keyrings/matrix-org-archive-keyring.gpg] \
https://packages.matrix.org/debian/ $(lsb_release -cs) main" \
    | sudo tee /etc/apt/sources.list.d/matrix-org.list

sudo apt update && sudo apt install -y matrix-synapse-py3

# Générer la configuration de base
sudo python3 -m synapse.app.homeserver \
    --server-name "matrix.votre-domaine.com" \
    --config-path "/etc/matrix-synapse/homeserver.yaml" \
    --generate-config --report-stats no

# Copier et adapter le template de configuration
sudo cp deploy/configs/homeserver.yaml.template /etc/matrix-synapse/homeserver.yaml
# Éditer le fichier — remplacer les valeurs {{ VARIABLE }}
sudo nano /etc/matrix-synapse/homeserver.yaml

sudo systemctl enable --now matrix-synapse

# Créer le premier administrateur
sudo register_new_matrix_user \
    -c /etc/matrix-synapse/homeserver.yaml \
    https://matrix.votre-domaine.com
```

### 3. Serveur LiveKit

**Option A — LiveKit Cloud (recommandé)** : créez un projet sur [livekit.io](https://livekit.io) et notez votre API Key et API Secret.

**Option B — Auto-hébergé** :
```bash
curl -sSL https://get.livekit.io | bash
livekit-server generate-config > /etc/livekit.yaml
sudo systemctl enable --now livekit
```

### 4. Serveur de tokens LiveKit

```bash
sudo mkdir -p /opt/livekit-token-server

# Copier les fichiers du serveur de tokens
sudo cp deploy/livekit-token-server/server.js /opt/livekit-token-server/
sudo cp deploy/livekit-token-server/package.json /opt/livekit-token-server/

# Installer les dépendances Node.js
cd /opt/livekit-token-server && sudo npm install && cd -

# Créer le fichier d'environnement (SECRETS — jamais dans le web root)
sudo cp deploy/configs/livekit-token-server.env.example /opt/livekit-token-server/.env
sudo nano /opt/livekit-token-server/.env
sudo chmod 600 /opt/livekit-token-server/.env
sudo chown root:root /opt/livekit-token-server/.env

# Installer le service systemd
sudo tee /etc/systemd/system/livekit-token-server.service > /dev/null <<'SVC'
[Unit]
Description=SENDT LiveKit Token Server
After=network.target

[Service]
Type=simple
User=www-data
WorkingDirectory=/opt/livekit-token-server
ExecStart=/usr/local/bin/node server.js
Restart=on-failure
RestartSec=5
EnvironmentFile=/opt/livekit-token-server/.env

[Install]
WantedBy=multi-user.target
SVC

sudo systemctl daemon-reload
sudo systemctl enable --now livekit-token-server
```

### 5. Déploiement du frontend

```bash
# Cloner dans le répertoire web
sudo git clone https://github.com/Sergio-Oracle/webphone-pro.git \
    /var/www/html/webphone-pro
sudo chown -R www-data:www-data /var/www/html/webphone-pro

# Adapter la configuration aux vos domaines
sudo nano /var/www/html/webphone-pro/js/config.js
```

Modifier dans `config.js` :
```javascript
DEFAULT_HOMESERVER: 'https://matrix.votre-domaine.com',
DEFAULT_DOMAIN: 'matrix.votre-domaine.com',
LIVEKIT: {
    URL: 'wss://livekit.votre-domaine.com',
    TOKEN_ENDPOINT: 'https://telephone.votre-domaine.com/api/connection-details',
},
```

### 6. Nginx (reverse proxy + SSL)

```bash
sudo rm -f /etc/nginx/sites-enabled/default

# Map WebSocket
sudo tee /etc/nginx/conf.d/websocket.conf <<'EOF'
map $http_upgrade $connection_upgrade {
    default upgrade;
    ''      close;
}
EOF

# Certificats SSL (les domaines doivent déjà pointer sur ce serveur)
sudo certbot certonly --nginx \
    -d telephone.votre-domaine.com \
    -d matrix.votre-domaine.com \
    --agree-tos -m admin@votre-domaine.com

# Créer la configuration Nginx (voir le fichier généré par install.sh)
# Adaptez les domaines dans le template ci-dessous :
sudo nano /etc/nginx/sites-available/webphone.conf
sudo ln -sf /etc/nginx/sites-available/webphone.conf \
    /etc/nginx/sites-enabled/webphone.conf
sudo nginx -t && sudo systemctl reload nginx
```

### 7. Sécurité (Fail2ban + UFW)

```bash
sudo ufw allow ssh && sudo ufw allow 80/tcp && sudo ufw allow 443/tcp
sudo ufw --force enable

sudo tee /etc/fail2ban/jail.d/sendt.conf <<'EOF'
[DEFAULT]
bantime  = 3600
findtime = 600
maxretry = 10

[sshd]
enabled = true

[matrix-synapse]
enabled  = true
filter   = matrix-synapse
logpath  = /var/log/nginx/webphone-access.log
maxretry = 5
bantime  = 3600
action   = iptables-multiport[name=matrix-synapse, port="80,443", protocol=tcp]
EOF

sudo systemctl enable --now fail2ban
```

---

## Configuration

### `js/config.js`

Seul fichier de configuration du frontend à adapter :

| Clé | Description | Exemple |
|-----|-------------|---------|
| `DEFAULT_HOMESERVER` | URL complète du homeserver Matrix | `https://matrix.exemple.com` |
| `DEFAULT_DOMAIN` | Domaine Matrix seul | `matrix.exemple.com` |
| `LIVEKIT.URL` | WebSocket du serveur LiveKit | `wss://livekit.exemple.com` |
| `LIVEKIT.TOKEN_ENDPOINT` | Endpoint du token server | `https://telephone.exemple.com/api/connection-details` |

### `/opt/livekit-token-server/.env`

```ini
LIVEKIT_API_KEY=votre_api_key
LIVEKIT_API_SECRET=votre_api_secret
LIVEKIT_URL=wss://livekit.votre-domaine.com
MATRIX_HOMESERVER=https://matrix.votre-domaine.com
PORT=3001
```

### `/etc/matrix-synapse/homeserver.yaml`

Voir le template documenté : `deploy/configs/homeserver.yaml.template`

---

## Variables d'environnement

| Variable | Obligatoire | Description |
|----------|-------------|-------------|
| `LIVEKIT_API_KEY` | Oui | Clé API LiveKit |
| `LIVEKIT_API_SECRET` | Oui | Secret API LiveKit |
| `LIVEKIT_URL` | Oui | URL WebSocket LiveKit |
| `MATRIX_HOMESERVER` | Oui | URL HTTP du homeserver Matrix |
| `PORT` | Non (3001) | Port du token server |

---

## Maintenance

### Mise à jour de l'application

```bash
cd /var/www/html/webphone-pro
sudo git pull origin main
sudo systemctl reload nginx
```

### Sauvegardes

```bash
# Base de données Matrix
sudo sqlite3 /var/lib/matrix-synapse/homeserver.db \
    ".backup /backup/homeserver-$(date +%Y%m%d).db"

# Médias Matrix
sudo tar -czf /backup/matrix-media-$(date +%Y%m%d).tar.gz \
    /var/lib/matrix-synapse/media/

# Clé de signature Matrix (CRITIQUE — conserver hors ligne)
sudo cp /etc/matrix-synapse/homeserver.signing.key /backup/
```

### Logs

```bash
sudo journalctl -u matrix-synapse -f       # Logs Matrix
sudo journalctl -u livekit-token-server -f  # Logs token server
sudo tail -f /var/log/nginx/webphone-access.log
sudo fail2ban-client status matrix-synapse  # IPs bannies
```

---

## Résolution de problèmes

| Symptôme | Diagnostic | Solution |
|----------|------------|----------|
| Application ne charge pas | `sudo systemctl status nginx` | `sudo nginx -t && sudo systemctl reload nginx` |
| Connexion Matrix échoue | `curl https://matrix.exemple.com/_matrix/client/versions` | Vérifier que Synapse écoute sur 8008 |
| Appels de groupe ne fonctionnent pas | Tester l'endpoint `/api/connection-details` | Vérifier le `.env` du token server |
| Messages chiffrés illisibles | Vérifier la console navigateur | Restaurer les clés de sauvegarde depuis Paramètres → Chiffrement |
| Certificat SSL expiré | `sudo certbot renew --dry-run` | `sudo certbot renew && sudo systemctl reload nginx` |

---

## Licence

MIT — Développé par [Sergio-Oracle](https://github.com/Sergio-Oracle)
