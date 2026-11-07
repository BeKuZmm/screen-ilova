const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const os = require('os');
const path = require('path');
const QRCode = require('qrcode');

const app = express();
const PORT = 4848;
const PRO_SECRET_CODE = "SCREEN-PRO-7777";

const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: '*' }
});

app.use(express.static(path.join(__dirname, 'public')));

function getLocalIpAddress() {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name]) {
            if (iface.family === 'IPv4' && !iface.internal) {
                return iface.address;
            }
        }
    }
    return 'localhost';
}

const localIp = getLocalIpAddress();
const serverUrl = `http://${localIp}:${PORT}`;

const rooms = {};

io.on('connection', (socket) => {
    socket.on('join-room', ({ roomId, deviceName, deviceType, isPro }) => {
        socket.join(roomId);
        socket.roomId = roomId;
        socket.deviceName = deviceName || 'Noma\'lum';
        socket.deviceType = deviceType || 'pc';
        socket.isPro = isPro || false;

        if (!rooms[roomId]) {
            rooms[roomId] = {
                id: roomId,
                devices: [],
                streamerId: null
            };
        }

        rooms[roomId].devices = rooms[roomId].devices.filter(d => d.id !== socket.id);
        rooms[roomId].devices.push({
            id: socket.id,
            name: socket.deviceName,
            type: socket.deviceType,
            isPro: socket.isPro
        });

        io.to(roomId).emit('room-users', {
            devices: rooms[roomId].devices,
            streamerId: rooms[roomId].streamerId
        });

        // Agar efir ketayotgan bo'lsa, yangi qo'shilgan qurilmaga avtomatik stream ulaymiz
        if (rooms[roomId].streamerId && rooms[roomId].streamerId !== socket.id) {
            io.to(rooms[roomId].streamerId).emit('device-joined', {
                newDeviceId: socket.id
            });
        }
    });

    socket.on('verify-pro-code', (code, callback) => {
        if (code && code.trim().toUpperCase() === PRO_SECRET_CODE) {
            socket.isPro = true;
            if (socket.roomId && rooms[socket.roomId]) {
                const dev = rooms[socket.roomId].devices.find(d => d.id === socket.id);
                if (dev) dev.isPro = true;
                io.to(socket.roomId).emit('room-users', {
                    devices: rooms[socket.roomId].devices,
                    streamerId: rooms[socket.roomId].streamerId
                });
            }
            callback({ success: true, message: "PRO rejim muvaffaqiyatli faollashtirildi!" });
        } else {
            callback({ success: false, message: "Noto'g'ri kalit!" });
        }
    });

    socket.on('start-streaming', () => {
        const roomId = socket.roomId;
        if (!roomId || !rooms[roomId]) return;

        rooms[roomId].streamerId = socket.id;
        io.to(roomId).emit('streamer-changed', {
            streamerId: socket.id,
            streamerName: socket.deviceName,
            isPro: socket.isPro
        });

        // Xonadagi barcha boshqa a'zolarga ulanish
        const others = rooms[roomId].devices.filter(d => d.id !== socket.id);
        others.forEach(dev => {
            socket.emit('connect-to-peer', { targetId: dev.id });
        });
    });

    socket.on('stop-streaming', () => {
        const roomId = socket.roomId;
        if (!roomId || !rooms[roomId]) return;

        if (rooms[roomId].streamerId === socket.id) {
            rooms[roomId].streamerId = null;
            io.to(roomId).emit('streamer-changed', { streamerId: null });
        }
    });

    socket.on('webrtc-offer', ({ targetId, offer }) => {
        io.to(targetId).emit('webrtc-offer', { senderId: socket.id, offer });
    });

    socket.on('webrtc-answer', ({ targetId, answer }) => {
        io.to(targetId).emit('webrtc-answer', { senderId: socket.id, answer });
    });

    socket.on('webrtc-ice-candidate', ({ targetId, candidate }) => {
        io.to(targetId).emit('webrtc-ice-candidate', { senderId: socket.id, candidate });
    });

    socket.on('disconnect', () => {
        const roomId = socket.roomId;
        if (roomId && rooms[roomId]) {
            rooms[roomId].devices = rooms[roomId].devices.filter(d => d.id !== socket.id);
            if (rooms[roomId].streamerId === socket.id) {
                rooms[roomId].streamerId = null;
                io.to(roomId).emit('streamer-changed', { streamerId: null });
            }
            io.to(roomId).emit('room-users', {
                devices: rooms[roomId].devices,
                streamerId: rooms[roomId].streamerId
            });
        }
    });
});

app.get('/api/info', async (req, res) => {
    try {
        const qrCodeDataUrl = await QRCode.toDataURL(serverUrl);
        res.json({
            ip: localIp,
            port: PORT,
            url: serverUrl,
            qrCode: qrCodeDataUrl
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

server.listen(PORT, '0.0.0.0', () => {
    console.log(`=================================================`);
    console.log(`🚀 SCREEN SHARE SERVER ISHGA TUSHDI!`);
    console.log(`📡 Manzil: ${serverUrl}`);
    console.log(`🔑 Master PRO Kod: ${PRO_SECRET_CODE}`);
    console.log(`=================================================`);
});
