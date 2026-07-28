/**
 * Preload — puente seguro entre renderer e IPC.
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('diskMaster', {
  getInitialState: () => ipcRenderer.invoke('get-initial-state'),
  toggleSimulation: (enabled) => ipcRenderer.invoke('toggle-simulation', enabled),
  analyzeSystem: () => ipcRenderer.invoke('analyze-system'),
  getFolderLocations: () => ipcRenderer.invoke('get-folder-locations'),
  getBrowsers: () => ipcRenderer.invoke('get-browsers'),
  getAvailableDestinations: () => ipcRenderer.invoke('get-available-destinations'),
  setBrowserDownload: (browserId, newPath) => ipcRenderer.invoke('set-browser-download', { browserId, newPath }),
  buildPreview: (plan) => ipcRenderer.invoke('build-preview', plan),
  executePlan: (plan) => ipcRenderer.invoke('execute-plan', plan),
  exportReport: (reportData, format) => ipcRenderer.invoke('export-report', { reportData, format }),
  selectFolder: () => ipcRenderer.invoke('select-folder'),

  onLogEntry: (callback) => {
    const handler = (_, entry) => callback(entry);
    ipcRenderer.on('log-entry', handler);
    return () => ipcRenderer.removeListener('log-entry', handler);
  },

  onProgress: (callback) => {
    const handler = (_, payload) => callback(payload);
    ipcRenderer.on('progress', handler);
    return () => ipcRenderer.removeListener('progress', handler);
  }
});
