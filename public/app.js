// DOM ELEMENTLAR
const headerStatus = document.getElementById('headerStatus');
const headerStatusText = document.getElementById('headerStatusText');
const btnBackToHome = document.getElementById('btnBackToHome');

// VIEWS
const viewModeSelection = document.getElementById('viewModeSelection');
const viewReceiver = document.getElementById('viewReceiver');
const viewSender = document.getElementById('viewSender');

// MODE SELECTION BUTTONS
const cardSelectReceive = document.getElementById('cardSelectReceive');
const cardSelectSend = document.getElementById('cardSelectSend');

// RECEIVER VIEW ELEMENTS
const receiverWaitingBox = document.getElementById('receiverWaitingBox');
const receiverQrImg = document.getElementById('receiverQrImg');
const receiverPinDisplay = document.getElementById('receiverPinDisplay');
const receiverUrlDisplay = document.getElementById('receiverUrlDisplay');
const streamViewerBox = document.getElementById('streamViewerBox');
const streamSenderName = document.getElementById('streamSenderName');
const btnToggleFullscreen = document.getElementById('btnToggleFullscreen');
const btnCloseStream = document.getElementById('btnCloseStream');
const liveScreenCanvas = document.getElementById('liveScreenCanvas');
const canvasCtx = liveScreenCanvas ? liveScreenCanvas.getContext('2d') : null;

// SENDER VIEW ELEMENTS
const inputSenderPin = document.getElementById('inputSenderPin');
const inputTargetIp = document.getElementById('inputTargetIp');
const btnStartPcCast = document.getElementById('btnStartPcCast');
const btnStopPcCast = document.getElementById('btnStopPcCast');
const senderStatusMsg = document.getElementById('senderStatusMsg');

// STATE
const socket = io();
let currentMode = 'home'; // home, receiver, sender
let activeRoomPin = "777888";
let localMediaStream = null;
let streamInterval = null;

// KADRLARNI CHIZISH UCHUN RASM
const frameImg = new Image();
frameImg.onload = () => {
    if (liveScreenCanvas && canvasCtx) {
        liveScreenCanvas.width = frameImg.width;
        liveScreenCanvas.height = frameImg.height;
        canvasCtx.drawImage(frameImg, 0, 0);
    }
};

let currentBlobUrl = null;
function renderFrame(arrayBuffer) {
    if (currentBlobUrl) URL.revokeObjectURL(currentBlobUrl);
    const blob = new Blob([arrayBuffer], { type: 'image/jpeg' });
    currentBlobUrl = URL.createObjectURL(blob);
    frameImg.src = currentBlobUrl;

    // Skaner kutish oynasini yopib, jonli stream oynasini ko'rsatish
    if (receiverWaitingBox) receiverWaitingBox.style.display = 'none';
    if (streamViewerBox) streamViewerBox.style.display = 'flex';
}

socket.on('incoming-screen-frame', renderFrame);
socket.on('mobile-frame', renderFrame);

// SENDER ULANDI
socket.on('sender-connected', ({ deviceName }) => {
    if (streamSenderName) streamSenderName.textContent = deviceName || "Mobil Qurilma";
    headerStatus.querySelector('.status-dot').classList.add('active');
    headerStatusText.textContent = "Ulandi: " + (deviceName || "Mobil Qurilma");
});

// SENDER CHIQIB KETDI
socket.on('sender-disconnected', () => {
    if (receiverWaitingBox) receiverWaitingBox.style.display = 'flex';
    if (streamViewerBox) streamViewerBox.style.display = 'none';
    headerStatusText.textContent = "Ulanish kutilmoqda...";
});

socket.on('stream-stopped', () => {
    if (receiverWaitingBox) receiverWaitingBox.style.display = 'flex';
    if (streamViewerBox) streamViewerBox.style.display = 'none';
});

// 1. REJIMLARNI ALMASHTIRISH (VIEW SWITCHER)
function showView(viewName) {
    currentMode = viewName;
    if (viewModeSelection) viewModeSelection.style.display = 'none';
    if (viewReceiver) viewReceiver.style.display = 'none';
    if (viewSender) viewSender.style.display = 'none';
    if (btnBackToHome) btnBackToHome.style.display = 'inline-flex';

    if (viewName === 'home') {
        if (viewModeSelection) viewModeSelection.style.display = 'flex';
        if (btnBackToHome) btnBackToHome.style.display = 'none';
        headerStatusText.textContent = "Tayyor";
        headerStatus.querySelector('.status-dot').classList.remove('active');
        stopSenderStream();
    } else if (viewName === 'receiver') {
        if (viewReceiver) viewReceiver.style.display = 'flex';
        initReceiverMode();
    } else if (viewName === 'sender') {
        if (viewSender) viewSender.style.display = 'flex';
        initSenderMode();
    }
}

if (btnBackToHome) btnBackToHome.addEventListener('click', () => showView('home'));
if (cardSelectReceive) cardSelectReceive.addEventListener('click', () => showView('receiver'));
if (cardSelectSend) cardSelectSend.addEventListener('click', () => showView('sender'));

// 2. QABUL QILUVCHI REJIMINI ISHGA TUSHIRISH (RECEIVER)
async function initReceiverMode() {
    if (receiverWaitingBox) receiverWaitingBox.style.display = 'flex';
    if (streamViewerBox) streamViewerBox.style.display = 'none';
    if (receiverPinDisplay) receiverPinDisplay.textContent = "Yuklanmoqda...";
    headerStatusText.textContent = "Kutilmoqda...";

    // Tezkor API ma'lumotini olish
    try {
        const res = await fetch('/api/server-info');
        const data = await res.json();
        if (data && data.qrCode) {
            if (receiverQrImg) receiverQrImg.src = data.qrCode;
            if (receiverPinDisplay) receiverPinDisplay.textContent = data.pin || "777888";
            if (receiverUrlDisplay) receiverUrlDisplay.textContent = data.url;
            activeRoomPin = data.pin || "777888";
        }
    } catch (e) {
        console.log("Server info fetch xatosi:", e);
    }

    // Socket orqali yangi dinamik xona ochish
    socket.emit('create-receiver-room', (res) => {
        if (res && res.success) {
            activeRoomPin = res.pin;
            if (receiverPinDisplay) receiverPinDisplay.textContent = res.pin;
            if (receiverQrImg) receiverQrImg.src = res.qrCode;
            if (receiverUrlDisplay) receiverUrlDisplay.textContent = `http://${res.ip}:${res.port}`;
        }
    });
}

// 3. UZATUVCHI REJIMI (SENDER)
function initSenderMode() {
    if (senderStatusMsg) {
        senderStatusMsg.textContent = '';
        senderStatusMsg.className = 'stream-status-msg';
    }
}

if (btnStartPcCast) {
    btnStartPcCast.addEventListener('click', async () => {
        const pin = (inputSenderPin ? inputSenderPin.value.trim() : '') || "777888";

        try {
            // Ekranni olish
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

            localMediaStream = stream;

            // Xonaga ulanish
            socket.emit('join-as-sender', { pin: pin, deviceName: "Kompyuter (PC)" }, (res) => {
                if (res && res.success) {
                    if (btnStartPcCast) btnStartPcCast.style.display = 'none';
                    if (btnStopPcCast) btnStopPcCast.style.display = 'block';
                    if (senderStatusMsg) {
                        senderStatusMsg.textContent = "Ekran muvaffaqiyatli uzatilmoqda!";
                        senderStatusMsg.className = 'stream-status-msg text-green';
                    }
                    startCanvasCapturer(stream);
                } else {
                    alert(res ? res.message : "Xonaga ulanib bo'lmadi!");
                    stopSenderStream();
                }
            });

            stream.getVideoTracks()[0].onended = () => {
                stopSenderStream();
            };

        } catch (err) {
            console.error("Ekran olishda xatolik:", err);
            if (senderStatusMsg) {
                senderStatusMsg.textContent = "Xatolik: " + err.message;
            }
        }
    });
}

function startCanvasCapturer(stream) {
    const videoTrack = document.createElement('video');
    videoTrack.srcObject = stream;
    videoTrack.play();

    const tempCanvas = document.createElement('canvas');
    const tempCtx = tempCanvas.getContext('2d');

    streamInterval = setInterval(() => {
        if (!localMediaStream) return;
        if (videoTrack.videoWidth > 0 && videoTrack.videoHeight > 0) {
            tempCanvas.width = 1280;
            tempCanvas.height = Math.round(1280 * (videoTrack.videoHeight / videoTrack.videoWidth));
            tempCtx.drawImage(videoTrack, 0, 0, tempCanvas.width, tempCanvas.height);

            tempCanvas.toBlob((blob) => {
                if (blob) {
                    blob.arrayBuffer().then((buf) => {
                        socket.emit('screen-frame', buf);
                    });
                }
            }, 'image/jpeg', 0.65);
        }
    }, 1000 / 30); // 30 FPS
}

function stopSenderStream() {
    if (streamInterval) clearInterval(streamInterval);
    if (localMediaStream) {
        localMediaStream.getTracks().forEach(t => t.stop());
        localMediaStream = null;
    }
    if (btnStartPcCast) btnStartPcCast.style.display = 'block';
    if (btnStopPcCast) btnStopPcCast.style.display = 'none';
    socket.emit('stop-stream');
}

if (btnStopPcCast) btnStopPcCast.addEventListener('click', stopSenderStream);

// TO'LIQ EKRAN
if (btnToggleFullscreen) {
    btnToggleFullscreen.addEventListener('click', () => {
        if (!document.fullscreenElement) {
            if (streamViewerBox) streamViewerBox.requestFullscreen().catch(err => console.log(err));
        } else {
            document.exitFullscreen();
        }
    });
}

if (btnCloseStream) {
    btnCloseStream.addEventListener('click', () => {
        showView('home');
    });
}

// Boshlang'ich holat: Socket holatini ko'rsatish
socket.on('connect', () => {
    if (headerStatus) {
        headerStatus.querySelector('.status-dot').classList.add('active');
        if (headerStatusText) headerStatusText.textContent = "Server tayyor";
    }
});

socket.on('disconnect', () => {
    if (headerStatus) {
        headerStatus.querySelector('.status-dot').classList.remove('active');
        if (headerStatusText) headerStatusText.textContent = "Aloqa uzildi";
    }
});
