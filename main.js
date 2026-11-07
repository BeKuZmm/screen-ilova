const { app, BrowserWindow, ipcMain, desktopCapturer, session } = require('electron');
const path = require('path');

// Serverni ishga tushirish
try {
    require('./server.js');
} catch (e) {
    console.log("Server yuklashda ogohlantirish:", e.message);
}

let mainWindow;

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        minWidth: 800,
        minHeight: 600,
        title: "Screen Share Pro (PC, Phone & TV)",
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, 'preload.js')
        },
        autoHideMenuBar: true
    });

    session.defaultSession.setDisplayMediaRequestHandler((request, callback) => {
        desktopCapturer.getSources({ types: ['screen', 'window'] }).then((sources) => {
            callback({ video: sources[0] });
        }).catch(() => {
            callback({});
        });
    });

    // Ishonchli yuklash (Server biroz kechikib ochilsa ham qayta urinadi)
    function loadURLWithRetry(url, retries = 5) {
        mainWindow.loadURL(url).catch((err) => {
            if (retries > 0) {
                console.log(`Ulanish kutilmoqda (${retries})...`);
                setTimeout(() => loadURLWithRetry(url, retries - 1), 800);
            } else {
                console.error("Yuklashda xatolik:", err);
            }
        });
    }

    loadURLWithRetry('http://localhost:4848');

    mainWindow.on('closed', () => {
        mainWindow = null;
    });
}

ipcMain.handle('get-screen-sources', async () => {
    const sources = await desktopCapturer.getSources({ types: ['screen', 'window'] });
    return sources.map(s => ({ id: s.id, name: s.name }));
});

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});
