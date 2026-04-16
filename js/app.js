// app.js
// Application principale SENDT v14.2
// ✅ acceptInvitation / declineInvitation globaux
// ✅ toggleEphemeralMenu global
// ✅ Toutes les fonctions globales nécessaires

let isLoggedIn = false;

/** Transition depuis la landing page vers le flux de connexion */
function launchApp() {
    document.getElementById('landing-screen')?.classList.remove('active');
    document.getElementById('login-screen')?.classList.add('active');
}

// ── Initialisation Olm (WASM pour E2EE) ──────────────────────────────────────
async function initOlm() {
    if (!window.Olm) return false;
    try {
        await window.Olm.init({ locateFile: () => '/vendor/olm.wasm' });
        return true;
    } catch(e) {
        console.warn('[E2EE] Olm init échoué:', e.message);
        return false;
    }
}

document.addEventListener('DOMContentLoaded', () => {
    // Supprimer l'ancien username en clair s'il existe encore (migration sécurité M3)
    localStorage.removeItem('username');
    // Initialiser Olm pour E2EE
    initOlm().then(ok => {
        if (ok) console.log('[E2EE] ✅ Olm WASM prêt');
    });

    // Forcer le reset de tous les écrans au chargement (évite le spinner bloqué après refresh)
    ['login-screen', 'app-screen', 'loading-screen', 'call-screen'].forEach(id => {
        document.getElementById(id)?.classList.remove('active');
    });
    // Détecter le retour depuis le lien email de réinitialisation de mot de passe
    if (window.location.hash === '#reset-password') {
        history.replaceState(null, '', window.location.pathname);
        document.getElementById('login-screen')?.classList.add('active');
        switchLoginMode('forgot-step2');
    } else if (window.location.hash.startsWith('#email-confirmed')) {
        // Retour depuis le lien de validation email (liaison compte)
        // Synapse peut ajouter ?sid=... au fragment, on l'ignore
        history.replaceState(null, '', window.location.pathname);
        sessionStorage.setItem('_pendingEmailConfirm', '1');
        document.getElementById('landing-screen')?.classList.add('active');
    } else if (window.location.hash.startsWith('#moodle-sso')) {
        // ── Plugin Moodle SSO ─────────────────────────────────────────────────────
        // Format: #moodle-sso?token=ACCESS_TOKEN&user=USER_ID&room=ROOM_ID
        const _moodleParams = new URLSearchParams(window.location.hash.replace('#moodle-sso', '').replace(/^\?/, ''));
        const _moodleToken  = _moodleParams.get('token');
        const _moodleUser   = _moodleParams.get('user');
        const _moodleRoom   = _moodleParams.get('room');
        history.replaceState(null, '', window.location.pathname);

        if (_moodleToken && _moodleUser) {
            // Show loading screen immediately
            const _lds = document.getElementById('loading-screen');
            const _lsub = _lds?.querySelector('.sendt-subtitle');
            if (_lds) _lds.classList.add('active');
            if (_lsub) _lsub.textContent = 'Connexion depuis Moodle...';

            uiController.init();

            (async () => {
                const r = await matrixManager.loginWithToken(CONFIG.DEFAULT_HOMESERVER, _moodleUser, _moodleToken);
                if (r.success) {
                    const p = matrixManager.getUserProfile();
                    uiController.updateUserProfile(r.userId, p.displayname || _moodleUser);
                    uiController._updateSidebarAvatar?.();
                    if (_lsub) _lsub.textContent = 'Bienvenue !';
                    setTimeout(async () => {
                        if (_lds) _lds.classList.remove('active');
                        document.getElementById('app-screen')?.classList.add('active');
                        isLoggedIn = true;
                        _initE2EEAfterLogin?.();
                        // Auto-navigate to the Moodle room if provided
                        if (_moodleRoom) {
                            setTimeout(() => {
                                try { uiController.selectGroup(_moodleRoom); }
                                catch(e) { console.warn('[Moodle SSO] selectGroup failed:', e); }
                            }, 1200);
                        }
                    }, 300);
                } else {
                    if (_lds) _lds.classList.remove('active');
                    document.getElementById('landing-screen')?.classList.add('active');
                    console.error('[Moodle SSO] Echec autologin:', r.error);
                    showToast('Connexion automatique echouee. Connectez-vous manuellement.', 'error');
                }
            })();
            checkSavedCredentials();
            return; // Skip uiController.init() below (already called)
        } else {
            document.getElementById('landing-screen')?.classList.add('active');
        }
    } else {
        document.getElementById('landing-screen')?.classList.add('active');
    }
    uiController.init();
    checkSavedCredentials();
});

// Gestion du bfcache (restauration depuis le cache navigateur lors du retour/refresh)
window.addEventListener('pageshow', (e) => {
    if (e.persisted) {
        ['login-screen', 'app-screen', 'loading-screen', 'call-screen'].forEach(id => {
            document.getElementById(id)?.classList.remove('active');
        });
        document.getElementById('landing-screen')?.classList.add('active');
        isLoggedIn = false;
        // Relancer la visibilité des éléments animés en cas de bfcache
        setTimeout(() => {
            document.querySelectorAll('.lp-anim').forEach(el => {
                el.style.opacity = '1';
                el.style.transform = 'translateY(0)';
            });
        }, 200);
    }
});

function togglePassword() {
    const i = document.getElementById('password'), ic = document.querySelector('#login-panel .toggle-password i');
    if (!i || !ic) return;
    if (i.type === 'password') { i.type = 'text'; ic.className = 'fas fa-eye-slash'; }
    else { i.type = 'password'; ic.className = 'fas fa-eye'; }
}
function toggleRegPassword() {
    const i = document.getElementById('reg-password'), ic = document.querySelector('#register-panel .toggle-password i');
    if (!i || !ic) return;
    if (i.type === 'password') { i.type = 'text'; ic.className = 'fas fa-eye-slash'; }
    else { i.type = 'password'; ic.className = 'fas fa-eye'; }
}

// ── Navigation entre les panneaux de la page de connexion ──
let _forgotSid = null, _forgotSecret = null;
function switchLoginMode(mode) {
    document.getElementById('login-panel')?.classList.add('hidden');
    document.getElementById('register-panel')?.classList.add('hidden');
    document.getElementById('forgot-panel')?.classList.add('hidden');
    document.querySelectorAll('.login-mode-tab').forEach(t => t.classList.remove('active'));
    if (mode === 'login') {
        document.getElementById('login-panel')?.classList.remove('hidden');
        document.getElementById('ltab-login')?.classList.add('active');
    } else if (mode === 'register') {
        document.getElementById('register-panel')?.classList.remove('hidden');
        document.getElementById('ltab-register')?.classList.add('active');
    } else if (mode === 'forgot') {
        document.getElementById('forgot-panel')?.classList.remove('hidden');
        document.getElementById('forgot-step1')?.classList.remove('hidden');
        document.getElementById('forgot-step2')?.classList.add('hidden');
    } else if (mode === 'forgot-step2') {
        document.getElementById('forgot-panel')?.classList.remove('hidden');
        document.getElementById('forgot-step1')?.classList.add('hidden');
        document.getElementById('forgot-step2')?.classList.remove('hidden');
    }
}

// ── Indicateur visuel de force du mot de passe (L3) ──
function _updatePasswordStrength(pass) {
    const fill  = document.getElementById('pwd-strength-fill');
    const label = document.getElementById('pwd-strength-label');
    if (!fill || !label) return;
    let score = 0;
    if (pass.length >= 8)        score++;
    if (/[a-z]/.test(pass))      score++;
    if (/[0-9]/.test(pass))      score++;
    if (/[A-Z]/.test(pass))      score++;
    if (/[^a-zA-Z0-9]/.test(pass)) score++;
    const levels = [
        { pct: '0%',   color: 'transparent', text: '' },
        { pct: '25%',  color: '#E31B23',      text: 'Trop faible' },
        { pct: '50%',  color: '#ffa726',      text: 'Faible' },
        { pct: '75%',  color: '#FDEF42',      text: 'Moyen' },
        { pct: '90%',  color: '#25D366',      text: 'Fort' },
        { pct: '100%', color: '#00853F',      text: 'Très fort' },
    ];
    const l = levels[Math.min(score, 5)];
    fill.style.width = pass.length ? l.pct : '0%';
    fill.style.background = l.color;
    label.textContent = pass.length ? l.text : '';
    label.style.color = l.color;
}

// ── Validation force du mot de passe (L3) ──
function _validatePassword(pass) {
    if (!pass || pass.length < 8)          return 'Le mot de passe doit contenir au moins 8 caractères.';
    if (!/[a-z]/.test(pass))               return 'Le mot de passe doit contenir au moins une lettre minuscule.';
    if (!/[0-9]/.test(pass))               return 'Le mot de passe doit contenir au moins un chiffre.';
    return null; // valide
}

// ── Inscription ──
async function submitRegister() {
    const btn = document.getElementById('register-btn');
    const err = document.getElementById('register-error');
    const succ = document.getElementById('register-success');
    const username = (document.getElementById('reg-username')?.value || '').trim().toLowerCase();
    const pass = document.getElementById('reg-password')?.value || '';
    const confirm = document.getElementById('reg-confirm')?.value || '';
    err.textContent = ''; err.classList.remove('show');
    succ.textContent = ''; succ.classList.remove('show');
    if (!username) { err.textContent = 'Veuillez saisir un identifiant.'; err.classList.add('show'); return; }
    if (!/^[a-z0-9_\-.]+$/.test(username)) { err.textContent = 'Identifiant invalide. Lettres minuscules, chiffres, - ou _ uniquement.'; err.classList.add('show'); return; }
    if (!pass) { err.textContent = 'Veuillez saisir un mot de passe.'; err.classList.add('show'); return; }
    const pwdErr = _validatePassword(pass);
    if (pwdErr) { err.textContent = pwdErr; err.classList.add('show'); return; }
    if (pass !== confirm) { err.textContent = 'Les mots de passe ne correspondent pas.'; err.classList.add('show'); return; }
    btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Création...';
    const result = await matrixManager.register(CONFIG.DEFAULT_HOMESERVER, username, pass);
    btn.disabled = false; btn.innerHTML = '<i class="fas fa-user-plus"></i> Créer mon compte';
    if (result.success) {
        succ.textContent = `Compte créé avec succès ! Connectez-vous maintenant.`;
        succ.classList.add('show');
        document.getElementById('reg-username').value = '';
        document.getElementById('reg-password').value = '';
        document.getElementById('reg-confirm').value = '';
        setTimeout(() => {
            switchLoginMode('login');
            const unField = document.getElementById('username');
            if (unField) unField.value = username;
        }, 2200);
    } else {
        err.textContent = result.error; err.classList.add('show');
    }
}

// ── Réinitialisation mot de passe — Étape 1 ──
async function requestPasswordReset() {
    const btn = document.getElementById('forgot-btn');
    const err = document.getElementById('forgot-error');
    const email = (document.getElementById('forgot-email')?.value || '').trim();
    err.textContent = ''; err.classList.remove('show');
    if (!email) { err.textContent = 'Veuillez saisir votre adresse email.'; err.classList.add('show'); return; }
    btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Envoi...';
    const result = await matrixManager.requestPasswordResetEmail(CONFIG.DEFAULT_HOMESERVER, email);
    btn.disabled = false; btn.innerHTML = '<i class="fas fa-paper-plane"></i> Envoyer le lien';
    if (result.success) {
        _forgotSid = result.sid; _forgotSecret = result.clientSecret;
        switchLoginMode('forgot-step2');
    } else {
        err.textContent = result.error; err.classList.add('show');
    }
}

// ── Réinitialisation mot de passe — Étape 2 ──
async function submitPasswordReset() {
    const btn = document.getElementById('forgot-step2-btn');
    const err = document.getElementById('forgot-step2-error');
    const newPwd = document.getElementById('forgot-new-pwd')?.value || '';
    err.textContent = ''; err.classList.remove('show');
    if (!newPwd) { err.textContent = 'Veuillez saisir un nouveau mot de passe.'; err.classList.add('show'); return; }
    const pwdErr2 = _validatePassword(newPwd);
    if (pwdErr2) { err.textContent = pwdErr2; err.classList.add('show'); return; }
    if (!_forgotSid || !_forgotSecret) { err.textContent = 'Session expirée. Recommencez depuis le début.'; err.classList.add('show'); return; }
    btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Mise à jour...';
    const result = await matrixManager.submitNewPassword(CONFIG.DEFAULT_HOMESERVER, _forgotSid, _forgotSecret, newPwd);
    btn.disabled = false; btn.innerHTML = '<i class="fas fa-check-circle"></i> Définir le nouveau mot de passe';
    if (result.success) {
        _forgotSid = null; _forgotSecret = null;
        err.style.color = '#25D366'; err.textContent = 'Mot de passe mis à jour ! Connectez-vous maintenant.'; err.classList.add('show');
        setTimeout(() => { err.style.color = ''; switchLoginMode('login'); }, 2500);
    } else {
        err.textContent = result.error; err.classList.add('show');
    }
}

function checkSavedCredentials() {
    if (localStorage.getItem('rememberMe') === 'true') {
        const rm = document.getElementById('remember-me'); if (rm) rm.checked = true;
    }
}

document.getElementById('login-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = document.getElementById('login-btn'), err = document.getElementById('login-error');
    if (!btn || !err) return;
    btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Connexion...'; err.textContent = ''; err.classList.remove('show');

    let hs = CONFIG.DEFAULT_HOMESERVER;
    let un = document.getElementById('username')?.value.trim();
    const pw = document.getElementById('password')?.value;
    const rm = document.getElementById('remember-me')?.checked;
    if (!hs.startsWith('http')) hs = 'https://' + hs;

    // Afficher l'écran de chargement avec étapes de progression
    const ls = document.getElementById('login-screen');
    const lds = document.getElementById('loading-screen');
    const loadingSubtitle = lds?.querySelector('.sendt-subtitle');
    if (ls) ls.classList.remove('active');
    if (lds) lds.classList.add('active');

    const steps = ['Connexion au serveur...', 'Authentification...', 'Synchronisation des données...', 'Chargement des conversations...'];
    let stepIdx = 0;
    if (loadingSubtitle) loadingSubtitle.textContent = steps[0];
    const stepTimer = setInterval(() => {
        stepIdx = Math.min(stepIdx + 1, steps.length - 1);
        if (loadingSubtitle) loadingSubtitle.textContent = steps[stepIdx];
    }, 2500);

    try {
        const r = await matrixManager.login(hs, un, pw);
        clearInterval(stepTimer);
        if (r.success) {
            if (rm) { localStorage.setItem('rememberMe', 'true'); }
            else { localStorage.removeItem('rememberMe'); }
            const p = matrixManager.getUserProfile();
            uiController.updateUserProfile(r.userId, p.displayname || un);
            uiController._updateSidebarAvatar();
            if (loadingSubtitle) loadingSubtitle.textContent = 'Bienvenue !';
            setTimeout(async () => {
                if (lds) lds.classList.remove('active');
                document.getElementById('app-screen')?.classList.add('active');
                isLoggedIn = true;
                showToast('Connexion réussie !', 'success');
                uiController.renderCallHistory();
                // E2EE : vérifier la sauvegarde des clés et les demandes de vérification
                _initE2EEAfterLogin();
                // Détection de double connexion (comme Element / WhatsApp)
                setTimeout(() => checkMultipleSessions(), 3000);
                // Vérifier si on revient d'un lien de validation email
                if (sessionStorage.getItem('_pendingEmailConfirm')) {
                    sessionStorage.removeItem('_pendingEmailConfirm');
                    setTimeout(async () => {
                        showSettings();
                        uiController.switchSettingsTab('account');
                        await loadAccountEmail();
                        document.getElementById('account-email-form')?.classList.add('hidden');
                        document.getElementById('account-email-verify')?.classList.remove('hidden');
                        await confirmEmailLink();
                    }, 500);
                }
            }, 300);
        } else {
            if (loadingSubtitle) loadingSubtitle.textContent = 'Communication sécurisée';
            if (lds) lds.classList.remove('active');
            if (ls) ls.classList.add('active');
            err.textContent = r.error || 'Identifiants incorrects';
            err.classList.add('show');
            btn.disabled = false; btn.innerHTML = '<i class="fas fa-sign-in-alt"></i> Se connecter';
        }
    } catch (error) {
        clearInterval(stepTimer);
        if (loadingSubtitle) loadingSubtitle.textContent = 'Communication sécurisée';
        if (lds) lds.classList.remove('active');
        if (ls) ls.classList.add('active');
        err.textContent = 'Erreur serveur'; err.classList.add('show');
        btn.disabled = false; btn.innerHTML = '<i class="fas fa-sign-in-alt"></i> Se connecter';
    }
});

// ═══════════════════════════════════════════════════════
//  NAVIGATION
// ═══════════════════════════════════════════════════════
function showNewContactDialog() { showModal('new-contact-modal'); }
function showSettings() { showModal('settings-modal'); loadDevicesList(); uiController.initSoundSettings(); }
function showProfile() { uiController.showProfileModal(); }

// ── Compte : gestion email lié ──
let _emailLinkSid = null, _emailLinkSecret = null, _emailLinkAddress = null;

async function loadAccountEmail() {
    const currentDiv = document.getElementById('account-email-current');
    const form = document.getElementById('account-email-form');
    const emailVal = document.getElementById('account-email-value');
    if (!currentDiv || !form) return;
    currentDiv.style.display = 'none';
    form.classList.remove('hidden');
    document.getElementById('account-email-verify')?.classList.add('hidden');
    const result = await matrixManager.getLinkedEmails();
    if (result.success && result.emails.length > 0) {
        emailVal.textContent = result.emails[0];
        currentDiv.style.display = 'block';
        form.classList.add('hidden');
    }
}

async function requestEmailLink() {
    const btn = document.getElementById('account-email-btn');
    const err = document.getElementById('account-email-error');
    const succ = document.getElementById('account-email-success');
    const email = (document.getElementById('account-email-input')?.value || '').trim();
    err.textContent = ''; err.classList.remove('show');
    succ.textContent = ''; succ.classList.remove('show');
    if (!email) { err.textContent = 'Veuillez saisir une adresse email.'; err.classList.add('show'); return; }
    btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Envoi...';
    const result = await matrixManager.requestEmailLinkToken(email);
    btn.disabled = false; btn.innerHTML = '<i class="fas fa-paper-plane"></i> Envoyer le lien de validation';
    if (result.success) {
        _emailLinkSid = result.sid;
        _emailLinkSecret = result.clientSecret;
        _emailLinkAddress = email;
        // Stocker uniquement l'adresse (non-sensible) pour pré-remplir en cas de rechargement.
        // Le SID et le clientSecret NE sont PAS stockés : en cas de rechargement de page,
        // l'utilisateur devra renvoyer le lien (flux de 30 secondes).
        sessionStorage.setItem('_emailLinkAddress', email);
        document.getElementById('account-email-form').classList.add('hidden');
        document.getElementById('account-email-verify').classList.remove('hidden');
    } else {
        err.textContent = result.error; err.classList.add('show');
    }
}

async function confirmEmailLink() {
    const btn = document.getElementById('account-email-confirm-btn');
    const errEl = document.getElementById('account-confirm-error');
    if (errEl) { errEl.textContent = ''; errEl.classList.remove('show'); }
    // Les tokens de session (SID, secret) sont en mémoire uniquement — jamais en Storage.
    // Si la page a été rechargée, les variables mémoire sont nulles : on redemande l'envoi.
    if (!_emailLinkAddress) _emailLinkAddress = sessionStorage.getItem('_emailLinkAddress');
    if (!_emailLinkSid || !_emailLinkSecret) {
        showToast('Session expirée. Renvoyez le lien de validation.', 'error');
        cancelEmailLink();
        return;
    }
    const pwd = document.getElementById('account-confirm-pwd')?.value || null;
    btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Confirmation...';
    const result = await matrixManager.addEmailThreepid(_emailLinkSid, _emailLinkSecret, pwd || null);
    btn.disabled = false; btn.innerHTML = '<i class="fas fa-check-circle"></i> Confirmer l\'email';
    if (result.success) {
        _emailLinkSid = null; _emailLinkSecret = null;
        document.getElementById('account-email-verify').classList.add('hidden');
        document.getElementById('account-confirm-pwd-wrapper')?.classList.add('hidden');
        if (document.getElementById('account-confirm-pwd')) document.getElementById('account-confirm-pwd').value = '';
        document.getElementById('account-email-value').textContent = _emailLinkAddress;
        document.getElementById('account-email-current').style.display = 'block';
        document.getElementById('account-email-form').classList.add('hidden');
        showToast('Email associé avec succès !', 'success');
        sessionStorage.removeItem('_emailLinkAddress');
    } else if (result.needsPassword) {
        // Le serveur exige le mot de passe pour valider — afficher le champ
        document.getElementById('account-confirm-pwd-wrapper')?.classList.remove('hidden');
        document.getElementById('account-confirm-pwd')?.focus();
        if (errEl) { errEl.textContent = 'Entrez votre mot de passe pour confirmer.'; errEl.classList.add('show'); }
    } else {
        if (errEl) { errEl.textContent = result.error; errEl.classList.add('show'); }
        showToast(result.error, 'error');
    }
}

function cancelEmailLink() {
    _emailLinkSid = null; _emailLinkSecret = null; _emailLinkAddress = null;
    sessionStorage.removeItem('_emailLinkAddress');
    document.getElementById('account-email-verify')?.classList.add('hidden');
    document.getElementById('account-email-form')?.classList.remove('hidden');
}

async function removeAccountEmail() {
    const emailVal = document.getElementById('account-email-value')?.textContent;
    if (!emailVal) return;
    if (!confirm(`Délier l'adresse ${emailVal} de votre compte ?`)) return;
    const result = await matrixManager.removeEmailThreepid(emailVal);
    if (result.success) {
        document.getElementById('account-email-current').style.display = 'none';
        document.getElementById('account-email-form').classList.remove('hidden');
        document.getElementById('account-email-input').value = '';
        showToast('Email délié.', 'success');
    } else {
        showToast(result.error, 'error');
    }
}

function logout() {
    if (confirm('Voulez-vous vous déconnecter ?')) {
        matrixManager.logout();
        webrtcManager.cleanup();
        isLoggedIn = false;
        // Purger toutes les données de session de l'ancien compte
        uiController.contacts = []; uiController.groups = []; uiController.channels = [];
        uiController.chatMessages = {}; uiController.currentContact = null;
        uiController._readReceipts = {}; uiController._unreadCounts = {};
        const cl = document.getElementById('contacts-list'); if (cl) cl.innerHTML = '';
        const ch = document.getElementById('channels-list'); if (ch) ch.innerHTML = '';
        document.getElementById('group-mgmt-bar')?.remove();
        document.getElementById('contact-view')?.classList.add('hidden');
        document.getElementById('welcome-screen')?.classList.remove('hidden');
        document.getElementById('messages-container') && (document.getElementById('messages-container').innerHTML = '');
        // Réinitialiser l'UI sans recharger la page
        ['app-screen','call-screen','loading-screen'].forEach(id => document.getElementById(id)?.classList.remove('active'));
        const ls = document.getElementById('login-screen'); if (ls) ls.classList.add('active');
        // Toujours vider le champ username à la déconnexion
        const u = document.getElementById('username'); if (u) u.value = '';
        const pw = document.getElementById('password'); if (pw) pw.value = '';
        const err = document.getElementById('login-error'); if (err) { err.textContent = ''; err.classList.remove('show'); }
        const btn = document.getElementById('login-btn'); if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-sign-in-alt"></i> Se connecter'; }
        showToast('Déconnecté', 'info');
    }
}

async function logoutAllDevices() {
    const btn = document.getElementById('logout-all-btn');
    const errEl = document.getElementById('logout-all-error');
    if (errEl) { errEl.textContent = ''; errEl.classList.remove('show'); }
    if (!confirm('Déconnecter TOUS vos appareils ? Vous devrez vous reconnecter partout.')) return;
    btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Déconnexion...';
    const result = await matrixManager.logoutAllDevices();
    if (result.success) {
        closeModal('settings-modal');
        logout();
    } else {
        btn.disabled = false; btn.innerHTML = '<i class="fas fa-sign-out-alt"></i> Déconnecter tous mes appareils';
        if (errEl) { errEl.textContent = result.error; errEl.classList.add('show'); }
        showToast(result.error, 'error');
    }
}

// ── Token d'accès ─────────────────────────────────────────────────────────────
function loadAccessToken() {
    const field = document.getElementById('access-token-field');
    const curlEl = document.getElementById('token-curl-cmd');
    if (!field) return;
    const token = matrixManager?.accessToken;
    if (token) {
        field.value = token;
        field.type = 'password';
        const icon = document.getElementById('token-eye-icon');
        if (icon) icon.className = 'fas fa-eye';
    } else {
        field.value = '';
        field.placeholder = 'Non disponible — connectez-vous d\'abord';
    }
    if (curlEl) {
        const hs = matrixManager?.homeserverUrl || CONFIG?.DEFAULT_HOMESERVER || 'https://matrix.exemple.com';
        const userId = matrixManager?.userId || 'votre_identifiant';
        curlEl.textContent =
            `curl -X POST ${hs}/_matrix/client/v3/login \\\n` +
            `  -H "Content-Type: application/json" \\\n` +
            `  -d '{"type":"m.login.password","user":"${userId}","password":"VOTRE_MOT_DE_PASSE"}'`;
    }
}

function toggleTokenVisibility() {
    const field = document.getElementById('access-token-field');
    const icon  = document.getElementById('token-eye-icon');
    if (!field) return;
    if (field.type === 'password') {
        field.type = 'text';
        if (icon) icon.className = 'fas fa-eye-slash';
    } else {
        field.type = 'password';
        if (icon) icon.className = 'fas fa-eye';
    }
}

async function copyAccessToken() {
    const field = document.getElementById('access-token-field');
    const token = field?.value || matrixManager?.accessToken;
    if (!token) { showToast('Token non disponible', 'error'); return; }
    try {
        await navigator.clipboard.writeText(token);
        showToast('✅ Token copié dans le presse-papier', 'success');
    } catch(e) {
        // Fallback pour les contextes sans clipboard API
        const prev = field.type;
        field.type = 'text';
        field.select();
        document.execCommand('copy');
        field.type = prev;
        showToast('✅ Token copié', 'success');
    }
}

async function copyCurlCommand() {
    const el = document.getElementById('token-curl-cmd');
    if (!el?.textContent) return;
    try {
        await navigator.clipboard.writeText(el.textContent);
        showToast('✅ Commande copiée', 'success');
    } catch(e) {
        showToast('Erreur lors de la copie', 'error');
    }
}
// ─────────────────────────────────────────────────────────────────────────────

function switchTab(tabName) {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelector(`[data-tab="${tabName}"]`)?.classList.add('active');
    document.getElementById('contacts-list')?.classList.toggle('hidden', tabName !== 'contacts');
    document.getElementById('channels-list')?.classList.toggle('hidden', tabName !== 'channels');
    document.getElementById('call-history')?.classList.toggle('hidden', tabName !== 'history');
    document.getElementById('status-list')?.classList.toggle('hidden', tabName !== 'status');
    if (tabName === 'history') uiController.renderCallHistory();
    if (tabName === 'status') uiController.loadStatuses();
    if (tabName === 'channels') uiController.renderChannels();
}

// ═══════════════════════════════════════════════════════
//  APPELS
// ═══════════════════════════════════════════════════════
function startCall(v) { uiController.startCall(v); }
function hangupCall() { uiController.endCall(); }

function acceptCall() {
    if (window._pendingGroupCall) webrtcManager.acceptGroupCall();
    else uiController.acceptIncomingCall();
}

function declineCall() {
    if (window._pendingGroupCall) {
        window._pendingGroupCall = null;
        soundManager?.stopCallRingtone?.();
        const modal = document.getElementById('incoming-call-modal');
        if (modal) { modal.classList.remove('active'); modal.classList.remove('show'); }
    } else {
        uiController.declineIncomingCall();
    }
}

function toggleAudio() {
    const m = webrtcManager.toggleAudio();
    const b = document.getElementById('mute-audio-btn');
    if (b) { b.classList.toggle('active', m); b.querySelector('i').className = m ? 'fas fa-microphone-slash' : 'fas fa-microphone'; }
    showToast(m ? 'Micro coupé' : 'Micro activé', 'info');
}

async function toggleCamera() {
    const btn = document.getElementById('toggle-camera-btn');
    if (btn) btn.disabled = true;
    const r = await webrtcManager.toggleCamera();
    if (btn) {
        btn.disabled = false;
        btn.classList.toggle('active', !r.enabled);
        btn.querySelector('i').className = r.enabled ? 'fas fa-video' : 'fas fa-video-slash';
    }
    if (!r.error) showToast(r.enabled ? 'Caméra activée' : 'Caméra désactivée', 'info');
}

function toggleFullscreen() {
    if (!document.fullscreenElement) document.documentElement.requestFullscreen().catch(() => {});
    else document.exitFullscreen();
}

function toggleScreenShare() {
    webrtcManager.toggleScreenShare().then(s => {
        const b = document.getElementById('share-screen-btn');
        if (b) { b.classList.toggle('active', s); b.querySelector('i').className = s ? 'fas fa-stop-circle' : 'fas fa-desktop'; }
    });
}

function toggleInCallChat() { uiController.toggleInCallChat(); }
function openChat() {
    const p = document.getElementById('chat-panel');
    if (p) { p.classList.toggle('show'); if (p.classList.contains('show')) document.getElementById('chat-input')?.focus(); }
}
function closeChat() { document.getElementById('chat-panel')?.classList.remove('show'); }
function closeImageViewer() { uiController.closeImageViewer(); }

// ✅ FIX : toggleEphemeralMenu global
function toggleEphemeralMenu() {
    const menu = document.getElementById('ephemeral-menu');
    if (menu) menu.classList.toggle('show');
}

// ═══════════════════════════════════════════════════════
//  STATUTS
// ═══════════════════════════════════════════════════════
function showStatusComposer() { uiController.showStatusComposer(); }
function closeStatusComposer() { uiController.closeStatusComposer(); }
function postTextStatus() { uiController.postTextStatus(); }
function postImageStatus() { uiController.postImageStatus(); }

// ═══════════════════════════════════════════════════════
//  GROUPES / SALONS
// ═══════════════════════════════════════════════════════
function showCreateGroupDialog() { showModal('create-group-modal'); }

function showCreateChannelDialog() {
    const nameInput = document.getElementById('channel-name');
    const descInput = document.getElementById('channel-description');
    const pubCheck  = document.getElementById('channel-public');
    if (nameInput) nameInput.value = '';
    if (descInput) descInput.value = '';
    if (pubCheck)  pubCheck.checked = false;
    showModal('create-channel-modal');
}

function showLocationPicker() { uiController.showLocationPicker(); }
function explorePublicChannels() { uiController.explorePublicChannels(); }

// ═══════════════════════════════════════════════════════
//  INVITATIONS — ✅ NOUVEAU : workflow Matrix complet
// ═══════════════════════════════════════════════════════

/**
 * ✅ Accepter une invitation à rejoindre un groupe/salon
 * Appelé depuis la modal des notifications ou la bannière d'invitation
 */
async function acceptInvitation(roomId) {
    const btn = document.querySelector(`[data-accept-invite="${roomId}"]`);
    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>'; }
    const ok = await matrixManager.acceptInvitation(roomId);
    if (ok) {
        showToast('✅ Vous avez rejoint le groupe !', 'success');
        // Fermer la modal d'invitation si elle est ouverte
        closeModal('invitation-modal-' + roomId);
        // Mettre à jour les notifications
        uiController.renderNotifications();
    }
    if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-check"></i> Rejoindre'; }
}

/**
 * ✅ Refuser une invitation
 */
async function declineInvitation(roomId) {
    const btn = document.querySelector(`[data-decline-invite="${roomId}"]`);
    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>'; }
    const ok = await matrixManager.declineInvitation(roomId);
    if (ok) {
        closeModal('invitation-modal-' + roomId);
        uiController.renderNotifications();
    }
    if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-times"></i> Refuser'; }
}

// ═══════════════════════════════════════════════════════
//  QUICK CALLS
// ═══════════════════════════════════════════════════════
function quickCall(userId, withVideo) {
    if (typeof uiController === 'undefined') return;
    const contact = uiController.contacts?.find(c => c.userId === userId);
    if (!contact) return;
    uiController.currentContact = {
        roomId: contact.roomId, displayName: contact.displayName,
        userId: contact.userId, isGroup: false, isChannel: false
    };
    const nameEl = document.getElementById('call-contact-name');
    if (nameEl) nameEl.textContent = contact.displayName;
    const st = document.getElementById('call-status');
    if (st) st.textContent = withVideo ? 'Appel vidéo...' : 'Appel audio...';
    document.getElementById('app-screen')?.classList.remove('active');
    const cs = document.getElementById('call-screen');
    if (cs) {
        cs.classList.add('active');
        cs.classList.toggle('video-call', withVideo);
        cs.classList.toggle('audio-call', !withVideo);
    }
    webrtcManager.startCall(contact.roomId, withVideo);
}

function quickGroupCall(roomId, withVideo) {
    if (typeof uiController === 'undefined') return;
    const group = uiController.groups?.find(g => g.roomId === roomId);
    if (!group) return;
    uiController.currentContact = {
        roomId: group.roomId, displayName: group.displayName,
        isGroup: true, memberCount: group.memberCount || 0
    };
    const nameEl = document.getElementById('call-contact-name');
    if (nameEl) nameEl.textContent = group.displayName;
    const st = document.getElementById('call-status');
    if (st) st.textContent = withVideo ? 'Appel vidéo groupe...' : 'Appel audio groupe...';
    document.getElementById('app-screen')?.classList.remove('active');
    const cs = document.getElementById('call-screen');
    if (cs) {
        cs.classList.add('active');
        cs.classList.toggle('video-call', withVideo);
        cs.classList.toggle('audio-call', !withVideo);
    }
    webrtcManager.startGroupCall(group.roomId, withVideo);
}

// ═══════════════════════════════════════════════════════
//  DEVICES
// ═══════════════════════════════════════════════════════
async function loadDevicesList() {
    try {
        const d = await navigator.mediaDevices.enumerateDevices();
        populateSelect('camera-select', d.filter(d => d.kind === 'videoinput'));
        populateSelect('microphone-select', d.filter(d => d.kind === 'audioinput'));
        populateSelect('speaker-select', d.filter(d => d.kind === 'audiooutput'));
    } catch (e) {}
}

function populateSelect(id, devices) {
    const s = document.getElementById(id); if (!s) return;
    s.innerHTML = devices.length
        ? devices.map(d => `<option value="${d.deviceId}">${d.label || 'Périphérique ' + d.deviceId.substring(0, 8)}</option>`).join('')
        : '<option>Aucun</option>';
}

async function testDevices() {
    showToast('Test...', 'info');
    try {
        const s = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        showToast('✅ Caméra et micro OK !', 'success');
        s.getTracks().forEach(t => t.stop());
    } catch (e) { showToast('Erreur: ' + e.message, 'error'); }
}

// ═══════════════════════════════════════════════════════
//  ERREURS GLOBALES
// ═══════════════════════════════════════════════════════
window.addEventListener('error', e => console.error('🚨', e.error));
window.addEventListener('unhandledrejection', e => {
    // ✅ Ignorer les erreurs 404 de joinRoom (rooms obsolètes)
    if (e.reason?.message?.includes('404') || e.reason?.errcode === 'M_NOT_FOUND') {
        console.warn('[Matrix] Room introuvable (ignoré):', e.reason?.message);
        e.preventDefault();
        return;
    }
    console.error('🚨 Unhandled promise rejection:', e.reason);
    showToast('Erreur inattendue: ' + (e.reason?.message || 'Inconnu'), 'error');
});

// ═══════════════════════════════════════════════════════
//  LANDING PAGE — utilitaires
// ═══════════════════════════════════════════════════════

function backToLanding() {
    ['login-screen','app-screen','loading-screen','call-screen'].forEach(id => {
        document.getElementById(id)?.classList.remove('active');
    });
    document.getElementById('landing-screen')?.classList.add('active');
}

// Compteur animé pour les stats
function _lpAnimateCounter(el) {
    const target = parseInt(el.dataset.target, 10); if (!target) return;
    const suffix = el.dataset.suffix || ''; const duration = 1600;
    const start = performance.now();
    function step(now) {
        const pct = Math.min((now - start) / duration, 1);
        const ease = 1 - Math.pow(1 - pct, 3);
        el.textContent = Math.floor(ease * target) + suffix;
        if (pct < 1) requestAnimationFrame(step);
        else el.textContent = target + suffix;
    }
    requestAnimationFrame(step);
}

// Scroll reveal + compteurs déclenchés à l'entrée dans le viewport
(function() {
    const obs = new IntersectionObserver((entries) => {
        entries.forEach(e => {
            if (!e.isIntersecting) return;
            // Stagger : délai basé sur la position dans le conteneur parent
            const parent = e.target.parentElement;
            if (parent) {
                const siblings = Array.from(parent.children).filter(c => c.classList.contains('lp-reveal'));
                const idx = siblings.indexOf(e.target);
                if (idx > 0) e.target.style.transitionDelay = `${Math.min(idx * 0.09, 0.65)}s`;
            }
            e.target.classList.add('visible');
            obs.unobserve(e.target);
        });
    }, { threshold: 0.08 });
    const statsObs = new IntersectionObserver((entries) => {
        entries.forEach(e => {
            if (!e.isIntersecting) return;
            e.target.querySelectorAll('[data-target]').forEach(_lpAnimateCounter);
            statsObs.unobserve(e.target);
        });
    }, { threshold: 0.5 });
    function initLandingObservers() {
        document.querySelectorAll('.lp-reveal').forEach(el => obs.observe(el));
        const stats = document.getElementById('lp-stats'); if (stats) statsObs.observe(stats);
        _lpInitParticles();
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initLandingObservers);
    else initLandingObservers();
})();

// Particules flottantes dans le hero
function _lpInitParticles() {
    const container = document.getElementById('lp-particles'); if (!container) return;
    const colors = ['rgba(0,133,63,.7)','rgba(253,239,66,.4)','rgba(227,27,35,.3)'];
    for (let i = 0; i < 22; i++) {
        const p = document.createElement('div'); p.className = 'lp-particle';
        const size = Math.random() * 3 + 1.5;
        p.style.cssText = `left:${Math.random()*100}%;width:${size}px;height:${size}px;`
            + `background:${colors[Math.floor(Math.random()*colors.length)]};`
            + `animation-duration:${8 + Math.random()*10}s;`
            + `animation-delay:${Math.random()*8}s;`
            + `--drift:${(Math.random()-0.5)*120}px`;
        container.appendChild(p);
    }
}

// ═══════════════════════════════════════════════════════
//  ANIMATION MOCKUP CHAT (landing page)
// ═══════════════════════════════════════════════════════
function _lpInitMockupChat() {
    const chat = document.getElementById('lp-mockup-chat');
    const inputBox = document.getElementById('lp-mockup-input');
    if (!chat || !inputBox) return;

    const sequence = [
        { sender: 'alain', color: '#53bdeb', alt: true,  text: 'Merci quand même pour ta gentillesse', time: '20:27' },
        { sender: 'babadi', color: '#25D366', alt: false, text: 'De rien, Alain. N\'hésite pas si tu as d\'autres questions sur les réseaux !', time: '20:27' },
        { sender: 'alain', color: '#53bdeb', alt: true,  text: 'Comme mysql fait partie de services réseaux, tu peux te renseigner pour m\'aider ?', time: '20:26' },
        { sender: 'babadi', color: '#25D366', alt: false, text: 'Bien que MySQL soit souvent utilisé avec les réseaux, cela ne fait pas partie de mes compétences principales.', time: '20:26' },
    ];

    let idx = 0;
    let typingEl = null;
    let inputTimer = null;

    function removeTyping() {
        if (typingEl) { typingEl.remove(); typingEl = null; }
    }

    function showTyping(senderName, color) {
        removeTyping();
        typingEl = document.createElement('div');
        typingEl.style.cssText = 'display:flex;align-items:center;gap:4px;padding:4px 8px;background:#1F2C34;border-radius:0 8px 8px 8px;align-self:flex-start;';
        typingEl.innerHTML = `<span style="font-size:.48rem;font-weight:700;color:${color}">${senderName}</span>`
            + `<div style="display:flex;gap:3px;align-items:center;">`
            + `<div class="lp-typing-dot"></div><div class="lp-typing-dot"></div><div class="lp-typing-dot"></div>`
            + `</div>`;
        chat.appendChild(typingEl);
        chat.scrollTop = chat.scrollHeight;
    }

    function addMessage(msg) {
        removeTyping();
        const el = document.createElement('div');
        el.className = `lp-ap-msg lp-ap-recv lp-msg-appear${msg.alt ? ' lp-recv-alt' : ''}`;
        el.innerHTML = `<span class="lp-msg-sender" style="color:${msg.color}">${msg.sender}</span>`
            + `<div>${msg.text}</div>`
            + `<div class="lp-msg-meta">${msg.time} ✓✓</div>`;
        chat.appendChild(el);
        chat.scrollTop = chat.scrollHeight;
    }

    function typeInInput(text, onDone) {
        clearInterval(inputTimer);
        inputBox.style.color = '#E9EDEF';
        let i = 0;
        inputTimer = setInterval(() => {
            inputBox.textContent = text.substring(0, i);
            i++;
            if (i > text.length) {
                clearInterval(inputTimer);
                onDone();
            }
        }, 32);
    }

    function resetInput() {
        clearInterval(inputTimer);
        inputBox.textContent = 'Écrire un message...';
        inputBox.style.color = '';
    }

    function runNext() {
        if (idx >= sequence.length) {
            // Réinitialiser : retirer les messages ajoutés et recommencer
            idx = 0;
            chat.querySelectorAll('.lp-ap-msg:not(.lp-ap-msg-init)').forEach(m => m.remove());
            removeTyping(); resetInput();
            setTimeout(runNext, 4000);
            return;
        }
        const msg = sequence[idx];
        if (msg.alt) {
            // Message d'un utilisateur : simuler la frappe dans la zone de saisie
            typeInInput(msg.text, () => {
                setTimeout(() => {
                    resetInput();
                    addMessage(msg);
                    idx++;
                    setTimeout(runNext, 2200);
                }, 400);
            });
        } else {
            // Message du bot : indicateur de frappe puis message
            showTyping(msg.sender, msg.color);
            setTimeout(() => {
                addMessage(msg);
                idx++;
                setTimeout(runNext, 2500);
            }, 1800);
        }
    }

    // Démarrer après 2.5s
    setTimeout(runNext, 2500);
}

// Lancer l'animation mockup quand la landing est visible
(function() {
    function tryInit() {
        const mockup = document.getElementById('lp-mockup-chat');
        if (mockup) { _lpInitMockupChat(); return; }
        setTimeout(tryInit, 300);
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', tryInit);
    else tryInit();
})();

// ═══════════════════════════════════════════════════════════════════════
//  E2EE — Chiffrement de bout en bout (comme Element)
// ═══════════════════════════════════════════════════════════════════════

// Initialisation post-login : vérifie le backup et écoute les vérifications entrantes
async function _initE2EEAfterLogin() {
    if (!matrixManager.cryptoEnabled) return;
    // Écouter les demandes de vérification entrantes
    window.addEventListener('e2ee-verification-request', (e) => {
        _handleIncomingVerificationRequest(e.detail.request);
    }, { once: false });
    // Mettre à jour le cadenas quand un salon est chiffré (changement d'état en temps réel)
    window.addEventListener('room-encryption-changed', _updateE2EELockIcon);
    // Mettre à jour le cadenas dans le header selon la conv courante
    window.addEventListener('contact-selected', _updateE2EELockIcon);
    // Décryptage tardif : mettre à jour les messages affichés en erreur quand les clés arrivent
    window.addEventListener('message-decrypted-late', (e) => {
        const { roomId, eventId, message } = e.detail;
        if (!uiController?.chatMessages?.[roomId]) return;
        const idx = uiController.chatMessages[roomId].findIndex(m => m.eventId === eventId);
        if (idx === -1 || !uiController.chatMessages[roomId][idx].decryptError) return;
        uiController.chatMessages[roomId][idx] = message;
        if (uiController.currentContact?.roomId === roomId) uiController.renderMessages(roomId);
    });

    // Détection nouvel appareil : si une sauvegarde existe et que cet appareil n'a pas encore restauré
    setTimeout(async () => {
        const userId = matrixManager.userId;
        const deviceId = matrixManager.client?.getDeviceId?.();
        const restoredFlag = `sendt_backup_restored_${userId}_${deviceId}`;
        const backupInfo = await matrixManager.getKeyBackupInfo();
        if (backupInfo && !localStorage.getItem(restoredFlag)) {
            // Nouvel appareil avec sauvegarde sur le serveur → proposer la restauration des clés
            setTimeout(() => _showNewDeviceRestorePrompt(), 1800);
        } else if (!backupInfo) {
            // Aucune sauvegarde configurée — suggestion discrète
            setTimeout(() => showToast('💡 Configurez la sauvegarde E2EE dans Paramètres › Sécurité', 'info'), 5000);
        } else {
            // Sauvegarde déjà restaurée sur cet appareil — activer silencieusement
            await matrixManager.enableExistingKeyBackup();
        }
        // Appliquer le réglage auto-chiffrement DM depuis les préférences
        // NE PAS écraser le défaut true si l'utilisateur n'a jamais touché le toggle
        const savedAutoEncrypt = localStorage.getItem('sendt_auto_encrypt_dms');
        if (savedAutoEncrypt !== null && typeof CONFIG !== 'undefined' && CONFIG.E2EE) {
            CONFIG.E2EE.autoEncryptDMs = savedAutoEncrypt === 'true';
        }
    }, 4000);
}

// Affiche le modal de restauration au premier login sur un nouvel appareil (comme Element)
function _showNewDeviceRestorePrompt() {
    const el = document.getElementById('new-device-restore-passphrase');
    if (el) el.value = '';
    const errEl = document.getElementById('new-device-restore-error');
    if (errEl) errEl.textContent = '';
    showModal('new-device-restore-modal');
    setTimeout(() => el?.focus(), 200);
}

async function confirmNewDeviceRestore() {
    const passphrase = document.getElementById('new-device-restore-passphrase')?.value || '';
    const errEl = document.getElementById('new-device-restore-error');
    const btn = document.getElementById('new-device-restore-btn');
    if (errEl) { errEl.textContent = ''; errEl.classList.remove('show'); }
    if (!passphrase) {
        if (errEl) { errEl.textContent = 'Entrez votre phrase secrète de sauvegarde.'; errEl.classList.add('show'); }
        return;
    }
    if (!btn) return;
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Dérivation de clé... (10-30s)';
    try {
        const backupInfo = await matrixManager.getKeyBackupInfo();
        if (!backupInfo) {
            // Aucune sauvegarde sur le serveur — activer pour le futur et fermer
            const userId = matrixManager.userId;
            const deviceId = matrixManager.client?.getDeviceId?.();
            localStorage.setItem(`sendt_backup_restored_${userId}_${deviceId}`, 'skipped');
            closeModal('new-device-restore-modal');
            showToast('ℹ️ Aucune sauvegarde trouvée — configurez-en une dans Paramètres › Sécurité', 'info');
            return;
        }
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Restauration des clés...';
        const result = await matrixManager.restoreKeyBackupWithPassphrase(passphrase);
        const userId = matrixManager.userId;
        const deviceId = matrixManager.client?.getDeviceId?.();
        localStorage.setItem(`sendt_backup_restored_${userId}_${deviceId}`, '1');
        await matrixManager.enableExistingKeyBackup();
        closeModal('new-device-restore-modal');
        showToast(result.imported
            ? `✅ ${result.imported} clé(s) restaurée(s) — vos anciens messages sont déchiffrables`
            : 'ℹ️ Sauvegarde active — vos prochains messages seront sauvegardés automatiquement', 'success');
    } catch(e) {
        const m = e.message || '';
        let msg;
        if (/404|No room_keys|not found/i.test(m)) {
            const userId = matrixManager.userId;
            const deviceId = matrixManager.client?.getDeviceId?.();
            localStorage.setItem(`sendt_backup_restored_${userId}_${deviceId}`, '1');
            matrixManager.enableExistingKeyBackup().catch(() => {});
            closeModal('new-device-restore-modal');
            showToast('ℹ️ Sauvegarde vide — vos prochains messages seront sauvegardés automatiquement', 'info');
            return;
        } else if (/passphrase|password|decrypt|invalid|bad|mac|digest|Unknown message|unknown/i.test(m)) {
            msg = 'Phrase secrète incorrecte. Vérifiez votre mot de passe de sauvegarde et réessayez.';
        } else {
            msg = 'Erreur : ' + m;
        }
        if (errEl) { errEl.textContent = msg; errEl.classList.add('show'); }
    } finally {
        if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-cloud-download-alt"></i> Restaurer mes messages'; }
    }
}

function skipNewDeviceRestore() {
    const userId = matrixManager.userId;
    const deviceId = matrixManager.client?.getDeviceId?.();
    // Marquer comme "ignoré" pour ne pas reproposer à chaque login sur cet appareil
    localStorage.setItem(`sendt_backup_restored_${userId}_${deviceId}`, 'skipped');
    closeModal('new-device-restore-modal');
}

// Met à jour le cadenas dans l'en-tête de conversation
function _updateE2EELockIcon() {
    const lockClosed = document.getElementById('chat-e2ee-lock');
    const lockOpen   = document.getElementById('chat-e2ee-lock-open');
    if (!lockClosed) return;
    if (!matrixManager.cryptoEnabled) {
        lockClosed.style.display = 'none';
        if (lockOpen) lockOpen.style.display = 'none';
        return;
    }
    const roomId = uiController?.currentContact?.roomId;
    if (!roomId) {
        lockClosed.style.display = 'none';
        if (lockOpen) lockOpen.style.display = 'none';
        return;
    }
    const encrypted = matrixManager.isRoomEncrypted(roomId);
    // Cadenas vert fermé = conversation chiffrée
    lockClosed.style.display = encrypted ? 'inline' : 'none';
    // Cadenas jaune ouvert = conversation non chiffrée (inviter à activer)
    if (lockOpen) lockOpen.style.display = (!encrypted && !uiController?.currentContact?.isGroup && !uiController?.currentContact?.isChannel) ? 'inline' : 'none';
}

// Activer/désactiver le chiffrement sur la conversation courante (depuis l'UI)
async function toggleRoomEncryption() {
    const roomId = uiController?.currentContact?.roomId;
    if (!roomId) return;
    if (matrixManager.isRoomEncrypted(roomId)) {
        showToast('Le chiffrement ne peut pas être désactivé une fois activé.', 'info');
        return;
    }
    if (!confirm('Activer le chiffrement de bout en bout pour cette conversation ?\n\nCette action est irréversible.')) return;
    try {
        await matrixManager.enableRoomEncryption(roomId);
        showToast('✅ Chiffrement activé pour cette conversation', 'success');
        _updateE2EELockIcon();
    } catch(e) {
        const msg = e.message || '';
        if (/403|Forbidden|not allowed|permission/i.test(msg)) {
            showToast('Droits insuffisants — seul un administrateur du salon peut activer le chiffrement.', 'error');
        } else {
            showToast('Erreur : ' + msg, 'error');
        }
    }
}

// ── Onglet Sécurité : chargement des données ────────────────────────────────

async function loadSecuritySettings() {
    const statusBadge = document.getElementById('e2ee-global-status');
    const deviceIdEl  = document.getElementById('e2ee-device-id');
    const fingerprintEl = document.getElementById('e2ee-device-fingerprint');
    const backupInfoEl = document.getElementById('e2ee-backup-info');
    const autoEncryptToggle = document.getElementById('auto-encrypt-dms');

    if (!matrixManager.cryptoEnabled) {
        if (statusBadge) { statusBadge.className = 'e2ee-status-badge inactive'; statusBadge.innerHTML = '<i class="fas fa-times-circle"></i> E2EE non disponible'; }
        if (deviceIdEl) deviceIdEl.textContent = '—';
        if (fingerprintEl) fingerprintEl.textContent = '—';
        if (backupInfoEl) backupInfoEl.textContent = 'Le chiffrement E2EE n\'est pas initialisé. Rechargez la page après connexion.';
        return;
    }

    // Statut global
    if (statusBadge) { statusBadge.className = 'e2ee-status-badge active'; statusBadge.innerHTML = '<i class="fas fa-lock"></i> Chiffrement E2EE actif'; }
    // Info cadenas — visible seulement quand E2EE est actif
    const padlockInfo = document.getElementById('e2ee-padlock-info');
    if (padlockInfo) padlockInfo.style.display = 'block';

    // Infos appareil
    const info = matrixManager.getMyDeviceInfo();
    if (info) {
        if (deviceIdEl) deviceIdEl.textContent = info.deviceId || '—';
        if (fingerprintEl) fingerprintEl.textContent = info.fingerprint || '—';
    }

    // Backup
    if (backupInfoEl) {
        backupInfoEl.textContent = 'Vérification...';
        const backupInfo = await matrixManager.getKeyBackupInfo();
        if (backupInfo) {
            backupInfoEl.innerHTML = '<span style="color:#25D366"><i class="fas fa-check-circle"></i> Sauvegarde active</span> — version ' + backupInfo.version;
        } else {
            backupInfoEl.innerHTML = '<span style="color:#FDEF42"><i class="fas fa-exclamation-triangle"></i> Aucune sauvegarde configurée</span>';
        }
    }

    // Toggle auto-chiffrement DM
    if (autoEncryptToggle) {
        autoEncryptToggle.checked = localStorage.getItem('sendt_auto_encrypt_dms') === 'true';
    }
}

function toggleAutoEncryptDMs(enabled) {
    localStorage.setItem('sendt_auto_encrypt_dms', enabled ? 'true' : 'false');
    if (typeof CONFIG !== 'undefined' && CONFIG.E2EE) CONFIG.E2EE.autoEncryptDMs = enabled;
    showToast(enabled ? 'Auto-chiffrement DM activé' : 'Auto-chiffrement DM désactivé', 'info');
}

// ── Sauvegarde des clés ─────────────────────────────────────────────────────

function showKeyBackupSetup() {
    document.getElementById('e2ee-backup-mode-setup').classList.remove('hidden');
    document.getElementById('e2ee-backup-mode-restore').classList.add('hidden');
    document.getElementById('e2ee-backup-modal-title').innerHTML = '<i class="fas fa-cloud-upload-alt"></i> Configurer la sauvegarde';
    const err = document.getElementById('e2ee-backup-error');
    if (err) { err.textContent = ''; err.classList.remove('show'); }
    showModal('e2ee-backup-modal');
}

function showKeyBackupRestore() {
    document.getElementById('e2ee-backup-mode-setup').classList.add('hidden');
    document.getElementById('e2ee-backup-mode-restore').classList.remove('hidden');
    document.getElementById('e2ee-backup-modal-title').innerHTML = '<i class="fas fa-cloud-download-alt"></i> Restaurer les clés';
    const err = document.getElementById('e2ee-restore-error');
    if (err) { err.textContent = ''; err.classList.remove('show'); }
    showModal('e2ee-backup-modal');
}

async function confirmSetupKeyBackup() {
    const btn = document.getElementById('e2ee-setup-backup-btn');
    const errEl = document.getElementById('e2ee-backup-error');
    const pass1 = document.getElementById('e2ee-backup-passphrase')?.value || '';
    const pass2 = document.getElementById('e2ee-backup-passphrase2')?.value || '';
    if (errEl) { errEl.textContent = ''; errEl.classList.remove('show'); }
    if (!pass1 || pass1.length < 8) { if (errEl) { errEl.textContent = 'Mot de passe trop court (min 8 caractères).'; errEl.classList.add('show'); } return; }
    if (pass1 !== pass2) { if (errEl) { errEl.textContent = 'Les mots de passe ne correspondent pas.'; errEl.classList.add('show'); } return; }
    btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Création...';
    try {
        await matrixManager.setupKeyBackup(pass1);
        closeModal('e2ee-backup-modal');
        showToast('✅ Sauvegarde des clés configurée !', 'success');
        document.getElementById('e2ee-backup-passphrase').value = '';
        document.getElementById('e2ee-backup-passphrase2').value = '';
        await loadSecuritySettings();
    } catch(e) {
        if (errEl) { errEl.textContent = 'Erreur : ' + (e.message || 'Impossible de créer la sauvegarde'); errEl.classList.add('show'); }
    } finally {
        btn.disabled = false; btn.innerHTML = '<i class="fas fa-cloud-upload-alt"></i> Créer la sauvegarde';
    }
}

async function confirmRestoreKeyBackup() {
    const btn = document.getElementById('e2ee-restore-backup-btn');
    const errEl = document.getElementById('e2ee-restore-error');
    const passphrase = document.getElementById('e2ee-restore-passphrase')?.value || '';
    if (errEl) { errEl.textContent = ''; errEl.classList.remove('show'); }
    if (!passphrase) { if (errEl) { errEl.textContent = 'Veuillez saisir votre mot de passe de sauvegarde.'; errEl.classList.add('show'); } return; }
    btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Restauration...';
    try {
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Dérivation de clé... (10-30s)';
        const result = await matrixManager.restoreKeyBackupWithPassphrase(passphrase);
        closeModal('e2ee-backup-modal');
        document.getElementById('e2ee-restore-passphrase').value = '';
        if (!result.imported) {
            showToast('ℹ️ Sauvegarde active — les clés locales ont été envoyées vers le serveur pour vos prochains appareils.', 'info');
        } else {
            showToast(`✅ ${result.imported} clé(s) restaurée(s). Les messages chiffrés se déchiffrent progressivement…`, 'success');
            // Recharger la conversation courante pour afficher les messages déchiffrés
            if (uiController?.currentContact?.roomId) {
                setTimeout(() => uiController.loadChatHistory(uiController.currentContact), 2000);
            }
        }
    } catch(e) {
        const m = e.message || '';
        let msg;
        if (/404|No room_keys|not found/i.test(m)) {
            // Backup vide — aucune clé encore sauvegardée
            closeModal('e2ee-backup-modal');
            showToast('ℹ️ Sauvegarde vide — vos clés seront sauvegardées automatiquement dès maintenant', 'info');
            await matrixManager.enableExistingKeyBackup();
            return;
        } else if (/passphrase|password|decrypt|invalid|bad|Unknown message|unknown/i.test(m)) {
            msg = 'Phrase secrète incorrecte. Vérifiez votre mot de passe de sauvegarde et réessayez.';
        } else if (/aucune|not found|404/i.test(m)) {
            msg = 'Aucune sauvegarde trouvée sur le serveur.';
        } else {
            msg = 'Erreur : ' + m;
        }
        if (errEl) { errEl.textContent = msg; errEl.classList.add('show'); }
    } finally {
        btn.disabled = false; btn.innerHTML = '<i class="fas fa-cloud-download-alt"></i> Restaurer les clés';
    }
}

// ── Export / Import des clés de session ─────────────────────────────────────

async function exportSessionKeys() {
    if (!matrixManager.cryptoEnabled) { showToast('Chiffrement non disponible', 'error'); return; }
    try {
        const json = await matrixManager.exportRoomKeysAsJSON();
        const blob = new Blob([json], { type: 'application/json' });
        const url  = URL.createObjectURL(blob);
        const a    = document.createElement('a');
        a.href = url; a.download = `sendt-e2ee-keys-${new Date().toISOString().slice(0,10)}.json`;
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
        URL.revokeObjectURL(url);
        showToast('Clés exportées', 'success');
    } catch(e) { showToast('Erreur export : ' + e.message, 'error'); }
}

function triggerImportKeys() {
    document.getElementById('import-keys-file')?.click();
}

async function importSessionKeys() {
    const fileInput = document.getElementById('import-keys-file');
    const file = fileInput?.files?.[0];
    if (!file) return;
    try {
        const text = await file.text();
        const result = await matrixManager.importRoomKeysFromJSON(text);
        showToast(`✅ ${result.count} clé(s) importée(s)`, 'success');
    } catch(e) {
        showToast('Erreur import : ' + (e.message || 'Format invalide'), 'error');
    } finally {
        if (fileInput) fileInput.value = '';
    }
}

// ── Vérification SAS (emojis) ────────────────────────────────────────────────

let _activeVerification = null;
let _activeSASVerifier  = null;  // l'objet SAS verifier
let _activeSASEvent     = null;  // le sasEvent avec confirm/cancel/mismatch

function _handleIncomingVerificationRequest(request) {
    // Ignorer les requêtes déjà annulées ou terminées
    if (request.cancelled || request.done) return;
    _activeVerification = request;

    const requesterId = request.otherUserId || request.requestingUserId || '';
    const displayName = requesterId ? (matrixManager.client?.getUser(requesterId)?.displayName || requesterId) : 'Appareil inconnu';

    document.getElementById('e2ee-verify-title').innerHTML = '<i class="fas fa-shield-alt"></i> Demande de vérification';
    // Afficher l'identité du demandeur dans le modal
    const acceptStep = document.getElementById('e2ee-verify-step-accept');
    let infoEl = acceptStep?.querySelector('.verify-from-info');
    if (!infoEl && acceptStep) {
        infoEl = document.createElement('p');
        infoEl.className = 'verify-from-info';
        infoEl.style.cssText = 'margin:8px 0;color:#ccc;font-size:0.9em;';
        acceptStep.insertBefore(infoEl, acceptStep.firstChild);
    }
    if (infoEl) infoEl.textContent = `De : ${displayName}`;

    acceptStep?.classList.remove('hidden');
    document.getElementById('e2ee-verify-step-compare').classList.add('hidden');
    document.getElementById('e2ee-verify-step-waiting').classList.add('hidden');
    showModal('e2ee-verify-modal');
    showToast(`Demande de vérification de ${displayName}`, 'info');

    // Si la requête est annulée par l'autre côté, fermer le modal
    request.on('change', () => {
        if (request.cancelled && _activeVerification === request) {
            closeModal('e2ee-verify-modal');
            showToast('Vérification annulée par l\'autre appareil', 'warning');
            _activeVerification = null; _activeSASVerifier = null;
        }
    });
}

async function acceptVerificationRequest() {
    if (!_activeVerification) return;
    const req = _activeVerification;
    document.getElementById('e2ee-verify-step-accept').classList.add('hidden');
    document.getElementById('e2ee-verify-step-waiting').classList.remove('hidden');
    try {
        // accept() envoie m.key.verification.ready (requis pour les requêtes in-room)
        await req.accept();
        console.log('[Verify] READY envoyé, phase:', req.phase);

        // Attendre que le requêteur envoie START (phase = Started = 4)
        // OU envoyer START nous-mêmes si la phase est déjà READY
        await _waitForVerificationStarted(req);

        // Récupérer le verifier (créé par l'événement START entrant, ou par beginKeyVerification)
        let verifier = req.verifier;
        if (!verifier) {
            verifier = req.beginKeyVerification('m.sas.v1');
        }
        _activeSASVerifier = verifier;
        verifier.on('show_sas', _showSASEmojis);
        await verifier.verify();
    } catch(e) {
        console.error('[Verify] Erreur acceptation:', e);
        if (e.message !== 'cancelled') {
            showToast('Erreur de vérification : ' + e.message, 'error');
        }
        closeModal('e2ee-verify-modal');
        _activeVerification = null; _activeSASVerifier = null;
    }
}

async function startVerificationWithUser(userId, roomId) {
    if (!matrixManager.cryptoEnabled) { showToast('Le chiffrement E2EE n\'est pas activé', 'error'); return; }
    document.getElementById('e2ee-verify-title').innerHTML = '<i class="fas fa-shield-alt"></i> Vérifier l\'identité';
    document.getElementById('e2ee-verify-step-accept').classList.add('hidden');
    document.getElementById('e2ee-verify-step-compare').classList.add('hidden');
    document.getElementById('e2ee-verify-step-waiting').classList.remove('hidden');
    showModal('e2ee-verify-modal');
    try {
        const dmRoomId = roomId || await matrixManager.getOrCreateRoomForUser(userId);
        console.log('[Verify] Envoi demande in-room vers', userId, '— room:', dmRoomId);
        const request = await matrixManager.requestSASVerificationInDM(userId, dmRoomId);
        _activeVerification = request;
        const txnId = request.transactionId;
        console.log('[Verify] Demande envoyée, phase:', request.phase, '— txnId:', txnId);

        // Attendre READY via Room.timeline (request.on('change') ne se déclenche pas dans ce SDK)
        const client = matrixManager.getClient();
        await _waitForVerificationEventInRoom(client, txnId, 'm.key.verification.ready');
        console.log('[Verify] READY reçu — attente traitement SDK (500ms)...');

        // Laisser le SDK traiter l'événement READY avant d'appeler beginKeyVerification
        await new Promise(r => setTimeout(r, 500));
        console.log('[Verify] Phase après attente:', request.phase);

        // Si Element a aussi envoyé START (phase=4), récupérer le verifier existant
        let verifier = request.verifier;
        if (!verifier) {
            console.log('[Verify] Envoi START (beginKeyVerification)...');
            verifier = request.beginKeyVerification('m.sas.v1');
        } else {
            console.log('[Verify] Verifier déjà créé par START entrant');
        }
        _activeSASVerifier = verifier;
        verifier.on('show_sas', _showSASEmojis);
        await verifier.verify();
    } catch(e) {
        console.error('[Verify] Erreur initiation:', e);
        if (e.message !== 'cancelled') {
            showToast('Impossible de démarrer la vérification : ' + e.message, 'error');
        }
        closeModal('e2ee-verify-modal');
        _activeVerification = null; _activeSASVerifier = null;
    }
}

// Attend un événement de vérification spécifique dans la room via Room.timeline
function _waitForVerificationEventInRoom(client, txnId, expectedType) {
    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
            client?.removeListener('Room.timeline', onEvent);
            reject(new Error('l\'autre appareil n\'a pas accepté'));
        }, 120000);

        function onEvent(event) {
            const type = event.getType();
            if (!type?.includes('verification')) return;
            const content = event.getContent();
            const relatesTo = content?.['m.relates_to'] ?? {};
            console.log('[Verify] 📨 Room.timeline:', type, '— relates_to:', relatesTo);

            if (relatesTo.event_id === txnId) {
                if (type === expectedType) {
                    clearTimeout(timeout);
                    client?.removeListener('Room.timeline', onEvent);
                    resolve();
                } else if (type === 'm.key.verification.cancel') {
                    clearTimeout(timeout);
                    client?.removeListener('Room.timeline', onEvent);
                    reject(new Error('cancelled'));
                }
            }
        }
        client?.on('Room.timeline', onEvent);
    });
}

// Attend la phase Started=4 (utilisé côté répondeur après accept())
function _waitForVerificationStarted(request) {
    return new Promise((resolve, reject) => {
        const check = () => {
            const p = request.phase;
            if (p === 4) { resolve(); return true; }
            if (p === 5 || request.cancelled) { reject(new Error('cancelled')); return true; }
            if (p === 6) { resolve(); return true; }
            return false;
        };
        if (check()) return;
        const timeout = setTimeout(() => {
            request.removeListener?.('change', onChange);
            resolve(); // on laisse beginKeyVerification gérer
        }, 10000);
        function onChange() {
            if (check()) { clearTimeout(timeout); request.removeListener?.('change', onChange); }
        }
        request.on('change', onChange);
    });
}

function _showSASEmojis(sasData) {
    // sasData est le sasEvent émis par SasEvent.ShowSas — il contient confirm/cancel/mismatch
    _activeSASEvent = sasData;
    const container = document.getElementById('e2ee-emoji-container');
    const decimalEl = document.getElementById('e2ee-decimal-code');
    const emojis = sasData.sas?.emoji || [];
    if (container) {
        container.innerHTML = emojis.map(([emoji, label]) =>
            `<div class="e2ee-emoji-item"><span class="e2ee-emoji">${emoji}</span><span class="e2ee-emoji-label">${label}</span></div>`
        ).join('');
    }
    if (decimalEl && sasData.sas?.decimal) {
        decimalEl.textContent = sasData.sas.decimal.join(' - ');
    }
    document.getElementById('e2ee-verify-step-waiting').classList.add('hidden');
    document.getElementById('e2ee-verify-step-compare').classList.remove('hidden');
}

async function confirmSASVerification() {
    if (!_activeSASEvent) return;
    try {
        await _activeSASEvent.confirm();
        showToast('✅ Appareil vérifié avec succès !', 'success');
    } catch(e) {
        showToast('Erreur : ' + e.message, 'error');
    } finally {
        closeModal('e2ee-verify-modal');
        _activeVerification = null; _activeSASVerifier = null; _activeSASEvent = null;
        await loadSecuritySettings();
    }
}

// ── Cross-signing ────────────────────────────────────────────────────────────

let _crossSigningRecoveryKey = null;

function showCrossSigningSetup() {
    document.getElementById('e2ee-cs-step-intro').classList.remove('hidden');
    document.getElementById('e2ee-cs-step-key').classList.add('hidden');
    document.getElementById('e2ee-cs-passphrase').value = '';
    document.getElementById('e2ee-cs-passphrase2').value = '';
    const errEl = document.getElementById('e2ee-cs-error');
    if (errEl) { errEl.textContent = ''; errEl.classList.remove('show'); }
    showModal('e2ee-crosssign-modal');
}

async function confirmCrossSigningSetup() {
    const btn = document.getElementById('e2ee-cs-setup-btn');
    const errEl = document.getElementById('e2ee-cs-error');
    const pass1 = document.getElementById('e2ee-cs-passphrase')?.value || '';
    const pass2 = document.getElementById('e2ee-cs-passphrase2')?.value || '';
    if (errEl) { errEl.textContent = ''; errEl.classList.remove('show'); }
    if (pass1.length < 8) { if (errEl) { errEl.textContent = 'Phrase secrète trop courte (min 8 caractères).'; errEl.classList.add('show'); } return; }
    if (pass1 !== pass2) { if (errEl) { errEl.textContent = 'Les phrases secrètes ne correspondent pas.'; errEl.classList.add('show'); } return; }
    btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Configuration...';
    try {
        const result = await matrixManager.bootstrapCrossSigning(pass1);
        _crossSigningRecoveryKey = result.recoveryKey;
        // Afficher la clé de récupération
        document.getElementById('e2ee-cs-step-intro').classList.add('hidden');
        const keyEl = document.getElementById('e2ee-cs-recovery-key');
        if (keyEl) keyEl.textContent = result.recoveryKey || '(Clé générée — voir les paramètres de sauvegarde)';
        document.getElementById('e2ee-cs-step-key').classList.remove('hidden');
        // Mettre à jour le statut dans l'onglet sécurité
        setTimeout(() => loadSecuritySettings(), 500);
    } catch(e) {
        // bootstrapCrossSigning peut échouer sur certains serveurs — ce n'est pas bloquant
        console.warn('[E2EE] Cross-signing setup partiel:', e.message);
        if (errEl) { errEl.textContent = 'Configuration partielle : ' + e.message; errEl.classList.add('show'); }
        // Fallback : utiliser la sauvegarde standard
        try {
            const backupResult = await matrixManager.setupKeyBackup(pass1);
            _crossSigningRecoveryKey = backupResult.recoveryKey;
            document.getElementById('e2ee-cs-step-intro').classList.add('hidden');
            const keyEl = document.getElementById('e2ee-cs-recovery-key');
            if (keyEl) keyEl.textContent = backupResult.recoveryKey || '(Sauvegarde configurée)';
            document.getElementById('e2ee-cs-step-key').classList.remove('hidden');
            setTimeout(() => loadSecuritySettings(), 500);
        } catch(e2) {
            if (errEl) { errEl.textContent = 'Erreur : ' + e2.message; errEl.classList.add('show'); }
        }
    } finally {
        btn.disabled = false; btn.innerHTML = '<i class="fas fa-key"></i> Configurer la sécurité';
    }
}

function skipCrossSigningSetup() {
    localStorage.setItem('sendt_e2ee_setup_skipped', '1');
    closeModal('e2ee-crosssign-modal');
}

function _copyRecoveryKey() {
    const keyEl = document.getElementById('e2ee-cs-recovery-key');
    const key = keyEl?.textContent;
    if (!key) return;
    navigator.clipboard.writeText(key).then(() => showToast('Clé copiée !', 'success')).catch(() => {
        // Fallback pour les navigateurs sans clipboard API
        const ta = document.createElement('textarea');
        ta.value = key; document.body.appendChild(ta); ta.select();
        document.execCommand('copy'); document.body.removeChild(ta);
        showToast('Clé copiée !', 'success');
    });
}

function showVerifyOtherDevice() {
    const userId = uiController?.currentContact?.userId;
    const roomId = uiController?.currentContact?.roomId;
    if (!userId) {
        showToast('Sélectionnez d\'abord un contact à vérifier', 'info');
        closeModal('settings-modal');
        return;
    }
    startVerificationWithUser(userId, roomId);
}

async function cancelSASVerification() {
    try {
        if (_activeSASEvent) await _activeSASEvent.cancel?.();
        else if (_activeSASVerifier) await _activeSASVerifier.cancel?.();
        else if (_activeVerification) await _activeVerification.cancel?.();
    } catch(e) {}
    showToast('Vérification annulée', 'info');
    closeModal('e2ee-verify-modal');
    _activeVerification = null; _activeSASVerifier = null; _activeSASEvent = null;
}



// ── Gestion des sessions / appareils connectés ────────────────────────────────

async function loadConnectedDevices() {
    const container = document.getElementById('connected-devices-list');
    const icon = document.getElementById('devices-refresh-icon');
    if (!container) return;
    if (icon) icon.classList.add('fa-spin');
    container.innerHTML = '<div style="color:#8696A0;font-size:.82rem;text-align:center;padding:10px;"><i class="fas fa-spinner fa-spin"></i> Chargement...</div>';

    const devices = await matrixManager.getAllConnectedDevices();

    if (icon) icon.classList.remove('fa-spin');

    if (!devices.length) {
        container.innerHTML = '<div style="color:#8696A0;font-size:.82rem;text-align:center;padding:10px;">Impossible de charger les appareils.</div>';
        return;
    }

    container.innerHTML = devices.map(dev => {
        const isCurrent = dev.isCurrent;
        return `
        <div style="display:flex;align-items:center;gap:10px;padding:10px 12px;background:${isCurrent ? 'rgba(0,133,63,.08)' : 'rgba(255,255,255,.03)'};border:1px solid ${isCurrent ? 'rgba(0,133,63,.25)' : 'rgba(255,255,255,.06)'};border-radius:8px;">
            <i class="fas fa-${isCurrent ? 'desktop' : 'mobile-alt'}" style="color:${isCurrent ? '#00853F' : '#8696A0'};width:18px;text-align:center;"></i>
            <div style="flex:1;min-width:0;">
                <div style="font-size:.84rem;color:#E9EDEF;font-weight:500;display:flex;align-items:center;gap:6px;">
                    ${_escHtml(dev.displayName)}
                    ${isCurrent ? '<span style="font-size:.65rem;background:rgba(0,133,63,.2);color:#25D366;padding:1px 6px;border-radius:10px;font-weight:600;">Cet appareil</span>' : ''}
                </div>
                <div style="font-size:.72rem;color:#8696A0;margin-top:1px;">Dernière activité : ${_escHtml(dev.lastSeen)}${dev.lastSeenIp ? ' · ' + _escHtml(dev.lastSeenIp) : ''}</div>
            </div>
            ${isCurrent
                ? '<span style="font-size:.72rem;color:#25D366;white-space:nowrap;"><i class="fas fa-check-circle"></i> Connecté</span>'
                : `<button onclick="showDisconnectDeviceModal('${_escAttr(dev.deviceId)}','${_escAttr(dev.displayName)}')" style="background:rgba(227,27,35,.12);color:#E31B23;border:1px solid rgba(227,27,35,.3);border-radius:6px;padding:5px 10px;font-size:.75rem;cursor:pointer;white-space:nowrap;" title="Déconnecter cet appareil"><i class="fas fa-sign-out-alt"></i> Déconnecter</button>`
            }
        </div>`;
    }).join('');
}

function showDisconnectDeviceModal(deviceId, deviceName) {
    document.getElementById('disconnect-device-id').value = deviceId;
    document.getElementById('disconnect-device-name').textContent = deviceName;
    document.getElementById('disconnect-device-password').value = '';
    document.getElementById('disconnect-device-error').textContent = '';
    showModal('disconnect-device-modal');
    setTimeout(() => document.getElementById('disconnect-device-password')?.focus(), 200);
}

async function confirmDisconnectDevice() {
    const deviceId = document.getElementById('disconnect-device-id').value;
    const password = document.getElementById('disconnect-device-password').value;
    const errorEl = document.getElementById('disconnect-device-error');
    const btn = document.getElementById('disconnect-device-confirm-btn');
    if (!password) { errorEl.textContent = 'Entrez votre mot de passe.'; return; }
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Déconnexion...';
    errorEl.textContent = '';
    const result = await matrixManager.deleteConnectedDevice(deviceId, password);
    btn.disabled = false;
    btn.innerHTML = '<i class="fas fa-sign-out-alt"></i> Déconnecter';
    if (result.success) {
        closeModal('disconnect-device-modal');
        showToast('Appareil déconnecté', 'success');
        await loadConnectedDevices();
    } else {
        errorEl.textContent = result.error || 'Erreur de déconnexion.';
    }
}

// ── Détection de double connexion (comme Element / WhatsApp) ──────────────────

async function checkMultipleSessions() {
    try {
        const devices = await matrixManager.getAllConnectedDevices();
        const others = devices.filter(d => !d.isCurrent);
        if (!others.length) return;

        document.getElementById('other-sessions-count').textContent = others.length;
        const listEl = document.getElementById('other-devices-list');
        if (listEl) {
            listEl.innerHTML = others.map(d => `
                <div style="display:flex;align-items:center;gap:8px;padding:8px 10px;background:rgba(255,255,255,.04);border-radius:6px;font-size:.82rem;color:#8696A0;">
                    <i class="fas fa-mobile-alt" style="color:#8696A0;width:14px;"></i>
                    <span style="flex:1;">${_escHtml(d.displayName)}</span>
                    <span style="font-size:.72rem;">${_escHtml(d.lastSeen)}</span>
                </div>`).join('');
        }
        showModal('multi-session-modal');
    } catch(e) { console.warn('checkMultipleSessions:', e.message); }
}

async function disconnectOtherSessions() {
    closeModal('multi-session-modal');
    const password = prompt('Entrez votre mot de passe pour déconnecter les autres appareils :');
    if (!password) return;
    const devices = await matrixManager.getAllConnectedDevices();
    const others = devices.filter(d => !d.isCurrent);
    let ok = 0, fail = 0;
    for (const d of others) {
        const r = await matrixManager.deleteConnectedDevice(d.deviceId, password);
        r.success ? ok++ : fail++;
    }
    if (ok) showToast(`${ok} appareil(s) déconnecté(s)`, 'success');
    if (fail) showToast(`${fail} échec(s) — vérifiez votre mot de passe`, 'error');
}

// ── Helpers HTML escape ───────────────────────────────────────────────────────
function _escHtml(s) { const d = document.createElement('div'); d.textContent = String(s ?? ''); return d.innerHTML; }
function _escAttr(s) { return String(s ?? '').replace(/'/g, '&#39;').replace(/"/g, '&quot;'); }
