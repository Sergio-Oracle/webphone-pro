// webrtc-manager.js — SENDT v15.8
// ✅ Nouveautés v15.8 :
// - Fix vidéo définitif : toggleScreenShare recréé getUserMedia frais + délai avant renegociation
// - Fix handleCallNegotiate : onunmute listener sur toutes les tracks après renegociation
// - Fix screen share groupe : _removeRemoteTrack distingue screen/caméra (hérité v15.6)
const GROUP_CALL_EVENT_TYPE = 'io.sendt.group_call';
class WebRTCManager {
    constructor() {
        this.peerConnection = null;
        this.localStream = null; this.remoteStream = null; this.screenStream = null;
        this.isAudioMuted = false; this.isVideoMuted = false; this.isSharingScreen = false;
        this.callTimer = null; this.callStartTime = null; this.currentCall = null;
        this.iceCandidatesQueue = []; this.iceSendTimeout = null;
        this.isAnswering = false; this.pendingAnswer = null; this.pendingIceCandidates = [];
        this._iceDisconnectTimer = null; this._callConnected = false; this._connectionState = 'idle';
        this.isVideoCall = false; this.localVideoEnabled = false; this.remoteVideoEnabled = false;
        this._originalVideoTrack = null; this._userMediaVideoSender = null; this._isRenegotiating = false;
        this._isOfferer = false; this._remoteAnswerApplied = false;
        this._turnCredentials = null; this._iceRestartCount = 0; this._maxIceRestarts = 2;
        // ✅ v15.6 : Screen share audio system tracking
        this._screenAudioSender = null; this._originalAudioTrack = null;
        // LiveKit
        this.livekitRoom = null; this.livekitParticipants = []; this.livekitLocalParticipant = null;
        this._livekitSDKLoaded = false; this._livekitSDKLoading = false;
        this._lk = null;
        // Features groupe
        this._handRaised = false;
        this._raisedHands = new Set();
        this._isGroupScreenSharing = false;
        this._groupScreenTrackPublication = null;
        // Group call chat @mentions
        this._lkMentionActive = false;
        this._lkMentionStartPos = 0;
        this._groupCallAutoEndTimer = null;
        // ✅ Fix : timestamp de connexion pour ignorer les anciens hangup
        this._callConnectedAt = null;
        window.addEventListener('call-force-ended', (e) => {
            console.warn('[WebRTC] call-force-ended reçu:', e.detail?.reason);
            this.cleanup();
        });
    }
    sanitize(t) {
        const d = document.createElement('div');
        d.textContent = String(t || '');
        return d.innerHTML;
    }
    _resetCallTimer() {
        if (this.callTimer) { clearInterval(this.callTimer); this.callTimer = null; }
        this.callStartTime = null;
        document.querySelectorAll('#call-duration, #lk-call-duration').forEach(el => el.textContent = '00:00');
    }
    // ═══════════════ RÉSOLUTION NOM D'AFFICHAGE ═══════════════
    _getDisplayName(identity) {
        if (!identity) return 'Inconnu';
        try {
            const cl = matrixManager.getClient();
            if (cl && this.currentCall?.roomId) {
                const room = cl.getRoom(this.currentCall.roomId);
                if (room) { const member = room.getMember(identity); if (member?.name) return member.name; }
                for (const r of cl.getRooms()) {
                    const m = r.getMember?.(identity);
                    if (m?.name && m.name !== identity) return m.name;
                }
            }
        } catch(e) {}
        const match = identity.match(/^@?([^:]+)/);
        return match ? match[1] : identity;
    }
    // ═══════════════ SDK LIVEKIT ═══════════════
    _resolveLiveKitGlobal() {
        if (typeof window.LivekitClient !== 'undefined' && window.LivekitClient.Room) { this._lk = window.LivekitClient; return true; }
        if (typeof window.LiveKit !== 'undefined' && window.LiveKit.Room) { this._lk = window.LiveKit; return true; }
        return false;
    }
    async _ensureLiveKit() {
        if (this._livekitSDKLoaded && this._lk) return true;
        if (this._resolveLiveKitGlobal()) { this._livekitSDKLoaded = true; return true; }
        if (this._livekitSDKLoading) {
            return new Promise((resolve) => {
                const check = setInterval(() => {
                    if (!this._livekitSDKLoading) { clearInterval(check); resolve(this._resolveLiveKitGlobal()); }
                }, 100);
                setTimeout(() => { clearInterval(check); this._livekitSDKLoading = false; resolve(false); }, 15000);
            });
        }
        this._livekitSDKLoading = true;
        const cdnUrls = [
            'https://cdn.jsdelivr.net/npm/livekit-client@2.5.7/dist/livekit-client.umd.min.js',
            'https://cdn.jsdelivr.net/npm/livekit-client/dist/livekit-client.umd.min.js',
            'https://unpkg.com/livekit-client@2.5.7/dist/livekit-client.umd.min.js',
        ];
        for (const url of cdnUrls) {
            if (document.querySelector(`script[src="${url}"]`)) {
                await new Promise(r => setTimeout(r, 800));
                if (this._resolveLiveKitGlobal()) { this._livekitSDKLoaded = true; this._livekitSDKLoading = false; return true; }
                continue;
            }
            const loaded = await new Promise((resolve) => {
                const s = document.createElement('script'); s.src = url; s.async = true;
                s.onload = () => resolve(this._resolveLiveKitGlobal());
                s.onerror = () => { s.remove(); resolve(false); };
                document.head.appendChild(s);
            });
            if (loaded) { this._livekitSDKLoaded = true; this._livekitSDKLoading = false; return true; }
        }
        this._livekitSDKLoading = false;
        return false;
    }
    // ═══════════════ TURN ═══════════════
    async _fetchTurnCredentials() {
        try {
            const client = matrixManager.getClient(); if (!client) return null;
            const response = await client.turnServer();
            if (response?.uris?.length) {
                this._turnCredentials = { uris: response.uris, username: response.username, password: response.password };
                return this._turnCredentials;
            }
            return null;
        } catch (e) { return null; }
    }
    _buildIceServers() {
        const iceServers = [];
        if (this._turnCredentials?.uris) {
            iceServers.push({ urls: this._turnCredentials.uris, username: this._turnCredentials.username, credential: this._turnCredentials.password });
        }
        if (CONFIG.ICE_SERVERS) {
            CONFIG.ICE_SERVERS.forEach(server => {
                const urls = Array.isArray(server.urls) ? server.urls : [server.urls];
                const isTurn = urls.some(u => u.startsWith('turn:') || u.startsWith('turns:'));
                if (isTurn) { if (server.username && server.credential) iceServers.push(server); }
                else iceServers.push(server);
            });
        }
        if (iceServers.length === 0) iceServers.push({ urls: 'stun:stun.l.google.com:19302' });
        return iceServers;
    }
    // ═══════════════ MEDIA ═══════════════
    async initializeMedia(withVideo = false) {
        try {
            this.localStream = await navigator.mediaDevices.getUserMedia({
                audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
                video: withVideo ? { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' } : false
            });
            const lv = document.getElementById('local-video'); if (lv) lv.srcObject = this.localStream;
            this._originalVideoTrack = withVideo ? (this.localStream.getVideoTracks()[0] || null) : null;
            this.localVideoEnabled = withVideo;
            return true;
        } catch (e) {
            if (withVideo) {
                try {
                    this.localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
                    this.localVideoEnabled = false;
                    if (typeof showToast === 'function') showToast('Caméra indisponible, audio seul', 'warning');
                    return true;
                } catch(e2) {}
            }
            if (typeof showToast === 'function') showToast('Impossible d\'accéder au micro' + (withVideo ? '/caméra' : ''), 'error');
            return false;
        }
    }
    // ═══════════════ PEER CONNECTION (1:1) ═══════════════
    async createPeerConnection() {
        await this._fetchTurnCredentials();
        const iceServers = this._buildIceServers();
        try {
            this.peerConnection = new RTCPeerConnection({
                iceServers, iceTransportPolicy: 'all',
                bundlePolicy: 'max-bundle', rtcpMuxPolicy: 'require', iceCandidatePoolSize: 1
            });
        } catch (e) {
            this.peerConnection = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
        }
        if (this.localStream) {
            this.localStream.getTracks().forEach(track => {
                const sender = this.peerConnection.addTrack(track, this.localStream);
                if (track.kind === 'video') this._userMediaVideoSender = sender;
            });
        }
        this.peerConnection.ontrack = (event) => {
            if (!this.remoteStream) {
                this.remoteStream = new MediaStream();
                const rv = document.getElementById('remote-video');
                if (rv) rv.srcObject = this.remoteStream;
            }
            this.remoteStream.addTrack(event.track);
            if (event.track.kind === 'video') {
                this.remoteVideoEnabled = true; this._updateCallScreenUI();
                event.track.onended = () => { this.remoteVideoEnabled = false; this._updateCallScreenUI(); };
                event.track.onmute = () => { this.remoteVideoEnabled = false; this._updateCallScreenUI(); };
                event.track.onunmute = () => { this.remoteVideoEnabled = true; this._updateCallScreenUI(); };
            }
        };
        this.peerConnection.onicecandidate = (event) => {
            if (event.candidate) {
                this.iceCandidatesQueue.push(event.candidate);
                if (!this.iceSendTimeout) this.iceSendTimeout = setTimeout(() => this.sendIceCandidatesBatch(), 100);
            }
        };
        this.peerConnection.oniceconnectionstatechange = () => {
            const state = this.peerConnection?.iceConnectionState;
            this._emitConnectionState(state);
            if (state === 'disconnected') {
                this._iceDisconnectTimer = setTimeout(() => {
                    const s = this.peerConnection?.iceConnectionState;
                    if (s === 'disconnected' || s === 'failed') {
                        if (this._iceRestartCount < this._maxIceRestarts) this._attemptIceRestart();
                        else matrixManager.forceEndCall('Connexion perdue');
                    }
                }, 5000);
            } else if (state === 'failed') {
                if (this._iceDisconnectTimer) clearTimeout(this._iceDisconnectTimer);
                if (this._iceRestartCount < this._maxIceRestarts) this._attemptIceRestart();
                else matrixManager.forceEndCall('Échec de connexion');
            } else if (state === 'connected' || state === 'completed') {
                if (this._iceDisconnectTimer) { clearTimeout(this._iceDisconnectTimer); this._iceDisconnectTimer = null; }
                this._iceRestartCount = 0;
            }
        };
        this.peerConnection.onconnectionstatechange = () => {
            const state = this.peerConnection?.connectionState;
            const statusEl = document.getElementById('call-status');
            this._emitConnectionState(state);
            if (state === 'connected') {
                if (statusEl) statusEl.textContent = 'Connecté';
                if (typeof soundManager !== 'undefined') { soundManager.stopRingback(); soundManager.stopCallRingtone(); }
                matrixManager._stopRinging?.();
                this._callConnected = true;
                this._callConnectedAt = Date.now(); // ✅ timestamp connexion réelle
                this.startCallTimer(); this._updateCallScreenUI();
            } else if (state === 'disconnected') {
                if (statusEl) statusEl.textContent = 'Reconnexion...';
            } else if (state === 'failed') {
                if (statusEl) statusEl.textContent = 'Échec de connexion';
            }
        };
        this.peerConnection.onsignalingstatechange = () => {};
        return this.peerConnection;
    }
    async _attemptIceRestart() {
        if (!this.peerConnection || !this.currentCall) return;
        this._iceRestartCount++;
        try {
            const offer = await this.peerConnection.createOffer({ iceRestart: true });
            await this.peerConnection.setLocalDescription(offer);
            await matrixManager.sendCallNegotiate(this.currentCall.roomId, this.currentCall.callId, { type: 'offer', sdp: offer.sdp });
        } catch(e) { console.warn('[WebRTC] ICE restart échoué:', e.message); }
    }
    _buildStreamMetadata() {
        const m = {};
        if (this.localStream) m[this.localStream.id] = { purpose: 'm.usermedia' };
        if (this.screenStream) m[this.screenStream.id] = { purpose: 'm.screenshare' };
        return m;
    }
    _emitConnectionState(state) {
        this._connectionState = state;
        window.dispatchEvent(new CustomEvent('call-connection-state', { detail: { state } }));
    }
    _updateCallScreenUI() {
        const cs = document.getElementById('call-screen'); if (!cs) return;
        const hasV = this.localVideoEnabled || this.remoteVideoEnabled;
        if (this.isVideoCall || hasV) { cs.classList.add('video-call'); cs.classList.remove('audio-call'); }
        else { cs.classList.add('audio-call'); cs.classList.remove('video-call'); }
        const lv = document.getElementById('local-video');
        if (lv) lv.style.display = (this.localVideoEnabled || this.isSharingScreen) ? '' : 'none';
    }
    // ✅ v16.2 : Get peer user ID from 1:1 room
    _getPeerUserId(roomId) {
        try {
            const room = matrixManager.getClient()?.getRoom(roomId);
            if (!room) return roomId;
            const me = matrixManager.getUserId();
            const members = room.getJoinedMembers();
            const other = members.find(m => m.userId !== me);
            return other?.userId || roomId;
        } catch(e) { return roomId; }
    }

    // ═══════════════ APPEL 1:1 — APPELANT ═══════════════
    async startCall(roomId, withVideo = false) {
        if (matrixManager.isGroupRoom(roomId)) return this.startGroupCall(roomId, withVideo);
        try {
            this._callRoomId = roomId;
            this._callStartTs = Date.now();
            this.isAnswering = false; this._isOfferer = true; this._remoteAnswerApplied = false;
            this._callConnected = false; this._callConnectedAt = null; this._iceRestartCount = 0;
            this.isVideoCall = withVideo; this.localVideoEnabled = withVideo; this.remoteVideoEnabled = false;
            this._resetCallTimer(); this._emitConnectionState('connecting');
            if (!await this.initializeMedia(withVideo)) return false;
            await this.createPeerConnection();
            const offer = await this.peerConnection.createOffer({ offerToReceiveAudio: true, offerToReceiveVideo: withVideo });
            await this.peerConnection.setLocalDescription(offer);
            await this.sendCallInvite(roomId, offer, this._buildStreamMetadata());
            matrixManager.setCallActive(roomId);
            if (typeof soundManager !== 'undefined') soundManager.playRingback();
            this._emitConnectionState('ringing'); this._updateCallScreenUI();
            if (this.pendingAnswer) { await this._applyRemoteAnswer(this.pendingAnswer); this.pendingAnswer = null; }
            for (const c of this.pendingIceCandidates) { try { await this.peerConnection.addIceCandidate(new RTCIceCandidate(c)); } catch(e) {} }
            this.pendingIceCandidates = [];
            return true;
        } catch (e) {
            console.error('[WebRTC]', e);
            if (typeof soundManager !== 'undefined') soundManager.stopRingback();
            if (typeof showToast === 'function') showToast('Erreur démarrage appel', 'error');
            return false;
        }
    }
    // ═══════════════ GROUP CALL ═══════════════
    async startGroupCall(roomId, withVideo = false, callId = null) {
        try {
            this.isVideoCall = withVideo;
            this._handRaised = false;
            this._raisedHands = new Set();
            this._isGroupScreenSharing = false;
            if (this._groupCallAutoEndTimer) { clearTimeout(this._groupCallAutoEndTimer); this._groupCallAutoEndTimer = null; }
            this._resetCallTimer(); this._emitConnectionState('connecting');
            if (this.localStream) { this.localStream.getTracks().forEach(t => t.stop()); this.localStream = null; }
            const lv = document.getElementById('local-video'); if (lv) lv.srcObject = null;
            if (!await this._ensureLiveKit()) { if (typeof showToast === 'function') showToast('SDK LiveKit indisponible', 'error'); return false; }
            const LK = this._lk;
            const isInitiator = !callId;
            if (isInitiator) callId = `group_${Date.now()}`;
            const livekitRoomName = callId;
            let token = null;
            const ep = CONFIG.LIVEKIT.TOKEN_ENDPOINT;
            try {
                const matrixToken = matrixManager.getAccessToken?.() || matrixManager.accessToken || '';
                const res = await fetch(`${ep}?room=${encodeURIComponent(livekitRoomName)}`, {
                    headers: { 'Authorization': `Bearer ${matrixToken}` }
                });
                const ct = res.headers.get('content-type') || '';
                if (res.ok && ct.includes('application/json')) { const d = await res.json(); if (d.token) token = d.token; }
                if (!res.ok) console.warn('[LiveKit] Backend token error:', res.status);
            } catch(e) { console.warn('[LiveKit] Backend token fetch error:', e.message); }
            if (!token) { if (typeof showToast === 'function') showToast('Impossible d\'obtenir le token d\'appel. Réessayez.', 'error'); return false; }
            if (isInitiator) await this._sendGroupCallNotification(roomId, withVideo, callId, livekitRoomName);
            this.currentCall = { callId, roomId, isGroup: true, livekitRoomName };
            this._callConnectedAt = Date.now(); // ✅ timestamp pour filtrer les anciens hangup
            this.livekitRoom = new LK.Room({ adaptiveStream: true, dynacast: true });
            await this.livekitRoom.connect(CONFIG.LIVEKIT.URL, token);
            console.log('[LiveKit] Connecté room:', livekitRoomName);
            this.livekitLocalParticipant = this.livekitRoom.localParticipant;
            this._buildGroupCallScreen();
            await this._enableLiveKitMedia(LK, withVideo);
            this._attachLocalLiveKitVideo(LK);
            this.livekitRoom.remoteParticipants.forEach((p) => {
                this._ensureAvatarTile(p.identity);
                p.trackPublications.forEach((pub) => {
                    if (pub.isSubscribed && pub.track) this._renderRemoteTrack(pub.track, p.identity);
                });
            });
            this.livekitRoom
                .on(LK.RoomEvent.DataReceived, (data, participant) => {
                    this._handleGroupDataMessage(data, participant?.identity);
                })
                .on(LK.RoomEvent.TrackSubscribed, (track, pub, participant) => {
                    this._renderRemoteTrack(track, participant.identity);
                })
                .on(LK.RoomEvent.TrackUnsubscribed, (track, pub, participant) => {
                    this._removeRemoteTrack(participant.identity, track.kind, track.source);
                })
                .on(LK.RoomEvent.LocalTrackPublished, (pub) => {
                    if (pub.kind === 'video') this._attachLocalLiveKitVideo(LK);
                })
                .on(LK.RoomEvent.TrackMuted, (pub, participant) => {
                    this._updateParticipantMuteUI(participant.identity, pub.kind, true);
                })
                .on(LK.RoomEvent.TrackUnmuted, (pub, participant) => {
                    this._updateParticipantMuteUI(participant.identity, pub.kind, false);
                })
                .on(LK.RoomEvent.ParticipantConnected, (p) => {
                    if (this._groupCallAutoEndTimer) {
                        clearTimeout(this._groupCallAutoEndTimer);
                        this._groupCallAutoEndTimer = null;
                    }
                    this._ensureAvatarTile(p.identity);
                    this._updateGroupCallParticipants();
                })
                .on(LK.RoomEvent.ParticipantDisconnected, (p) => {
                    this._removeParticipantUI(p.identity);
                    this._raisedHands.delete(p.identity);
                    this._updateGroupCallParticipants();
                    this._checkGroupCallAutoEnd();
                })
                .on(LK.RoomEvent.ActiveSpeakersChanged, (speakers) => {
                    document.querySelectorAll('.group-video-tile').forEach(t => t.classList.remove('speaking'));
                    speakers.forEach(p => {
                        const safeId = p.identity.replace(/[^a-zA-Z0-9_-]/g, '_');
                        const tile = document.getElementById('lk-tile-' + safeId) || document.getElementById('lk-local-tile');
                        if (tile) tile.classList.add('speaking');
                    });
                })
                .on(LK.RoomEvent.Disconnected, () => {
                    this.cleanup();
                    matrixManager.endCall?.();
                })
                .on(LK.RoomEvent.ConnectionStateChanged, (state) => {
                    if (state === 'disconnected' || state === 'failed') {
                        if (isInitiator && this.livekitRoom?.remoteParticipants.size === 0) {
                            this._sendGroupCallEndNotification().catch(() => {});
                        }
                        this.cleanup();
                    }
                });
            this._updateGroupCallParticipants();
            matrixManager.setCallActive(roomId);
            this._emitConnectionState('connected');
            this.startCallTimer();
            return true;
        } catch (e) {
            console.error('[LiveKit] Group call error:', e);
            if (typeof showToast === 'function') showToast('Erreur appel de groupe: ' + (e.message || 'inconnue'), 'error');
            this.cleanup();
            return false;
        }
    }
    _checkGroupCallAutoEnd() {
        if (!this.livekitRoom) return;
        const remoteCount = this.livekitRoom.remoteParticipants.size;
        if (remoteCount === 0) {
            const statusEl = document.getElementById('call-status');
            if (statusEl) statusEl.textContent = 'Appel terminé — vous êtes seul';
            if (typeof showToast === 'function') showToast('Tous les participants ont quitté l\'appel', 'info');
            if (this._groupCallAutoEndTimer) clearTimeout(this._groupCallAutoEndTimer);
            this._groupCallAutoEndTimer = setTimeout(() => {
                if (!this.livekitRoom) return;
                if (this.livekitRoom.remoteParticipants.size === 0) {
                    this._sendGroupCallEndNotification().catch(() => {});
                    this.cleanup();
                    matrixManager.endCall?.();
                    if (typeof uiController !== 'undefined') uiController.endCall?.();
                }
            }, 3000);
        }
    }
    async _enableLiveKitMedia(LK, withVideo) {
        if (withVideo) {
            try { await this.livekitLocalParticipant.enableCameraAndMicrophone(); this.localVideoEnabled = true; return; }
            catch(e) { console.warn('[LiveKit] enableCameraAndMicrophone:', e.message); }
            try { await this.livekitLocalParticipant.setMicrophoneEnabled(true); this.localVideoEnabled = false; if (typeof showToast === 'function') showToast('Caméra indisponible, audio seul', 'warning'); return; }
            catch(e2) {}
        } else {
            try { await this.livekitLocalParticipant.setMicrophoneEnabled(true); this.localVideoEnabled = false; return; }
            catch(e) {}
        }
    }
    _attachLocalLiveKitVideo(LK) {
        if (!this.livekitLocalParticipant) return;
        let videoTrack = null;
        for (const [, pub] of this.livekitLocalParticipant.trackPublications) {
            if (pub.kind === 'video' && pub.track) {
                try { if (LK.Track && pub.source === LK.Track.Source.ScreenShare) continue; } catch(e) {}
                videoTrack = pub.track; break;
            }
        }
        const localTile = document.getElementById('lk-local-tile'); if (!localTile) return;
        let videoEl = document.getElementById('lk-local-video');
        if (!videoEl) {
            videoEl = document.createElement('video');
            videoEl.id = 'lk-local-video'; videoEl.autoplay = true; videoEl.playsinline = true; videoEl.muted = true;
            videoEl.style.cssText = 'width:100%;height:100%;object-fit:cover;transform:scaleX(-1);display:block;position:absolute;top:0;left:0;z-index:1;';
            const label = localTile.querySelector('.group-video-label');
            localTile.insertBefore(videoEl, label);
        }
        const avatarEl = document.getElementById('lk-local-avatar');
        if (videoTrack) {
            videoTrack.attach(videoEl); videoEl.style.display = 'block';
            this.localVideoEnabled = true;
            if (avatarEl) avatarEl.style.display = 'none';
        } else {
            videoEl.style.display = 'none';
            if (avatarEl) avatarEl.style.display = 'flex';
        }
    }
    async _sendGroupCallNotification(roomId, withVideo, callId, livekitRoomName) {
        try {
            const cl = matrixManager.getClient(); if (!cl) return;
            await cl.sendEvent(roomId, GROUP_CALL_EVENT_TYPE, {
                call_id: callId, version: 1, action: 'invite',
                with_video: withVideo, livekit_url: CONFIG.LIVEKIT.URL,
                livekit_room: livekitRoomName, caller: matrixManager.getUserId(),
                timestamp: Date.now()
            });
        } catch (e) { console.warn('[LiveKit] Notification Matrix impossible:', e.message); }
    }
    async _sendGroupCallEndNotification() {
        if (!this.currentCall?.isGroup) return;
        try {
            const cl = matrixManager.getClient(); if (!cl) return;
            await cl.sendEvent(this.currentCall.roomId, GROUP_CALL_EVENT_TYPE, {
                call_id: this.currentCall.callId, version: 1, action: 'hangup',
                caller: matrixManager.getUserId(), timestamp: Date.now()
            });
        } catch(e) {}
    }
    async joinGroupCall(roomId, withVideo = false, callId) {
        return this.startGroupCall(roomId, withVideo, callId);
    }
    handleGroupCallEvent(event, roomId) {
        const content = event.getContent?.() || event.content;
        if (!content) return;
        const myUserId = matrixManager.getUserId();
        if (myUserId && content.caller === myUserId) return;
        if (content.action === 'invite') {
            const age = Date.now() - (content.timestamp || 0);
            if (content.timestamp > 0 && age > 60000) return;
            this._showIncomingGroupCall(roomId, content.caller, content.with_video, content.call_id);
        } else if (content.action === 'hangup') {
            if (this.livekitRoom && this.currentCall?.roomId === roomId && this.currentCall?.callId === content.call_id) {
                const remoteCount = this.livekitRoom.remoteParticipants?.size || 0;
                if (remoteCount === 0) {
                    if (typeof showToast === 'function') showToast("L'appel de groupe a pris fin", 'info');
                    this.cleanup(); matrixManager.endCall?.();
                } else {
                    const name = this._getDisplayName(content.caller);
                    if (typeof showToast === 'function') showToast(`${name} a quitté l'appel`, 'info');
                }
            } else if (window._pendingGroupCall?.callId === content.call_id) {
                window._pendingGroupCall = null;
                if (typeof soundManager !== 'undefined') soundManager.stopCallRingtone?.();
                matrixManager._stopRinging?.();
                const modal = document.getElementById('incoming-call-modal');
                if (modal) { modal.classList.remove('show'); modal.classList.remove('active'); }
                if (typeof showToast === 'function') showToast("L'appel a été annulé", 'info');
            }
        }
    }
    _showIncomingGroupCall(roomId, callerId, withVideo, callId) {
        const modal = document.getElementById('incoming-call-modal');
        const nameEl = document.getElementById('incoming-caller-name');
        const typeEl = document.getElementById('incoming-call-type');
        if (!modal) return;
        const displayName = this._getDisplayName(callerId);
        if (nameEl) nameEl.textContent = displayName;
        if (typeEl) typeEl.textContent = withVideo ? '📹 Appel vidéo de groupe' : '📞 Appel audio de groupe';
        modal.classList.add('show'); modal.classList.add('active');
        matrixManager._startRinging?.();
        window._pendingGroupCall = { roomId, callerId, withVideo, callId };
    }
    acceptGroupCall() {
        const p = window._pendingGroupCall; if (!p) return;
        window._pendingGroupCall = null;
        matrixManager._stopRinging?.();
        if (typeof soundManager !== 'undefined') soundManager.stopCallRingtone?.();
        const modal = document.getElementById('incoming-call-modal');
        if (modal) { modal.classList.remove('show'); modal.classList.remove('active'); }
        document.getElementById('app-screen')?.classList.remove('active');
        const cs = document.getElementById('call-screen');
        if (cs) { cs.classList.add('active'); cs.classList.toggle('video-call', p.withVideo); cs.classList.toggle('audio-call', !p.withVideo); }
        const nameEl = document.getElementById('call-contact-name');
        if (nameEl) nameEl.textContent = this._getDisplayName(p.callerId) || 'Groupe';
        this.joinGroupCall(p.roomId, p.withVideo, p.callId);
    }
    // ═══════════════ DATA CHANNEL ═══════════════
    _handleGroupDataMessage(data, senderIdentity) {
        try {
            const msg = JSON.parse(new TextDecoder().decode(data));
            if (msg.type === 'raise_hand') {
                if (msg.raised) {
                    this._raisedHands.add(senderIdentity);
                    const dn = this._getDisplayName(senderIdentity);
                    if (typeof showToast === 'function') showToast(`✋ ${dn} lève la main`, 'info');
                } else { this._raisedHands.delete(senderIdentity); }
                this._updateHandRaiseUI(senderIdentity, msg.raised);
            }
        } catch(e) {}
    }
    async _publishDataMessage(payload) {
        if (!this.livekitLocalParticipant) return;
        try {
            const data = new TextEncoder().encode(JSON.stringify(payload));
            await this.livekitLocalParticipant.publishData(data, { reliable: true });
        } catch(e) {}
    }
    async toggleRaiseHand() {
        this._handRaised = !this._handRaised;
        const handBtn = document.getElementById('lk-btn-hand');
        const handIcon = document.getElementById('lk-hand-icon');
        const localHand = document.getElementById('lk-local-hand');
        if (handBtn) handBtn.classList.toggle('raised', this._handRaised);
        if (handIcon) handIcon.textContent = this._handRaised ? '✋' : '🖐️';
        if (localHand) localHand.style.display = this._handRaised ? 'flex' : 'none';
        await this._publishDataMessage({ type: 'raise_hand', raised: this._handRaised });
        if (typeof showToast === 'function') showToast(this._handRaised ? '✋ Main levée' : 'Main baissée', 'info');
    }
    _updateHandRaiseUI(identity, raised) {
        const safeId = identity.replace(/[^a-zA-Z0-9_-]/g, '_');
        const el = document.getElementById(`lk-hand-${safeId}`);
        if (el) el.style.display = raised ? 'flex' : 'none';
    }
    // ═══════════════ PARTAGE D'ÉCRAN — ✅ FIX COMPLET ═══════════════
    async toggleGroupScreenShare() {
        if (!this.livekitLocalParticipant) return;
        try {
            if (this._isGroupScreenSharing) {
                // ✅ Désactiver le partage d'écran
                await this.livekitLocalParticipant.setScreenShareEnabled(false);
                this._isGroupScreenSharing = false;
                this._groupScreenTrackPublication = null;
                const btn = document.getElementById('lk-btn-screen');
                const icon = document.getElementById('lk-screen-icon');
                if (btn) btn.classList.remove('active');
                if (icon) icon.className = 'fas fa-desktop';
                // ✅ FIX : Fermer le tile de partage d'écran
                this._closeScreenShareTile();
                // ✅ FIX : Restaurer la vidéo locale si nécessaire
                if (this.localVideoEnabled) {
                    await this.livekitLocalParticipant.setCameraEnabled(true);
                    setTimeout(() => this._attachLocalLiveKitVideo(this._lk), 300);
                }
                // ✅ FIX v15.5 : Re-render toutes les vidéos des participants distants
                // (le tile screen share avait masqué les vidéos des autres participants)
                setTimeout(() => this._reattachAllRemoteVideos(), 400);
                if (typeof showToast === 'function') showToast('Partage d\'écran arrêté', 'info');
            } else {
                let screenPub = null;
                try {
                    screenPub = await this.livekitLocalParticipant.setScreenShareEnabled(true, {
                        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, suppressLocalAudioPlayback: false, systemAudio: 'include' },
                        selfBrowserSurface: 'exclude', surfaceSwitching: 'include'
                    });
                } catch(e) {
                    screenPub = await this.livekitLocalParticipant.setScreenShareEnabled(true);
                }
                if (screenPub) {
                    this._isGroupScreenSharing = true;
                    this._groupScreenTrackPublication = screenPub;
                    const btn = document.getElementById('lk-btn-screen');
                    const icon = document.getElementById('lk-screen-icon');
                    if (btn) btn.classList.add('active');
                    if (icon) icon.className = 'fas fa-stop-circle';
                    if (typeof showToast === 'function') showToast('Écran partagé', 'success');
                    try {
                        const vt = screenPub.videoTrack?.mediaStreamTrack;
                        if (vt) vt.onended = () => { if (this._isGroupScreenSharing) this.toggleGroupScreenShare(); };
                    } catch(e) {}
                }
            }
        } catch(e) {
            if (e.name !== 'NotAllowedError' && typeof showToast === 'function') showToast('Erreur partage écran: ' + (e.message || ''), 'error');
            this._isGroupScreenSharing = false;
        }
    }
    // ═══════════════ ENVOI FICHIER ═══════════════
    openGroupCallFilePicker() {
        let fi = document.getElementById('lk-file-input');
        if (!fi) {
            fi = document.createElement('input');
            fi.type = 'file'; fi.id = 'lk-file-input';
            fi.accept = 'image/*,video/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx,.zip,.txt';
            fi.style.display = 'none';
            fi.addEventListener('change', (e) => this._handleGroupCallFileSelected(e));
            document.body.appendChild(fi);
        }
        fi.value = ''; fi.click();
    }
    async _handleGroupCallFileSelected(e) {
        const file = e.target.files[0];
        if (!file || !this.currentCall) return;
        const maxSize = matrixManager.getMaxUploadSize?.() || 50 * 1024 * 1024;
        if (file.size > maxSize) { if (typeof showToast === 'function') showToast('Fichier trop volumineux', 'error'); return; }
        if (typeof showToast === 'function') showToast('Envoi en cours...', 'info');
        const ok = await matrixManager.sendFile(this.currentCall.roomId, file);
        if (ok) {
            if (typeof showToast === 'function') showToast('Fichier envoyé !', 'success');
            const panel = document.getElementById('lk-chat-panel');
            if (panel?.classList.contains('show')) setTimeout(() => this.renderGroupCallMessages(), 500);
        } else {
            if (typeof showToast === 'function') showToast('Erreur envoi fichier', 'error');
        }
    }
    // ═══════════════ INDICATEURS UI ═══════════════
    _updateParticipantMuteUI(identity, kind, muted) {
        const safeId = identity.replace(/[^a-zA-Z0-9_-]/g, '_');
        if (kind === 'audio') {
            const icon = document.getElementById(`lk-mute-${safeId}`);
            if (icon) icon.style.display = muted ? 'flex' : 'none';
        } else if (kind === 'video') {
            const videoEl = document.getElementById(`lk-video-${safeId}`);
            const avatarEl = document.getElementById(`lk-avatar-${safeId}`);
            if (muted) { if (videoEl) videoEl.style.display = 'none'; if (avatarEl) avatarEl.style.display = 'flex'; }
            else { if (videoEl) videoEl.style.display = 'block'; if (avatarEl) avatarEl.style.display = 'none'; }
        }
    }
    // ═══════════════ TILES PARTICIPANTS ═══════════════
    _ensureAvatarTile(identity) {
        const safeId = identity.replace(/[^a-zA-Z0-9_-]/g, '_');
        const container = document.getElementById('group-video-container');
        if (!container) return null;
        let tile = document.getElementById(`lk-tile-${safeId}`);
        if (!tile) {
            tile = document.createElement('div');
            tile.id = `lk-tile-${safeId}`; tile.className = 'group-video-tile';
            const displayName = this._getDisplayName(identity);
            const initials = displayName.substring(0, 2).toUpperCase();
            const colors = ['#25D366','#128C7E','#4facfe','#f093fb','#ffa726','#e74c3c','#9b59b6','#1abc9c','#e67e22'];
            const bg = colors[identity.charCodeAt(0) % colors.length];
            tile.innerHTML = `
                <div class="lk-avatar-circle" id="lk-avatar-${safeId}" style="background:${bg}">${initials}</div>
                <div class="group-video-label">${this.sanitize(displayName)}</div>
                <div class="lk-mute-icon" id="lk-mute-${safeId}" style="display:none"><i class="fas fa-microphone-slash"></i></div>
                <div class="lk-hand-icon" id="lk-hand-${safeId}" style="display:none">✋</div>`;
            container.appendChild(tile);
            this._refreshGridLayout();
        }
        return tile;
    }
    _renderRemoteTrack(track, identity) {
        const safeId = identity.replace(/[^a-zA-Z0-9_-]/g, '_');
        if (track.kind === 'video') {
            const isScreen = track.source === 'screen_share' ||
                (this._lk?.Track && track.source === this._lk.Track.Source.ScreenShare);
            if (isScreen) { this._renderScreenShareTile(track, identity); return; }
            const tile = this._ensureAvatarTile(identity); if (!tile) return;
            const avatarEl = document.getElementById(`lk-avatar-${safeId}`);
            if (avatarEl) avatarEl.style.display = 'none';
            document.getElementById(`lk-video-${safeId}`)?.remove();
            const videoEl = document.createElement('video');
            videoEl.id = `lk-video-${safeId}`; videoEl.autoplay = true; videoEl.playsinline = true; videoEl.muted = false;
            videoEl.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;object-fit:cover;display:block;z-index:1;';
            track.attach(videoEl); tile.insertBefore(videoEl, tile.firstChild);
            this._refreshGridLayout();
        } else if (track.kind === 'audio') {
            document.getElementById(`lk-audio-${safeId}`)?.remove();
            const audioEl = document.createElement('audio');
            audioEl.id = `lk-audio-${safeId}`; audioEl.autoplay = true;
            track.attach(audioEl); document.body.appendChild(audioEl);
            const muteIcon = document.getElementById(`lk-mute-${safeId}`);
            if (muteIcon) muteIcon.style.display = 'none';
        }
    }
    _renderScreenShareTile(track, identity) {
        let screenTile = document.getElementById('lk-screen-share-tile');
        if (!screenTile) {
            screenTile = document.createElement('div');
            screenTile.id = 'lk-screen-share-tile';
            screenTile.className = 'lk-screen-share-overlay';
            const displayName = this._getDisplayName(identity);
            screenTile.innerHTML = `
                <div class="lk-screen-share-label">
                    <i class="fas fa-desktop"></i> ${this.sanitize(displayName)} partage son écran
                    <button onclick="webrtcManager._closeScreenShareTile()" class="lk-close-screen-btn">✕</button>
                </div>
                <video id="lk-screen-video" autoplay playsinline style="width:100%;height:calc(100% - 40px);object-fit:contain;background:#000"></video>`;
            const cs = document.getElementById('call-screen'); if (cs) cs.appendChild(screenTile);
        }
        const videoEl = document.getElementById('lk-screen-video');
        if (videoEl) track.attach(videoEl);
    }
    _closeScreenShareTile() {
        const tile = document.getElementById('lk-screen-share-tile');
        if (tile) {
            try {
                const v = tile.querySelector('video');
                if (v) { v.pause(); v.srcObject = null; v.src = ''; }
            } catch(e) {}
            tile.remove();
        }
    }
    // ✅ FIX v15.5 : Re-attacher toutes les vidéos distantes après arrêt screen share groupe
    _reattachAllRemoteVideos() {
        if (!this.livekitRoom) return;
        this.livekitRoom.remoteParticipants.forEach((participant) => {
            participant.trackPublications.forEach((pub) => {
                if (!pub.isSubscribed || !pub.track) return;
                const track = pub.track;
                const LK = this._lk;
                // Ignorer le screen share (déjà fermé)
                try { if (LK?.Track && pub.source === LK.Track.Source.ScreenShare) return; } catch(e) {}
                if (track.kind === 'video') {
                    const safeId = participant.identity.replace(/[^a-zA-Z0-9_-]/g, '_');
                    const avatarEl = document.getElementById(`lk-avatar-${safeId}`);
                    if (avatarEl) avatarEl.style.display = 'none';
                    // Re-créer l'élément vidéo s'il a disparu
                    let videoEl = document.getElementById(`lk-video-${safeId}`);
                    if (!videoEl) {
                        const tile = document.getElementById(`lk-tile-${safeId}`);
                        if (tile) {
                            videoEl = document.createElement('video');
                            videoEl.id = `lk-video-${safeId}`;
                            videoEl.autoplay = true; videoEl.playsinline = true; videoEl.muted = false;
                            videoEl.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;object-fit:cover;display:block;z-index:1;';
                            track.attach(videoEl);
                            tile.insertBefore(videoEl, tile.firstChild);
                        }
                    } else {
                        // Re-attacher si déjà existant mais peut-être détaché
                        try { track.attach(videoEl); } catch(e) {}
                    }
                }
            });
        });
        this._refreshGridLayout();
    }
    _removeRemoteTrack(identity, kind, trackSource) {
        const safeId = identity.replace(/[^a-zA-Z0-9_-]/g, '_');
        const LK = this._lk;
        // ✅ FIX v15.5 : Distinguer screen share de caméra
        const isScreen = trackSource === 'screen_share' ||
            (LK?.Track && trackSource === LK.Track.Source.ScreenShare);
        if (kind === 'video' && isScreen) {
            // C'est un screen share qui s'arrête → fermer uniquement le tile screen share
            // Ne PAS toucher à la vidéo caméra lk-video-${safeId}
            this._closeScreenShareTile();
            // Re-afficher la vidéo caméra du participant si elle existe
            setTimeout(() => {
                const videoEl = document.getElementById(`lk-video-${safeId}`);
                const avatarEl = document.getElementById(`lk-avatar-${safeId}`);
                if (videoEl) {
                    videoEl.style.display = 'block';
                    if (avatarEl) avatarEl.style.display = 'none';
                } else if (avatarEl) {
                    avatarEl.style.display = '';
                }
            }, 100);
            this._refreshGridLayout();
            return;
        }
        // Track caméra ou audio normale
        const el = document.getElementById(`lk-${kind}-${safeId}`);
        if (el) { try { el.srcObject = null; } catch(e) {} el.remove(); }
        if (kind === 'video') {
            const avatarEl = document.getElementById(`lk-avatar-${safeId}`);
            if (avatarEl) avatarEl.style.display = '';
        }
        this._refreshGridLayout();
    }
    _removeParticipantUI(identity) {
        const safeId = identity.replace(/[^a-zA-Z0-9_-]/g, '_');
        ['lk-tile-', 'lk-video-', 'lk-audio-'].forEach(prefix => {
            const el = document.getElementById(prefix + safeId);
            if (el) { try { el.srcObject = null; } catch(e) {} el.remove(); }
        });
        this._refreshGridLayout();
    }
    _updateGroupCallParticipants() {
        if (!this.livekitRoom) return;
        const count = this.livekitRoom.remoteParticipants.size + 1;
        const statusEl = document.getElementById('call-status');
        if (statusEl) statusEl.textContent = `${count} participant${count > 1 ? 's' : ''}`;
        this.livekitRoom.remoteParticipants.forEach(p => this._ensureAvatarTile(p.identity));
    }
    _refreshGridLayout() {
        const container = document.getElementById('group-video-container');
        if (!container) return;
        const tiles = container.querySelectorAll('.group-video-tile');
        const n = tiles.length;
        const isDesktop = window.innerWidth >= 768;
        let cols, rows;
        if (n === 1) { cols = 1; rows = 1; }
        else if (n === 2) { cols = 2; rows = 1; }
        else if (n === 3) { cols = isDesktop ? 3 : 2; rows = isDesktop ? 1 : 2; }
        else if (n === 4) { cols = 2; rows = 2; }
        else if (n === 5) { cols = isDesktop ? 3 : 2; rows = isDesktop ? 2 : 3; }
        else if (n === 6) { cols = isDesktop ? 3 : 2; rows = 2; }
        else if (n <= 9) { cols = 3; rows = isDesktop ? 3 : 4; }
        else { cols = isDesktop ? 4 : 3; rows = Math.ceil(n / (isDesktop ? 4 : 3)); }
        container.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
        container.style.gridTemplateRows = `repeat(${rows}, 1fr)`;
    }
    _buildGroupCallScreen() {
        const remoteVideo = document.getElementById('remote-video');
        const localVideo = document.getElementById('local-video');
        if (remoteVideo) remoteVideo.style.display = 'none';
        if (localVideo) localVideo.style.display = 'none';
        if (!document.getElementById('lk-group-styles')) {
            const style = document.createElement('style');
            style.id = 'lk-group-styles';
            style.textContent = `
                #call-screen.active { position: fixed; inset: 0; overflow: hidden; }
                #group-video-container {
                    display: grid;
                    gap: 4px;
                    position: absolute;
                    top: 56px;
                    left: 0;
                    right: 0;
                    bottom: 80px;
                    background: #0d1117;
                    z-index: 1;
                    padding: 4px;
                    box-sizing: border-box;
                    overflow: hidden;
                }
                .group-video-tile {
                    position: relative;
                    background: #1a2332;
                    border-radius: 10px;
                    overflow: hidden;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    border: 2px solid transparent;
                    transition: border-color .2s, box-shadow .2s;
                    min-height: 0;
                    min-width: 0;
                    width: 100%;
                    height: 100%;
                }
                .group-video-tile.speaking {
                    border-color: #25D366;
                    box-shadow: 0 0 0 2px rgba(37,211,102,.35);
                }
                .group-video-tile video {
                    position: absolute; inset: 0;
                    width: 100%; height: 100%;
                    object-fit: cover;
                    z-index: 1;
                }
                .lk-avatar-circle {
                    width: 52px; height: 52px; border-radius: 50%;
                    display: flex; align-items: center; justify-content: center;
                    font-size: 1.3rem; font-weight: 700; color: #fff;
                    z-index: 2; position: relative; flex-shrink: 0;
                }
                .group-video-label {
                    position: absolute; bottom: 0; left: 0; right: 0;
                    color: #fff; font-size: .72rem; font-weight: 600;
                    background: linear-gradient(to top, rgba(0,0,0,.75), transparent);
                    padding: 16px 8px 5px;
                    z-index: 3;
                    white-space: nowrap; overflow: hidden; text-overflow: ellipsis; text-align: left;
                }
                .lk-mute-icon {
                    position: absolute; top: 5px; right: 5px;
                    color: #fff; background: rgba(231,76,60,.85); border-radius: 50%;
                    width: 22px; height: 22px;
                    display: flex; align-items: center; justify-content: center;
                    font-size: .6rem; z-index: 4;
                }
                .lk-hand-icon {
                    position: absolute; top: 5px; left: 5px;
                    font-size: 1.1rem; z-index: 4; display: none; align-items: center;
                    animation: hand-bounce .6s infinite alternate;
                }
                @keyframes hand-bounce { from { transform: rotate(-12deg); } to { transform: rotate(12deg); } }
                .lk-screen-share-overlay {
                    position: absolute; inset: 0; background: #000; z-index: 15;
                    display: flex; flex-direction: column;
                }
                .lk-screen-share-label {
                    display: flex; align-items: center; gap: 8px; padding: 8px 14px;
                    background: rgba(0,133,63,.9); color: #fff; font-size: .82rem; font-weight: 600;
                }
                .lk-close-screen-btn {
                    margin-left: auto; background: rgba(255,255,255,.2); border: none; color: #fff;
                    border-radius: 50%; width: 26px; height: 26px; cursor: pointer; font-size: .85rem;
                }
                #lk-status-bar {
                    position: absolute; top: 0; left: 0; right: 0; height: 56px; z-index: 20;
                    padding: 10px 16px 0;
                    background: linear-gradient(to bottom, rgba(0,0,0,.7) 60%, transparent);
                    display: flex; align-items: flex-start; gap: 12px;
                    pointer-events: none; box-sizing: border-box;
                }
                .lk-room-name { font-size: .88rem; font-weight: 600; color: #fff; }
                .lk-call-info { font-size: .7rem; color: rgba(255,255,255,.7); margin-top: 2px; }
                #lk-call-controls {
                    position: absolute; bottom: 0; left: 0; right: 0; height: 80px; z-index: 20;
                    background: rgba(13,17,23,.93);
                    backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px);
                    display: flex; align-items: center; justify-content: center;
                    gap: 8px; padding: 0 12px;
                    border-top: 1px solid rgba(255,255,255,.07);
                    box-sizing: border-box;
                }
                .lk-ctrl-btn {
                    width: 46px; height: 46px; border-radius: 50%; border: none; cursor: pointer;
                    display: flex; align-items: center; justify-content: center;
                    font-size: .92rem;
                    transition: transform .15s, background .2s;
                    background: rgba(255,255,255,.13); color: #fff;
                    flex-direction: column; gap: 2px; flex-shrink: 0;
                }
                .lk-ctrl-btn:hover { background: rgba(255,255,255,.22); }
                .lk-ctrl-btn:active { transform: scale(.88); }
                .lk-ctrl-btn-label { font-size: .48rem; color: rgba(255,255,255,.65); line-height: 1; white-space: nowrap; }
                .lk-ctrl-btn.muted, .lk-ctrl-btn.off { background: #c0392b; }
                .lk-ctrl-btn.active { background: rgba(37,211,102,.3); border: 1px solid #25D366; }
                .lk-ctrl-btn.raised { background: rgba(255,167,38,.35); border: 1px solid #ffa726; }
                .lk-ctrl-hangup {
                    background: #e74c3c !important;
                    width: 52px !important; height: 52px !important;
                    font-size: 1.05rem !important;
                    box-shadow: 0 4px 12px rgba(231,76,60,.4);
                }
                .call-overlay, .call-controls { display: none !important; }
                #lk-chat-panel {
                    position: absolute; right: 0; top: 0; bottom: 0; width: min(320px, 100vw);
                    background: #111B21; z-index: 25; display: flex; flex-direction: column;
                    transform: translateX(100%); transition: transform .3s ease;
                    border-left: 1px solid rgba(255,255,255,.08);
                }
                #lk-chat-panel.show { transform: translateX(0); }
                #lk-chat-panel.lk-expanded { width: min(90vw, 600px) !important; }
                .lk-chat-header {
                    display: flex; align-items: center; padding: 12px 14px;
                    border-bottom: 1px solid rgba(255,255,255,.08); gap: 10px; min-height: 52px;
                }
                .lk-chat-header-title { flex: 1; font-weight: 600; font-size: .88rem; color: #E9EDEF; }
                .lk-chat-close-btn, .lk-chat-expand-btn { background: none; border: none; color: #8696A0; cursor: pointer; font-size: .9rem; padding: 4px; transition: color .2s; }
                .lk-chat-close-btn:hover, .lk-chat-expand-btn:hover { color: #E9EDEF; }
                .lk-chat-messages { flex: 1; overflow-y: auto; padding: 8px; background: #0B141A; }
                .lk-msg-wrap { display: flex; margin-bottom: 3px; }
                .lk-msg-wrap.own { justify-content: flex-end; }
                .lk-msg-bubble { max-width: 80%; padding: 5px 8px; border-radius: 8px; background: #1F2C34; word-wrap: break-word; }
                .lk-msg-wrap.own .lk-msg-bubble { background: #005C4B; }
                .lk-msg-sender { font-size: .68rem; font-weight: 600; display: block; margin-bottom: 2px; }
                .lk-msg-text { font-size: .84rem; line-height: 1.4; color: #E9EDEF; }
                .lk-msg-meta { display: flex; justify-content: flex-end; align-items: center; gap: 3px; margin-top: 2px; }
                .lk-msg-time { font-size: .58rem; color: #8696A0; }
                .lk-msg-image img { width:100%;display:block;cursor:pointer;border-radius:6px;max-height:180px;object-fit:cover }
                .lk-msg-file { display:flex;align-items:center;gap:8px;padding:7px;background:rgba(0,0,0,.18);border-radius:7px;cursor:pointer;min-width:140px }
                .lk-msg-file-icon { width:32px;height:32px;border-radius:7px;background:#00853F;display:flex;align-items:center;justify-content:center;color:#fff;font-size:.82rem;flex-shrink:0 }
                .lk-msg-file-info { flex:1;min-width:0 }
                .lk-msg-file-name { font-size:.75rem;color:#E9EDEF;display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis }
                .lk-msg-file-size { font-size:.62rem;color:#8696A0 }
                .lk-chat-input-area { display:flex;align-items:center;padding:7px;gap:5px;border-top:1px solid rgba(255,255,255,.07);background:#1F2C34 }
                .lk-chat-input-area input { flex:1;background:#2A3942;border:none;padding:8px 12px;border-radius:20px;color:#E9EDEF;font-size:.84rem;outline:none }
                .lk-chat-send-btn, .lk-chat-file-btn { width:32px;height:32px;border-radius:50%;border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0 }
                .lk-chat-send-btn { background:#00853F;color:#fff }
                .lk-chat-file-btn { background:#2A3942;color:#8696A0 }
                .lk-date-sep { text-align:center;margin:6px 0 3px }
                .lk-date-sep span { background:rgba(255,255,255,.08);padding:2px 9px;border-radius:8px;font-size:.62rem;color:#8696A0 }
                @media (min-width: 768px) {
                    #group-video-container { gap: 6px; padding: 6px; top: 60px; bottom: 84px; }
                    .group-video-tile { border-radius: 12px; }
                    .lk-avatar-circle { width: 64px; height: 64px; font-size: 1.5rem; }
                    .group-video-label { font-size: .76rem; padding: 18px 10px 6px; }
                    #lk-status-bar { height: 60px; padding: 12px 20px 0; }
                    #lk-call-controls { height: 84px; gap: 12px; padding: 0 20px; }
                    .lk-ctrl-btn { width: 50px; height: 50px; font-size: .98rem; }
                    .lk-ctrl-btn-label { font-size: .52rem; }
                    .lk-ctrl-hangup { width: 58px !important; height: 58px !important; }
                    #lk-chat-panel { width: 340px; }
                }
                @media (min-width: 1024px) {
                    #group-video-container { gap: 8px; padding: 8px; top: 64px; bottom: 88px; }
                    #lk-status-bar { height: 64px; padding: 14px 24px 0; }
                    .lk-room-name { font-size: .95rem; }
                    #lk-call-controls { height: 88px; gap: 16px; padding: 0 40px; }
                    .lk-ctrl-btn { width: 54px; height: 54px; font-size: 1.05rem; }
                    .lk-ctrl-btn-label { font-size: .56rem; }
                    .lk-ctrl-hangup { width: 62px !important; height: 62px !important; }
                    #lk-chat-panel { width: 360px; }
                }
            `;
            document.head.appendChild(style);
        }
        let container = document.getElementById('group-video-container');
        if (!container) {
            container = document.createElement('div'); container.id = 'group-video-container';
            const callScreen = document.getElementById('call-screen');
            if (callScreen) callScreen.appendChild(container);
        }
        if (!document.getElementById('lk-local-tile')) {
            const myId = matrixManager.getUserId() || '', myName = this._getDisplayName(myId);
            const initials = myName.substring(0, 2).toUpperCase();
            const localTile = document.createElement('div');
            localTile.id = 'lk-local-tile'; localTile.className = 'group-video-tile';
            localTile.innerHTML = `
                <div class="lk-avatar-circle" id="lk-local-avatar" style="background:#075E54">${initials}</div>
                <div class="group-video-label">${this.sanitize(myName)} (Vous)</div>
                <div class="lk-mute-icon" id="lk-local-mute-icon" style="display:none"><i class="fas fa-microphone-slash"></i></div>
                <div class="lk-hand-icon" id="lk-local-hand" style="display:none">✋</div>`;
            container.appendChild(localTile);
        }
        if (!document.getElementById('lk-status-bar')) {
            const bar = document.createElement('div'); bar.id = 'lk-status-bar';
            bar.innerHTML = `<div><div class="lk-room-name" id="lk-room-display-name">Appel de groupe</div><div class="lk-call-info"><span id="call-status">Connexion...</span>&nbsp;·&nbsp;<span id="call-duration">00:00</span></div></div>`;
            document.getElementById('call-screen')?.appendChild(bar);
        }
        if (!document.getElementById('lk-call-controls')) {
            const ctrl = document.createElement('div'); ctrl.id = 'lk-call-controls';
            ctrl.innerHTML = `
                <button class="lk-ctrl-btn" id="lk-btn-mute" onclick="webrtcManager._toggleGroupMute()" title="Micro">
                    <i class="fas fa-microphone" id="lk-mute-icon-self"></i>
                    <span class="lk-ctrl-btn-label">Micro</span>
                </button>
                <button class="lk-ctrl-btn" id="lk-btn-camera" onclick="webrtcManager._toggleGroupCamera()" title="Caméra">
                    <i class="fas fa-video" id="lk-camera-icon"></i>
                    <span class="lk-ctrl-btn-label">Caméra</span>
                </button>
                <button class="lk-ctrl-btn" id="lk-btn-screen" onclick="webrtcManager.toggleGroupScreenShare()" title="Écran">
                    <i class="fas fa-desktop" id="lk-screen-icon"></i>
                    <span class="lk-ctrl-btn-label">Écran</span>
                </button>
                <button class="lk-ctrl-btn" id="lk-btn-hand" onclick="webrtcManager.toggleRaiseHand()" title="Main">
                    <span id="lk-hand-icon">🖐️</span>
                    <span class="lk-ctrl-btn-label">Main</span>
                </button>
                <button class="lk-ctrl-btn" onclick="webrtcManager.openGroupCallFilePicker()" title="Fichier">
                    <i class="fas fa-paperclip"></i>
                    <span class="lk-ctrl-btn-label">Fichier</span>
                </button>
                <button class="lk-ctrl-btn" id="lk-btn-chat" onclick="webrtcManager.toggleGroupChat()" title="Chat">
                    <i class="fas fa-comment"></i>
                    <span class="lk-ctrl-btn-label">Chat</span>
                </button>
                <button class="lk-ctrl-btn lk-ctrl-hangup" onclick="uiController.endCall()" title="Raccrocher">
                    <i class="fas fa-phone-slash"></i>
                </button>`;
            document.getElementById('call-screen')?.appendChild(ctrl);
        }
        if (!document.getElementById('lk-chat-panel')) {
            const panel = document.createElement('div'); panel.id = 'lk-chat-panel';
            panel.innerHTML = `
                <div class="lk-chat-header">
                    <i class="fas fa-comment" style="color:#25D366"></i>
                    <span class="lk-chat-header-title">Messages</span>
                    <button id="lk-btn-expand" class="lk-chat-expand-btn" onclick="webrtcManager.toggleLkChatExpand()" title="Agrandir/Réduire"><i class="fas fa-expand-alt"></i></button>
                    <button class="lk-chat-close-btn" onclick="webrtcManager.toggleGroupChat()"><i class="fas fa-times"></i></button>
                </div>
                <div class="lk-chat-messages" id="lk-chat-messages">
                    <div style="text-align:center;color:#8696A0;padding:30px 10px;font-size:.78rem"><i class="fas fa-lock" style="color:#25D366;font-size:1.3rem;margin-bottom:8px;display:block"></i>Les messages sont chiffrés</div>
                </div>
                <div class="lk-chat-input-area" style="position:relative;">
                    <button class="lk-chat-file-btn" onclick="webrtcManager.openGroupCallFilePicker()"><i class="fas fa-paperclip"></i></button>
                    <input type="text" id="lk-chat-input" placeholder="@mention ou message..."
                        oninput="webrtcManager._handleLkChatInput(this)"
                        onkeydown="if(event.key==='Enter'&&!webrtcManager._lkMentionActive)webrtcManager.sendGroupChatMessage();else if(event.key==='Escape')webrtcManager._hideLkMentionDropdown()"
                        onblur="setTimeout(()=>webrtcManager._hideLkMentionDropdown(),200)">
                    <button class="lk-chat-send-btn" onclick="webrtcManager.sendGroupChatMessage()"><i class="fas fa-paper-plane"></i></button>
                </div>`;
            document.getElementById('call-screen')?.appendChild(panel);
        }
        this._refreshGridLayout();
        if (!this._resizeListener) {
            this._resizeListener = () => this._refreshGridLayout();
            window.addEventListener('resize', this._resizeListener);
        }
    }
    // ═══════════════ CHAT DE GROUPE ═══════════════
    toggleGroupChat() {
        const panel = document.getElementById('lk-chat-panel'); if (!panel) return;
        panel.classList.toggle('show');
        const btn = document.getElementById('lk-btn-chat');
        if (panel.classList.contains('show')) {
            if (btn) btn.classList.add('active');
            if (this.currentCall) this.renderGroupCallMessages();
            setTimeout(() => { const inp = document.getElementById('lk-chat-input'); if (inp) inp.focus(); }, 200);
        } else {
            if (btn) btn.classList.remove('active');
            this._hideLkMentionDropdown();
        }
    }
    toggleLkChatExpand() {
        const panel = document.getElementById('lk-chat-panel'); if (!panel) return;
        const expanded = panel.classList.toggle('lk-expanded');
        const btn = document.getElementById('lk-btn-expand');
        if (btn) btn.querySelector('i').className = expanded ? 'fas fa-compress-alt' : 'fas fa-expand-alt';
    }
    async sendGroupChatMessage() {
        if (this._lkMentionActive) return; // Let dropdown handle Enter
        const inp = document.getElementById('lk-chat-input');
        if (!inp || !this.currentCall) return;
        const text = inp.value.trim(); if (!text) return;
        inp.value = '';
        this._hideLkMentionDropdown();
        await matrixManager.sendMessage(this.currentCall.roomId, text);
        setTimeout(() => this.renderGroupCallMessages(), 300);
    }
    // ─── @Mentions pour le chat d'appel de groupe ───
    _handleLkChatInput(inp) {
        const val = inp.value, pos = inp.selectionStart;
        const before = val.substring(0, pos);
        const atIdx = before.lastIndexOf('@');
        if (atIdx === -1 || /\s/.test(before.substring(atIdx + 1))) { this._hideLkMentionDropdown(); return; }
        const fragment = before.substring(atIdx + 1);
        this._lkMentionActive = true;
        this._lkMentionStartPos = atIdx;
        this._showLkMentionDropdown(fragment);
    }
    _showLkMentionDropdown(query) {
        if (!this.currentCall) return;
        const members = (typeof uiController !== 'undefined') ? uiController._buildMentionList() : [];
        const filtered = members.filter(m =>
            m.displayName.toLowerCase().includes(query.toLowerCase()) ||
            m.userId.toLowerCase().includes(query.toLowerCase())
        ).slice(0, 8);
        if (!filtered.length) { this._hideLkMentionDropdown(); return; }
        let dd = document.getElementById('lk-mention-dropdown');
        if (!dd) {
            dd = document.createElement('div');
            dd.id = 'lk-mention-dropdown';
            dd.style.cssText = 'position:absolute;bottom:52px;left:0;right:0;background:#1F2C34;border-radius:8px 8px 0 0;border-top:1px solid rgba(255,255,255,.1);max-height:200px;overflow-y:auto;z-index:200';
            document.getElementById('lk-chat-panel')?.appendChild(dd);
        }
        const colors = ['#25D366','#128C7E','#4facfe','#f093fb','#ffa726','#e74c3c','#9b59b6'];
        dd.innerHTML = filtered.map((m, i) => {
            const bg = colors[m.userId.charCodeAt(1) % colors.length];
            return `<div style="display:flex;align-items:center;gap:8px;padding:8px 12px;cursor:pointer;border-bottom:1px solid rgba(255,255,255,.05)"
                onmousedown="event.preventDefault();webrtcManager._insertLkMention('${m.userId.replace(/'/g,'\\\'').replace(/"/g,'&quot;')}','${m.displayName.replace(/'/g,'\\\'').replace(/"/g,'&quot;')}')"
                onmouseover="this.style.background='rgba(255,255,255,.06)'" onmouseout="this.style.background=''">
                <div style="width:28px;height:28px;border-radius:50%;background:${bg};display:flex;align-items:center;justify-content:center;font-size:.75rem;font-weight:700;color:#fff;flex-shrink:0">${m.displayName.charAt(0).toUpperCase()}</div>
                <div><div style="font-size:.82rem;font-weight:600;color:#E9EDEF">${m.displayName}</div><div style="font-size:.68rem;color:#8696A0">${m.userId.split(':')[0]}</div></div>
            </div>`;
        }).join('');
    }
    _hideLkMentionDropdown() {
        document.getElementById('lk-mention-dropdown')?.remove();
        this._lkMentionActive = false;
    }
    _insertLkMention(userId, displayName) {
        const inp = document.getElementById('lk-chat-input'); if (!inp) return;
        const before = inp.value.substring(0, this._lkMentionStartPos);
        const after  = inp.value.substring(inp.selectionStart);
        const mention = `@${displayName} `;
        inp.value = before + mention + after;
        const pos = before.length + mention.length;
        inp.setSelectionRange(pos, pos);
        inp.focus();
        this._hideLkMentionDropdown();
    }
    renderGroupCallMessages() {
        const container = document.getElementById('lk-chat-messages'); if (!container || !this.currentCall) return;
        const msgs = (typeof uiController !== 'undefined' && uiController.chatMessages)
            ? (uiController.chatMessages[this.currentCall.roomId] || []) : [];
        if (!msgs.length) {
            container.innerHTML = `<div style="text-align:center;color:#8696A0;padding:30px 10px;font-size:.8rem">
                <i class="fas fa-lock" style="color:#25D366;font-size:1.4rem;margin-bottom:8px;display:block"></i>
                Les messages sont chiffrés</div>`;
            return;
        }
        let html = '', lastDate = '';
        const senderColors = ['#25D366','#53bdeb','#f093fb','#ffa726','#1abc9c','#e74c3c','#9b59b6'];
        const colorMap = {}; let colorIdx = 0;
        const getSenderColor = (id) => { if (!colorMap[id]) colorMap[id] = senderColors[colorIdx++ % senderColors.length]; return colorMap[id]; };
        msgs.slice(-80).forEach((msg, i) => {
            const d = new Date(msg.timestamp);
            const ds = d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' });
            if (ds !== lastDate) { html += `<div class="lk-date-sep"><span>${ds}</span></div>`; lastDate = ds; }
            const cls = msg.isOwn ? 'own' : '';
            const timeStr = d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
            const senderName = msg.isOwn ? 'Vous' : this._getDisplayName(msg.senderId || msg.sender || '');
            const color = msg.isOwn ? '#25D366' : getSenderColor(msg.senderId || msg.sender || '');
            const ticks = msg.isOwn ? '<span class="lk-msg-ticks"><i class="fas fa-check-double"></i></span>' : '';
            let content = '';
            if (msg.type === 'text') {
                content = `<span class="lk-msg-text">${this._escapeHtml(msg.message || '')}</span>`;
            } else if (msg.type === 'image' && msg.mxcUrl) {
                const thumbUrl = matrixManager.mxcToThumbnailUrl?.(msg.mxcUrl, 200, 150) || '';
                content = `<div class="lk-msg-image"><img src="${thumbUrl}" loading="lazy" alt="Image" onclick="uiController.showImageFullscreen('${msg.mxcUrl}')" onerror="this.style.display='none'"></div>`;
            } else if (msg.type === 'voice' && msg.mxcUrl) {
                const dur = this._fmtMs(msg.audioDuration || 0);
                const bars = Array(18).fill(0).map(() => `<div class="lk-msg-voice-bar" style="height:${Math.floor(Math.random()*12)+4}px"></div>`).join('');
                content = `<div class="lk-msg-voice"><button class="lk-msg-voice-btn" onclick="uiController.playVoiceMessage('${msg.mxcUrl}','lkchat_${i}')"><i class="fas fa-play"></i></button><div class="lk-msg-voice-wave">${bars}</div><span style="font-size:.65rem;color:#8696A0;flex-shrink:0">${dur}</span></div>`;
            } else if ((msg.type === 'file' || msg.type === 'video') && msg.mxcUrl) {
                const iconClass = msg.type === 'video' ? 'fa-film' : (typeof getFileIcon === 'function' ? getFileIcon(msg.mimetype) : 'fa-file');
                const sizeStr = (msg.fileInfo?.size || 0) > 0 && typeof formatFileSize === 'function' ? formatFileSize(msg.fileInfo.size) : '';
                content = `<div class="lk-msg-file" onclick="uiController.downloadFile('${msg.mxcUrl}','${this._escapeHtml(msg.filename || msg.message || 'fichier')}')">
                    <div class="lk-msg-file-icon"><i class="fas ${iconClass}"></i></div>
                    <div class="lk-msg-file-info"><span class="lk-msg-file-name">${this._escapeHtml(msg.filename || msg.message || 'Fichier')}</span>${sizeStr ? `<span class="lk-msg-file-size">${sizeStr}</span>` : ''}</div>
                    <i class="fas fa-download" style="color:#8696A0;font-size:.75rem;flex-shrink:0"></i>
                </div>`;
            } else if (msg.type === 'location') {
                const coords = (msg.geoUri || '').replace('geo:', '').split(',');
                const lat = coords[0] || '0', lng = coords[1] || '0';
                content = `<div class="lk-msg-file" onclick="window.open('https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=16/${lat}/${lng}','_blank')">
                    <div class="lk-msg-file-icon" style="background:#e74c3c"><i class="fas fa-map-marker-alt"></i></div>
                    <div class="lk-msg-file-info"><span class="lk-msg-file-name">Position partagée</span><span class="lk-msg-file-size">${parseFloat(lat).toFixed(4)}, ${parseFloat(lng).toFixed(4)}</span></div>
                </div>`;
            } else {
                content = `<span class="lk-msg-text">${this._escapeHtml(msg.message || '')}</span>`;
            }
            html += `<div class="lk-msg-wrap ${cls}"><div class="lk-msg-bubble">
                ${!msg.isOwn ? `<span class="lk-msg-sender" style="color:${color}">${this._escapeHtml(senderName)}</span>` : ''}
                ${content}
                <div class="lk-msg-meta"><span class="lk-msg-time">${timeStr}</span>${ticks}</div>
            </div></div>`;
        });
        container.innerHTML = html;
        container.scrollTop = container.scrollHeight;
    }
    _escapeHtml(t) { const d = document.createElement('div'); d.textContent = String(t || ''); return d.innerHTML; }
    _fmtMs(ms) { const s = Math.round(ms / 1000); return String(Math.floor(s / 60)) + ':' + String(s % 60).padStart(2, '0'); }
    // ═══════════════ CONTRÔLES GROUPE ═══════════════
    _toggleGroupMute() {
        this.isAudioMuted = !this.isAudioMuted;
        if (this.livekitLocalParticipant) this.livekitLocalParticipant.setMicrophoneEnabled(!this.isAudioMuted);
        const btn = document.getElementById('lk-btn-mute');
        const icon = document.getElementById('lk-mute-icon-self');
        const muteIco = document.getElementById('lk-local-mute-icon');
        if (btn) btn.classList.toggle('muted', this.isAudioMuted);
        if (icon) icon.className = this.isAudioMuted ? 'fas fa-microphone-slash' : 'fas fa-microphone';
        if (muteIco) muteIco.style.display = this.isAudioMuted ? 'flex' : 'none';
        if (typeof showToast === 'function') showToast(this.isAudioMuted ? 'Micro coupé' : 'Micro activé', 'info');
    }
    async _toggleGroupCamera() {
        if (!this.livekitLocalParticipant) return;
        this.localVideoEnabled = !this.localVideoEnabled;
        await this.livekitLocalParticipant.setCameraEnabled(this.localVideoEnabled);
        const btn = document.getElementById('lk-btn-camera');
        const icon = document.getElementById('lk-camera-icon');
        const avatar = document.getElementById('lk-local-avatar');
        if (btn) btn.classList.toggle('off', !this.localVideoEnabled);
        if (icon) icon.className = this.localVideoEnabled ? 'fas fa-video' : 'fas fa-video-slash';
        if (avatar) avatar.style.display = this.localVideoEnabled ? 'none' : 'flex';
        if (this.localVideoEnabled) this._attachLocalLiveKitVideo(this._lk);
        if (typeof showToast === 'function') showToast(this.localVideoEnabled ? 'Caméra activée' : 'Caméra désactivée', 'info');
    }
    // ═══════════════ APPEL ENTRANT 1:1 ═══════════════
    async answerCall(roomId, callId, offer, withVideo = false) {
        try {
            this._callRoomId = roomId;
            this._callStartTs = Date.now();
            this.currentCall = { callId, roomId, isGroup: false };
            this.isAnswering = false; this._isOfferer = false; this._remoteAnswerApplied = false;
            this._callConnected = false; this._callConnectedAt = null; this._iceRestartCount = 0;
            this.isVideoCall = withVideo; this.localVideoEnabled = withVideo; this.remoteVideoEnabled = false;
            this._resetCallTimer();
            if (typeof soundManager !== 'undefined') soundManager.stopCallRingtone();
            matrixManager._stopRinging?.();
            this._emitConnectionState('connecting');
            if (!await this.initializeMedia(withVideo)) { this.currentCall = null; return false; }
            await this.createPeerConnection();
            await this.peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
            const answer = await this.peerConnection.createAnswer();
            await this.peerConnection.setLocalDescription(answer);
            await this.sendCallAnswer(answer, this._buildStreamMetadata());
            this._updateCallScreenUI();
            for (const c of this.pendingIceCandidates) { try { await this.peerConnection.addIceCandidate(new RTCIceCandidate(c)); } catch(e) {} }
            this.pendingIceCandidates = [];
            return true;
        } catch (e) {
            console.error('[WebRTC] Erreur réponse:', e); this.currentCall = null;
            if (typeof showToast === 'function') showToast('Erreur réponse', 'error');
            return false;
        }
    }
    async _applyRemoteAnswer(answer) {
        if (!this.peerConnection || this._remoteAnswerApplied) return false;
        const st = this.peerConnection.signalingState;
        if (st === 'have-local-offer') {
            try { await this.peerConnection.setRemoteDescription(new RTCSessionDescription(answer)); this._remoteAnswerApplied = true; return true; }
            catch(e) { return false; }
        } else if (st === 'stable') { this._remoteAnswerApplied = true; return false; }
        return false;
    }
    async handleCallAnswer(answer) {
        if (typeof soundManager !== 'undefined') soundManager.stopRingback();
        if (!this.peerConnection) { this.pendingAnswer = answer; return; }
        if (this.peerConnection.signalingState === 'have-local-offer') await this._applyRemoteAnswer(answer);
    }
    async handleIceCandidates(candidates) {
        if (!this.peerConnection || !this.peerConnection.remoteDescription) {
            this.pendingIceCandidates.push(...candidates); return;
        }
        for (const c of candidates) { try { await this.peerConnection.addIceCandidate(new RTCIceCandidate(c)); } catch(e) {} }
    }
    // ═══════════════ TOGGLE CAMÉRA 1:1 ═══════════════
    async toggleCamera() {
        if (!this.peerConnection || !this.currentCall) return { enabled: false, error: true };
        if (this.localVideoEnabled) {
            // ── DÉSACTIVATION : stopper la track locale, envoyer null via replaceTrack (garde le sender) ──
            const vt = this.localStream?.getVideoTracks()[0];
            if (vt) { vt.stop(); if (this.localStream) this.localStream.removeTrack(vt); }
            if (this._userMediaVideoSender) {
                try { await this._userMediaVideoSender.replaceTrack(null); } catch(e) {}
                // ⚠ Ne pas supprimer le sender : on le réutilise à la réactivation
            }
            this.localVideoEnabled = false; this._originalVideoTrack = null;
            await this._renegotiate(); this._updateCallScreenUI();
            return { enabled: false, error: false };
        } else {
            try {
                const vs = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' } });
                const vt = vs.getVideoTracks()[0]; if (!vt) return { enabled: false, error: true };
                if (this.localStream) this.localStream.addTrack(vt); else this.localStream = vs;
                this._originalVideoTrack = vt;
                if (this._userMediaVideoSender) {
                    // ── RÉACTIVATION via replaceTrack : pas de nouveau m-line, le correspondant reçoit bien la track ──
                    await this._userMediaVideoSender.replaceTrack(vt);
                } else {
                    // Fallback si le sender a été perdu (premier appel ou état inattendu)
                    this._userMediaVideoSender = this.peerConnection.addTrack(vt, this.localStream);
                }
                const lv = document.getElementById('local-video'); if (lv) lv.srcObject = this.localStream;
                this.localVideoEnabled = true; await this._renegotiate(); this._updateCallScreenUI();
                return { enabled: true, error: false };
            } catch (e) {
                if (typeof showToast === 'function') showToast("Impossible d'activer la caméra", 'error');
                return { enabled: false, error: true };
            }
        }
    }
    async _renegotiate() {
        if (!this.peerConnection || !this.currentCall || this._isRenegotiating) return;
        this._isRenegotiating = true;
        try {
            const o = await this.peerConnection.createOffer();
            await this.peerConnection.setLocalDescription(o);
            await matrixManager.sendCallNegotiate(this.currentCall.roomId, this.currentCall.callId, { type: 'offer', sdp: o.sdp }, this._buildStreamMetadata());
        } catch(e) { console.warn('[WebRTC] Renegotiate:', e.message); }
        finally { this._isRenegotiating = false; }
    }
    async handleCallNegotiate(content) {
        if (!this.peerConnection) return;
        const desc = content.description || content;
        try {
            if (desc.type === 'offer') {
                const st = this.peerConnection.signalingState;
                if (st === 'have-local-offer') {
                    if (!this._isOfferer) { await this.peerConnection.setLocalDescription({ type: 'rollback' }); }
                    else return;
                }
                await this.peerConnection.setRemoteDescription(new RTCSessionDescription(desc));
                const ans = await this.peerConnection.createAnswer();
                await this.peerConnection.setLocalDescription(ans);
                if (this.currentCall) await matrixManager.sendCallNegotiate(this.currentCall.roomId, this.currentCall.callId, { type: 'answer', sdp: ans.sdp }, this._buildStreamMetadata());
                const hasV = desc.sdp?.includes('m=video') && !desc.sdp.match(/m=video\s+0\s/);
                if (hasV && !this.remoteVideoEnabled) { this.remoteVideoEnabled = true; this._updateCallScreenUI(); }
                else if (!hasV && this.remoteVideoEnabled) { this.remoteVideoEnabled = false; this._updateCallScreenUI(); }
                // ✅ FIX v15.8 : Forcer refresh remote-video + écouter onunmute sur toutes les tracks
                // replaceTrack() côté émetteur ne déclenche PAS ontrack côté receveur
                // La track dans remoteStream change mais l'élément <video> ne le voit pas toujours
                if (this.remoteStream) {
                    setTimeout(() => {
                        const rv = document.getElementById('remote-video');
                        if (rv && this.remoteStream) {
                            rv.srcObject = null;
                            rv.srcObject = this.remoteStream;
                            rv.style.display = '';
                            const playP = rv.play();
                            if (playP) playP.catch(() => {});
                        }
                        // Écouter onunmute sur chaque track (déclenché quand caméra devient active)
                        this.remoteStream.getTracks().forEach(track => {
                            track.onunmute = () => {
                                this.remoteVideoEnabled = true;
                                this._updateCallScreenUI();
                                const rv2 = document.getElementById('remote-video');
                                if (rv2 && this.remoteStream) {
                                    rv2.srcObject = null;
                                    rv2.srcObject = this.remoteStream;
                                    rv2.style.display = '';
                                    rv2.play?.().catch(() => {});
                                }
                            };
                        });
                        this._updateCallScreenUI();
                    }, 150);
                }
            } else if (desc.type === 'answer') {
                if (this.peerConnection.signalingState === 'have-local-offer') {
                    await this.peerConnection.setRemoteDescription(new RTCSessionDescription(desc));
                    // ✅ FIX v15.8 : Côté initiateur — même logique
                    const hasV = desc.sdp?.includes('m=video') && !desc.sdp.match(/m=video\s+0\s/);
                    if (this.remoteStream) {
                        setTimeout(() => {
                            const rv = document.getElementById('remote-video');
                            if (rv && this.remoteStream) {
                                rv.srcObject = null;
                                rv.srcObject = this.remoteStream;
                                rv.style.display = '';
                                const playP = rv.play();
                                if (playP) playP.catch(() => {});
                            }
                            this.remoteStream.getTracks().forEach(track => {
                                track.onunmute = () => {
                                    this.remoteVideoEnabled = true;
                                    this._updateCallScreenUI();
                                    const rv2 = document.getElementById('remote-video');
                                    if (rv2 && this.remoteStream) {
                                        rv2.srcObject = null;
                                        rv2.srcObject = this.remoteStream;
                                        rv2.style.display = '';
                                        rv2.play?.().catch(() => {});
                                    }
                                };
                            });
                            if (hasV) { this.remoteVideoEnabled = true; }
                            this._updateCallScreenUI();
                        }, 150);
                    }
                }
            }
        } catch(e) { console.error('[WebRTC] Negotiate error:', e); }
    }
    // ═══════════════ PARTAGE D'ÉCRAN 1:1 — ✅ FIX DÉFINITIF v15.8 ═══════════════
    async toggleScreenShare() {
        if (!this.peerConnection || !this.currentCall) { if (typeof showToast === 'function') showToast('Aucun appel en cours', 'error'); return false; }
        try {
            if (this.isSharingScreen) {
                // ── Arrêter le stream screen share ──
                if (this.screenStream) {
                    this.screenStream.getTracks().forEach(t => t.stop());
                    this.screenStream = null;
                }

                // ✅ FIX DÉFINITIF : Toujours tenter de recréer une caméra LIVE
                // replaceTrack(null) ou replaceTrack(ended) → track muette côté B
                // Solution: toujours acquérir une nouvelle track caméra fraîche
                let cameraRestored = false;
                if (this._userMediaVideoSender && this.localVideoEnabled) {
                    // Cas 1 : track originale toujours active → réutiliser
                    if (this._originalVideoTrack && this._originalVideoTrack.readyState === 'live') {
                        try {
                            await this._userMediaVideoSender.replaceTrack(this._originalVideoTrack);
                            cameraRestored = true;
                        } catch(e) { console.warn('[WebRTC] replaceTrack original échoué:', e.message); }
                    }
                    // Cas 2 : track originale morte ou absente → recréer depuis getUserMedia
                    if (!cameraRestored) {
                        try {
                            const vs = await navigator.mediaDevices.getUserMedia({
                                video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' }
                            });
                            const newVt = vs.getVideoTracks()[0];
                            this._originalVideoTrack = newVt;
                            // Mettre à jour localStream
                            if (this.localStream) {
                                this.localStream.getVideoTracks().forEach(t => { t.stop(); this.localStream.removeTrack(t); });
                                this.localStream.addTrack(newVt);
                            }
                            await this._userMediaVideoSender.replaceTrack(newVt);
                            cameraRestored = true;
                            console.log('[WebRTC] ✅ Caméra recréée depuis getUserMedia');
                        } catch(e) { console.warn('[WebRTC] Recréation caméra échouée:', e.message); }
                    }
                } else if (this._userMediaVideoSender && !this.localVideoEnabled) {
                    // Caméra était désactivée → envoyer null pour ne pas forcer l'activation
                    try { await this._userMediaVideoSender.replaceTrack(null); } catch(e) {}
                }

                // ── Restaurer l'aperçu vidéo local ──
                const lv = document.getElementById('local-video');
                if (lv && this.localStream) {
                    lv.srcObject = this.localStream;
                    lv.style.transform = 'scaleX(-1)';
                    lv.style.display = this.localVideoEnabled ? '' : 'none';
                }

                // ── Restaurer l'audio système → micro ──
                if (this._screenAudioSender) {
                    if (this._originalAudioTrack && this._originalAudioTrack.readyState === 'live') {
                        try { await this._screenAudioSender.replaceTrack(this._originalAudioTrack); }
                        catch(e) { console.warn('[WebRTC] Restauration audio micro échouée:', e.message); }
                    } else {
                        try { this.peerConnection.removeTrack(this._screenAudioSender); } catch(e) {}
                    }
                    this._screenAudioSender = null;
                    this._originalAudioTrack = null;
                }

                this.isSharingScreen = false;

                // ✅ FIX : Renegocier avec un délai pour laisser replaceTrack se propager
                // puis forcer le refresh du remote-video côté local aussi
                await new Promise(r => setTimeout(r, 100));
                await this._renegotiate();

                // Forcer refresh remote-video (peut être masqué pendant screen share)
                setTimeout(() => {
                    const rv = document.getElementById('remote-video');
                    if (rv && this.remoteStream) {
                        rv.srcObject = null;
                        rv.srcObject = this.remoteStream;
                        rv.style.display = '';
                        rv.play?.().catch(() => {});
                    }
                    // ✅ FIX v16.0 : Restaurer remoteVideoEnabled si des tracks vidéo distantes sont toujours actives
                    // Pendant le screen share, track.onmute peut avoir mis remoteVideoEnabled=false
                    // Sans ce fix, _updateCallScreenUI() n'affiche pas le remote video après arrêt du partage
                    if (this.remoteStream) {
                        const hasLiveVideo = this.remoteStream.getVideoTracks().some(t => t.readyState !== 'ended');
                        if (hasLiveVideo) this.remoteVideoEnabled = true;
                    }
                    this._updateCallScreenUI();
                }, 200);

                this._updateScreenShareUI(false);
                if (typeof showToast === 'function') showToast('Partage écran arrêté', 'info');
                return false;
            } else {
                let ss;
                try {
                    ss = await navigator.mediaDevices.getDisplayMedia({
                        video: { cursor: 'always', displaySurface: 'monitor' },
                        audio: { suppressLocalAudioPlayback: false, echoCancellation: false, noiseSuppression: false, autoGainControl: false },
                        selfBrowserSurface: 'exclude', systemAudio: 'include'
                    });
                } catch(e) { ss = await navigator.mediaDevices.getDisplayMedia({ video: { cursor: 'always' }, audio: false }); }
                this.screenStream = ss;
                const svt = ss.getVideoTracks()[0]; const sat = ss.getAudioTracks()[0];
                // ✅ FIX : Sauvegarder la track vidéo originale AVANT de la remplacer
                if (!this._originalVideoTrack && this.localStream) {
                    this._originalVideoTrack = this.localStream.getVideoTracks()[0] || null;
                }
                if (this._userMediaVideoSender) await this._userMediaVideoSender.replaceTrack(svt);
                else this._userMediaVideoSender = this.peerConnection.addTrack(svt, ss);
                // ✅ FIX v15.6 : Audio système — utiliser replaceTrack sur le sender audio existant
                // pour éviter que le navigateur bloque un 2e sender audio
                if (sat) {
                    const audioSenders = this.peerConnection.getSenders().filter(s => s.track?.kind === 'audio');
                    const existingAudioSender = audioSenders.find(s => s.track && s.track !== sat);
                    if (existingAudioSender) {
                        // Remplacer la track audio existante (micro) par l'audio système
                        this._originalAudioTrack = existingAudioSender.track;
                        try {
                            await existingAudioSender.replaceTrack(sat);
                            this._screenAudioSender = existingAudioSender;
                        } catch(e) {
                            // Fallback : ajouter comme nouveau sender
                            this._screenAudioSender = this.peerConnection.addTrack(sat, ss);
                        }
                    } else {
                        this._screenAudioSender = this.peerConnection.addTrack(sat, ss);
                    }
                    if (typeof showToast === 'function') showToast('Partage écran + son système', 'success');
                } else if (typeof showToast === 'function') showToast('Partage écran activé', 'success');
                // ✅ FIX : Quand le partage s'arrête via le navigateur, restaurer proprement
                svt.onended = () => { if (this.isSharingScreen) this.toggleScreenShare(); };
                this.isSharingScreen = true; await this._renegotiate();
                this._updateScreenShareUI(true); return true;
            }
        } catch(e) {
            if (e.name !== 'NotAllowedError' && typeof showToast === 'function') showToast('Erreur partage écran', 'error');
            return false;
        }
    }
    _updateScreenShareUI(s) {
        const cs = document.getElementById('call-screen'); if (cs) cs.classList.toggle('screen-sharing', s);
        const lv = document.getElementById('local-video');
        if (lv && s && this.screenStream) {
            lv.srcObject = this.screenStream; lv.style.transform = 'none'; lv.style.display = '';
        } else if (lv && !s && this.localStream) {
            lv.srcObject = this.localStream; lv.style.transform = 'scaleX(-1)';
            lv.style.display = this.localVideoEnabled ? '' : 'none';
        }
    }
    async sendCallInvite(roomId, offer, meta) {
        if (!matrixManager.getClient()) return;
        const callId = `call_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
        this.currentCall = { callId, roomId };
        const c = { call_id: callId, version: 1, lifetime: 60000, offer: { type: 'offer', sdp: offer.sdp } };
        if (meta) c.sdp_stream_metadata = meta;
        // Envoi sans chiffrement pour éviter les délais de déchiffrement qui font rater les appels
        await matrixManager.sendCallEvent(roomId, 'm.call.invite', c);
    }
    async sendCallAnswer(answer, meta) {
        if (!matrixManager.getClient() || !this.currentCall) return;
        const c = { call_id: this.currentCall.callId, version: 1, answer: { type: 'answer', sdp: answer.sdp } };
        if (meta) c.sdp_stream_metadata = meta;
        await matrixManager.sendCallEvent(this.currentCall.roomId, 'm.call.answer', c);
    }
    async sendIceCandidatesBatch() {
        if (!matrixManager.getClient() || !this.currentCall || !this.iceCandidatesQueue.length) { this.iceSendTimeout = null; return; }
        const cands = [...this.iceCandidatesQueue]; this.iceCandidatesQueue = []; this.iceSendTimeout = null;
        try {
            await matrixManager.sendCallEvent(this.currentCall.roomId, 'm.call.candidates', {
                call_id: this.currentCall.callId, version: 1,
                candidates: cands.map(c => ({ candidate: c.candidate, sdpMid: c.sdpMid, sdpMLineIndex: c.sdpMLineIndex }))
            });
        } catch(e) {}
    }
    toggleAudio() {
        if (this.livekitLocalParticipant) {
            this.isAudioMuted = !this.isAudioMuted;
            this.livekitLocalParticipant.setMicrophoneEnabled(!this.isAudioMuted);
            return this.isAudioMuted;
        }
        if (!this.localStream) return false;
        const t = this.localStream.getAudioTracks()[0];
        if (t) { t.enabled = !t.enabled; this.isAudioMuted = !t.enabled; }
        return this.isAudioMuted;
    }
    startCallTimer() {
        if (this.callTimer) return;
        this.callStartTime = Date.now();
        this.callTimer = setInterval(() => {
            const s = Math.floor((Date.now() - this.callStartTime) / 1000);
            const formatted = typeof formatDuration === 'function'
                ? formatDuration(s)
                : String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
            document.querySelectorAll('#call-duration').forEach(el => { el.textContent = formatted; });
        }, 1000);
    }
    getCallDurationSeconds() {
        return this.callStartTime ? Math.floor((Date.now() - this.callStartTime) / 1000) : 0;
    }
    hangup() {
        if (typeof soundManager !== 'undefined') { soundManager.stopRingback(); soundManager.stopCallRingtone(); soundManager.playCallEnd?.(); }
        matrixManager._stopRinging?.();
        // ✅ v16.2 : Enregistrer dans l'historique des appels
        if (this._callRoomId && !this.currentCall?.isGroup) {
            const duration = this.getCallDurationSeconds();
            const connected = this._callConnected;
            try {
                matrixManager.addCallToHistory({
                    userId: this._getPeerUserId(this._callRoomId),
                    roomId: this._callRoomId,
                    type: this.isVideoCall ? 'video' : 'audio',
                    direction: this._isOfferer ? 'outgoing' : 'incoming',
                    status: connected ? 'completed' : (this._isOfferer ? 'unanswered' : 'declined'),
                    duration,
                    timestamp: this._callStartTs || Date.now()
                });
            } catch(e) {}
        }
        if (this.currentCall?.isGroup) this._sendGroupCallEndNotification();
        else if (this.currentCall) {
            matrixManager.sendCallEvent(this.currentCall.roomId, 'm.call.hangup',
                { call_id: this.currentCall.callId, version: 1, reason: 'user_hangup' }).catch(() => {});
        }
        this.cleanup();
    }
    cleanup() {
        this._resetCallTimer();
        if (this.iceSendTimeout) { clearTimeout(this.iceSendTimeout); this.iceSendTimeout = null; }
        if (this._iceDisconnectTimer) { clearTimeout(this._iceDisconnectTimer); this._iceDisconnectTimer = null; }
        if (this._groupCallAutoEndTimer) { clearTimeout(this._groupCallAutoEndTimer); this._groupCallAutoEndTimer = null; }
        if (this._resizeListener) { window.removeEventListener('resize', this._resizeListener); this._resizeListener = null; }
        if (this.localStream) { this.localStream.getTracks().forEach(t => t.stop()); this.localStream = null; }
        if (this.remoteStream) { this.remoteStream.getTracks().forEach(t => t.stop()); this.remoteStream = null; }
        if (this.screenStream) { this.screenStream.getTracks().forEach(t => t.stop()); this.screenStream = null; }
        if (this.peerConnection) {
            ['oniceconnectionstatechange','onconnectionstatechange','onsignalingstatechange','ontrack','onicecandidate']
                .forEach(k => this.peerConnection[k] = null);
            this.peerConnection.close(); this.peerConnection = null;
        }
        const lv = document.getElementById('local-video'), rv = document.getElementById('remote-video');
        if (lv) { lv.srcObject = null; lv.style.transform = ''; lv.style.display = ''; }
        if (rv) { rv.srcObject = null; rv.style.display = ''; }
        document.getElementById('call-screen')?.classList.remove('audio-call', 'video-call', 'screen-sharing');
        this.currentCall = null; this.isAudioMuted = false; this.isVideoMuted = false;
        this.isSharingScreen = false; this.isVideoCall = false;
        this.localVideoEnabled = false; this.remoteVideoEnabled = false;
        this.iceCandidatesQueue = []; this.isAnswering = false;
        this.pendingAnswer = null; this.pendingIceCandidates = []; this._callConnected = false;
        this._callConnectedAt = null;
        this._originalVideoTrack = null; this._userMediaVideoSender = null;
        this._screenAudioSender = null; this._originalAudioTrack = null;
        this._isRenegotiating = false; this._isOfferer = false; this._remoteAnswerApplied = false;
        this._iceRestartCount = 0; this._turnCredentials = null;
        this._handRaised = false; this._raisedHands = new Set();
        this._isGroupScreenSharing = false; this._groupScreenTrackPublication = null;
        this._emitConnectionState('idle');
        if (this.livekitRoom) {
            try { this.livekitRoom.disconnect(); } catch(e) {}
            this.livekitRoom = null; this.livekitLocalParticipant = null; this.livekitParticipants = [];
        }
        document.querySelectorAll('[id^="lk-audio-"],[id^="lk-video-"],[id^="lk-tile-"]').forEach(el => {
            try { el.srcObject = null; } catch(e) {} el.remove();
        });
        ['group-video-container','lk-local-tile','lk-local-video','lk-group-styles',
         'lk-call-controls','lk-status-bar','lk-chat-panel','lk-file-input',
         'lk-screen-share-tile'].forEach(id => document.getElementById(id)?.remove());
    }
}
const webrtcManager = new WebRTCManager();
(function patchForGroupCalls() {
    function hookClient(client) {
        if (!client || client._lkGroupCallHooked) return;
        client._lkGroupCallHooked = true;
        client.on('Room.timeline', (event, room) => {
            if (event.getType() === GROUP_CALL_EVENT_TYPE) {
                webrtcManager.handleGroupCallEvent(event, room.roomId);
            }
        });
        console.log('[LiveKit] ✅ Écoute Room.timeline activée');
    }
    const iv = setInterval(() => {
        if (typeof matrixManager === 'undefined') return;
        const cl = matrixManager.getClient?.();
        if (cl) hookClient(cl);
        if (!matrixManager._loginPatched) {
            matrixManager._loginPatched = true;
            const origLogin = matrixManager.login.bind(matrixManager);
            matrixManager.login = async function(...args) {
                const r = await origLogin(...args);
                hookClient(matrixManager.getClient?.());
                return r;
            };
        }
        if (cl && matrixManager._loginPatched) clearInterval(iv);
    }, 300);
    const origAccept = window.acceptCall;
    window.acceptCall = function() {
        if (window._pendingGroupCall) webrtcManager.acceptGroupCall();
        else if (origAccept) origAccept();
    };
    const origDecline = window.declineCall;
    window.declineCall = function() {
        if (window._pendingGroupCall) {
            window._pendingGroupCall = null;
            matrixManager._stopRinging?.();
            if (typeof soundManager !== 'undefined') soundManager?.stopCallRingtone?.();
            const modal = document.getElementById('incoming-call-modal');
            if (modal) { modal.classList.remove('show'); modal.classList.remove('active'); }
        } else if (origDecline) origDecline();
    };
})();

