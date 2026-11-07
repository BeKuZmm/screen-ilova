// DOM ELEMENTLAR
const serverUrlBox = document.getElementById('serverUrlBox');
const qrCodeImg = document.getElementById('qrCodeImg');
const connectionStatus = document.getElementById('connectionStatus');
const statusText = document.getElementById('statusText');
const deviceTypeSelect = document.getElementById('deviceTypeSelect');
const roomIdInput = document.getElementById('roomIdInput');
const generatePinBtn = document.getElementById('generatePinBtn');
const joinRoomBtn = document.getElementById('joinRoomBtn');
const deviceList = document.getElementById('deviceList');
const deviceCount = document.getElementById('deviceCount');

const startShareBtn = document.getElementById('startShareBtn');
const stopShareBtn = document.getElementById('stopShareBtn');
const sessionTimerBadge = document.getElementById('sessionTimerBadge');
const timerDisplay = document.getElementById('timerDisplay');
const fullscreenBtn = document.getElementById('fullscreenBtn');
const remoteVideo = document.getElementById('remoteVideo');
const emptyVideoState = document.getElementById('emptyVideoState');
const appWatermark = document.getElementById('appWatermark');

// PRO MODAL
const proModal = document.getElementById('proModal');
const openProModalBtn = document.getElementById('openProModalBtn');
const closeProModalBtn = document.getElementById('closeProModalBtn');
const proCodeInput = document.getElementById('proCodeInput');
const submitProCodeBtn = document.getElementById('submitProCodeBtn');
const proMessage = document.getElementById('proMessage');
const proBtnText = document.getElementById('proBtnText');

// HOLATLAR (STATE)
let socket;
let localStream = null;
let peerConnections = {}; // targetId -> RTCPeerConnection
let currentRoomId = null;
let isStreaming = false;
let isProUser = localStorage.getItem('screen_share_pro') === 'true';

// LIMITLAR
const FREE_TIME_LIMIT_SEC = 10 * 60; // 10 daqiqa
let remainingSeconds = FREE_TIME_LIMIT_SEC;
let timerInterval = null;

function getDeviceName() {
    const ua = navigator.userAgent;
    if (/android/i.test(ua)) return 'Android Telefon';
    if (/iPad|iPhone|iPod/.test(ua)) return 'iOS Qurilma';
    if (/smart-tv|googletv|appletv|tizen/i.test(ua)) return 'Smart TV';
    return 'Kompyuter (PC)';
}

if (/android|iphone|ipad/i.test(navigator.userAgent)) {
    deviceTypeSelect.value = 'phone';
} else if (/smart-tv|tizen|googletv/i.test(navigator.userAgent)) {
    deviceTypeSelect.value = 'tv';
} else {
    deviceTypeSelect.value = 'pc';
}

// 1. TIZIM MA'LUMOTLARINI OLISH
async function loadServerInfo() {
    try {
        const res = await fetch('/api/info');
        const data = await res.json();
        serverUrlBox.textContent = data.url;
        qrCodeImg.src = data.qrCode;
    } catch (e) {
        serverUrlBox.textContent = window.location.origin;
    }
}
loadServerInfo();

// 2. SOCKET.IO GA ULANISH
socket = io();

socket.on('connect', () => {
    connectionStatus.querySelector('.status-dot').classList.add('connected');
    statusText.textContent = "Bog'landi";
});

socket.on('disconnect', () => {
    connectionStatus.querySelector('.status-dot').classList.remove('connected');
    statusText.textContent = "Uzildi";
});

// XONADAGI QURILMALAR
socket.on('room-users', ({ devices, streamerId }) => {
    deviceCount.textContent = devices.length;
    deviceList.innerHTML = '';

    devices.forEach(dev => {
        const li = document.createElement('li');
        li.className = 'device-item';
        
        let icon = 'fa-laptop';
        if (dev.type === 'phone') icon = 'fa-mobile-screen';
        if (dev.type === 'tv') icon = 'fa-tv';

        li.innerHTML = `
            <div class="device-item-left">
                <i class="fa-solid ${icon}"></i>
                <span>${dev.name} ${dev.id === socket.id ? '(Siz)' : ''}</span>
            </div>
            <div>
                ${dev.isPro ? '<span class="device-badge-pro">PRO</span>' : ''}
                ${dev.id === streamerId ? '<span style="color:#22c55e;font-size:0.75rem;"><i class="fa-solid fa-signal-stream"></i> Efirda</span>' : ''}
            </div>
        `;
        deviceList.appendChild(li);
    });
});

socket.on('streamer-changed', ({ streamerId, streamerName }) => {
    if (!streamerId) {
        remoteVideo.srcObject = null;
        emptyVideoState.style.display = 'flex';
        resetTimer();
    } else if (streamerId !== socket.id) {
        emptyVideoState.style.display = 'none';
    }
});

// 3. XONAGA QO'SHILISH
joinRoomBtn.addEventListener('click', () => {
    const roomId = roomIdInput.value.trim();
    if (!roomId) return alert("Xona PIN kodini kiriting!");

    currentRoomId = roomId;
    const deviceType = deviceTypeSelect.value;
    const deviceName = getDeviceName();

    socket.emit('join-room', {
        roomId: currentRoomId,
        deviceName: deviceName,
        deviceType: deviceType,
        isPro: isProUser
    });

    joinRoomBtn.disabled = true;
    joinRoomBtn.innerHTML = '<i class="fa-solid fa-check"></i> Xonadasiz';
    startShareBtn.disabled = false;
});

generatePinBtn.addEventListener('click', () => {
    const pin = Math.floor(100000 + Math.random() * 900000);
    roomIdInput.value = pin;
});

// 4. EKRANNI UZATISH (STREAMING)
startShareBtn.addEventListener('click', async () => {
    try {
        let stream = null;

        if (window.electronAPI && window.electronAPI.getScreenSources) {
            try {
                const sources = await window.electronAPI.getScreenSources();
                if (sources && sources.length > 0) {
                    stream = await navigator.mediaDevices.getUserMedia({
                        audio: false,
                        video: {
                            mandatory: {
                                chromeMediaSource: 'desktop',
                                chromeMediaSourceId: sources[0].id,
                                minWidth: isProUser ? 1920 : 1280,
                                maxWidth: isProUser ? 1920 : 1280,
                                minHeight: isProUser ? 1080 : 720,
                                maxHeight: isProUser ? 1080 : 720,
                                minFrameRate: isProUser ? 60 : 30,
                                maxFrameRate: isProUser ? 60 : 30
                            }
                        }
                    });
                }
            } catch (e) {
                console.warn("Electron native xatosi:", e);
            }
        }

        if (!stream) {
            if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
                throw new Error("Telefonda brauzer orqali ekranni uzatish cheklangan. Kompyuter ekranini telefonda tomosha qilishingiz mumkin!");
            }
            stream = await navigator.mediaDevices.getDisplayMedia({
                video: { frameRate: isProUser ? 60 : 30 },
                audio: false
            });
        }

        localStream = stream;
        remoteVideo.srcObject = localStream;
        remoteVideo.play().catch(e => console.log(e));
        emptyVideoState.style.display = 'none';

        isStreaming = true;
        startShareBtn.style.display = 'none';
        stopShareBtn.style.display = 'flex';

        socket.emit('start-streaming');
        startSessionTimer();

        localStream.getVideoTracks()[0].onended = () => {
            stopSharing();
        };

    } catch (err) {
        console.error("Ekranni olishda xatolik:", err);
        alert(err.message);
    }
});

function stopSharing() {
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
        localStream = null;
    }
    isStreaming = false;
    startShareBtn.style.display = 'flex';
    stopShareBtn.style.display = 'none';
    emptyVideoState.style.display = 'flex';
    remoteVideo.srcObject = null;

    stopSessionTimer();
    socket.emit('stop-streaming');

    Object.values(peerConnections).forEach(pc => pc.close());
    peerConnections = {};
}

stopShareBtn.addEventListener('click', stopSharing);

// 5. WEBRTC ALOQASI
const rtcConfig = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
    ]
};

function createPeer(targetId) {
    if (peerConnections[targetId]) {
        peerConnections[targetId].close();
    }

    const pc = new RTCPeerConnection(rtcConfig);
    peerConnections[targetId] = pc;

    pc.onicecandidate = (event) => {
        if (event.candidate) {
            socket.emit('webrtc-ice-candidate', {
                targetId: targetId,
                candidate: event.candidate
            });
        }
    };

    pc.ontrack = (event) => {
        console.log("Video oqimi qabul qilindi!", event.streams[0]);
        remoteVideo.srcObject = event.streams[0];
        remoteVideo.play().catch(err => {
            console.log("Autoplay kutmoqda:", err);
        });
        emptyVideoState.style.display = 'none';
    };

    if (localStream) {
        localStream.getTracks().forEach(track => pc.addTrack(track, localStream));
    }

    return pc;
}

async function sendOfferToPeer(targetId) {
    if (!localStream) return;
    const pc = createPeer(targetId);
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    socket.emit('webrtc-offer', { targetId: targetId, offer: offer });
}

socket.on('connect-to-peer', ({ targetId }) => {
    if (isStreaming) {
        sendOfferToPeer(targetId);
    }
});

socket.on('device-joined', ({ newDeviceId }) => {
    if (isStreaming) {
        sendOfferToPeer(newDeviceId);
    }
});

socket.on('webrtc-offer', async ({ senderId, offer }) => {
    const pc = createPeer(senderId);
    await pc.setRemoteDescription(new RTCSessionDescription(offer));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    socket.emit('webrtc-answer', { targetId: senderId, answer: answer });
});

socket.on('webrtc-answer', async ({ senderId, answer }) => {
    const pc = peerConnections[senderId];
    if (pc) {
        await pc.setRemoteDescription(new RTCSessionDescription(answer));
    }
});

socket.on('webrtc-ice-candidate', async ({ senderId, candidate }) => {
    const pc = peerConnections[senderId];
    if (pc) {
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
    }
});

// 6. TAYMER VA LIMITLAR
function startSessionTimer() {
    stopSessionTimer();
    if (isProUser) {
        timerDisplay.textContent = "Cheksiz (PRO)";
        sessionTimerBadge.classList.add('pro-unlimited');
        appWatermark.classList.add('hidden');
        return;
    }

    remainingSeconds = FREE_TIME_LIMIT_SEC;
    appWatermark.classList.remove('hidden');

    timerInterval = setInterval(() => {
        remainingSeconds--;
        const m = Math.floor(remainingSeconds / 60);
        const s = remainingSeconds % 60;
        timerDisplay.textContent = `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')} (Free)`;

        if (remainingSeconds <= 0) {
            stopSessionTimer();
            stopSharing();
            alert("⏰ Bepul seans vaqti (10 daqiqa) tugadi! Cheksiz ishlatish uchun PRO kodni kiriting.");
            openProModal();
        }
    }, 1000);
}

function stopSessionTimer() {
    if (timerInterval) {
        clearInterval(timerInterval);
        timerInterval = null;
    }
}

function resetTimer() {
    stopSessionTimer();
    if (isProUser) {
        timerDisplay.textContent = "Cheksiz (PRO)";
    } else {
        timerDisplay.textContent = "10:00 (Free)";
    }
}

// 7. PRO KOD
function checkProStatusUI() {
    if (isProUser) {
        proBtnText.textContent = "PRO Faol";
        openProModalBtn.classList.add('is-activated');
        sessionTimerBadge.classList.add('pro-unlimited');
        timerDisplay.textContent = "Cheksiz (PRO)";
        appWatermark.classList.add('hidden');
    }
}
checkProStatusUI();

function openProModal() {
    proModal.classList.add('active');
    proMessage.textContent = '';
}

openProModalBtn.addEventListener('click', openProModal);
closeProModalBtn.addEventListener('click', () => proModal.classList.remove('active'));

submitProCodeBtn.addEventListener('click', () => {
    const code = proCodeInput.value.trim();
    if (!code) return;

    socket.emit('verify-pro-code', code, (res) => {
        if (res.success) {
            isProUser = true;
            localStorage.setItem('screen_share_pro', 'true');
            proMessage.className = 'modal-message success';
            proMessage.textContent = res.message;
            checkProStatusUI();
            setTimeout(() => {
                proModal.classList.remove('active');
            }, 1200);
        } else {
            proMessage.className = 'modal-message error';
            proMessage.textContent = res.message;
        }
    });
});

// FULLSCREEN
fullscreenBtn.addEventListener('click', () => {
    if (!document.fullscreenElement) {
        remoteVideo.requestFullscreen().catch(err => alert(err.message));
    } else {
        document.exitFullscreen();
    }
});
