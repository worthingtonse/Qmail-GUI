const { app, BrowserWindow, dialog, ipcMain } = require('electron');
const path = require('path');
const isDev = require('electron-is-dev');
const fs = require('fs');
const { exec } = require('child_process');

let mainWindow;
let testMode = true; // Default to test mode for development

// Load test mode from a file or default to true for development
function loadTestMode() {
  // For now, always start in test mode during development
  // In production, you could load this from a config file
  testMode = true;
  console.log('Test mode initialized:', testMode);
}

// Enhanced USB detection function
function isRunningFromUSB() {
  // In development, use test mode
  if (isDev) {
    console.log('Development mode - forcing test mode: true');
    return true;
  }
  
  console.log('=== USB Detection Debug Info ===');
  console.log('process.execPath:', process.execPath);
  console.log('app.getAppPath():', app.getAppPath());
  console.log('process.resourcesPath:', process.resourcesPath);
  console.log('process.argv0:', process.argv0);
  console.log('process.argv[0]:', process.argv[0]);
  console.log('__dirname:', __dirname);
  console.log('process.cwd():', process.cwd());
  
  if (process.platform === 'win32') {
    // Strategy 1: Check all available drive letters for removable drives
    const { execSync } = require('child_process');
    
    try {
      // Get all removable drives
      const removableDrives = execSync('wmic logicaldisk where drivetype=2 get caption /value', {
        encoding: 'utf8',
        timeout: 10000
      });
      
      console.log('Removable drives output:', removableDrives);
      
      const driveMatches = removableDrives.match(/Caption=([A-Z]:)/g);
      const removableDriveLetters = driveMatches ? driveMatches.map(match => match.replace('Caption=', '').replace(':', '')) : [];
      
      console.log('Found removable drive letters:', removableDriveLetters);
      
      if (removableDriveLetters.length > 0) {
        // Strategy 2: Check if we can find our executable on any removable drive
        for (const driveLetter of removableDriveLetters) {
          const possiblePaths = [
            `${driveLetter}:\\CloudCoin_Pro\\CloudCoin-Pro-Portable.exe`,
            `${driveLetter}:\\CloudCoin-Pro-Portable.exe`,
            `${driveLetter}:\\CloudCoin_Pro.exe`,
            `${driveLetter}:\\CloudCoin Pro.exe`,
          ];
          
          for (const possiblePath of possiblePaths) {
            try {
              if (fs.existsSync(possiblePath)) {
                console.log(`Found executable on USB drive: ${possiblePath}`);
                return true;
              }
            } catch (err) {
              // Ignore file access errors
            }
          }
        }
        
        // Strategy 3: If running from temp but removable drives exist, likely USB launched
        const execPath = process.execPath;
        if (execPath.includes('AppData\\Local\\Temp') || execPath.includes('\\Temp\\')) {
          console.log('Running from temp directory and removable drives detected - assuming USB launch');
          return true;
        }
      }
      
    } catch (err) {
      console.log('WMIC command failed, using fallback detection:', err.message);
    }
    
    // Strategy 4: Manual drive letter checking (fallback)
    const pathsToCheck = [process.execPath, app.getAppPath(), process.resourcesPath];
    
    for (const checkPath of pathsToCheck) {
      if (!checkPath) continue;
      
      const driveLetter = checkPath.charAt(0).toUpperCase();
      console.log(`Checking path: ${checkPath} -> Drive: ${driveLetter}`);
      
      // Skip C: drive (typically not USB)
      if (driveLetter === 'C') continue;
      
      // Check common USB drive letters
      const commonUSBDrives = ['D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z'];
      if (commonUSBDrives.includes(driveLetter)) {
        console.log(`Non-C drive detected: ${driveLetter}: - assuming USB`);
        return true;
      }
    }
    
    // Strategy 5: Check process arguments for original location
    const allArgs = [process.argv0, ...process.argv];
    console.log('All process arguments:', allArgs);
    
    for (const arg of allArgs) {
      if (arg && arg.includes(':') && !arg.startsWith('C:')) {
        const driveLetter = arg.charAt(0).toUpperCase();
        if (driveLetter.match(/[D-Z]/)) {
          console.log(`Found non-C drive in arguments: ${arg} -> ${driveLetter}:`);
          return true;
        }
      }
    }
    
  } else if (process.platform === 'darwin') {
    // macOS: Check if in /Volumes (typical USB mount point)
    const pathsToCheck = [process.execPath, app.getAppPath(), process.resourcesPath];
    for (const checkPath of pathsToCheck) {
      if (checkPath && checkPath.startsWith('/Volumes/')) {
        console.log('USB drive detected on macOS');
        return true;
      }
    }
  } else {
    // Linux: Check if in /media or /mnt
    const pathsToCheck = [process.execPath, app.getAppPath(), process.resourcesPath];
    for (const checkPath of pathsToCheck) {
      if (checkPath && (checkPath.startsWith('/media/') || checkPath.startsWith('/mnt/'))) {
        console.log('USB drive detected on Linux');
        return true;
      }
    }
  }
  
  console.log('No USB drive detected');
  return false;
}

function createWindow() {
  // Load test mode when creating window
  loadTestMode();
  
  mainWindow = new BrowserWindow({
    width: 1000,
    height: 700,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      enableRemoteModule: false,
      preload: path.join(__dirname, 'preload.cjs'),
      // Only disable webSecurity in production builds, not dev
      webSecurity: isDev ? true : false
    },
    icon: path.join(__dirname, 'icon.png'),
    show: false,
    titleBarStyle: 'default',
    // Only hide menu bar in production
    autoHideMenuBar: !isDev,
    resizable: true,
    minimizable: true,
    maximizable: true,
    closable: true
  });

  // Updated for Vite - ensure proper URL loading
  const startUrl = isDev 
    ? 'http://localhost:5173' 
    : `file://${path.join(__dirname, '../dist/index.html')}`;
  
  console.log('Loading URL:', startUrl);
  console.log('isDev:', isDev);
  
  mainWindow.loadURL(startUrl).catch(err => {
    console.error('Failed to load URL:', err);
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    
    // Don't open dev tools in production
    if (isDev) {
      mainWindow.webContents.openDevTools();
      
      // Suppress security warnings in development
      process.env['ELECTRON_DISABLE_SECURITY_WARNINGS'] = 'true';
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// IPC handlers
ipcMain.handle('check-usb-drive', async () => {
  const result = isRunningFromUSB();
  console.log('USB check result:', result);
  return result;
});

ipcMain.handle('set-test-mode', async (event, enabled) => {
  testMode = enabled;
  console.log('Test mode', enabled ? 'enabled' : 'disabled');
  return true;
});

ipcMain.handle('get-test-mode', async () => {
  return testMode;
});

ipcMain.handle('show-error-dialog', async (event, title, message) => {
  dialog.showErrorBox(title, message);
});

ipcMain.handle('get-app-version', async () => {
  return app.getVersion();
});

ipcMain.handle('quit-app', async () => {
  console.log('Quit app requested');
  app.quit();
  return true;
});

// Add file reading handler for EFF wordlist
ipcMain.handle('read-file', async (event, filename) => {
  try {
    let filePath;
    
    console.log('Reading file:', filename);
    console.log('isDev:', isDev);
    console.log('app.isPackaged:', app.isPackaged);
    
    if (isDev) {
      // Development: read from public folder
      filePath = path.join(__dirname, filename);
      console.log('Development file path:', filePath);
    } else {
      // Production: read from resources folder
      filePath = path.join(process.resourcesPath, filename);
      console.log('Production file path:', filePath);
      
      // Fallback: try reading from the same directory as electron.cjs
      if (!fs.existsSync(filePath)) {
        filePath = path.join(__dirname, filename);
        console.log('Fallback file path:', filePath);
      }
    }
    
    // Check if file exists before reading
    if (!fs.existsSync(filePath)) {
      throw new Error(`File not found: ${filePath}`);
    }
    
    const content = fs.readFileSync(filePath, 'utf8');
    console.log(`Successfully read file: ${filename} (${content.length} characters)`);
    return content;
  } catch (error) {
    console.error('Error reading file:', filename, error.message);
    throw error;
  }
});

// Add CLI command handler
ipcMain.handle('run-command', async (event, command) => {
  return new Promise((resolve, reject) => {
    console.log(`Executing command: ${command}`);
    
    // Add some basic security - only allow specific commands for now
    const allowedCommands = ['ipconfig', 'ipconfig /all', 'dir', 'ls', 'pwd', 'whoami'];
    
    if (!allowedCommands.includes(command.toLowerCase())) {
      reject(new Error(`Command "${command}" is not allowed for security reasons.`));
      return;
    }
    
    exec(command, { timeout: 10000 }, (error, stdout, stderr) => {
      if (error) {
        console.error(`Command error: ${error.message}`);
        reject(new Error(`Command failed: ${error.message}`));
        return;
      }
      
      if (stderr) {
        console.warn(`Command stderr: ${stderr}`);
        resolve(`Warning: ${stderr}\n${stdout}`);
        return;
      }
      
      console.log(`Command stdout: ${stdout}`);
      resolve(stdout);
    });
  });
});

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});