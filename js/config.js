// Configuration SENDT v15.2 (E2EE activé)
const CONFIG = {
    APP_NAME: 'SENDT',
    APP_VERSION: '1.0',
    DEFAULT_HOMESERVER: 'https://jn.rtn.sn',
    DEFAULT_DOMAIN: 'jn.rtn.sn',
    SIMPLE_LOGIN: true,
    ICE_SERVERS: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
    ],
    FILE_MAX_SIZE: 100 * 1024 * 1024,
    IMAGE_MAX_SIZE: 20 * 1024 * 1024,
    VIDEO_MAX_SIZE: 100 * 1024 * 1024,
    ALLOWED_IMAGE_TYPES: ['image/jpeg','image/png','image/gif','image/webp','image/svg+xml'],
    ALLOWED_VIDEO_TYPES: ['video/mp4','video/webm','video/ogg','video/quicktime'],
    ALLOWED_FILE_TYPES: '*',
    STATUS_EVENT_TYPE: 'io.sendt.status',
    STATUS_EXPIRY_HOURS: 24,
    EPHEMERAL_ENABLED: true,
    EPHEMERAL_DURATIONS: [
        { id:'off', label:'Désactivé', seconds:0 },
        { id:'30s', label:'30 secondes', seconds:30 },
        { id:'5m', label:'5 minutes', seconds:300 },
        { id:'1h', label:'1 heure', seconds:3600 },
        { id:'24h', label:'24 heures', seconds:86400 },
        { id:'7d', label:'7 jours', seconds:604800 }
    ],
    LOCATION_SHARING: {
        enabled: true,
        liveUpdateInterval: 10000,
        liveDurations: [
            { id:'15m', label:'15 minutes', seconds:900 },
            { id:'1h', label:'1 heure', seconds:3600 },
            { id:'8h', label:'8 heures', seconds:28800 }
        ],
        mapTileUrl: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
        defaultZoom: 15
    },
    // ── Chiffrement de bout en bout ──────────────────────────────────────────
    E2EE: {
        enabled: true,                   // Activer l'initialisation crypto au login
        autoEncryptDMs: true,            // Chiffrer automatiquement les nouveaux DMs
        olmCryptoStoreName: 'sendt:crypto', // Nom du store IndexedDB Olm
    },
    GROUP_CALL: { enabled:true, maxParticipants:8, conferenceType:'mesh' },
    SHARED_NOTES: { enabled:true, maxLength:10000, eventType:'io.sendt.shared_note' },
    RINGTONES: {
        call_incoming: {
            default: 'sounds/ringtone-call.mp3',
            options: [
                { id:'classic', name:'Classique', synth:{ type:'classic', freqs:[440,523], pattern:[400,100,400,1100], volume:0.7 } },
                { id:'modern', name:'Moderne', synth:{ type:'modern', freqs:[587,784,880], pattern:[200,50,200,50,200,1300], volume:0.7 } },
                { id:'soft', name:'Doux', synth:{ type:'soft', freqs:[392,440], pattern:[600,200,600,1600], volume:0.5 } },
                { id:'digital', name:'Digital', synth:{ type:'digital', freqs:[698,880,1047,880], pattern:[150,50,150,50,150,50,150,1250], volume:0.8 } },
                { id:'whatsapp', name:'WhatsApp', synth:{ type:'whatsapp', freqs:[659,784,880,1047,880,784], pattern:[120,60,120,60,120,60,120,60,120,60,120,900], volume:0.8 } },
                { id:'senegal', name:'🇸🇳 Sénégal', synth:{ type:'senegal', freqs:[523,587,659,784,880,784,659], pattern:[150,50,150,50,200,50,150,50,200,50,150,50,200,1200], volume:0.8 } },
                { id:'teranga', name:'🇸🇳 Téranga', synth:{ type:'teranga', freqs:[440,554,659,880,659,554], pattern:[180,60,180,60,180,60,300,60,180,60,180,1220], volume:0.8 } },
                { id:'babamaal_wakanda_mp3', name:'🇸🇳 Baba Maal – Wakanda (original)', file:'sounds/ringtone-babamaal-wakanda.mp3', synth:null },
                { id:'tajabone_ismael_lo_mp3', name:'🇸🇳 Tajabone – Ismaël Lô (original)', file:'sounds/ringtone-tajabone-ismael-lo.mp3', synth:null },
                { id:'alarm', name:'Alarme', synth:{ type:'alarm', freqs:[880,1100,880,1100], pattern:[200,50,200,50,200,50,200,800], volume:0.9 } },
                { id:'bell', name:'Cloche', synth:{ type:'bell', freqs:[1047,1319,1568], pattern:[300,150,300,150,300,1800], volume:0.8 } },
                { id:'custom', name:'🎵 Ma sonnerie', synth:null, isCustom:true },
                { id:'none', name:'Aucune', synth:null }
            ]
        },
        call_outgoing: { default:'sounds/ringback.mp3', synth:{ type:'ringback', freqs:[440,480], pattern:[2000,4000], volume:0.3 } },
        message: {
            default: 'sounds/notification.mp3',
            options: [
                { id:'pop', name:'Pop', synth:{ type:'pop', freq:880, duration:150, volume:0.6 } },
                { id:'ding', name:'Ding', synth:{ type:'ding', freq:1200, duration:200, volume:0.7 } },
                { id:'whatsapp_notif', name:'WhatsApp', synth:{ type:'whatsapp_notif', freqs:[880,1047,1319], duration:120, volume:0.8 } },
                { id:'chime', name:'Carillon', synth:{ type:'chime', freqs:[523,659,784], duration:150, volume:0.7 } },
                { id:'bubble', name:'Bulle', synth:{ type:'bubble', freqs:[600,800,1000], duration:100, volume:0.6 } },
                { id:'custom', name:'🎵 Mon son', synth:null, isCustom:true },
                { id:'none', name:'Aucun', synth:null }
            ]
        },
        call_end: { default:'sounds/call-end.mp3', synth:{ type:'end', freqs:[440,349], duration:200, volume:0.5 } }
    },
    MESSAGE_MAX_LENGTH: 10000,
    CALL_HISTORY_MAX: 200,
    CALL_UPGRADE_ENABLED: true,
    CONTACTS_REFRESH_INTERVAL: 5000,
    TYPING_TIMEOUT: 5000,
    TYPING_SEND_INTERVAL: 3000,
    READ_RECEIPTS_ENABLED: true,
    GROUP_ROOM: { maxMembers:256 },
    EMOJI_CATEGORIES: [
        { id:'recent', icon:'🕐', name:'Récents', emojis:[] },
        { id:'smileys', icon:'😀', name:'Smileys', emojis:['😀','😃','😄','😁','😆','😅','🤣','😂','🙂','🙃','😉','😊','😇','🥰','😍','🤩','😘','😗','☺️','😚','😙','😋','😛','😜','🤪','😝','🤑','🤗','🤭','🤫','🤔','🤐','🤨','😐','😑','😶','😏','😒','🙄','😬','🤥','😌','😔','😪','🤤','😴','😷','🤒','🤕','🤢','🤮','🥵','🥶','🥴','😵','🤯','🤠','🥳','😎','🤓','🧐','😕','😟','🙁','☹️','😮','😯','😲','😳','🥺','😦','😧','😨','😰','😥','😢','😭','😱','😖','😣','😞','😓','😩','😫','🥱','😤','😡','😠','🤬','😈','👿','💀','💩','🤡','👻','👽','🤖'] },
        { id:'gestures', icon:'👋', name:'Gestes', emojis:['👋','🤚','🖐️','✋','🖖','👌','🤌','🤏','✌️','🤞','🤟','🤘','🤙','👈','👉','👆','👇','☝️','👍','👎','✊','👊','🤛','🤜','👏','🙌','🫶','👐','🤲','🤝','🙏','✍️','💅','🤳','💪'] },
        { id:'hearts', icon:'❤️', name:'Cœurs', emojis:['❤️','🧡','💛','💚','💙','💜','🖤','🤍','🤎','❤️‍🔥','❤️‍🩹','💔','❣️','💕','💞','💓','💗','💖','💘','💝','💟'] },
        { id:'nature', icon:'🐾', name:'Nature', emojis:['🐶','🐱','🐭','🐹','🐰','🦊','🐻','🐼','🐨','🐯','🦁','🐮','🐷','🐸','🐵','🐔','🐧','🐦','🦆','🦅','🦉','🦋','🌵','🌲','🌳','🌴','🌱','🌿','🍀','🌷','🌹','🌺','🌸','🌼','🌻','🌞','🌙','⭐','✨','⚡','🔥','🌈','☀️','🌧️','❄️','💧'] },
        { id:'food', icon:'🍔', name:'Nourriture', emojis:['🍏','🍎','🍊','🍋','🍌','🍉','🍇','🍓','🍒','🍑','🥭','🍍','🍅','🍆','🥑','🥕','🍞','🧀','🍳','🥩','🍗','🌭','🍔','🍟','🍕','🌮','🍝','🍜','🍲','🍣','🍱','🍦','🍰','🎂','🍩','🍪','☕','🍵','🥤','🍺','🍷'] },
        { id:'travel', icon:'🚗', name:'Voyage', emojis:['🚗','🚕','🚙','🚌','🏎️','🚓','🚑','🛵','🚲','✈️','🚀','🚁','⛵','🏠','🏢','🏥','🏰','🗼','🗽','🏖️','🏝️','⛰️','🏔️','🌅','🌇','🏙️','📍','🗺️'] },
        { id:'flags', icon:'🏳️', name:'Drapeaux', emojis:['🇸🇳','🇫🇷','🇺🇸','🇬🇧','🇩🇪','🇪🇸','🇮🇹','🇧🇷','🇯🇵','🇨🇳','🇮🇳','🇷🇺','🇨🇦','🇦🇺','🇲🇽','🇿🇦','🇳🇬','🇪🇬','🇲🇦','🇨🇮','🇲🇱','🇬🇳','🇬🇲','🇧🇫','🇹🇬','🇧🇯','🇳🇪','🇬🇭','🇨🇲'] }
    ],
    RECENT_EMOJI_MAX: 30,
    WAVEFORM_BARS: 35,
    WAVEFORM_MIN_HEIGHT: 3,
    WAVEFORM_MAX_HEIGHT: 22,
    SENEGAL_THEME: { green:'#00853F', yellow:'#FDEF42', red:'#E31B23' },
    PUBLIC_ROOMS_LIMIT: 50,
    NOTIFICATIONS_MAX: 50,
    LIVEKIT: {
        URL: 'wss://livekit.ec2lt.sn',
        TOKEN_ENDPOINT: 'https://telephone.rtn.sn/api/connection-details',
        RECORD_ENDPOINT: 'https://telephone.rtn.sn/api/record',
        MAX_PARTICIPANTS: 50,
        ENABLE_KRISP: true
    }
};
