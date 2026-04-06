# SENDT Webphone Pro — Guide de démarrage rapide

Pour les développeurs qui veulent déployer en **moins de 30 minutes**.

---

## Ce dont vous avez besoin avant de commencer

- [ ] Un serveur Ubuntu 22.04 avec accès root
- [ ] Deux sous-domaines DNS configurés (ex: `app.exemple.com` et `matrix.exemple.com`) pointant vers votre serveur
- [ ] Un compte [LiveKit Cloud](https://livekit.io) (gratuit) avec votre API Key et API Secret
- [ ] Un compte email SMTP (Gmail, etc.) pour les confirmations d'inscription

---

## Installation en 3 commandes

```bash
git clone https://github.com/Sergio-Oracle/webphone-pro.git
cd webphone-pro
sudo bash deploy/install.sh
```

Répondez aux questions du script. Attendez 10–20 minutes. C'est tout.

---

## Vérification post-installation

```bash
# 1. Matrix API répond ?
curl https://matrix.votre-domaine.com/_matrix/client/versions
# Attendu : {"versions":["r0.0.1", ...]}

# 2. Application accessible ?
curl -I https://telephone.votre-domaine.com
# Attendu : HTTP/2 200

# 3. Token server répond ?
curl https://telephone.votre-domaine.com/api/connection-details
# Attendu : {"error":"Unauthorized..."} (normal sans token Matrix)

# 4. Services actifs ?
sudo systemctl status nginx matrix-synapse livekit-token-server fail2ban
```

---

## Créer le premier compte administrateur

```bash
sudo register_new_matrix_user \
    -c /etc/matrix-synapse/homeserver.yaml \
    https://matrix.votre-domaine.com
```

Le script demande : nom d'utilisateur, mot de passe, admin (yes).

---

## Configuration minimale requise

Après le script, vérifiez et adaptez ces 3 fichiers si nécessaire :

**`/var/www/html/webphone-pro/js/config.js`**
```javascript
DEFAULT_HOMESERVER: 'https://matrix.votre-domaine.com',
DEFAULT_DOMAIN: 'matrix.votre-domaine.com',
LIVEKIT: {
    URL: 'wss://livekit.votre-domaine.com',
    TOKEN_ENDPOINT: 'https://telephone.votre-domaine.com/api/connection-details',
},
```

**`/opt/livekit-token-server/.env`**
```ini
LIVEKIT_API_KEY=your_key
LIVEKIT_API_SECRET=your_secret
LIVEKIT_URL=wss://livekit.votre-domaine.com
MATRIX_HOMESERVER=https://matrix.votre-domaine.com
```

Après modification du `.env` :
```bash
sudo systemctl restart livekit-token-server
```

---

## Structure des fichiers déployés

```
/var/www/html/webphone-pro/     # Frontend SPA
    js/config.js                # Configuration des URLs (à adapter)
    js/matrix-client.js         # Logique Matrix/E2EE
    js/app.js                   # Application principale
    vendor/olm.js + olm.wasm    # Librairie E2EE Olm

/opt/livekit-token-server/      # Serveur de tokens LiveKit
    server.js                   # Code Node.js
    .env                        # Secrets (chmod 600)

/etc/matrix-synapse/            # Configuration Matrix Synapse
    homeserver.yaml             # Config principale (contient les secrets)

/etc/nginx/sites-available/     # Configuration Nginx
    webphone.conf               # Vhosts avec SSL et rate limiting

/etc/fail2ban/                  # Protection brute-force
    jail.d/sendt.conf
```

---

## Commandes utiles

```bash
# Redémarrer tous les services
sudo systemctl restart nginx matrix-synapse livekit-token-server

# Voir les logs en temps réel
sudo journalctl -u matrix-synapse -u livekit-token-server -f

# Mettre à jour l'application
sudo git pull && sudo systemctl reload nginx

# Renouveler les certificats SSL (normalement automatique)
sudo certbot renew && sudo systemctl reload nginx

# Voir les IPs bannies
sudo fail2ban-client status matrix-synapse
```

---

## Résolution rapide des problèmes courants

**Erreur 502 Bad Gateway** → Synapse ou le token server n'est pas démarré
```bash
sudo systemctl start matrix-synapse livekit-token-server
```

**Erreur de certificat SSL** → Les DNS ne pointaient pas encore vers ce serveur
```bash
sudo certbot certonly --nginx -d app.exemple.com -d matrix.exemple.com
```

**"Impossible de joindre le serveur"** → `config.js` n'a pas été mis à jour
```bash
sudo nano /var/www/html/webphone-pro/js/config.js
```

**Les appels ne fonctionnent pas** → Vérifier la clé LiveKit dans `.env`
```bash
sudo cat /opt/livekit-token-server/.env
sudo journalctl -u livekit-token-server -n 30
```

---

Pour la documentation complète, voir [README.md](README.md).
