# SENDT Webphone Pro + Intégration Moodle (mod_matrix)

Client web Matrix (SENDT) avec intégration SSO complète dans Moodle via le plugin **mod_matrix**.

---

## Contenu du dépôt

```
webphone-pro/
├── css/                        Client SENDT — styles
├── js/
│   ├── app.js                  Application principale (inclut handler SSO Moodle)
│   ├── matrix-client.js        Wrapper Matrix SDK (inclut loginWithToken pour SSO)
│   ├── ui-controller.js        Contrôleur d'interface
│   ├── webrtc-manager.js       Appels WebRTC / LiveKit
│   ├── utils.js                Utilitaires
│   ├── config.js               Configuration (homeserver, LiveKit, etc.)
│   └── browser-matrix.min.js  Matrix JS SDK (bundle)
├── moodle-plugin/
│   └── matrix/                 Plugin Moodle mod_matrix v1.1.0 (ZIP-installable)
├── deploy/
│   ├── nginx/
│   │   └── webphone-pro.conf.example   Config nginx complète (voir ci-dessous)
│   ├── configs/
│   │   └── homeserver.yaml.template    Template Synapse
│   └── install.sh              Script d'installation serveur
├── index.html
└── vendor/                     Olm WASM (E2EE)
```

---

## Architecture

```
┌─────────────────┐   iframe / redirect   ┌──────────────────────┐
│  Moodle         │ ─────────────────────► │  SENDT Webphone Pro  │
│  (mod_matrix)   │   #moodle-sso?token=…  │  (ce dépôt)          │
│                 │ ◄───────────────────── │                      │
└────────┬────────┘   Synapse Admin API    └──────────┬───────────┘
         │                                            │
         │  POST /_synapse/admin/v1/users/{id}/login  │  Matrix C-S API
         └──────────────────────────────────────┐     │
                                                ▼     ▼
                                         ┌────────────────┐
                                         │  Synapse       │
                                         │  (homeserver)  │
                                         └────────────────┘
```

**Flux SSO :**
1. L'étudiant ouvre l'activité "Chat Matrix" dans Moodle
2. Moodle appelle l'API admin Synapse → génère un token valide 8h
3. Moodle redirige vers `https://chat.example.com/#moodle-sso?token=TOK;user=@x:server;room=!r:server`
4. SENDT détecte le hash, parse les paramètres, appelle `loginWithToken()`
5. L'étudiant est connecté et le salon s'ouvre automatiquement — sans saisir de mot de passe

---

## Plugin Moodle — mod_matrix v1.1.0

### Installation

1. Générer le ZIP :
   ```bash
   cd moodle-plugin && zip -r ../mod_matrix.zip matrix/
   ```
2. Dans Moodle : **Administration du site → Plugins → Installer un plugin** → uploader le ZIP

### Configuration (Administration → Plugins → Chat Matrix)

| Paramètre | Description | Exemple |
|---|---|---|
| URL du serveur Matrix | URL base du homeserver Synapse | `https://matrix.example.com` |
| Domaine du serveur | Utilisé dans les IDs et alias | `example.com` |
| URL du client Matrix | URL de cette application SENDT | `https://chat.example.com` |
| Token admin | Token d'un compte admin Synapse | `syt_…` |
| Durée du token SSO | Validité des tokens générés | 8 heures (recommandé) |
| Vérifier SSL | Désactiver uniquement en dev | activé |

Après configuration, cliquer **"Lancer les diagnostics"** pour valider la connexion.

### Obtenir le token admin Synapse

```bash
curl -X POST https://matrix.example.com/_matrix/client/v3/login \
  -H "Content-Type: application/json" \
  -d '{"type":"m.login.password","user":"@admin:example.com","password":"MOT_DE_PASSE"}'
```

Récupérer la valeur `access_token` dans la réponse.

---

## Serveur SENDT — Configuration nginx

Copier `deploy/nginx/webphone-pro.conf.example` dans `/etc/nginx/sites-available/` et remplacer :

| Placeholder | Valeur |
|---|---|
| `YOUR_DOMAIN` | Domaine SENDT, ex. `chat.example.com` |
| `YOUR_HOMESERVER` | Homeserver Matrix, ex. `matrix.example.com` |
| `YOUR_MOODLE_ORIGIN` | URL Moodle, ex. `https://moodle.example.com` |

**Points critiques :**
- `X-Frame-Options` est **absent** intentionnellement — la sécurité est gérée par `frame-ancestors` dans la CSP
- `'wasm-unsafe-eval'` dans `script-src` est **obligatoire** pour Olm WebAssembly
- Les headers doivent être **répétés dans chaque bloc `location`** (règle d'héritage nginx)

---

## Changelog

### v19.10 — Intégration Moodle robuste

#### `js/app.js` — Handler SSO Moodle

**Bug 1 — `&amp;` dans l'URL du hash**
Moodle's `html_writer::tag()` encode `&` en `&amp;` dans les attributs HTML (`src` de l'iframe).
Le navigateur conserve `&amp;` littéralement dans le fragment. `URLSearchParams` ne trouve pas
`user=` et `room=` → l'utilisateur voit la page de login au lieu du chat.

**Fix :** normalisation avant parsing :
```javascript
const _rawHash = hash.replace(/&amp;/g, '&').replace(/;/g, '&');
const params   = new URLSearchParams(_rawHash);
```

**Bug 2 — Homeserver hardcodé**
Utilisait `CONFIG.DEFAULT_HOMESERVER`, fixe par déploiement.

**Fix :** extraction depuis le user ID Matrix :
```javascript
const domain     = userId.match(/:([^:]+)$/)?.[1];
const homeserver = CONFIG.MATRIX_HOMESERVER_URL || ('https://' + domain);
```

**Bug 3 — Race condition `checkSavedCredentials()`**
S'exécutait en parallèle du login SSO asynchrone.

**Fix :** flag `window._moodleSSOActive = true` pendant le login.

---

#### `js/matrix-client.js` — `loginWithToken()`

**Bug 1 — device_id instable**
Générait `"MOODLE_" + tag + "_" + Date.now()` → nouveau device à chaque connexion,
accumulation de devices, erreurs E2EE.

**Fix :** device_id stable identique au PHP :
```javascript
// JS                                   // PHP (lib.php)
"MOODLE_" + userId                      'MOODLE_' . substr($tag, 0, 8)
  .replace(/[^A-Z0-9]/gi,'')
  .substring(0,8).toUpperCase()
```

**Bug 2 — E2EE activé → erreur 400 `keys/upload`**
Les tokens admin Synapse n'ont pas de contexte `device_id` dans l'auth Synapse.
`_initCrypto()` → `keys/upload` → `400 "must pass device_id"`.

**Fix :** `this.cryptoEnabled = false` pour les sessions SSO.
Les messages restent protégés par TLS. L'E2EE manuel reste disponible hors SSO.

---

#### `moodle-plugin/matrix/` — Plugin mod_matrix v1.1.0 (nouveau)

Plugin Moodle complet. Voir `moodle-plugin/matrix/` pour le code source.

Fonctionnalités principales :
- SSO automatique via token Synapse (8h, configurable)
- Force-join sans invitation à accepter
- Création automatique de salons Matrix
- Timer JS : refresh iframe 5 min avant expiration du token
- `allow_iframe` : fallback automatique en mode "nouvelle fenêtre"
- SSL verify, timeout API configurables par l'admin
- Page de diagnostics (4 tests en direct)
- 0 URL/domaine hardcodé — fonctionne sur n'importe quel déploiement Moodle

---

### v19.9 — Section Token d'accès dans Paramètres › Compte
### v19.8 — E2EE fixes, groupe visibility fix, scripts de déploiement complets
