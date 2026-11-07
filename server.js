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
    maxHttpBufferSize: 1e8 // 100 MB max buffer for smooth high-res frames
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

// 6 xonali tasodifiy PIN yaratish
function generateRoomPin() {
    return Math.floor(100000 + Math.random() * 900000).toString();
}

// Xonalar xaritasi: pin -> { hostId, clients, activeStreamer }
const rooms = new Map();

// Standart umumiy xona
const DEFAULT_ROOM_PIN = "777888";
rooms.set(DEFAULT_ROOM_PIN, {
    pin: DEFAULT_ROOM_PIN,
    hostId: null,
    clients: [],
    activeStreamer: null
});

io.on('connection', (socket) => {
    console.log(`[ULANISH] Yangi mijoz: ${socket.id}`);

    // 1. Yangi Qabul qiluvchi (Receiver) xona ochish
    socket.on('create-receiver-room', async (callback) => {
        const pin = generateRoomPin();
        socket.join(pin);
        socket.roomPin = pin;
        socket.role = 'receiver';

        rooms.set(pin, {
            pin: pin,
            hostId: socket.id,
            clients: [],
            activeStreamer: null
        });

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
        console.log(`[XONA YARATILDI] PIN: ${pin} | Host: ${socket.id}`);
    });

    // 2. Uzatuvchi (Sender) xonaga ulanishi (PIN orqali)
    socket.on('join-as-sender', ({ pin, deviceName }, callback) => {
        const targetPin = pin || DEFAULT_ROOM_PIN;
        let room = rooms.get(targetPin);
        if (!room) {
            // Agar xona topilmasa, avtomatik yaratamiz
            room = {
                pin: targetPin,
                hostId: null,
                clients: [],
                activeStreamer: socket.id
            };
            rooms.set(targetPin, room);
        }

        socket.join(targetPin);
        socket.roomPin = targetPin;
        socket.role = 'sender';
        socket.deviceName = deviceName || 'Qurilma';

        room.clients.push(socket.id);
        room.activeStreamer = socket.id;

        // Xonadagi barcha qabul qiluvchilarga sender ulangani haqida xabar berish
        socket.to(targetPin).emit('sender-connected', {
            senderId: socket.id,
            deviceName: socket.deviceName
        });

        if (typeof callback === 'function') {
            callback({ success: true, pin: targetPin });
        }
        console.log(`[SENDER ULANDI] PIN: ${targetPin} | Qurilma: ${socket.deviceName}`);
    });

    // Qabul qiluvchi sifatida mavjud xonaga qo'shilish
    socket.on('join-as-receiver', ({ pin }, callback) => {
        const targetPin = pin || DEFAULT_ROOM_PIN;
        socket.join(targetPin);
        socket.roomPin = targetPin;
        socket.role = 'receiver';

        if (!rooms.has(targetPin)) {
            rooms.set(targetPin, {
                pin: targetPin,
                hostId: socket.id,
                clients: [],
                activeStreamer: null
            });
        }

        if (typeof callback === 'function') {
            callback({ success: true, pin: targetPin });
        }
        console.log(`[RECEIVER ULANDI] PIN: ${targetPin}`);
    });

    // Eski mijozlar uchun moslik (Backward compatibility)
    socket.on('join-room', (data) => {
        const roomId = (typeof data === 'string' ? data : data?.roomId) || DEFAULT_ROOM_PIN;
        socket.join(roomId);
        socket.roomPin = roomId;
        socket.role = 'sender';
        socket.deviceName = (typeof data === 'object' && data?.deviceName) || 'Mobil Qurilma';

        let room = rooms.get(roomId);
        if (!room) {
            room = { pin: roomId, hostId: null, clients: [socket.id], activeStreamer: socket.id };
            rooms.set(roomId, room);
        } else {
            room.clients.push(socket.id);
            room.activeStreamer = socket.id;
        }

        socket.to(roomId).emit('sender-connected', {
            senderId: socket.id,
            deviceName: socket.deviceName
        });
        console.log(`[LEGACY JOIN] Room: ${roomId} | Qurilma: ${socket.deviceName}`);
    });

    // 3. Ekran kadrlari (JPEG Frame Streaming)
    const handleIncomingFrame = (frameBuffer) => {
        const pin = socket.roomPin || DEFAULT_ROOM_PIN;
        socket.to(pin).emit('incoming-screen-frame', frameBuffer);
        socket.to(pin).emit('mobile-frame', frameBuffer); // legacy
    };

    socket.on('screen-frame', handleIncomingFrame);
    socket.on('mobile-frame', handleIncomingFrame);

    // 4. WebRTC Signallar
    socket.on('webrtc-offer', (payload) => {
        const pin = socket.roomPin || DEFAULT_ROOM_PIN;
        socket.to(pin).emit('webrtc-offer', payload);
    });

    socket.on('webrtc-answer', (payload) => {
        const pin = socket.roomPin || DEFAULT_ROOM_PIN;
        socket.to(pin).emit('webrtc-answer', payload);
    });

    socket.on('webrtc-ice-candidate', (payload) => {
        const pin = socket.roomPin || DEFAULT_ROOM_PIN;
        socket.to(pin).emit('webrtc-ice-candidate', payload);
    });

    // 5. Efirni to'xtatish
    const handleStopStream = () => {
        const pin = socket.roomPin || DEFAULT_ROOM_PIN;
        io.to(pin).emit('stream-stopped');
        console.log(`[EFIR TO'XTATILDI] PIN: ${pin}`);
    };

    socket.on('stop-stream', handleStopStream);
    socket.on('stop-streaming', handleStopStream);

    // 6. Ulanish uzilganda
    socket.on('disconnect', () => {
        const pin = socket.roomPin;
        if (pin && rooms.has(pin)) {
            const room = rooms.get(pin);
            if (room.hostId === socket.id) {
                io.to(pin).emit('room-closed');
                rooms.delete(pin);
                console.log(`[XONA YOPILDI] PIN: ${pin}`);
            } else {
                io.to(pin).emit('sender-disconnected');
            }
        }
        console.log(`[CHIYISH] Mijoz uzildi: ${socket.id}`);
    });
});

// Ma'lumot olish API (Ikkala manzilni ham qo'llab-quvvatlaydi)
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

// UDP Broadcast Beacon (Wi-Fi router ruxsat bersa, fon rejimida signallarni yuborib turadi)
try {
    const udpSocket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    udpSocket.on('error', (err) => {
        // Router UDP broadcastni bloklasa xato bermaydi
    });

    udpSocket.bind(() => {
        try {
            udpSocket.setBroadcast(true);
        } catch (e) {}
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
