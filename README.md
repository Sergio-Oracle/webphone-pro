# 📱 MATRIXPHONE - WEBPHONE PROFESSIONNEL

Application de téléphonie web professionnelle basée sur Matrix et WebRTC avec une interface moderne style WhatsApp.

## 🎯 Caractéristiques

### Interface
- ✅ Design moderne style WhatsApp Dark Theme
- ✅ Interface responsive (desktop et mobile)
- ✅ Animations fluides et transitions élégantes
- ✅ Mode sombre professionnel

### Fonctionnalités
- ✅ Authentification Matrix sécurisée
- ✅ Appels audio/vidéo WebRTC
- ✅ Gestion des contacts
- ✅ Historique d'appels
- ✅ Chiffrement de bout en bout (E2EE)
- ✅ Notifications toast
- ✅ Paramètres personnalisables
- ✅ Détection des périphériques audio/vidéo

### Technique
- ✅ Matrix Protocol
- ✅ WebRTC pour les appels P2P
- ✅ Architecture modulaire (séparation des préoccupations)
- ✅ Code documenté et maintenable
- ✅ Gestion d'erreurs robuste

## 📦 Structure du projet

```
webphone-pro/
├── index.html              # Page principale
├── css/
│   └── style.css          # Styles complets
├── js/
│   ├── config.js          # Configuration
│   ├── utils.js           # Fonctions utilitaires
│   ├── matrix-client.js   # Client Matrix
│   ├── webrtc-manager.js  # Gestionnaire WebRTC
│   ├── ui-controller.js   # Contrôleur d'interface
│   └── app.js             # Application principale
├── sounds/
│   └── ringtone.mp3       # Sonnerie d'appel
└── assets/
    └── icons/             # Icônes de l'application
```

## 🚀 Installation

### Prérequis
- Serveur web (Apache, Nginx, ou serveur local)
- Accès à un serveur Matrix
- Navigateur moderne (Chrome, Firefox, Edge, Safari)
- HTTPS (requis pour WebRTC)

### Étape 1 : Télécharger les fichiers
```bash
# Cloner ou télécharger le projet
cd /var/www/html/
unzip webphone-pro.zip
```

### Étape 2 : Configuration
Éditer `js/config.js` :

```javascript
const CONFIG = {
    DEFAULT_HOMESERVER: 'https://votre-serveur.matrix.org',
    ICE_SERVERS: [
        { urls: 'stun:stun.l.google.com:19302' },
        // Ajouter votre serveur TURN si nécessaire
    ]
};
```

### Étape 3 : Serveur web
```bash
# Avec Python (développement)
cd webphone-pro
python3 -m http.server 8000

# Ou avec Apache/Nginx (production)
# Configurer le vhost pour pointer vers le dossier
```

### Étape 4 : Accéder
Ouvrir dans le navigateur :
- Développement : `http://localhost:8000`
- Production : `https://votre-domaine.com`

⚠️ **IMPORTANT** : WebRTC nécessite HTTPS en production !

## 🔧 Configuration avancée

### Serveur TURN
Pour les appels à travers NAT/Firewall, configurer un serveur TURN :

```javascript
ICE_SERVERS: [
    { urls: 'stun:stun.l.google.com:19302' },
    {
        urls: 'turn:turn.votre-serveur.com:3478',
        username: 'utilisateur',
        credential: 'mot_de_passe'
    }
]
```

### Qualité vidéo
Ajuster dans `config.js` :

```javascript
VIDEO_CONSTRAINTS: {
    width: { ideal: 1920, max: 1920 },  // Full HD
    height: { ideal: 1080, max: 1080 },
    frameRate: { ideal: 60 }
}
```

## 📱 Utilisation

### 1. Connexion
1. Ouvrir l'application
2. Entrer le serveur Matrix (ex: https://jn.rtn.sn)
3. Entrer identifiant (ex: @utilisateur:jn.rtn.sn)
4. Entrer mot de passe
5. Cliquer sur "Se connecter"

### 2. Ajouter un contact
1. Cliquer sur l'icône "+" dans la sidebar
2. Entrer l'identifiant Matrix du contact
3. Ajouter un nom d'affichage (optionnel)
4. Cliquer sur "Ajouter"

### 3. Passer un appel
1. Sélectionner un contact dans la liste
2. Cliquer sur "Audio" ou "Vidéo"
3. Attendre la connexion
4. Utiliser les contrôles pour couper audio/vidéo
5. Cliquer sur le bouton rouge pour raccrocher

### 4. Recevoir un appel
1. Une notification apparaît avec le nom de l'appelant
2. Cliquer sur "Accepter" ou "Refuser"
3. Si accepté, l'appel démarre automatiquement

## 🛠️ Développement

### Structure du code

**config.js**
- Configuration globale
- Serveurs ICE
- Contraintes média
- Clés de stockage

**utils.js**
- Fonctions utilitaires
- Formateurs
- Helpers

**matrix-client.js**
- Connexion Matrix
- Gestion des événements
- Envoi/réception de messages

**webrtc-manager.js**
- Configuration PeerConnection
- Gestion des médias
- Signalisation
- Candidats ICE

**ui-controller.js**
- Manipulation du DOM
- Gestion des modales
- Notifications
- Navigation

**app.js**
- Orchestration générale
- Initialisation
- Handlers d'événements

### Ajouter des fonctionnalités

**Exemple : Partage d'écran**
```javascript
async function shareScreen() {
    try {
        const stream = await navigator.mediaDevices.getDisplayMedia({
            video: true
        });
        
        // Remplacer le track vidéo
        const videoTrack = stream.getVideoTracks()[0];
        const sender = peerConnection.getSenders()
            .find(s => s.track.kind === 'video');
        
        await sender.replaceTrack(videoTrack);
        
        videoTrack.onended = () => {
            // Retour à la caméra
            const cameraTrack = localStream.getVideoTracks()[0];
            sender.replaceTrack(cameraTrack);
        };
    } catch (error) {
        console.error('Erreur partage d\'écran:', error);
    }
}
```

## 🐛 Dépannage

### Problème : Pas de vidéo locale
**Solution :**
1. Vérifier les permissions caméra/micro dans le navigateur
2. Vérifier que HTTPS est activé
3. Ouvrir la console (F12) pour voir les erreurs

### Problème : Appel ne se connecte pas
**Solution :**
1. Vérifier les logs console (F12)
2. Vérifier que les deux clients sont connectés à Matrix
3. Vérifier la configuration ICE (STUN/TURN)
4. Tester avec chrome://webrtc-internals

### Problème : Audio mais pas de vidéo
**Solution :**
1. Vérifier les contraintes vidéo dans config.js
2. Vérifier que la caméra n'est pas utilisée par une autre app
3. Essayer de réduire la qualité vidéo

### Problème : Erreur CORS
**Solution :**
1. Utiliser HTTPS
2. Vérifier la configuration du serveur web
3. Utiliser un serveur local pour le développement

## 📊 Performances

### Optimisations recommandées
- ✅ Utiliser des serveurs TURN proches géographiquement
- ✅ Ajuster la qualité vidéo selon la bande passante
- ✅ Activer la compression vidéo
- ✅ Limiter le nombre d'événements Matrix

### Monitoring
Surveiller dans chrome://webrtc-internals :
- Taux de perte de paquets
- Latence (RTT)
- Bande passante utilisée
- État de la connexion ICE

## 🔒 Sécurité

### Bonnes pratiques
- ✅ Toujours utiliser HTTPS en production
- ✅ Activer le chiffrement E2EE Matrix
- ✅ Ne jamais stocker les mots de passe
- ✅ Valider toutes les entrées utilisateur
- ✅ Utiliser des serveurs TURN sécurisés

### Chiffrement
- WebRTC utilise DTLS/SRTP automatiquement
- Matrix offre E2EE avec Olm/Megolm
- Authentification basée sur tokens

## 📚 Ressources

### Documentation
- [Matrix Spec](https://spec.matrix.org/)
- [Matrix JS SDK](https://matrix-org.github.io/matrix-js-sdk/)
- [WebRTC API](https://developer.mozilla.org/en-US/docs/Web/API/WebRTC_API)
- [RTCPeerConnection](https://developer.mozilla.org/en-US/docs/Web/API/RTCPeerConnection)

### Outils
- [chrome://webrtc-internals](chrome://webrtc-internals) - Debug WebRTC
- [Matrix Console](https://app.element.io/) - Test Matrix
- [WebRTC Samples](https://webrtc.github.io/samples/) - Exemples

## 🤝 Contribution

### Signaler un bug
1. Ouvrir un ticket avec :
   - Description détaillée
   - Étapes pour reproduire
   - Logs console (F12)
   - Navigateur et version

### Proposer une amélioration
1. Décrire la fonctionnalité
2. Expliquer le cas d'usage
3. Proposer une implémentation

## 📄 Licence

Ce projet est fourni à des fins éducatives.
- Libre d'utilisation pour l'apprentissage
- Adaptable selon vos besoins
- Aucune garantie

## 👨‍💻 Auteur

Développé pour l'enseignement du protocole Matrix et de WebRTC.

## 🆘 Support

Pour obtenir de l'aide :
1. Consulter la documentation
2. Vérifier les issues existantes
3. Consulter les logs navigateur
4. Tester sur chrome://webrtc-internals

## 🎓 Utilisation pédagogique

Ce projet est parfait pour :
- Apprendre Matrix et WebRTC
- Comprendre la signalisation d'appels
- Découvrir le chiffrement E2EE
- Pratiquer JavaScript moderne
- Étudier les APIs navigateur

## ✨ Améliorations futures

- [ ] Messages texte dans les conversations
- [ ] Groupe d'appels (conférence)
- [ ] Enregistrement d'appels
- [ ] Partage d'écran
- [ ] Filtres vidéo
- [ ] Mode sombre/clair
- [ ] Notifications push
- [ ] Application mobile (React Native)

---

**Bon développement ! 🚀📞**
