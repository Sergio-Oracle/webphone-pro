// ui-controller.js — SENDT v15.8
// ✅ Nouveautés v15.8 :
//   - Fix Toast : suppression CSS dupliqué dans presence-styles (conflits d'animation)
//   - Fix Accusés de lecture : sendReadReceipt envoyé à l'OUVERTURE du chat (pas que sur nouveau msg)
//   - Fix Ticks bleus : _readReceipts mis à jour AVANT DOM, propagation WhatsApp complète
//   - Fix Vidéo screen share : définitif via getUserMedia frais + onunmute listener côté B

function isSafari() { return /^((?!chrome|android).)*safari/i.test(navigator.userAgent); }

class UIController {
    constructor() {
        this.currentContact = null;
        this.contacts = []; this.groups = []; this.channels = [];
        this.incomingCallData = null; this.chatMessages = {};
        this.mediaRecorder = null; this.audioChunks = []; this.isRecording = false;
        this.recordingStartTime = null; this.recordingTimerInterval = null;
        this.currentlyPlayingAudio = null; this.currentlyPlayingId = null;
        this._pendingFile = null; this._emojiPickerOpen = false; this._emojiTarget = 'chat';
        this._replyingTo = null; this._editingMessage = null;
        this._waveformData = {}; this._typingUsers = {}; this._avatarCache = {};
        this._ephemeralDuration = 0;
        this.audioContext = null; this._safariTimer = null; this._audioEventListeners = {};
        this._publicChannels = []; this._notifications = [];
        this.groupVideoContainer = null; this._seenEventIds = {};
        // Couleurs expéditeur
        this._senderColorMap = {};
        this._senderColorPalette = ['#25D366','#53bdeb','#f093fb','#ffa726','#1abc9c','#e74c3c','#9b59b6','#e67e22','#3498db'];
        this._senderColorIdx = 0;
        // ✅ Fix 1 : Accusés de lecture {roomId: {eventId: Set<userId>}}
        this._readReceipts = {};
        // ✅ Fix 2 : Présence {userId: {presence, lastActiveAgo, currentlyActive, ts}}
        this._presenceMap = {};
        // ✅ Vue unique {eventId: true}
        this._viewOnceOpened = {};
        // ✅ Dernière activité vocale {roomId: isRecording}
        this._voiceRecordingRooms = {};
        // ✅ Fix 2 : Intervalle de refresh de la présence dans le header
        this._presenceRefreshInterval = null;
    }

    init() {
        this.setupEventListeners();
        this._injectPresenceStyles();
        this._injectToastStyles();
        // ✅ v15.4 : Demander la permission de notification browser au démarrage
        if ('Notification' in window && Notification.permission === 'default') {
            Notification.requestPermission().catch(() => {});
        }
    }

    // ✅ Styles toast WhatsApp — injectés séparément pour éviter le conflit avec presence-styles
    _injectToastStyles() {
        if (document.getElementById('wa-toast-styles')) return;
        const s = document.createElement('style');
        s.id = 'wa-toast-styles';
        s.textContent = `
            #wa-toast-container {
                position: fixed !important;
                top: 16px !important;
                right: 16px !important;
                z-index: 99999 !important;
                display: flex;
                flex-direction: column;
                gap: 8px;
                pointer-events: none;
                max-width: 360px;
            }
            .wa-toast {
                display: flex !important;
                align-items: center;
                gap: 10px;
                padding: 10px 14px;
                border-radius: 12px;
                background: var(--bg-secondary, #1F2C34) !important;
                box-shadow: 0 4px 20px rgba(0,0,0,.6) !important;
                min-width: 240px;
                max-width: 340px;
                border-left: 3px solid var(--sn-green, #25D366) !important;
                pointer-events: auto !important;
                cursor: pointer;
                opacity: 1 !important;
                transform: translateX(0) !important;
                animation: waToastIn .3s cubic-bezier(.21,1.02,.73,1) forwards !important;
            }
            @keyframes waToastIn {
                from { transform: translateX(110%); opacity: 0; }
                to   { transform: translateX(0);    opacity: 1; }
            }
            .wa-toast-avatar {
                width: 38px; height: 38px; border-radius: 50%; flex-shrink: 0;
                display: flex; align-items: center; justify-content: center;
                font-size: .92rem; font-weight: 700; color: #fff;
            }
            .wa-toast-body { flex: 1; min-width: 0; }
            .wa-toast-sender {
                font-size: .76rem; font-weight: 700;
                color: var(--sn-green, #25D366);
                margin-bottom: 2px;
                white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
            }
            .wa-toast-content {
                font-size: .83rem;
                color: var(--text-primary, #E9EDEF);
                white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
            }
            .wa-toast-time {
                font-size: .68rem; color: var(--text-muted, #8696A0);
                flex-shrink: 0; margin-left: 4px;
            }
            .wa-toast-close {
                background: none; border: none; color: var(--text-muted,#8696A0);
                cursor: pointer; font-size: .75rem; flex-shrink: 0; padding: 0 0 0 4px;
                line-height: 1;
            }
        `;
        document.head.appendChild(s);
    }

    // ✅ Ouvrir un message à vue unique
    async _openViewOnce(eventId, type, mxcUrl) {
        if (!mxcUrl) return;
        if (!this._viewOnceOpened) this._viewOnceOpened = {};
        this._viewOnceOpened[eventId] = true;
        if (type === 'image') await this.showImageFullscreen(mxcUrl);
        else await this.downloadFile(mxcUrl, 'media_vue_unique');
        if (this.currentContact) this.renderChatMessages();
    }

    sanitize(t) { const d = document.createElement('div'); d.textContent = t; return d.innerHTML; }

    _getSenderColor(senderId) {
        if (!this._senderColorMap[senderId]) {
            this._senderColorMap[senderId] = this._senderColorPalette[this._senderColorIdx++ % this._senderColorPalette.length];
        }
        return this._senderColorMap[senderId];
    }

    // ✅ Fix 2 : Formater la présence WhatsApp-like depuis les données brutes
    _formatPresence(userId) {
        const data = this._presenceMap[userId];
        if (!data) return null;
        if (data.presence === 'online' || data.currentlyActive) return '🟢 En ligne';
        const lastActiveAgo = data.lastActiveAgo;
        if (!lastActiveAgo && lastActiveAgo !== 0) return 'Hors ligne';
        const lastSeenTs = (data.ts || Date.now()) - lastActiveAgo;
        const d = new Date(lastSeenTs);
        const now2 = new Date();
        const timeStr = d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
        if (d.toDateString() === now2.toDateString()) return `vu à ${timeStr}`;
        const yesterday = new Date(now2); yesterday.setDate(yesterday.getDate() - 1);
        if (d.toDateString() === yesterday.toDateString()) return `vu hier à ${timeStr}`;
        const diff = Date.now() - lastSeenTs;
        if (diff < 7 * 86400000) {
            const days = ['dim.','lun.','mar.','mer.','jeu.','ven.','sam.'];
            return `vu ${days[d.getDay()]} à ${timeStr}`;
        }
        return `vu le ${d.toLocaleDateString('fr-FR', { day:'2-digit', month:'2-digit', year:'2-digit' })}`;
    }

    // ✅ Fix 2 : Styles présence + ticks + typing + info contact
    _injectPresenceStyles() {
        if (document.getElementById('presence-styles')) return;
        const s = document.createElement('style');
        s.id = 'presence-styles';
        s.textContent = `
            /* ── Présence ── */
            .presence-dot {
                width: 10px; height: 10px; border-radius: 50%;
                position: absolute; bottom: 0; right: 0;
                border: 2px solid var(--bg-primary, #111B21);
                z-index: 2; transition: background .4s;
            }
            .presence-dot.online  { background: #25D366; }
            .presence-dot.offline { background: #6a6f74; }
            .presence-dot.unavailable { background: #ffa726; }
            .avatar { position: relative; }
            .contact-item .avatar { overflow: visible !important; }

            /* ── Ticks WhatsApp 3 états ── */
            .msg-ticks i { font-size: .75rem; }
            .msg-ticks.sending i   { color: #8696A0; font-size: .7rem; }
            .msg-ticks.delivered i { color: #8696A0; }
            .msg-ticks.read i      { color: #53bdeb; }

            /* ── Typing WhatsApp ── */
            .typing-wave { display: inline-flex; align-items: flex-end; gap: 2px; margin-right: 4px; height: 14px; }
            .typing-wave span {
                display: inline-block; width: 4px; height: 4px; border-radius: 50%;
                background: var(--sn-green, #25D366); opacity: .7;
                animation: waveUp 1.2s infinite ease-in-out;
            }
            .typing-wave span:nth-child(2) { animation-delay: .2s; }
            .typing-wave span:nth-child(3) { animation-delay: .4s; }
            @keyframes waveUp {
                0%, 60%, 100% { transform: translateY(0); }
                30% { transform: translateY(-5px); }
            }
            .typing-text { font-size: .8rem; color: var(--sn-green, #25D366); }
            #typing-indicator.show { padding: 4px 16px 2px; }

            /* ── Vue unique ── */
            .view-once-badge {
                display: inline-flex; align-items: center; gap: 4px;
                background: rgba(0,133,63,.15); color: var(--sn-green, #25D366);
                border: 1px solid rgba(0,133,63,.3); border-radius: 12px;
                padding: 4px 10px; font-size: .75rem; cursor: pointer; user-select: none;
            }
            .view-once-badge i { font-size: .8rem; }

            /* ── Info contact ── */
            #contact-info-modal .modal-content {
                max-width: 480px; max-height: 90vh; overflow-y: auto;
                border-radius: 12px; padding: 0;
            }
            .contact-info-header {
                background: linear-gradient(135deg,#1F2C34,#2A3942);
                padding: 32px 20px 20px; text-align: center; position: relative;
            }
            .contact-info-avatar {
                width: 96px; height: 96px; border-radius: 50%; margin: 0 auto 12px;
                display: flex; align-items: center; justify-content: center;
                font-size: 2.2rem; font-weight: 700; color: #fff; position: relative;
            }
            .contact-info-presence {
                position: absolute; bottom: 4px; right: 4px;
                width: 14px; height: 14px; border-radius: 50%;
                border: 2.5px solid #1F2C34; z-index: 2;
            }
            .contact-info-name { font-size: 1.2rem; font-weight: 700; color: #E9EDEF; margin-bottom: 4px; }
            .contact-info-status { font-size: .82rem; color: #8696A0; }
            .contact-info-section {
                padding: 0 16px;
                border-bottom: 1px solid var(--border-color, rgba(255,255,255,.06));
            }
            .contact-info-row {
                display: flex; align-items: flex-start; gap: 14px;
                padding: 14px 0;
                border-bottom: 1px solid var(--border-color, rgba(255,255,255,.04));
            }
            .contact-info-row:last-child { border-bottom: none; }
            .contact-info-icon { color: var(--sn-green,#25D366); width: 20px; flex-shrink: 0; margin-top: 2px; }
            .contact-info-label { font-size: .72rem; color: #8696A0; margin-bottom: 2px; }
            .contact-info-value { font-size: .9rem; color: #E9EDEF; }
            .contact-info-media-grid {
                display: grid; grid-template-columns: repeat(3, 1fr); gap: 3px;
                padding: 12px 0;
            }
            .contact-info-media-thumb {
                aspect-ratio: 1; object-fit: cover; cursor: pointer;
                background: var(--bg-tertiary,#2A3942); border-radius: 4px;
            }
            .contact-info-actions {
                display: flex; gap: 8px; padding: 16px;
                justify-content: center;
            }
            .contact-info-action-btn {
                flex: 1; padding: 10px 8px; background: rgba(0,133,63,.1);
                border: 1px solid rgba(0,133,63,.3); color: var(--sn-green,#25D366);
                border-radius: 8px; cursor: pointer;
                display: flex; flex-direction: column; align-items: center; gap: 4px;
                font-size: .72rem; font-weight: 500; transition: background .15s;
                max-width: 90px;
            }
            .contact-info-action-btn:hover { background: rgba(0,133,63,.2); }
            .contact-info-action-btn i { font-size: 1.1rem; }
            .contact-info-danger-btn {
                width: 100%; padding: 12px; background: none;
                border: 1px solid var(--accent-danger,#e74c3c);
                color: var(--accent-danger,#e74c3c); border-radius: 8px; cursor: pointer;
                font-size: .88rem; margin: 0 16px 16px; width: calc(100% - 32px);
                display: flex; align-items: center; justify-content: center; gap: 8px;
            }

            /* ── Historique appels WhatsApp ── */
            .call-history-missed-badge {
                width: 6px; height: 6px; border-radius: 50%;
                background: #e74c3c; display: inline-block; margin-right: 2px;
            }
        `;
        document.head.appendChild(s);
    }

    setupEventListeners() {
        window.addEventListener('contacts-loaded', e => {
            this.contacts = e.detail.contacts || [];
            this.groups   = e.detail.groups   || [];
            this.channels = e.detail.channels  || [];
            this.renderContacts();
            this.renderChannels();
        });
        window.addEventListener('incoming-call',          e => this.showIncomingCall(e.detail));
        window.addEventListener('message-received',       e => this.handleIncomingMessage(e.detail));
        window.addEventListener('message-edited',         e => this.handleMessageEdited(e.detail));
        window.addEventListener('message-redacted',       e => this.handleMessageRedacted(e.detail));
        window.addEventListener('call-history-updated',   () => this.renderCallHistory());
        window.addEventListener('call-connection-state',  e => this.updateConnectionStateUI(e.detail.state));
        window.addEventListener('typing-event',           e => this.handleTypingEvent(e.detail));
        window.addEventListener('notifications-updated',  () => this.renderNotifications());
        window.addEventListener('call-ended',             () => this.endCall());

        window.addEventListener('invitation-received', e => this._showInvitationBanner(e.detail));
        window.addEventListener('invitation-accepted', e => this._removeInvitationBanner(e.detail.roomId));
        window.addEventListener('invitation-declined', e => this._removeInvitationBanner(e.detail.roomId));
        window.addEventListener('call-force-ended', () => {
            const modal = document.getElementById('incoming-call-modal');
            if (modal) { modal.classList.remove('show'); modal.classList.remove('active'); }
            this.incomingCallData = null;
        });

        // ✅ Fix 2 : Présence + last seen en temps réel
        window.addEventListener('presence-changed', e => {
            const { userId, presence, lastActiveAgo, currentlyActive } = e.detail;
            // Mettre à jour le cache local
            if (!this._presenceMap[userId]) this._presenceMap[userId] = {};
            this._presenceMap[userId].presence = presence;
            this._presenceMap[userId].lastActiveAgo = lastActiveAgo ?? this._presenceMap[userId].lastActiveAgo;
            this._presenceMap[userId].currentlyActive = currentlyActive ?? false;
            this._presenceMap[userId].ts = Date.now();

            this._updatePresenceDot(userId, presence);

            // Mettre à jour le sous-titre du header si c'est le contact ouvert
            if (this.currentContact?.userId === userId && !this.currentContact.isGroup) {
                this._refreshContactHeader(userId);
            }

            // Mettre à jour le panel info contact si ouvert
            const infoModal = document.getElementById('contact-info-modal');
            if (infoModal?.classList.contains('show')) {
                const presenceDot = infoModal.querySelector('.contact-info-presence');
                const presenceText = infoModal.querySelector('.contact-info-status');
                if (presenceDot) presenceDot.style.background = presence === 'online' ? '#25D366' : '#6a6f74';
                if (presenceText) presenceText.textContent = this._formatPresence(userId) || 'Hors ligne';
            }
        });

        // ✅ Fix 1 : Accusés de lecture — avec propagation WhatsApp
        window.addEventListener('read-receipt-received', e => {
            const { roomId, eventId, userId } = e.detail;
            if (!this._readReceipts[roomId]) this._readReceipts[roomId] = {};
            if (!this._readReceipts[roomId][eventId]) this._readReceipts[roomId][eventId] = new Set();
            this._readReceipts[roomId][eventId].add(userId);

            if (this.currentContact?.roomId === roomId) {
                // Propager : tous les messages OWN précédant cet eventId sont aussi lus
                const msgs = this.chatMessages[roomId] || [];
                const readMsg = msgs.find(m => m.eventId === eventId);
                if (readMsg) {
                    const readTs = readMsg.timestamp || 0;
                    for (const msg of msgs) {
                        if (msg.isOwn && (msg.timestamp || 0) <= readTs && this._isRealEventId(msg.eventId)) {
                            if (!this._readReceipts[roomId][msg.eventId]) {
                                this._readReceipts[roomId][msg.eventId] = new Set();
                            }
                            this._readReceipts[roomId][msg.eventId].add(userId);
                        }
                    }
                }
                // Mettre à jour les ticks directement dans le DOM (instantané)
                this._updateTickForEvent(roomId, eventId);
            }
        });

        // ✅ Fix 4 : Quand un membre rejoint (contact accepte l'invitation DM)
        window.addEventListener('member-joined', e => {
            const { roomId, userId } = e.detail;
            const existingContact = this.contacts.find(c => c.userId === userId);
            if (!existingContact) setTimeout(() => matrixManager.loadRooms(), 500);
        });

        document.getElementById('contact-search')?.addEventListener('input', e => this.filterContacts(e.target.value));
        document.getElementById('new-contact-form')?.addEventListener('submit', e => { e.preventDefault(); this.addNewContact(); });
        document.getElementById('chat-form')?.addEventListener('submit', e => { e.preventDefault(); this.sendChatMessage(); });
        document.getElementById('in-call-chat-form')?.addEventListener('submit', e => { e.preventDefault(); this.sendInCallChatMessage(); });
        document.getElementById('file-input')?.addEventListener('change', e => this.handleFileSelected(e));
        document.getElementById('in-call-file-input')?.addEventListener('change', e => this.handleInCallFileSelected(e));
        document.getElementById('chat-input')?.addEventListener('input', () => {
            if (this.currentContact) matrixManager.sendTyping(this.currentContact.roomId, true);
        });

        document.addEventListener('click', e => {
            if (!e.target.closest('.msg-context-menu')) this.closeContextMenu();
            if (!e.target.closest('.emoji-picker-container,.emoji-picker-panel,.emoji-btn,.incall-emoji-btn')) this.closeEmojiPicker();
            const menu = document.getElementById('ephemeral-menu');
            if (menu?.classList.contains('show') && !e.target.closest('#ephemeral-menu') && !e.target.closest('[onclick*="toggleEphemeralMenu"]')) {
                menu.classList.remove('show');
            }
        });

        document.addEventListener('touchstart', (e) => {
            const btn = e.target.closest?.('.voice-btn');
            if (btn?.id === 'voice-record-btn') try { this.startVoiceRecording(); } catch(err) {}
        }, { passive: true });
        document.addEventListener('touchend', (e) => {
            const btn = e.target.closest?.('.voice-btn');
            if (btn?.id === 'voice-record-btn') try { this.stopVoiceRecording(); } catch(err) {}
        }, { passive: true });
        document.addEventListener('touchcancel', (e) => {
            const btn = e.target.closest?.('.voice-btn');
            if (btn?.id === 'voice-record-btn') try { this.stopVoiceRecording(); } catch(err) {}
        }, { passive: true });
    }

    // ✅ Fix 2 : Mettre à jour le header du chat avec présence live
    _refreshContactHeader(userId) {
        const idEl = document.getElementById('selected-contact-id');
        if (!idEl) return;
        const formatted = this._formatPresence(userId);
        idEl.textContent = formatted || matrixManager.getLastSeenText(userId) || userId;
        // Couleur verte si en ligne
        const data = this._presenceMap[userId];
        const isOnline = data?.presence === 'online' || data?.currentlyActive;
        idEl.style.color = isOnline ? 'var(--sn-green,#25D366)' : '';
    }

    // ✅ Fix 2 : Mettre à jour un point de présence dans le DOM
    _updatePresenceDot(userId, presence) {
        const safeId = userId.replace(/[^a-zA-Z0-9]/g, '_');
        const dot = document.getElementById('presence-' + safeId);
        if (dot) dot.className = `presence-dot ${presence === 'online' ? 'online' : presence === 'unavailable' ? 'unavailable' : 'offline'}`;
    }

    // ✅ Fix 1 : Mettre à jour les ticks dans le DOM sans re-render complet
    _updateTickForEvent(roomId, eventId) {
        if (this.currentContact?.roomId !== roomId) return;
        const msgs = this.chatMessages[roomId] || [];
        let domUpdated = 0;
        for (const msg of msgs) {
            if (!msg.isOwn || !this._isRealEventId(msg.eventId)) continue;
            if (!this._isMessageRead(roomId, msg.eventId)) continue;
            const tickEl = document.querySelector(`[data-event-id="${msg.eventId}"] .msg-ticks`);
            if (tickEl && !tickEl.classList.contains('read')) {
                tickEl.className   = 'msg-ticks read';
                tickEl.title       = 'Lu';
                tickEl.innerHTML   = '<i class="fas fa-check-double"></i>';
                domUpdated++;
            }
        }
        if (domUpdated === 0) this.renderChatMessages();
    }

    _isMessageRead(roomId, eventId) {
        return this._readReceipts[roomId]?.[eventId]?.size > 0;
    }

    // ═══════════════ TOAST WHATSAPP RICHE ✅ Fix 3 ═══════════════
    _showWAToast(data) {
        const { displayName, userId, type, message, mxcUrl, filename } = data;

        // Icône + texte selon le type
        let icon = '💬', preview = (message || '').substring(0, 60);
        if (type === 'image')     { icon = '📷'; preview = 'Photo'; }
        else if (type === 'video')    { icon = '🎬'; preview = 'Vidéo'; }
        else if (type === 'voice')    { icon = '🎙️'; preview = 'Message vocal'; }
        else if (type === 'audio')    { icon = '🔊'; preview = 'Audio'; }
        else if (type === 'file')     { icon = '📎'; preview = filename || 'Fichier'; }
        else if (type === 'location') { icon = '📍'; preview = 'Position partagée'; }
        if (!preview.trim()) preview = '(message vide)';

        const initial = (displayName || '?').charAt(0).toUpperCase();
        const colors  = ['#25D366','#128C7E','#4facfe','#f093fb','#ffa726','#e74c3c','#9b59b6'];
        const bgColor = colors[Math.abs((displayName || '').charCodeAt(0)) % colors.length] || '#25D366';
        const now = new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });

        // S'assurer que les styles toast sont injectés
        this._injectToastStyles();

        // Conteneur — toujours recréer s'il a été supprimé du DOM
        let container = document.getElementById('wa-toast-container');
        if (!container || !document.body.contains(container)) {
            container = document.createElement('div');
            container.id = 'wa-toast-container';
            document.body.appendChild(container);
        }

        const toast = document.createElement('div');
        toast.className = 'wa-toast';
        toast.innerHTML = `
            <div class="wa-toast-avatar" style="background:${bgColor}">${initial}</div>
            <div class="wa-toast-body">
                <div class="wa-toast-sender">${this.sanitize(displayName || userId)}</div>
                <div class="wa-toast-content">${icon} ${this.sanitize(preview)}</div>
            </div>
            <span class="wa-toast-time">${now}</span>
            <button class="wa-toast-close" title="Fermer">✕</button>`;

        // Clic sur le toast → naviguer vers ce contact/groupe
        toast.addEventListener('click', (e) => {
            if (e.target.classList.contains('wa-toast-close')) { toast.remove(); return; }
            toast.remove();
            const contact = this.contacts.find(c => c.userId === userId)
                         || this.contacts.find(c => c.roomId === data.roomId);
            if (contact) this.selectContact(contact.userId);
            else {
                const grp = this.groups.find(g => g.roomId === data.roomId);
                if (grp) this.selectGroup(grp.roomId);
            }
        });

        container.appendChild(toast);

        // Limiter à 5 toasts simultanés
        const toasts = container.querySelectorAll('.wa-toast');
        if (toasts.length > 5) toasts[0].remove();

        // Auto-disparaître après 5s
        const hideTimer = setTimeout(() => {
            if (!document.body.contains(toast)) return;
            toast.style.transition = 'opacity .35s ease, transform .35s ease';
            toast.style.opacity = '0';
            toast.style.transform = 'translateX(110%)';
            setTimeout(() => toast.remove(), 360);
        }, 5000);

        // Annuler le timer si on hover
        toast.addEventListener('mouseenter', () => clearTimeout(hideTimer));
        toast.addEventListener('mouseleave', () => {
            setTimeout(() => {
                if (!document.body.contains(toast)) return;
                toast.style.transition = 'opacity .35s ease, transform .35s ease';
                toast.style.opacity = '0';
                toast.style.transform = 'translateX(110%)';
                setTimeout(() => toast.remove(), 360);
            }, 2000);
        });
    }

    // ═══════════════ PROFIL ═══════════════
    async showProfileModal() {
        const p = matrixManager.getUserProfile();
        const idEl = document.getElementById('profile-user-id');
        if (idEl) idEl.textContent = matrixManager.getUserId() || '';
        const dnEl = document.getElementById('profile-display-name');
        if (dnEl) dnEl.value = p.displayname || '';
        const av = document.getElementById('profile-avatar-preview');
        if (av) {
            if (p.avatar_url) {
                const b = await matrixManager.getAvatarBlobUrl(p.avatar_url);
                av.innerHTML = b ? `<img src="${b}" alt="Avatar">` : '<i class="fas fa-user"></i>';
            } else av.innerHTML = '<i class="fas fa-user"></i>';
        }
        showModal('profile-modal');
    }

    async saveProfile() {
        const n = document.getElementById('profile-display-name')?.value.trim();
        if (!n) { showToast('Nom requis', 'warning'); return; }
        if (await matrixManager.setDisplayName(n)) {
            showToast('Profil mis à jour !', 'success');
            this.updateUserProfile(matrixManager.getUserId(), n);
            await this._updateSidebarAvatar();
        } else showToast('Erreur', 'error');
    }

    changeAvatar() { const i = document.getElementById('profile-avatar-input'); if (i) { i.value = ''; i.click(); } }

    async handleAvatarSelected(e) {
        const f = e.target.files[0];
        if (!f || !f.type.startsWith('image/') || f.size > 5e6) { showToast('Image invalide (max 5Mo)', 'error'); return; }
        showToast('Upload en cours...', 'info');
        const mxcUrl = await matrixManager.uploadAvatar(f);
        if (mxcUrl) {
            showToast('Avatar mis à jour !', 'success');
            const prev = document.getElementById('profile-avatar-preview');
            if (prev) prev.innerHTML = `<img src="${URL.createObjectURL(f)}" alt="Avatar">`;
            await this._updateSidebarAvatar();
        }
    }

    async _updateSidebarAvatar() {
        const p = matrixManager.getUserProfile();
        const n = document.getElementById('user-display-name'); if (n && p.displayname) n.textContent = p.displayname;
        const a = document.getElementById('user-avatar');
        if (a && p.avatar_url) {
            const b = await matrixManager.getAvatarBlobUrl(p.avatar_url);
            if (b) a.innerHTML = `<img src="${b}" class="sidebar-avatar-img" alt="">`;
        }
    }

    updateUserProfile(uid, dn) { const e = document.getElementById('user-display-name'); if (e) e.textContent = dn || uid; }
    updateConnectionStateUI(s) { const e = document.getElementById('connection-indicator'); if (e) e.className = 'connection-indicator ' + s; }

    handleTypingEvent(detail) {
        this._typingUsers[detail.roomId] = detail.users;
        if (this.currentContact?.roomId === detail.roomId) this._renderTypingIndicator();
    }

    _notifyVoiceRecordingState(isRecording) {
        if (this.currentContact) {
            const rid = this.currentContact.roomId;
            const listItem = document.querySelector(`[data-room-id="${rid}"] .contact-last-msg`);
            if (listItem) listItem.textContent = isRecording ? '🎙️ Enregistrement vocal...' : '';
        }
    }

    _renderTypingIndicator() {
        const el = document.getElementById('typing-indicator'); if (!el) return;
        const users = this._typingUsers[this.currentContact?.roomId] || [];
        if (!users.length) { el.classList.remove('show'); el.innerHTML = ''; return; }
        let icon = `<span class="typing-wave"><span></span><span></span><span></span></span>`;
        let text = '';
        if (users.length === 1) text = `<strong>${users[0]}</strong> est en train d'écrire`;
        else if (users.length === 2) text = `<strong>${users[0]}</strong> et <strong>${users[1]}</strong> écrivent`;
        else text = `<strong>${users.length} personnes</strong> écrivent`;
        el.innerHTML = `<div class="typing-content">${icon}<span class="typing-text">${text}</span></div>`;
        el.classList.add('show');
    }

    // ═══════════════ EMOJI ═══════════════
    toggleEmojiPicker(target) {
        this._emojiTarget = target || 'chat';
        const cid = target === 'incall' ? 'in-call-emoji-picker' : 'emoji-picker';
        const c = document.getElementById(cid);
        if (c?.classList.contains('show')) { this.closeEmojiPicker(); return; }
        this.closeEmojiPicker(); if (!c) return;
        if (!c.dataset.built) {
            const cats = [...CONFIG.EMOJI_CATEGORIES];
            cats[0].emojis = recentEmojiManager.getRecents();
            let h = `<div class="emoji-picker-container"><div class="emoji-search-bar"><input type="text" placeholder="Rechercher..." oninput="uiController.filterEmojis(this.value,'${cid}')"></div><div class="emoji-categories-bar">`;
            cats.forEach((ct, i) => { h += `<button class="emoji-cat-btn ${i === 1 ? 'active' : ''}" data-cat="${ct.id}" onclick="uiController.switchEmojiCategory('${cid}','${ct.id}')">${ct.icon}</button>`; });
            h += '</div><div class="emoji-grid-wrapper">';
            cats.forEach((ct, i) => {
                h += `<div class="emoji-grid ${i === 1 ? 'active' : ''}" id="${cid}-grid-${ct.id}">`;
                ct.emojis.forEach(em => { h += `<button class="emoji-item" data-emoji="${em}">${em}</button>`; });
                h += '</div>';
            });
            h += '</div></div>'; c.innerHTML = h; c.dataset.built = 'true';
            c.addEventListener('click', (ev) => {
                const btn = ev.target.closest('.emoji-item');
                if (btn?.dataset.emoji) uiController.insertEmoji(btn.dataset.emoji);
            });
        }
        c.classList.add('show'); this._emojiPickerOpen = true;
    }

    switchEmojiCategory(cid, cat) {
        const c = document.getElementById(cid); if (!c) return;
        c.querySelectorAll('.emoji-cat-btn').forEach(b => b.classList.toggle('active', b.dataset.cat === cat));
        c.querySelectorAll('.emoji-grid').forEach(g => g.classList.toggle('active', g.id === cid + '-grid-' + cat));
    }

    filterEmojis(q, cid) {
        const c = document.getElementById(cid); if (!c) return;
        c.querySelectorAll('.emoji-item').forEach(b => { b.style.display = !q || b.dataset.emoji.includes(q) ? '' : 'none'; });
    }

    insertEmoji(em) {
        const id  = this._emojiTarget === 'incall' ? 'in-call-chat-input' : 'chat-input';
        const inp = document.getElementById(id);
        if (inp) { const p = inp.selectionStart || inp.value.length; inp.value = inp.value.substring(0, p) + em + inp.value.substring(p); inp.focus(); }
        recentEmojiManager.add(em);
    }

    closeEmojiPicker() {
        document.querySelectorAll('.emoji-picker-panel').forEach(p => p.classList.remove('show'));
        this._emojiPickerOpen = false;
    }

    // ═══════════════ CONTEXT MENU ═══════════════
    showMessageContextMenu(ev, d) {
        ev.preventDefault(); ev.stopPropagation(); this.closeContextMenu();
        const menu = document.createElement('div'); menu.className = 'msg-context-menu'; menu.id = 'active-context-menu';
        const items = [];
        items.push({ i: 'fa-reply', l: 'Répondre', a: () => this.startReply(d) });
        if (d.isOwn && d.type === 'text') items.push({ i: 'fa-pen', l: 'Modifier', a: () => this.startEdit(d) });
        if (d.type === 'text') items.push({ i: 'fa-copy', l: 'Copier', a: () => copyToClipboard(d.message) });
        items.push({ i: 'fa-share', l: 'Transférer', a: () => this.showForwardModal(d) });
        items.push({ i: 'fa-thumbtack', l: 'Épingler', a: () => this.pinMsg(d) });
        if (d.isOwn) items.push({ i: 'fa-trash-alt', l: 'Supprimer', a: () => this.deleteMsg(d), danger: true });
        menu.innerHTML = items.map(x => `<button class="ctx-menu-item ${x.danger ? 'danger' : ''}"><i class="fas ${x.i}"></i> ${x.l}</button>`).join('');
        menu.querySelectorAll('.ctx-menu-item').forEach((b, idx) => b.addEventListener('click', () => { items[idx].a(); this.closeContextMenu(); }));
        menu.style.top  = Math.min(ev.clientY, window.innerHeight - items.length * 44 - 20) + 'px';
        menu.style.left = Math.min(ev.clientX, window.innerWidth - 200) + 'px';
        document.body.appendChild(menu);
    }

    closeContextMenu() { const m = document.getElementById('active-context-menu'); if (m) m.remove(); }

    async deleteMsg(d) {
        if (!this.currentContact || !d.eventId || !confirm('Supprimer ce message ?')) return;
        await matrixManager.deleteMessage(this.currentContact.roomId, d.eventId);
        const ms = this.chatMessages[this.currentContact.roomId];
        if (ms) { this.chatMessages[this.currentContact.roomId] = ms.filter(m => m.eventId !== d.eventId); this.renderChatMessages(); }
    }

    startReply(d) {
        this._replyingTo = d; this._editingMessage = null;
        const sn = d.isOwn ? 'Vous' : (d.sender || '').split(':')[0].substring(1);
        let preview = d.type === 'text' ? this.sanitize((d.message || '').substring(0, 80))
            : d.type === 'voice' ? '🎙️ Vocal' : d.type === 'image' ? '📷 Photo'
            : d.type === 'location' ? '📍 Position' : '📎 Fichier';
        const b = document.getElementById('reply-bar');
        if (b) {
            b.innerHTML = `<div class="reply-preview-bar"><div class="reply-preview-accent"></div><div class="reply-preview-body"><span class="reply-preview-name">${this.sanitize(sn)}</span><span class="reply-preview-text">${preview}</span></div><button class="reply-cancel-btn" onclick="uiController.cancelReply()"><i class="fas fa-times"></i></button></div>`;
            b.classList.add('show');
        }
        document.getElementById('chat-input')?.focus();
    }

    startEdit(d) {
        this._editingMessage = d; this._replyingTo = null;
        const inp = document.getElementById('chat-input'); if (inp) inp.value = d.message || '';
        const b = document.getElementById('reply-bar');
        if (b) {
            b.innerHTML = `<div class="reply-preview-bar editing"><div class="reply-preview-accent"></div><div class="reply-preview-body"><span class="reply-preview-name"><i class="fas fa-pen"></i> Modification</span><span class="reply-preview-text">${this.sanitize((d.message || '').substring(0, 80))}</span></div><button class="reply-cancel-btn" onclick="uiController.cancelReply()"><i class="fas fa-times"></i></button></div>`;
            b.classList.add('show');
        }
        inp?.focus();
    }

    cancelReply() {
        this._replyingTo = null; this._editingMessage = null;
        const b = document.getElementById('reply-bar'); if (b) { b.classList.remove('show'); b.innerHTML = ''; }
    }

    async pinMsg(d) { if (this.currentContact && d.eventId) await matrixManager.pinMessage(this.currentContact.roomId, d.eventId); }

    showForwardModal(msg) {
        const modal = document.getElementById('forward-modal'); if (!modal) return;
        const list = modal.querySelector('.forward-contacts-list');
        if (list) list.innerHTML = this.contacts.map(c => `<div class="forward-contact-item" onclick="uiController.forwardTo('${this.sanitize(c.userId)}')"><div class="avatar"><i class="fas fa-user"></i></div><span>${this.sanitize(c.displayName)}</span></div>`).join('');
        this._forwardingMessage = msg; showModal('forward-modal');
    }

    async forwardTo(userId) {
        const contact = this.contacts.find(c => c.userId === userId);
        if (!contact || !this._forwardingMessage) return; closeModal('forward-modal');
        if (await matrixManager.forwardMessage(contact.roomId, this._forwardingMessage)) showToast(`Transféré à ${contact.displayName}`, 'success');
        this._forwardingMessage = null;
    }

    handleMessageEdited(d) {
        const ms = this.chatMessages[d.roomId]; if (!ms) return;
        const m = ms.find(x => x.eventId === d.editedEventId);
        if (m) { m.message = d.newBody; m.edited = true; }
        if (this.currentContact?.roomId === d.roomId) this.renderChatMessages();
    }

    handleMessageRedacted(d) {
        const ms = this.chatMessages[d.roomId]; if (!ms) return;
        this.chatMessages[d.roomId] = ms.filter(m => m.eventId !== d.redactedEventId);
        if (this.currentContact?.roomId === d.roomId) this.renderChatMessages();
    }

    // ═══════════════ FICHIERS ═══════════════
    openFilePicker() { const f = document.getElementById('file-input'); if (f) { f.value = ''; f.click(); } }

    handleFileSelected(e) {
        const f = e.target.files[0];
        if (!f || f.size > matrixManager.getMaxUploadSize()) { showToast('Trop volumineux', 'error'); return; }
        this._pendingFile = f; this.showFilePreview(f);
    }

    showFilePreview(file) {
        const p = document.getElementById('file-preview'); if (!p) return;
        const cat = getFileCategory(file.type);
        let ph = '';
        if (cat === 'image') ph = `<img src="${URL.createObjectURL(file)}" class="file-preview-img">`;
        else if (cat === 'video') ph = `<video src="${URL.createObjectURL(file)}" class="file-preview-video" controls style="max-width:200px;max-height:150px;border-radius:8px"></video>`;
        else if (cat === 'audio') ph = `<div class="file-preview-audio"><i class="fas fa-headphones"></i><audio src="${URL.createObjectURL(file)}" controls style="max-width:200px"></audio></div>`;
        else ph = `<div class="file-preview-icon"><i class="fas ${getFileIcon(file.type)}"></i></div>`;
        p.innerHTML = `<div class="file-preview-content">${ph}<div class="file-preview-info"><span class="file-preview-name">${this.sanitize(file.name)}</span><span class="file-preview-size">${formatFileSize(file.size)}</span></div><div class="file-preview-actions"><button class="file-send-btn" onclick="uiController.sendPendingFile()"><i class="fas fa-paper-plane"></i> Envoyer</button><button class="file-cancel-btn" onclick="uiController.cancelFilePreview()"><i class="fas fa-times"></i></button></div></div>`;
        p.classList.add('show');
    }

    async sendPendingFile() {
        if (!this._pendingFile || !this.currentContact) return;
        const f = this._pendingFile; this.cancelFilePreview();
        showToast('Envoi...', 'info');
        if (await matrixManager.sendFile(this.currentContact.roomId, f)) showToast('Envoyé !', 'success');
    }

    cancelFilePreview() {
        this._pendingFile = null;
        const p = document.getElementById('file-preview'); if (p) { p.classList.remove('show'); p.innerHTML = ''; }
    }

    openInCallFilePicker() { const f = document.getElementById('in-call-file-input'); if (f) { f.value = ''; f.click(); } }

    async handleInCallFileSelected(e) {
        const file = e.target.files[0]; if (!file || !this.currentContact) return;
        showToast('Envoi...', 'info');
        if (await matrixManager.sendFile(this.currentContact.roomId, file)) {
            showToast('Envoyé !', 'success');
            setTimeout(() => this.renderInCallMessages(), 400);
        }
    }

    // ═══════════════ VOICE RECORDING ═══════════════
    async startVoiceRecording() {
        if (this.isRecording || !this.currentContact) return;
        try {
            const s = await navigator.mediaDevices.getUserMedia({ audio: true });
            let mimeType = isSafari() ? 'audio/mp4' : 'audio/webm;codecs=opus';
            this.mediaRecorder = MediaRecorder.isTypeSupported(mimeType) ? new MediaRecorder(s, { mimeType }) : new MediaRecorder(s);
            this.audioChunks = []; this.isRecording = true; this.recordingStartTime = Date.now();
            this.mediaRecorder.ondataavailable = e => { if (e.data.size > 0) this.audioChunks.push(e.data); };
            this.mediaRecorder.onstop = async () => {
                s.getTracks().forEach(t => t.stop());
                const d = Date.now() - this.recordingStartTime; this._resetRecUI();
                this._updateContactListPreview(this.currentContact.roomId, '');
                if (d < 500 || !this.audioChunks.length) return;
                const b = new Blob(this.audioChunks, { type: this.mediaRecorder.mimeType || 'audio/webm' });
                await matrixManager.sendVoiceMessage(this.currentContact.roomId, b, d);
            };
            this.mediaRecorder.start();
            matrixManager.sendTyping(this.currentContact.roomId, true);
            this._updateContactListPreview(this.currentContact.roomId, '🎙️ Enregistrement vocal...');
            this._showRecUI();
        } catch(e) { showToast('Micro inaccessible', 'error'); this.isRecording = false; }
    }

    _updateContactListPreview(roomId, text) {
        const item = document.querySelector(`.contact-item[data-room-id="${roomId}"] .contact-last-msg`);
        if (item && text) item.style.color = 'var(--sn-green, #25D366)';
        if (item) item.textContent = text || '';
    }

    stopVoiceRecording() { if (this.isRecording && this.mediaRecorder) try { this.mediaRecorder.stop(); } catch(e) {} this.isRecording = false; }
    cancelVoiceRecording() { this.audioChunks = []; this.stopVoiceRecording(); this._resetRecUI(); }

    _showRecUI() {
        document.getElementById('recording-indicator')?.classList.add('active');
        const c = document.getElementById('chat-input'); if (c) c.style.display = 'none';
        document.getElementById('voice-record-btn')?.classList.add('recording');
        this.recordingTimerInterval = setInterval(() => {
            const s = Math.floor((Date.now() - this.recordingStartTime) / 1000);
            const t = document.getElementById('recording-timer');
            if (t) t.textContent = String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
        }, 100);
    }

    _resetRecUI() {
        document.getElementById('recording-indicator')?.classList.remove('active');
        const c = document.getElementById('chat-input'); if (c) c.style.display = '';
        document.getElementById('voice-record-btn')?.classList.remove('recording');
        if (this.recordingTimerInterval) { clearInterval(this.recordingTimerInterval); this.recordingTimerInterval = null; }
    }

    // ═══════════════ VOICE PLAYBACK ═══════════════
    _fmtDurMs(ms) { const s = Math.round(ms / 1000); return String(Math.floor(s / 60)) + ':' + String(s % 60).padStart(2, '0'); }

    _cleanupAudio(id) {
        if (this._audioEventListeners[id]) {
            const { audio, timeupdate, ended } = this._audioEventListeners[id];
            if (audio) { audio.removeEventListener('timeupdate', timeupdate); audio.removeEventListener('ended', ended); audio.removeEventListener('error', this._audioEventListeners[id].error); }
            delete this._audioEventListeners[id];
        }
        if (this._safariTimer) { clearInterval(this._safariTimer); this._safariTimer = null; }
    }

    async playVoiceMessage(url, id) {
        if (this.currentlyPlayingId === id && this.currentlyPlayingAudio) {
            if (this.currentlyPlayingAudio.paused) { this._resumeAudio(); this._updPlayBtn(id, true); }
            else { this._pauseAudio(); this._updPlayBtn(id, false); }
            return;
        }
        if (this.currentlyPlayingAudio) {
            this._stopAudio();
            if (this.currentlyPlayingId) { this._updPlayBtn(this.currentlyPlayingId, false); this._resetWaveform(this.currentlyPlayingId); this._cleanupAudio(this.currentlyPlayingId); }
        }
        this._updPlayBtn(id, true);
        let blobUrl;
        try {
            blobUrl = await matrixManager.downloadAudioBlob(url);
            if (!blobUrl) throw new Error('Téléchargement échoué');
        } catch(e) { this._updPlayBtn(id, false); showToast('Erreur de téléchargement du message vocal', 'error'); return; }
        const tryAudioElement = () => new Promise((resolve, reject) => {
            const audio = new Audio(blobUrl);
            const onCanPlay = () => { audio.removeEventListener('canplaythrough', onCanPlay); audio.removeEventListener('error', onError); resolve(audio); };
            const onError  = (err) => { audio.removeEventListener('canplaythrough', onCanPlay); audio.removeEventListener('error', onError); reject(err); };
            audio.addEventListener('canplaythrough', onCanPlay); audio.addEventListener('error', onError); audio.load();
        });
        try {
            const audio = await tryAudioElement();
            this.currentlyPlayingAudio = audio; this.currentlyPlayingId = id;
            const th = this._handleTimeUpdate.bind(this, id);
            const eh = this._handleEnded.bind(this, id);
            const errh = () => this._handleAudioError(id);
            audio.addEventListener('timeupdate', th); audio.addEventListener('ended', eh); audio.addEventListener('error', errh);
            this._audioEventListeners[id] = { audio, timeupdate: th, ended: eh, error: errh };
            await audio.play();
        } catch(err) {
            try { const br = await fetch(blobUrl); const bl = await br.blob(); await this._playWithWebAudio(bl, id); }
            catch(we) { showToast('Format audio non supporté', 'error'); this._updPlayBtn(id, false); }
        }
    }

    async _playWithWebAudio(blob, id) {
        if (!this.audioContext) this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
        if (this.audioContext.state === 'suspended') await this.audioContext.resume();
        const audioBuffer = await this.audioContext.decodeAudioData(await blob.arrayBuffer());
        const source = this.audioContext.createBufferSource();
        source.buffer = audioBuffer; source.connect(this.audioContext.destination); source.start(0);
        this.currentlyPlayingAudio = source;
        Object.assign(this.currentlyPlayingAudio, { startTime: performance.now() / 1000, duration: audioBuffer.duration, isPaused: false, pausedTime: 0 });
        this.currentlyPlayingId = id;
        this._safariTimer = setInterval(() => {
            if (this.currentlyPlayingAudio && !this.currentlyPlayingAudio.isPaused) {
                const ct = performance.now() / 1000 - this.currentlyPlayingAudio.startTime;
                if (ct >= this.currentlyPlayingAudio.duration) { this._handleEnded(id); }
                else {
                    this._animateWaveform(id, ct / this.currentlyPlayingAudio.duration);
                    const dur = document.querySelector(`[data-voice-id="${id}"] .voice-duration`);
                    if (dur) { const s = Math.floor(ct); dur.textContent = String(Math.floor(s / 60)) + ':' + String(s % 60).padStart(2, '0'); }
                }
            }
        }, 100);
        source.onended = () => this._handleEnded(id);
    }

    _handleAudioError(id) {
        this._cleanupAudio(id);
        if (this.currentlyPlayingId === id) { this.currentlyPlayingAudio = null; this.currentlyPlayingId = null; }
        this._updPlayBtn(id, false); this._resetWaveform(id); showToast('Erreur lecture audio', 'error');
    }

    _resumeAudio() {
        if (this.currentlyPlayingAudio instanceof HTMLAudioElement) { this.currentlyPlayingAudio.play(); }
        else if (this.currentlyPlayingAudio && this.audioContext) {
            if (this.audioContext.state === 'suspended') this.audioContext.resume();
            this.currentlyPlayingAudio.isPaused  = false;
            this.currentlyPlayingAudio.startTime = performance.now() / 1000 - this.currentlyPlayingAudio.pausedTime;
        }
    }

    _pauseAudio() {
        if (this.currentlyPlayingAudio instanceof HTMLAudioElement) { this.currentlyPlayingAudio.pause(); }
        else if (this.currentlyPlayingAudio) { this.currentlyPlayingAudio.isPaused = true; this.currentlyPlayingAudio.pausedTime = performance.now() / 1000 - this.currentlyPlayingAudio.startTime; }
    }

    _stopAudio() {
        if (this.currentlyPlayingAudio instanceof HTMLAudioElement) { this.currentlyPlayingAudio.pause(); this.currentlyPlayingAudio.currentTime = 0; }
        else if (this.currentlyPlayingAudio?.stop) { this.currentlyPlayingAudio.stop(); }
        if (this.currentlyPlayingId) this._cleanupAudio(this.currentlyPlayingId);
        this.currentlyPlayingAudio = null; this.currentlyPlayingId = null;
    }

    _handleTimeUpdate(id) {
        if (!this.currentlyPlayingAudio || this.currentlyPlayingId !== id) return;
        const a = this.currentlyPlayingAudio;
        if (a.duration) {
            this._animateWaveform(id, a.currentTime / a.duration);
            const dur = document.querySelector(`[data-voice-id="${id}"] .voice-duration`);
            if (dur) { const s = Math.floor(a.currentTime); dur.textContent = String(Math.floor(s / 60)) + ':' + String(s % 60).padStart(2, '0'); }
        }
    }

    _handleEnded(id) {
        this._updPlayBtn(id, false); this._resetWaveform(id); this._cleanupAudio(id);
        if (this.currentlyPlayingId === id) { this.currentlyPlayingAudio = null; this.currentlyPlayingId = null; }
        if (this._safariTimer) { clearInterval(this._safariTimer); this._safariTimer = null; }
    }

    _updPlayBtn(id, p) { const b = document.querySelector(`[data-voice-id="${id}"] .voice-play-btn i`); if (b) b.className = p ? 'fas fa-pause' : 'fas fa-play'; }
    _animateWaveform(id, progress) { const c = document.querySelector(`[data-voice-id="${id}"] .voice-waveform`); if (!c) return; const bars = c.querySelectorAll('.wf-bar'); const active = Math.floor(progress * bars.length); bars.forEach((bar, i) => bar.classList.toggle('active', i <= active)); }
    _resetWaveform(id) { const c = document.querySelector(`[data-voice-id="${id}"] .voice-waveform`); if (!c) return; c.querySelectorAll('.wf-bar').forEach(b => b.classList.remove('active')); }

    async downloadFile(url, name) {
        try {
            const blobUrl = await matrixManager.downloadMediaBlob(url);
            if (!blobUrl) throw new Error('Téléchargement échoué');
            const a = document.createElement('a'); a.href = blobUrl; a.download = name || 'fichier';
            document.body.appendChild(a); a.click(); a.remove();
            setTimeout(() => URL.revokeObjectURL(blobUrl), 60000);
            showToast('Téléchargé', 'success');
        } catch(e) { showToast('Erreur téléchargement', 'error'); }
    }

    async showImageFullscreen(url) {
        try {
            const blobUrl = await matrixManager.downloadMediaBlob(url);
            if (!blobUrl) throw new Error('Blob invalide');
            const o = document.getElementById('image-viewer-modal');
            const img = document.getElementById('image-viewer-img');
            if (o && img) { img.src = blobUrl; o.classList.add('show'); }
        } catch(e) { showToast('Impossible d\'afficher l\'image', 'error'); }
    }

    closeImageViewer() { document.getElementById('image-viewer-modal')?.classList.remove('show'); }

    // ═══════════════ LOCATION ═══════════════
    showLocationPicker() {
        if (!this.currentContact) { showToast('Sélectionnez un contact', 'error'); return; }
        const modal = document.getElementById('location-modal');
        if (modal) {
            modal.innerHTML = `<div class="modal-content" style="max-width:500px"><div class="modal-header"><h3><i class="fas fa-map-marker-alt"></i> Partager ma position</h3><button class="close-btn" onclick="closeModal('location-modal')"><i class="fas fa-times"></i></button></div><div class="modal-body"><div id="location-map" style="height:280px;border-radius:8px;margin-bottom:12px;background:var(--bg-tertiary)"></div><div class="location-options"><button class="location-option-btn" onclick="uiController.sendCurrentLocation()"><i class="fas fa-map-pin"></i><span>Ma position actuelle</span></button><button class="location-option-btn" onclick="uiController.startLiveLocation('15m')"><i class="fas fa-broadcast-tower"></i><span>Position en direct - 15 min</span></button><button class="location-option-btn" onclick="uiController.startLiveLocation('1h')"><i class="fas fa-broadcast-tower"></i><span>Position en direct - 1 heure</span></button><button class="location-option-btn" onclick="uiController.startLiveLocation('8h')"><i class="fas fa-broadcast-tower"></i><span>Position en direct - 8 heures</span></button></div></div></div>`;
            showModal('location-modal');
            this._initLocationMap();
        }
    }

    _initLocationMap() {
        this._currentPosition = null;
        if (typeof L === 'undefined') { this._getCurrentLocationForMap(); return; }
        try {
            const map = L.map('location-map').setView([14.6928, -17.4467], 13);
            L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap', maxZoom: 19 }).addTo(map);
            this._locationMap = map;
            navigator.geolocation.getCurrentPosition(
                pos => {
                    this._currentPosition = pos;
                    const { latitude: lat, longitude: lng } = pos.coords;
                    map.setView([lat, lng], 16);
                    L.marker([lat, lng]).addTo(map).bindPopup(`📍 Votre position`).openPopup();
                    L.circle([lat, lng], { radius: pos.coords.accuracy, color: '#00853F', fillColor: '#00853F', fillOpacity: 0.1 }).addTo(map);
                },
                () => {}, { enableHighAccuracy: true, timeout: 10000 }
            );
            setTimeout(() => map.invalidateSize(), 300);
        } catch(e) { this._getCurrentLocationForMap(); }
    }

    async _getCurrentLocationForMap() {
        try {
            const pos = await new Promise((res, rej) => navigator.geolocation.getCurrentPosition(res, rej, { enableHighAccuracy: true, timeout: 10000 }));
            const mapDiv = document.getElementById('location-map');
            if (mapDiv) mapDiv.innerHTML = `<div style="text-align:center;padding:20px"><i class="fas fa-map-marker-alt" style="font-size:2rem;color:var(--sn-green);margin-bottom:8px"></i><p>📍 ${pos.coords.latitude.toFixed(6)}, ${pos.coords.longitude.toFixed(6)}</p></div>`;
        } catch(e) {
            const mapDiv = document.getElementById('location-map');
            if (mapDiv) mapDiv.innerHTML = '<p style="color:var(--accent-danger);padding:20px"><i class="fas fa-exclamation-triangle"></i> Impossible d\'accéder à la localisation</p>';
        }
    }

    async sendCurrentLocation() {
        try {
            const pos = await new Promise((res, rej) => navigator.geolocation.getCurrentPosition(res, rej, { enableHighAccuracy: true }));
            closeModal('location-modal'); showToast('Envoi de la position...', 'info');
            if (await matrixManager.sendLocation(this.currentContact.roomId, pos.coords.latitude, pos.coords.longitude)) showToast('Position envoyée !', 'success');
        } catch(e) { showToast('Impossible d\'accéder à la localisation', 'error'); }
    }

    async startLiveLocation(durationId) {
        const dur = CONFIG.LOCATION_SHARING.liveDurations.find(d => d.id === durationId);
        if (!dur) { showToast('Durée invalide', 'error'); return; }
        closeModal('location-modal'); showToast(`Position en direct activée (${dur.label})`, 'success');
        await matrixManager.startLiveLocation(this.currentContact.roomId, dur.seconds);
    }

    // ═══════════════ CONTACTS ═══════════════
    renderContacts() {
        const c = document.getElementById('contacts-list'); if (!c) return;
        const allGroups   = this.groups   || [];
        const allContacts = this.contacts || [];

        if (!allGroups.length && !allContacts.length) {
            c.innerHTML = '<div class="empty-state"><i class="fas fa-address-book"></i><p>Aucun contact</p><button class="btn-secondary" onclick="showNewContactDialog()">Ajouter un contact</button><button class="btn-secondary" onclick="showCreateGroupDialog()" style="margin-top:8px">Créer un groupe</button></div>';
            return;
        }

        let html = '';

        if (allGroups.length) {
            html += `<div class="section-label" style="padding:6px 14px;font-size:0.72rem;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:.08em">Groupes</div>`;
            html += allGroups.map(g => {
                const n   = this.sanitize(g.displayName);
                const rid = this.sanitize(g.roomId);
                const lastMsg  = g.lastMessage ? this.sanitize(g.lastMessage) : `${g.memberCount || 0} membres`;
                const lastTime = g.lastMessageTime ? formatTime(g.lastMessageTime) : '';
                return `<div class="contact-item" onclick="uiController.selectGroup('${rid}')">
                    <div class="avatar" style="background:linear-gradient(135deg,#4facfe,#00f2fe)"><i class="fas fa-users" style="font-size:1rem"></i></div>
                    <div class="contact-details">
                        <div class="contact-top-row"><span class="contact-name">${n}</span><span class="contact-time">${lastTime}</span></div>
                        <div class="contact-bottom-row"><span class="contact-last-msg">${lastMsg}</span></div>
                    </div>
                    <div class="contact-actions-hover">
                        <button class="icon-btn-small" onclick="event.stopPropagation();quickGroupCall('${rid}',false)" title="Appel groupe"><i class="fas fa-phone"></i></button>
                        <button class="icon-btn-small" onclick="event.stopPropagation();quickGroupCall('${rid}',true)" title="Vidéo groupe"><i class="fas fa-video"></i></button>
                    </div>
                </div>`;
            }).join('');
        }

        if (allContacts.length) {
            if (allGroups.length) html += `<div class="section-label" style="padding:6px 14px;font-size:0.72rem;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:.08em">Contacts</div>`;
            html += allContacts.map(ct => {
                const n  = this.sanitize(ct.displayName);
                const u  = this.sanitize(ct.userId);
                const safeId  = ct.userId.replace(/[^a-zA-Z0-9]/g, '_');
                const lastMsg  = ct.lastMessage ? this.sanitize(ct.lastMessage) : '';
                const lastTime = ct.lastMessageTime ? formatTime(ct.lastMessageTime) : '';
                const initial  = ct.displayName.charAt(0).toUpperCase();
                const colors   = ['#25D366', '#128C7E', '#075E54', '#4facfe', '#f093fb', '#f5576c', '#ffa726'];
                const bgColor  = colors[initial.charCodeAt(0) % colors.length];
                // ✅ Fix 2 : point de présence depuis le cache local
                const presData = this._presenceMap[ct.userId];
                const presClass = presData?.presence === 'online' ? 'online' : presData?.presence === 'unavailable' ? 'unavailable' : 'offline';
                const presenceDotHtml = `<div class="presence-dot ${presClass}" id="presence-${safeId}"></div>`;

                return `<div class="contact-item" onclick="uiController.selectContact('${u}')" data-room-id="${this.sanitize(ct.roomId)}">
                    <div class="avatar" id="avatar-${safeId}">
                        <span class="avatar-initial" style="background:${bgColor}">${initial}</span>
                        ${presenceDotHtml}
                    </div>
                    <div class="contact-details">
                        <div class="contact-top-row"><span class="contact-name">${n}</span><span class="contact-time">${lastTime}</span></div>
                        <div class="contact-bottom-row"><span class="contact-last-msg">${lastMsg || u}</span></div>
                    </div>
                    <div class="contact-actions-hover">
                        <button class="icon-btn-small" onclick="event.stopPropagation();quickCall('${u}',false)" title="Appel"><i class="fas fa-phone"></i></button>
                        <button class="icon-btn-small" onclick="event.stopPropagation();quickCall('${u}',true)" title="Vidéo"><i class="fas fa-video"></i></button>
                    </div>
                </div>`;
            }).join('');
            allContacts.forEach(ct => { if (ct.avatarMxc) this._loadContactAvatar(ct.userId, ct.avatarMxc); });
        }

        c.innerHTML = html;
    }

    async _loadContactAvatar(userId, mxcUrl) {
        const b = await matrixManager.getAvatarBlobUrl(mxcUrl);
        if (b) {
            this._avatarCache[userId] = b;
            const safeId = userId.replace(/[^a-zA-Z0-9]/g, '_');
            const el = document.getElementById('avatar-' + safeId);
            if (el) {
                const presData = this._presenceMap[userId];
                const presClass = presData?.presence === 'online' ? 'online' : 'offline';
                el.innerHTML = `<img src="${b}" class="contact-avatar-img" alt=""><div class="presence-dot ${presClass}" id="presence-${safeId}"></div>`;
            }
        }
    }

    // ═══════════════ CHANNELS ═══════════════
    renderChannels() {
        const container = document.getElementById('channels-list'); if (!container) return;
        if (!this.channels?.length) {
            container.innerHTML = `<div class="empty-state"><i class="fas fa-hashtag"></i><p>Aucun salon</p><button class="btn-secondary" onclick="explorePublicChannels()">Explorer</button><button class="btn-secondary" onclick="showCreateChannelDialog()" style="margin-top:8px">Créer un salon</button></div>`;
            return;
        }
        let html = '';
        this.channels.forEach(ch => {
            const name     = this.sanitize(ch.displayName);
            const lastMsg  = this.sanitize(ch.lastMessage || '');
            const lastTime = ch.lastMessageTime ? formatTime(ch.lastMessageTime) : '';
            const members  = ch.memberCount || 0;
            const isPublic = ch.isPublic ? '<i class="fas fa-globe" style="color:var(--sn-green);font-size:0.7rem;margin-left:4px"></i>' : '';
            html += `<div class="contact-item channel-item" onclick="uiController.selectChannel('${this.sanitize(ch.roomId)}')">
                <div class="avatar" style="background:linear-gradient(135deg,#9b59b6,#8e44ad)"><i class="fas fa-hashtag"></i></div>
                <div class="contact-details">
                    <div class="contact-top-row"><span class="contact-name">${name}${isPublic}</span><span class="contact-time">${lastTime}</span></div>
                    <div class="contact-bottom-row"><span class="contact-last-msg">${lastMsg || members + ' membres'}</span></div>
                </div>
            </div>`;
        });
        container.innerHTML = html;
    }

    filterChannels(query) {
        const term = (query || '').toLowerCase();
        const list = document.getElementById('public-channels-results') || document.getElementById('public-channels-list');
        if (!list) return;
        list.querySelectorAll('.public-channel-item').forEach(item => {
            const name  = item.querySelector('.channel-name')?.textContent?.toLowerCase() || '';
            const topic = item.querySelector('.channel-topic')?.textContent?.toLowerCase() || '';
            item.style.display = (!term || name.includes(term) || topic.includes(term)) ? '' : 'none';
        });
    }

    showCreateChannelDialog() { showCreateChannelDialog(); }

    async createChannel() {
        const name = document.getElementById('channel-name')?.value.trim();
        if (!name) { showToast('Nom du salon requis', 'error'); return; }
        const description = document.getElementById('channel-description')?.value.trim() || '';
        const isPublic    = document.getElementById('channel-public')?.checked || false;
        const btn = document.querySelector('#create-channel-modal .btn-primary');
        if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Création...'; }
        showToast('Création du salon...', 'info');
        try {
            const roomId = await matrixManager.createChannel(name, description, isPublic);
            if (roomId) {
                showToast(`Salon "${name}" créé !`, 'success'); closeModal('create-channel-modal');
                document.getElementById('channel-name').value = '';
                document.getElementById('channel-description').value = '';
                document.getElementById('channel-public').checked = false;
                matrixManager.loadRooms();
            } else showToast('Erreur lors de la création', 'error');
        } catch(e) { showToast('Erreur: ' + (e.message || 'inconnu'), 'error'); }
        finally { if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-plus"></i> Créer le salon'; } }
    }

    async selectChannel(roomId) {
        const channel = this.channels.find(c => c.roomId === roomId); if (!channel) return;
        this.currentContact = { roomId, displayName: channel.displayName, isChannel: true, memberCount: channel.memberCount, isPublic: channel.isPublic };
        document.getElementById('welcome-screen')?.classList.add('hidden');
        document.getElementById('group-mgmt-bar')?.remove();
        const cv = document.getElementById('contact-view');
        if (cv) {
            cv.classList.remove('hidden');
            const nameEl = document.getElementById('selected-contact-name');
            const idEl   = document.getElementById('selected-contact-id');
            if (nameEl) nameEl.textContent = channel.displayName;
            if (idEl)   idEl.textContent   = `${channel.memberCount || 0} membres • ${channel.isPublic ? 'public' : 'privé'}`;
            if (idEl)   idEl.style.color   = '';
        }
        this.cancelReply();
        await this.loadChatHistory();
    }

    async selectGroup(roomId) {
        const group = this.groups.find(g => g.roomId === roomId); if (!group) return;
        this.currentContact = { roomId, displayName: group.displayName, isGroup: true, memberCount: group.memberCount || 0 };
        document.getElementById('welcome-screen')?.classList.add('hidden');
        document.getElementById('group-mgmt-bar')?.remove();
        const cv = document.getElementById('contact-view');
        if (cv) {
            cv.classList.remove('hidden');
            const nameEl = document.getElementById('selected-contact-name');
            const idEl   = document.getElementById('selected-contact-id');
            if (nameEl) nameEl.textContent = group.displayName;
            if (idEl)   idEl.textContent   = `${group.memberCount || 0} membres`;
            if (idEl)   idEl.style.color   = '';
            const chatHeader = document.querySelector('#contact-view .chat-header');
            if (chatHeader) {
                chatHeader.style.cursor = 'pointer';
                chatHeader.title = 'Voir les infos du groupe';
                chatHeader.onclick = (e) => { if (!e.target.closest('.icon-btn, .call-btn, button')) this.showGroupInfoModal(roomId); };
            }
            this._renderGroupManagementBar(roomId);
        }
        // Arrêter le polling de présence individuel
        if (this._presenceRefreshInterval) { clearInterval(this._presenceRefreshInterval); this._presenceRefreshInterval = null; }
        this.cancelReply();
        await this.loadChatHistory();
    }

    async showGroupInfoModal(roomId) {
        if (!roomId) return;
        const cl = matrixManager.getClient(); if (!cl) return;
        const room = cl.getRoom(roomId); if (!room) return;
        const myUserId = matrixManager.getUserId();
        let members = [];
        try { members = room.getJoinedMembers() || []; } catch(e) {}
        members.sort((a, b) => {
            if (a.userId === myUserId) return -1;
            if (b.userId === myUserId) return 1;
            return (a.name || a.userId).localeCompare(b.name || b.userId);
        });
        const groupName = room.name || 'Groupe';
        const initial   = groupName.charAt(0).toUpperCase();
        let amAdmin = false;
        try {
            const pl = room.currentState?.getStateEvents('m.room.power_levels', '');
            const myPL = pl?.getContent?.()?.users?.[myUserId] ?? 0;
            amAdmin = myPL >= 50;
        } catch(e) {}

        const memberItems = members.map(m => {
            const isMe     = m.userId === myUserId;
            const name     = m.name || m.userId;
            const uid      = m.userId;
            const initials = name.substring(0, 2).toUpperCase();
            const colors   = ['#25D366','#128C7E','#4facfe','#f093fb','#ffa726','#e74c3c','#9b59b6'];
            const bg       = colors[uid.charCodeAt(0) % colors.length];
            let role = '';
            try {
                const pl = room.currentState?.getStateEvents('m.room.power_levels', '');
                const memberPL = pl?.getContent?.()?.users?.[uid] ?? 0;
                if (memberPL >= 100) role = '<span style="color:#ffa726;font-size:.65rem;margin-left:4px">Admin</span>';
                else if (memberPL >= 50) role = '<span style="color:#53bdeb;font-size:.65rem;margin-left:4px">Modérateur</span>';
            } catch(e) {}
            const kickBtn = (!isMe && amAdmin) ? `<button class="icon-btn-small" onclick="uiController._kickGroupMember('${this.sanitize(uid)}')" title="Exclure" style="color:#e74c3c"><i class="fas fa-user-times"></i></button>` : '';
            const safeId  = uid.replace(/[^a-zA-Z0-9]/g,'_');
            const presData = this._presenceMap[uid];
            const presClass = presData?.presence === 'online' ? 'online' : 'offline';
            const presenceDot = `<span class="presence-dot ${presClass}" style="position:static;display:inline-block;margin-left:4px;vertical-align:middle;border:none"></span>`;

            return `<div class="group-info-member-item" id="gim-${safeId}">
                <div class="avatar" style="width:38px;height:38px;flex-shrink:0">
                    <span class="avatar-initial" style="background:${bg};font-size:.85rem">${initials}</span>
                </div>
                <div style="flex:1;min-width:0">
                    <div style="font-size:.88rem;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">
                        ${this.sanitize(name)}${isMe ? ' <span style="color:var(--sn-green);font-size:.7rem">(Vous)</span>' : ''}${role}${presenceDot}
                    </div>
                    <div style="font-size:.7rem;color:var(--text-muted)">${this.sanitize(uid)}</div>
                </div>
                ${kickBtn}
            </div>`;
        }).join('');

        let modal = document.getElementById('group-info-modal');
        if (!modal) { modal = document.createElement('div'); modal.id = 'group-info-modal'; modal.className = 'modal'; document.body.appendChild(modal); }

        modal.innerHTML = `
        <div class="modal-content" style="max-width:460px;max-height:85vh;overflow-y:auto">
            <div class="modal-header"><h3><i class="fas fa-users" style="color:var(--sn-green)"></i> Infos du groupe</h3><button class="close-btn" onclick="closeModal('group-info-modal')"><i class="fas fa-times"></i></button></div>
            <div class="modal-body" style="padding:0">
                <div style="text-align:center;padding:24px 20px 16px;background:linear-gradient(135deg,rgba(0,133,63,.12),rgba(79,172,254,.08))">
                    <div style="width:72px;height:72px;border-radius:50%;background:linear-gradient(135deg,#4facfe,#00f2fe);display:flex;align-items:center;justify-content:center;margin:0 auto 12px;font-size:1.8rem;font-weight:700;color:#fff">${initial}</div>
                    <div style="font-size:1.1rem;font-weight:600;color:var(--text-primary);margin-bottom:4px">${this.sanitize(groupName)}</div>
                    <div style="font-size:.8rem;color:var(--text-muted)">${members.length} participant${members.length > 1 ? 's' : ''}</div>
                </div>
                <div style="display:flex;gap:0;border-top:1px solid var(--border-color);border-bottom:1px solid var(--border-color)">
                    <button onclick="uiController.showInviteMemberDialog();closeModal('group-info-modal')" style="flex:1;padding:12px 8px;background:none;border:none;color:var(--sn-green);cursor:pointer;display:flex;flex-direction:column;align-items:center;gap:4px;font-size:.72rem;border-right:1px solid var(--border-color)"><i class="fas fa-user-plus" style="font-size:1.1rem"></i>Inviter</button>
                    <button onclick="uiController.startCall(false);closeModal('group-info-modal')" style="flex:1;padding:12px 8px;background:none;border:none;color:var(--sn-green);cursor:pointer;display:flex;flex-direction:column;align-items:center;gap:4px;font-size:.72rem;border-right:1px solid var(--border-color)"><i class="fas fa-phone" style="font-size:1.1rem"></i>Appel</button>
                    <button onclick="uiController.startCall(true);closeModal('group-info-modal')" style="flex:1;padding:12px 8px;background:none;border:none;color:var(--sn-green);cursor:pointer;display:flex;flex-direction:column;align-items:center;gap:4px;font-size:.72rem"><i class="fas fa-video" style="font-size:1.1rem"></i>Vidéo</button>
                </div>
                <div>
                    <div style="padding:10px 16px 4px;font-size:.72rem;font-weight:600;color:var(--text-muted);text-transform:uppercase">Membres (${members.length})</div>
                    <div style="max-height:320px;overflow-y:auto">${memberItems}</div>
                </div>
                <div style="padding:12px 16px;border-top:1px solid var(--border-color);display:flex;flex-direction:column;gap:8px">
                    <button onclick="uiController.leaveGroup();closeModal('group-info-modal')" style="width:100%;padding:10px;background:none;border:1px solid #ffa726;color:#ffa726;border-radius:8px;cursor:pointer;font-size:.88rem;display:flex;align-items:center;justify-content:center;gap:8px"><i class="fas fa-sign-out-alt"></i> Quitter le groupe</button>
                    ${amAdmin ? `<button onclick="uiController.deleteGroup();closeModal('group-info-modal')" style="width:100%;padding:10px;background:none;border:1px solid var(--accent-danger);color:var(--accent-danger);border-radius:8px;cursor:pointer;font-size:.88rem;display:flex;align-items:center;justify-content:center;gap:8px"><i class="fas fa-trash-alt"></i> Supprimer le groupe</button>` : ''}
                </div>
            </div>
        </div>`;

        if (!document.getElementById('group-info-styles')) {
            const s = document.createElement('style'); s.id = 'group-info-styles';
            s.textContent = `.group-info-member-item{display:flex;align-items:center;gap:12px;padding:10px 16px;transition:background .15s}.group-info-member-item:hover{background:var(--bg-tertiary)}`;
            document.head.appendChild(s);
        }
        showModal('group-info-modal');
    }

    async _kickGroupMember(userId) {
        if (!this.currentContact?.isGroup) return;
        const cl = matrixManager.getClient(); if (!cl) return;
        const room = cl.getRoom(this.currentContact.roomId);
        const name = room?.getMember(userId)?.name || userId;
        if (!confirm(`Exclure ${name} du groupe ?`)) return;
        try {
            await cl.kick(this.currentContact.roomId, userId, 'Exclu par l\'administrateur');
            showToast(`${name} a été exclu(e)`, 'success');
            document.getElementById(`gim-${userId.replace(/[^a-zA-Z0-9]/g, '_')}`)?.remove();
        } catch(e) { showToast('Impossible d\'exclure : ' + (e.message || 'erreur'), 'error'); }
    }

    _renderGroupManagementBar(roomId) {
        document.getElementById('group-mgmt-bar')?.remove();
        const bar = document.createElement('div');
        bar.id = 'group-mgmt-bar';
        bar.style.cssText = 'display:flex;align-items:center;gap:6px;padding:6px 12px;background:rgba(0,133,63,.08);border-bottom:1px solid rgba(0,133,63,.15);flex-wrap:wrap;';
        bar.innerHTML = `
            <button class="icon-btn-small" style="color:var(--sn-green)" onclick="uiController.showGroupInfoModal('${this.sanitize(roomId)}')" title="Infos"><i class="fas fa-info-circle"></i></button>
            <span style="font-size:.72rem;color:var(--text-muted)">Infos</span>
            <span style="margin:0 4px;color:var(--text-muted)">·</span>
            <button class="icon-btn-small" style="color:var(--sn-green)" onclick="uiController.showInviteMemberDialog()" title="Inviter"><i class="fas fa-user-plus"></i></button>
            <span style="font-size:.72rem;color:var(--text-muted)">Inviter</span>
            <span style="margin:0 4px;color:var(--text-muted)">·</span>
            <button class="icon-btn-small" style="color:#ffa726" onclick="uiController.leaveGroup()" title="Quitter"><i class="fas fa-sign-out-alt"></i></button>
            <span style="font-size:.72rem;color:var(--text-muted)">Quitter</span>
            <span style="margin:0 4px;color:var(--text-muted)">·</span>
            <button class="icon-btn-small" style="color:#e74c3c" onclick="uiController.deleteGroup()" title="Supprimer"><i class="fas fa-trash-alt"></i></button>
            <span style="font-size:.72rem;color:var(--text-muted)">Supprimer</span>`;
        const chatHeader = document.querySelector('#contact-view .chat-header');
        if (chatHeader) chatHeader.parentNode.insertBefore(bar, chatHeader.nextSibling);
    }

    showInviteMemberDialog() {
        if (!this.currentContact?.isGroup) return;
        let currentMemberIds = new Set();
        try {
            const cl = matrixManager.getClient();
            const room = cl?.getRoom(this.currentContact.roomId);
            if (room) {
                room.getJoinedMembers().forEach(m => currentMemberIds.add(m.userId));
                room.getMembersWithMembership?.('invite')?.forEach(m => currentMemberIds.add(m.userId));
            }
        } catch(e) {}
        const nonMemberContacts = this.contacts.filter(c => !currentMemberIds.has(c.userId));

        let modal = document.getElementById('invite-member-modal');
        if (!modal) { modal = document.createElement('div'); modal.id = 'invite-member-modal'; modal.className = 'modal'; document.body.appendChild(modal); }

        const contactSuggestions = nonMemberContacts.length > 0
            ? `<div style="margin-bottom:12px"><div style="font-size:.78rem;color:var(--text-muted);margin-bottom:8px;font-weight:500">Contacts à inviter :</div>
                <div style="max-height:150px;overflow-y:auto;border:1px solid var(--border-color);border-radius:8px">
                    ${nonMemberContacts.map(c => {
                        const initial = c.displayName.charAt(0).toUpperCase();
                        const colors  = ['#25D366','#128C7E','#4facfe','#f093fb','#ffa726'];
                        const bg      = colors[initial.charCodeAt(0) % colors.length];
                        return `<div class="contact-item" style="padding:8px 12px;cursor:pointer" onclick="document.getElementById('invite-member-id').value='${this.sanitize(c.userId)}';this.style.background='rgba(0,133,63,.1)'">
                            <div class="avatar" style="width:32px;height:32px"><span class="avatar-initial" style="background:${bg};font-size:.75rem">${initial}</span></div>
                            <div class="contact-details"><span class="contact-name" style="font-size:.85rem">${this.sanitize(c.displayName)}</span><span style="font-size:.72rem;color:var(--text-muted)">${this.sanitize(c.userId)}</span></div>
                        </div>`;
                    }).join('')}
                </div></div>` : '';

        modal.innerHTML = `
        <div class="modal-content" style="max-width:440px">
            <div class="modal-header"><h3><i class="fas fa-user-plus"></i> Inviter dans le groupe</h3><button class="close-btn" onclick="closeModal('invite-member-modal')"><i class="fas fa-times"></i></button></div>
            <div class="modal-body">
                ${contactSuggestions}
                <div class="form-group">
                    <label>Identifiant Matrix</label>
                    <input type="text" id="invite-member-id" placeholder="@utilisateur:serveur.org ou alice">
                    <small style="color:var(--text-muted)">Format: <code>@alice:matrix.org</code> ou juste <code>alice</code></small>
                </div>
                <div id="invite-member-error" style="color:var(--accent-danger);font-size:.82rem;margin-bottom:8px;display:none;padding:8px;background:rgba(227,27,35,.1);border-radius:6px"></div>
                <div style="display:flex;gap:8px;margin-top:16px">
                    <button class="btn-primary" id="invite-confirm-btn" onclick="uiController.confirmInviteMember()"><i class="fas fa-paper-plane"></i> Inviter</button>
                    <button class="btn-secondary" onclick="closeModal('invite-member-modal')">Annuler</button>
                </div>
            </div>
        </div>`;
        showModal('invite-member-modal');
        setTimeout(() => {
            const inp = document.getElementById('invite-member-id');
            inp?.focus();
            inp?.addEventListener('keydown', (e) => { if (e.key === 'Enter') this.confirmInviteMember(); });
        }, 200);
    }

    async confirmInviteMember() {
        if (!this.currentContact?.isGroup) return;
        const rawInput = document.getElementById('invite-member-id')?.value.trim();
        const errEl    = document.getElementById('invite-member-error');
        const btn      = document.getElementById('invite-confirm-btn');
        const showErr  = (msg) => { if (errEl) { errEl.textContent = msg; errEl.style.display = 'block'; } };
        const hideErr  = () => { if (errEl) errEl.style.display = 'none'; };
        if (!rawInput) { showErr('Veuillez saisir un identifiant.'); return; }
        hideErr();
        let uid = rawInput;
        if (!(uid.startsWith('@') && uid.includes(':'))) {
            let serverName = '';
            try { serverName = (matrixManager.homeserverUrl || '').replace(/^https?:\/\//, '').split('/')[0]; } catch(e) {}
            if (!serverName) { showErr('Impossible de déterminer le serveur. Utilisez @alice:serveur.org'); return; }
            const localpart = uid.startsWith('@') ? uid.substring(1) : uid;
            uid = `@${localpart.split(':')[0]}:${serverName}`;
        }
        try {
            const cl = matrixManager.getClient();
            const room = cl?.getRoom(this.currentContact.roomId);
            if (room) {
                const allPresent = [...(room.getJoinedMembers() || []), ...(room.getMembersWithMembership?.('invite') || [])].map(m => m.userId);
                if (allPresent.includes(uid)) {
                    const joined = room.getJoinedMembers().some(m => m.userId === uid);
                    showErr(`${room.getMember(uid)?.name || uid} est ${joined ? 'déjà membre du groupe' : 'déjà invité(e), en attente'}.`);
                    return;
                }
            }
        } catch(e) {}
        if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Invitation...'; }
        try {
            await matrixManager.getClient().invite(this.currentContact.roomId, uid);
            showToast(`✅ Invitation envoyée à ${uid}`, 'success');
            closeModal('invite-member-modal');
        } catch(e) {
            let errMsg = 'Impossible d\'envoyer l\'invitation.';
            if (e.errcode === 'M_NOT_FOUND' || e.httpStatus === 404) errMsg = `Utilisateur ${uid} introuvable.`;
            else if (e.errcode === 'M_FORBIDDEN' || e.httpStatus === 403) errMsg = `Vous n'avez pas la permission d'inviter.`;
            else if (e.message) errMsg = e.message;
            showErr(errMsg);
        } finally {
            if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-paper-plane"></i> Inviter'; }
        }
    }

    async leaveGroup() {
        if (!this.currentContact?.isGroup) return;
        const name = this.currentContact.displayName;
        if (!confirm(`Quitter le groupe "${name}" ?`)) return;
        const success = await matrixManager.leaveRoom(this.currentContact.roomId);
        if (success) {
            this.groups = this.groups.filter(g => g.roomId !== this.currentContact.roomId);
            this.renderContacts(); this.currentContact = null;
            document.getElementById('group-mgmt-bar')?.remove();
            document.getElementById('contact-view')?.classList.add('hidden');
            document.getElementById('welcome-screen')?.classList.remove('hidden');
            showToast(`Vous avez quitté "${name}"`, 'success');
        } else showToast('Impossible de quitter le groupe', 'error');
    }

    async deleteGroup() {
        if (!this.currentContact?.isGroup) return;
        const name = this.currentContact.displayName;
        if (!confirm(`Supprimer définitivement le groupe "${name}" ?\nTous les membres seront expulsés.`)) return;
        try {
            const cl = matrixManager.getClient(); const roomId = this.currentContact.roomId;
            if (cl) {
                const room = cl.getRoom(roomId);
                if (room) { for (const m of room.getJoinedMembers().filter(m => m.userId !== matrixManager.getUserId())) { try { await cl.kick(roomId, m.userId, 'Groupe supprimé'); } catch(e) {} } }
                await cl.leave(roomId);
            }
            this.groups = this.groups.filter(g => g.roomId !== roomId); this.renderContacts();
            this.currentContact = null; document.getElementById('group-mgmt-bar')?.remove();
            document.getElementById('contact-view')?.classList.add('hidden');
            document.getElementById('welcome-screen')?.classList.remove('hidden');
            showToast(`Groupe "${name}" supprimé`, 'success');
        } catch(e) { showToast('Erreur : ' + (e.message || ''), 'error'); }
    }

    async selectContact(userId) {
        const contact = this.contacts.find(c => c.userId === userId); if (!contact) return;
        this.currentContact = { roomId: contact.roomId, displayName: contact.displayName, userId: contact.userId, isGroup: false, isChannel: false };
        document.getElementById('welcome-screen')?.classList.add('hidden');
        document.getElementById('group-mgmt-bar')?.remove();
        const chatHeader = document.querySelector('#contact-view .chat-header');
        if (chatHeader) {
            chatHeader.style.cursor = 'pointer';
            chatHeader.title = 'Voir les infos du contact';
            chatHeader.onclick = (e) => { if (!e.target.closest('.icon-btn, .call-btn, button')) this.showContactInfoModal(userId); };
        }
        const cv = document.getElementById('contact-view');
        if (cv) {
            cv.classList.remove('hidden');
            const nameEl = document.getElementById('selected-contact-name');
            const idEl   = document.getElementById('selected-contact-id');
            if (nameEl) nameEl.textContent = contact.displayName;
            if (idEl) {
                // ✅ Fix 2 : Afficher présence WhatsApp-like depuis le cache local
                const formatted = this._formatPresence(userId);
                idEl.textContent = formatted || matrixManager.getLastSeenText?.(userId) || userId;
                const isOnline = this._presenceMap[userId]?.presence === 'online';
                idEl.style.color = isOnline ? 'var(--sn-green,#25D366)' : '';
            }
        }
        // ✅ Fix 2 : Polling header présence toutes les 30s pendant qu'on est dans ce chat
        if (this._presenceRefreshInterval) clearInterval(this._presenceRefreshInterval);
        this._presenceRefreshInterval = setInterval(() => {
            if (this.currentContact?.userId === userId) this._refreshContactHeader(userId);
        }, 30000);

        this.cancelReply();
        await this.loadChatHistory();
    }

    // ✅ Fix 5 : Panel info contact WhatsApp-like avec présence live, médias partagés, bio
    async showContactInfoModal(userId) {
        const contact = this.contacts.find(c => c.userId === userId);
        if (!contact) return;

        const presData = this._presenceMap[userId];
        const isOnline = presData?.presence === 'online' || presData?.currentlyActive;
        const presenceText = this._formatPresence(userId) || (isOnline ? '🟢 En ligne' : 'Hors ligne');
        const initial  = contact.displayName.charAt(0).toUpperCase();
        const colors   = ['#25D366','#128C7E','#4facfe','#f093fb','#ffa726','#e74c3c','#9b59b6'];
        const bgColor  = colors[initial.charCodeAt(0) % colors.length];

        // ✅ Médias partagés via matrix-client
        const sharedMedia = matrixManager.getRoomSharedMedia?.(contact.roomId, 9) || [];
        const mediaHtml = sharedMedia.length > 0
            ? `<div class="contact-info-media-grid">
                ${sharedMedia.map(m => {
                    const thumbUrl = matrixManager.mxcToThumbnailUrl?.(m.mxcUrl, 150, 150) || '';
                    if (m.type === 'image') return `<img class="contact-info-media-thumb" src="${thumbUrl}" onclick="uiController.showImageFullscreen('${m.mxcUrl}')" alt="">`;
                    return `<div class="contact-info-media-thumb" style="display:flex;align-items:center;justify-content:center"><i class="fas fa-film" style="color:#8696A0"></i></div>`;
                }).join('')}
               </div>`
            : '<div style="padding:12px 0;color:var(--text-muted);font-size:.82rem;text-align:center">Aucun média partagé</div>';

        let modal = document.getElementById('contact-info-modal');
        if (!modal) { modal = document.createElement('div'); modal.id = 'contact-info-modal'; modal.className = 'modal'; document.body.appendChild(modal); }

        const avatarUrl = this._avatarCache[userId];
        const avatarContent = avatarUrl
            ? `<img src="${avatarUrl}" style="width:96px;height:96px;border-radius:50%;object-fit:cover;display:block;margin:0 auto" alt="">`
            : `<span style="background:${bgColor};width:96px;height:96px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:2.2rem;font-weight:700;color:#fff;margin:0 auto">${initial}</span>`;

        modal.innerHTML = `
        <div class="modal-content" style="max-width:480px;max-height:90vh;overflow-y:auto;padding:0;border-radius:12px;overflow:hidden">
            <!-- Header dégradé -->
            <div class="contact-info-header">
                <div style="position:relative;display:inline-block;margin-bottom:12px">
                    ${avatarContent}
                    <div class="contact-info-presence" style="background:${isOnline ? '#25D366' : '#6a6f74'}"></div>
                </div>
                <div class="contact-info-name">${this.sanitize(contact.displayName)}</div>
                <div class="contact-info-status" id="cim-presence-text">${this.sanitize(presenceText)}</div>
            </div>

            <!-- Actions rapides -->
            <div style="display:flex;justify-content:center;gap:12px;padding:16px;border-bottom:1px solid var(--border-color)">
                <button class="contact-info-action-btn" onclick="uiController.startCallFromInfo('${this.sanitize(userId)}',false);closeModal('contact-info-modal')">
                    <i class="fas fa-phone"></i><span>Appel</span>
                </button>
                <button class="contact-info-action-btn" onclick="uiController.startCallFromInfo('${this.sanitize(userId)}',true);closeModal('contact-info-modal')">
                    <i class="fas fa-video"></i><span>Vidéo</span>
                </button>
                <button class="contact-info-action-btn" onclick="closeModal('contact-info-modal')">
                    <i class="fas fa-comment"></i><span>Message</span>
                </button>
            </div>

            <!-- Informations -->
            <div class="contact-info-section">
                <div class="contact-info-row">
                    <i class="fas fa-at contact-info-icon"></i>
                    <div><div class="contact-info-label">Identifiant Matrix</div><div class="contact-info-value" style="font-size:.82rem;word-break:break-all">${this.sanitize(userId)}</div></div>
                </div>
                <div class="contact-info-row">
                    <i class="fas fa-clock contact-info-icon"></i>
                    <div><div class="contact-info-label">Dernière activité</div><div class="contact-info-value">${this.sanitize(presenceText)}</div></div>
                </div>
            </div>

            <!-- Médias partagés -->
            <div class="contact-info-section">
                <div style="padding:12px 0 4px;font-size:.72rem;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:.06em">
                    Médias partagés${sharedMedia.length > 0 ? ` · ${sharedMedia.length}` : ''}
                </div>
                ${mediaHtml}
            </div>

            <!-- Action suppression -->
            <div style="padding:12px 16px 16px">
                <button onclick="uiController.deleteContact('${this.sanitize(userId)}');closeModal('contact-info-modal')"
                    class="contact-info-danger-btn">
                    <i class="fas fa-user-times"></i> Supprimer ce contact
                </button>
            </div>

            <button onclick="closeModal('contact-info-modal')" style="position:absolute;top:12px;right:12px;background:rgba(255,255,255,.2);border:none;color:#fff;width:28px;height:28px;border-radius:50%;cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:.9rem">
                <i class="fas fa-times"></i>
            </button>
        </div>`;

        showModal('contact-info-modal');

        // Charger l'avatar si pas encore en cache
        if (!avatarUrl && contact.avatarMxc) {
            const b = await matrixManager.getAvatarBlobUrl(contact.avatarMxc);
            if (b) {
                this._avatarCache[userId] = b;
                const headerDiv = modal.querySelector('.contact-info-header div[style*="inline-block"]');
                if (headerDiv) {
                    const dot = headerDiv.querySelector('.contact-info-presence')?.cloneNode();
                    headerDiv.innerHTML = `<img src="${b}" style="width:96px;height:96px;border-radius:50%;object-fit:cover;display:block;margin:0 auto" alt="">`;
                    if (dot) headerDiv.appendChild(dot);
                }
            }
        }
    }

    startCallFromInfo(userId, withVideo) {
        const contact = this.contacts.find(c => c.userId === userId); if (!contact) return;
        this.currentContact = { roomId: contact.roomId, displayName: contact.displayName, userId, isGroup: false, isChannel: false };
        this.startCall(withVideo);
    }

    async explorePublicChannels() {
        let modal = document.getElementById('public-channels-modal');
        if (!modal) { this._createPublicChannelsModal(); modal = document.getElementById('public-channels-modal'); }
        showModal('public-channels-modal');
        const resultsContainer = document.getElementById('public-channels-results');
        if (!resultsContainer) return;
        resultsContainer.innerHTML = '<div style="text-align:center;padding:20px"><i class="fas fa-spinner fa-spin"></i> Chargement...</div>';
        const query = document.getElementById('public-channels-search')?.value || '';
        const channels = await matrixManager.searchPublicChannels(query);
        if (!channels.length) { resultsContainer.innerHTML = '<div class="empty-state"><p>Aucun salon public trouvé</p></div>'; return; }
        let html = '';
        channels.forEach(room => {
            const name = this.sanitize(room.name || 'Sans nom');
            const topic = this.sanitize(room.topic || '');
            const memberCount = room.num_joined_members || 0;
            const roomId = room.room_id;
            html += `<div class="public-channel-item"><div class="channel-info"><span class="channel-name">${name}</span>${topic ? `<span class="channel-topic">${topic}</span>` : ''}<span style="font-size:.75rem;color:var(--text-muted)"><i class="fas fa-user"></i> ${memberCount}</span></div><button class="btn-secondary" onclick="uiController.joinPublicChannel('${this.sanitize(roomId)}')">Rejoindre</button></div>`;
        });
        resultsContainer.innerHTML = html;
    }

    async joinPublicChannel(roomId) {
        showToast('Connexion au salon...', 'info');
        const success = await matrixManager.joinChannel(roomId);
        if (success) { showToast('Salon rejoint !', 'success'); closeModal('public-channels-modal'); matrixManager.loadRooms(); }
        else showToast('Impossible de rejoindre', 'error');
    }

    _createPublicChannelsModal() {
        const modal = document.createElement('div'); modal.id = 'public-channels-modal'; modal.className = 'modal';
        modal.innerHTML = `<div class="modal-content" style="max-width:600px"><div class="modal-header"><h3><i class="fas fa-hashtag"></i> Explorer les salons publics</h3><button class="close-btn" onclick="closeModal('public-channels-modal')"><i class="fas fa-times"></i></button></div><div class="modal-body"><div class="search-bar" style="margin-bottom:16px"><i class="fas fa-search"></i><input type="text" id="public-channels-search" placeholder="Rechercher un salon..." oninput="uiController.explorePublicChannels()"></div><div id="public-channels-results" class="public-channels-results"></div></div></div>`;
        document.body.appendChild(modal);
    }

    async createGroup() {
        const name = document.getElementById('group-name')?.value.trim();
        if (!name) { showToast('Nom du groupe requis', 'error'); return; }
        const memberInputs = document.getElementById('group-members')?.value.trim() || '';
        const members = memberInputs ? memberInputs.split(',').map(m => toMatrixId(m.trim())).filter(m => validateMatrixId(m)) : [];
        const btn = document.querySelector('#create-group-modal .btn-primary');
        if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Création...'; }
        try {
            const roomId = await matrixManager.createGroup(name, members);
            if (roomId) {
                showToast(`Groupe "${name}" créé !`, 'success'); closeModal('create-group-modal');
                document.getElementById('group-name').value = '';
                document.getElementById('group-members').value = '';
                matrixManager.loadRooms();
            } else showToast('Erreur lors de la création du groupe', 'error');
        } catch(e) { showToast('Erreur: ' + (e.message || ''), 'error'); }
        finally { if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-plus"></i> Créer le groupe'; } }
    }

    // ═══════════════ APPELS ═══════════════
    async startCall(withVideo) {
        if (!this.currentContact) return;
        document.getElementById('app-screen')?.classList.remove('active');
        const cs = document.getElementById('call-screen');
        if (cs) { cs.classList.add('active'); cs.classList.toggle('video-call', withVideo); cs.classList.toggle('audio-call', !withVideo); }
        const nameEl = document.getElementById('call-contact-name'); if (nameEl) nameEl.textContent = this.currentContact.displayName;
        const st = document.getElementById('call-status'); if (st) st.textContent = withVideo ? 'Appel vidéo...' : 'Appel audio...';
        const camBtn = document.getElementById('toggle-camera-btn');
        if (camBtn) { camBtn.classList.toggle('active', !withVideo); camBtn.querySelector('i').className = withVideo ? 'fas fa-video' : 'fas fa-video-slash'; }
        if (this.currentContact.isGroup) {
            if (!await webrtcManager.startGroupCall(this.currentContact.roomId, withVideo)) { this.endCall(); showToast('Erreur appel de groupe', 'error'); }
        } else {
            if (!await webrtcManager.startCall(this.currentContact.roomId, withVideo)) { this.endCall(); showToast('Erreur démarrage appel', 'error'); }
        }
    }

    showIncomingCall(data) {
        this.incomingCallData = data;
        const modal = document.getElementById('incoming-call-modal');
        const caller = this.contacts.find(c => c.userId === data.caller);
        const nameEl = document.getElementById('incoming-caller-name'); if (nameEl) nameEl.textContent = caller ? caller.displayName : (data.callerName || data.caller);
        const typeEl = document.getElementById('incoming-call-type'); if (typeEl) typeEl.textContent = data.isVideoCall ? 'Appel vidéo entrant...' : 'Appel audio entrant...';
        if (modal) { modal.classList.add('show'); modal.classList.add('active'); }
    }

    async acceptIncomingCall() {
        const modal = document.getElementById('incoming-call-modal');
        if (modal) { modal.classList.remove('show'); modal.classList.remove('active'); }
        matrixManager._stopRinging?.();
        if (!this.incomingCallData) return;
        this.currentContact = this.contacts.find(c => c.userId === this.incomingCallData.caller)
            || { roomId: this.incomingCallData.roomId, displayName: this.incomingCallData.callerName || this.incomingCallData.caller, userId: this.incomingCallData.caller };
        const isV = this.incomingCallData.isVideoCall;
        document.getElementById('app-screen')?.classList.remove('active');
        const cs = document.getElementById('call-screen');
        if (cs) { cs.classList.add('active'); cs.classList.toggle('video-call', isV); cs.classList.toggle('audio-call', !isV); }
        const nameEl = document.getElementById('call-contact-name'); if (nameEl) nameEl.textContent = this.currentContact.displayName;
        const callData = this.incomingCallData;
        this.incomingCallData = null;
        const success = await webrtcManager.answerCall(callData.roomId, callData.callId, callData.offer, isV);
        if (!success) { this.endCall(); showToast("Impossible de répondre à l'appel", 'error'); }
    }

    declineIncomingCall() {
        matrixManager._stopRinging?.();
        if (this.incomingCallData) {
            const cl = matrixManager.getClient();
            if (cl) cl.sendEvent(this.incomingCallData.roomId, 'm.call.hangup', { call_id: this.incomingCallData.callId, version: 1, reason: 'user_busy' }).catch(() => {});
            matrixManager.clearCallActive();
        }
        const modal = document.getElementById('incoming-call-modal');
        if (modal) { modal.classList.remove('show'); modal.classList.remove('active'); }
        this.incomingCallData = null;
    }

    endCall() {
        if (typeof webrtcManager !== 'undefined') webrtcManager.hangup?.();
        matrixManager._stopRinging?.();
        matrixManager.clearCallActive();
        document.getElementById('call-screen')?.classList.remove('active');
        document.getElementById('app-screen')?.classList.add('active');
        document.getElementById('in-call-chat-panel')?.classList.remove('show');
    }

    toggleInCallChat() {
        const p = document.getElementById('in-call-chat-panel'); if (!p) return;
        p.classList.toggle('show');
        if (p.classList.contains('show') && this.currentContact) { this.renderInCallMessages(); document.getElementById('in-call-chat-input')?.focus(); }
    }

    // ═══════════════ CHAT EN APPEL ═══════════════
    renderInCallMessages() {
        if (!this.currentContact) return;
        const c = document.getElementById('in-call-chat-messages'); if (!c) return;
        const msgs = (this.chatMessages[this.currentContact.roomId] || []).slice(-60);
        if (!msgs.length) {
            c.innerHTML = `<div style="text-align:center;color:rgba(255,255,255,.4);padding:30px;font-size:.82rem"><i class="fas fa-lock" style="font-size:1.5rem;color:#25D366;margin-bottom:8px;display:block"></i>Les messages sont chiffrés</div>`;
            return;
        }
        let html = '', lastDate = '';
        msgs.forEach((m, i) => {
            const d  = new Date(m.timestamp);
            const ds = d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' });
            if (ds !== lastDate) { html += `<div class="icm-date-sep"><span>${ds}</span></div>`; lastDate = ds; }
            const t   = d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
            const cls = m.isOwn ? 'own' : 'other';
            const ticks = m.isOwn ? '<span class="icm-ticks"><i class="fas fa-check-double"></i></span>' : '';
            const isGroup = this.currentContact?.isGroup || this.currentContact?.isChannel;
            let senderHtml = '';
            if (!m.isOwn && isGroup) {
                const senderName = this._resolveDisplayName(m.senderId || m.sender || '');
                const color = this._getSenderColor(m.senderId || m.sender || '');
                senderHtml = `<span class="icm-sender" style="color:${color}">${this.sanitize(senderName)}</span>`;
            }
            const content = this._renderInCallContent(m, i);
            html += `<div class="icm-msg ${cls}"><div class="icm-bubble">${senderHtml}${content}<div class="icm-footer"><span class="icm-time">${t}</span>${ticks}</div></div></div>`;
        });
        c.innerHTML = html; c.scrollTop = c.scrollHeight;
    }

    _resolveDisplayName(userId) {
        if (!userId) return 'Inconnu';
        try {
            const cl = matrixManager.getClient();
            if (cl && this.currentContact?.roomId) {
                const room = cl.getRoom(this.currentContact.roomId);
                const member = room?.getMember(userId);
                if (member?.name) return member.name;
            }
        } catch(e) {}
        const match = userId.match(/^@?([^:]+)/);
        return match ? match[1] : userId;
    }

    _renderInCallContent(msg, i) {
        if (msg.type === 'text') return `<div class="icm-text">${this.sanitize(msg.message || '')}</div>`;
        if (msg.type === 'image' && msg.mxcUrl) {
            const thumbUrl = matrixManager.mxcToThumbnailUrl?.(msg.mxcUrl, 200, 150) || '';
            return `<div class="icm-image"><img src="${thumbUrl}" loading="lazy" alt="Image" onclick="uiController.showImageFullscreen('${this.sanitize(msg.mxcUrl)}')" onerror="this.style.display='none'"></div>`;
        }
        if (msg.type === 'voice' && msg.mxcUrl) {
            const dur = this._fmtDurMs(msg.audioDuration || 0);
            if (!this._waveformData['icm_' + i]) this._waveformData['icm_' + i] = typeof generateWaveformBars === 'function' ? generateWaveformBars(20) : Array(20).fill(0).map(() => Math.floor(Math.random() * 14) + 4);
            const wfHtml = this._waveformData['icm_' + i].map(h => `<div class="wf-bar" style="height:${h}px"></div>`).join('');
            return `<div class="voice-message" data-voice-id="icm_${i}"><button class="voice-play-btn" onclick="uiController.playVoiceMessage('${this.sanitize(msg.mxcUrl)}','icm_${i}')"><i class="fas fa-play"></i></button><div class="voice-track"><div class="voice-waveform">${wfHtml}</div></div><span class="voice-duration">${dur}</span></div>`;
        }
        if ((msg.type === 'file' || msg.type === 'video') && msg.mxcUrl) {
            const iconClass = msg.type === 'video' ? 'fa-film' : (typeof getFileIcon === 'function' ? getFileIcon(msg.mimetype) : 'fa-file');
            const sizeStr   = msg.fileInfo?.size ? (typeof formatFileSize === 'function' ? formatFileSize(msg.fileInfo.size) : '') : '';
            const fname     = msg.filename || msg.message || 'Fichier';
            return `<div class="icm-file-msg" onclick="uiController.downloadFile('${this.sanitize(msg.mxcUrl)}','${this.sanitize(fname)}')"><div class="icm-file-icon"><i class="fas ${iconClass}"></i></div><div class="icm-file-info"><span class="icm-file-name">${this.sanitize(fname)}</span>${sizeStr ? `<span class="icm-file-size">${sizeStr}</span>` : ''}</div><i class="fas fa-download" style="color:rgba(255,255,255,.4);font-size:.8rem;flex-shrink:0"></i></div>`;
        }
        if (msg.type === 'location') {
            const coords = (msg.geoUri || '').replace('geo:', '').split(',');
            const lat = coords[0] || '0', lng = coords[1] || '0';
            return `<div class="icm-file-msg" onclick="window.open('https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=16/${lat}/${lng}','_blank')"><div class="icm-file-icon" style="background:#e74c3c"><i class="fas fa-map-marker-alt"></i></div><div class="icm-file-info"><span class="icm-file-name">Position partagée</span><span class="icm-file-size">${parseFloat(lat).toFixed(4)}, ${parseFloat(lng).toFixed(4)}</span></div></div>`;
        }
        return `<div class="icm-text">${this.sanitize(msg.message || '')}</div>`;
    }

    async sendInCallChatMessage() {
        const i = document.getElementById('in-call-chat-input'); if (!i || !this.currentContact) return;
        const m = i.value.trim(); if (!m) return; i.value = '';
        await matrixManager.sendMessage(this.currentContact.roomId, m);
    }

    // ═══════════════ STATUTS ═══════════════
    async loadStatuses() {
        const container = document.getElementById('status-list'); if (!container) return;
        const myStatuses      = await matrixManager.getMyStatuses().catch(() => []);
        const contactStatuses = await matrixManager.getContactStatuses().catch(() => []);
        let html = `<div class="status-section"><div class="status-my-status" onclick="showStatusComposer()"><div class="status-avatar status-avatar-add"><i class="fas fa-plus"></i></div><div class="status-info"><div class="status-name">Mon statut</div><div class="status-time">${myStatuses.length > 0 ? 'Appuyez pour voir' : 'Appuyez pour ajouter'}</div></div></div></div>`;
        if (contactStatuses.length > 0) {
            html += '<div class="status-section"><div class="status-section-title">Mises à jour récentes</div>';
            for (const cs of contactStatuses) {
                const ago = this._timeAgo(cs.status.timestamp);
                html += `<div class="status-contact-item" onclick="uiController.viewStatus('${this.sanitize(cs.userId)}')"><div class="status-avatar status-avatar-ring"><span class="avatar-initial">${(cs.displayName || '?')[0].toUpperCase()}</span></div><div class="status-info"><div class="status-name">${this.sanitize(cs.displayName)}</div><div class="status-time">${ago}</div></div></div>`;
            }
            html += '</div>';
        } else html += '<div class="status-empty"><i class="fas fa-circle-notch"></i><p>Aucun statut récent</p></div>';
        container.innerHTML = html;
    }

    _timeAgo(ts) { const d = Date.now() - ts, m = Math.floor(d / 60000); if (m < 1) return 'À l\'instant'; if (m < 60) return `Il y a ${m} min`; const h = Math.floor(m / 60); if (h < 24) return `Il y a ${h}h`; return 'Hier'; }
    showStatusComposer() { showModal('status-composer-modal'); document.getElementById('status-text-input')?.focus(); }
    closeStatusComposer() { closeModal('status-composer-modal'); }

    async postTextStatus() {
        const input = document.getElementById('status-text-input'); const text = input?.value.trim();
        if (!text) { showToast('Écrivez un statut', 'error'); return; }
        const ac = document.querySelector('.status-color-btn.active'); const bgColor = ac?.dataset.color || '#25D366';
        showToast('Publication...', 'info');
        if (await matrixManager.postStatus({ type: 'text', text, backgroundColor: bgColor })) {
            showToast('Statut publié !', 'success'); if (input) input.value = '';
            this.closeStatusComposer(); this.loadStatuses();
        } else showToast('Erreur de publication', 'error');
    }

    async postImageStatus() {
        const fi = document.createElement('input'); fi.type = 'file'; fi.accept = 'image/*';
        fi.onchange = async (e) => {
            const file = e.target.files[0]; if (!file) return;
            showToast('Envoi...', 'info');
            const mxcUrl = await matrixManager.uploadStatusImage(file);
            if (!mxcUrl) { showToast('Erreur upload', 'error'); return; }
            const caption = document.getElementById('status-text-input')?.value.trim() || '';
            if (await matrixManager.postStatus({ type: 'image', text: caption, mxcUrl })) {
                showToast('Statut publié !', 'success'); this.closeStatusComposer(); this.loadStatuses();
            } else showToast('Erreur', 'error');
        };
        fi.click();
    }

    async viewStatus(userId) {
        const statuses = await matrixManager.getContactStatuses().catch(() => []);
        const cs = statuses.find(s => s.userId === userId); if (!cs?.allStatuses?.length) return;
        const status = cs.allStatuses[0];
        const viewer = document.getElementById('status-viewer-modal'); if (!viewer) return;
        let contentHtml = status.type === 'image' && status.imageUrl
            ? `<div class="status-viewer-image" style="background-image:url('${status.imageUrl}')"></div>${status.text ? `<div class="status-viewer-caption">${this.sanitize(status.text)}</div>` : ''}`
            : `<div class="status-viewer-text" style="background:${status.backgroundColor || '#25D366'}"><p>${this.sanitize(status.text)}</p></div>`;
        viewer.innerHTML = `<div class="status-viewer-content"><div class="status-viewer-header"><button class="icon-btn" onclick="closeModal('status-viewer-modal')"><i class="fas fa-arrow-left"></i></button><div class="status-viewer-info"><strong>${this.sanitize(cs.displayName)}</strong><span>${this._timeAgo(status.timestamp)}</span></div></div><div class="status-viewer-body">${contentHtml}</div></div>`;
        showModal('status-viewer-modal');
        setTimeout(() => closeModal('status-viewer-modal'), 5000);
    }

    // ═══════════════ CHAT ═══════════════
    async loadChatHistory() {
        if (!this.currentContact) return;
        const msgs = await matrixManager.getMessages(this.currentContact.roomId);
        this.chatMessages[this.currentContact.roomId] = msgs;

        // Charger les receipts existants
        const receipts = matrixManager.getRoomReadReceipts(this.currentContact.roomId);
        if (Object.keys(receipts).length > 0) {
            if (!this._readReceipts[this.currentContact.roomId]) {
                this._readReceipts[this.currentContact.roomId] = {};
            }
            Object.entries(receipts).forEach(([eventId, userIds]) => {
                if (!this._readReceipts[this.currentContact.roomId][eventId]) {
                    this._readReceipts[this.currentContact.roomId][eventId] = new Set();
                }
                userIds.forEach(uid => this._readReceipts[this.currentContact.roomId][eventId].add(uid));
            });

            // Propagation WhatsApp : tous les messages before le dernier receipt sont aussi lus
            const sortedMsgs = [...msgs].sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
            const receiptEventIds = Object.keys(receipts);
            let latestReadTs = 0;
            for (const eventId of receiptEventIds) {
                const msgWithId = sortedMsgs.find(m => m.eventId === eventId);
                if (msgWithId && (msgWithId.timestamp || 0) > latestReadTs) latestReadTs = msgWithId.timestamp || 0;
            }
            if (latestReadTs > 0) {
                for (const msg of sortedMsgs) {
                    if (msg.isOwn && (msg.timestamp || 0) <= latestReadTs && this._isRealEventId(msg.eventId)) {
                        const rid = this.currentContact.roomId;
                        if (!this._readReceipts[rid][msg.eventId]) {
                            this._readReceipts[rid][msg.eventId] = new Set(['__propagated__']);
                        }
                    }
                }
            }
        }

        // ✅ FIX v15.8 : Envoyer le read receipt pour les messages non lus à l'ouverture du chat
        // Trouver le dernier message non-propre et envoyer le receipt
        const allMsgs = msgs;
        let lastIncomingEventId = null;
        for (let i = allMsgs.length - 1; i >= 0; i--) {
            const m = allMsgs[i];
            if (!m.isOwn && this._isRealEventId(m.eventId)) {
                lastIncomingEventId = m.eventId;
                break;
            }
        }
        if (lastIncomingEventId) {
            matrixManager.sendReadReceipt(this.currentContact.roomId, lastIncomingEventId).catch(() => {});
        }

        this.renderChatMessages();
    }

    renderChatMessages() {
        const cc = document.getElementById('chat-messages'); if (!cc || !this.currentContact) return;
        const msgs   = this.chatMessages[this.currentContact.roomId] || [];
        const pinned = matrixManager.getPinnedMessages(this.currentContact.roomId);
        const isGroup = this.currentContact?.isGroup || this.currentContact?.isChannel;

        if (!msgs.length) { cc.innerHTML = '<div class="empty-chat"><i class="fas fa-comments"></i><p>Aucun message</p><span>Envoyez un message pour démarrer</span></div>'; return; }
        let html = '', lastDateStr = '';
        msgs.forEach((msg, i) => {
            const dateStr = formatDateGroup(msg.timestamp);
            if (dateStr !== lastDateStr) { html += `<div class="date-separator"><span>${dateStr}</span></div>`; lastDateStr = dateStr; }
            const t   = formatTime(msg.timestamp);
            const o   = msg.isOwn ? 'own' : '';
            const id  = msg.eventId || 'msg_' + msg.timestamp + '_' + i;
            const isPinned = pinned.includes(msg.eventId);
            const editBadge = msg.edited ? ' <span class="edited-badge">modifié</span>' : '';
            const ephemeralBadge = msg.ephemeral ? '<span class="ephemeral-badge"><i class="fas fa-clock"></i></span>' : '';

            let senderHtml = '';
            if (!msg.isOwn && isGroup) {
                const senderId   = msg.senderId || msg.sender || '';
                const senderName = this._resolveDisplayName(senderId);
                const color      = this._getSenderColor(senderId);
                senderHtml = `<div class="msg-sender-name" style="color:${color};font-size:.72rem;font-weight:600;margin-bottom:2px">${this.sanitize(senderName)}</div>`;
            }

            let replyH = '';
            if (msg.isReply && msg.replyToEventId) {
                const orig = msgs.find(m => m.eventId === msg.replyToEventId);
                if (orig) {
                    const origName = orig.isOwn ? 'Vous' : this._resolveDisplayName(orig.senderId || orig.sender || '');
                    let origPreview = orig.type === 'text' ? this.sanitize((orig.message || '').substring(0, 60)) : orig.type === 'voice' ? '🎙️ Vocal' : orig.type === 'image' ? '📷 Photo' : orig.type === 'location' ? '📍 Position' : '📎 Fichier';
                    replyH = `<div class="wa-reply-bubble"><div class="wa-reply-name">${this.sanitize(origName)}</div><div class="wa-reply-text">${origPreview}</div></div>`;
                }
            }

            // ✅ Fix 1 : Ticks WhatsApp 3 états
            let ticks = '';
            if (msg.isOwn) {
                const hasRealId = this._isRealEventId(msg.eventId);
                const isRead    = hasRealId && this._isMessageRead(this.currentContact.roomId, msg.eventId);
                if (!hasRealId) {
                    ticks = `<span class="msg-ticks sending" title="Envoi..."><i class="fas fa-check" style="color:#8696A0;font-size:.7rem"></i></span>`;
                } else if (isRead) {
                    ticks = `<span class="msg-ticks read" title="Lu"><i class="fas fa-check-double"></i></span>`;
                } else {
                    ticks = `<span class="msg-ticks delivered" title="Envoyé"><i class="fas fa-check-double"></i></span>`;
                }
            }

            const pinIcon = isPinned ? '<i class="fas fa-thumbtack pin-icon"></i>' : '';
            const ctxData = JSON.stringify({ eventId: msg.eventId, type: msg.type, message: msg.message, isOwn: msg.isOwn, sender: msg.sender, mxcUrl: msg.mxcUrl, audioDuration: msg.audioDuration }).replace(/"/g, '&quot;');
            html += `<div class="chat-message ${o}" data-msg-id="${id}" data-event-id="${msg.eventId || ''}" oncontextmenu="uiController.showMessageContextMenu(event,${ctxData})"><div class="msg-bubble">${pinIcon}${senderHtml}${replyH}<div class="msg-body">${this._renderContent(msg, i)}</div><div class="msg-footer">${ephemeralBadge}${editBadge}<span class="msg-time">${t}</span>${ticks}</div></div></div>`;
        });
        cc.innerHTML = html; cc.scrollTop = cc.scrollHeight;
    }

    _renderContent(msg, i) {
        if (msg.isViewOnce) {
            const opened = this._viewOnceOpened?.[msg.eventId];
            if (!opened) {
                const icon = msg.type === 'image' ? 'fa-image' : msg.type === 'video' ? 'fa-film' : 'fa-eye';
                return `<div class="view-once-badge" onclick="uiController._openViewOnce('${msg.eventId}','${msg.type || 'image'}','${this.sanitize(msg.mxcUrl || '')}')">
                    <i class="fas ${icon}"></i> Photo à voir une fois — Ouvrir
                </div>`;
            }
        }
        if (msg.type === 'text') return this.sanitize(msg.message);
        if (msg.type === 'voice' && msg.mxcUrl) {
            const vid = 'voice_' + msg.timestamp + '_' + i;
            const dur = this._fmtDurMs(msg.audioDuration || 0);
            if (!this._waveformData[vid]) this._waveformData[vid] = generateWaveformBars(CONFIG.WAVEFORM_BARS || 35);
            const wfHTML = this._waveformData[vid].map((h, idx) => `<div class="wf-bar" data-idx="${idx}" style="height:${h}px"></div>`).join('');
            return `<div class="voice-message" data-voice-id="${vid}"><button class="voice-play-btn" onclick="uiController.playVoiceMessage('${this.sanitize(msg.mxcUrl)}','${vid}')"><i class="fas fa-play"></i></button><div class="voice-track"><div class="voice-waveform">${wfHTML}</div></div><span class="voice-duration">${dur}</span></div>`;
        }
        if (msg.type === 'audio' && msg.mxcUrl) {
            return `<div class="audio-message"><audio controls preload="none" style="width:100%;height:40px"><source src="${matrixManager.mxcToHttpUrl(msg.mxcUrl)}" type="${msg.mimetype || 'audio/mpeg'}">Non supporté.</audio></div>`;
        }
        if (msg.type === 'image' && msg.mxcUrl) return `<div class="image-message"><img src="${matrixManager.mxcToThumbnailUrl(msg.mxcUrl)}" class="chat-image" onclick="uiController.showImageFullscreen('${this.sanitize(msg.mxcUrl)}')"></div>`;
        if (msg.type === 'video' && msg.mxcUrl) return `<div class="video-message" onclick="uiController.downloadFile('${this.sanitize(msg.mxcUrl)}','${this.sanitize(msg.message)}')"><div class="video-placeholder"><i class="fas fa-film"></i></div><div class="video-play-overlay"><i class="fas fa-play-circle"></i></div></div>`;
        if (msg.type === 'file' && msg.mxcUrl) return `<div class="file-message" onclick="uiController.downloadFile('${this.sanitize(msg.mxcUrl)}','${this.sanitize(msg.filename || msg.message)}')"><div class="file-icon"><i class="fas ${getFileIcon(msg.mimetype)}"></i></div><div class="file-details"><span class="file-name">${this.sanitize(msg.filename || msg.message)}</span><span class="file-size">${formatFileSize(msg.fileInfo?.size || 0)}</span></div><i class="fas fa-download file-dl-icon"></i></div>`;
        if (msg.type === 'location') {
            const geoUri = msg.geoUri || ''; const coords = geoUri.replace('geo:', '').split(',');
            const lat = coords[0] || 0, lng = coords[1] || 0;
            const mapId = 'locmap_' + msg.timestamp + '_' + i;
            setTimeout(() => {
                const el = document.getElementById(mapId);
                if (el && typeof L !== 'undefined') {
                    try { const m = L.map(mapId, { zoomControl: false, attributionControl: false, dragging: false, scrollWheelZoom: false }).setView([parseFloat(lat), parseFloat(lng)], 15); L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 18 }).addTo(m); L.marker([parseFloat(lat), parseFloat(lng)]).addTo(m); setTimeout(() => m.invalidateSize(), 100); } catch(e) {}
                }
            }, 200);
            return `<div class="location-message" onclick="window.open('https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=16/${lat}/${lng}','_blank')"><div id="${mapId}" style="height:150px;border-radius:8px 8px 0 0;background:var(--bg-tertiary)"><div style="display:flex;align-items:center;justify-content:center;height:100%"><i class="fas fa-map-marker-alt" style="font-size:2rem;color:var(--sn-green,#00853F)"></i></div></div><div class="location-info"><span class="location-coords">📍 ${parseFloat(lat).toFixed(4)}, ${parseFloat(lng).toFixed(4)}</span><span class="location-action">Ouvrir la carte <i class="fas fa-external-link-alt"></i></span></div></div>`;
        }
        return this.sanitize(msg.message || '');
    }

    async sendChatMessage() {
        const inp = document.getElementById('chat-input'); if (!inp || !this.currentContact) return;
        const msg = inp.value.trim(); if (!msg) return; inp.value = '';
        matrixManager.sendTyping(this.currentContact.roomId, false);
        if (this._editingMessage) {
            await matrixManager.editMessage(this.currentContact.roomId, this._editingMessage.eventId, this._editingMessage.message, msg);
            const ms = this.chatMessages[this.currentContact.roomId];
            const m = ms?.find(x => x.eventId === this._editingMessage.eventId);
            if (m) { m.message = msg; m.edited = true; }
            this.renderChatMessages(); this.cancelReply(); return;
        }
        if (this._replyingTo) { await matrixManager.replyToMessage(this.currentContact.roomId, this._replyingTo, msg); this.cancelReply(); return; }
        if (this._ephemeralDuration > 0) { await matrixManager.sendEphemeralMessage(this.currentContact.roomId, msg, this._ephemeralDuration); return; }

        // Ajout optimiste : message visible immédiatement avec tick simple
        const tempId  = '~pending_' + Date.now();
        const tempMsg = { eventId: tempId, type: 'text', message: msg, isOwn: true, timestamp: Date.now(), sender: matrixManager.getUserId() };
        const rid = this.currentContact.roomId;
        if (!this.chatMessages[rid]) this.chatMessages[rid] = [];
        this.chatMessages[rid].push(tempMsg);
        this.renderChatMessages();

        await matrixManager.sendMessage(rid, msg);
    }

    _isRealEventId(id) { return !!id && typeof id === 'string' && !id.startsWith('~') && id.length > 10; }

    // ✅ Fix 3 : handleIncomingMessage avec toast WhatsApp riche
    handleIncomingMessage(data) {
        const rid = data.roomId;
        if (!this.chatMessages[rid]) this.chatMessages[rid] = [];
        if (!this._seenEventIds[rid]) this._seenEventIds[rid] = new Set();
        const msgs = this.chatMessages[rid];
        data.timestamp = data.timestamp || Date.now();
        const hasRealId = this._isRealEventId(data.eventId);

        if (hasRealId) {
            if (this._seenEventIds[rid].has(data.eventId)) {
                const idx = msgs.findIndex(m => m.eventId === data.eventId);
                if (idx !== -1) { msgs[idx] = { ...msgs[idx], ...data }; if (this.currentContact?.roomId === rid) this.renderChatMessages(); }
                return;
            }
            this._seenEventIds[rid].add(data.eventId);
            if (data.isOwn) {
                const echoIdx = msgs.findIndex(m => {
                    if (!m.isOwn || m.type !== data.type) return false;
                    if (this._isRealEventId(m.eventId)) return false;
                    if (Math.abs((m.timestamp || 0) - data.timestamp) > 60000) return false;
                    if (data.type === 'text') return (m.message || '').trim() === (data.message || '').trim();
                    if (['image', 'voice', 'video', 'file'].includes(data.type)) return m.mxcUrl && data.mxcUrl && m.mxcUrl === data.mxcUrl;
                    return (m.message || '') === (data.message || '');
                });
                if (echoIdx !== -1) { msgs[echoIdx] = data; msgs.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0)); this._afterMessageAdd(rid, data, false); return; }
            }
            msgs.push(data); msgs.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
            this._afterMessageAdd(rid, data, true); return;
        }
        if (data.isOwn) {
            const isDup = msgs.some(m => {
                if (!m.isOwn || m.type !== data.type) return false;
                if (Math.abs((m.timestamp || 0) - data.timestamp) > 60000) return false;
                if (data.type === 'text') return (m.message || '').trim() === (data.message || '').trim();
                if (['image', 'voice', 'video', 'file'].includes(data.type)) return m.mxcUrl && data.mxcUrl && m.mxcUrl === data.mxcUrl;
                return false;
            });
            if (isDup) return;
        } else {
            const isDup = msgs.some(m => m.sender === data.sender && m.type === data.type && Math.abs((m.timestamp || 0) - data.timestamp) < 5000 && (data.type === 'text' ? (m.message || '') === (data.message || '') : m.mxcUrl === data.mxcUrl));
            if (isDup) return;
        }
        msgs.push(data); msgs.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
        this._afterMessageAdd(rid, data, true);
    }

    _afterMessageAdd(rid, data, isNew) {
        if (isNew && data.ephemeral?.expires_at) {
            const ttl = data.ephemeral.expires_at - Date.now();
            if (ttl > 0) setTimeout(() => {
                if (!this.chatMessages[rid]) return;
                const idx = this.chatMessages[rid].findIndex(m => m.eventId === data.eventId);
                if (idx !== -1) { this.chatMessages[rid].splice(idx, 1); if (this.currentContact?.roomId === rid) this.renderChatMessages(); }
            }, ttl);
        }
        if (this.currentContact?.roomId === rid) {
            this.renderChatMessages();
            if (document.getElementById('in-call-chat-panel')?.classList.contains('show')) this.renderInCallMessages();
            if (!data.isOwn && data.eventId) matrixManager.sendReadReceipt(rid, data.eventId);
        }
        if (typeof webrtcManager !== 'undefined' && webrtcManager.currentCall?.roomId === rid) {
            const lkPanel = document.getElementById('lk-chat-panel');
            if (lkPanel?.classList.contains('show')) setTimeout(() => webrtcManager.renderGroupCallMessages(), 200);
        }
        // ✅ Fix 3 : Toast WhatsApp riche + son + notification browser pour les messages entrants
        if (isNew && !data.isOwn) {
            const ct = this.contacts.find(c => c.roomId === rid)
                    || this.groups.find(g => g.roomId === rid)
                    || this.channels.find(c => c.roomId === rid);

            if (ct) {
                // ── Aperçu du contenu pour la notification ──
                let preview = (data.message || '').substring(0, 60);
                if (data.type === 'image')    preview = '📷 Photo';
                else if (data.type === 'video')   preview = '🎬 Vidéo';
                else if (data.type === 'voice')   preview = '🎙️ Message vocal';
                else if (data.type === 'audio')   preview = '🔊 Audio';
                else if (data.type === 'file')    preview = `📎 ${data.filename || 'Fichier'}`;
                else if (data.type === 'location') preview = '📍 Position partagée';

                // ── Son de notification (toujours, sauf si on est sur ce chat actif) ──
                if (this.currentContact?.roomId !== rid) {
                    if (typeof soundManager !== 'undefined') soundManager.playMessageSound?.();
                }

                // ── Toast WhatsApp (uniquement si chat pas ouvert) ──
                if (this.currentContact?.roomId !== rid) {
                    this._showWAToast({
                        displayName: ct.displayName,
                        userId: ct.userId || '',
                        roomId: rid,
                        type: data.type,
                        message: data.message,
                        mxcUrl: data.mxcUrl,
                        filename: data.filename
                    });
                }

                // ── Notification browser (si onglet en arrière-plan) ──
                if (document.hidden && 'Notification' in window && Notification.permission === 'granted') {
                    try {
                        const notif = new Notification(ct.displayName, {
                            body: preview,
                            icon: '/favicon.ico',
                            tag: `msg-${rid}`,       // regrouper par room
                            renotify: true,
                            silent: false
                        });
                        notif.onclick = () => {
                            window.focus();
                            notif.close();
                            if (ct.userId) this.selectContact(ct.userId);
                            else if (ct.roomId) this.selectGroup?.(ct.roomId);
                        };
                    } catch(e) {}
                }
                // ── Demander la permission si pas encore accordée ──
                else if ('Notification' in window && Notification.permission === 'default') {
                    Notification.requestPermission().catch(() => {});
                }
            }
        }
    }

    // ✅ Fix 4 : addNewContact — rechargement immédiat + mise à jour de la liste
    async addNewContact() {
        let uid = document.getElementById('new-contact-id')?.value.trim();
        const dn = document.getElementById('new-contact-name')?.value.trim() || uid;
        if (!uid) { showToast('Identifiant requis', 'error'); return; }
        uid = toMatrixId(uid);
        if (!validateMatrixId(uid)) { showToast('Format invalide', 'error'); return; }
        const btn = document.querySelector('#new-contact-modal .btn-primary');
        if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Ajout...'; }
        try {
            const rid = await matrixManager.getOrCreateRoomForUser(uid);
            closeModal('new-contact-modal');
            const idInp = document.getElementById('new-contact-id'); if (idInp) idInp.value = '';
            const nmInp = document.getElementById('new-contact-name'); if (nmInp) nmInp.value = '';
            const existingContact = this.contacts.find(c => c.userId === uid || c.roomId === rid);
            if (!existingContact) {
                this.contacts.push({ userId: uid, displayName: dn, roomId: rid, lastActive: Date.now() });
                this.renderContacts();
                showToast(`Contact "${dn}" ajouté !`, 'success');
                showToast(`Une invitation a été envoyée à ${uid}`, 'info');
            } else {
                showToast(`Contact "${existingContact.displayName}" déjà présent`, 'info');
            }
            setTimeout(() => matrixManager.loadRooms(), 1500);
            setTimeout(() => matrixManager.loadRooms(), 4000);
        } catch(e) {
            console.error('[addNewContact]', e);
            showToast('Erreur ajout contact: ' + (e.message || ''), 'error');
        } finally {
            if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-plus"></i> Ajouter'; }
        }
    }

    async deleteContact(u) {
        const c = this.contacts.find(x => x.userId === u);
        if (!c || !confirm('Supprimer ' + c.displayName + ' ?')) return;
        if (await matrixManager.leaveRoom(c.roomId)) {
            this.contacts = this.contacts.filter(x => x.userId !== u); this.renderContacts();
            if (this.currentContact?.userId === u) { this.currentContact = null; document.getElementById('contact-view')?.classList.add('hidden'); document.getElementById('welcome-screen')?.classList.remove('hidden'); }
            showToast('Supprimé', 'success');
        }
    }

    filterContacts(q) {
        const term = q.toLowerCase();
        const fg = (this.groups   || []).filter(g => g.displayName.toLowerCase().includes(term));
        const fc = (this.contacts || []).filter(c => c.displayName.toLowerCase().includes(term) || c.userId.toLowerCase().includes(term));
        const el = document.getElementById('contacts-list'); if (!el) return;
        if (!fg.length && !fc.length) { el.innerHTML = '<div class="empty-state"><p>Aucun résultat</p></div>'; return; }
        let html = '';
        fg.forEach(g => { html += `<div class="contact-item" onclick="uiController.selectGroup('${this.sanitize(g.roomId)}')"><div class="avatar" style="background:linear-gradient(135deg,#4facfe,#00f2fe)"><i class="fas fa-users"></i></div><div class="contact-details"><span class="contact-name">${this.sanitize(g.displayName)}</span></div></div>`; });
        fc.forEach(c => { html += `<div class="contact-item" onclick="uiController.selectContact('${this.sanitize(c.userId)}')"><div class="avatar"><span class="avatar-initial">${c.displayName.charAt(0).toUpperCase()}</span></div><div class="contact-details"><span class="contact-name">${this.sanitize(c.displayName)}</span></div></div>`; });
        el.innerHTML = html;
    }

    // ═══════════════ SETTINGS ═══════════════
    initSoundSettings() {
        const cs = document.getElementById('ringtone-call-select'), ms = document.getElementById('ringtone-msg-select'), vs = document.getElementById('sound-volume'), ec = document.getElementById('sounds-enabled');
        if (cs) { cs.innerHTML = CONFIG.RINGTONES.call_incoming.options.map(o => `<option value="${o.id}">${o.name}</option>`).join(''); cs.value = soundManager.settings.callRingtone || 'whatsapp'; cs.onchange = () => { soundManager.setCallRingtone(cs.value); soundManager.previewSound('call', cs.value); }; }
        if (ms) { ms.innerHTML = (CONFIG.RINGTONES.message?.options || [{ id: 'default', name: 'Par défaut' }]).map(o => `<option value="${o.id}">${o.name}</option>`).join(''); ms.value = soundManager.settings.messageSound || 'whatsapp_notif'; }
        if (vs) { vs.value = (soundManager.settings.volume || 0.9) * 100; vs.oninput = () => soundManager.setVolume(vs.value / 100); }
        if (ec) { ec.checked = soundManager.settings.enabled !== false; ec.onchange = () => soundManager.setEnabled(ec.checked); }
    }

    switchSettingsTab(tab) {
        document.querySelectorAll('.settings-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
        document.querySelectorAll('.settings-panel').forEach(p => p.classList.toggle('active', p.id === tab + '-panel'));
        if (tab === 'sounds') this.initSoundSettings();
    }

    // ✅ Fix 6 : Historique appels WhatsApp
    renderCallHistory() {
        const container = document.getElementById('call-history'); if (!container) return;
        let history = [];
        try { history = typeof callHistoryManager !== 'undefined' ? callHistoryManager.getHistory() : matrixManager.getCallHistory(); }
        catch(e) { history = matrixManager.getCallHistory(); }

        if (!history?.length) {
            container.innerHTML = `<div class="empty-state" style="padding:40px 20px;text-align:center">
                <i class="fas fa-phone-slash" style="font-size:2.5rem;color:var(--text-muted);margin-bottom:12px;display:block"></i>
                <p style="font-weight:600;margin-bottom:4px">Aucun appel récent</p>
                <span style="font-size:.82rem;color:var(--text-muted)">Vos appels apparaîtront ici</span>
            </div>`;
            return;
        }

        if (!document.getElementById('call-history-styles')) {
            const s = document.createElement('style'); s.id = 'call-history-styles';
            s.textContent = `
                .call-history-item { display:flex;align-items:center;gap:12px;padding:12px 16px;cursor:pointer;border-bottom:1px solid var(--border-color,rgba(255,255,255,.05));transition:background .15s; }
                .call-history-item:hover { background:var(--bg-secondary,rgba(255,255,255,.03)); }
                .call-history-avatar { width:48px;height:48px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:1.15rem;font-weight:700;color:#fff;flex-shrink:0; }
                .call-history-info { flex:1;min-width:0; }
                .call-history-name { font-size:.9rem;font-weight:600;color:var(--text-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-bottom:3px; }
                .call-history-name.missed { color:#e74c3c; }
                .call-history-meta { display:flex;align-items:center;gap:5px;font-size:.75rem;color:var(--text-muted); }
                .call-history-meta i { font-size:.72rem; }
                .call-history-meta .missed { color:#e74c3c; }
                .call-history-meta .outgoing { color:#53bdeb; }
                .call-history-meta .incoming { color:var(--sn-green,#25D366); }
                .call-history-right { text-align:right;flex-shrink:0; }
                .call-history-time { font-size:.72rem;color:var(--text-muted);margin-bottom:4px; }
                .call-history-time.missed { color:#e74c3c; }
                .call-history-actions { display:flex;gap:4px;justify-content:flex-end;margin-top:4px; }
                .call-history-btn { width:32px;height:32px;border-radius:50%;border:none;background:rgba(37,211,102,.1);color:var(--sn-green,#25D366);cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:.8rem;transition:background .15s; }
                .call-history-btn:hover { background:rgba(37,211,102,.22); }
                .call-history-btn.video-btn { background:rgba(79,172,254,.1);color:#4facfe; }
                .call-history-count { display:inline-flex;align-items:center;justify-content:center;background:rgba(255,255,255,.12);color:var(--text-muted);border-radius:10px;padding:0 6px;font-size:.68rem;height:16px;margin-left:2px; }
            `;
            document.head.appendChild(s);
        }

        // Grouper appels consécutifs identiques
        const grouped = [];
        let current = null;
        for (const call of history) {
            const key = `${call.userId || ''}|${call.status}|${call.type}`;
            if (current && current._key === key && (call.timestamp - current._lastTs) < 3600000) {
                current.count++; current._lastTs = call.timestamp;
            } else {
                if (current) grouped.push(current);
                current = { ...call, count: 1, _key: key, _lastTs: call.timestamp };
            }
        }
        if (current) grouped.push(current);

        const now = Date.now();
        const _fmtCallTime = (ts) => {
            const diff = now - ts, s = Math.floor(diff / 1000);
            if (s < 60) return 'À l\'instant';
            const m = Math.floor(s / 60); if (m < 60) return `Il y a ${m} min`;
            const h = Math.floor(m / 60); if (h < 24) return `Il y a ${h}h`;
            const d = Math.floor(h / 24); if (d === 1) return 'Hier'; if (d < 7) return `Il y a ${d}j`;
            return new Date(ts).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
        };

        let html = '';
        grouped.forEach(call => {
            const isMissed = ['missed', 'no_answer', 'declined'].includes(call.status);
            const isOut    = call.direction === 'outgoing';
            const typeIcon = call.type === 'video' ? 'fa-video' : 'fa-phone';
            const name     = this.sanitize(call.displayName || call.userId || 'Inconnu');
            const initial  = (call.displayName || call.userId || '?').charAt(0).toUpperCase();
            const colors   = ['#25D366','#128C7E','#4facfe','#f093fb','#ffa726','#e74c3c'];
            const bgColor  = colors[(call.displayName || '').charCodeAt(0) % colors.length] || '#25D366';
            const timeStr  = _fmtCallTime(call.timestamp);
            const userId   = this.sanitize(call.userId || '');
            const countBadge = call.count > 1 ? `<span class="call-history-count">${call.count}</span>` : '';
            let dirIcon, dirClass, dirLabel;
            if (isMissed && !isOut) { dirIcon = 'fa-phone-missed'; dirClass = 'missed'; dirLabel = 'Appel manqué'; }
            else if (isMissed && isOut) { dirIcon = 'fa-phone-missed'; dirClass = 'missed'; dirLabel = 'Sans réponse'; }
            else if (isOut) { dirIcon = 'fa-arrow-up'; dirClass = 'outgoing'; dirLabel = 'Émis'; }
            else { dirIcon = 'fa-arrow-down'; dirClass = 'incoming'; dirLabel = 'Reçu'; }
            const durStr = call.duration ? ` · ${Math.floor(call.duration / 60)}:${String(call.duration % 60).padStart(2,'0')}` : '';

            html += `<div class="call-history-item" onclick="uiController._callHistoryItemClick('${userId}')">
                <div class="call-history-avatar" style="background:${bgColor}">${initial}</div>
                <div class="call-history-info">
                    <div class="call-history-name${isMissed ? ' missed' : ''}">${name}${countBadge}</div>
                    <div class="call-history-meta">
                        <i class="fas ${dirIcon} ${dirClass}"></i>
                        <i class="fas ${typeIcon}"></i>
                        <span class="${dirClass}">${dirLabel}${durStr}</span>
                    </div>
                </div>
                <div class="call-history-right">
                    <div class="call-history-time${isMissed ? ' missed' : ''}">${timeStr}</div>
                    <div class="call-history-actions">
                        <button class="call-history-btn" onclick="event.stopPropagation();uiController._callHistoryCall('${userId}',false)" title="Appel audio"><i class="fas fa-phone"></i></button>
                        <button class="call-history-btn video-btn" onclick="event.stopPropagation();uiController._callHistoryCall('${userId}',true)" title="Appel vidéo"><i class="fas fa-video"></i></button>
                    </div>
                </div>
            </div>`;
        });
        container.innerHTML = html;
    }

    _callHistoryItemClick(userId) {
        if (!userId) return;
        const contact = this.contacts.find(c => c.userId === userId);
        if (contact) {
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === 'chats'));
            document.querySelectorAll('.tab-content').forEach(p => p.classList.toggle('active', p.id === 'chats-tab'));
            this.selectContact(userId);
        }
    }

    _callHistoryCall(userId, withVideo) {
        if (!userId) return;
        const contact = this.contacts.find(c => c.userId === userId);
        if (!contact) { showToast('Contact introuvable', 'error'); return; }
        this.currentContact = { roomId: contact.roomId, displayName: contact.displayName, userId: contact.userId, isGroup: false, isChannel: false };
        this.startCall(withVideo);
    }

    renderNotifications() {
        const container = document.getElementById('notifications-list'); if (!container) return;
        const invitations = matrixManager.getInvitations?.() || [];
        let otherNotifs = [];
        try { otherNotifs = notificationsManager?.getNotifications?.() || []; } catch(e) {}
        if (!invitations.length && !otherNotifs.length) {
            container.innerHTML = '<div class="empty-state"><i class="fas fa-bell-slash"></i><p>Aucune notification</p></div>';
            return;
        }
        let html = '';
        invitations.forEach(inv => {
            const typeIcon  = inv.roomType === 'group' ? 'fa-users' : inv.roomType === 'channel' ? 'fa-hashtag' : 'fa-user';
            const typeLabel = inv.roomType === 'group' ? 'groupe' : inv.roomType === 'channel' ? 'salon' : 'conversation';
            html += `<div class="notification-item invitation-item" id="notif-invite-${inv.roomId}">
                <div class="notification-icon" style="background:rgba(0,133,63,0.15)"><i class="fas ${typeIcon}" style="color:#00853F"></i></div>
                <div class="notification-content">
                    <div class="notification-message"><strong>${this.sanitize(inv.invitedByName || inv.invitedBy)}</strong> vous invite au ${typeLabel} <strong>"${this.sanitize(inv.roomName)}"</strong></div>
                    <div class="notification-time">${formatTime(inv.timestamp)}</div>
                    <div style="display:flex;gap:8px;margin-top:8px">
                        <button class="btn-primary btn-sm" onclick="acceptInvitation('${inv.roomId}')" style="flex:1;padding:6px 12px;font-size:0.85em"><i class="fas fa-check"></i> Rejoindre</button>
                        <button class="btn-secondary btn-sm" onclick="declineInvitation('${inv.roomId}')" style="flex:1;padding:6px 12px;font-size:0.85em"><i class="fas fa-times"></i> Refuser</button>
                    </div>
                </div>
            </div>`;
        });
        otherNotifs.slice().reverse().forEach(n => {
            html += `<div class="notification-item"><div class="notification-icon"><i class="fas fa-info-circle"></i></div><div class="notification-content"><div class="notification-message">${this.sanitize(n.message || '')}</div><div class="notification-time">${formatTime(n.timestamp)}</div></div></div>`;
        });
        container.innerHTML = html;
        this._updateNotificationBadge(invitations.length + otherNotifs.length);
    }

    _updateNotificationBadge(count) {
        const badge = document.getElementById('notifications-badge');
        if (badge) { badge.textContent = count > 0 ? count : ''; badge.style.display = count > 0 ? 'flex' : 'none'; }
    }

    _showInvitationBanner(inv) {
        if (!inv) return;
        const bannerId = `invite-banner-${inv.roomId}`;
        if (document.getElementById(bannerId)) return;
        const typeLabel = inv.roomType === 'group' ? 'groupe' : inv.roomType === 'channel' ? 'salon' : 'conversation';
        const banner = document.createElement('div');
        banner.id = bannerId; banner.className = 'invitation-banner';
        banner.style.cssText = `position:fixed;top:0;left:0;right:0;z-index:9999;background:linear-gradient(135deg,#00853F,#128C7E);color:white;padding:12px 16px;display:flex;align-items:center;gap:12px;box-shadow:0 2px 12px rgba(0,0,0,.3);animation:slideDown .3s ease;`;
        banner.innerHTML = `<i class="fas fa-envelope" style="font-size:1.2em;flex-shrink:0"></i>
            <div style="flex:1;font-size:.9em"><strong>${this.sanitize(inv.invitedByName || inv.invitedBy)}</strong> vous invite au ${typeLabel} <strong>"${this.sanitize(inv.roomName)}"</strong></div>
            <button onclick="acceptInvitation('${inv.roomId}')" style="background:rgba(255,255,255,.25);border:none;color:white;padding:6px 14px;border-radius:20px;cursor:pointer;font-weight:600;white-space:nowrap">✓ Rejoindre</button>
            <button onclick="declineInvitation('${inv.roomId}')" style="background:rgba(255,255,255,.1);border:1px solid rgba(255,255,255,.3);color:white;padding:6px 10px;border-radius:20px;cursor:pointer;white-space:nowrap">✕</button>`;
        if (!document.getElementById('invitation-banner-style')) {
            const style = document.createElement('style'); style.id = 'invitation-banner-style';
            style.textContent = `@keyframes slideDown{from{transform:translateY(-100%)}to{transform:translateY(0)}}.invitation-banner{transition:transform .3s ease}`;
            document.head.appendChild(style);
        }
        document.body.prepend(banner);
        setTimeout(() => this._removeInvitationBanner(inv.roomId), 15000);
        this.renderNotifications();
    }

    _removeInvitationBanner(roomId) {
        const banner = document.getElementById(`invite-banner-${roomId}`);
        if (banner) { banner.style.transform = 'translateY(-100%)'; setTimeout(() => banner.remove(), 300); }
        document.getElementById(`notif-invite-${roomId}`)?.remove();
        this._updateNotificationBadge(matrixManager.getInvitations?.().length || 0);
    }
}

const uiController = new UIController();
console.log('✅ ui-controller.js v15.8 — Toast fix, read receipts à ouverture chat, ticks bleus propagation, screen share vidéo définitif');
