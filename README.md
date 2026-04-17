# SENDT Webphone Pro

Client web Matrix avec intégration SSO complète dans Moodle via le plugin **[mod_matrix](https://github.com/Sergio-Oracle/moodle-mod-matrix)**.

---

## Dépôts liés

| Dépôt | Rôle |
|---|---|
| **ce dépôt** — `webphone-pro` | Client SENDT (interface web, WebRTC, Matrix SDK) |
| **[moodle-mod-matrix](https://github.com/Sergio-Oracle/moodle-mod-matrix)** | Plugin Moodle `mod_matrix` v1.1.0 (SSO, activité Chat Matrix) |

---

## Structure

```
webphone-pro/
├── css/                        Styles du client SENDT
├── js/
│   ├── app.js                  Application principale (handler SSO Moodle)
│   ├── matrix-client.js        Wrapper Matrix SDK (loginWithToken pour SSO)
│   ├── ui-controller.js        Contrôleur d'interface
│   ├── webrtc-manager.js       Appels WebRTC / LiveKit
│   ├── utils.js                Utilitaires
│   ├── config.js               Configuration (homeserver, LiveKit, etc.)
│   └── browser-matrix.min.js  Matrix JS SDK (bundle)
├── deploy/
│   ├── nginx/
│   │   └── webphone-pro.conf.example   Config nginx complète
│   ├── configs/
│   │   └── homeserver.yaml.template    Template Synapse
│   └── install.sh              Script d'installation serveur
├── icons/                      Icônes PWA
├── sounds/                     Sonneries
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

## Plugin Moodle

Le plugin `mod_matrix` est désormais maintenu dans son propre dépôt :  
**→ [github.com/Sergio-Oracle/moodle-mod-matrix](https://github.com/Sergio-Oracle/moodle-mod-matrix)**

### Installation rapide

```bash
git clone https://github.com/Sergio-Oracle/moodle-mod-matrix.git
cd moodle-mod-matrix
zip -r mod_matrix.zip matrix/   # ou zipper le contenu de ce dépôt directement
```

Puis dans Moodle : **Administration du site → Plugins → Installer un plugin** → uploader le ZIP.

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

**Fix :** device_id stable :
```javascript
"MOODLE_" + userId.replace(/[^A-Z0-9]/gi,'').substring(0,8).toUpperCase()
```

**Bug 2 — E2EE activé → erreur 400 `keys/upload`**  
Les tokens admin Synapse n'ont pas de contexte `device_id` dans l'auth Synapse.

**Fix :** `this.cryptoEnabled = false` pour les sessions SSO.  
Les messages restent protégés par TLS. L'E2EE manuel reste disponible hors SSO.

---

### v19.9 — Section Token d'accès dans Paramètres › Compte
### v19.8 — E2EE fixes, groupe visibility fix, scripts de déploiement complets
