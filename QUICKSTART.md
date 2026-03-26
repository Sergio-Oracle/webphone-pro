# 🚀 MATRIXPHONE - GUIDE DE DÉMARRAGE RAPIDE

## Installation en 5 minutes

### 📦 Étape 1 : Extraire les fichiers

```bash
# Sur votre serveur
cd /var/www/html/
unzip MatrixPhone_Professional.zip
cd webphone-pro
```

### ⚙️ Étape 2 : Configuration minimale

Éditer `js/config.js` :

```javascript
const CONFIG = {
    DEFAULT_HOMESERVER: 'https://jn.rtn.sn',  // ← Votre serveur Matrix
    ICE_SERVERS: [
        { urls: 'stun:stun.l.google.com:19302' }
    ]
};
```

### 🌐 Étape 3 : Déploiement

**Option A : Serveur Apache/Nginx (Production)**

```nginx
# /etc/nginx/sites-available/matrixphone.conf
server {
    listen 443 ssl http2;
    server_name phone.votre-domaine.com;
    
    ssl_certificate /etc/letsencrypt/live/phone.votre-domaine.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/phone.votre-domaine.com/privkey.pem;
    
    root /var/www/html/webphone-pro;
    index index.html;
    
    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

```bash
# Activer et redémarrer
sudo ln -s /etc/nginx/sites-available/matrixphone.conf /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

**Option B : Serveur Python (Développement)**

```bash
cd webphone-pro
python3 -m http.server 8000
```

Puis ouvrir : `http://localhost:8000`

⚠️ **IMPORTANT** : WebRTC nécessite HTTPS en production !

### 🎯 Étape 4 : Tester

1. Ouvrir dans le navigateur : `https://phone.votre-domaine.com`
2. Entrer vos identifiants Matrix
3. Ajouter un contact
4. Passer votre premier appel !

---

## 📞 Premier appel en 3 étapes

### 1️⃣ Connexion
- Serveur : `https://jn.rtn.sn`
- Identifiant : `@votre-user:jn.rtn.sn`
- Mot de passe : `votre-mot-de-passe`

### 2️⃣ Ajouter un contact
- Cliquer sur le bouton `+`
- Entrer : `@contact:jn.rtn.sn`
- Sauvegarder

### 3️⃣ Appeler
- Sélectionner le contact
- Cliquer sur "Vidéo" ou "Audio"
- Attendre la connexion
- Profitez de votre appel chiffré !

---

## 🔧 Dépannage rapide

### ❌ Pas de vidéo
```
1. Autoriser caméra/micro dans le navigateur
2. Vérifier HTTPS activé
3. F12 → Console → Vérifier les erreurs
```

### ❌ Connexion impossible
```
1. Vérifier serveur Matrix accessible
2. Vérifier identifiants corrects
3. Vérifier CORS configuré
```

### ❌ Appel ne se connecte pas
```
1. Vérifier les deux clients connectés
2. Ajouter un serveur TURN si NAT
3. chrome://webrtc-internals → Vérifier ICE
```

---

## 🎨 Interface

### Style WhatsApp Dark
- ✅ Sidebar avec liste de contacts
- ✅ Zone principale pour les appels
- ✅ Écran d'appel immersif
- ✅ Contrôles intuitifs
- ✅ Notifications toast

### Fonctionnalités
- ✅ Appels audio/vidéo HD
- ✅ Chiffrement E2EE
- ✅ Gestion contacts
- ✅ Historique d'appels
- ✅ Paramètres personnalisables

---

## 📱 Utilisation

### Contrôles pendant l'appel

| Bouton | Action |
|--------|--------|
| 🎤 | Couper/activer le micro |
| 📹 | Couper/activer la vidéo |
| 🔴 | Raccrocher |
| ⛶ | Plein écran |
| ⚙️ | Paramètres |

### Raccourcis clavier
- `Ctrl+M` : Mute/Unmute micro
- `Ctrl+E` : Activer/Désactiver vidéo
- `Ctrl+H` : Raccrocher
- `F11` : Plein écran

---

## 🔐 Sécurité

### Chiffrement
✅ WebRTC : DTLS/SRTP automatique  
✅ Matrix : E2EE avec Olm/Megolm  
✅ HTTPS : Transport sécurisé  

### Confidentialité
✅ Appels P2P (direct entre clients)  
✅ Pas de stockage serveur  
✅ Authentification par token  

---

## 📊 Performance

### Qualité recommandée

| Réseau | Qualité vidéo |
|--------|---------------|
| Fibre/4G | Full HD (1080p) |
| ADSL | HD (720p) |
| 3G | SD (480p) |

### Bande passante

| Type d'appel | Minimum | Recommandé |
|--------------|---------|------------|
| Audio seul | 64 kbps | 128 kbps |
| Vidéo SD | 500 kbps | 1 Mbps |
| Vidéo HD | 1.5 Mbps | 3 Mbps |
| Vidéo Full HD | 3 Mbps | 5 Mbps |

---

## 🆘 Support

### Logs
```bash
# Console navigateur
F12 → Console

# WebRTC internals
chrome://webrtc-internals
firefox: about:webrtc
```

### Ressources
- [Documentation Matrix](https://spec.matrix.org/)
- [Guide WebRTC](https://webrtc.org/getting-started/overview)
- [Matrix JS SDK](https://matrix-org.github.io/matrix-js-sdk/)

---

## ✅ Checklist de déploiement

- [ ] Fichiers extraits
- [ ] config.js configuré
- [ ] HTTPS activé
- [ ] Certificat SSL valide
- [ ] Serveur Matrix accessible
- [ ] Permissions navigateur acceptées
- [ ] Test d'appel réussi

---

**🎉 Vous êtes prêt ! Bon appel !**

Pour plus de détails, consultez le [README.md](README.md) complet.
