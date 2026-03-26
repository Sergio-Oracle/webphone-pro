// matrix-client.js — SENDT v18.6
// ✅ Fixes v18.6 :
//   - Fix 3 : Sonnerie au démarrage → flag _initialSyncComplete, ignore call.invite avant sync
//   - Fix 2 : Présence (en ligne/hors ligne) → subscribe User.presence, emit presence-changed
//   - Fix 1 : Accusés de lecture → Room.receipt, emit read-receipt-received
//   - Fix 4 : Ajout contact → fix getOrCreateRoomForUser (m.direct account data) + _detectRoomType

class MatrixManager {
    constructor() {
        this.client = null;
        this.userId = null;
        this.accessToken = null;
        this.homeserverUrl = null;
        this._profile = {};
        this._contacts = [];
        this._groups = [];
        this._channels = [];
        this._invitations = [];
        this._syncReady = false;
        this._initialSyncComplete = false; // ✅ Fix 3 : flag initial sync
        this._callActive = false;
        this._activeCallRoomId = null;
        this._mediaBlobCache = {};
        this._isRinging = false;
        this._presenceMap = {}; // ✅ Fix 2 : {userId: {presence, lastActiveAgo}}
    }

    _getSDK() {
        return window.matrixcs || window.Matrix || window.matrix || window.sdk;
    }

    async login(homeserverUrl, username, password) {
        try {
            const sdk = this._getSDK();
            if (!sdk) throw new Error('Matrix SDK non chargé');
            this.homeserverUrl = homeserverUrl;
            let userId = username;
            if (!userId.startsWith('@')) {
                const domain = homeserverUrl.replace(/^https?:\/\//, '');
                userId = `@${userId}:${domain}`;
            }
            const tempClient = sdk.createClient({ baseUrl: homeserverUrl });
            const loginResp  = await tempClient.loginWithPassword(userId, password);
            this.userId      = loginResp.user_id;
            this.accessToken = loginResp.access_token;
            const deviceId   = loginResp.device_id
                || ('SENDT_' + (this.userId || 'DEV').replace(/[^A-Z0-9]/gi, '').substring(0, 10).toUpperCase());
            this.client = sdk.createClient({
                baseUrl: homeserverUrl, accessToken: this.accessToken,
                userId: this.userId, deviceId, timelineSupport: true,
            });
            try { const p = await this.client.getProfileInfo(this.userId); this._profile = p || {}; } catch(e) {}
            await this.startSync();
            return { success: true, userId: this.userId };
        } catch(e) {
            console.error('[Matrix] Login error:', e);
            return { success: false, error: e.message || 'Erreur connexion' };
        }
    }

    async startSync() {
        if (!this.client) return;
        this._setupMatrixListeners();
        await this.client.startClient({ initialSyncLimit: 50, lazyLoadMembers: true });
        console.log('✅ Matrix sync démarré');
        this._disableNativeCallHandler();
        await new Promise(resolve => {
            const onSync = (state) => {
                if (state === 'PREPARED' || state === 'SYNCING') {
                    this.client.removeListener('sync', onSync);
                    this._syncReady = true;
                    // ✅ Fix 3 : marquer sync initial complet après petit délai
                    setTimeout(() => {
                        this._initialSyncComplete = true;
                        console.log('[Matrix] ✅ Sync initial complet — appels activés');
                        // ✅ Fix 2 : activer notre présence
                        this._setOwnPresence('online');
                    }, 1500);
                    resolve();
                }
            };
            this.client.on('sync', onSync);
            setTimeout(() => {
                this._syncReady = true;
                this._initialSyncComplete = true;
                resolve();
            }, 12000);
        });
        await this.loadRooms();
    }

    // ✅ Fix 2 : Définir notre propre présence
    _setOwnPresence(presence) {
        if (!this.client) return;
        try {
            this.client.setPresence({ presence }).catch(() => {});
        } catch(e) {}
    }

    _disableNativeCallHandler() {
        if (!this.client) return;
        try {
            const possibleHandlers = [
                this.client.callEventHandler,
                this.client._callEventHandler,
                this.client.getCallEventHandler?.()
            ];
            for (const handler of possibleHandlers) {
                if (handler && typeof handler === 'object') {
                    handler.handleCallEvent = () => Promise.resolve();
                    handler.evaluateEventBuffer = () => Promise.resolve();
                    if (handler.callEventBuffer) handler.callEventBuffer = [];
                    if (handler.eventBuffer) handler.eventBuffer = [];
                }
            }
            const keys = Object.keys(this.client);
            for (const key of keys) {
                const val = this.client[key];
                if (val && typeof val === 'object' && typeof val.handleCallEvent === 'function') {
                    val.handleCallEvent = () => Promise.resolve();
                    val.evaluateEventBuffer = () => Promise.resolve();
                    if (val.callEventBuffer) val.callEventBuffer = [];
                    if (val.eventBuffer) val.eventBuffer = [];
                }
            }
            if (this.client.removeListener) {
                this.client.removeAllListeners('Call.incoming');
                this.client.removeAllListeners('Call.answer');
                this.client.removeAllListeners('Call.hangup');
            }
        } catch(e) { console.warn('[Matrix] _disableNativeCallHandler:', e.message); }
    }

    _parseEventToMessage(event) {
        if (!event || event.getType() !== 'm.room.message') return null;
        const content  = event.getContent();
        const msgtype  = content?.msgtype;
        if (!msgtype) return null;
        const relatesTo = content['m.relates_to'];
        if (relatesTo?.rel_type === 'm.replace') return null;

        const isOwn     = event.getSender() === this.userId;
        const eventId   = event.getId();
        const timestamp = event.getTs();
        const senderId  = event.getSender();

        let isReply = false, replyToEventId = null;
        if (relatesTo?.['m.in_reply_to']?.event_id) { isReply = true; replyToEventId = relatesTo['m.in_reply_to'].event_id; }
        let ephemeral = null;
        if (content['sendt.ephemeral']) ephemeral = content['sendt.ephemeral'];

        let type = 'text', message = content.body || '', mxcUrl = null, filename = null;
        let fileInfo = null, audioDuration = 0, geoUri = null, mimetype = null;

        switch (msgtype) {
            case 'm.text':  type = 'text';  message = content.body || ''; break;
            case 'm.image': type = 'image'; mxcUrl = content.url; message = content.body || 'Image'; mimetype = content.info?.mimetype || 'image/jpeg'; break;
            case 'm.video': type = 'video'; mxcUrl = content.url; message = content.body || 'Vidéo'; mimetype = content.info?.mimetype || 'video/mp4'; break;
            case 'm.audio':
                type = content['org.matrix.msc3245.voice'] ? 'voice' : 'audio';
                mxcUrl = content.url;
                audioDuration = content.info?.duration || content['org.matrix.msc1767.audio']?.duration || 0;
                message = content.body || 'Audio'; mimetype = content.info?.mimetype || 'audio/webm';
                break;
            case 'm.file':
                type = 'file'; mxcUrl = content.url; filename = content.body;
                message = content.body || 'Fichier'; fileInfo = content.info || {};
                mimetype = content.info?.mimetype || 'application/octet-stream';
                break;
            case 'm.location':
                type = 'location';
                geoUri = content.geo_uri || content['m.location']?.uri || '';
                message = content.body || 'Position';
                break;
            default: type = 'text'; message = content.body || '[message]';
        }

        return { eventId, senderId, sender: senderId, isOwn, type, message, mxcUrl, filename,
                 fileInfo, audioDuration, geoUri, mimetype, isReply, replyToEventId, ephemeral, timestamp };
    }

    _setupMatrixListeners() {
        if (!this.client) return;

        this.client.on('sync', (state) => {
            if (state === 'PREPARED') this._syncReady = true;
        });

        this.client.on('Room.myMembership', (room, membership) => {
            if (membership === 'invite') this._handleIncomingInvitation(room);
            else if (membership === 'join' || membership === 'leave' || membership === 'ban') {
                if (membership !== 'join') this._invitations = this._invitations.filter(i => i.roomId !== room.roomId);
                setTimeout(() => this.loadRooms(), 500);
            }
        });

        this.client.on('Room.timeline', (event, room, toStartOfTimeline) => {
            if (toStartOfTimeline || !room) return;
            const evType = event.getType();
            if (evType === 'm.room.message')    { this._handleNewMessage(event, room); return; }
            if (evType === 'm.call.invite')     { this._handleCallInviteEvent(event, room); return; }
            if (evType === 'm.call.answer')     { this._handleCallAnswerEvent(event); return; }
            if (evType === 'm.call.candidates') { this._handleCallCandidatesEvent(event); return; }
            if (evType === 'm.call.hangup')     { this._handleCallHangupEvent(event); return; }
            if (evType === 'm.call.negotiate')  { this._handleCallNegotiateEvent(event); return; }
        });

        this.client.on('Room.localEchoUpdated', (event) => {
            if (event.getType() !== 'm.room.message') return;
            const content   = event.getContent();
            const relatesTo = content?.['m.relates_to'];
            if (relatesTo?.rel_type === 'm.replace') {
                window.dispatchEvent(new CustomEvent('message-edited', {
                    detail: { roomId: event.getRoomId(), eventId: relatesTo.event_id, newContent: content?.['m.new_content'] }
                }));
            }
        });

        this.client.on('RoomMember.membership', (event, member, oldMembership) => {
            if (member.userId === this.userId) return;
            if (member.membership === 'join' && oldMembership === 'invite') {
                const roomId = event.getRoomId();
                window.dispatchEvent(new CustomEvent('member-joined', { detail: { roomId, userId: member.userId, displayName: member.name } }));
                if (typeof showToast === 'function') showToast(`${member.name} a rejoint`, 'success');
                // ✅ Fix 4 : recharger les rooms quand un contact accepte l'invitation DM
                setTimeout(() => this.loadRooms(), 800);
            }
        });

        this.client.on('RoomState.events', (event) => {
            if (event.getType() !== 'm.typing') return;
            const roomId = event.getRoomId();
            const users  = event.getContent()?.user_ids || [];
            const otherTyping = users.filter(u => u !== this.userId)
                .map(u => { const room = this.client.getRoom(roomId); return room?.getMember(u)?.name || u; });
            window.dispatchEvent(new CustomEvent('typing-event', { detail: { roomId, users: otherTyping } }));
        });

        // ✅ Fix 2 : Présence des utilisateurs
        this.client.on('User.presence', (event, user) => {
            if (!user?.userId) return;
            const prev = this._presenceMap[user.userId]?.presence;
            this._presenceMap[user.userId] = {
                presence: user.presence || 'offline',
                lastActiveAgo: user.lastActiveAgo || null,
                currentlyActive: user.currentlyActive || false
            };
            if (prev !== user.presence) {
                window.dispatchEvent(new CustomEvent('presence-changed', {
                    detail: { userId: user.userId, presence: user.presence || 'offline', lastActiveAgo: user.lastActiveAgo }
                }));
            }
        });

        // ✅ Fix 1 : Accusés de lecture (read receipts)
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
                    }
                });
            });
        });
    }

    _handleNewMessage(event, room) {
        const parsed = this._parseEventToMessage(event);
        if (!parsed) return;
        const member = room.getMember?.(parsed.senderId);
        parsed.senderName = member?.name || parsed.senderId;
        window.dispatchEvent(new CustomEvent('message-received', {
            detail: { ...parsed, roomId: event.getRoomId(), roomName: room.name }
        }));
    }

    _handleCallInviteEvent(event, room) {
        const senderId = event.getSender();
        if (senderId === this.userId) return;

        // ✅ Fix 3 : Ignorer les appels entrants avant que le sync initial soit terminé
        if (!this._initialSyncComplete) {
            console.log('[Matrix] 📞 Appel ignoré — sync initial en cours');
            return;
        }

        const content = event.getContent();
        if (!content?.call_id || !content?.offer) return;
        const age = Date.now() - event.getTs();
        if (age > 60000) { console.log('[Matrix] 📞 Appel ignoré (trop ancien):', age, 'ms'); return; }
        if (this._callActive) {
            try { this.client.sendEvent(event.getRoomId(), 'm.call.hangup', { call_id: content.call_id, version: 1, reason: 'user_busy' }).catch(() => {}); } catch(e) {}
            return;
        }
        const sdp = content.offer?.sdp || '';
        const isVideoCall = sdp.includes('m=video') && !/m=video\s+0\s/.test(sdp);
        this._callActive = true;
        this._activeCallRoomId = event.getRoomId();
        window.dispatchEvent(new CustomEvent('incoming-call', {
            detail: { roomId: event.getRoomId(), callId: content.call_id, caller: senderId,
                      callerName: room?.getMember?.(senderId)?.name || senderId,
                      offer: content.offer, isVideoCall, timestamp: event.getTs() }
        }));
        this._startRinging();
    }

    _startRinging() {
        if (this._isRinging) return;
        this._isRinging = true;
        if (typeof soundManager !== 'undefined') soundManager.playCallRingtone?.();
    }

    _stopRinging() {
        if (!this._isRinging) return;
        this._isRinging = false;
        if (typeof soundManager !== 'undefined') soundManager.stopCallRingtone?.();
    }

    _handleCallAnswerEvent(event) {
        if (event.getSender() === this.userId) return;
        const content = event.getContent();
        if (!content?.answer) return;
        if (typeof webrtcManager !== 'undefined') webrtcManager.handleCallAnswer(content.answer);
    }

    _handleCallCandidatesEvent(event) {
        if (event.getSender() === this.userId) return;
        const candidates = event.getContent()?.candidates || [];
        if (!candidates.length) return;
        if (typeof webrtcManager !== 'undefined') webrtcManager.handleIceCandidates(candidates);
    }

    _handleCallHangupEvent(event) {
        if (event.getSender() === this.userId) return;
        this._stopRinging();
        if (typeof soundManager !== 'undefined') soundManager.playCallEnd?.();
        this.clearCallActive();
        window.dispatchEvent(new CustomEvent('call-force-ended', { detail: { reason: 'Correspondant raccroché' } }));
        if (typeof uiController !== 'undefined') uiController.endCall?.();
    }

    _handleCallNegotiateEvent(event) {
        if (event.getSender() === this.userId) return;
        const content = event.getContent();
        if (!content?.description) return;
        if (typeof webrtcManager !== 'undefined') webrtcManager.handleCallNegotiate(content);
    }

    _handleIncomingInvitation(room) {
        const roomId = room.roomId;
        if (this._invitations.find(i => i.roomId === roomId)) return;

        const inviteEvent   = room.currentState?.getStateEvents('m.room.member', this.userId);
        const invitedBy     = inviteEvent?.getSender?.() || 'Inconnu';
        const roomName      = room.name || roomId;
        const roomType      = this._detectRoomType(room);

        let viaServers = [];
        try {
            const unsigned = inviteEvent?.getUnsigned?.() || {};
            if (Array.isArray(unsigned.invite_room_state)) {
                const joinRulesEv = unsigned.invite_room_state.find(e => e.type === 'm.room.join_rules');
                if (joinRulesEv?.content?.via) viaServers = joinRulesEv.content.via;
            }
            if (!viaServers.length) {
                const invContent = inviteEvent?.getContent?.() || {};
                if (Array.isArray(invContent['via'])) viaServers = invContent['via'];
            }
            if (!viaServers.length) {
                const roomServer   = roomId.split(':').slice(1).join(':');
                const inviterServer = invitedBy.split(':').slice(1).join(':');
                const homeServer   = (this.homeserverUrl || '').replace(/^https?:\/\//, '');
                viaServers = [...new Set([roomServer, inviterServer, homeServer].filter(Boolean))];
            }
        } catch(e) {
            viaServers = [(this.homeserverUrl || '').replace(/^https?:\/\//, '')].filter(Boolean);
        }

        let invitedByName = invitedBy;
        try {
            for (const r of this.client.getRooms()) {
                const m = r.getMember?.(invitedBy);
                if (m?.name) { invitedByName = m.name; break; }
            }
        } catch(e) {}

        const invitation = { roomId, roomName, roomType, invitedBy, invitedByName, viaServers, timestamp: Date.now() };
        this._invitations.push(invitation);

        window.dispatchEvent(new CustomEvent('invitation-received',  { detail: invitation }));
        window.dispatchEvent(new CustomEvent('notifications-updated'));

        const typeLabel = roomType === 'group' ? 'groupe' : roomType === 'channel' ? 'salon' : 'conversation';
        if (typeof showToast === 'function') showToast(`📨 Invitation au ${typeLabel} "${roomName}" de ${invitedByName}`, 'info', 8000);
    }

    async acceptInvitation(roomId) {
        if (!this.client) return false;
        try {
            const inv = this._invitations.find(i => i.roomId === roomId);
            const viaServers = inv?.viaServers || [];
            await this.client.joinRoom(roomId, viaServers.length ? { viaServers } : {});
            this._invitations = this._invitations.filter(i => i.roomId !== roomId);
            window.dispatchEvent(new CustomEvent('invitation-accepted', { detail: { roomId } }));
            window.dispatchEvent(new CustomEvent('notifications-updated'));
            setTimeout(() => this.loadRooms(), 1000);
            if (typeof showToast === 'function') showToast('✅ Vous avez rejoint !', 'success');
            return true;
        } catch(e) {
            if (e.httpStatus === 404 || e.errcode === 'M_NOT_FOUND') {
                if (typeof showToast === 'function') showToast("Ce groupe/salon n'existe plus", 'error');
                this._invitations = this._invitations.filter(i => i.roomId !== roomId);
                window.dispatchEvent(new CustomEvent('notifications-updated'));
            } else if (e.errcode === 'M_FORBIDDEN') {
                if (typeof showToast === 'function') showToast('Accès refusé', 'error');
            } else {
                if (typeof showToast === 'function') showToast('Erreur: ' + (e.message || 'impossible'), 'error');
            }
            return false;
        }
    }

    async declineInvitation(roomId) {
        if (!this.client) return false;
        try { await this.client.leave(roomId); } catch(e) {}
        this._invitations = this._invitations.filter(i => i.roomId !== roomId);
        window.dispatchEvent(new CustomEvent('invitation-declined',  { detail: { roomId } }));
        window.dispatchEvent(new CustomEvent('notifications-updated'));
        if (typeof showToast === 'function') showToast('Invitation refusée', 'info');
        return true;
    }

    getInvitations() { return [...this._invitations]; }

    // ✅ Fix 2 : Accès à la présence d'un utilisateur
    getUserPresence(userId) {
        return this._presenceMap[userId] || { presence: 'offline' };
    }

    async loadRooms() {
        if (!this.client) return;
        const allRooms = this.client.getRooms();
        const contacts = [], groups = [], channels = [];

        for (const room of allRooms) {
            const myMembership = room.getMyMembership?.();
            if (myMembership === 'invite') {
                if (!this._invitations.find(i => i.roomId === room.roomId)) this._handleIncomingInvitation(room);
                continue;
            }
            if (myMembership !== 'join') continue;
            const roomType = this._detectRoomType(room);
            const info     = this._buildRoomInfo(room, roomType);
            if (roomType === 'dm')         contacts.push(info);
            else if (roomType === 'group') groups.push(info);
            else                           channels.push(info);
        }

        const sortFn = (a, b) => (b.lastTime || 0) - (a.lastTime || 0);
        contacts.sort(sortFn); groups.sort(sortFn); channels.sort(sortFn);
        this._contacts = contacts; this._groups = groups; this._channels = channels;

        window.dispatchEvent(new CustomEvent('contacts-loaded', { detail: { contacts, groups, channels } }));
    }

    // ✅ Fix 4 : Détecter les rooms DM via m.direct account data en priorité
    _detectRoomType(room) {
        // Vérifier d'abord le compte m.direct
        try {
            const directData = this.client.getAccountData('m.direct')?.getContent() || {};
            const allDMRoomIds = Object.values(directData).flat();
            if (allDMRoomIds.includes(room.roomId)) return 'dm';
        } catch(e) {}

        const members   = room.getJoinedMembers?.() || [];
        const dmInviter = room.getDMInviter?.();
        if (dmInviter) return 'dm';

        // Room avec ≤ 2 membres sans nom de groupe explicite = DM
        if (members.length <= 2) {
            const other = members.find(m => m.userId !== this.userId);
            const name  = room.name || '';
            // Si le nom de la room = nom/id de l'autre utilisateur → c'est un DM
            if (!name || (other && (name === other.name || name === other.userId || name.includes(other.userId.split(':')[0])))) {
                return 'dm';
            }
        }

        const joinRule = room.currentState?.getStateEvents?.('m.room.join_rules', '');
        if (joinRule?.getContent?.()?.join_rule === 'public') return 'channel';
        return members.length <= 2 ? 'dm' : 'group';
    }

    _buildRoomInfo(room, roomType) {
        const members      = room.getJoinedMembers?.() || [];
        const otherMembers = members.filter(m => m.userId !== this.userId);
        let displayName    = room.name || room.roomId;
        let userId         = null;
        let avatarUrl      = null;

        if (roomType === 'dm' && otherMembers.length > 0) {
            const other = otherMembers[0];
            displayName  = other.name || other.userId;
            userId       = other.userId;
            try { avatarUrl = other.getMxcAvatarUrl?.() ? this.client.mxcUrlToHttp(other.getMxcAvatarUrl(), 48, 48, 'crop') : null; } catch(e) {}
        } else {
            try { avatarUrl = room.getAvatarUrl?.(this.homeserverUrl, 48, 48, 'crop') || null; } catch(e) {}
        }

        const timeline = room.getLiveTimeline?.()?.getEvents() || [];
        let lastMessage = '', lastTime = null;
        for (let i = timeline.length - 1; i >= 0; i--) {
            const ev = timeline[i];
            if (ev.getType() !== 'm.room.message') continue;
            const parsed = this._parseEventToMessage(ev);
            if (!parsed) continue;
            if (parsed.type === 'text')       lastMessage = parsed.message;
            else if (parsed.type === 'image') lastMessage = '📷 Image';
            else if (parsed.type === 'video') lastMessage = '🎬 Vidéo';
            else if (parsed.type === 'voice') lastMessage = '🎙️ Vocal';
            else if (parsed.type === 'audio') lastMessage = '🔊 Audio';
            else if (parsed.type === 'file')  lastMessage = '📎 ' + (parsed.filename || 'Fichier');
            else if (parsed.type === 'location') lastMessage = '📍 Position';
            lastTime = parsed.timestamp;
            break;
        }

        return { roomId: room.roomId, displayName, userId, avatarUrl, lastMessage, lastTime,
                 memberCount: members.length, unreadCount: room.getUnreadNotificationCount?.() || 0 };
    }

    async getMessages(roomId, limit = 50) {
        if (!this.client) return [];
        try {
            const room = this.client.getRoom(roomId);
            if (!room) return [];
            try { await this.client.scrollback(room, limit); } catch(e) {
                console.warn('[Matrix] scrollback:', e.message || e);
            }
            const events = room.getLiveTimeline().getEvents();
            const results = [];
            for (const event of events) {
                if (event.getType() !== 'm.room.message') continue;
                const parsed = this._parseEventToMessage(event);
                if (!parsed) continue;
                const member = room.getMember?.(parsed.senderId);
                parsed.senderName = member?.name || parsed.senderId;
                results.push(parsed);
            }
            return results.slice(-limit);
        } catch(e) { console.error('[Matrix] getMessages:', e); return []; }
    }

    // ✅ Fix 1 : Récupérer les receipts existants d'une room
    getRoomReadReceipts(roomId) {
        if (!this.client) return {};
        const receipts = {};
        try {
            const room = this.client.getRoom(roomId);
            if (!room) return {};
            const events = room.getLiveTimeline().getEvents();
            for (const event of events) {
                const eventId = event.getId();
                const receiptUsers = room.getReceiptsForEvent?.(event) || [];
                if (receiptUsers.length > 0) {
                    receipts[eventId] = receiptUsers.map(r => r.userId).filter(uid => uid !== this.userId);
                }
            }
        } catch(e) {}
        return receipts;
    }

    async sendMessage(roomId, text) {
        if (!this.client || !roomId || !text?.trim()) return false;
        try { await this.client.sendTextMessage(roomId, text.trim()); return true; }
        catch(e) { console.error('[Matrix] sendMessage:', e); return false; }
    }

    async sendTyping(roomId, typing) {
        if (!this.client || !roomId) return;
        try { await this.client.sendTyping(roomId, typing, 3000); } catch(e) {}
    }

    async _uploadViaFetch(fileOrBlob, filename, mimetype) {
        const baseUrl = this.client.getHomeserverUrl();
        const token   = this.client.getAccessToken();
        const enc     = encodeURIComponent(filename);
        try {
            const r = await fetch(`${baseUrl}/_matrix/media/v3/upload?filename=${enc}`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': mimetype },
                body: fileOrBlob
            });
            if (r.ok) { const d = await r.json(); return d.content_uri; }
            if (r.status === 413) throw new Error(`UPLOAD_SIZE:Fichier trop volumineux`);
            if (r.status === 403) throw new Error('UPLOAD_FORBIDDEN:Non autorisé');
        } catch(e) { if (e.message?.startsWith('UPLOAD_')) throw e; }
        try {
            const r2 = await fetch(`${baseUrl}/_matrix/media/v3/upload?filename=${enc}&access_token=${encodeURIComponent(token)}`, {
                method: 'POST', headers: { 'Content-Type': mimetype }, body: fileOrBlob
            });
            if (r2.ok) { const d2 = await r2.json(); return d2.content_uri; }
            if (r2.status === 413) throw new Error(`UPLOAD_SIZE:Trop volumineux`);
        } catch(e) { if (e.message?.startsWith('UPLOAD_')) throw e; }
        try {
            const r3 = await this.client.uploadContent(fileOrBlob, { name: filename, type: mimetype, rawResponse: false });
            return r3.content_uri;
        } catch(e) { throw new Error(`UPLOAD_FAILED:${e.message}`); }
    }

    _getImageInfo(file) {
        return new Promise(resolve => {
            const img = new Image(); const url = URL.createObjectURL(file);
            img.onload  = () => { URL.revokeObjectURL(url); resolve({ w: img.width, h: img.height, mimetype: file.type, size: file.size }); };
            img.onerror = () => resolve({ w: 0, h: 0, mimetype: file.type, size: file.size });
            img.src = url;
        });
    }

    _getVideoInfo(file) {
        return new Promise(resolve => {
            const v = document.createElement('video'); const url = URL.createObjectURL(file);
            v.preload = 'metadata';
            v.onloadedmetadata = () => { URL.revokeObjectURL(url); resolve({ w: v.videoWidth, h: v.videoHeight, duration: v.duration, mimetype: file.type, size: file.size }); };
            v.onerror = () => resolve({ w: 0, h: 0, duration: 0, mimetype: file.type, size: file.size });
            v.src = url;
        });
    }

    async sendFile(roomId, file, viewOnce = false) {
        try {
            const mimetype = file.type || 'application/octet-stream';
            const cat      = getFileCategory(mimetype);
            if (file.size > this.getMaxUploadSize()) { if (typeof showToast === 'function') showToast('Fichier trop volumineux', 'error'); return false; }
            const mxcUrl = await this._uploadViaFetch(file, file.name, mimetype);
            let content = {};
            if (cat === 'image') {
                const info = await this._getImageInfo(file);
                content = { msgtype: 'm.image', body: file.name, url: mxcUrl, info: { mimetype, size: file.size, w: info.w, h: info.h } };
            } else if (cat === 'video') {
                const info = await this._getVideoInfo(file);
                content = { msgtype: 'm.video', body: file.name, url: mxcUrl, info: { mimetype, size: file.size, w: info.w, h: info.h, duration: Math.round(info.duration * 1000) } };
            } else {
                content = { msgtype: 'm.file', body: file.name, filename: file.name, url: mxcUrl, info: { mimetype, size: file.size } };
            }
            if (viewOnce) content['org.matrix.msc3930.view_once'] = true;
            await this.client.sendEvent(roomId, 'm.room.message', content);
            return true;
        } catch(error) {
            const msg = error.message || '';
            if (msg.startsWith('UPLOAD_SIZE:')) { if (typeof showToast === 'function') showToast(msg.substring(12), 'error'); }
            else { if (typeof showToast === 'function') showToast('Erreur envoi fichier', 'error'); }
            return false;
        }
    }

    async sendVoiceMessage(roomId, audioBlob, durationMs) {
        try {
            const mimetype = audioBlob.type || 'audio/webm';
            const filename = `voice_${Date.now()}.${mimetype.includes('ogg') ? 'ogg' : 'webm'}`;
            const mxcUrl   = await this._uploadViaFetch(audioBlob, filename, mimetype);
            await this.client.sendEvent(roomId, 'm.room.message', {
                msgtype: 'm.audio', body: 'Message vocal', url: mxcUrl,
                info: { duration: Math.round(durationMs), mimetype, size: audioBlob.size },
                'org.matrix.msc1767.audio': { duration: durationMs },
                'org.matrix.msc3245.voice': {},
            });
            return true;
        } catch(e) { if (typeof showToast === 'function') showToast('Erreur envoi vocal', 'error'); return false; }
    }

    async editMessage(roomId, eventId, oldText, newText) {
        if (!this.client) return false;
        try {
            await this.client.sendMessage(roomId, {
                msgtype: 'm.text', body: `* ${newText}`,
                'm.new_content': { msgtype: 'm.text', body: newText },
                'm.relates_to':  { rel_type: 'm.replace', event_id: eventId }
            });
            return true;
        } catch(e) { return false; }
    }

    async deleteMessage(roomId, eventId) {
        if (!this.client) return false;
        try { await this.client.redactEvent(roomId, eventId); return true; }
        catch(e) { return false; }
    }

    async markRoomRead(roomId) {
        if (!this.client || !roomId) return;
        try {
            const room = this.client.getRoom(roomId); if (!room) return;
            const events = room.getLiveTimeline().getEvents();
            if (events.length > 0) await this.client.sendReadReceipt(events[events.length - 1]);
        } catch(e) {}
    }

    async createGroup(name, members = []) {
        if (!this.client) return null;
        try {
            const resp = await this.client.createRoom({
                name, preset: 'private_chat', visibility: 'private',
                initial_state: [{ type: 'm.room.guest_access', state_key: '', content: { guest_access: 'forbidden' } }],
                power_level_content_override: { users_default: 0, events_default: 0, state_default: 50, ban: 50, kick: 50, redact: 50, invite: 50 },
            });
            const roomId = resp.room_id;
            if (members.length > 0) await this._inviteMembers(roomId, members);
            setTimeout(() => this.loadRooms(), 1000);
            return roomId;
        } catch(e) { console.error('[Matrix] createGroup:', e); throw e; }
    }

    async createChannel(name, description = '', isPublic = false) {
        if (!this.client) return null;
        try {
            const opts = {
                name, topic: description,
                preset:     isPublic ? 'public_chat'  : 'private_chat',
                visibility: isPublic ? 'public'        : 'private',
                initial_state: [{ type: 'm.room.guest_access', state_key: '', content: { guest_access: isPublic ? 'can_join' : 'forbidden' } }],
            };
            if (isPublic) opts.room_alias_name = name.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-');
            const resp = await this.client.createRoom(opts);
            setTimeout(() => this.loadRooms(), 1000);
            return resp.room_id;
        } catch(e) { throw e; }
    }

    async _inviteMembers(roomId, members) {
        let ok = 0, fail = 0;
        for (const memberId of members) {
            try { await this.client.invite(roomId, memberId); ok++; }
            catch(e) { fail++; }
        }
        if (typeof showToast === 'function') {
            if (ok > 0)   showToast(`${ok} membre(s) invité(s)`, 'success');
            if (fail > 0) showToast(`${fail} invitation(s) échouée(s)`, 'warning');
        }
        return { success: ok, failed: fail };
    }

    async inviteMember(roomId, userId) {
        if (!this.client) return false;
        try { await this.client.invite(roomId, userId); return true; }
        catch(e) { throw e; }
    }

    async leaveRoom(roomId) {
        if (!this.client) return false;
        try { await this.client.leave(roomId); setTimeout(() => this.loadRooms(), 500); return true; }
        catch(e) { return false; }
    }

    // ✅ Fix 4 : Création DM avec marquage m.direct correct
    async getOrCreateRoomForUser(userId) {
        if (!this.client) throw new Error('Client non connecté');

        // 1. Vérifier dans m.direct account data
        try {
            const directData = this.client.getAccountData('m.direct')?.getContent() || {};
            const userDMRooms = directData[userId] || [];
            for (const roomId of userDMRooms) {
                const room = this.client.getRoom(roomId);
                if (room && room.getMyMembership() === 'join') return roomId;
            }
        } catch(e) {}

        // 2. Chercher dans les rooms existantes
        const rooms = this.client.getRooms();
        for (const room of rooms) {
            if (room.getMyMembership() !== 'join') continue;
            const members = room.getJoinedMembers();
            if (members.length <= 2 && members.some(m => m.userId === userId)) return room.roomId;
        }

        // 3. Créer une nouvelle room DM
        const resp = await this.client.createRoom({
            preset: 'trusted_private_chat',
            invite: [userId],
            is_direct: true,
            initial_state: [{ type: 'm.room.guest_access', state_key: '', content: { guest_access: 'forbidden' } }]
        });
        const roomId = resp.room_id;

        // 4. Marquer dans m.direct account data
        try {
            const currentDMs = this.client.getAccountData('m.direct')?.getContent() || {};
            if (!currentDMs[userId]) currentDMs[userId] = [];
            if (!currentDMs[userId].includes(roomId)) currentDMs[userId].push(roomId);
            await this.client.setAccountData('m.direct', currentDMs);
            console.log('[Matrix] ✅ Room DM marquée dans m.direct:', roomId);
        } catch(e) { console.warn('[Matrix] setAccountData m.direct:', e.message); }

        // 5. Recharger les rooms immédiatement
        setTimeout(() => this.loadRooms(), 500);
        setTimeout(() => this.loadRooms(), 2000); // double reload pour s'assurer

        return roomId;
    }

    async createDirectRoom(userId) { return this.getOrCreateRoomForUser(userId); }

    getUserId()      { return this.userId; }
    getUserProfile() { return this._profile; }
    getClient()      { return this.client; }

    async setDisplayName(name) {
        if (!this.client) return false;
        try { await this.client.setDisplayName(name); this._profile.displayname = name; return true; }
        catch(e) { return false; }
    }

    async uploadAvatar(file) {
        if (!this.client) return null;
        try {
            const url = await this.client.uploadContent(file, { onlyContentUri: true });
            await this.client.setAvatarUrl(url);
            this._profile.avatar_url = url;
            return url;
        } catch(e) { return null; }
    }

    async getAvatarBlobUrl(mxcUrl) {
        if (!this.client || !mxcUrl) return null;
        try { return this.client.mxcUrlToHttp(mxcUrl, 96, 96, 'crop') || null; }
        catch(e) { return null; }
    }

    async downloadMediaBlob(mxcUrl) {
        if (!mxcUrl) return null;
        if (this._mediaBlobCache[mxcUrl]) return this._mediaBlobCache[mxcUrl];
        const baseUrl = this.client.getHomeserverUrl();
        const sm      = mxcUrl.substring(6);
        const token   = this.client.getAccessToken();
        let response  = null;
        try { response = await fetch(`${baseUrl}/_matrix/client/v1/media/download/${sm}`, { headers: { 'Authorization': `Bearer ${token}` } }); } catch(e) {}
        if (!response?.ok) { try { response = await fetch(`${baseUrl}/_matrix/media/v3/download/${sm}?access_token=${encodeURIComponent(token)}`); } catch(e) {} }
        if (!response?.ok) { try { response = await fetch(`${baseUrl}/_matrix/media/v3/download/${sm}`); } catch(e) {} }
        if (!response?.ok) return null;
        const blob    = await response.blob();
        const blobUrl = URL.createObjectURL(blob);
        this._mediaBlobCache[mxcUrl] = blobUrl;
        return blobUrl;
    }

    async downloadAudioBlob(mxcUrl) { return this.downloadMediaBlob(mxcUrl); }

    mxcToHttpUrl(mxcUrl) {
        if (!mxcUrl?.startsWith('mxc://')) return null;
        const sm = mxcUrl.substring(6);
        return `${this.client.getHomeserverUrl()}/_matrix/client/v1/media/download/${sm}?access_token=${encodeURIComponent(this.client.getAccessToken())}`;
    }

    mxcToThumbnailUrl(mxcUrl, w = 320, h = 240) {
        if (!mxcUrl?.startsWith('mxc://')) return null;
        const sm = mxcUrl.substring(6);
        return `${this.client.getHomeserverUrl()}/_matrix/client/v1/media/thumbnail/${sm}?width=${w}&height=${h}&method=scale&access_token=${encodeURIComponent(this.client.getAccessToken())}`;
    }

    getNotifications() {
        return this._invitations.map(inv => ({ type: 'invitation', ...inv }));
    }

    getCallHistory()   { return JSON.parse(localStorage.getItem('sendt_call_history') || '[]'); }

    addCallToHistory(entry) {
        const history = this.getCallHistory();
        history.unshift({ ...entry, id: Date.now() });
        if (history.length > 100) history.splice(100);
        localStorage.setItem('sendt_call_history', JSON.stringify(history));
        window.dispatchEvent(new CustomEvent('call-history-updated'));
    }

    setCallActive(roomId) {
        this._callActive = true; this._activeCallRoomId = roomId;
        window.dispatchEvent(new CustomEvent('call-started', { detail: { roomId } }));
    }

    forceEndCall(reason = 'Connexion perdue') {
        if (typeof showToast === 'function') showToast(reason, 'error');
        this._stopRinging(); this.clearCallActive();
        window.dispatchEvent(new CustomEvent('call-force-ended', { detail: { reason } }));
        if (typeof uiController !== 'undefined') uiController.endCall?.();
    }

    endCall() { this.clearCallActive(); }

    async sendCallNegotiate(roomId, callId, description, streamMetadata) {
        if (!this.client) return;
        try {
            const content = { call_id: callId, version: 1, description };
            if (streamMetadata) content.sdp_stream_metadata = streamMetadata;
            await this.client.sendEvent(roomId, 'm.call.negotiate', content);
        } catch(e) {}
    }

    clearCallActive() {
        const wasActive = this._callActive;
        this._callActive = false; this._activeCallRoomId = null; this._isRinging = false;
        if (wasActive) window.dispatchEvent(new CustomEvent('call-ended'));
    }

    getPinnedMessages(roomId) {
        if (!this.client || !roomId) return [];
        try {
            const room = this.client.getRoom(roomId); if (!room) return [];
            const pinEvent = room.currentState?.getStateEvents('m.room.pinned_events', '');
            return pinEvent?.getContent?.()?.pinned || [];
        } catch(e) { return []; }
    }

    async pinMessage(roomId, eventId) {
        if (!this.client || !roomId || !eventId) return false;
        try {
            const current = this.getPinnedMessages(roomId);
            const updated = current.includes(eventId) ? current.filter(id => id !== eventId) : [...current, eventId];
            await this.client.sendStateEvent(roomId, 'm.room.pinned_events', { pinned: updated }, '');
            return true;
        } catch(e) { return false; }
    }

    isGroupRoom(roomId) {
        if (!this.client || !roomId) return false;
        try {
            const room = this.client.getRoom(roomId); if (!room) return false;
            return this._detectRoomType(room) === 'group';
        } catch(e) { return false; }
    }

    getMaxUploadSize() { return 50 * 1024 * 1024; }

    async replyToMessage(roomId, replyToMsg, text) {
        if (!this.client || !roomId) return false;
        try {
            await this.client.sendMessage(roomId, {
                msgtype: 'm.text', body: `> ${replyToMsg.message || ''}\n\n${text}`,
                'm.relates_to': { 'm.in_reply_to': { event_id: replyToMsg.eventId } }
            });
            return true;
        } catch(e) { return false; }
    }

    async sendEphemeralMessage(roomId, text, durationSeconds) {
        if (!this.client || !roomId) return false;
        try {
            await this.client.sendMessage(roomId, {
                msgtype: 'm.text', body: text,
                'sendt.ephemeral': { expires_at: Date.now() + durationSeconds * 1000, duration: durationSeconds }
            });
            return true;
        } catch(e) { return false; }
    }

    async sendReadReceipt(roomId, eventId) {
        if (!this.client || !roomId) return;
        try {
            const room = this.client.getRoom(roomId); if (!room) return;
            if (eventId) {
                const event = room.findEventById(eventId);
                if (event) await this.client.sendReadReceipt(event);
            } else {
                const events = room.getLiveTimeline().getEvents();
                if (events.length > 0) await this.client.sendReadReceipt(events[events.length - 1]);
            }
        } catch(e) {}
    }

    async forwardMessage(roomId, msg) {
        if (!this.client || !roomId || !msg) return false;
        try {
            if (msg.type === 'text') { await this.client.sendTextMessage(roomId, msg.message || ''); }
            else if (msg.mxcUrl) {
                const msgtype = msg.type === 'image' ? 'm.image' : msg.type === 'video' ? 'm.video'
                    : (msg.type === 'voice' || msg.type === 'audio') ? 'm.audio' : 'm.file';
                await this.client.sendMessage(roomId, { msgtype, url: msg.mxcUrl, body: msg.message || 'Fichier' });
            }
            return true;
        } catch(e) { return false; }
    }

    async searchPublicChannels(query = '') {
        if (!this.client) return [];
        try {
            const res = await this.client.publicRooms({ limit: 30, filter: query ? { generic_search_term: query } : undefined });
            return res.chunk || [];
        } catch(e) { return []; }
    }

    async joinChannel(roomIdOrAlias) {
        if (!this.client) return false;
        try { await this.client.joinRoom(roomIdOrAlias); setTimeout(() => this.loadRooms(), 1000); return true; }
        catch(e) { return false; }
    }

    async postStatus(statusData) {
        if (!this.client) return false;
        try {
            const existing = JSON.parse(localStorage.getItem('sendt_statuses') || '[]');
            existing.unshift({ ...statusData, id: Date.now(), timestamp: Date.now(), userId: this.userId });
            if (existing.length > 50) existing.splice(50);
            localStorage.setItem('sendt_statuses', JSON.stringify(existing));
            await this.client.setAccountData('sendt.status', { latest: statusData, timestamp: Date.now() }).catch(() => {});
            return true;
        } catch(e) { return false; }
    }

    async getMyStatuses() {
        try { return JSON.parse(localStorage.getItem('sendt_statuses') || '[]').filter(s => s.userId === this.userId); }
        catch(e) { return []; }
    }

    async getContactStatuses() {
        if (!this.client) return [];
        try {
            const results = [];
            for (const room of this.client.getRooms()) {
                const members = room.getJoinedMembers() || [];
                for (const member of members) {
                    if (member.userId === this.userId) continue;
                    try {
                        const data = await this.client.getAccountDataFromServer('sendt.status').catch(() => null);
                        if (data?.latest) results.push({ userId: member.userId, displayName: member.name || member.userId, status: { ...data.latest, timestamp: data.timestamp || Date.now() }, allStatuses: [{ ...data.latest, timestamp: data.timestamp || Date.now() }] });
                    } catch(e) {}
                    break;
                }
            }
            return results;
        } catch(e) { return []; }
    }

    async uploadStatusImage(file) {
        if (!this.client || !file) return null;
        try { return await this.client.uploadContent(file, { onlyContentUri: true }); }
        catch(e) { return null; }
    }

    async sendLocation(roomId, lat, lng, description = '') {
        if (!this.client || !roomId) return false;
        try {
            await this.client.sendMessage(roomId, {
                msgtype: 'm.location', body: description || `Position: ${lat.toFixed(6)}, ${lng.toFixed(6)}`,
                geo_uri: `geo:${lat},${lng}`, info: {},
                'm.location': { uri: `geo:${lat},${lng}`, description },
            });
            return true;
        } catch(e) { return false; }
    }

    async startLiveLocation(roomId, durationSeconds) {
        if (!this.client || !roomId) return false;
        try {
            const watchId = navigator.geolocation.watchPosition(
                async (pos) => { await this.sendLocation(roomId, pos.coords.latitude, pos.coords.longitude, 'Position en direct'); },
                () => {},
                { enableHighAccuracy: true, maximumAge: 10000 }
            );
            setTimeout(() => navigator.geolocation.clearWatch(watchId), durationSeconds * 1000);
            return true;
        } catch(e) { return false; }
    }

    async logout() {
        // ✅ Mettre la présence hors-ligne avant de se déconnecter
        try { this._setOwnPresence('offline'); await new Promise(r => setTimeout(r, 300)); } catch(e) {}
        try { if (this.client) { await this.client.logout(); this.client.stopClient(); } } catch(e) {}
        this.client = null; this.userId = null; this.accessToken = null;
        this._invitations = []; this._contacts = []; this._groups = []; this._channels = [];
        this._initialSyncComplete = false;
    }
}

const matrixManager = new MatrixManager();
console.log('✅ matrix-client.js v18.6 — Fix sonnerie sync, présence, read receipts, DM detection');
