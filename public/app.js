// DOM ELEMENTLAR
const tabReceiver = document.getElementById('tabReceiver');
const tabSender = document.getElementById('tabSender');
const sectionReceiver = document.getElementById('sectionReceiver');
const sectionSender = document.getElementById('sectionSender');

const ipDisplay = document.getElementById('ipDisplay');
const pcQrCodeImg = document.getElementById('pcQrCodeImg');
const pcPinDisplay = document.getElementById('pcPinDisplay');

const qrWaitingPanel = document.getElementById('qrWaitingPanel');
const liveStreamPanel = document.getElementById('liveStreamPanel');
const connectedDeviceName = document.getElementById('connectedDeviceName');
const fpsBadge = document.getElementById('fpsBadge');
const screenCanvas = document.getElementById('screenCanvas');
const canvasCtx = screenCanvas ? screenCanvas.getContext('2d') : null;

const btnToggleFull = document.getElementById('btnToggleFull');
const btnRotateStream = document.getElementById('btnRotateStream');
const btnDisconnectStream = document.getElementById('btnDisconnectStream');

// SENDER ELEMENTLAR
const targetPinInput = document.getElementById('targetPinInput');
const btnStartPcShare = document.getElementById('btnStartPcShare');
const btnStopPcShare = document.getElementById('btnStopPcShare');
const senderCastStatus = document.getElementById('senderCastStatus');

// STATE
const socket = io();
let currentRoomPin = "777888";
let currentRotation = 0; // 0, 90, 180, 270
let isCapturingDesktop = false;
let localScreenStream = null;
let senderInterval = null;

// FPS HISOBLASH
let frameCount = 0;
let lastFpsTime = performance.now();

// KADRNI CHIZISH
const streamImg = new Image();
streamImg.onload = () => {
    if (!screenCanvas || !canvasCtx) return;

    if (currentRotation === 90 || currentRotation === 270) {
        screenCanvas.width = streamImg.height;
        screenCanvas.height = streamImg.width;
    } else {
        screenCanvas.width = streamImg.width;
        screenCanvas.height = streamImg.height;
    }

    canvasCtx.save();
    if (currentRotation !== 0) {
        canvasCtx.translate(screenCanvas.width / 2, screenCanvas.height / 2);
        canvasCtx.rotate((currentRotation * Math.PI) / 180);
        canvasCtx.drawImage(streamImg, -streamImg.width / 2, -streamImg.height / 2);
    } else {
        canvasCtx.drawImage(streamImg, 0, 0);
    }
    canvasCtx.restore();

    // FPS hisoblash
    frameCount++;
    const now = performance.now();
    if (now - lastFpsTime >= 1000) {
        if (fpsBadge) fpsBadge.textContent = `${frameCount} FPS`;
        frameCount = 0;
        lastFpsTime = now;
    }
};

let activeBlobUrl = null;

function renderIncomingFrame(data) {
    if (isCapturingDesktop) return; // Kompyuter o'zini o'zi chizmasligi uchun

    // 1. Kutish panelini yopib, jonli efir oynasini ko'rsatish
    if (qrWaitingPanel && qrWaitingPanel.style.display !== 'none') {
        qrWaitingPanel.style.display = 'none';
        liveStreamPanel.style.display = 'flex';
        switchTab('receiver');
    }

    // 2. Kadrni yuklash (Base64 yoki ArrayBuffer)
    if (typeof data === 'string') {
        streamImg.src = data.startsWith('data:') ? data : `data:image/jpeg;base64,${data}`;
    } else {
        if (activeBlobUrl) URL.revokeObjectURL(activeBlobUrl);
        const blob = new Blob([data], { type: 'image/jpeg' });
        activeBlobUrl = URL.createObjectURL(blob);
        streamImg.src = activeBlobUrl;
    }
}

// SERVER HODISALARI
socket.on('incoming-screen-frame', renderIncomingFrame);
socket.on('mobile-frame', renderIncomingFrame);

// SENDER ULANDI - DARHOL JONLI OYNANI OCHISH
socket.on('sender-connected', ({ deviceName }) => {
    console.log("Telefon ulandi:", deviceName);
    if (connectedDeviceName) {
        connectedDeviceName.textContent = deviceName || "Android Telefon";
    }
    // Kutish oynasini darhol yopish
    if (qrWaitingPanel) qrWaitingPanel.style.display = 'none';
    if (liveStreamPanel) liveStreamPanel.style.display = 'flex';
    switchTab('receiver');
});

// EFIR UZILGANDA
function onStreamDisconnected() {
    if (liveStreamPanel) liveStreamPanel.style.display = 'none';
    if (qrWaitingPanel) qrWaitingPanel.style.display = 'block';
    if (canvasCtx && screenCanvas) {
        canvasCtx.clearRect(0, 0, screenCanvas.width, screenCanvas.height);
    }
}

socket.on('sender-disconnected', onStreamDisconnected);
socket.on('stream-stopped', onStreamDisconnected);
socket.on('room-closed', onStreamDisconnected);

// SOCKET BOG'LANGANDA HAR SAFAR XONAGA QAYTA QO'SHILISH
socket.on('connect', () => {
    console.log("Socket serverga ulandi:", socket.id);
    socket.emit('join-as-receiver', { pin: currentRoomPin });
    socket.emit('join-room', { roomId: currentRoomPin });
});

// TIZIM MA'LUMOTLARINI OLISH
async function loadServerInfo() {
    try {
        const res = await fetch('/api/server-info');
        const data = await res.json();
        if (data) {
            if (ipDisplay) ipDisplay.textContent = `${data.ip}:${data.port}`;
            if (pcPinDisplay) pcPinDisplay.textContent = (data.pin || "777888").split('').join(' ');
            if (pcQrCodeImg && data.qrCode) pcQrCodeImg.src = data.qrCode;
            currentRoomPin = data.pin || "777888";

            socket.emit('join-as-receiver', { pin: currentRoomPin });
            socket.emit('join-room', { roomId: currentRoomPin });
        }
    } catch (err) {
        console.error("Server ma'lumotlarini olishda xatolik:", err);
    }
}
loadServerInfo();

// TABLARNI ALMASHTIRISH
function switchTab(view) {
    if (view === 'receiver') {
        tabReceiver.classList.add('active');
        tabSender.classList.remove('active');
        sectionReceiver.style.display = 'flex';
        sectionSender.style.display = 'none';
    } else {
        tabSender.classList.add('active');
        tabReceiver.classList.remove('active');
        sectionSender.style.display = 'flex';
        sectionReceiver.style.display = 'none';
    }
}

tabReceiver.addEventListener('click', () => switchTab('receiver'));
tabSender.addEventListener('click', () => switchTab('sender'));

// TO'LIQ EKRAN
btnToggleFull.addEventListener('click', () => {
    if (!document.fullscreenElement) {
        liveStreamPanel.requestFullscreen().catch(e => console.log(e));
    } else {
        document.exitFullscreen();
    }
});

// EKRANNI BURISH
btnRotateStream.addEventListener('click', () => {
    currentRotation = (currentRotation + 90) % 360;
    if (streamImg.src) {
        streamImg.onload();
    }
});

// EFIRNI UZISH
btnDisconnectStream.addEventListener('click', () => {
    socket.emit('stop-stream');
    onStreamDisconnected();
});

// KOMPYUTER EKRANINI UZATISH (Ixtiyoriy)
btnStartPcShare.addEventListener('click', async () => {
    const pin = (targetPinInput ? targetPinInput.value.trim() : '') || currentRoomPin;

    try {
        let stream = null;
        if (window.electronAPI && window.electronAPI.getScreenSources) {
            const sources = await window.electronAPI.getScreenSources();
            if (sources && sources.length > 0) {
                stream = await navigator.mediaDevices.getUserMedia({
                    audio: false,
                    video: {
                        mandatory: {
                            chromeMediaSource: 'desktop',
                            chromeMediaSourceId: sources[0].id,
                            maxWidth: 1920,
                            maxHeight: 1080,
                            maxFrameRate: 30
                        }
                    }
                });
            }
        }

        if (!stream) {
            stream = await navigator.mediaDevices.getDisplayMedia({
                video: { frameRate: 30 },
                audio: false
            });
        }

        localScreenStream = stream;
        isCapturingDesktop = true;

        socket.emit('join-as-sender', { pin: pin, deviceName: "Kompyuter (PC)" }, () => {
            btnStartPcShare.style.display = 'none';
            btnStopPcShare.style.display = 'block';
            senderCastStatus.textContent = "🟢 Kompyuteringiz ekrani uzatilmoqda.";

            startDesktopCaptureLoop(stream);
        });

        stream.getVideoTracks()[0].onended = () => {
            stopDesktopShare();
        };

    } catch (err) {
        console.error("Ekran olishda xatolik:", err);
        senderCastStatus.textContent = "Xatolik: " + err.message;
        isCapturingDesktop = false;
    }
});

function startDesktopCaptureLoop(stream) {
    const videoElem = document.createElement('video');
    videoElem.srcObject = stream;
    videoElem.play();

    const tempCanvas = document.createElement('canvas');
    const tempCtx = tempCanvas.getContext('2d');

    senderInterval = setInterval(() => {
        if (!localScreenStream || !isCapturingDesktop) return;
        if (videoElem.videoWidth > 0 && videoElem.videoHeight > 0) {
            tempCanvas.width = 1280;
            tempCanvas.height = Math.round(1280 * (videoElem.videoHeight / videoElem.videoWidth));
            tempCtx.drawImage(videoElem, 0, 0, tempCanvas.width, tempCanvas.height);

            tempCanvas.toBlob((blob) => {
                if (blob && isCapturingDesktop) {
                    blob.arrayBuffer().then((buf) => {
                        socket.emit('screen-frame', buf);
                    });
                }
            }, 'image/jpeg', 0.65);
        }
    }, 1000 / 30);
}

function stopDesktopShare() {
    isCapturingDesktop = false;
    if (senderInterval) clearInterval(senderInterval);
    if (localScreenStream) {
        localScreenStream.getTracks().forEach(t => t.stop());
        localScreenStream = null;
    }
    btnStartPcShare.style.display = 'block';
    btnStopPcShare.style.display = 'none';
    senderCastStatus.textContent = '';
    socket.emit('stop-stream');
}

btnStopPcShare.addEventListener('click', stopDesktopShare);
