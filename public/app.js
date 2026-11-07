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
const liveWebRtcVideo = document.getElementById('liveWebRtcVideo');
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

// WEBRTC PEER CONNECTION
let peerConnection = null;
const rtcConfig = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
    ]
};

// FPS HISOBLASH
let frameCount = 0;
let lastFpsTime = performance.now();

// KADRNI CHIZISH (JPEG KADRLAR UCHUN)
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
    if (isCapturingDesktop) return;

    if (qrWaitingPanel && qrWaitingPanel.style.display !== 'none') {
        qrWaitingPanel.style.display = 'none';
        liveStreamPanel.style.display = 'flex';
        switchTab('receiver');
    }

    // Canvas ko'rsatish
    if (screenCanvas) screenCanvas.style.display = 'block';
    if (liveWebRtcVideo) liveWebRtcVideo.style.display = 'none';

    if (typeof data === 'string') {
        streamImg.src = data.startsWith('data:') ? data : `data:image/jpeg;base64,${data}`;
    } else {
        if (activeBlobUrl) URL.revokeObjectURL(activeBlobUrl);
        const blob = new Blob([data], { type: 'image/jpeg' });
        activeBlobUrl = URL.createObjectURL(blob);
        streamImg.src = activeBlobUrl;
    }
}

// SERVER HODISALARI (JPEG OQIMI)
socket.on('incoming-screen-frame', renderIncomingFrame);
socket.on('mobile-frame', renderIncomingFrame);

// TELEFON ICHKI AUDIOSINI KOMPYUTER DINAMIKLARIDAN CHIQARISH
let audioCtx = null;
let nextAudioPlayTime = 0;

socket.on('audio-frame', (arrayBuffer) => {
    try {
        if (!audioCtx) {
            audioCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 44100 });
        }
        if (audioCtx.state === 'suspended') {
            audioCtx.resume();
        }

        const int16Array = new Int16Array(arrayBuffer);
        const numChannels = 2;
        const numSamples = Math.floor(int16Array.length / numChannels);
        if (numSamples === 0) return;

        const audioBuffer = audioCtx.createBuffer(numChannels, numSamples, 44100);
        const leftChannel = audioBuffer.getChannelData(0);
        const rightChannel = audioBuffer.getChannelData(1);

        for (let i = 0; i < numSamples; i++) {
            leftChannel[i] = int16Array[i * 2] / 32768.0;
            rightChannel[i] = int16Array[i * 2 + 1] / 32768.0;
        }

        const source = audioCtx.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(audioCtx.destination);

        const currentTime = audioCtx.currentTime;
        if (nextAudioPlayTime < currentTime) {
            nextAudioPlayTime = currentTime;
        }
        source.start(nextAudioPlayTime);
        nextAudioPlayTime += audioBuffer.duration;
    } catch (e) {
        // audio process
    }
});

// WEBRTC SIGNALING: TELEFONDAN KELGAN WEBRTC OFFER
socket.on('webrtc-offer', async ({ senderId, offer }) => {
    if (isCapturingDesktop) return;
    console.log("[WebRTC] Telefondan Offer qabul qilindi");

    try {
        if (peerConnection) {
            peerConnection.close();
        }
        peerConnection = new RTCPeerConnection(rtcConfig);

        peerConnection.ontrack = (event) => {
            console.log("[WebRTC] Trek qabul qilindi:", event.track.kind);
            const stream = event.streams[0] || new MediaStream([event.track]);
            if (liveWebRtcVideo) {
                liveWebRtcVideo.srcObject = stream;
                liveWebRtcVideo.style.display = 'block';
                if (screenCanvas) screenCanvas.style.display = 'none';
                liveWebRtcVideo.play().catch(e => console.log("Video/Audio play:", e));
            }

            if (qrWaitingPanel) qrWaitingPanel.style.display = 'none';
            if (liveStreamPanel) liveStreamPanel.style.display = 'flex';
            switchTab('receiver');
        };

        peerConnection.onicecandidate = (event) => {
            if (event.candidate) {
                socket.emit('webrtc-ice-candidate', { candidate: event.candidate });
            }
        };

        await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
        const answer = await peerConnection.createAnswer();
        await peerConnection.setLocalDescription(answer);

        socket.emit('webrtc-answer', { answer });
        console.log("[WebRTC] Answer yuborildi");
    } catch (err) {
        console.error("[WebRTC] Offer ishlashda xatolik:", err);
    }
});

socket.on('webrtc-answer', async ({ answer }) => {
    if (peerConnection && answer) {
        try {
            await peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
            console.log("[WebRTC] Remote Answer o'rnatildi");
        } catch (e) {
            console.error("[WebRTC] Answer xatosi:", e);
        }
    }
});

socket.on('webrtc-ice-candidate', async ({ candidate }) => {
    if (peerConnection && candidate) {
        try {
            await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
        } catch (e) {
            console.error("[WebRTC] ICE candidate xatosi:", e);
        }
    }
});

// SENDER ULANDI
socket.on('sender-connected', ({ deviceName }) => {
    console.log("Qurilma ulandi:", deviceName);
    if (connectedDeviceName) {
        connectedDeviceName.textContent = deviceName || "Android Telefon";
    }
    if (qrWaitingPanel) qrWaitingPanel.style.display = 'none';
    if (liveStreamPanel) liveStreamPanel.style.display = 'flex';
    switchTab('receiver');
});

// EFIR UZILGANDA
function onStreamDisconnected() {
    if (liveWebRtcVideo) {
        liveWebRtcVideo.pause();
        liveWebRtcVideo.srcObject = null;
        liveWebRtcVideo.style.display = 'none';
    }
    if (peerConnection) {
        peerConnection.close();
        peerConnection = null;
    }
    if (liveStreamPanel) liveStreamPanel.style.display = 'none';
    if (qrWaitingPanel) qrWaitingPanel.style.display = 'block';
    if (canvasCtx && screenCanvas) {
        canvasCtx.clearRect(0, 0, screenCanvas.width, screenCanvas.height);
        screenCanvas.style.display = 'block';
    }
}

socket.on('sender-disconnected', onStreamDisconnected);
socket.on('stream-stopped', onStreamDisconnected);
socket.on('room-closed', onStreamDisconnected);

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

btnToggleFull.addEventListener('click', () => {
    if (!document.fullscreenElement) {
        liveStreamPanel.requestFullscreen().catch(e => console.log(e));
    } else {
        document.exitFullscreen();
    }
});

btnRotateStream.addEventListener('click', () => {
    currentRotation = (currentRotation + 90) % 360;
    if (streamImg.src) {
        streamImg.onload();
    }
});

btnDisconnectStream.addEventListener('click', () => {
    socket.emit('stop-stream');
    onStreamDisconnected();
});

// KOMPYUTER EKRANI VA OVOZINI UZATISH (PC ➔ TELEFON)
btnStartPcShare.addEventListener('click', async () => {
    const pin = (targetPinInput ? targetPinInput.value.trim() : '') || currentRoomPin;

    try {
        let stream = null;
        if (window.electronAPI && window.electronAPI.getScreenSources) {
            const sources = await window.electronAPI.getScreenSources();
            if (sources && sources.length > 0) {
                stream = await navigator.mediaDevices.getUserMedia({
                    audio: {
                        mandatory: {
                            chromeMediaSource: 'desktop'
                        }
                    },
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
                audio: true // Tizim ovozini ham olish
            });
        }

        localScreenStream = stream;
        isCapturingDesktop = true;

        socket.emit('join-as-sender', { pin: pin, deviceName: "Kompyuter (PC)" }, async () => {
            btnStartPcShare.style.display = 'none';
            btnStopPcShare.style.display = 'block';
            senderCastStatus.textContent = "🟢 Kompyuteringiz ekrani va tizim ovozi WebRTC orqali uzatilmoqda.";

            // WebRTC orqali telefonga video+audio uzatish
            try {
                if (peerConnection) peerConnection.close();
                peerConnection = new RTCPeerConnection(rtcConfig);

                stream.getTracks().forEach(track => {
                    peerConnection.addTrack(track, stream);
                });

                peerConnection.onicecandidate = (event) => {
                    if (event.candidate) {
                        socket.emit('webrtc-ice-candidate', { candidate: event.candidate });
                    }
                };

                const offer = await peerConnection.createOffer();
                await peerConnection.setLocalDescription(offer);
                socket.emit('webrtc-offer', { offer });
                console.log("[WebRTC] Kompyuterdan Offer yuborildi");
            } catch (webrtcErr) {
                console.log("[WebRTC] Init xatosi:", webrtcErr);
            }

            // Zaxira sifatida JPEG kadrlarini ham uzatib turish
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
    if (peerConnection) {
        peerConnection.close();
        peerConnection = null;
    }
    btnStartPcShare.style.display = 'block';
    btnStopPcShare.style.display = 'none';
    senderCastStatus.textContent = '';
    socket.emit('stop-stream');
}

btnStopPcShare.addEventListener('click', stopDesktopShare);
