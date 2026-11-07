const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const os = require('os');
const path = require('path');
const QRCode = require('qrcode');
const dgram = require('dgram');

const app = express();
const PORT = 4848;
const UDP_PORT = 4847;

const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: '*' },
    maxHttpBufferSize: 1e8 // 100 MB max buffer for ultra-high-res frames
});

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// Tarmoq IP manzilini dinamik aniqlash
function getLocalIpAddress() {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name]) {
            if (iface.family === 'IPv4' && !iface.internal) {
                return iface.address;
            }
        }
    }
    return '127.0.0.1';
}

const computerName = os.hostname() || "Kompyuter (PC)";
const DEFAULT_ROOM_PIN = "777888";

const rooms = new Map();
rooms.set(DEFAULT_ROOM_PIN, {
    pin: DEFAULT_ROOM_PIN,
    hostId: null,
    clients: [],
    activeStreamer: null
});

io.on('connection', (socket) => {
    console.log(`[ULANISH] Yangi mijoz bog'landi: ${socket.id}`);

    // Avtomatik ravishda standart xonaga ulab qo'yish
    socket.join(DEFAULT_ROOM_PIN);
    socket.roomPin = DEFAULT_ROOM_PIN;

    // 1. Yangi Qabul qiluvchi (Receiver) xona ochish
    socket.on('create-receiver-room', async (callback) => {
        const pin = DEFAULT_ROOM_PIN;
        socket.join(pin);
        socket.roomPin = pin;
        socket.role = 'receiver';

        const currentIp = getLocalIpAddress();
        const qrPayload = JSON.stringify({
            app: "ScreenSharePro",
            ip: currentIp,
            port: PORT,
            pin: pin,
            serverUrl: `http://${currentIp}:${PORT}`
        });

        try {
            const qrCodeDataUrl = await QRCode.toDataURL(qrPayload);
            if (typeof callback === 'function') {
                callback({
                    success: true,
                    pin: pin,
                    ip: currentIp,
                    port: PORT,
                    qrCode: qrCodeDataUrl
                });
            }
        } catch (err) {
            if (typeof callback === 'function') {
                callback({ success: false, message: err.message });
            }
        }
    });

    // 2. Uzatuvchi (Sender) xonaga ulanishi
    socket.on('join-as-sender', ({ pin, deviceName }, callback) => {
        const targetPin = pin || DEFAULT_ROOM_PIN;
        socket.join(targetPin);
        socket.roomPin = targetPin;
        socket.role = 'sender';
        socket.deviceName = deviceName || 'Android Telefon';

        // Qabul qiluvchilarga sender ulangani haqida darhol xabar berish
        socket.to(targetPin).emit('sender-connected', {
            senderId: socket.id,
            deviceName: socket.deviceName
        });
        socket.broadcast.emit('sender-connected', {
            senderId: socket.id,
            deviceName: socket.deviceName
        });

        if (typeof callback === 'function') {
            callback({ success: true, pin: targetPin });
        }
        console.log(`[SENDER ULANDI] Qurilma: ${socket.deviceName} | PIN: ${targetPin}`);
    });

    // Qabul qiluvchi sifatida qo'shilish
    socket.on('join-as-receiver', ({ pin }, callback) => {
        const targetPin = pin || DEFAULT_ROOM_PIN;
        socket.join(targetPin);
        socket.roomPin = targetPin;
        socket.role = 'receiver';

        if (typeof callback === 'function') {
            callback({ success: true, pin: targetPin });
        }
        console.log(`[RECEIVER TAYYOR] Socket: ${socket.id} | PIN: ${targetPin}`);
    });

    // Legacy mijozlar
    socket.on('join-room', (data) => {
        const roomId = (typeof data === 'string' ? data : data?.roomId) || DEFAULT_ROOM_PIN;
        socket.join(roomId);
        socket.roomPin = roomId;
        socket.role = 'sender';
        socket.deviceName = (typeof data === 'object' && data?.deviceName) || 'Mobil Telefon';

        socket.to(roomId).emit('sender-connected', {
            senderId: socket.id,
            deviceName: socket.deviceName
        });
        socket.broadcast.emit('sender-connected', {
            senderId: socket.id,
            deviceName: socket.deviceName
        });
    });

    // 3. Ekran kadrlari (JPEG Frame Streaming) - Xonaga va barcha qabul qiluvchilarga tarqatish
    const handleIncomingFrame = (frameData) => {
        const pin = socket.roomPin || DEFAULT_ROOM_PIN;
        // Xonaga tarqatish
        socket.to(pin).emit('incoming-screen-frame', frameData);
        // Umumiy tarqatish (senderdan tashqari barcha bog'langan monitorlarga)
        socket.broadcast.emit('incoming-screen-frame', frameData);
        socket.broadcast.emit('mobile-frame', frameData);
    };

    socket.on('screen-frame', handleIncomingFrame);
    socket.on('mobile-frame', handleIncomingFrame);

    // 4. Efirni to'xtatish
    const handleStopStream = () => {
        const pin = socket.roomPin || DEFAULT_ROOM_PIN;
        io.to(pin).emit('stream-stopped');
        socket.broadcast.emit('stream-stopped');
        console.log(`[EFIR TO'XTATILDI] PIN: ${pin}`);
    };

    socket.on('stop-stream', handleStopStream);
    socket.on('stop-streaming', handleStopStream);

    // 5. Ulanish uzilganda
    socket.on('disconnect', () => {
        const pin = socket.roomPin || DEFAULT_ROOM_PIN;
        socket.to(pin).emit('sender-disconnected');
        socket.broadcast.emit('sender-disconnected');
        console.log(`[CHIYISH] Mijoz uzildi: ${socket.id}`);
    });
});

// Server info API
const handleInfoRequest = async (req, res) => {
    try {
        const currentIp = getLocalIpAddress();
        const currentUrl = `http://${currentIp}:${PORT}`;
        const qrPayload = JSON.stringify({
            app: "ScreenSharePro",
            ip: currentIp,
            port: PORT,
            pin: DEFAULT_ROOM_PIN,
            serverUrl: currentUrl
        });
        const qrCodeDataUrl = await QRCode.toDataURL(qrPayload);

        res.json({
            name: computerName,
            ip: currentIp,
            port: PORT,
            url: currentUrl,
            pin: DEFAULT_ROOM_PIN,
            qrCode: qrCodeDataUrl
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

app.get('/api/info', handleInfoRequest);
app.get('/api/server-info', handleInfoRequest);

// UDP Beacon
try {
    const udpSocket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    udpSocket.bind(() => {
        try { udpSocket.setBroadcast(true); } catch (e) {}
    });

    setInterval(() => {
        try {
            const currentIp = getLocalIpAddress();
            const beacon = JSON.stringify({
                app: "ScreenSharePro",
                name: computerName,
                ip: currentIp,
                port: PORT,
                pin: DEFAULT_ROOM_PIN
            });
            udpSocket.send(beacon, 0, beacon.length, UDP_PORT, '255.255.255.255', () => {});
        } catch (e) {}
    }, 2500);
} catch (e) {}

server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
        console.log(`[XABAR] Port ${PORT} band, mavjud nusxa ishlamoqda.`);
    } else {
        console.error("Server xatosi:", err);
    }
});

server.listen(PORT, '0.0.0.0', () => {
    const currentIp = getLocalIpAddress();
    console.log(`=============================================`);
    console.log(`🚀 SCREENSHARE PRO SERVER TAYYOR`);
    console.log(`📡 Mahalliy IP: http://${currentIp}:${PORT}`);
    console.log(`💻 Kompyuter: ${computerName}`);
    console.log(`=============================================`);
});
