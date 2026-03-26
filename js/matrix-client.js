// matrix-client.js — SENDT v18.11
// ✅ Fixes v18.11 :
// - Fix accusés de lecture : _applyReadReceiptImmediately met à jour uiController._readReceipts AVANT DOM
// - Fix propagation ticks : tous les messages isOwn antérieurs passent en bleu (avec target inclus)
// - Fix _markPreviousMessagesRead : applique className complet (pas seulement classList.add)
class MatrixManager {
    constructor() {
        this.client = null; this.userId = null; this.accessToken = null; this.homeserverUrl = null;
        this._profile = {}; this._contacts = []; this._groups = []; this._channels = []; this._invitations = [];
        this._syncReady = false; this._initialSyncComplete = false;
        this._maxUploadSize = null; // fetched from server after connect
        this._clientStartTime = null;
        this._callActive = false; this._activeCallRoomId = null;
        this._mediaBlobCache = {}; this._isRinging = false;
        this._presenceMap = {};
    }
    _getSDK() { return window.matrixcs || window.Matrix || window.matrix || window.sdk; }
    async login(homeserverUrl, username, password) {
        try {
            const sdk = this._getSDK(); if (!sdk) throw new Error('Matrix SDK non chargé');
            this.homeserverUrl = homeserverUrl;
            let userId = username;
            if (!userId.startsWith('@')) userId = `@${userId}:${homeserverUrl.replace(/^https?:\/\//, '')}`;
            const tempClient = sdk.createClient({ baseUrl: homeserverUrl });
            const loginResp = await tempClient.loginWithPassword(userId, password);
            this.userId = loginResp.user_id; this.accessToken = loginResp.access_token;
            const deviceId = loginResp.device_id || ('SENDT_' + (this.userId || 'DEV').replace(/[^A-Z0-9]/gi,'').substring(0,10).toUpperCase());
            this.client = sdk.createClient({ baseUrl: homeserverUrl, accessToken: this.accessToken, userId: this.userId, deviceId, timelineSupport: true });
            try { const p = await this.client.getProfileInfo(this.userId); this._profile = p || {}; } catch(e) {}
            await this.startSync();
            return { success: true, userId: this.userId };
        } catch(e) {
            const m = e.message || '';
            let msg;
            if      (m.includes('429') || /too many request/i.test(m))                          msg = 'Trop de tentatives. Patientez quelques secondes avant de réessayer.';
            else if (m.includes('403') || /invalid username|invalid password|forbidden/i.test(m)) msg = 'Identifiant ou mot de passe incorrect.';
            else if (m.includes('401'))                                                           msg = 'Identifiant ou mot de passe incorrect.';
            else if (m.includes('404'))                                                           msg = 'Serveur introuvable. Vérifiez votre identifiant.';
            else if (m.includes('500') || m.includes('502') || m.includes('503'))                msg = 'Le serveur rencontre un problème. Réessayez plus tard.';
            else if (/failed to fetch|network|connexion|cors/i.test(m))                          msg = 'Impossible de joindre le serveur. Vérifiez votre connexion internet.';
            else if (/timeout|timed out/i.test(m))                                               msg = 'Le serveur ne répond pas. Réessayez dans quelques instants.';
            else if (/sdk non charg/i.test(m))                                                    msg = 'L\'application n\'est pas encore prête. Rechargez la page.';
            else                                                                                   msg = 'Connexion impossible. Vérifiez vos identifiants et réessayez.';
            return { success: false, error: msg };
        }
    }
    async startSync() {
        if (!this.client) return;
        this._clientStartTime = Date.now();
        this._setupMatrixListeners();
        await this.client.startClient({ initialSyncLimit: 50, lazyLoadMembers: true });
        this._disableNativeCallHandler();
        await new Promise(resolve => {
            const onSync = (state) => {
                if (state === 'PREPARED' || state === 'SYNCING') {
                    this.client.removeListener('sync', onSync);
                    this._syncReady = true;
                    setTimeout(() => {
                        this._initialSyncComplete = true;
                        console.log('[Matrix] ✅ Sync complet — appels activés à', new Date().toLocaleTimeString());
                        this._setOwnPresence('online');
                        // ✅ v18.9 : Polling présence toutes les 60s pour garder les statuts à jour
                        this._startPresencePolling();
                    }, 2000);
                    resolve();
                }
            };
            this.client.on('sync', onSync);
            setTimeout(() => { this._syncReady = true; this._initialSyncComplete = true; resolve(); }, 8000);
        });
        await this.loadRooms();
        this._fetchUploadLimit();
    }

    async _fetchUploadLimit() {
        if (!this.client) return;
        const base = this.client.getHomeserverUrl();
        const token = this.client.getAccessToken();
        const endpoints = [
            `${base}/_matrix/media/v3/config`,
            `${base}/_matrix/media/r0/config`,
        ];
        for (const url of endpoints) {
            try {
                const r = await fetch(url, { headers: { 'Authorization': `Bearer ${token}` } });
                if (r.ok) {
                    const d = await r.json();
                    if (d['m.upload.size']) { this._maxUploadSize = d['m.upload.size']; return; }
                }
            } catch(e) {}
        }
        // Conservative fallback if server doesn't expose limit
        this._maxUploadSize = 8 * 1024 * 1024; // 8 MB
    }

    _setOwnPresence(presence) {
        if (!this.client) return;
        try { this.client.setPresence({ presence }).catch(() => {}); } catch(e) {}
    }
    _disableNativeCallHandler() {
        if (!this.client) return;
        try {
            [this.client.callEventHandler, this.client._callEventHandler, this.client.getCallEventHandler?.()].forEach(h => {
                if (h && typeof h === 'object') { h.handleCallEvent = () => Promise.resolve(); h.evaluateEventBuffer = () => Promise.resolve(); if (h.callEventBuffer) h.callEventBuffer = []; if (h.eventBuffer) h.eventBuffer = []; }
            });
            for (const key of Object.keys(this.client)) {
                const val = this.client[key];
                if (val && typeof val === 'object' && typeof val.handleCallEvent === 'function') { val.handleCallEvent = () => Promise.resolve(); val.evaluateEventBuffer = () => Promise.resolve(); if (val.callEventBuffer) val.callEventBuffer = []; if (val.eventBuffer) val.eventBuffer = []; }
            }
            if (this.client.removeListener) { this.client.removeAllListeners('Call.incoming'); this.client.removeAllListeners('Call.answer'); this.client.removeAllListeners('Call.hangup'); }
        } catch(e) {}
    }
    _parseEventToMessage(event) {
        if (!event || event.getType() !== 'm.room.message') return null;
        const content = event.getContent(); const msgtype = content?.msgtype; if (!msgtype) return null;
        const relatesTo = content['m.relates_to'];
        if (relatesTo?.rel_type === 'm.replace') return null;
        const isOwn = event.getSender() === this.userId;
        const eventId = event.getId(); const timestamp = event.getTs(); const senderId = event.getSender();
        let isReply = false, replyToEventId = null;
        if (relatesTo?.['m.in_reply_to']?.event_id) { isReply = true; replyToEventId = relatesTo['m.in_reply_to'].event_id; }
        const ephemeral = content['sendt.ephemeral'] || null;
        const viewOnce = !!(content['org.matrix.msc3930.view_once'] || content['m.once']);
        let type = 'text', message = content.body || '', mxcUrl = null, filename = null, fileInfo = null, audioDuration = 0, geoUri = null, mimetype = null;
        switch (msgtype) {
            case 'm.text': type = 'text'; message = content.body || ''; break;
            case 'm.image': type = 'image'; mxcUrl = content.url; message = content.body || 'Image'; mimetype = content.info?.mimetype || 'image/jpeg'; break;
            case 'm.video': type = 'video'; mxcUrl = content.url; message = content.body || 'Vidéo'; mimetype = content.info?.mimetype || 'video/mp4'; break;
            case 'm.audio':
                type = content['org.matrix.msc3245.voice'] ? 'voice' : 'audio';
                mxcUrl = content.url; audioDuration = content.info?.duration || content['org.matrix.msc1767.audio']?.duration || 0;
                message = content.body || 'Audio'; mimetype = content.info?.mimetype || 'audio/webm'; break;
            case 'm.file':
                type = 'file'; mxcUrl = content.url; filename = content.body; message = content.body || 'Fichier';
                fileInfo = content.info || {}; mimetype = content.info?.mimetype || 'application/octet-stream'; break;
            case 'm.location':
                type = 'location'; geoUri = content.geo_uri || content['m.location']?.uri || ''; message = content.body || 'Position'; break;
            default: type = 'text'; message = content.body || '[message]';
        }
        return { eventId, senderId, sender: senderId, isOwn, type, message, mxcUrl, filename, fileInfo, audioDuration, geoUri, mimetype, isReply, replyToEventId, ephemeral, timestamp, viewOnce };
    }
    _setupMatrixListeners() {
        if (!this.client) return;
        this.client.on('sync', (state) => { if (state === 'PREPARED') this._syncReady = true; });
        this.client.on('Room.myMembership', (room, membership) => {
            if (membership === 'invite') this._handleIncomingInvitation(room);
            else {
                if (membership !== 'join') this._invitations = this._invitations.filter(i => i.roomId !== room.roomId);
                setTimeout(() => this.loadRooms(), 500);
            }
        });
        this.client.on('Room.timeline', (event, room, toStartOfTimeline) => {
            if (toStartOfTimeline || !room) return;
            const evType = event.getType();
            if (evType === 'm.room.message') { this._handleNewMessage(event, room); return; }
            if (evType === 'm.call.invite') { this._handleCallInviteEvent(event, room); return; }
            if (evType === 'm.call.answer') { this._handleCallAnswerEvent(event); return; }
            if (evType === 'm.call.candidates') { this._handleCallCandidatesEvent(event); return; }
            if (evType === 'm.call.hangup') { this._handleCallHangupEvent(event); return; }
            if (evType === 'm.call.negotiate') { this._handleCallNegotiateEvent(event); return; }
            if (evType === 'm.reaction') {
                // Notify UI to refresh reactions for this room
                window.dispatchEvent(new CustomEvent('reactions-updated', { detail: { roomId: room.roomId } }));
                return;
            }
        });
        this.client.on('Room.localEchoUpdated', (event) => {
            if (event.getType() !== 'm.room.message') return;
            const content = event.getContent(); const relatesTo = content?.['m.relates_to'];
            if (relatesTo?.rel_type === 'm.replace') window.dispatchEvent(new CustomEvent('message-edited', { detail: { roomId: event.getRoomId(), eventId: relatesTo.event_id, newContent: content?.['m.new_content'] } }));
        });
        this.client.on('RoomMember.membership', (event, member, oldMembership) => {
            if (member.userId === this.userId) return;
            if (member.membership === 'join' && oldMembership === 'invite') {
                window.dispatchEvent(new CustomEvent('member-joined', { detail: { roomId: event.getRoomId(), userId: member.userId, displayName: member.name } }));
                if (typeof showToast === 'function') showToast(`${member.name} a rejoint`, 'success');
                setTimeout(() => this.loadRooms(), 800);
            }
        });
        this.client.on('RoomState.events', (event) => {
            if (event.getType() !== 'm.typing') return;
            const roomId = event.getRoomId();
            const userIds = event.getContent()?.user_ids || [];
            const typingUsers = userIds.filter(u => u !== this.userId).map(u => {
                const room = this.client.getRoom(roomId);
                return { userId: u, name: room?.getMember(u)?.name || u };
            });
            window.dispatchEvent(new CustomEvent('typing-event', { detail: { roomId, users: typingUsers.map(t => t.name), typingUsers } }));
        });
        this.client.on('User.presence', (event, user) => {
            if (!user?.userId) return;
            const prev = this._presenceMap[user.userId];
            this._presenceMap[user.userId] = { presence: user.presence || 'offline', lastActiveAgo: user.lastActiveAgo || null, currentlyActive: user.currentlyActive || false, ts: Date.now() };
            if (prev?.presence !== user.presence || !prev) {
                window.dispatchEvent(new CustomEvent('presence-changed', { detail: { userId: user.userId, presence: user.presence || 'offline', lastActiveAgo: user.lastActiveAgo, currentlyActive: user.currentlyActive } }));
            }
        });
        // ✅ Accusés de lecture — mise à jour IMMÉDIATE dans le DOM sans re-render complet
        this.client.on('Room.receipt', (event, room) => {
            if (!room) return;
            const content = event.getContent();
            Object.entries(content).forEach(([eventId, receipts]) => {
                const readReceipts = receipts['m.read'] || {};
                Object.entries(readReceipts).forEach(([userId, data]) => {
                    if (userId !== this.userId) {
                        window.dispatchEvent(new CustomEvent('read-receipt-received', {
                            detail: { roomId: room.roomId, eventId, userId, ts: data?.ts || Date.now() }
                        }));
                        // ✅ Mise à jour DOM immédiate sans attendre renderChatMessages
                        this._applyReadReceiptImmediately(room.roomId, eventId);
                    }
                });
            });
        });
    }
    // ✅ Mise à jour immédiate des ticks bleus dans le DOM
    _applyReadReceiptImmediately(roomId, eventId) {
        // Mettre à jour le cache de receipts dans uiController
        if (typeof uiController !== 'undefined') {
            if (!uiController._readReceipts[roomId]) uiController._readReceipts[roomId] = {};
            if (!uiController._readReceipts[roomId][eventId]) uiController._readReceipts[roomId][eventId] = new Set();
            uiController._readReceipts[roomId][eventId].add('__remote__');

            // Propager WhatsApp-like : tous les messages isOwn avant cet eventId → lus
            const msgs = uiController.chatMessages?.[roomId] || [];
            const targetMsg = msgs.find(m => m.eventId === eventId);
            const targetTs = targetMsg?.timestamp || 0;
            for (const msg of msgs) {
                if (!msg.isOwn || !msg.eventId) continue;
                if ((msg.timestamp || 0) <= targetTs || msg.eventId === eventId) {
                    if (!uiController._readReceipts[roomId][msg.eventId]) {
                        uiController._readReceipts[roomId][msg.eventId] = new Set();
                    }
                    uiController._readReceipts[roomId][msg.eventId].add('__remote__');
                }
            }
        }

        // Mettre à jour le DOM directement — tous les ticks antérieurs passent en bleu
        this._markPreviousMessagesRead(roomId, eventId);
    }
    _markPreviousMessagesRead(roomId, upToEventId) {
        if (typeof uiController === 'undefined') return;
        const msgs = uiController.chatMessages?.[roomId] || [];
        if (!msgs.length) return;
        const targetIdx = msgs.findIndex(m => m.eventId === upToEventId);
        const limit = targetIdx >= 0 ? targetIdx : msgs.length - 1;
        for (let i = 0; i <= limit; i++) {
            const msg = msgs[i];
            if (!msg.isOwn || !msg.eventId) continue;
            const el = document.querySelector(`[data-event-id="${msg.eventId}"] .msg-ticks`);
            if (el && !el.classList.contains('read')) {
                el.className = 'msg-ticks read';
                el.title = 'Lu';
                el.innerHTML = '<i class="fas fa-check-double"></i>';
            }
        }
        // Aussi marquer le message ciblé lui-même
        if (upToEventId) {
            const el = document.querySelector(`[data-event-id="${upToEventId}"] .msg-ticks`);
            if (el && !el.classList.contains('read')) {
                el.className = 'msg-ticks read';
                el.title = 'Lu';
                el.innerHTML = '<i class="fas fa-check-double"></i>';
            }
        }
    }
    _handleNewMessage(event, room) {
        const parsed = this._parseEventToMessage(event); if (!parsed) return;
        const member = room.getMember?.(parsed.senderId); parsed.senderName = member?.name || parsed.senderId;
        // ✅ v18.10 : Son de notification pour les messages entrants (pas les nôtres)
        // ✅ v16.0 : Ne pas jouer si le chat courant est déjà ouvert (comportement WhatsApp)
        if (!parsed.isOwn && this._initialSyncComplete) {
            const rid = event.getRoomId();
            const isCurrentRoom = typeof uiController !== 'undefined' && uiController.currentContact?.roomId === rid;
            if (!isCurrentRoom && typeof soundManager !== 'undefined') soundManager.playMessageSound?.();
        }
        window.dispatchEvent(new CustomEvent('message-received', { detail: { ...parsed, roomId: event.getRoomId(), roomName: room.name } }));
    }
    // ✅ Fix sonnerie : filtre appels antérieurs au démarrage
    _handleCallInviteEvent(event, room) {
        const senderId = event.getSender(); if (senderId === this.userId) return;
        if (!this._initialSyncComplete) { console.log('[Matrix] Appel ignoré — sync en cours'); return; }
        const content = event.getContent(); if (!content?.call_id || !content?.offer) return;
        const eventTs = event.getTs();
        const startTs = this._clientStartTime || Date.now();
        if (eventTs < startTs) {
            console.log('[Matrix] 📞 Appel ignoré — antérieur au démarrage:', new Date(eventTs).toLocaleTimeString());
            return;
        }
        const age = Date.now() - eventTs;
        if (age > 45000) { console.log('[Matrix] 📞 Appel ignoré (trop ancien):', age, 'ms'); return; }
        if (this._callActive) { try { this.client.sendEvent(event.getRoomId(), 'm.call.hangup', { call_id: content.call_id, version: 1, reason: 'user_busy' }).catch(() => {}); } catch(e) {} return; }
        const sdp = content.offer?.sdp || '';
        const isVideoCall = sdp.includes('m=video') && !/m=video\s+0\s/.test(sdp);
        this._callActive = true; this._activeCallRoomId = event.getRoomId();
        window.dispatchEvent(new CustomEvent('incoming-call', { detail: { roomId: event.getRoomId(), callId: content.call_id, caller: senderId, callerName: room?.getMember?.(senderId)?.name || senderId, offer: content.offer, isVideoCall, timestamp: eventTs } }));
        this._startRinging();
    }
    _startRinging() { if (this._isRinging) return; this._isRinging = true; if (typeof soundManager !== 'undefined') soundManager.playCallRingtone?.(); }
    _stopRinging() { if (!this._isRinging) return; this._isRinging = false; if (typeof soundManager !== 'undefined') soundManager.stopCallRingtone?.(); }
    _handleCallAnswerEvent(event) { if (event.getSender() === this.userId) return; const c = event.getContent(); if (c?.answer && typeof webrtcManager !== 'undefined') webrtcManager.handleCallAnswer(c.answer); }
    _handleCallCandidatesEvent(event) { if (event.getSender() === this.userId) return; const c = event.getContent()?.candidates || []; if (c.length && typeof webrtcManager !== 'undefined') webrtcManager.handleIceCandidates(c); }
    // ✅ Fix son raccrochage : playCallEnd UNIQUEMENT si appel actif + filtre anciens events
    _handleCallHangupEvent(event) {
        if (event.getSender() === this.userId) return;
        const eventTs = event.getTs();
        const startTs = this._clientStartTime || Date.now();
        if (eventTs < startTs) {
            console.log('[Matrix] 🔇 Hangup ignoré — antérieur au démarrage:', new Date(eventTs).toLocaleTimeString());
            return;
        }
        this._stopRinging();
        // ✅ v16.2 : Appel manqué — on reçoit un hangup AVANT d'avoir décroché
        const callConnected = typeof webrtcManager !== 'undefined' && webrtcManager._callConnected;
        const ringing = this._callActive && !callConnected;
        if (ringing) {
            // Missed incoming call
            try {
                const roomId = event.getRoomId();
                this.addCallToHistory({
                    userId: event.getSender(),
                    roomId,
                    type: 'audio',
                    direction: 'incoming',
                    status: 'missed',
                    duration: 0,
                    timestamp: eventTs
                });
            } catch(e) {}
            if (typeof uiController !== 'undefined') {
                const modal = document.getElementById('incoming-call-modal');
                modal?.classList.remove('show', 'active');
            }
        }
        if (this._callActive) {
            if (typeof soundManager !== 'undefined') soundManager.playCallEnd?.();
        }
        this.clearCallActive();
        window.dispatchEvent(new CustomEvent('call-force-ended', { detail: { reason: 'Correspondant raccroché' } }));
        if (typeof uiController !== 'undefined') uiController.endCall?.();
    }
    _handleCallNegotiateEvent(event) { if (event.getSender() === this.userId) return; const c = event.getContent(); if (c?.description && typeof webrtcManager !== 'undefined') webrtcManager.handleCallNegotiate(c); }
    _handleIncomingInvitation(room) {
        const roomId = room.roomId; if (this._invitations.find(i => i.roomId === roomId)) return;
        const inviteEvent = room.currentState?.getStateEvents('m.room.member', this.userId);
        const invitedBy = inviteEvent?.getSender?.() || 'Inconnu';
        const roomName = room.name || roomId; const roomType = this._detectRoomType(room);
        let viaServers = [];
        try {
            const unsigned = inviteEvent?.getUnsigned?.() || {};
            if (Array.isArray(unsigned.invite_room_state)) { const ev = unsigned.invite_room_state.find(e => e.type === 'm.room.join_rules'); if (ev?.content?.via) viaServers = ev.content.via; }
            if (!viaServers.length) { const ic = inviteEvent?.getContent?.() || {}; if (Array.isArray(ic['via'])) viaServers = ic['via']; }
            if (!viaServers.length) { const rs = roomId.split(':').slice(1).join(':'); const is2 = invitedBy.split(':').slice(1).join(':'); const hs = (this.homeserverUrl||'').replace(/^https?:\/\//,''); viaServers = [...new Set([rs,is2,hs].filter(Boolean))]; }
        } catch(e) { viaServers = [(this.homeserverUrl||'').replace(/^https?:\/\//,'')].filter(Boolean); }
        let invitedByName = invitedBy;
        try { for (const r of this.client.getRooms()) { const m = r.getMember?.(invitedBy); if (m?.name) { invitedByName = m.name; break; } } } catch(e) {}
        const invitation = { roomId, roomName, roomType, invitedBy, invitedByName, viaServers, timestamp: Date.now() };
        this._invitations.push(invitation);
        window.dispatchEvent(new CustomEvent('invitation-received', { detail: invitation }));
        window.dispatchEvent(new CustomEvent('notifications-updated'));
        const typeLabel = roomType === 'group' ? 'groupe' : roomType === 'channel' ? 'salon' : 'conversation';
        if (typeof showToast === 'function') showToast(`📨 Invitation au ${typeLabel} "${roomName}" de ${invitedByName}`, 'info', 8000);
    }
    async acceptInvitation(roomId) {
        if (!this.client) return false;
        try {
            const inv = this._invitations.find(i => i.roomId === roomId); const viaServers = inv?.viaServers || [];
            await this.client.joinRoom(roomId, viaServers.length ? { viaServers } : {});
            this._invitations = this._invitations.filter(i => i.roomId !== roomId);
            window.dispatchEvent(new CustomEvent('invitation-accepted', { detail: { roomId } }));
            window.dispatchEvent(new CustomEvent('notifications-updated'));
            setTimeout(() => this.loadRooms(), 1000);
            if (typeof showToast === 'function') showToast('✅ Vous avez rejoint !', 'success');
            return true;
        } catch(e) {
            if (e.httpStatus === 404 || e.errcode === 'M_NOT_FOUND') { if (typeof showToast === 'function') showToast("Ce groupe/salon n'existe plus", 'error'); this._invitations = this._invitations.filter(i => i.roomId !== roomId); window.dispatchEvent(new CustomEvent('notifications-updated')); }
            else if (e.errcode === 'M_FORBIDDEN') { if (typeof showToast === 'function') showToast('Accès refusé', 'error'); }
            else { if (typeof showToast === 'function') showToast('Erreur: ' + (e.message || 'impossible'), 'error'); }
            return false;
        }
    }
    async declineInvitation(roomId) {
        if (!this.client) return false;
        try { await this.client.leave(roomId); } catch(e) {}
        this._invitations = this._invitations.filter(i => i.roomId !== roomId);
        window.dispatchEvent(new CustomEvent('invitation-declined', { detail: { roomId } })); window.dispatchEvent(new CustomEvent('notifications-updated'));
        if (typeof showToast === 'function') showToast('Invitation refusée', 'info');
        return true;
    }
    getInvitations() { return [...this._invitations]; }
    getUserPresence(userId) { return this._presenceMap[userId] || { presence: 'offline' }; }
    // ✅ Alias pour compatibilité ui-controller.js
    getLastSeenText(userId) { return this.getLastSeenFormatted(userId); }
    getLastSeenFormatted(userId) {
        const data = this._presenceMap[userId]; if (!data) return null;
        if (data.presence === 'online' || data.currentlyActive) return '🟢 En ligne';
        const lastActiveAgo = data.lastActiveAgo;
        if (!lastActiveAgo && lastActiveAgo !== 0) return 'Hors ligne';
        const lastSeenTs = (data.ts || Date.now()) - lastActiveAgo;
        const d = new Date(lastSeenTs);
        const now2 = new Date();
        const diff = Date.now() - lastSeenTs;
        const timeStr = d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
        if (d.toDateString() === now2.toDateString()) return `vu à ${timeStr}`;
        const yesterday = new Date(now2); yesterday.setDate(yesterday.getDate() - 1);
        if (d.toDateString() === yesterday.toDateString()) return `vu hier à ${timeStr}`;
        if (diff < 7 * 86400000) { const days = ['dim.','lun.','mar.','mer.','jeu.','ven.','sam.']; return `vu ${days[d.getDay()]} à ${timeStr}`; }
        return `vu le ${d.toLocaleDateString('fr-FR', { day:'2-digit', month:'2-digit', year:'2-digit' })}`;
    }
    async getContactInfo(userId) {
        if (!this.client) return null;
        try {
            const profile = await this.client.getProfileInfo(userId).catch(() => ({}));
            let avatarHttpUrl = null;
            if (profile.avatar_url) avatarHttpUrl = this.client.mxcUrlToHttp(profile.avatar_url, 96, 96, 'crop');
            const sharedRooms = this.client.getRooms().filter(room => room.getMyMembership() === 'join' && room.getJoinedMembers().some(m => m.userId === userId));
            const recentMedia = [];
            for (const room of sharedRooms.slice(0, 3)) {
                for (const ev of (room.getLiveTimeline().getEvents() || []).slice(-100)) {
                    if (ev.getSender() !== userId && ev.getSender() !== this.userId) continue;
                    const parsed = this._parseEventToMessage(ev);
                    if (parsed && ['image','video'].includes(parsed.type) && parsed.mxcUrl) { recentMedia.push({ ...parsed, roomId: room.roomId }); if (recentMedia.length >= 9) break; }
                }
                if (recentMedia.length >= 9) break;
            }
            return { userId, displayName: profile.displayname || userId, avatarUrl: profile.avatar_url || null, avatarHttpUrl, presence: this._presenceMap[userId]?.presence || 'offline', lastSeen: this.getLastSeenFormatted(userId), sharedRooms: sharedRooms.map(r => ({ roomId: r.roomId, name: r.name })), recentMedia };
        } catch(e) { return null; }
    }
    // ✅ v18.9 : Polling présence pour garder les statuts à jour (WhatsApp-like)
    _startPresencePolling() {
        if (this._presencePollingInterval) clearInterval(this._presencePollingInterval);
        this._presencePollingInterval = setInterval(async () => {
            if (!this.client || !this._syncReady) return;
            try {
                // Renouveler notre propre présence
                this._setOwnPresence('online');
                // Récupérer la présence de tous les contacts connus
                for (const contact of this._contacts) {
                    if (!contact.userId) continue;
                    try {
                        const resp = await this.client.getPresence(contact.userId).catch(() => null);
                        if (!resp) continue;
                        const prev = this._presenceMap[contact.userId];
                        const newPresence = resp.presence || 'offline';
                        this._presenceMap[contact.userId] = {
                            presence: newPresence,
                            lastActiveAgo: resp.last_active_ago || null,
                            currentlyActive: resp.currently_active || false,
                            statusMsg: resp.status_msg || null,
                            ts: Date.now()
                        };
                        // Émettre l'event seulement si changement
                        if (!prev || prev.presence !== newPresence) {
                            window.dispatchEvent(new CustomEvent('presence-changed', {
                                detail: { userId: contact.userId, presence: newPresence, lastActiveAgo: resp.last_active_ago, currentlyActive: resp.currently_active }
                            }));
                        }
                    } catch(e) {}
                }
            } catch(e) {}
        }, 60000); // toutes les 60s
    }
    // ✅ v18.9 : Médias partagés (photos + vidéos)
    getRoomSharedMedia(roomId, limit = 9) {
        if (!this.client || !roomId) return [];
        try {
            const room = this.client.getRoom(roomId); if (!room) return [];
            const result = [];
            const events = room.getLiveTimeline().getEvents() || [];
            for (let i = events.length - 1; i >= 0 && result.length < limit; i--) {
                const ev = events[i];
                if (ev.getType() !== 'm.room.message') continue;
                const parsed = this._parseEventToMessage(ev);
                if (parsed && ['image', 'video'].includes(parsed.type) && parsed.mxcUrl) {
                    result.push({ type: parsed.type, mxcUrl: parsed.mxcUrl, timestamp: parsed.timestamp });
                }
            }
            return result;
        } catch(e) { return []; }
    }
    // ✅ v16.0 : Fichiers partagés (docs, audio, voice)
    getRoomSharedFiles(roomId, limit = 20) {
        if (!this.client || !roomId) return [];
        try {
            const room = this.client.getRoom(roomId); if (!room) return [];
            const result = [];
            const events = room.getLiveTimeline().getEvents() || [];
            for (let i = events.length - 1; i >= 0 && result.length < limit; i--) {
                const ev = events[i];
                if (ev.getType() !== 'm.room.message') continue;
                const parsed = this._parseEventToMessage(ev);
                if (parsed && ['file', 'audio', 'voice'].includes(parsed.type) && parsed.mxcUrl) {
                    result.push({ type: parsed.type, mxcUrl: parsed.mxcUrl, filename: parsed.filename || parsed.message || 'Fichier', timestamp: parsed.timestamp, mimetype: parsed.mimetype, fileInfo: parsed.fileInfo });
                }
            }
            return result;
        } catch(e) { return []; }
    }
    async loadRooms() {
        if (!this.client) return;
        const contacts = [], groups = [], channels = [];
        for (const room of this.client.getRooms()) {
            const mm = room.getMyMembership?.();
            if (mm === 'invite') { if (!this._invitations.find(i => i.roomId === room.roomId)) this._handleIncomingInvitation(room); continue; }
            if (mm !== 'join') continue;
            const roomType = this._detectRoomType(room); const info = this._buildRoomInfo(room, roomType);
            if (roomType === 'dm') contacts.push(info); else if (roomType === 'group') groups.push(info); else channels.push(info);
        }
        const sortFn = (a, b) => (b.lastTime||0) - (a.lastTime||0);
        contacts.sort(sortFn); groups.sort(sortFn); channels.sort(sortFn);
        this._contacts = contacts; this._groups = groups; this._channels = channels;
        window.dispatchEvent(new CustomEvent('contacts-loaded', { detail: { contacts, groups, channels } }));
    }
    _detectRoomType(room) {
        try { const dd = this.client.getAccountData('m.direct')?.getContent() || {}; if (Object.values(dd).flat().includes(room.roomId)) return 'dm'; } catch(e) {}
        // Most reliable indicator: m.room.create.is_direct flag set by the SDK when creating DMs
        try { const ce = room.currentState?.getStateEvents?.('m.room.create', ''); if (ce?.getContent?.()?.is_direct === true) return 'dm'; } catch(e) {}
        const members = room.getJoinedMembers?.() || [];
        if (room.getDMInviter?.()) return 'dm';
        // Count invited members too — groups may have few joined members if invitees haven't accepted yet
        let totalCount = members.length;
        try { totalCount += (room.getMembersWithMembership?.('invite') || []).length; } catch(e) {}
        if (totalCount > 2) { const jr = room.currentState?.getStateEvents?.('m.room.join_rules', ''); if (jr?.getContent?.()?.join_rule === 'public') return 'channel'; return 'group'; }
        if (members.length <= 2) { const other = members.find(m => m.userId !== this.userId); const name = room.name || ''; if (!name || (other && (name === other.name || name === other.userId || name.includes(other.userId.split(':')[0])))) return 'dm'; }
        const jr = room.currentState?.getStateEvents?.('m.room.join_rules', '');
        if (jr?.getContent?.()?.join_rule === 'public') return 'channel';
        return members.length <= 2 ? 'dm' : 'group';
    }
    _buildRoomInfo(room, roomType) {
        const members = room.getJoinedMembers?.() || []; const otherMembers = members.filter(m => m.userId !== this.userId);
        let displayName = room.name || room.roomId, userId = null, avatarUrl = null;
        if (roomType === 'dm' && otherMembers.length > 0) { const other = otherMembers[0]; displayName = other.name || other.userId; userId = other.userId; try { avatarUrl = other.getMxcAvatarUrl?.() ? this.client.mxcUrlToHttp(other.getMxcAvatarUrl(), 48, 48, 'crop') : null; } catch(e) {} }
        else { try { avatarUrl = room.getAvatarUrl?.(this.homeserverUrl, 48, 48, 'crop') || null; } catch(e) {} }
        const timeline = room.getLiveTimeline?.()?.getEvents() || [];
        let lastMessage = '', lastTime = null;
        for (let i = timeline.length - 1; i >= 0; i--) {
            const ev = timeline[i]; if (ev.getType() !== 'm.room.message') continue;
            const parsed = this._parseEventToMessage(ev); if (!parsed) continue;
            if (parsed.type === 'text') lastMessage = parsed.message; else if (parsed.type === 'image') lastMessage = '📷 Image'; else if (parsed.type === 'video') lastMessage = '🎬 Vidéo'; else if (parsed.type === 'voice') lastMessage = '🎙️ Vocal'; else if (parsed.type === 'audio') lastMessage = '🔊 Audio'; else if (parsed.type === 'file') lastMessage = '📎 ' + (parsed.filename||'Fichier'); else if (parsed.type === 'location') lastMessage = '📍 Position';
            lastTime = parsed.timestamp; break;
        }
        return { roomId: room.roomId, displayName, userId, avatarUrl, lastMessage, lastTime, memberCount: members.length, unreadCount: room.getUnreadNotificationCount?.() || 0 };
    }
    async getMessages(roomId, limit = 50) {
        if (!this.client) return [];
        try {
            const room = this.client.getRoom(roomId); if (!room) return [];
            try { await this.client.scrollback(room, limit); } catch(e) {}
            const results = [];
            for (const event of room.getLiveTimeline().getEvents()) {
                if (event.getType() !== 'm.room.message') continue;
                const parsed = this._parseEventToMessage(event); if (!parsed) continue;
                const member = room.getMember?.(parsed.senderId); parsed.senderName = member?.name || parsed.senderId;
                results.push(parsed);
            }
            return results.slice(-limit);
        } catch(e) { return []; }
    }
    getRoomReadReceipts(roomId) {
        if (!this.client) return {};
        const receipts = {};
        try {
            const room = this.client.getRoom(roomId); if (!room) return {};
            for (const event of room.getLiveTimeline().getEvents()) {
                const eventId = event.getId(); const receiptUsers = room.getReceiptsForEvent?.(event) || [];
                if (receiptUsers.length > 0) receipts[eventId] = receiptUsers.map(r => r.userId).filter(uid => uid !== this.userId);
            }
        } catch(e) {}
        return receipts;
    }
    async sendMessage(roomId, text) { if (!this.client || !roomId || !text?.trim()) return false; try { await this.client.sendTextMessage(roomId, text.trim()); return true; } catch(e) { return false; } }
    async sendReaction(roomId, eventId, emoji) {
        if (!this.client || !roomId || !eventId || !emoji) return false;
        try {
            await this.client.sendEvent(roomId, 'm.reaction', { 'm.relates_to': { rel_type: 'm.annotation', event_id: eventId, key: emoji } });
            return true;
        } catch(e) { return false; }
    }
    getReactions(roomId) {
        if (!this.client || !roomId) return {};
        try {
            const room = this.client.getRoom(roomId); if (!room) return {};
            const out = {}; // { eventId: { emoji: [userId,...] } }
            for (const ev of room.getLiveTimeline().getEvents()) {
                if (ev.getType() !== 'm.reaction') continue;
                const rel = ev.getContent()?.['m.relates_to'];
                if (!rel?.event_id || !rel?.key) continue;
                if (!out[rel.event_id]) out[rel.event_id] = {};
                if (!out[rel.event_id][rel.key]) out[rel.event_id][rel.key] = [];
                if (!out[rel.event_id][rel.key].includes(ev.getSender())) out[rel.event_id][rel.key].push(ev.getSender());
            }
            return out;
        } catch(e) { return {}; }
    }
    async sendTyping(roomId, typing) { if (!this.client || !roomId) return; try { await this.client.sendTyping(roomId, typing, 3000); } catch(e) {} }
    async _uploadViaFetch(fileOrBlob, filename, mimetype) {
        const baseUrl = this.client.getHomeserverUrl(); const token = this.client.getAccessToken(); const enc = encodeURIComponent(filename);
        try { const r = await fetch(`${baseUrl}/_matrix/media/v3/upload?filename=${enc}`, { method:'POST', headers:{'Authorization':`Bearer ${token}`,'Content-Type':mimetype}, body:fileOrBlob }); if (r.ok) { const d = await r.json(); return d.content_uri; } if (r.status===413) throw new Error('UPLOAD_SIZE:Fichier trop volumineux'); } catch(e) { if (e.message?.startsWith('UPLOAD_')) throw e; }
        try { const r2 = await fetch(`${baseUrl}/_matrix/media/v3/upload?filename=${enc}&access_token=${encodeURIComponent(token)}`, { method:'POST', headers:{'Content-Type':mimetype}, body:fileOrBlob }); if (r2.ok) { const d2 = await r2.json(); return d2.content_uri; } if (r2.status===413) throw new Error('UPLOAD_SIZE:Trop volumineux'); } catch(e) { if (e.message?.startsWith('UPLOAD_')) throw e; }
        try { const r3 = await this.client.uploadContent(fileOrBlob,{name:filename,type:mimetype,rawResponse:false}); return r3.content_uri; } catch(e) { throw new Error(`UPLOAD_FAILED:${e.message}`); }
    }
    _getImageInfo(file) { return new Promise(resolve => { const img = new Image(); const url = URL.createObjectURL(file); img.onload = () => { URL.revokeObjectURL(url); resolve({w:img.width,h:img.height,mimetype:file.type,size:file.size}); }; img.onerror = () => resolve({w:0,h:0,mimetype:file.type,size:file.size}); img.src = url; }); }
    _getVideoInfo(file) { return new Promise(resolve => { const v = document.createElement('video'); const url = URL.createObjectURL(file); v.preload='metadata'; v.onloadedmetadata = () => { URL.revokeObjectURL(url); resolve({w:v.videoWidth,h:v.videoHeight,duration:v.duration,mimetype:file.type,size:file.size}); }; v.onerror = () => resolve({w:0,h:0,duration:0,mimetype:file.type,size:file.size}); v.src = url; }); }
    async sendFile(roomId, file, viewOnce = false) {
        try {
            const mimetype = file.type || 'application/octet-stream'; const cat = getFileCategory(mimetype);
            if (file.size > this.getMaxUploadSize()) { if (typeof showToast === 'function') showToast('Fichier trop volumineux','error'); return false; }
            const mxcUrl = await this._uploadViaFetch(file, file.name, mimetype);
            let content = {};
            if (cat === 'image') { const info = await this._getImageInfo(file); content = {msgtype:'m.image',body:file.name,url:mxcUrl,info:{mimetype,size:file.size,w:info.w,h:info.h}}; }
            else if (cat === 'video') { const info = await this._getVideoInfo(file); content = {msgtype:'m.video',body:file.name,url:mxcUrl,info:{mimetype,size:file.size,w:info.w,h:info.h,duration:Math.round(info.duration*1000)}}; }
            else { content = {msgtype:'m.file',body:file.name,filename:file.name,url:mxcUrl,info:{mimetype,size:file.size}}; }
            if (viewOnce) { content['org.matrix.msc3930.view_once'] = true; content['m.once'] = true; }
            await this.client.sendEvent(roomId, 'm.room.message', content);
            return true;
        } catch(error) { const msg = error.message||''; if (msg.startsWith('UPLOAD_SIZE:')) { if (typeof showToast==='function') showToast(msg.substring(12),'error'); } else { if (typeof showToast==='function') showToast('Erreur envoi fichier','error'); } return false; }
    }
    async sendVoiceMessage(roomId, audioBlob, durationMs) {
        try { const mimetype = audioBlob.type||'audio/webm'; const filename = `voice_${Date.now()}.${mimetype.includes('ogg')?'ogg':'webm'}`; const mxcUrl = await this._uploadViaFetch(audioBlob,filename,mimetype); await this.client.sendEvent(roomId,'m.room.message',{msgtype:'m.audio',body:'Message vocal',url:mxcUrl,info:{duration:Math.round(durationMs),mimetype,size:audioBlob.size},'org.matrix.msc1767.audio':{duration:durationMs},'org.matrix.msc3245.voice':{}}); return true; }
        catch(e) { if (typeof showToast==='function') showToast('Erreur envoi vocal','error'); return false; }
    }
    async editMessage(roomId, eventId, oldText, newText) { if (!this.client) return false; try { await this.client.sendMessage(roomId,{msgtype:'m.text',body:`* ${newText}`,'m.new_content':{msgtype:'m.text',body:newText},'m.relates_to':{rel_type:'m.replace',event_id:eventId}}); return true; } catch(e) { return false; } }
    async deleteMessage(roomId, eventId) { if (!this.client) return false; try { await this.client.redactEvent(roomId,eventId); return true; } catch(e) { return false; } }
    async markRoomRead(roomId) { if (!this.client||!roomId) return; try { const room = this.client.getRoom(roomId); if (!room) return; const events = room.getLiveTimeline().getEvents(); if (events.length>0) await this.client.sendReadReceipt(events[events.length-1]); } catch(e) {} }
    async createGroup(name, members=[]) { if (!this.client) return null; try { const resp = await this.client.createRoom({name,preset:'private_chat',visibility:'private',initial_state:[{type:'m.room.guest_access',state_key:'',content:{guest_access:'forbidden'}}],power_level_content_override:{users_default:0,events_default:0,state_default:50,ban:50,kick:50,redact:50,invite:50}}); const roomId = resp.room_id; if (members.length>0) await this._inviteMembers(roomId,members); setTimeout(()=>this.loadRooms(),1000); return roomId; } catch(e) { throw e; } }
    async createChannel(name, description='', isPublic=false) { if (!this.client) return null; try { const opts = {name,topic:description,preset:isPublic?'public_chat':'private_chat',visibility:isPublic?'public':'private',initial_state:[{type:'m.room.guest_access',state_key:'',content:{guest_access:isPublic?'can_join':'forbidden'}}]}; if (isPublic) opts.room_alias_name = name.toLowerCase().replace(/[^a-z0-9]/g,'-').replace(/-+/g,'-'); const resp = await this.client.createRoom(opts); setTimeout(()=>this.loadRooms(),1000); return resp.room_id; } catch(e) { throw e; } }
    async _inviteMembers(roomId, members) { let ok=0,fail=0; for (const m of members) { try { await this.client.invite(roomId,m); ok++; } catch(e) { fail++; } } if (typeof showToast==='function') { if (ok>0) showToast(`${ok} membre(s) invité(s)`,'success'); if (fail>0) showToast(`${fail} invitation(s) échouée(s)`,'warning'); } return {success:ok,failed:fail}; }
    async inviteMember(roomId, userId) { if (!this.client) return false; try { await this.client.invite(roomId,userId); return true; } catch(e) { throw e; } }
    async leaveRoom(roomId) { if (!this.client) return false; try { await this.client.leave(roomId); setTimeout(()=>this.loadRooms(),500); return true; } catch(e) { return false; } }
    async getOrCreateRoomForUser(userId) {
        if (!this.client) throw new Error('Client non connecté');
        try { const dd = this.client.getAccountData('m.direct')?.getContent()||{}; for (const rid of (dd[userId]||[])) { const room = this.client.getRoom(rid); if (room&&room.getMyMembership()==='join') return rid; } } catch(e) {}
        for (const room of this.client.getRooms()) { if (room.getMyMembership()!=='join') continue; const members = room.getJoinedMembers(); if (members.length<=2&&members.some(m=>m.userId===userId)&&this._detectRoomType(room)==='dm') return room.roomId; }
        const resp = await this.client.createRoom({preset:'trusted_private_chat',invite:[userId],is_direct:true,initial_state:[{type:'m.room.guest_access',state_key:'',content:{guest_access:'forbidden'}}]});
        const roomId = resp.room_id;
        try { const currentDMs = this.client.getAccountData('m.direct')?.getContent()||{}; if (!currentDMs[userId]) currentDMs[userId]=[]; if (!currentDMs[userId].includes(roomId)) currentDMs[userId].push(roomId); await this.client.setAccountData('m.direct',currentDMs); } catch(e) {}
        setTimeout(()=>this.loadRooms(),500); setTimeout(()=>this.loadRooms(),2500);
        return roomId;
    }
    async createDirectRoom(userId) { return this.getOrCreateRoomForUser(userId); }
    getUserId() { return this.userId; }
    getUserProfile() { return this._profile; }
    getClient() { return this.client; }
    async setDisplayName(name) { if (!this.client) return false; try { await this.client.setDisplayName(name); this._profile.displayname=name; return true; } catch(e) { return false; } }
    async uploadAvatar(file) { if (!this.client) return null; try { const url = await this.client.uploadContent(file,{onlyContentUri:true}); await this.client.setAvatarUrl(url); this._profile.avatar_url=url; return url; } catch(e) { return null; } }
    async getAvatarBlobUrl(mxcUrl) { if (!this.client||!mxcUrl) return null; try { return this.client.mxcUrlToHttp(mxcUrl,96,96,'crop')||null; } catch(e) { return null; } }
    async downloadMediaBlob(mxcUrl) {
        if (!mxcUrl) return null; if (this._mediaBlobCache[mxcUrl]) return this._mediaBlobCache[mxcUrl];
        const baseUrl = this.client.getHomeserverUrl(); const sm = mxcUrl.substring(6); const token = this.client.getAccessToken();
        let response = null;
        try { response = await fetch(`${baseUrl}/_matrix/client/v1/media/download/${sm}`,{headers:{'Authorization':`Bearer ${token}`}}); } catch(e) {}
        if (!response?.ok) { try { response = await fetch(`${baseUrl}/_matrix/media/v3/download/${sm}?access_token=${encodeURIComponent(token)}`); } catch(e) {} }
        if (!response?.ok) { try { response = await fetch(`${baseUrl}/_matrix/media/v3/download/${sm}`); } catch(e) {} }
        if (!response?.ok) return null;
        const blobUrl = URL.createObjectURL(await response.blob()); this._mediaBlobCache[mxcUrl] = blobUrl; return blobUrl;
    }
    async downloadAudioBlob(mxcUrl) { return this.downloadMediaBlob(mxcUrl); }
    mxcToHttpUrl(mxcUrl) { if (!mxcUrl?.startsWith('mxc://')) return null; const sm=mxcUrl.substring(6); return `${this.client.getHomeserverUrl()}/_matrix/client/v1/media/download/${sm}?access_token=${encodeURIComponent(this.client.getAccessToken())}`; }
    mxcToThumbnailUrl(mxcUrl,w=320,h=240) { if (!mxcUrl?.startsWith('mxc://')) return null; const sm=mxcUrl.substring(6); return `${this.client.getHomeserverUrl()}/_matrix/client/v1/media/thumbnail/${sm}?width=${w}&height=${h}&method=scale&access_token=${encodeURIComponent(this.client.getAccessToken())}`; }
    getNotifications() { return this._invitations.map(inv=>({type:'invitation',...inv})); }
    getCallHistory() { return JSON.parse(localStorage.getItem('sendt_call_history')||'[]'); }
    addCallToHistory(entry) { const h=this.getCallHistory(); h.unshift({...entry,id:Date.now()}); if (h.length>100) h.splice(100); localStorage.setItem('sendt_call_history',JSON.stringify(h)); window.dispatchEvent(new CustomEvent('call-history-updated')); }
    setCallActive(roomId) { this._callActive=true; this._activeCallRoomId=roomId; window.dispatchEvent(new CustomEvent('call-started',{detail:{roomId}})); }
    forceEndCall(reason='Connexion perdue') { if (typeof showToast==='function') showToast(reason,'error'); this._stopRinging(); this.clearCallActive(); window.dispatchEvent(new CustomEvent('call-force-ended',{detail:{reason}})); if (typeof uiController!=='undefined') uiController.endCall?.(); }
    endCall() { this.clearCallActive(); }
    async sendCallNegotiate(roomId, callId, description, streamMetadata) { if (!this.client) return; try { const content={call_id:callId,version:1,description}; if (streamMetadata) content.sdp_stream_metadata=streamMetadata; await this.client.sendEvent(roomId,'m.call.negotiate',content); } catch(e) {} }
    clearCallActive() { const w=this._callActive; this._callActive=false; this._activeCallRoomId=null; this._isRinging=false; if (w) window.dispatchEvent(new CustomEvent('call-ended')); }
    getPinnedMessages(roomId) { if (!this.client||!roomId) return []; try { const room=this.client.getRoom(roomId); if (!room) return []; const pe=room.currentState?.getStateEvents('m.room.pinned_events',''); return pe?.getContent?.()?.pinned||[]; } catch(e) { return []; } }
    async pinMessage(roomId, eventId) { if (!this.client||!roomId||!eventId) return false; try { const current=this.getPinnedMessages(roomId); const updated=current.includes(eventId)?current.filter(id=>id!==eventId):[...current,eventId]; await this.client.sendStateEvent(roomId,'m.room.pinned_events',{pinned:updated},''); return true; } catch(e) { return false; } }
    isGroupRoom(roomId) { if (!this.client||!roomId) return false; try { const room=this.client.getRoom(roomId); if (!room) return false; return this._detectRoomType(room)==='group'; } catch(e) { return false; } }
    getMaxUploadSize() { return this._maxUploadSize || 8 * 1024 * 1024; }
    async replyToMessage(roomId, replyToMsg, text) { if (!this.client||!roomId) return false; try { await this.client.sendMessage(roomId,{msgtype:'m.text',body:`> ${replyToMsg.message||''}\n\n${text}`,'m.relates_to':{'m.in_reply_to':{event_id:replyToMsg.eventId}}}); return true; } catch(e) { return false; } }
    async sendEphemeralMessage(roomId, text, durationSeconds) { if (!this.client||!roomId) return false; try { await this.client.sendMessage(roomId,{msgtype:'m.text',body:text,'sendt.ephemeral':{expires_at:Date.now()+durationSeconds*1000,duration:durationSeconds}}); return true; } catch(e) { return false; } }
    async sendReadReceipt(roomId, eventId) { if (!this.client||!roomId) return; try { const room=this.client.getRoom(roomId); if (!room) return; if (eventId) { const event=room.findEventById(eventId); if (event) await this.client.sendReadReceipt(event); } else { const events=room.getLiveTimeline().getEvents(); if (events.length>0) await this.client.sendReadReceipt(events[events.length-1]); } } catch(e) {} }
    async forwardMessage(roomId, msg) { if (!this.client||!roomId||!msg) return false; try { if (msg.type==='text') { await this.client.sendTextMessage(roomId,msg.message||''); } else if (msg.mxcUrl) { const mt=msg.type==='image'?'m.image':msg.type==='video'?'m.video':(msg.type==='voice'||msg.type==='audio')?'m.audio':'m.file'; await this.client.sendMessage(roomId,{msgtype:mt,url:msg.mxcUrl,body:msg.message||'Fichier'}); } return true; } catch(e) { return false; } }
    async searchPublicChannels(query='') { if (!this.client) return []; try { const res=await this.client.publicRooms({limit:30,filter:query?{generic_search_term:query}:undefined}); return res.chunk||[]; } catch(e) { return []; } }
    async joinChannel(roomIdOrAlias) { if (!this.client) return false; try { await this.client.joinRoom(roomIdOrAlias); setTimeout(()=>this.loadRooms(),1000); return true; } catch(e) { return false; } }
    async postStatus(statusData) { if (!this.client) return false; try { const existing=JSON.parse(localStorage.getItem('sendt_statuses')||'[]'); existing.unshift({...statusData,id:Date.now(),timestamp:Date.now(),userId:this.userId}); if (existing.length>50) existing.splice(50); localStorage.setItem('sendt_statuses',JSON.stringify(existing)); await this.client.setAccountData('sendt.status',{latest:statusData,timestamp:Date.now()}).catch(()=>{}); return true; } catch(e) { return false; } }
    async getMyStatuses() { try { return JSON.parse(localStorage.getItem('sendt_statuses')||'[]').filter(s=>s.userId===this.userId); } catch(e) { return []; } }
    async getContactStatuses() { if (!this.client) return []; try { const results=[]; for (const room of this.client.getRooms()) { for (const member of room.getJoinedMembers()||[]) { if (member.userId===this.userId) continue; try { const data=await this.client.getAccountDataFromServer('sendt.status').catch(()=>null); if (data?.latest) results.push({userId:member.userId,displayName:member.name||member.userId,status:{...data.latest,timestamp:data.timestamp||Date.now()},allStatuses:[{...data.latest,timestamp:data.timestamp||Date.now()}]}); } catch(e) {} break; } } return results; } catch(e) { return []; } }
    async uploadStatusImage(file) { if (!this.client||!file) return null; try { return await this.client.uploadContent(file,{onlyContentUri:true}); } catch(e) { return null; } }
    async sendLocation(roomId, lat, lng, description='') { if (!this.client||!roomId) return false; try { await this.client.sendMessage(roomId,{msgtype:'m.location',body:description||`Position: ${lat.toFixed(6)}, ${lng.toFixed(6)}`,geo_uri:`geo:${lat},${lng}`,info:{},'m.location':{uri:`geo:${lat},${lng}`,description}}); return true; } catch(e) { return false; } }
    async startLiveLocation(roomId, durationSeconds) { if (!this.client||!roomId) return false; try { const watchId=navigator.geolocation.watchPosition(async(pos)=>{await this.sendLocation(roomId,pos.coords.latitude,pos.coords.longitude,'Position en direct');},(()=>{}),{enableHighAccuracy:true,maximumAge:10000}); setTimeout(()=>navigator.geolocation.clearWatch(watchId),durationSeconds*1000); return true; } catch(e) { return false; } }
    async logout() { try { this._setOwnPresence('offline'); await new Promise(r=>setTimeout(r,300)); } catch(e) {} if (this._presencePollingInterval) { clearInterval(this._presencePollingInterval); this._presencePollingInterval = null; } try { if (this.client) { await this.client.logout(); this.client.stopClient(); } } catch(e) {} this.client=null; this.userId=null; this.accessToken=null; this._invitations=[]; this._initialSyncComplete=false; this._clientStartTime=null; }

    // ── Inscription ──
    async register(homeserverUrl, username, password) {
        try {
            const url = `${homeserverUrl}/_matrix/client/v3/register`;
            const body = { username, password, kind: 'user' };
            const r1 = await fetch(url, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) });
            const d1 = await r1.json();
            let data, ok;
            if (r1.status === 401 && d1.session) {
                // Compléter le flux avec dummy auth
                const r2 = await fetch(url, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({...body, auth:{type:'m.login.dummy', session:d1.session}}) });
                data = await r2.json(); ok = r2.ok;
            } else { data = d1; ok = r1.ok; }
            if (!ok) {
                const c = data.errcode || '';
                let msg = data.error || '';
                if (c === 'M_USER_IN_USE')      msg = 'Cet identifiant est déjà utilisé. Choisissez-en un autre.';
                else if (c === 'M_INVALID_USERNAME') msg = 'Identifiant invalide. Utilisez lettres minuscules, chiffres, - ou _.';
                else if (c === 'M_EXCLUSIVE')    msg = 'Cet identifiant est réservé.';
                else if (c === 'M_FORBIDDEN')    msg = 'Les inscriptions sont désactivées sur ce serveur.';
                else if (!msg)                   msg = `Erreur lors de la création du compte (${data.errcode || 'inconnu'}).`;
                return { success:false, error:msg };
            }
            return { success:true, userId: data.user_id || `@${username}:${homeserverUrl.replace(/^https?:\/\//,'')}` };
        } catch(e) {
            return { success:false, error: /failed to fetch|network/i.test(e.message) ? 'Impossible de joindre le serveur. Vérifiez votre connexion.' : 'Erreur lors de la création du compte. Réessayez.' };
        }
    }

    // ── Demande de réinitialisation de mot de passe (envoi email) ──
    async requestPasswordResetEmail(homeserverUrl, email) {
        const clientSecret = crypto.randomUUID ? crypto.randomUUID().replace(/-/g,'') : Math.random().toString(36).slice(2) + Date.now().toString(36);
        const nextLink = window.location.origin + window.location.pathname + '#reset-password';
        try {
            const r = await fetch(`${homeserverUrl}/_matrix/client/v3/account/password/email/requestToken`, {
                method:'POST', headers:{'Content-Type':'application/json'},
                body: JSON.stringify({ client_secret:clientSecret, email, send_attempt:1, next_link:nextLink })
            });
            const d = await r.json();
            if (!r.ok) {
                const c = d.errcode || '';
                let msg = d.error || '';
                if (c === 'M_THREEPID_NOT_FOUND') msg = 'Aucun compte associé à cet email. Vérifiez l\'adresse saisie.';
                else if (c === 'M_SERVER_NOT_TRUSTED' || c === 'M_INVALID_PARAM') msg = 'Le serveur de messagerie n\'est pas disponible.';
                else if (!msg) msg = 'Impossible d\'envoyer l\'email. Contactez l\'administrateur.';
                return { success:false, error:msg };
            }
            return { success:true, sid:d.sid, clientSecret };
        } catch(e) {
            return { success:false, error:'Impossible de joindre le serveur. Vérifiez votre connexion.' };
        }
    }

    // ── Soumettre le nouveau mot de passe ──
    async submitNewPassword(homeserverUrl, sid, clientSecret, newPassword) {
        try {
            const r = await fetch(`${homeserverUrl}/_matrix/client/v3/account/password`, {
                method:'POST', headers:{'Content-Type':'application/json'},
                body: JSON.stringify({ new_password:newPassword, logout_devices:false,
                    auth:{ type:'m.login.email.identity', threepid_creds:{ sid, client_secret:clientSecret } } })
            });
            if (r.ok || r.status === 200) return { success:true };
            const d = await r.json();
            let msg = d.error || '';
            if (d.errcode === 'M_UNAUTHORIZED') msg = 'Lien non validé ou expiré. Cliquez d\'abord le lien dans votre email.';
            else if (!msg) msg = 'Impossible de mettre à jour le mot de passe. Réessayez.';
            return { success:false, error:msg };
        } catch(e) {
            return { success:false, error:'Impossible de joindre le serveur.' };
        }
    }

    // ── Email lié au compte (3pid) ──
    async getLinkedEmails() {
        if (!this.accessToken || !this.homeserverUrl) return { success:false, error:'Non connecté.' };
        try {
            const r = await fetch(`${this.homeserverUrl}/_matrix/client/v3/account/3pid`, {
                headers: { 'Authorization': `Bearer ${this.accessToken}` }
            });
            const d = await r.json();
            if (!r.ok) return { success:false, error: d.error || 'Erreur.' };
            const emails = (d.threepids || []).filter(p => p.medium === 'email').map(p => p.address);
            return { success:true, emails };
        } catch(e) {
            return { success:false, error:'Impossible de joindre le serveur.' };
        }
    }

    async requestEmailLinkToken(email) {
        if (!this.accessToken || !this.homeserverUrl) return { success:false, error:'Non connecté.' };
        const clientSecret = (crypto.randomUUID ? crypto.randomUUID().replace(/-/g,'') : Math.random().toString(36).slice(2) + Date.now().toString(36));
        try {
            const r = await fetch(`${this.homeserverUrl}/_matrix/client/v3/account/3pid/email/requestToken`, {
                method:'POST', headers:{'Content-Type':'application/json', 'Authorization':`Bearer ${this.accessToken}`},
                body: JSON.stringify({ client_secret:clientSecret, email, send_attempt:1,
                    next_link: window.location.origin + window.location.pathname + '#email-confirmed' })
            });
            const d = await r.json();
            if (!r.ok) {
                let msg = d.error || '';
                if (d.errcode === 'M_THREEPID_IN_USE') msg = 'Cette adresse email est déjà utilisée par un autre compte.';
                else if (!msg) msg = 'Impossible d\'envoyer l\'email de validation.';
                return { success:false, error:msg };
            }
            return { success:true, sid:d.sid, clientSecret };
        } catch(e) {
            return { success:false, error:'Impossible de joindre le serveur.' };
        }
    }

    async addEmailThreepid(sid, clientSecret, password = null) {
        if (!this.accessToken || !this.homeserverUrl) return { success:false, error:'Non connecté.' };
        const url = `${this.homeserverUrl}/_matrix/client/v3/account/3pid/add`;
        const hdrs = {'Content-Type':'application/json', 'Authorization':`Bearer ${this.accessToken}`};
        const baseBody = { client_secret:clientSecret, sid };
        const _err = (d) => {
            const c = d.errcode || '';
            if (c === 'M_UNAUTHORIZED' || c === 'M_FORBIDDEN') return 'Lien non encore validé. Cliquez d\'abord le lien dans votre email.';
            if (c === 'M_THREEPID_IN_USE') return 'Cette adresse email est déjà utilisée.';
            if (c === 'M_THREEPID_NOT_FOUND') return 'Lien expiré ou invalide. Recommencez.';
            if (c === 'M_INVALID_PARAM' || (d.error || '').toLowerCase().includes('invalid login')) return null; // signal needsPassword
            return d.error || `Erreur (${c || 'inconnu'}).`;
        };
        try {
            // Étape 1 : découverte UIA → serveur renvoie 401 + flows + session
            const r1 = await fetch(url, { method:'POST', headers:hdrs, body:JSON.stringify(baseBody) });
            if (r1.ok) return { success:true };
            const d1 = await r1.json();
            if (r1.status !== 401 || !d1.session) return { success:false, error:_err(d1) || 'Erreur inattendue.' };
            const session = d1.session;
            const flows = (d1.flows || []).flatMap(f => f.stages || []);
            // Étape 2a : essayer m.login.dummy si le serveur l'accepte
            if (!password && (flows.length === 0 || flows.includes('m.login.dummy'))) {
                const r2 = await fetch(url, { method:'POST', headers:hdrs,
                    body:JSON.stringify({ ...baseBody, auth:{ type:'m.login.dummy', session } }) });
                if (r2.ok) return { success:true };
                const d2 = await r2.json();
                const e2 = _err(d2);
                if (e2 !== null) return { success:false, error:e2 };
                // dummy refusé → demander le mot de passe
            }
            // Étape 2b : si dummy refusé ou flows exige password → signal needsPassword
            if (!password) return { success:false, needsPassword:true, session };
            // Étape 2c : authentification par mot de passe
            const userId = this.userId || `@${this._username}:${this.homeserverUrl.replace(/^https?:\/\//,'')}`;
            const r3 = await fetch(url, { method:'POST', headers:hdrs,
                body:JSON.stringify({ ...baseBody, auth:{ type:'m.login.password', session,
                    user:userId, password } }) });
            if (r3.ok) return { success:true };
            const d3 = await r3.json();
            if ((d3.errcode === 'M_FORBIDDEN') && (d3.error||'').toLowerCase().includes('password')) {
                return { success:false, error:'Mot de passe incorrect.' };
            }
            return { success:false, error:_err(d3) || d3.error || 'Erreur d\'authentification.' };
        } catch(e) {
            return { success:false, error:'Impossible de joindre le serveur.' };
        }
    }

    async removeEmailThreepid(email) {
        if (!this.accessToken || !this.homeserverUrl) return { success:false, error:'Non connecté.' };
        try {
            const r = await fetch(`${this.homeserverUrl}/_matrix/client/v3/account/3pid/delete`, {
                method:'POST', headers:{'Content-Type':'application/json', 'Authorization':`Bearer ${this.accessToken}`},
                body: JSON.stringify({ medium:'email', address:email })
            });
            if (r.ok || r.status === 200) return { success:true };
            const d = await r.json();
            return { success:false, error: d.error || 'Impossible de supprimer l\'email.' };
        } catch(e) {
            return { success:false, error:'Impossible de joindre le serveur.' };
        }
    }
}
const matrixManager = new MatrixManager();
console.log('✅ matrix-client.js v18.11 — _applyReadReceiptImmediately met à jour _readReceipts cache + DOM complet avec target inclus');
