import { app, BrowserWindow } from 'electron';
import { join } from 'path';

let mainWindow!: BrowserWindow;

function createWindow() {
    // Create the browser window.
    mainWindow = new BrowserWindow({
        width: 800,
        height: 600,
        icon: 'assets/images/icon.png',
        webPreferences: {
            preload: join(__dirname, 'preload.js'),
        },
    });

    // and load the index.html of the app.
    mainWindow.loadFile(join(__dirname, 'index.html'));

    // Open the DevTools.
    //mainWindow.webContents.openDevTools();
}

app.whenReady().then(() => {
    createWindow();

    app.on('activate', function () {
        // On macOS it's common to re-create a window in the app when the
        // dock icon is clicked and there are no other windows open.
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});
