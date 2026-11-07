const { app, BrowserWindow, ipcMain, desktopCapturer, session } = require('electron');
const path = require('path');

require('./server.js');

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

    // HTTP orqali bir zumda ochiladi (oq ekran bo'lmaydi)
    mainWindow.loadURL('http://localhost:4848');

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
