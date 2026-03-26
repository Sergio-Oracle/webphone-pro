// app.js
// Application principale SENDT v14.2
// ✅ acceptInvitation / declineInvitation globaux
// ✅ toggleEphemeralMenu global
// ✅ Toutes les fonctions globales nécessaires
console.log('SENDT v14.2 démarrage...');
let isLoggedIn = false;

/** Transition depuis la landing page vers le flux de connexion */
function launchApp() {
    document.getElementById('landing-screen')?.classList.remove('active');
    document.getElementById('login-screen')?.classList.add('active');
}

document.addEventListener('DOMContentLoaded', () => {
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
        const un = localStorage.getItem('username');
        if (un) { const el = document.getElementById('username'); if (el) el.value = un; }
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
            if (rm) { localStorage.setItem('rememberMe', 'true'); localStorage.setItem('username', un); }
            else { localStorage.removeItem('rememberMe'); localStorage.removeItem('username'); }
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
        sessionStorage.setItem('_emailLinkSid', result.sid);
        sessionStorage.setItem('_emailLinkSecret', result.clientSecret);
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
    // Restaurer depuis sessionStorage si la page a été rechargée (retour depuis le lien email)
    if (!_emailLinkSid) _emailLinkSid = sessionStorage.getItem('_emailLinkSid');
    if (!_emailLinkSecret) _emailLinkSecret = sessionStorage.getItem('_emailLinkSecret');
    if (!_emailLinkAddress) _emailLinkAddress = sessionStorage.getItem('_emailLinkAddress');
    if (!_emailLinkSid || !_emailLinkSecret) {
        showToast('Session expirée. Recommencez la liaison email.', 'error');
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
        sessionStorage.removeItem('_emailLinkSid');
        sessionStorage.removeItem('_emailLinkSecret');
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
    sessionStorage.removeItem('_emailLinkSid');
    sessionStorage.removeItem('_emailLinkSecret');
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
        // Réinitialiser l'UI sans recharger la page
        ['app-screen','call-screen','loading-screen'].forEach(id => document.getElementById(id)?.classList.remove('active'));
        const ls = document.getElementById('login-screen'); if (ls) ls.classList.add('active');
        // Vider les champs sauf si rememberMe
        if (localStorage.getItem('rememberMe') !== 'true') {
            const u = document.getElementById('username'); if (u) u.value = '';
        }
        const pw = document.getElementById('password'); if (pw) pw.value = '';
        const err = document.getElementById('login-error'); if (err) { err.textContent = ''; err.classList.remove('show'); }
        const btn = document.getElementById('login-btn'); if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-sign-in-alt"></i> Se connecter'; }
        showToast('Déconnecté', 'info');
    }
}

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

console.log(`✅ app.js v14.3 - ${CONFIG.APP_NAME} ${CONFIG.APP_VERSION}`);
