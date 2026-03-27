import {
  app,
  BrowserWindow,
  Menu,
  nativeImage,
  Notification,
  ipcMain,
  shell,
} from 'electron';
import { ChildProcess, spawn, execFile } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import * as http from 'http';
import * as https from 'https';
import WebSocket from 'ws';
import treekill from 'tree-kill';

// ─── Constants ───────────────────────────────────────────────────────────────

const BACKEND_PORT = 8080;
const BACKEND_URL = `http://localhost:${BACKEND_PORT}`;
const WS_URL = `ws://localhost:${BACKEND_PORT}/ws`;
const DEV_FRONTEND_URL = 'http://localhost:5173';
const STATUS_POLL_INTERVAL_MS = 500;
const STATUS_POLL_TIMEOUT_MS = 15_000;

const isDev = !app.isPackaged;

// ─── Build info ─────────────────────────────────────────────────────────────

interface BuildInfo {
  version: string;
  buildNumber: string;
  buildDate: string;
}

function loadBuildInfo(): BuildInfo {
  const pkg = JSON.parse(
    fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf-8'),
  );
  const defaultInfo: BuildInfo = {
    version: pkg.version ?? '0.0.0',
    buildNumber: 'dev',
    buildDate: new Date().toISOString(),
  };

  try {
    const buildInfoPath = isDev
      ? path.join(__dirname, '..', 'build-info.json')
      : path.join(process.resourcesPath, 'build-info.json');
    if (fs.existsSync(buildInfoPath)) {
      const raw = JSON.parse(fs.readFileSync(buildInfoPath, 'utf-8'));
      return {
        version: raw.version ?? defaultInfo.version,
        buildNumber: raw.buildNumber ?? defaultInfo.buildNumber,
        buildDate: raw.buildDate ?? defaultInfo.buildDate,
      };
    }
  } catch (err) {
    console.error('[electron] Failed to load build-info.json:', err);
  }
  return defaultInfo;
}

const buildInfo = loadBuildInfo();

// Set app name and dock icon for dev mode
app.setName('Cipher');
if (isDev && process.platform === 'darwin') {
  const iconPath = path.join(__dirname, '..', 'assets', 'icon.png');
  if (fs.existsSync(iconPath)) {
    app.dock?.setIcon(nativeImage.createFromPath(iconPath));
  }
}

// ─── Settings ────────────────────────────────────────────────────────────────

interface AppSettings {
  notificationSound: string; // sound name like "Glass", or "none" for silent
}

const DEFAULT_SETTINGS: AppSettings = {
  notificationSound: 'Glass',
};

let currentSettings: AppSettings = { ...DEFAULT_SETTINGS };

function loadSettings(): AppSettings {
  try {
    const settingsPath = path.join(getDataDir(), 'settings.json');
    if (fs.existsSync(settingsPath)) {
      const raw = fs.readFileSync(settingsPath, 'utf-8');
      const parsed = JSON.parse(raw);
      currentSettings = { ...DEFAULT_SETTINGS, ...parsed };
    } else {
      currentSettings = { ...DEFAULT_SETTINGS };
    }
  } catch (err) {
    console.error('[electron] Failed to load settings:', err);
    currentSettings = { ...DEFAULT_SETTINGS };
  }
  return currentSettings;
}

function saveSettings(settings: AppSettings): void {
  try {
    const dataDir = getDataDir();
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    const settingsPath = path.join(dataDir, 'settings.json');
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf-8');
  } catch (err) {
    console.error('[electron] Failed to save settings:', err);
  }
}

// ─── State ───────────────────────────────────────────────────────────────────

let mainWindow: BrowserWindow | null = null;
let backendProcess: ChildProcess | null = null;
let wsConnection: WebSocket | null = null;
let unreadCount = 0;
let isQuitting = false;
let weSpawnedBackend = false;

// ─── Single instance lock ────────────────────────────────────────────────────

const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (!mainWindow.isVisible()) mainWindow.show();
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

// ─── Backend management ──────────────────────────────────────────────────────

function getBackendBinaryPath(): string {
  if (isDev) {
    return path.join(__dirname, '..', '..', 'backend', 'backend');
  }
  return path.join(process.resourcesPath, 'backend');
}

function getFrontendDir(): string {
  return path.join(process.resourcesPath, 'frontend');
}

function getDataDir(): string {
  return path.join(app.getPath('userData'), 'cipher-data');
}

/**
 * Check whether the backend is already reachable (e.g. started manually in dev).
 */
function isBackendRunning(): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get(`${BACKEND_URL}/api/status`, (res) => {
      res.resume(); // drain
      resolve(res.statusCode !== undefined && res.statusCode < 500);
    });
    req.on('error', () => resolve(false));
    req.setTimeout(2000, () => {
      req.destroy();
      resolve(false);
    });
  });
}

async function spawnBackend(): Promise<void> {
  // In dev, check if the backend is already running (user started it manually).
  if (isDev) {
    const alreadyRunning = await isBackendRunning();
    if (alreadyRunning) {
      console.log('[electron] Backend already running on port', BACKEND_PORT);
      return;
    }
  }

  const binaryPath = getBackendBinaryPath();
  const dataDir = getDataDir();

  console.log('[electron] Spawning backend:', binaryPath);
  console.log('[electron] Data dir:', dataDir);

  const args = [
    '--port', String(BACKEND_PORT),
    '--data', dataDir,
  ];

  // In production, have the backend serve the frontend static files
  if (!isDev) {
    args.push('--frontend', getFrontendDir());
  }

  backendProcess = spawn(binaryPath, args, {
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  weSpawnedBackend = true;

  backendProcess.stdout?.on('data', (data: Buffer) => {
    process.stdout.write(`[backend] ${data.toString()}`);
  });

  backendProcess.stderr?.on('data', (data: Buffer) => {
    process.stderr.write(`[backend:err] ${data.toString()}`);
  });

  backendProcess.on('exit', (code, signal) => {
    console.log(`[electron] Backend exited with code=${code} signal=${signal}`);
    backendProcess = null;
    if (!isQuitting) {
      // Backend crashed unexpectedly — quit the app.
      console.error('[electron] Backend exited unexpectedly, quitting.');
      isQuitting = true;
      app.quit();
    }
  });
}

function waitForBackend(): Promise<void> {
  return new Promise((resolve, reject) => {
    const startTime = Date.now();

    const poll = () => {
      if (Date.now() - startTime > STATUS_POLL_TIMEOUT_MS) {
        reject(new Error('Backend did not start within timeout'));
        return;
      }

      const req = http.get(`${BACKEND_URL}/api/status`, (res) => {
        res.resume();
        if (res.statusCode !== undefined && res.statusCode < 500) {
          resolve();
        } else {
          setTimeout(poll, STATUS_POLL_INTERVAL_MS);
        }
      });
      req.on('error', () => {
        setTimeout(poll, STATUS_POLL_INTERVAL_MS);
      });
      req.setTimeout(2000, () => {
        req.destroy();
        setTimeout(poll, STATUS_POLL_INTERVAL_MS);
      });
    };

    poll();
  });
}

function killBackend(): Promise<void> {
  return new Promise((resolve) => {
    if (!backendProcess || !backendProcess.pid || !weSpawnedBackend) {
      resolve();
      return;
    }

    console.log('[electron] Killing backend process', backendProcess.pid);
    treekill(backendProcess.pid, 'SIGTERM', (err) => {
      if (err) {
        console.error('[electron] Error killing backend:', err);
      }
      backendProcess = null;
      resolve();
    });
  });
}

// ─── WebSocket ───────────────────────────────────────────────────────────────

interface WsEvent {
  type: string;
  data: Record<string, unknown>;
}

function connectWebSocket(): void {
  if (wsConnection) {
    wsConnection.close();
    wsConnection = null;
  }

  console.log('[electron] Connecting WebSocket to', WS_URL);
  wsConnection = new WebSocket(WS_URL);

  wsConnection.on('open', () => {
    console.log('[electron] WebSocket connected');
  });

  wsConnection.on('message', (raw: WebSocket.RawData) => {
    try {
      const event: WsEvent = JSON.parse(raw.toString());
      handleWsEvent(event);
    } catch (err) {
      console.error('[electron] Failed to parse WS message:', err);
    }
  });

  wsConnection.on('close', () => {
    console.log('[electron] WebSocket disconnected');
    if (!isQuitting) {
      // Reconnect after a delay
      setTimeout(connectWebSocket, 3000);
    }
  });

  wsConnection.on('error', (err: Error) => {
    console.error('[electron] WebSocket error:', err.message);
  });
}

function handleWsEvent(event: WsEvent): void {
  switch (event.type) {
    case 'new_message':
      handleNewMessage(event.data);
      break;
    case 'messages_refreshed':
      // Background refresh completed — forward for UI update, no notification
      mainWindow?.webContents.send('ws-event', event);
      break;
    case 'message_update':
      // Reaction/edit updates — forward to renderer only, no notification
      mainWindow?.webContents.send('ws-event', event);
      break;
    case 'phone_status':
      handlePhoneStatus(event.data);
      break;
    case 'conversation_update':
      // Forward to renderer for UI updates
      mainWindow?.webContents.send('ws-event', event);
      break;
    default:
      // Forward all events to renderer
      mainWindow?.webContents.send('ws-event', event);
      break;
  }
}

function handleNewMessage(data: Record<string, unknown>): void {
  const sender = data.sender as { name?: string; isMe?: boolean } | undefined;
  const text = data.text as string | undefined;
  const conversationId = data.conversationId as string | undefined;
  const conversationName = data.conversationName as string | undefined;
  const isGroup = data.isGroup as boolean | undefined;

  // Don't notify for our own messages
  if (sender?.isMe) return;

  // Update unread count
  const windowIsFocused = mainWindow?.isFocused() ?? false;
  if (!windowIsFocused) {
    unreadCount++;
    updateDockBadge();
  }

  // Format notification title: "Sender in Group Name" for group chats
  // Use conversationName as fallback for unknown contacts (empty name) in 1:1 chats
  let title = sender?.name || conversationName || 'New Message';
  if (isGroup && conversationName) {
    title = `${sender?.name || 'Someone'} in ${conversationName}`;
  }

  // Show native notification only when the window is not focused
  if (Notification.isSupported() && !windowIsFocused) {
    const notification = new Notification({
      title,
      body: text ?? '',
      silent: true,
    });

    notification.on('click', () => {
      if (mainWindow) {
        if (!mainWindow.isVisible()) mainWindow.show();
        mainWindow.focus();
        // Tell renderer to navigate to this conversation
        if (conversationId) {
          mainWindow.webContents.send('navigate-to-conversation', conversationId);
        }
      }
    });

    notification.show();

    // Play configured notification sound
    if (currentSettings.notificationSound && currentSettings.notificationSound !== 'none') {
      const soundPath = `/System/Library/Sounds/${currentSettings.notificationSound}.aiff`;
      execFile('afplay', [soundPath], (err) => {
        if (err) {
          console.error('[electron] Failed to play notification sound:', err.message);
        }
      });
    }
  }

  // Forward to renderer
  mainWindow?.webContents.send('ws-event', { type: 'new_message', data });
}

function handlePhoneStatus(data: Record<string, unknown>): void {
  const status = data.status as string | undefined;

  if (status === 'offline' && Notification.isSupported()) {
    const notification = new Notification({
      title: 'Phone Offline',
      body: 'Your phone appears to be offline. Messages may not sync.',
      silent: true,
    });
    notification.show();
  }

  mainWindow?.webContents.send('ws-event', { type: 'phone_status', data });
}

function updateDockBadge(): void {
  if (process.platform === 'darwin') {
    app.dock?.setBadge(unreadCount > 0 ? String(unreadCount) : '');
  }
}

// ─── Window ──────────────────────────────────────────────────────────────────

function createWindow(): void {
  const iconPath = isDev
    ? path.join(__dirname, '..', 'assets', 'icon.png')
    : path.join(process.resourcesPath, 'icon.png');

  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    titleBarStyle: 'hiddenInset',
    title: 'Cipher',
    icon: fs.existsSync(iconPath) ? iconPath : undefined,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Load content
  if (isDev) {
    mainWindow.loadURL(DEV_FRONTEND_URL);
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    mainWindow.loadURL(BACKEND_URL);
  }

  // Show when ready
  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
  });

  // Hide to dock instead of quitting
  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      mainWindow?.hide();
    }
  });

  // Reset unread count when window is focused
  mainWindow.on('focus', () => {
    unreadCount = 0;
    updateDockBadge();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Open external links in default browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

// ─── Menu ────────────────────────────────────────────────────────────────────

function buildMenu(): void {
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'pasteAndMatchStyle' },
        { role: 'delete' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        { type: 'separator' },
        { role: 'front' },
      ],
    },
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

// ─── IPC handlers ────────────────────────────────────────────────────────────

function setupIpcHandlers(): void {
  ipcMain.handle('get-backend-url', () => BACKEND_URL);
  ipcMain.handle('get-ws-url', () => WS_URL);

  ipcMain.handle('get-settings', () => currentSettings);

  ipcMain.handle('set-notification-sound', (_event, name: string) => {
    currentSettings.notificationSound = name;
    saveSettings(currentSettings);
    return currentSettings;
  });

  ipcMain.handle('preview-sound', (_event, name: string) => {
    if (!name || name === 'none') {
      return { success: true };
    }
    return new Promise<{ success: boolean; error?: string }>((resolve) => {
      const soundPath = `/System/Library/Sounds/${name}.aiff`;
      execFile('afplay', [soundPath], (err) => {
        if (err) {
          resolve({ success: false, error: err.message });
        } else {
          resolve({ success: true });
        }
      });
    });
  });

  ipcMain.handle('get-available-sounds', () => {
    try {
      const soundDir = '/System/Library/Sounds';
      const files = fs.readdirSync(soundDir);
      return files
        .filter((f) => f.endsWith('.aiff'))
        .map((f) => f.replace(/\.aiff$/, ''))
        .sort();
    } catch (err) {
      console.error('[electron] Failed to read system sounds:', err);
      return [];
    }
  });

  ipcMain.handle('open-external', (_event, url: string) => {
    shell.openExternal(url);
  });

  ipcMain.handle('google-sign-in', () => {
    return new Promise<{ cookies: Record<string, string> | null; cancelled?: boolean }>((resolve) => {
      const googleLoginURL =
        'https://accounts.google.com/AccountChooser?continue=https://messages.google.com/web/config';
      const requiredCookies = ['SID', 'HSID', 'SSID', 'APISID', 'SAPISID'];
      // OSID is set on messages.google.com and may arrive later than the others
      const messagesRequiredCookies = ['OSID'];
      // Additional cookies to capture if available
      const optionalCookies = ['__Secure-1PSIDTS', '__Secure-1PSID', '__Secure-3PSID', '__Secure-3PSIDTS'];

      const authWindow = new BrowserWindow({
        width: 500,
        height: 700,
        parent: mainWindow ?? undefined,
        modal: true,
        show: false,
        title: 'Sign in with Google',
        webPreferences: {
          partition: 'persist:google-auth',
          nodeIntegration: false,
          contextIsolation: true,
        },
      });

      authWindow.once('ready-to-show', () => authWindow.show());
      authWindow.loadURL(googleLoginURL);

      let resolved = false;
      let checkAttempts = 0;
      const maxCheckAttempts = 10;

      const checkCookies = async () => {
        if (resolved) return;
        checkAttempts++;
        const session = authWindow.webContents.session;

        // Get cookies from both google.com and messages.google.com domains
        const [googleCookies, messagesCookies] = await Promise.all([
          session.cookies.get({ domain: '.google.com' }),
          session.cookies.get({ domain: 'messages.google.com' }),
        ]);
        const allCookies = [...googleCookies, ...messagesCookies];

        const wantedNames = new Set([
          ...requiredCookies,
          ...messagesRequiredCookies,
          ...optionalCookies,
        ]);
        const cookieMap: Record<string, string> = {};
        for (const cookie of allCookies) {
          if (wantedNames.has(cookie.name)) {
            cookieMap[cookie.name] = cookie.value;
          }
        }

        const hasRequired = requiredCookies.every((name) => name in cookieMap);
        const hasMessagesCookies = messagesRequiredCookies.every((name) => name in cookieMap);

        if (hasRequired && hasMessagesCookies) {
          resolved = true;
          authWindow.close();
          console.log('[electron] Google sign-in: captured cookies:', Object.keys(cookieMap).join(', '));
          resolve({ cookies: cookieMap });
        } else if (hasRequired && checkAttempts < maxCheckAttempts) {
          // Have google.com cookies but still waiting for messages.google.com cookies — retry
          console.log(`[electron] Google sign-in: waiting for messages cookies (attempt ${checkAttempts}/${maxCheckAttempts})`);
          setTimeout(checkCookies, 1000);
        } else if (checkAttempts >= maxCheckAttempts && hasRequired) {
          // Give up waiting for OSID but proceed with what we have
          resolved = true;
          authWindow.close();
          console.log('[electron] Google sign-in: proceeding without OSID, cookies:', Object.keys(cookieMap).join(', '));
          resolve({ cookies: cookieMap });
        }
        // If we don't even have the google.com cookies yet, the next navigation event will re-trigger
      };

      authWindow.webContents.on('did-navigate', (_event, url) => {
        if (url.includes('messages.google.com')) {
          checkAttempts = 0; // Reset attempts on fresh navigation
          setTimeout(checkCookies, 1500);
        }
      });

      authWindow.webContents.on('did-navigate-in-page', (_event, url) => {
        if (url.includes('messages.google.com')) {
          setTimeout(checkCookies, 1500);
        }
      });

      // Also check when page finishes loading (catches redirects that don't trigger did-navigate)
      authWindow.webContents.on('did-finish-load', () => {
        const url = authWindow.webContents.getURL();
        if (url.includes('messages.google.com') && !resolved) {
          setTimeout(checkCookies, 1500);
        }
      });

      authWindow.on('closed', () => {
        if (!resolved) {
          resolve({ cookies: null, cancelled: true });
        }
      });
    });
  });

  ipcMain.handle('open-image-in-preview', async (_event, imageUrl: string) => {
    try {
      // Fetch the image from the backend
      const fullUrl = imageUrl.startsWith('/') ? `${BACKEND_URL}${imageUrl}` : imageUrl;
      const data = await new Promise<Buffer>((resolve, reject) => {
        const mod = fullUrl.startsWith('https') ? https : http;
        mod.get(fullUrl, (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer) => chunks.push(chunk));
          res.on('end', () => resolve(Buffer.concat(chunks)));
          res.on('error', reject);
        }).on('error', reject);
      });

      // Write to a temp file
      const tmpDir = app.getPath('temp');
      const ext = imageUrl.includes('heic') ? '.heic' : '.jpg';
      const tmpFile = path.join(tmpDir, `cipher-preview-${Date.now()}${ext}`);
      fs.writeFileSync(tmpFile, data);

      // Open in Preview (macOS)
      if (process.platform === 'darwin') {
        execFile('open', ['-a', 'Preview', tmpFile]);
      } else {
        shell.openPath(tmpFile);
      }

      return { success: true };
    } catch (err) {
      console.error('[electron] Failed to open image in preview:', err);
      return { success: false, error: String(err) };
    }
  });
}

// ─── App lifecycle ───────────────────────────────────────────────────────────

app.whenReady().then(async () => {
  // Configure "About Cipher" panel with version and build info
  app.setAboutPanelOptions({
    applicationName: 'Cipher',
    applicationVersion: `v${buildInfo.version}`,
    version: `Build ${buildInfo.buildNumber} (${buildInfo.buildDate})`,
    copyright: 'Desktop client for Google Messages',
  });

  buildMenu();
  setupIpcHandlers();

  loadSettings();

  try {
    await spawnBackend();
    await waitForBackend();
  } catch (err) {
    console.error('[electron] Failed to start backend:', err);
    app.quit();
    return;
  }

  createWindow();
  connectWebSocket();
});

app.on('activate', () => {
  // macOS: re-show window when dock icon is clicked
  if (mainWindow) {
    mainWindow.show();
    mainWindow.focus();
  } else {
    createWindow();
  }
});

app.on('before-quit', () => {
  isQuitting = true;
});

app.on('will-quit', async (event) => {
  if (weSpawnedBackend && backendProcess) {
    event.preventDefault();
    wsConnection?.close();
    wsConnection = null;
    await killBackend();
    app.quit();
  }
});

// Process signal handlers for clean shutdown
process.on('SIGTERM', () => {
  isQuitting = true;
  app.quit();
});

process.on('SIGINT', () => {
  isQuitting = true;
  app.quit();
});
