// utils.js
// Fonctions utilitaires SENDT v14.0
// ═══════════════════════════════════════════════════════════════
// ============================================================================
// TOAST
// ============================================================================
function showToast(message, type = 'info') {
    const c = document.getElementById('toast-container'); if (!c) return;
    const t = document.createElement('div');
    t.className = `toast toast-${type}`;
    const icon = { success:'fa-check-circle', error:'fa-exclamation-circle', warning:'fa-exclamation-triangle', info:'fa-info-circle' }[type] || 'fa-info-circle';
    t.innerHTML = `<i class="fas ${icon}"></i> ${message}`;
    c.appendChild(t);
    setTimeout(() => { t.classList.add('fade-out'); setTimeout(() => t.remove(), 300); }, 3000);
}
// ============================================================================
// MODALS
// ============================================================================
function showModal(id) { const m = document.getElementById(id); if (m) { m.classList.add('show'); document.body.style.overflow = 'hidden'; } }
function closeModal(id) { const m = document.getElementById(id); if (m) { m.classList.remove('show'); document.body.style.overflow = ''; } }
// ============================================================================
// FORMATTING
// ============================================================================
function formatDuration(seconds) {
    const h = Math.floor(seconds / 3600), m = Math.floor((seconds % 3600) / 60), s = seconds % 60;
    if (h > 0) return `${h.toString().padStart(2,'0')}:${m.toString().padStart(2,'0')}:${s.toString().padStart(2,'0')}`;
    return `${m.toString().padStart(2,'0')}:${s.toString().padStart(2,'0')}`;
}
function formatDate(ts) {
    const d = new Date(ts), now = new Date(), diff = now - d;
    if (diff < 60000) return 'À l\'instant';
    if (diff < 3600000) return `Il y a ${Math.floor(diff/60000)} min`;
    if (diff < 86400000) return `Il y a ${Math.floor(diff/3600000)}h`;
    if (diff < 172800000) return 'Hier';
    return d.toLocaleDateString('fr-FR', { day:'numeric', month:'short', hour:'2-digit', minute:'2-digit' });
}
function formatTime(ts) { return new Date(ts).toLocaleTimeString('fr-FR', { hour:'2-digit', minute:'2-digit' }); }
function formatDateGroup(ts) {
    const d = new Date(ts), now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const msgDate = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const diff = today - msgDate;
    if (diff === 0) return 'Aujourd\'hui';
    if (diff <= 86400000) return 'Hier';
    if (diff <= 604800000) return d.toLocaleDateString('fr-FR', { weekday:'long' });
    return d.toLocaleDateString('fr-FR', { day:'numeric', month:'long', year:'numeric' });
}
function formatFileSize(bytes) {
    if (bytes < 1024) return bytes + ' o';
    if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' Ko';
    if (bytes < 1073741824) return (bytes / 1048576).toFixed(1) + ' Mo';
    return (bytes / 1073741824).toFixed(1) + ' Go';
}
function formatCallDuration(s) {
    if (s < 60) return `${s}s`;
    if (s < 3600) return `${Math.floor(s/60)}m ${s%60}s`;
    return `${Math.floor(s/3600)}h ${Math.floor((s%3600)/60)}m`;
}
// ============================================================================
// VALIDATION
// ============================================================================
function validateMatrixId(userId) { return /^@[a-zA-Z0-9._=-]+:[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(userId); }
function sanitizeHtml(text) { const d = document.createElement('div'); d.textContent = text; return d.innerHTML; }
// v13.0: Convert simple username to full Matrix ID
function toMatrixId(input) {
    if (!input) return input;
    input = input.trim();
    if (input.startsWith('@') && input.includes(':')) return input;
    if (input.startsWith('@')) return input + ':' + CONFIG.DEFAULT_DOMAIN;
    if (input.includes(':')) return '@' + input;
    return '@' + input + ':' + CONFIG.DEFAULT_DOMAIN;
}
// ============================================================================
// FILES
// ============================================================================
function getFileCategory(mimeType) {
    if (!mimeType) return 'file';
    if (mimeType.startsWith('image/')) return 'image';
    if (mimeType.startsWith('video/')) return 'video';
    if (mimeType.startsWith('audio/')) return 'audio';
    if (mimeType === 'application/pdf') return 'pdf';
    if (mimeType.includes('word') || mimeType.includes('document')) return 'document';
    if (mimeType.includes('sheet') || mimeType.includes('excel')) return 'spreadsheet';
    if (mimeType.includes('zip') || mimeType.includes('rar') || mimeType.includes('tar')) return 'archive';
    return 'file';
}
function getFileIcon(mimeType) {
    const icons = { image:'fa-file-image', video:'fa-file-video', audio:'fa-file-audio', pdf:'fa-file-pdf', document:'fa-file-word', spreadsheet:'fa-file-excel', archive:'fa-file-archive', file:'fa-file' };
    return icons[getFileCategory(mimeType)] || 'fa-file';
}
// ============================================================================
// WAVEFORM
// ============================================================================
function generateWaveformBars(count) {
    const bars = [], minH = CONFIG.WAVEFORM_MIN_HEIGHT || 3, maxH = CONFIG.WAVEFORM_MAX_HEIGHT || 22;
    for (let i = 0; i < count; i++) {
        const cw = 1 - Math.abs(i - count / 2) / (count / 2) * 0.4;
        bars.push(Math.floor(Math.random() * (maxH - minH) * cw + minH));
    }
    return bars;
}
// ============================================================================
// EMOJI RÉCENTS
// ============================================================================
class RecentEmojiManager {
    constructor() { this.recents = this._load(); }
    _load() { try { return JSON.parse(localStorage.getItem('sendt_recent_emojis')) || []; } catch(e) { return []; } }
    _save() { try { localStorage.setItem('sendt_recent_emojis', JSON.stringify(this.recents)); } catch(e) {} }
    add(emoji) {
        this.recents = this.recents.filter(e => e !== emoji);
        this.recents.unshift(emoji);
        if (this.recents.length > (CONFIG.RECENT_EMOJI_MAX || 30)) this.recents = this.recents.slice(0, CONFIG.RECENT_EMOJI_MAX);
        this._save();
    }
    getRecents() { return this.recents; }
}
const recentEmojiManager = new RecentEmojiManager();
// ============================================================================
// SOUND MANAGER v14.0
// ============================================================================
class SoundManager {
    constructor() {
        this.sounds = {};
        this.currentRingtone = null;
        this.settings = this._loadSettings();
        this._ringtoneCtx = null; this._ringtoneNodes = []; this._ringtoneInterval = null;
        this._ringbackCtx = null; this._ringbackNodes = []; this._ringbackInterval = null;
        this._customRingtones = this._loadCustomRingtones();
    }
    _loadSettings() {
        try { return JSON.parse(localStorage.getItem('sendt_sound_settings')) || { callRingtone:'whatsapp', messageSound:'whatsapp_notif', volume:0.9, enabled:true }; } catch(e) {}
        return { callRingtone:'whatsapp', messageSound:'whatsapp_notif', volume:0.9, enabled:true };
    }
    saveSettings() { try { localStorage.setItem('sendt_sound_settings', JSON.stringify(this.settings)); } catch(e) {} }
    _loadCustomRingtones() {
        try { return JSON.parse(localStorage.getItem('sendt_custom_ringtones')) || {}; } catch(e) { return {}; }
    }
    saveCustomRingtone(type, dataUrl) {
        this._customRingtones[type] = dataUrl;
        try { localStorage.setItem('sendt_custom_ringtones', JSON.stringify(this._customRingtones)); } catch(e) {}
    }
    _stopCtx(prefix) {
        const intKey = `_${prefix}Interval`, nodesKey = `_${prefix}Nodes`, ctxKey = `_${prefix}Ctx`;
        if (this[intKey]) { clearInterval(this[intKey]); this[intKey] = null; }
        if (this[nodesKey]) { this[nodesKey].forEach(n => { try { n.stop(); } catch(e) {} }); this[nodesKey] = []; }
        if (this[ctxKey] && this[ctxKey].state !== 'closed') { try { this[ctxKey].close(); } catch(e) {} }
        this[ctxKey] = null;
    }
    playCallRingtone() {
        if (!this.settings.enabled) return;
        this.stopCallRingtone();
        const sel = CONFIG.RINGTONES.call_incoming.options.find(o => o.id === (this.settings.callRingtone || 'whatsapp'));
        if (!sel) return;
        if (sel.isCustom && this._customRingtones.call) {
            const a = new Audio(this._customRingtones.call); a.loop = true; a.volume = this.settings.volume || 0.9;
            a.play().catch(() => {}); this.currentRingtone = a; return;
        }
        // Support fichiers MP3 (Baba Maal, Tajabone, etc.)
        if (sel.file) {
            const a = new Audio(sel.file); a.loop = true; a.volume = this.settings.volume || 0.9;
            a.play().catch((e) => { console.warn('🔔 Impossible de lire la sonnerie MP3:', e.message); });
            this.currentRingtone = a; return;
        }
        if (sel.synth) this._playSyntheticPattern(sel.synth, 'ringtone');
    }
    stopCallRingtone() {
        if (this.currentRingtone) { this.currentRingtone.pause(); this.currentRingtone.currentTime = 0; this.currentRingtone = null; }
        this._stopCtx('ringtone');
    }
    playRingback() {
        if (!this.settings.enabled) return;
        this._playSyntheticPattern(CONFIG.RINGTONES.call_outgoing.synth, 'ringback');
    }
    stopRingback() { this._stopCtx('ringback'); }
    _playSyntheticPattern(synthConfig, prefix = 'ringtone') {
        this._stopCtx(prefix);
        if (!synthConfig) return;
        const intKey = `_${prefix}Interval`, nodesKey = `_${prefix}Nodes`, ctxKey = `_${prefix}Ctx`;
        try {
            const ctx = new (window.AudioContext || window.webkitAudioContext)();
            this[ctxKey] = ctx;
            const comp = ctx.createDynamicsCompressor();
            comp.threshold.value = -20; comp.ratio.value = 4; comp.connect(ctx.destination);
            const mg = ctx.createGain();
            mg.gain.value = (synthConfig.volume || 0.5) * (this.settings.volume || 0.9);
            mg.connect(comp);
            const self = this;
            const { freqs, pattern, type } = synthConfig;
            const play = () => {
                if (!self[ctxKey] || self[ctxKey] !== ctx || ctx.state === 'closed') {
                    if (self[intKey]) { clearInterval(self[intKey]); self[intKey] = null; } return;
                }
                let t = 0;
                for (let i = 0; i < pattern.length; i++) {
                    const dur = pattern[i] / 1000;
                    if (i % 2 === 0) {
                        const freq = freqs[Math.floor(i/2) % freqs.length];
                        const start = ctx.currentTime + t;
                        try {
                            const osc = ctx.createOscillator();
                            const g = ctx.createGain();
                            osc.type = ['classic','soft','bell','ringback'].includes(type) ? 'sine'
                                : ['modern','marimba','whatsapp','teranga','xylophone','babamaal','tajabone'].includes(type) ? 'triangle'
                                : ['digital','urgence'].includes(type) ? 'square'
                                : ['pulse','alarm','senegal'].includes(type) ? 'sawtooth' : 'sine';
                            g.gain.value = type === 'ringback' ? 0.25 : 0.6;
                            osc.frequency.value = freq;
                            osc.connect(g); g.connect(mg);
                            g.gain.setValueAtTime(0, start);
                            g.gain.linearRampToValueAtTime(g.gain.value, start + 0.015);
                            g.gain.setValueAtTime(g.gain.value, start + dur - 0.05);
                            g.gain.linearRampToValueAtTime(0, start + dur);
                            osc.start(start); osc.stop(start + dur);
                            self[nodesKey].push(osc);
                        } catch(e) {}
                    }
                    t += dur;
                }
            };
            const total = pattern.reduce((a,b) => a+b, 0);
            play();
            this[intKey] = setInterval(play, total);
        } catch(e) { console.error('SoundManager synth error:', e); }
    }
    playMessageSound() {
        if (!this.settings.enabled) return;
        const sel = CONFIG.RINGTONES.message.options.find(o => o.id === (this.settings.messageSound || 'whatsapp_notif'));
        if (!sel) return;
        if (sel.isCustom && this._customRingtones.message) {
            const a = new Audio(this._customRingtones.message); a.volume = this.settings.volume || 0.9; a.play().catch(() => {}); return;
        }
        if (sel.synth) this._playNotifSynth(sel.synth);
    }
    _playNotifSynth(sc) {
        try {
            const ctx = new (window.AudioContext || window.webkitAudioContext)();
            const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -15; comp.ratio.value = 4; comp.connect(ctx.destination);
            const g = ctx.createGain(); g.gain.value = (sc.volume || 0.5) * (this.settings.volume || 0.9); g.connect(comp);
            const dur = (sc.duration || 150) / 1000;
            const freqs = sc.freqs || [sc.freq || 880];
            freqs.forEach((f, i) => {
                const osc = ctx.createOscillator(); osc.type = 'triangle'; osc.frequency.value = f;
                const ng = ctx.createGain();
                ng.gain.setValueAtTime(g.gain.value * 0.7, ctx.currentTime + i * 0.1);
                ng.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i * 0.1 + dur * 2);
                osc.connect(ng); ng.connect(comp);
                osc.start(ctx.currentTime + i * 0.1); osc.stop(ctx.currentTime + i * 0.1 + dur * 2);
            });
            setTimeout(() => { try { ctx.close(); } catch(e) {} }, 3000);
        } catch(e) {}
    }
    playCallEnd() {
        if (!this.settings.enabled) return;
        try {
            const ctx = new (window.AudioContext || window.webkitAudioContext)();
            const g = ctx.createGain(); g.gain.value = 0.5 * (this.settings.volume || 0.9); g.connect(ctx.destination);
            [440, 349].forEach((f, i) => {
                const osc = ctx.createOscillator(); osc.type = 'sine'; osc.frequency.value = f;
                osc.connect(g); osc.start(ctx.currentTime + i * 0.25); osc.stop(ctx.currentTime + i * 0.25 + 0.2);
            });
            setTimeout(() => { try { ctx.close(); } catch(e) {} }, 1500);
        } catch(e) {}
    }
    setVolume(v) { this.settings.volume = Math.max(0, Math.min(1, v)); this.saveSettings(); }
    setCallRingtone(id) { this.settings.callRingtone = id; this.saveSettings(); }
    setMessageSound(id) { this.settings.messageSound = id; this.saveSettings(); }
    setEnabled(en) { this.settings.enabled = en; if (!en) this.stopCallRingtone(); this.saveSettings(); }
    previewSound(type, id) {
        this._stopCtx('ringtone'); this._stopCtx('ringback');
        const opts = type === 'call' ? CONFIG.RINGTONES.call_incoming.options : CONFIG.RINGTONES.message.options;
        const sel = opts.find(o => o.id === id); if (!sel) return;
        if (sel.synth) { if (type === 'call') this._playSyntheticPattern(sel.synth, 'ringtone'); else this._playNotifSynth(sel.synth); }
        setTimeout(() => { this._stopCtx('ringtone'); this._stopCtx('ringback'); }, 3000);
    }
}
const soundManager = new SoundManager();
// ============================================================================
// CALL HISTORY
// ============================================================================
class CallHistoryManager {
    constructor() { this.history = this._load(); }
    _key() { try { const uid = typeof matrixManager !== 'undefined' && matrixManager.userId; return uid ? `sendt_call_history_${uid}` : 'sendt_call_history'; } catch(e) { return 'sendt_call_history'; } }
    _load() { try { return JSON.parse(localStorage.getItem(this._key())) || []; } catch(e) { return []; } }
    _save() { if (this.history.length > CONFIG.CALL_HISTORY_MAX) this.history = this.history.slice(0, CONFIG.CALL_HISTORY_MAX); try { localStorage.setItem(this._key(), JSON.stringify(this.history)); } catch(e) {} }
    addEntry(entry) {
        this.history = this._load();
        this.history.unshift({ id: Date.now() + '_' + Math.random().toString(36).substr(2,6), ...entry, timestamp: entry.timestamp || Date.now() });
        this._save(); window.dispatchEvent(new CustomEvent('call-history-updated'));
    }
    getHistory() { return this._load(); }
    clearHistory() { this.history = []; this._save(); }
}
const callHistoryManager = new CallHistoryManager();
// ============================================================================
// CLIPBOARD
// ============================================================================
async function copyToClipboard(text) {
    try { await navigator.clipboard.writeText(text); showToast('Copié !', 'success'); }
    catch(e) {
        const ta = document.createElement('textarea'); ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
        document.body.appendChild(ta); ta.select();
        try { document.execCommand('copy'); showToast('Copié !', 'success'); } catch(e2) { showToast('Erreur copie', 'error'); }
        document.body.removeChild(ta);
    }
}
// ============================================================================
// NOTIFICATIONS MANAGER (New for v14.0)
 // ============================================================================
class NotificationsManager {
    constructor() { this.notifications = this._load(); }
    _load() { try { return JSON.parse(localStorage.getItem('sendt_notifications')) || []; } catch(e) { return []; } }
    _save() { if (this.notifications.length > CONFIG.NOTIFICATIONS_MAX) this.notifications = this.notifications.slice(0, CONFIG.NOTIFICATIONS_MAX); try { localStorage.setItem('sendt_notifications', JSON.stringify(this.notifications)); } catch(e) {} }
    addNotification(entry) {
        this.notifications.unshift({ id: Date.now() + '_' + Math.random().toString(36).substr(2,6), ...entry, timestamp: entry.timestamp || Date.now() });
        this._save(); window.dispatchEvent(new CustomEvent('notifications-updated'));
    }
    getNotifications() { return this.notifications; }
    clearNotifications() { this.notifications = []; this._save(); }
}
const notificationsManager = new NotificationsManager();
// ============================================================================
// EPHEMERAL MENU (New for v14.0)
 // ============================================================================
function toggleEphemeralMenu() {
    const menu = document.getElementById('ephemeral-menu');
    if (menu.classList.contains('show')) {
        menu.classList.remove('show');
    } else {
        menu.innerHTML = CONFIG.EPHEMERAL_DURATIONS.map(d => `<button class="ephemeral-item" data-duration="${d.seconds}">${d.label}</button>`).join('');
        menu.classList.add('show');
    }
}

