// ui-controller.js — SENDT v15.9
// ✅ Nouveautés v15.9 :
//   - Rendu Markdown des messages : **gras**, *italique*, `code`, ```blocs```, > citations
//   - Mentions @ dans les groupes : popup dropdown WhatsApp-like, insertion @nom
//   - Héritage complet v15.8 (ticks bleus, présence, toasts, screen share)

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
        // ✅ v16.0 : Compteurs de messages non lus par room
        this._unreadCounts = {};
        // Couleurs expéditeur
        this._senderColorMap = {};
        this._senderColorPalette = ['#25D366','#53bdeb','#f093fb','#ffa726','#1abc9c','#e74c3c','#9b59b6','#e67e22','#3498db'];
        this._senderColorIdx = 0;
        // ✅ Accusés de lecture {roomId: {eventId: Set<userId>}}
        this._readReceipts = {};
        // ✅ Présence {userId: {presence, lastActiveAgo, currentlyActive, ts}}
        this._presenceMap = {};
        // ✅ Vue unique {eventId: true}
        this._viewOnceOpened = {};
        // ✅ Dernière activité vocale {roomId: isRecording}
        this._voiceRecordingRooms = {};
        // ✅ Intervalle de refresh de la présence dans le header
        this._presenceRefreshInterval = null;
        // ✅ v15.9 : Mentions @ — état du dropdown
        this._mentionQuery = '';
        this._mentionDropdownOpen = false;
        this._mentionStartPos = -1;
        this._mentionInputId = 'chat-input';
    }

    init() {
        this.setupEventListeners();
        this._injectPresenceStyles();
        this._injectToastStyles();
        this._initLocalVideoDrag();
        if ('Notification' in window && Notification.permission === 'default') {
            Notification.requestPermission().catch(() => {});
        }
    }

    // ✅ v16.1 : Vidéo locale déplaçable comme WhatsApp
    _initLocalVideoDrag() {
        const el = document.getElementById('local-video');
        if (!el) return;
        let dragging = false, startX, startY, elRight, elBottom;
        const getParent = () => document.getElementById('call-screen');

        const onDown = (e) => {
            const cs = getParent();
            if (!cs?.classList.contains('active')) return;
            e.preventDefault();
            dragging = true;
            const pt = e.touches?.[0] || e;
            startX = pt.clientX; startY = pt.clientY;
            const pr = cs.getBoundingClientRect(), er = el.getBoundingClientRect();
            elRight = pr.right - er.right;
            elBottom = pr.bottom - er.bottom;
            el.style.transition = 'none';
        };

        const onMove = (e) => {
            if (!dragging) return;
            e.preventDefault();
            const pt = e.touches?.[0] || e;
            const dx = pt.clientX - startX, dy = pt.clientY - startY;
            const pr = getParent().getBoundingClientRect();
            const w = el.offsetWidth, h = el.offsetHeight;
            const right  = Math.max(0, Math.min(elRight - dx,  pr.width  - w));
            const bottom = Math.max(0, Math.min(elBottom - dy, pr.height - h));
            el.style.right = right + 'px';
            el.style.bottom = bottom + 'px';
            el.style.left = 'auto';
            el.style.top = 'auto';
        };

        const onUp = () => { dragging = false; el.style.transition = ''; };

        el.addEventListener('mousedown', onDown);
        el.addEventListener('touchstart', onDown, { passive: false });
        document.addEventListener('mousemove', onMove);
        document.addEventListener('touchmove', onMove, { passive: false });
        document.addEventListener('mouseup', onUp);
        document.addEventListener('touchend', onUp);
        // Reset position when call ends
        window.addEventListener('call-ended', () => {
            el.style.right = '16px'; el.style.bottom = '24px'; el.style.left = 'auto'; el.style.top = 'auto';
            el.style.transition = '';
        });
    }

    // ✅ Styles toast WhatsApp
    _injectToastStyles() {
        if (document.getElementById('wa-toast-styles')) return;
        const s = document.createElement('style');
        s.id = 'wa-toast-styles';
        s.textContent = `
            #wa-toast-container {
                position: fixed !important; top: 16px !important; right: 16px !important;
                z-index: 99999 !important; display: flex; flex-direction: column;
                gap: 8px; pointer-events: none; max-width: 360px;
            }
            .wa-toast {
                display: flex !important; align-items: center; gap: 10px;
                padding: 10px 14px; border-radius: 12px;
                background: var(--bg-secondary, #1F2C34) !important;
                box-shadow: 0 4px 20px rgba(0,0,0,.6) !important;
                min-width: 240px; max-width: 340px;
                border-left: 3px solid var(--sn-green, #25D366) !important;
                pointer-events: auto !important; cursor: pointer; opacity: 1 !important;
                transform: translateX(0) !important;
                animation: waToastIn .3s cubic-bezier(.21,1.02,.73,1) forwards !important;
            }
            @keyframes waToastIn {
                from { transform: translateX(110%); opacity: 0; }
                to   { transform: translateX(0);    opacity: 1; }
            }
            .wa-toast-avatar { width:38px;height:38px;border-radius:50%;flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:.92rem;font-weight:700;color:#fff; }
            .wa-toast-body { flex:1;min-width:0; }
            .wa-toast-sender { font-size:.76rem;font-weight:700;color:var(--sn-green,#25D366);margin-bottom:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis; }
            .wa-toast-content { font-size:.83rem;color:var(--text-primary,#E9EDEF);white-space:nowrap;overflow:hidden;text-overflow:ellipsis; }
            .wa-toast-time { font-size:.68rem;color:var(--text-muted,#8696A0);flex-shrink:0;margin-left:4px; }
            .wa-toast-close { background:none;border:none;color:var(--text-muted,#8696A0);cursor:pointer;font-size:.75rem;flex-shrink:0;padding:0 0 0 4px;line-height:1; }
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

    // ═══════════════════════════════════════════════════════
    // ✅ v15.9 : RENDU MARKDOWN
    // ═══════════════════════════════════════════════════════
    _renderMarkdown(text) {
        if (!text) return '';
        // 1. Sanitiser d'abord pour éviter XSS
        let t = this.sanitize(text);

        // 2. Blocs de code ```...```  (multi-lignes)
        t = t.replace(/```([\s\S]*?)```/g, (_, code) => {
            return `<pre class="md-code-block"><code>${code.trim()}</code></pre>`;
        });

        // 3. Code inline `...`
        t = t.replace(/`([^`\n]+)`/g, '<code class="md-inline-code">$1</code>');

        // 4. Citation > au début d'une ligne
        t = t.replace(/^&gt; ?(.*)$/gm, '<div class="md-blockquote">$1</div>');

        // 5. Gras **...**  ou __...__
        t = t.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
        t = t.replace(/__([^_\n]+)__/g, '<strong>$1</strong>');

        // 6. Italique *...* ou _..._
        t = t.replace(/\*([^*\n]+)\*/g, '<em>$1</em>');
        t = t.replace(/_([^_\n]+)_/g, '<em>$1</em>');

        // 7. Barré ~~...~~
        t = t.replace(/~~([^~\n]+)~~/g, '<del>$1</del>');

        // 8. Mentions @userId → badge coloré
        t = t.replace(/@([\w.-]+(?::[^\s<>]+)?)/g, (match, uid) => {
            const fullId = uid.includes(':') ? `@${uid}` : uid;
            const displayName = this._resolveDisplayName(`@${uid}`) || fullId;
            return `<span class="md-mention">@${this.sanitize(displayName !== `@${uid}` ? displayName : uid)}</span>`;
        });

        // 9. Retours à la ligne → <br> (sauf à l'intérieur des blocs <pre>)
        // On utilise un marqueur temporaire pour protéger les <pre>
        const prePlaceholders = [];
        t = t.replace(/<pre[\s\S]*?<\/pre>/g, (m) => {
            prePlaceholders.push(m);
            return `\x00PRE${prePlaceholders.length - 1}\x00`;
        });
        t = t.replace(/\n/g, '<br>');
        // Restaurer les blocs <pre>
        t = t.replace(/\x00PRE(\d+)\x00/g, (_, i) => prePlaceholders[parseInt(i)]);

        return t;
    }

    // ═══════════════════════════════════════════════════════
    // ✅ v15.9 : MENTIONS @ — logique complète
    // ═══════════════════════════════════════════════════════

    /** Retourne la liste des membres du groupe courant (hors soi-même) */
    _buildMentionList() {
        if (!this.currentContact?.isGroup && !this.currentContact?.isChannel) return [];
        try {
            const cl = matrixManager.getClient();
            const room = cl?.getRoom(this.currentContact.roomId);
            if (!room) return [];
            return room.getJoinedMembers()
                .filter(m => m.userId !== matrixManager.getUserId())
                .map(m => ({ userId: m.userId, displayName: m.name || m.userId }));
        } catch(e) { return []; }
    }

    /** Affiche le dropdown de mention filtré par `query` */
    _showMentionDropdown(query) {
        const members = this._buildMentionList();
        const filtered = members.filter(m =>
            m.displayName.toLowerCase().includes(query.toLowerCase()) ||
            m.userId.toLowerCase().includes(query.toLowerCase())
        ).slice(0, 8);

        if (!filtered.length) { this._hideMentionDropdown(); return; }

        let dd = document.getElementById('mention-dropdown');
        if (!dd) {
            dd = document.createElement('div');
            dd.id = 'mention-dropdown';
            dd.className = 'mention-dropdown';
            document.body.appendChild(dd);
        }

        dd.innerHTML = filtered.map(m => {
            const initial = m.displayName.charAt(0).toUpperCase();
            const colors = ['#25D366','#128C7E','#4facfe','#f093fb','#ffa726','#e74c3c','#9b59b6'];
            const bg = colors[m.userId.charCodeAt(1) % colors.length];
            return `<div class="mention-item" data-userid="${this.sanitize(m.userId)}" data-name="${this.sanitize(m.displayName)}"
                onmousedown="event.preventDefault();uiController._insertMention('${this.sanitize(m.userId)}','${this.sanitize(m.displayName).replace(/'/g,'\\\'')}')"
                >
                <span class="mention-avatar" style="background:${bg}">${initial}</span>
                <span class="mention-name">${this.sanitize(m.displayName)}</span>
                <span class="mention-uid">${this.sanitize(m.userId.split(':')[0])}</span>
            </div>`;
        }).join('');

        // Positionner au-dessus du champ de saisie
        const inp = document.getElementById('chat-input');
        if (inp) {
            const rect = inp.getBoundingClientRect();
            dd.style.bottom = (window.innerHeight - rect.top + 4) + 'px';
            dd.style.left = rect.left + 'px';
            dd.style.width = Math.min(320, rect.width) + 'px';
        }
        dd.classList.add('show');
        this._mentionDropdownOpen = true;
    }

    /** Cache le dropdown de mention */
    _hideMentionDropdown() {
        const dd = document.getElementById('mention-dropdown');
        if (dd) dd.classList.remove('show');
        this._mentionDropdownOpen = false;
        this._mentionStartPos = -1;
        this._mentionQuery = '';
    }

    /** Insère @NomAffichage dans le champ de saisie à la position du @ */
    _insertMention(userId, displayName) {
        const inp = document.getElementById(this._mentionInputId || 'chat-input');
        if (!inp) return;
        const before = inp.value.substring(0, this._mentionStartPos);
        const after  = inp.value.substring(inp.selectionStart);
        const mention = `@${displayName} `;
        inp.value = before + mention + after;
        const pos = before.length + mention.length;
        inp.setSelectionRange(pos, pos);
        inp.focus();
        this._hideMentionDropdown();
    }

    /** Attache l'écoute @ sur le champ de saisie (appelé après init) */
    _setupMentionListener() {
        this._bindMentionToInput('chat-input');
        this._bindMentionToInput('in-call-chat-input');
    }

    _bindMentionToInput(inputId) {
        const inp = document.getElementById(inputId);
        if (!inp || inp._mentionBound) return;
        inp._mentionBound = true;

        inp.addEventListener('input', () => {
            const val = inp.value;
            const pos = inp.selectionStart;
            const before = val.substring(0, pos);
            const atIdx = before.lastIndexOf('@');
            if (atIdx === -1) { this._hideMentionDropdown(); return; }
            const fragment = before.substring(atIdx + 1);
            if (/\s/.test(fragment)) { this._hideMentionDropdown(); return; }
            if (!this.currentContact?.isGroup && !this.currentContact?.isChannel) {
                this._hideMentionDropdown(); return;
            }
            this._mentionStartPos = atIdx;
            this._mentionQuery = fragment;
            this._mentionInputId = inputId;
            this._showMentionDropdown(fragment);
        });

        inp.addEventListener('keydown', (e) => {
            if (!this._mentionDropdownOpen) return;
            if (e.key === 'Escape') { this._hideMentionDropdown(); e.preventDefault(); }
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                const items = document.querySelectorAll('#mention-dropdown .mention-item');
                if (!items.length) return;
                e.preventDefault();
                const active = document.querySelector('#mention-dropdown .mention-item.active');
                let idx = active ? Array.from(items).indexOf(active) : -1;
                if (active) active.classList.remove('active');
                idx = e.key === 'ArrowDown' ? (idx + 1) % items.length : (idx - 1 + items.length) % items.length;
                items[idx].classList.add('active');
                items[idx].scrollIntoView({ block: 'nearest' });
            }
            if (e.key === 'Enter' || e.key === 'Tab') {
                const active = document.querySelector('#mention-dropdown .mention-item.active');
                if (active) { e.preventDefault(); this._insertMention(active.dataset.userid, active.dataset.name); }
            }
        });

        inp.addEventListener('blur', () => {
            setTimeout(() => this._hideMentionDropdown(), 150);
        });
    }

    // ✅ Formater la présence WhatsApp-like
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

    // ✅ Styles présence + ticks + typing + mentions
    _injectPresenceStyles() {
        if (document.getElementById('presence-styles')) return;
        const s = document.createElement('style');
        s.id = 'presence-styles';
        s.textContent = `
            /* ── Présence ── */
            .presence-dot { width:10px;height:10px;border-radius:50%;position:absolute;bottom:0;right:0;border:2px solid var(--bg-primary,#111B21);z-index:2;transition:background .4s; }
            .presence-dot.online  { background:#25D366; }
            .presence-dot.offline { background:#6a6f74; }
            .presence-dot.unavailable { background:#ffa726; }
            .avatar { position:relative; }
            .contact-item .avatar { overflow:visible !important; }

            /* ── Ticks WhatsApp 4 états (v16.0 : horloge + single + double gris + double bleu) ── */
            .msg-ticks { display:inline-flex;align-items:center;margin-left:3px;flex-shrink:0; }
            .msg-ticks i { font-size:.72rem;line-height:1; }
            .msg-ticks.sending i   { color:#8696A0;font-size:.65rem; }
            .msg-ticks.delivered i { color:#8696A0; }
            .msg-ticks.read i      { color:#53bdeb; }

            /* ── Typing WhatsApp ── */
            .typing-wave { display:inline-flex;align-items:flex-end;gap:2px;margin-right:4px;height:14px; }
            .typing-wave span { display:inline-block;width:4px;height:4px;border-radius:50%;background:var(--sn-green,#25D366);opacity:.7;animation:waveUp 1.2s infinite ease-in-out; }
            .typing-wave span:nth-child(2) { animation-delay:.2s; }
            .typing-wave span:nth-child(3) { animation-delay:.4s; }
            @keyframes waveUp { 0%,60%,100%{transform:translateY(0)} 30%{transform:translateY(-5px)} }
            .typing-text { font-size:.8rem;color:var(--sn-green,#25D366); }
            #typing-indicator.show { padding:4px 16px 2px; }

            /* ── Vue unique ── */
            .view-once-badge { display:inline-flex;align-items:center;gap:4px;background:rgba(0,133,63,.15);color:var(--sn-green,#25D366);border:1px solid rgba(0,133,63,.3);border-radius:12px;padding:4px 10px;font-size:.75rem;cursor:pointer;user-select:none; }
            .view-once-badge i { font-size:.8rem; }

            /* ── v16.0 : Onglets Médias/Docs (contact & groupe) ── */
            .cim-media-tabs { display:flex;border-bottom:1px solid var(--border-color,#2A3942);margin:8px 16px 0; }
            .cim-tab { flex:1;padding:8px 4px;background:none;border:none;border-bottom:2px solid transparent;color:var(--text-muted,#8696A0);cursor:pointer;font-size:.78rem;font-weight:600;display:flex;align-items:center;justify-content:center;gap:5px;transition:color .15s; }
            .cim-tab.active { color:var(--sn-green,#25D366);border-bottom-color:var(--sn-green,#25D366); }
            .cim-tab-panel { padding:0 4px 4px; }
            .cim-empty { padding:16px;text-align:center;color:var(--text-muted,#8696A0);font-size:.82rem; }
            .cim-docs-list { display:flex;flex-direction:column;gap:2px;padding:6px 0; }
            .cim-doc-item { display:flex;align-items:center;gap:10px;padding:8px 12px;border-radius:8px;cursor:pointer;transition:background .12s; }
            .cim-doc-item:hover { background:var(--bg-tertiary,#2A3942); }
            .cim-doc-icon { width:36px;height:36px;border-radius:8px;background:rgba(37,211,102,.12);display:flex;align-items:center;justify-content:center;color:var(--sn-green,#25D366);font-size:.95rem;flex-shrink:0; }
            .cim-doc-info { flex:1;min-width:0; }
            .cim-doc-name { display:block;font-size:.83rem;font-weight:500;color:var(--text-primary,#E9EDEF);white-space:nowrap;overflow:hidden;text-overflow:ellipsis; }
            .cim-doc-size { display:block;font-size:.7rem;color:var(--text-muted,#8696A0); }
            .contact-info-media-thumb.video-thumb { background:var(--bg-tertiary,#2A3942);display:flex;align-items:center;justify-content:center;cursor:pointer; }

            /* ── Info contact ── */
            #contact-info-modal .modal-content { max-width:480px;max-height:90vh;overflow-y:auto;border-radius:12px;padding:0; }
            .contact-info-header { background:linear-gradient(135deg,#1F2C34,#2A3942);padding:32px 20px 20px;text-align:center;position:relative; }
            .contact-info-avatar { width:96px;height:96px;border-radius:50%;margin:0 auto 12px;display:flex;align-items:center;justify-content:center;font-size:2.2rem;font-weight:700;color:#fff;position:relative; }
            .contact-info-presence { position:absolute;bottom:4px;right:4px;width:14px;height:14px;border-radius:50%;border:2.5px solid #1F2C34;z-index:2; }
            .contact-info-name { font-size:1.2rem;font-weight:700;color:#E9EDEF;margin-bottom:4px; }
            .contact-info-status { font-size:.82rem;color:#8696A0; }
            .contact-info-section { padding:0 16px;border-bottom:1px solid var(--border-color,rgba(255,255,255,.06)); }
            .contact-info-row { display:flex;align-items:flex-start;gap:14px;padding:14px 0;border-bottom:1px solid var(--border-color,rgba(255,255,255,.04)); }
            .contact-info-row:last-child { border-bottom:none; }
            .contact-info-icon { color:var(--sn-green,#25D366);width:20px;flex-shrink:0;margin-top:2px; }
            .contact-info-label { font-size:.72rem;color:#8696A0;margin-bottom:2px; }
            .contact-info-value { font-size:.9rem;color:#E9EDEF; }
            .contact-info-media-grid { display:grid;grid-template-columns:repeat(3,1fr);gap:3px;padding:12px 0; }
            .contact-info-media-thumb { aspect-ratio:1;object-fit:cover;cursor:pointer;background:var(--bg-tertiary,#2A3942);border-radius:4px; }
            .contact-info-actions { display:flex;gap:8px;padding:16px;justify-content:center; }
            .contact-info-action-btn { flex:1;padding:10px 8px;background:rgba(0,133,63,.1);border:1px solid rgba(0,133,63,.3);color:var(--sn-green,#25D366);border-radius:8px;cursor:pointer;display:flex;flex-direction:column;align-items:center;gap:4px;font-size:.72rem;font-weight:500;transition:background .15s;max-width:90px; }
            .contact-info-action-btn:hover { background:rgba(0,133,63,.2); }
            .contact-info-action-btn i { font-size:1.1rem; }
            .contact-info-danger-btn { width:100%;padding:12px;background:none;border:1px solid var(--accent-danger,#e74c3c);color:var(--accent-danger,#e74c3c);border-radius:8px;cursor:pointer;font-size:.88rem;margin:0 16px 16px;width:calc(100% - 32px);display:flex;align-items:center;justify-content:center;gap:8px; }

            /* ── Historique appels ── */
            .call-history-missed-badge { width:6px;height:6px;border-radius:50%;background:#e74c3c;display:inline-block;margin-right:2px; }

            /* ── v16.0 : Badge messages non lus (WhatsApp-like) ── */
            .unread-badge {
                display:inline-flex;align-items:center;justify-content:center;
                min-width:18px;height:18px;border-radius:9px;
                background:var(--sn-green,#25D366);color:#fff;
                font-size:.68rem;font-weight:700;padding:0 5px;
                margin-left:auto;flex-shrink:0;
            }
            .contact-bottom-row { display:flex;align-items:center;gap:4px; }
            .contact-bottom-row .contact-last-msg { flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap; }

            /* ── v15.9 : Markdown dans les messages ── */
            .msg-bubble strong { font-weight:700;color:inherit; }
            .msg-bubble em { font-style:italic; }
            .msg-bubble del { text-decoration:line-through;opacity:.7; }
            .msg-bubble .md-inline-code {
                font-family:monospace;font-size:.82em;
                background:rgba(0,0,0,.25);padding:1px 5px;border-radius:4px;
                color:#e8c97a;white-space:nowrap;
            }
            .msg-bubble .md-code-block {
                display:block;background:rgba(0,0,0,.3);border-radius:6px;
                padding:8px 10px;margin:6px 0;overflow-x:auto;
                font-family:monospace;font-size:.78rem;line-height:1.5;
                color:#e8ffd0;white-space:pre;
            }
            .msg-bubble .md-code-block code { background:none;padding:0;color:inherit;font-size:inherit; }

            /* ── v16.2 : Visionneuse de statut WhatsApp-style ── */
            #status-viewer-modal.show { display:flex; }
            .sv-wrap { position:relative;width:100%;max-width:480px;height:100vh;max-height:100vh;background:#000;display:flex;flex-direction:column;overflow:hidden; }
            .sv-progress { display:flex;gap:3px;padding:10px 12px 0;position:relative;z-index:2; }
            .sv-bar { flex:1;height:3px;background:rgba(255,255,255,.35);border-radius:2px;overflow:hidden; }
            .sv-bar-fill { width:0;height:100%;background:#fff; }
            .sv-bar-fill.done { width:100%; }
            .sv-bar-fill.active { width:0;animation:svFill linear forwards; }
            @keyframes svFill { to { width:100%; } }
            .sv-header { display:flex;align-items:center;padding:10px 12px;position:relative;z-index:2; }
            .sv-body { flex:1;display:flex;align-items:center;justify-content:center;position:relative;overflow:hidden; }
            .sv-text-card { width:100%;height:100%;display:flex;align-items:center;justify-content:center;padding:40px;text-align:center; }
            .sv-text-card p { font-size:1.4rem;color:#fff;font-weight:600;line-height:1.4; }
            .sv-caption { position:absolute;bottom:20px;left:0;right:0;text-align:center;padding:12px 20px;background:rgba(0,0,0,.5);color:#fff;font-size:.9rem; }

            /* ── v16.2 : Réactions WhatsApp-style ── */
            .msg-reactions { display:flex;flex-wrap:wrap;gap:4px;margin-top:4px; }
            .msg-reaction { display:inline-flex;align-items:center;gap:2px;background:var(--bg-tertiary,#2A3942);border:1px solid rgba(255,255,255,.1);border-radius:12px;padding:2px 6px;font-size:.9rem;cursor:pointer;transition:background .15s;user-select:none; }
            .msg-reaction:hover { background:rgba(37,211,102,.15);border-color:rgba(37,211,102,.4); }
            .msg-reaction-count { font-size:.72rem;color:var(--text-muted,#8696A0);margin-left:1px; }
            .chat-message.own .msg-reaction { background:rgba(0,0,0,.2); }

            /* ── v16.1 : Lecteur vidéo inline WhatsApp-style ── */
            .video-message-inline { position:relative;border-radius:10px;overflow:hidden;max-width:280px;background:#000; }
            .chat-video { display:block;width:100%;max-height:320px;border-radius:10px;outline:none; }
            .video-dl-btn { position:absolute;top:6px;right:6px;background:rgba(0,0,0,.55);border-radius:50%;width:28px;height:28px;display:flex;align-items:center;justify-content:center;cursor:pointer;color:#fff;font-size:.7rem;backdrop-filter:blur(4px); }
            .video-dl-btn:hover { background:rgba(0,0,0,.8); }
            .msg-bubble .md-blockquote {
                border-left:3px solid var(--sn-green,#25D366);
                padding:2px 8px;margin:4px 0;
                color:rgba(255,255,255,.65);font-style:italic;
                background:rgba(0,133,63,.06);border-radius:0 4px 4px 0;
            }
            .msg-bubble .md-mention {
                display:inline;color:var(--sn-green,#25D366);font-weight:600;
                background:rgba(37,211,102,.1);border-radius:4px;padding:0 3px;
            }

            /* ── v15.9 : Dropdown mentions @ ── */
            .mention-dropdown {
                display:none;position:fixed;z-index:9999;
                background:var(--bg-secondary,#1F2C34);
                border:1px solid rgba(255,255,255,.1);border-radius:10px;
                box-shadow:0 -4px 20px rgba(0,0,0,.5);
                max-height:240px;overflow-y:auto;
                padding:4px 0;
            }
            .mention-dropdown.show { display:block; }
            .mention-item {
                display:flex;align-items:center;gap:10px;
                padding:8px 14px;cursor:pointer;
                transition:background .12s;
            }
            .mention-item:hover, .mention-item.active { background:rgba(37,211,102,.12); }
            .mention-avatar {
                width:30px;height:30px;border-radius:50%;
                display:flex;align-items:center;justify-content:center;
                font-size:.8rem;font-weight:700;color:#fff;flex-shrink:0;
            }
            .mention-name { font-size:.85rem;font-weight:600;color:var(--text-primary,#E9EDEF);flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis; }
            .mention-uid { font-size:.7rem;color:var(--text-muted,#8696A0);flex-shrink:0; }
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
        window.addEventListener('reactions-updated',      e => { if (this.currentContact?.roomId === e.detail?.roomId) this._updateReactionDom(e.detail.roomId); });
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

        // ✅ Présence + last seen en temps réel
        window.addEventListener('presence-changed', e => {
            const { userId, presence, lastActiveAgo, currentlyActive } = e.detail;
            if (!this._presenceMap[userId]) this._presenceMap[userId] = {};
            this._presenceMap[userId].presence = presence;
            this._presenceMap[userId].lastActiveAgo = lastActiveAgo ?? this._presenceMap[userId].lastActiveAgo;
            this._presenceMap[userId].currentlyActive = currentlyActive ?? false;
            this._presenceMap[userId].ts = Date.now();
            this._updatePresenceDot(userId, presence);
            if (this.currentContact?.userId === userId && !this.currentContact.isGroup) {
                this._refreshContactHeader(userId);
            }
            const infoModal = document.getElementById('contact-info-modal');
            if (infoModal?.classList.contains('show')) {
                const presenceDot = infoModal.querySelector('.contact-info-presence');
                const presenceText = infoModal.querySelector('.contact-info-status');
                if (presenceDot) presenceDot.style.background = presence === 'online' ? '#25D366' : '#6a6f74';
                if (presenceText) presenceText.textContent = this._formatPresence(userId) || 'Hors ligne';
            }
        });

        // ✅ Accusés de lecture avec propagation WhatsApp
        window.addEventListener('read-receipt-received', e => {
            const { roomId, eventId, userId } = e.detail;
            if (!this._readReceipts[roomId]) this._readReceipts[roomId] = {};
            if (!this._readReceipts[roomId][eventId]) this._readReceipts[roomId][eventId] = new Set();
            this._readReceipts[roomId][eventId].add(userId);
            if (this.currentContact?.roomId === roomId) {
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
                this._updateTickForEvent(roomId, eventId);
            }
        });

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

        // ✅ v15.9 : Attacher le listener de mentions après que le DOM est prêt
        setTimeout(() => this._setupMentionListener(), 500);

        document.addEventListener('click', e => {
            if (!e.target.closest('.msg-context-menu')) this.closeContextMenu();
            if (!e.target.closest('.emoji-picker-container,.emoji-picker-panel,.emoji-btn,.incall-emoji-btn')) this.closeEmojiPicker();
            if (!e.target.closest('#mention-dropdown') && !e.target.closest('#chat-input')) this._hideMentionDropdown();
            const menu = document.getElementById('ephemeral-menu');
            if (menu?.classList.contains('show') && !e.target.closest('#ephemeral-menu') && !e.target.closest('[onclick*="toggleEphemeralMenu"]')) {
                menu.classList.remove('show');
            }
        });

        document.addEventListener('touchstart', (e) => {
            const btn = e.target.closest?.('.voice-btn');
            if (btn?.id === 'voice-record-btn') try { this.startVoiceRecording(); } catch(err) {}
            if (btn?.id === 'video-record-btn') try { this.startVideoRecording(); } catch(err) {}
        }, { passive: true });
        document.addEventListener('touchend', (e) => {
            const btn = e.target.closest?.('.voice-btn');
            if (btn?.id === 'voice-record-btn') try { this.stopVoiceRecording(); } catch(err) {}
            if (btn?.id === 'video-record-btn') try { this.stopVideoRecording(); } catch(err) {}
        }, { passive: true });
        document.addEventListener('touchcancel', (e) => {
            const btn = e.target.closest?.('.voice-btn');
            if (btn?.id === 'voice-record-btn') try { this.stopVoiceRecording(); } catch(err) {}
            if (btn?.id === 'video-record-btn') try { this.stopVideoRecording(); } catch(err) {}
        }, { passive: true });
    }

    // ✅ Mettre à jour le header du chat avec présence live
    _refreshContactHeader(userId) {
        const idEl = document.getElementById('selected-contact-id');
        if (!idEl) return;
        const formatted = this._formatPresence(userId);
        idEl.textContent = formatted || matrixManager.getLastSeenText(userId) || userId;
        const data = this._presenceMap[userId];
        const isOnline = data?.presence === 'online' || data?.currentlyActive;
        idEl.style.color = isOnline ? 'var(--sn-green,#25D366)' : '';
    }

    _updatePresenceDot(userId, presence) {
        const safeId = userId.replace(/[^a-zA-Z0-9]/g, '_');
        const dot = document.getElementById('presence-' + safeId);
        if (dot) dot.className = `presence-dot ${presence === 'online' ? 'online' : presence === 'unavailable' ? 'unavailable' : 'offline'}`;
    }

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

    // ═══════════════ TOAST WHATSAPP RICHE ═══════════════
    _showWAToast(data) {
        const { displayName, userId, type, message, mxcUrl, filename } = data;
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
        this._injectToastStyles();
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
        const toasts = container.querySelectorAll('.wa-toast');
        if (toasts.length > 5) toasts[0].remove();
        const hideTimer = setTimeout(() => {
            if (!document.body.contains(toast)) return;
            toast.style.transition = 'opacity .35s ease, transform .35s ease';
            toast.style.opacity = '0'; toast.style.transform = 'translateX(110%)';
            setTimeout(() => toast.remove(), 360);
        }, 5000);
        toast.addEventListener('mouseenter', () => clearTimeout(hideTimer));
        toast.addEventListener('mouseleave', () => {
            setTimeout(() => {
                if (!document.body.contains(toast)) return;
                toast.style.transition = 'opacity .35s ease, transform .35s ease';
                toast.style.opacity = '0'; toast.style.transform = 'translateX(110%)';
                setTimeout(() => toast.remove(), 360);
            }, 2000);
        });
    }

    // ✅ v16.0 : Mettre à jour le badge de messages non lus dans la liste des contacts
    _updateUnreadBadge(roomId, count) {
        const item = document.querySelector(`.contact-item[data-room-id="${CSS.escape(roomId)}"]`);
        if (!item) return;
        let badge = item.querySelector('.unread-badge');
        if (count > 0) {
            if (!badge) {
                badge = document.createElement('span');
                badge.className = 'unread-badge';
                const bottomRow = item.querySelector('.contact-bottom-row');
                if (bottomRow) bottomRow.appendChild(badge);
            }
            badge.textContent = count > 99 ? '99+' : String(count);
        } else if (badge) {
            badge.remove();
        }
    }

    // ✅ v16.0 : Basculer entre onglets Media / Docs dans les modals info
    _switchCimTab(btn, showId, hideId) {
        const showEl = document.getElementById(showId);
        const hideEl = document.getElementById(hideId);
        if (showEl) showEl.style.display = '';
        if (hideEl) hideEl.style.display = 'none';
        const tabs = btn.closest('.cim-media-tabs')?.querySelectorAll('.cim-tab');
        tabs?.forEach(t => t.classList.remove('active'));
        btn.classList.add('active');
    }

    // ✅ v16.1 : Construire le HTML de la section Médias/Docs partagés (scan chatMessages complet)
    _buildSharedMediaHtml(roomId) {
        const msgs = this.chatMessages[roomId] || [];
        const sharedMedia = [], sharedFiles = [];
        for (let i = msgs.length - 1; i >= 0; i--) {
            const m = msgs[i];
            if (!m || !m.mxcUrl) continue;
            if (['image', 'video'].includes(m.type) && sharedMedia.length < 9) sharedMedia.push(m);
            else if (['file', 'audio', 'voice'].includes(m.type) && sharedFiles.length < 20) sharedFiles.push(m);
            if (sharedMedia.length >= 9 && sharedFiles.length >= 20) break;
        }
        const mediaGrid = sharedMedia.length > 0
            ? `<div class="contact-info-media-grid">${sharedMedia.map(m => {
                const thumbUrl = matrixManager.mxcToThumbnailUrl?.(m.mxcUrl, 150, 150) || '';
                if (m.type === 'image') return `<img class="contact-info-media-thumb" src="${thumbUrl}" onclick="uiController.showImageFullscreen('${this.sanitize(m.mxcUrl)}')" alt="" loading="lazy">`;
                return `<div class="contact-info-media-thumb video-thumb" style="display:flex;align-items:center;justify-content:center;background:#111" onclick="uiController.downloadFile('${this.sanitize(m.mxcUrl)}','video')"><i class="fas fa-play-circle" style="color:#fff;font-size:1.5rem"></i></div>`;
            }).join('')}</div>`
            : '<div class="cim-empty"><i class="fas fa-photo-video"></i><br>Aucune photo ou vidéo</div>';
        const docsList = sharedFiles.length > 0
            ? `<div class="cim-docs-list">${sharedFiles.map(f => {
                const icon = (typeof getFileIcon === 'function' ? getFileIcon(f.mimetype) : null)
                    || (f.type === 'voice' ? 'fa-microphone' : f.type === 'audio' ? 'fa-music' : 'fa-file');
                const size = typeof formatFileSize === 'function' ? formatFileSize(f.fileInfo?.size || 0) : '';
                const fname = this.sanitize(f.filename || f.message || 'Fichier');
                return `<div class="cim-doc-item" onclick="uiController.downloadFile('${this.sanitize(f.mxcUrl)}','${fname}')">
                    <div class="cim-doc-icon"><i class="fas ${icon}"></i></div>
                    <div class="cim-doc-info"><span class="cim-doc-name">${fname}</span>${size ? `<span class="cim-doc-size">${size}</span>` : ''}</div>
                    <i class="fas fa-download" style="color:var(--text-muted,#8696A0);flex-shrink:0;font-size:.8rem"></i>
                </div>`;
            }).join('')}</div>`
            : '<div class="cim-empty"><i class="fas fa-paperclip"></i><br>Aucun document partagé</div>';
        const totalMedia = sharedMedia.length, totalDocs = sharedFiles.length;
        return `<div class="cim-media-tabs">
            <button class="cim-tab active" onclick="uiController._switchCimTab(this,'cim-media-panel','cim-docs-panel')">
                <i class="fas fa-photo-video"></i> Médias${totalMedia > 0 ? ` · ${totalMedia}` : ''}
            </button>
            <button class="cim-tab" onclick="uiController._switchCimTab(this,'cim-docs-panel','cim-media-panel')">
                <i class="fas fa-paperclip"></i> Docs${totalDocs > 0 ? ` · ${totalDocs}` : ''}
            </button>
        </div>
        <div id="cim-media-panel" class="cim-tab-panel">${mediaGrid}</div>
        <div id="cim-docs-panel"  class="cim-tab-panel" style="display:none">${docsList}</div>`;
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
        // ✅ v16.2 : Quick-reaction bar (WhatsApp-style)
        const QUICK_EMOJIS = ['👍','❤️','😂','😮','😢','🙏'];
        const qbar = document.createElement('div');
        qbar.style.cssText = 'display:flex;gap:6px;padding:8px 10px;border-bottom:1px solid var(--border-color,rgba(255,255,255,.08))';
        QUICK_EMOJIS.forEach(e => {
            const btn = document.createElement('button');
            btn.textContent = e;
            btn.style.cssText = 'background:none;border:none;font-size:1.3rem;cursor:pointer;padding:2px 4px;border-radius:6px;transition:transform .15s';
            btn.onmouseenter = () => { btn.style.transform = 'scale(1.3)'; };
            btn.onmouseleave = () => { btn.style.transform = ''; };
            btn.addEventListener('click', () => { this._sendReaction(d.eventId, e); this.closeContextMenu(); });
            qbar.appendChild(btn);
        });
        menu.appendChild(qbar);
        const items = [];
        items.push({ i: 'fa-reply', l: 'Répondre', a: () => this.startReply(d) });
        if (d.isOwn && d.type === 'text') items.push({ i: 'fa-pen', l: 'Modifier', a: () => this.startEdit(d) });
        if (d.type === 'text') items.push({ i: 'fa-copy', l: 'Copier', a: () => copyToClipboard(d.message) });
        items.push({ i: 'fa-share', l: 'Transférer', a: () => this.showForwardModal(d) });
        items.push({ i: 'fa-thumbtack', l: 'Épingler', a: () => this.pinMsg(d) });
        items.push({ i: 'fa-star', l: this._isStarred(d.eventId) ? 'Retirer l\'étoile' : 'Mettre en favori', a: () => this._toggleStar(d.eventId) });
        items.push({ i: 'fa-trash-alt', l: 'Supprimer', a: () => this._showDeleteDialog(d), danger: true });
        const listEl = document.createElement('div');
        listEl.innerHTML = items.map(x => `<button class="ctx-menu-item ${x.danger ? 'danger' : ''}"><i class="fas ${x.i}"></i> ${x.l}</button>`).join('');
        listEl.querySelectorAll('.ctx-menu-item').forEach((b, idx) => b.addEventListener('click', () => { items[idx].a(); this.closeContextMenu(); }));
        menu.appendChild(listEl);
        menu.style.top  = Math.min(ev.clientY, window.innerHeight - (items.length * 44 + 60)) + 'px';
        menu.style.left = Math.min(ev.clientX, window.innerWidth - 200) + 'px';
        document.body.appendChild(menu);
    }

    async _sendReaction(eventId, emoji) {
        if (!eventId || !this.currentContact) return;
        await matrixManager.sendReaction(this.currentContact.roomId, eventId, emoji);
    }

    // ✅ v16.2 : Mise à jour légère des réactions sans re-render complet
    _updateReactionDom(roomId) {
        const reactions = matrixManager.getReactions?.(roomId) || {};
        // Update existing reaction elements
        document.querySelectorAll('.msg-reactions[data-eid]').forEach(el => {
            const eid = el.dataset.eid;
            const r = reactions[eid];
            if (r && Object.keys(r).length) {
                el.innerHTML = Object.entries(r).map(([e, users]) => `<span class="msg-reaction" onclick="uiController._sendReaction('${eid}','${e}')">${e}<span class="msg-reaction-count">${users.length > 1 ? users.length : ''}</span></span>`).join('');
            } else { el.innerHTML = ''; }
        });
        // For messages that didn't have reactions before, full re-render is needed
        const hasNew = Object.keys(reactions).some(eid => !document.querySelector(`.msg-reactions[data-eid="${eid}"]`));
        if (hasNew) this.renderChatMessages();
    }

    closeContextMenu() { const m = document.getElementById('active-context-menu'); if (m) m.remove(); }

    // ✅ v16.2 : Suppression WhatsApp-style (pour moi / pour tout le monde)
    _showDeleteDialog(d) {
        this._pendingDeleteMsg = d;
        let dlg = document.getElementById('wa-delete-dlg');
        if (dlg) dlg.remove();
        dlg = document.createElement('div');
        dlg.id = 'wa-delete-dlg';
        dlg.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:9999;display:flex;align-items:flex-end;justify-content:center;backdrop-filter:blur(4px)';
        const isPending = d.eventId && d.eventId.startsWith('~');
        dlg.innerHTML = `<div style="background:var(--bg-secondary,#1F2C34);width:100%;max-width:480px;border-radius:16px 16px 0 0;padding:20px 20px 28px">
            <p style="text-align:center;font-size:.82rem;color:var(--text-muted);margin-bottom:16px">Supprimer le message ?</p>
            ${d.isOwn && !isPending ? `<button id="wa-del-everyone" style="width:100%;padding:14px;background:#e74c3c;border:none;border-radius:10px;color:#fff;font-size:.9rem;font-weight:600;cursor:pointer;margin-bottom:8px;display:flex;align-items:center;justify-content:center;gap:8px"><i class="fas fa-trash-alt"></i> Supprimer pour tout le monde</button>` : ''}
            <button id="wa-del-me" style="width:100%;padding:14px;background:var(--bg-tertiary,#2A3942);border:none;border-radius:10px;color:var(--text-primary);font-size:.9rem;cursor:pointer;margin-bottom:8px;display:flex;align-items:center;justify-content:center;gap:8px"><i class="fas fa-trash"></i> Supprimer pour moi</button>
            <button id="wa-del-cancel" style="width:100%;padding:12px;background:none;border:1px solid var(--border-color,rgba(255,255,255,.1));border-radius:10px;color:var(--text-muted);font-size:.88rem;cursor:pointer">Annuler</button>
        </div>`;
        dlg.querySelector('#wa-del-everyone')?.addEventListener('click', () => { this._deleteForEveryone(); dlg.remove(); });
        dlg.querySelector('#wa-del-me').addEventListener('click', () => { this._deleteForMe(); dlg.remove(); });
        dlg.querySelector('#wa-del-cancel').addEventListener('click', () => dlg.remove());
        dlg.addEventListener('click', e => { if (e.target === dlg) dlg.remove(); });
        document.body.appendChild(dlg);
    }

    _deleteForMe() {
        const d = this._pendingDeleteMsg; if (!d || !this.currentContact) return; this._pendingDeleteMsg = null;
        const rid = this.currentContact.roomId;
        if (this.chatMessages[rid]) { this.chatMessages[rid] = this.chatMessages[rid].filter(m => m.eventId !== d.eventId); this.renderChatMessages(); }
        // Store locally so it stays hidden after reload
        const key = `wa_del_me_${matrixManager.getUserId()}`;
        const hidden = JSON.parse(localStorage.getItem(key) || '[]');
        if (!hidden.includes(d.eventId)) { hidden.push(d.eventId); localStorage.setItem(key, JSON.stringify(hidden.slice(-500))); }
    }

    async _deleteForEveryone() {
        const d = this._pendingDeleteMsg; if (!d || !this.currentContact) return; this._pendingDeleteMsg = null;
        const rid = this.currentContact.roomId;
        await matrixManager.deleteMessage(rid, d.eventId);
        if (this.chatMessages[rid]) { this.chatMessages[rid] = this.chatMessages[rid].filter(m => m.eventId !== d.eventId); this.renderChatMessages(); }
    }

    async deleteMsg(d) { this._showDeleteDialog(d); }

    // ✅ v16.2 : Étoile / Favoris messages
    _getStarred() { return JSON.parse(localStorage.getItem(`wa_stars_${matrixManager.getUserId() || 'u'}`) || '[]'); }
    _isStarred(eid) { return eid && this._getStarred().includes(eid); }
    _toggleStar(eid) {
        if (!eid) return;
        const key = `wa_stars_${matrixManager.getUserId() || 'u'}`;
        const stars = this._getStarred();
        const idx = stars.indexOf(eid);
        if (idx >= 0) stars.splice(idx, 1); else stars.push(eid);
        localStorage.setItem(key, JSON.stringify(stars.slice(-200)));
        this.renderChatMessages();
        showToast(idx >= 0 ? 'Retiré des favoris' : 'Ajouté aux favoris', 'info');
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
    cancelCurrentRecording() { if (this.isVideoRecording) this.cancelVideoRecording(); else this.cancelVoiceRecording(); }

    // ═══════════════ VIDEO MESSAGE RECORDING ═══════════════
    // Max recording duration in seconds — keeps file under server upload limit
    get _maxVideoSec() { return 30; }

    async startVideoRecording() {
        if (this.isRecording || this.isVideoRecording || !this.currentContact) return;
        try {
            // Use low resolution to keep file size manageable (≈ 1–3 MB / 30 s)
            const stream = await navigator.mediaDevices.getUserMedia({
                video: { facingMode: 'user', width: { ideal: 480 }, height: { ideal: 360 } },
                audio: true
            });
            this._videoStream = stream;
            const preview = document.getElementById('video-rec-preview');
            if (preview) preview.srcObject = stream;

            let mimeType = 'video/webm;codecs=vp8,opus';
            if (!MediaRecorder.isTypeSupported(mimeType)) mimeType = 'video/webm';
            if (!MediaRecorder.isTypeSupported(mimeType)) mimeType = 'video/mp4';
            if (!MediaRecorder.isTypeSupported(mimeType)) mimeType = '';

            // Use a lower bitrate to further reduce file size
            const recOpts = mimeType ? { mimeType, videoBitsPerSecond: 400000, audioBitsPerSecond: 64000 } : {};
            this._videoRecorder = Object.keys(recOpts).length ? new MediaRecorder(stream, recOpts) : new MediaRecorder(stream);
            this._videoChunks = []; this.isVideoRecording = true; this.recordingStartTime = Date.now();
            this._videoRecorder.ondataavailable = e => { if (e.data.size > 0) this._videoChunks.push(e.data); };
            this._videoRecorder.onstop = async () => {
                stream.getTracks().forEach(t => t.stop());
                const p = document.getElementById('video-rec-preview');
                if (p) p.srcObject = null;
                const d = Date.now() - this.recordingStartTime;
                this._resetVideoRecUI();
                if (!this._videoChunks.length || d < 500) return;
                const mime = this._videoRecorder.mimeType || 'video/webm';
                const ext = mime.includes('mp4') ? 'mp4' : 'webm';
                const blob = new Blob(this._videoChunks, { type: mime });
                const maxSize = matrixManager.getMaxUploadSize?.() || 8 * 1024 * 1024;
                if (blob.size > maxSize) {
                    const mb = (blob.size / 1024 / 1024).toFixed(1);
                    const lim = (maxSize / 1024 / 1024).toFixed(0);
                    showToast(`Vidéo trop volumineuse (${mb} Mo, limite ${lim} Mo). Enregistrez moins longtemps.`, 'error');
                    return;
                }
                const file = new File([blob], `video_${Date.now()}.${ext}`, { type: mime });
                showToast('Envoi de la vidéo...', 'info');
                await matrixManager.sendFile(this.currentContact.roomId, file);
            };
            this._videoRecorder.start(200);
            this._showVideoRecUI();
            // Auto-stop at max duration
            this._videoMaxTimer = setTimeout(() => {
                if (this.isVideoRecording) { showToast('Durée maximale atteinte (30 s)', 'info'); this.stopVideoRecording(); }
            }, this._maxVideoSec * 1000);
        } catch(e) { showToast('Caméra inaccessible', 'error'); this.isVideoRecording = false; }
    }

    stopVideoRecording() {
        if (this._videoMaxTimer) { clearTimeout(this._videoMaxTimer); this._videoMaxTimer = null; }
        if (this.isVideoRecording && this._videoRecorder) try { this._videoRecorder.stop(); } catch(e) {}
        this.isVideoRecording = false;
    }

    cancelVideoRecording() {
        this._videoChunks = [];
        if (this._videoMaxTimer) { clearTimeout(this._videoMaxTimer); this._videoMaxTimer = null; }
        this._videoStream?.getTracks().forEach(t => t.stop());
        if (this.isVideoRecording && this._videoRecorder) try { this._videoRecorder.stop(); } catch(e) {}
        this.isVideoRecording = false;
        const p = document.getElementById('video-rec-preview'); if (p) p.srcObject = null;
        this._resetVideoRecUI();
    }

    _showVideoRecUI() {
        const ind = document.getElementById('recording-indicator');
        ind?.classList.add('active', 'video-mode');
        const c = document.getElementById('chat-input'); if (c) c.style.display = 'none';
        document.getElementById('video-record-btn')?.classList.add('recording');
        this.recordingTimerInterval = setInterval(() => {
            const elapsed = Math.floor((Date.now() - this.recordingStartTime) / 1000);
            const remaining = this._maxVideoSec - elapsed;
            const t = document.getElementById('recording-timer');
            if (t) {
                const s = elapsed;
                t.textContent = String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
                t.style.color = remaining <= 5 ? '#e74c3c' : '';
            }
        }, 100);
    }

    _resetVideoRecUI() {
        const ind = document.getElementById('recording-indicator');
        ind?.classList.remove('active', 'video-mode');
        const c = document.getElementById('chat-input'); if (c) c.style.display = '';
        document.getElementById('video-record-btn')?.classList.remove('recording');
        const t = document.getElementById('recording-timer');
        if (t) { t.style.color = ''; t.textContent = '00:00'; }
        if (this.recordingTimerInterval) { clearInterval(this.recordingTimerInterval); this.recordingTimerInterval = null; }
    }

    // ✅ v16.2 : Recherche in-chat
    toggleMsgSearch() {
        const bar = document.getElementById('msg-search-bar');
        if (!bar) return;
        const visible = bar.style.display !== 'none';
        if (visible) {
            bar.style.display = 'none';
            this._msgSearchQuery = '';
            this.renderChatMessages();
            document.getElementById('msg-search-btn')?.classList.remove('active');
        } else {
            bar.style.display = 'flex';
            document.getElementById('msg-search-input')?.focus();
            document.getElementById('msg-search-btn')?.classList.add('active');
        }
    }

    _onMsgSearch(val) {
        this._msgSearchQuery = val;
        this.renderChatMessages();
        // Scroll to first match
        setTimeout(() => {
            const first = document.querySelector('.chat-messages .chat-message');
            if (first) first.scrollIntoView({ block: 'center' });
        }, 50);
    }

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

    async playVoiceMessage(url, id, eventId) {
        // ✅ v16.0 : Envoyer l'accusé de lecture quand le vocal est joué (côté destinataire)
        if (eventId && this._isRealEventId(eventId) && this.currentContact) {
            const rid = this.currentContact.roomId;
            const msgs = this.chatMessages[rid] || [];
            const m = msgs.find(x => x.eventId === eventId);
            if (m && !m.isOwn) matrixManager.sendReadReceipt(rid, eventId).catch(() => {});
        }
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

    // ✅ v16.1 : Envoyer l'accusé de lecture quand une vidéo inline est jouée
    _onVideoPlay(eventId) {
        if (eventId && this._isRealEventId(eventId) && this.currentContact) {
            const rid = this.currentContact.roomId;
            const msgs = this.chatMessages[rid] || [];
            const m = msgs.find(x => x.eventId === eventId);
            if (m && !m.isOwn) matrixManager.sendReadReceipt(rid, eventId).catch(() => {});
        }
    }

    async downloadFile(url, name, eventId) {
        // ✅ v16.0 : Envoyer l'accusé de lecture quand le fichier est téléchargé (côté destinataire)
        if (eventId && this._isRealEventId(eventId) && this.currentContact) {
            const rid = this.currentContact.roomId;
            const msgs = this.chatMessages[rid] || [];
            const m = msgs.find(x => x.eventId === eventId);
            if (m && !m.isOwn) matrixManager.sendReadReceipt(rid, eventId).catch(() => {});
        }
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
                const grpUnread = this._unreadCounts[g.roomId] || 0;
                return `<div class="contact-item" onclick="uiController.selectGroup('${rid}')" data-room-id="${rid}">
                    <div class="avatar" style="background:linear-gradient(135deg,#4facfe,#00f2fe)"><i class="fas fa-users" style="font-size:1rem"></i></div>
                    <div class="contact-details">
                        <div class="contact-top-row"><span class="contact-name">${n}</span><span class="contact-time">${lastTime}</span></div>
                        <div class="contact-bottom-row"><span class="contact-last-msg">${lastMsg}</span>${grpUnread > 0 ? `<span class="unread-badge">${grpUnread > 99 ? '99+' : grpUnread}</span>` : ''}</div>
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
                const presData = this._presenceMap[ct.userId];
                const presClass = presData?.presence === 'online' ? 'online' : presData?.presence === 'unavailable' ? 'unavailable' : 'offline';
                const presenceDotHtml = `<div class="presence-dot ${presClass}" id="presence-${safeId}"></div>`;
                const ctUnread = this._unreadCounts[ct.roomId] || 0;
                return `<div class="contact-item" onclick="uiController.selectContact('${u}')" data-room-id="${this.sanitize(ct.roomId)}">
                    <div class="avatar" id="avatar-${safeId}">
                        <span class="avatar-initial" style="background:${bgColor}">${initial}</span>
                        ${presenceDotHtml}
                    </div>
                    <div class="contact-details">
                        <div class="contact-top-row"><span class="contact-name">${n}</span><span class="contact-time">${lastTime}</span></div>
                        <div class="contact-bottom-row"><span class="contact-last-msg">${lastMsg || u}</span>${ctUnread > 0 ? `<span class="unread-badge">${ctUnread > 99 ? '99+' : ctUnread}</span>` : ''}</div>
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
        // ✅ v15.9 : Réattacher le listener de mention pour ce nouveau contexte
        setTimeout(() => this._setupMentionListener(), 200);
        await this.loadChatHistory();
    }

    async selectGroup(roomId) {
        const group = this.groups.find(g => g.roomId === roomId); if (!group) return;
        this.currentContact = { roomId, displayName: group.displayName, isGroup: true, memberCount: group.memberCount || 0 };
        // ✅ v16.0 : Effacer le badge de messages non lus
        this._unreadCounts[roomId] = 0; this._updateUnreadBadge(roomId, 0);
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
        if (this._presenceRefreshInterval) { clearInterval(this._presenceRefreshInterval); this._presenceRefreshInterval = null; }
        this.cancelReply();
        // ✅ v15.9 : Réattacher le listener de mention pour ce groupe
        setTimeout(() => this._setupMentionListener(), 200);
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
                    <div style="max-height:200px;overflow-y:auto">${memberItems}</div>
                </div>
                <div style="border-top:1px solid var(--border-color);padding-bottom:8px">
                    <div style="padding:10px 16px 0;font-size:.72rem;font-weight:600;color:var(--text-muted);text-transform:uppercase">Médias & fichiers partagés</div>
                    ${this._buildSharedMediaHtml(roomId)}
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
        // Clear search when switching conversations
        this._msgSearchQuery = ''; const sb = document.getElementById('msg-search-bar'); if (sb) sb.style.display = 'none'; document.getElementById('msg-search-btn')?.classList.remove('active');
        // ✅ v16.0 : Effacer le badge de messages non lus
        this._unreadCounts[contact.roomId] = 0; this._updateUnreadBadge(contact.roomId, 0);
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
                const formatted = this._formatPresence(userId);
                idEl.textContent = formatted || matrixManager.getLastSeenText?.(userId) || userId;
                const isOnline = this._presenceMap[userId]?.presence === 'online';
                idEl.style.color = isOnline ? 'var(--sn-green,#25D366)' : '';
            }
        }
        if (this._presenceRefreshInterval) clearInterval(this._presenceRefreshInterval);
        this._presenceRefreshInterval = setInterval(() => {
            if (this.currentContact?.userId === userId) this._refreshContactHeader(userId);
        }, 30000);

        this.cancelReply();
        // ✅ v15.9 : Cacher le dropdown de mention quand on change de contact
        this._hideMentionDropdown();
        await this.loadChatHistory();
    }

    async showContactInfoModal(userId) {
        const contact = this.contacts.find(c => c.userId === userId);
        if (!contact) return;
        const presData = this._presenceMap[userId];
        const isOnline = presData?.presence === 'online' || presData?.currentlyActive;
        const presenceText = this._formatPresence(userId) || (isOnline ? '🟢 En ligne' : 'Hors ligne');
        const initial  = contact.displayName.charAt(0).toUpperCase();
        const colors   = ['#25D366','#128C7E','#4facfe','#f093fb','#ffa726','#e74c3c','#9b59b6'];
        const bgColor  = colors[initial.charCodeAt(0) % colors.length];
        const mediaHtml = this._buildSharedMediaHtml(contact.roomId);

        let modal = document.getElementById('contact-info-modal');
        if (!modal) { modal = document.createElement('div'); modal.id = 'contact-info-modal'; modal.className = 'modal'; document.body.appendChild(modal); }
        const avatarUrl = this._avatarCache[userId];
        const avatarContent = avatarUrl
            ? `<img src="${avatarUrl}" style="width:96px;height:96px;border-radius:50%;object-fit:cover;display:block;margin:0 auto" alt="">`
            : `<span style="background:${bgColor};width:96px;height:96px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:2.2rem;font-weight:700;color:#fff;margin:0 auto">${initial}</span>`;

        modal.innerHTML = `
        <div class="modal-content" style="max-width:480px;max-height:90vh;overflow-y:auto;padding:0;border-radius:12px;overflow:hidden">
            <div class="contact-info-header">
                <div style="position:relative;display:inline-block;margin-bottom:12px">
                    ${avatarContent}
                    <div class="contact-info-presence" style="background:${isOnline ? '#25D366' : '#6a6f74'}"></div>
                </div>
                <div class="contact-info-name">${this.sanitize(contact.displayName)}</div>
                <div class="contact-info-status" id="cim-presence-text">${this.sanitize(presenceText)}</div>
            </div>
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
            <div class="contact-info-section" style="padding-bottom:8px">
                <div style="padding:12px 16px 0;font-size:.72rem;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:.06em">Médias & fichiers partagés</div>
                ${mediaHtml}
            </div>
            <div style="padding:12px 16px 16px">
                <button onclick="uiController.deleteContact('${this.sanitize(userId)}');closeModal('contact-info-modal')" class="contact-info-danger-btn">
                    <i class="fas fa-user-times"></i> Supprimer ce contact
                </button>
            </div>
            <button onclick="closeModal('contact-info-modal')" style="position:absolute;top:12px;right:12px;background:rgba(255,255,255,.2);border:none;color:#fff;width:28px;height:28px;border-radius:50%;cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:.9rem">
                <i class="fas fa-times"></i>
            </button>
        </div>`;

        showModal('contact-info-modal');
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
            // ✅ v16.2 : Appel refusé → historique
            matrixManager.addCallToHistory({
                userId: this.incomingCallData.callerId || this.incomingCallData.roomId,
                roomId: this.incomingCallData.roomId,
                type: this.incomingCallData.withVideo ? 'video' : 'audio',
                direction: 'incoming',
                status: 'declined',
                duration: 0,
                timestamp: Date.now()
            });
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
        if (p.classList.contains('show') && this.currentContact) {
            this.renderInCallMessages();
            // Ensure mention listener is bound (in-call input is always in DOM)
            this._bindMentionToInput('in-call-chat-input');
            document.getElementById('in-call-chat-input')?.focus();
        }
    }

    toggleInCallChatExpand() {
        const p = document.getElementById('in-call-chat-panel'); if (!p) return;
        const expanded = p.classList.toggle('expanded');
        const btn = document.getElementById('in-call-expand-btn');
        if (btn) btn.querySelector('i').className = expanded ? 'fas fa-compress-alt' : 'fas fa-expand-alt';
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
            const hasRid = this._isRealEventId(m.eventId);
            const isReadIcm = hasRid && this._isMessageRead(this.currentContact?.roomId, m.eventId);
            const ticks = m.isOwn ? `<span class="msg-ticks ${hasRid ? (isReadIcm ? 'read' : 'delivered') : 'sending'}"><i class="fas ${hasRid ? 'fa-check-double' : 'fa-clock'}"></i></span>` : '';
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
        if (msg.type === 'text') return `<div class="icm-text">${this._renderMarkdown(msg.message || '')}</div>`;
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
        const EXPIRY = 24 * 60 * 60 * 1000; // 24h
        const now = Date.now();
        const myStatuses = (await matrixManager.getMyStatuses().catch(() => [])).filter(s => now - (s.timestamp || 0) < EXPIRY);
        const contactStatuses = (await matrixManager.getContactStatuses().catch(() => [])).filter(cs => cs.status && now - (cs.status.timestamp || 0) < EXPIRY);

        const myTime = myStatuses.length > 0 ? this._timeAgo(myStatuses[0].timestamp) : null;
        const myRing = myStatuses.length > 0 ? 'style="box-shadow:0 0 0 2.5px var(--sn-green)"' : '';
        let html = `<div class="status-section">
            <div class="status-my-status" onclick="uiController.${myStatuses.length > 0 ? '_viewMyStatus()' : 'showStatusComposer()'}">
                <div class="status-avatar" ${myRing} style="position:relative">
                    <span class="avatar-initial" style="background:var(--wa-darker)">${(matrixManager.getUserId() || 'M')[1]?.toUpperCase() || 'M'}</span>
                    ${myStatuses.length === 0 ? '<div style="position:absolute;bottom:-2px;right:-2px;width:18px;height:18px;background:var(--sn-green);border-radius:50%;display:flex;align-items:center;justify-content:center;border:2px solid var(--bg-primary)"><i class="fas fa-plus" style="font-size:.5rem;color:#fff"></i></div>' : ''}
                </div>
                <div class="status-info">
                    <div class="status-name">Mon statut</div>
                    <div class="status-time">${myTime || 'Appuyez pour ajouter un statut'}</div>
                </div>
                <button class="icon-btn" onclick="event.stopPropagation();uiController.showStatusComposer()" title="Nouveau statut" style="flex-shrink:0"><i class="fas fa-edit"></i></button>
            </div>
        </div>`;
        if (contactStatuses.length > 0) {
            html += '<div class="status-section"><div class="status-section-title">Mises à jour récentes</div>';
            for (const cs of contactStatuses) {
                const ago = this._timeAgo(cs.status.timestamp);
                const initial = (cs.displayName || '?')[0].toUpperCase();
                html += `<div class="status-contact-item" onclick="uiController.viewStatus('${this.sanitize(cs.userId)}')">
                    <div class="status-avatar status-avatar-ring"><span class="avatar-initial">${initial}</span></div>
                    <div class="status-info"><div class="status-name">${this.sanitize(cs.displayName)}</div><div class="status-time">${ago}</div></div>
                </div>`;
            }
            html += '</div>';
        } else {
            html += '<div class="status-empty"><i class="fas fa-circle-notch"></i><p>Aucune mise à jour récente de vos contacts</p></div>';
        }
        container.innerHTML = html;
    }

    async _viewMyStatus() {
        const myStatuses = await matrixManager.getMyStatuses().catch(() => []);
        if (!myStatuses.length) { this.showStatusComposer(); return; }
        this._openStatusViewer({ displayName: 'Mon statut', allStatuses: myStatuses, userId: matrixManager.getUserId() });
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
        this._openStatusViewer(cs);
    }

    _openStatusViewer(cs) {
        const statuses = cs.allStatuses || [];
        if (!statuses.length) return;
        let idx = 0;
        const DURATION = 5000;
        if (this._statusViewerTimer) clearInterval(this._statusViewerTimer);

        const viewer = document.getElementById('status-viewer-modal'); if (!viewer) return;
        const render = () => {
            const s = statuses[idx];
            const bars = statuses.map((_, i) => `<div class="sv-bar"><div class="sv-bar-fill${i < idx ? ' done' : i === idx ? ' active' : ''}" style="${i === idx ? `animation-duration:${DURATION}ms` : ''}"></div></div>`).join('');
            let body = s.type === 'image' && s.mxcUrl
                ? `<img src="${matrixManager.mxcToHttpUrl?.(s.mxcUrl) || ''}" style="width:100%;height:100%;object-fit:contain">${s.text ? `<div class="sv-caption">${this.sanitize(s.text)}</div>` : ''}`
                : `<div class="sv-text-card" style="background:${s.backgroundColor || '#25D366'}"><p>${this.sanitize(s.text || '')}</p></div>`;
            viewer.innerHTML = `<div class="sv-wrap" onclick="uiController._svNext()">
                <div class="sv-progress">${bars}</div>
                <div class="sv-header">
                    <button class="icon-btn" onclick="event.stopPropagation();closeModal('status-viewer-modal');uiController._svStop()"><i class="fas fa-times"></i></button>
                    <div style="flex:1;margin-left:10px"><strong style="color:#fff;font-size:.9rem">${this.sanitize(cs.displayName)}</strong><div style="font-size:.72rem;color:rgba(255,255,255,.7)">${this._timeAgo(s.timestamp)}</div></div>
                </div>
                <div class="sv-body">${body}</div>
            </div>`;
            showModal('status-viewer-modal');
        };
        this._svIdx = () => idx;
        this._svNext = () => {
            idx++;
            if (idx >= statuses.length) { closeModal('status-viewer-modal'); this._svStop(); return; }
            render(); this._svStartTimer();
        };
        this._svStop = () => { if (this._statusViewerTimer) { clearTimeout(this._statusViewerTimer); this._statusViewerTimer = null; } };
        this._svStartTimer = () => { this._svStop(); this._statusViewerTimer = setTimeout(() => this._svNext?.(), DURATION); };
        render(); this._svStartTimer();
    }

    // ═══════════════ CHAT ═══════════════
    async loadChatHistory() {
        if (!this.currentContact) return;
        const msgs = await matrixManager.getMessages(this.currentContact.roomId);
        this.chatMessages[this.currentContact.roomId] = msgs;

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

        const allMsgs = msgs;
        let lastIncomingEventId = null;
        for (let i = allMsgs.length - 1; i >= 0; i--) {
            const m = allMsgs[i];
            if (!m.isOwn && this._isRealEventId(m.eventId)) { lastIncomingEventId = m.eventId; break; }
        }
        if (lastIncomingEventId) {
            matrixManager.sendReadReceipt(this.currentContact.roomId, lastIncomingEventId).catch(() => {});
        }

        this.renderChatMessages();
        // ✅ v15.9 : S'assurer que le listener mention est actif après chargement
        setTimeout(() => this._setupMentionListener(), 300);
    }

    renderChatMessages() {
        const cc = document.getElementById('chat-messages'); if (!cc || !this.currentContact) return;
        const rid = this.currentContact.roomId;
        // Filter messages hidden "for me"
        const hiddenKey = `wa_del_me_${matrixManager.getUserId()}`;
        const hiddenIds = new Set(JSON.parse(localStorage.getItem(hiddenKey) || '[]'));
        const starredIds = new Set(this._getStarred());
        const searchQuery = this._msgSearchQuery?.toLowerCase().trim() || '';
        const reactions = matrixManager.getReactions?.(rid) || {};
        let msgs = (this.chatMessages[rid] || []).filter(m => !hiddenIds.has(m.eventId));
        if (searchQuery) msgs = msgs.filter(m => (m.message || m.filename || '').toLowerCase().includes(searchQuery));
        const pinned = matrixManager.getPinnedMessages(rid);
        const isGroup = this.currentContact?.isGroup || this.currentContact?.isChannel;

        if (!msgs.length) {
            cc.innerHTML = searchQuery
                ? '<div class="empty-chat"><i class="fas fa-search"></i><p>Aucun résultat</p></div>'
                : '<div class="empty-chat"><i class="fas fa-comments"></i><p>Aucun message</p><span>Envoyez un message pour démarrer</span></div>';
            return;
        }
        let html = '', lastDateStr = '';
        msgs.forEach((msg, i) => {
            const dateStr = formatDateGroup(msg.timestamp);
            if (dateStr !== lastDateStr) { html += `<div class="date-separator"><span>${dateStr}</span></div>`; lastDateStr = dateStr; }
            const t   = formatTime(msg.timestamp);
            const o   = msg.isOwn ? 'own' : '';
            const id  = msg.eventId || 'msg_' + msg.timestamp + '_' + i;
            const isPinned = pinned.includes(msg.eventId);
            const isStarred = starredIds.has(msg.eventId);
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

            let ticks = '';
            if (msg.isOwn) {
                const hasRealId = this._isRealEventId(msg.eventId);
                const isRead    = hasRealId && this._isMessageRead(this.currentContact.roomId, msg.eventId);
                if (!hasRealId) {
                    // ✅ v16.0 : Horloge pendant l'envoi (exactement comme WhatsApp)
                    ticks = `<span class="msg-ticks sending" title="En attente"><i class="fas fa-clock"></i></span>`;
                } else if (isRead) {
                    // ✅ Double tick bleu = lu (comme WhatsApp)
                    ticks = `<span class="msg-ticks read" title="Lu"><i class="fas fa-check-double"></i></span>`;
                } else {
                    // ✅ Double tick gris = envoyé/reçu non lu (comme WhatsApp)
                    ticks = `<span class="msg-ticks delivered" title="Envoyé"><i class="fas fa-check-double"></i></span>`;
                }
            }

            const pinIcon  = isPinned  ? '<i class="fas fa-thumbtack pin-icon"></i>' : '';
            const starIcon = isStarred ? '<i class="fas fa-star star-icon" style="color:#ffa726;font-size:.65rem;margin-right:3px"></i>' : '';
            // ✅ v16.2 : Reactions WhatsApp-style
            const msgReactions = (msg.eventId && reactions[msg.eventId]) ? reactions[msg.eventId] : null;
            const reactHtml = msgReactions ? `<div class="msg-reactions" data-eid="${msg.eventId}">${Object.entries(msgReactions).map(([e, users]) => `<span class="msg-reaction" title="${users.map(u=>this._resolveDisplayName(u)).join(', ')}" onclick="uiController._sendReaction('${msg.eventId}','${e}')">${e}<span class="msg-reaction-count">${users.length > 1 ? users.length : ''}</span></span>`).join('')}</div>` : '';
            const ctxData = JSON.stringify({ eventId: msg.eventId, type: msg.type, message: msg.message, isOwn: msg.isOwn, sender: msg.sender, mxcUrl: msg.mxcUrl, audioDuration: msg.audioDuration }).replace(/"/g, '&quot;');
            html += `<div class="chat-message ${o}" data-msg-id="${id}" data-event-id="${msg.eventId || ''}" oncontextmenu="uiController.showMessageContextMenu(event,${ctxData})"><div class="msg-bubble">${pinIcon}${senderHtml}${replyH}<div class="msg-body">${this._renderContent(msg, i)}</div><div class="msg-footer">${ephemeralBadge}${editBadge}${starIcon}<span class="msg-time">${t}</span>${ticks}</div>${reactHtml}</div></div>`;
        });
        cc.innerHTML = html; cc.scrollTop = cc.scrollHeight;
    }

    // ═══════════════════════════════════════════════════════
    // ✅ v15.9 : _renderContent — texte → Markdown, reste inchangé
    // ═══════════════════════════════════════════════════════
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
        // ✅ v15.9 : Rendu Markdown pour les messages texte
        if (msg.type === 'text') return `<div class="md-text">${this._renderMarkdown(msg.message || '')}</div>`;

        if (msg.type === 'voice' && msg.mxcUrl) {
            const vid = 'voice_' + msg.timestamp + '_' + i;
            const dur = this._fmtDurMs(msg.audioDuration || 0);
            if (!this._waveformData[vid]) this._waveformData[vid] = generateWaveformBars(CONFIG.WAVEFORM_BARS || 35);
            const wfHTML = this._waveformData[vid].map((h, idx) => `<div class="wf-bar" data-idx="${idx}" style="height:${h}px"></div>`).join('');
            // ✅ v16.0 : passer eventId pour envoyer le receipt à la lecture
            return `<div class="voice-message" data-voice-id="${vid}"><button class="voice-play-btn" onclick="uiController.playVoiceMessage('${this.sanitize(msg.mxcUrl)}','${vid}','${this.sanitize(msg.eventId || '')}')"><i class="fas fa-play"></i></button><div class="voice-track"><div class="voice-waveform">${wfHTML}</div></div><span class="voice-duration">${dur}</span></div>`;
        }
        if (msg.type === 'audio' && msg.mxcUrl) {
            return `<div class="audio-message"><audio controls preload="none" style="width:100%;height:40px"><source src="${matrixManager.mxcToHttpUrl(msg.mxcUrl)}" type="${msg.mimetype || 'audio/mpeg'}">Non supporté.</audio></div>`;
        }
        if (msg.type === 'image' && msg.mxcUrl) return `<div class="image-message"><img src="${matrixManager.mxcToThumbnailUrl(msg.mxcUrl)}" class="chat-image" onclick="uiController.showImageFullscreen('${this.sanitize(msg.mxcUrl)}')"></div>`;
        // ✅ v16.1 : inline video player comme WhatsApp
        if (msg.type === 'video' && msg.mxcUrl) {
            const httpUrl = matrixManager.mxcToHttpUrl?.(msg.mxcUrl) || '';
            const eid = this.sanitize(msg.eventId || '');
            const fname = this.sanitize(msg.message || msg.filename || 'video');
            if (httpUrl) {
                return `<div class="video-message-inline"><video class="chat-video" controls playsinline preload="metadata" onplay="uiController._onVideoPlay('${eid}')" src="${httpUrl}"></video><div class="video-dl-btn" onclick="event.stopPropagation();uiController.downloadFile('${this.sanitize(msg.mxcUrl)}','${fname}','${eid}')" title="Télécharger"><i class="fas fa-download"></i></div></div>`;
            }
            return `<div class="video-message" onclick="uiController.downloadFile('${this.sanitize(msg.mxcUrl)}','${fname}','${eid}')"><div class="video-placeholder"><i class="fas fa-film"></i></div><div class="video-play-overlay"><i class="fas fa-play-circle"></i></div></div>`;
        }
        if (msg.type === 'file' && msg.mxcUrl) return `<div class="file-message" onclick="uiController.downloadFile('${this.sanitize(msg.mxcUrl)}','${this.sanitize(msg.filename || msg.message)}','${this.sanitize(msg.eventId || '')}')"><div class="file-icon"><i class="fas ${getFileIcon(msg.mimetype)}"></i></div><div class="file-details"><span class="file-name">${this.sanitize(msg.filename || msg.message)}</span><span class="file-size">${formatFileSize(msg.fileInfo?.size || 0)}</span></div><i class="fas fa-download file-dl-icon"></i></div>`;
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
        // ✅ v15.9 : Fermer le dropdown de mention à l'envoi
        this._hideMentionDropdown();
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

        const tempId  = '~pending_' + Date.now();
        const tempMsg = { eventId: tempId, type: 'text', message: msg, isOwn: true, timestamp: Date.now(), sender: matrixManager.getUserId() };
        const rid = this.currentContact.roomId;
        if (!this.chatMessages[rid]) this.chatMessages[rid] = [];
        this.chatMessages[rid].push(tempMsg);
        this.renderChatMessages();

        await matrixManager.sendMessage(rid, msg);
    }

    _isRealEventId(id) { return !!id && typeof id === 'string' && !id.startsWith('~') && id.length > 10; }

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
        if (isNew && !data.isOwn) {
            const ct = this.contacts.find(c => c.roomId === rid)
                    || this.groups.find(g => g.roomId === rid)
                    || this.channels.find(c => c.roomId === rid);
            if (ct) {
                let preview = (data.message || '').substring(0, 60);
                if (data.type === 'image')    preview = '📷 Photo';
                else if (data.type === 'video')   preview = '🎬 Vidéo';
                else if (data.type === 'voice')   preview = '🎙️ Message vocal';
                else if (data.type === 'audio')   preview = '🔊 Audio';
                else if (data.type === 'file')    preview = `📎 ${data.filename || 'Fichier'}`;
                else if (data.type === 'location') preview = '📍 Position partagée';
                const isCurrentRoom = this.currentContact?.roomId === rid;
                if (!isCurrentRoom) {
                    // ✅ v16.0 : Incrémenter badge non-lu et l'afficher dans la liste
                    this._unreadCounts[rid] = (this._unreadCounts[rid] || 0) + 1;
                    this._updateUnreadBadge(rid, this._unreadCounts[rid]);
                    // ✅ Toast WhatsApp pour rooms non actives (son géré par matrix-client.js)
                    this._showWAToast({
                        displayName: ct.displayName, userId: ct.userId || '',
                        roomId: rid, type: data.type, message: data.message,
                        mxcUrl: data.mxcUrl, filename: data.filename
                    });
                }
                // ✅ Notification desktop : si tab masqué OU si le chat n'est pas le chat courant
                if ('Notification' in window && Notification.permission === 'granted' && (document.hidden || !isCurrentRoom)) {
                    try {
                        const notif = new Notification(ct.displayName, { body: preview, icon: '/favicon.ico', tag: `msg-${rid}`, renotify: true, silent: !document.hidden });
                        notif.onclick = () => {
                            window.focus(); notif.close();
                            if (ct.userId) this.selectContact(ct.userId);
                            else if (ct.roomId) this.selectGroup?.(ct.roomId);
                        };
                    } catch(e) {}
                } else if ('Notification' in window && Notification.permission === 'default') {
                    Notification.requestPermission().catch(() => {});
                }
            }
        }
    }

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
        if (!q?.trim()) { this.renderContacts(); return; }
        const term = q.toLowerCase();
        const fg = (this.groups    || []).filter(g => g.displayName.toLowerCase().includes(term));
        const fc = (this.contacts  || []).filter(c => c.displayName.toLowerCase().includes(term) || c.userId.toLowerCase().includes(term));
        const fch = (this.channels || []).filter(ch => (ch.name || ch.displayName || '').toLowerCase().includes(term));
        const el = document.getElementById('contacts-list'); if (!el) return;
        if (!fg.length && !fc.length && !fch.length) { el.innerHTML = '<div class="empty-state"><p>Aucun résultat</p></div>'; return; }
        let html = '';
        fg.forEach(g => { html += `<div class="contact-item" data-room-id="${this.sanitize(g.roomId)}" onclick="uiController.selectGroup('${this.sanitize(g.roomId)}')"><div class="avatar" style="background:linear-gradient(135deg,#4facfe,#00f2fe)"><i class="fas fa-users"></i></div><div class="contact-details"><span class="contact-name">${this.sanitize(g.displayName)}</span><span class="contact-last-msg" style="color:var(--text-muted);font-size:.75rem">Groupe</span></div></div>`; });
        fc.forEach(c => { html += `<div class="contact-item" data-room-id="${this.sanitize(c.roomId)}" onclick="uiController.selectContact('${this.sanitize(c.userId)}')"><div class="avatar"><span class="avatar-initial">${c.displayName.charAt(0).toUpperCase()}</span></div><div class="contact-details"><span class="contact-name">${this.sanitize(c.displayName)}</span><span class="contact-last-msg" style="color:var(--text-muted);font-size:.75rem">${this.sanitize(c.userId)}</span></div></div>`; });
        fch.forEach(ch => { const n = ch.name || ch.displayName || ''; html += `<div class="contact-item" data-room-id="${this.sanitize(ch.roomId)}" onclick="uiController.selectGroup('${this.sanitize(ch.roomId)}')"><div class="avatar" style="background:linear-gradient(135deg,#ffa726,#ff5722)"><i class="fas fa-broadcast-tower"></i></div><div class="contact-details"><span class="contact-name">${this.sanitize(n)}</span><span class="contact-last-msg" style="color:var(--text-muted);font-size:.75rem">Salon</span></div></div>`; });
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
                .call-history-item{display:flex;align-items:center;gap:12px;padding:12px 16px;cursor:pointer;border-bottom:1px solid var(--border-color,rgba(255,255,255,.05));transition:background .15s}
                .call-history-item:hover{background:var(--bg-secondary,rgba(255,255,255,.03))}
                .call-history-avatar{width:48px;height:48px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:1.15rem;font-weight:700;color:#fff;flex-shrink:0}
                .call-history-info{flex:1;min-width:0}
                .call-history-name{font-size:.9rem;font-weight:600;color:var(--text-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-bottom:3px}
                .call-history-name.missed{color:#e74c3c}
                .call-history-meta{display:flex;align-items:center;gap:5px;font-size:.75rem;color:var(--text-muted)}
                .call-history-meta i{font-size:.72rem}
                .call-history-meta .missed{color:#e74c3c}
                .call-history-meta .outgoing{color:#53bdeb}
                .call-history-meta .incoming{color:var(--sn-green,#25D366)}
                .call-history-right{text-align:right;flex-shrink:0}
                .call-history-time{font-size:.72rem;color:var(--text-muted);margin-bottom:4px}
                .call-history-time.missed{color:#e74c3c}
                .call-history-actions{display:flex;gap:4px;justify-content:flex-end;margin-top:4px}
                .call-history-btn{width:32px;height:32px;border-radius:50%;border:none;background:rgba(37,211,102,.1);color:var(--sn-green,#25D366);cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:.8rem;transition:background .15s}
                .call-history-btn:hover{background:rgba(37,211,102,.22)}
                .call-history-btn.video-btn{background:rgba(79,172,254,.1);color:#4facfe}
                .call-history-count{display:inline-flex;align-items:center;justify-content:center;background:rgba(255,255,255,.12);color:var(--text-muted);border-radius:10px;padding:0 6px;font-size:.68rem;height:16px;margin-left:2px}
            `;
            document.head.appendChild(s);
        }

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
                    <div class="call-history-meta"><i class="fas ${dirIcon} ${dirClass}"></i><i class="fas ${typeIcon}"></i><span class="${dirClass}">${dirLabel}${durStr}</span></div>
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
console.log('✅ ui-controller.js v15.9 — Markdown (gras/italique/code/blocs/citations/mentions) + dropdown @ mentions groupes WhatsApp-like');
