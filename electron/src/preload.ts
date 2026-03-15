import { contextBridge, ipcRenderer } from 'electron';

/**
 * Preload script — exposes a minimal API to the renderer process.
 *
 * The renderer talks to the Go backend directly via HTTP/WebSocket,
 * so most functionality lives there. This bridge is reserved for
 * Electron-specific features (native notifications, IPC, etc.).
 */

contextBridge.exposeInMainWorld('electronAPI', {
  /** Get the backend base URL (http://localhost:8080) */
  getBackendUrl: (): Promise<string> => ipcRenderer.invoke('get-backend-url'),

  /** Get the WebSocket URL (ws://localhost:8080/ws) */
  getWsUrl: (): Promise<string> => ipcRenderer.invoke('get-ws-url'),

  /**
   * Listen for WebSocket events forwarded from the main process.
   * These are events the main process has already processed (e.g. shown
   * a notification) but the renderer may also want to react to.
   */
  onWsEvent: (callback: (event: { type: string; data: unknown }) => void): void => {
    ipcRenderer.on('ws-event', (_event, wsEvent) => callback(wsEvent));
  },

  /**
   * Listen for navigation requests (e.g. user clicked a notification
   * for a specific conversation).
   */
  onNavigateToConversation: (callback: (conversationId: string) => void): void => {
    ipcRenderer.on('navigate-to-conversation', (_event, conversationId) =>
      callback(conversationId),
    );
  },

  /** Open an image URL in the native Preview app (macOS) or default viewer */
  openImageInPreview: (imageUrl: string): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('open-image-in-preview', imageUrl),
});
