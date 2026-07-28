/**
 * Proceso principal de Electron — DISKMASTER
 */

const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');

const { detectDisks, classifyDisks, getAvailableDestinations, getRecommendedDestination } = require('../services/diskService');
const { analyzeUserFolders, findLargeFiles, detectInstalledPrograms } = require('../services/analysisService');
const { buildRecommendations, estimateMovableSpace } = require('../modules/recommendations');
const { scanEngineeringProjects } = require('../services/engineeringService');
const { executeMovePlan, ensureDirectory } = require('../services/moveService');
const { getCurrentFolderLocations, redirectFolder } = require('../services/folderRedirectService');
const { detectBrowsers, setBrowserDownloadPath } = require('../services/browserConfigService');
const { buildSimulationPreview } = require('../modules/simulation');
const { runFullVerification } = require('../modules/verification');
const { buildReportData, generateTextReport, generateHtmlReport, saveReport } = require('../reports/reportGenerator');
const { ActivityLogger } = require('../utils/logger');
const { formatBytes } = require('../utils/format');
const { validateDestination, isSystemDestination } = require('../utils/safety');

let mainWindow = null;
let logger = null;
let sessionState = {
  disks: null,
  classification: null,
  recommendations: [],
  engineeringProjects: [],
  browsers: [],
  folderLocations: [],
  simulationMode: false
};

function getPortableDir() {
  return path.join(app.getPath('userData'), 'logs');
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 860,
    minWidth: 960,
    minHeight: 700,
    backgroundColor: '#0d1117',
    title: 'DISKMASTER_v1',
    icon: path.join(__dirname, '../assets/icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    },
    autoHideMenuBar: true,
    show: false
  });

  mainWindow.loadFile(path.join(__dirname, '../ui/index.html'));

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    logger.log('Sistema listo. Esperando órdenes...');
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function sendLog(entry) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('log-entry', entry);
  }
}

function registerIpcHandlers() {
  ipcMain.handle('get-initial-state', () => ({
    simulationMode: sessionState.simulationMode,
    platform: process.platform
  }));

  ipcMain.handle('toggle-simulation', (_, enabled) => {
    sessionState.simulationMode = !!enabled;
    logger.logWarning(`Modo simulación: ${enabled ? 'ACTIVADO' : 'DESACTIVADO'}`);
    return sessionState.simulationMode;
  });

  ipcMain.handle('analyze-system', async () => {
    logger.log('Analizando unidades...');

    const disks = await detectDisks();
    sessionState.disks = disks;
    sessionState.classification = classifyDisks(disks);

    for (const disk of disks) {
      logger.log(`${disk.mediaType} detectado: ${disk.letter} — ${formatBytes(disk.usedBytes)} usados / ${formatBytes(disk.freeBytes)} libres`);
    }

    logger.log('Analizando carpetas de usuario...');
    const { items: userItems, totalMovable } = await analyzeUserFolders((msg) => {
      sendProgress('analysis', msg);
    });

    logger.log('Detectando programas instalados...');
    const programs = await detectInstalledPrograms();

    logger.log('Buscando archivos grandes...');
    const profile = process.env.USERPROFILE || process.env.HOME || '';
    const largeFiles = profile ? await findLargeFiles(profile, 500 * 1024 * 1024, 10) : [];

    logger.log('Escaneando proyectos de ingeniería...');
    sessionState.engineeringProjects = await scanEngineeringProjects((msg) => sendProgress('engineering', msg));

    const allItems = [
      ...userItems,
      ...programs.map((p) => ({ ...p, category: 'program' })),
      ...sessionState.engineeringProjects,
      ...largeFiles.map((f) => ({ ...f, name: f.name, category: 'file' }))
    ];

    sessionState.recommendations = buildRecommendations(allItems, {
      ssd: sessionState.classification.ssd,
      hdd: sessionState.classification.hdd
    });

    const movable = estimateMovableSpace(sessionState.recommendations);
    logger.log(`Se detectaron ${formatBytes(movable)} movibles al HDD`);

    sessionState.folderLocations = await getCurrentFolderLocations();
    sessionState.browsers = await detectBrowsers();

    const availableDestinations = getAvailableDestinations(disks);
    const recommendedDestination = getRecommendedDestination(disks);

    if (!recommendedDestination) {
      logger.logWarning('No se detectó unidad secundaria válida para destino');
    }

    return {
      disks,
      classification: sessionState.classification,
      recommendations: sessionState.recommendations,
      engineeringProjects: sessionState.engineeringProjects,
      folderLocations: sessionState.folderLocations,
      browsers: sessionState.browsers,
      availableDestinations,
      recommendedDestination,
      totalMovable: movable,
      totalMovableFormatted: formatBytes(movable)
    };
  });

  ipcMain.handle('get-folder-locations', async () => {
    sessionState.folderLocations = await getCurrentFolderLocations();
    return sessionState.folderLocations;
  });

  ipcMain.handle('get-browsers', async () => {
    sessionState.browsers = await detectBrowsers();
    return sessionState.browsers;
  });

  ipcMain.handle('get-available-destinations', async () => {
    if (!sessionState.disks) {
      const disks = await detectDisks();
      sessionState.disks = disks;
    }
    return getAvailableDestinations(sessionState.disks);
  });

  ipcMain.handle('set-browser-download', async (_, { browserId, newPath }) => {
    if (sessionState.simulationMode) {
      logger.log(`[SIMULACIÓN] Configuraría descargas de ${browserId} → ${newPath}`);
      return { success: true, simulated: true };
    }
    const result = await setBrowserDownloadPath(browserId, newPath);
    if (result.success) logger.log(`Descargas de ${browserId} configuradas → ${newPath}`);
    else logger.log(`No se pudo configurar ${browserId}: ${result.error || result.instructions}`, 'warn');
    return result;
  });

  ipcMain.handle('build-preview', async (_, plan) => {
    logger.log('Preparando vista previa...');

    const selectedItems = sessionState.recommendations.filter((r) =>
      plan.selectedIds?.includes(r.id || r.key || r.name)
    );

    const destBase = plan.destBase || null;

    if (!destBase) {
      logger.log('ADVERTENCIA: No se especificó destino para la operación', 'warn');
      return {
        error: 'No se especificó destino. Seleccione una unidad de destino válida.',
        actions: [],
        summary: { destBase: null, spaceToFreeFormatted: '0 B' },
        risks: ['DEBE SELECCIONAR UN DESTINO ANTES DE CONTINUAR.']
      };
    }

    const destValidation = validateDestination(destBase, sessionState.disks || []);
    if (!destValidation.valid) {
      logger.log(`Destino inválido: ${destValidation.errors.join('; ')}`, 'warn');
      return {
        error: destValidation.errors.join('; '),
        actions: [],
        summary: { destBase, spaceToFreeFormatted: '0 B' },
        risks: destValidation.errors
      };
    }

    if (isSystemDestination(destBase, sessionState.disks || [])) {
      return {
        error: 'No se puede usar la unidad del sistema como destino.',
        actions: [],
        summary: { destBase, spaceToFreeFormatted: '0 B' },
        risks: ['La unidad seleccionada es la unidad del sistema — seleccione otra.']
      };
    }

    const preview = buildSimulationPreview({
      selectedItems,
      folderRedirects: plan.folderRedirects || [],
      destBase,
      disks: {
        ssd: sessionState.classification?.ssd,
        hdd: sessionState.classification?.hdd,
        ssdBefore: sessionState.classification?.ssd?.usedBytes,
        hddBefore: sessionState.classification?.hdd?.usedBytes
      }
    });

    return preview;
  });

  ipcMain.handle('execute-plan', async (_, plan) => {
    const startTime = Date.now();
    logger.log(sessionState.simulationMode ? 'Ejecutando simulación...' : 'Ejecutando acciones...');

    const selectedItems = sessionState.recommendations.filter((r) =>
      plan.selectedIds?.includes(r.id || r.key || r.name)
    );

    const destBase = plan.destBase || null;

    if (!destBase) {
      logger.log('ERROR: No se especificó destino para la operación', 'error');
      return {
        success: false,
        error: 'No se especificó destino para la operación. Por favor seleccione una unidad de destino válida.',
        simulation: sessionState.simulationMode
      };
    }

    const destValidation = validateDestination(destBase, sessionState.disks || []);
    if (!destValidation.valid) {
      logger.log(`ERROR: ${destValidation.errors.join('; ')}`, 'error');
      return {
        success: false,
        error: destValidation.errors.join('; '),
        simulation: sessionState.simulationMode
      };
    }

    if (isSystemDestination(destBase, sessionState.disks || [])) {
      return {
        success: false,
        error: 'No se puede usar la unidad del sistema como destino.',
        simulation: sessionState.simulationMode
      };
    }

    const steps = [
      { id: 'analyze', label: 'Analizando...', status: 'completed' },
      { id: 'prepare', label: 'Preparando carpetas...', status: 'pending' },
      { id: 'move', label: 'Moviendo archivos...', status: 'pending' },
      { id: 'redirect', label: 'Actualizando rutas...', status: 'pending' },
      { id: 'verify', label: 'Verificando...', status: 'pending' }
    ];

    const sendStep = (stepId, status, detail) => {
      const step = steps.find((s) => s.id === stepId);
      if (step) step.status = status;
      sendProgress('execution', { steps, currentStep: stepId, detail });
    };

    // Preparar carpetas
    sendStep('prepare', 'running');
    if (!sessionState.simulationMode) {
      ensureDirectory(destBase);
    }
    sendStep('prepare', 'completed');

    // Mover archivos
    sendStep('move', 'running');
    const moveResults = await executeMovePlan(selectedItems, destBase, {
      simulation: sessionState.simulationMode,
      onProgress: (p) => sendProgress('move-progress', p)
    });
    sendStep('move', moveResults.errors.length ? 'warning' : 'completed');

    // Redirigir carpetas
    sendStep('redirect', 'running');
    const redirectResults = [];
    for (const redirect of plan.folderRedirects || []) {
      const result = await redirectFolder(redirect.key || redirect.folderKey, redirect.newPath, {
        simulation: sessionState.simulationMode,
        moveContents: true,
        onProgress: (p) => sendProgress('redirect-progress', p)
      });
      redirectResults.push({ ...redirect, result });
      if (result.success) {
        logger.log(`Ruta de ${redirect.label || redirect.key} actualizada → ${redirect.newPath}`);
        if (result.filesMoved) {
          logger.log(`Archivos movidos: ${result.filesMoved} (${result.sizeMovedFormatted})`);
        }
      } else if (result.rollbackAttempted) {
        logger.logError(`Redirección fallida, rollback realizado: ${result.error}`);
      }
    }
    sendStep('redirect', 'completed');

    // Verificar
    sendStep('verify', 'running');
    const verification = sessionState.simulationMode
      ? { allPassed: true, simulated: true }
      : await runFullVerification(moveResults, redirectResults);
    sendStep('verify', verification.allPassed ? 'completed' : 'warning');

    const preview = buildSimulationPreview({
      selectedItems,
      folderRedirects: plan.folderRedirects || [],
      destBase,
      disks: {
        ssd: sessionState.classification?.ssd,
        hdd: sessionState.classification?.hdd
      }
    });

    const errors = moveResults.errors.map((e) => e.result?.error || e.error || 'Error desconocido');
    const endTime = Date.now();

    const reportData = buildReportData({
      disks: {
        ssd: sessionState.classification?.ssd,
        hdd: sessionState.classification?.hdd,
        ssdBeforeFormatted: formatBytes(sessionState.classification?.ssd?.usedBytes),
        hddBeforeFormatted: formatBytes(sessionState.classification?.hdd?.usedBytes),
        ssdAfter: preview.summary.ssdAfter,
        hddAfter: preview.summary.hddAfter
      },
      preview,
      moveResults,
      verification,
      errors,
      startTime,
      endTime
    });

    logger.log('Operación completada.');

    return {
      success: errors.length === 0,
      simulation: sessionState.simulationMode,
      moveResults,
      redirectResults,
      verification,
      preview,
      report: reportData,
      steps
    };
  });

  ipcMain.handle('export-report', async (_, { reportData, format }) => {
    const defaultDir = path.join(app.getPath('documents'), 'DiskMaster Reports');
    const filters = format === 'html'
      ? [{ name: 'HTML', extensions: ['html'] }]
      : [{ name: 'Texto', extensions: ['txt'] }];

    const { filePath, canceled } = await dialog.showSaveDialog(mainWindow, {
      defaultPath: path.join(defaultDir, `DiskMaster_Report.${format}`),
      filters
    });

    if (canceled || !filePath) return { success: false, canceled: true };

    const content = format === 'html'
      ? generateHtmlReport(reportData)
      : generateTextReport(reportData);

    fs.writeFileSync(filePath, content, 'utf8');
    logger.log(`Reporte exportado: ${filePath}`);
    return { success: true, path: filePath };
  });

  ipcMain.handle('select-folder', async () => {
    const { filePaths, canceled } = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory', 'createDirectory']
    });
    if (canceled || !filePaths.length) return null;
    return filePaths[0];
  });
}

function sendProgress(channel, data) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('progress', { channel, data });
  }
}

app.whenReady().then(() => {
  logger = new ActivityLogger(getPortableDir());
  logger.onEntry(sendLog);
  registerIpcHandlers();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  // No dejar procesos en segundo plano — portable
});
