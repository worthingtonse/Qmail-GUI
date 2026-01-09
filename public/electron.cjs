const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const fs = require('fs');

process.stdout.write('[ELECTRON] Starting...\n');

let mainWindow;
let backendProcess = null;
const isDev = process.argv.includes('--dev');

function log(msg) {
  process.stdout.write(`[ELECTRON] ${msg}\n`);
}

function setupBackendData(backendDir) {
  const dataDir = path.join(backendDir, 'Data');
  const walletsDir = path.join(dataDir, 'Wallets');
  const lockersDir = path.join(dataDir, 'lockers');
  const attachmentsDir = path.join(dataDir, 'attachments');
  
  log('Setting up Data directories...');
  
  try {
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
      log('Created: Data/');
    }
    
    if (!fs.existsSync(walletsDir)) {
      fs.mkdirSync(walletsDir, { recursive: true });
      log('Created: Data/Wallets/');
    }
    
    if (!fs.existsSync(lockersDir)) {
      fs.mkdirSync(lockersDir, { recursive: true });
      log('Created: Data/lockers/');
    }
    
    if (!fs.existsSync(attachmentsDir)) {
      fs.mkdirSync(attachmentsDir, { recursive: true });
      log('Created: Data/attachments/');
    }
    
    const beaconPath = path.join(dataDir, 'beacon_state.json');
    if (!fs.existsSync(beaconPath)) {
      fs.writeFileSync(beaconPath, '{}');
      log('Created: beacon_state.json');
    }
    
    const logPath = path.join(dataDir, 'mail.mlog');
    if (!fs.existsSync(logPath)) {
      fs.writeFileSync(logPath, '');
      log('Created: mail.mlog');
    }
    
    log('Data setup complete');
    return true;
  } catch (error) {
    log('Error setting up Data: ' + error.message);
    return false;
  }
}

function startBackend() {
  log('Starting backend...');
  
  let backendDir, backendPath;
  
  if (isDev) {
    backendDir = path.join(__dirname, 'backend');
    backendPath = path.join(backendDir, 'qmail-backend.exe');
  } else {
    backendDir = path.join(process.resourcesPath, 'backend');
    backendPath = path.join(backendDir, 'qmail-backend.exe');
  }
  
  log('Backend dir: ' + backendDir);
  log('Backend path: ' + backendPath);
  
  if (!fs.existsSync(backendPath)) {
    log('ERROR: Backend not found!');
    return;
  }
  
  const configPath = path.join(backendDir, 'qmail.toml');
  log('Config exists: ' + fs.existsSync(configPath));
  
  if (!setupBackendData(backendDir)) {
    log('ERROR: Failed to setup Data folders');
    return;
  }
  
  try {
    backendProcess = spawn(backendPath, [], {
      cwd: backendDir,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: false,
      windowsHide: true
    });
    
    log('Backend started PID: ' + backendProcess.pid);
    
    backendProcess.stdout.on('data', (data) => {
      log('BACKEND: ' + data.toString().trim());
    });
    
    backendProcess.stderr.on('data', (data) => {
      log('ERR: ' + data.toString().trim());
    });
    
    backendProcess.on('exit', (code) => {
      log('Backend exit: ' + code);
      backendProcess = null;
    });
    
  } catch (error) {
    log('Exception: ' + error.message);
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.cjs')
    }
  });

  // mainWindow.webContents.openDevTools();
  
  mainWindow.webContents.on('did-finish-load', () => {
    log('Window loaded');
    startBackend();
  });

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
  } else {
    mainWindow.loadFile(path.join(__dirname, 'dist', 'index.html'));
  }
}

// IPC Handlers (tumhare existing handlers)
ipcMain.handle('check-usb-drive', async () => {
  // USB check logic
  return { success: true };
});

ipcMain.handle('show-error-dialog', async (event, title, message) => {
  return dialog.showMessageBox(mainWindow, {
    type: 'error',
    title: title,
    message: message,
    buttons: ['OK']
  });
});

ipcMain.handle('get-app-version', () => {
  return app.getVersion();
});

ipcMain.handle('quit-app', () => {
  app.quit();
});

ipcMain.handle('run-command', async (event, command) => {
  // Command execution logic
  return { success: true, output: 'Command executed' };
});

ipcMain.handle('read-file', async (event, filename) => {
  try {
    const filePath = path.join(process.resourcesPath, filename);
    const content = fs.readFileSync(filePath, 'utf-8');
    return { success: true, content };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (backendProcess) backendProcess.kill();
  app.quit();
});