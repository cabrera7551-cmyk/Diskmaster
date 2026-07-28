/**
 * Configuración de ubicación de descargas en navegadores.
 */

const fs = require('fs');
const path = require('path');
const { runPowerShellJson } = require('../utils/powershell');

// Almacenamiento de backups en memoria
const browserBackups = new Map();

const BROWSER_PATHS = {
  chrome: {
    name: 'Google Chrome',
    prefsPath: 'AppData\\Local\\Google\\Chrome\\User Data\\Default\\Preferences',
    key: 'download.default_directory'
  },
  edge: {
    name: 'Microsoft Edge',
    prefsPath: 'AppData\\Local\\Microsoft\\Edge\\User Data\\Default\\Preferences',
    key: 'download.default_directory'
  },
  firefox: {
    name: 'Mozilla Firefox',
    profilesIni: 'AppData\\Roaming\\Mozilla\\Firefox\\profiles.ini'
  }
};

async function detectBrowsers() {
  const profile = process.env.USERPROFILE || process.env.HOME || '';
  const browsers = [];

  for (const [id, config] of Object.entries(BROWSER_PATHS)) {
    if (id === 'firefox') {
      const iniPath = path.join(profile, config.profilesIni);
      if (fs.existsSync(iniPath)) {
        browsers.push({
          id,
          name: config.name,
          installed: true,
          currentDownloadPath: await getFirefoxDownloadPath(iniPath),
          canAutoConfigure: false,
          instructions: 'Abrir Firefox → Configuración → General → Descargas → Elegir carpeta'
        });
      }
      continue;
    }

    const prefsPath = path.join(profile, config.prefsPath);
    if (fs.existsSync(prefsPath)) {
      let currentPath = 'Desconocida';
      try {
        const prefs = JSON.parse(fs.readFileSync(prefsPath, 'utf8'));
        currentPath = prefs?.download?.default_directory || currentPath;
      } catch { /* ignore */ }

      browsers.push({
        id,
        name: config.name,
        installed: true,
        prefsPath,
        currentDownloadPath: currentPath,
        canAutoConfigure: true,
        instructions: null
      });
    }
  }

  return browsers;
}

async function getFirefoxDownloadPath(profilesIni) {
  try {
    const content = fs.readFileSync(profilesIni, 'utf8');
    const match = content.match(/Path=([^\n\r]+)/);
    if (!match) return 'Desconocida';
    const profilePath = path.join(path.dirname(profilesIni), match[1].replace(/\//g, path.sep));
    const prefsFile = path.join(profilePath, 'prefs.js');
    if (!fs.existsSync(prefsFile)) return 'Predeterminada del sistema';
    const prefs = fs.readFileSync(prefsFile, 'utf8');
    const dlMatch = prefs.match(/browser\.download\.dir","([^"]+)"/);
    return dlMatch ? dlMatch[1] : 'Predeterminada del sistema';
  } catch {
    return 'Desconocida';
  }
}

function createBackup(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    
    const content = fs.readFileSync(filePath, 'utf8');
    const backup = {
      originalPath: filePath,
      content: content,
      timestamp: new Date().toISOString(),
      size: Buffer.byteLength(content, 'utf8')
    };
    
    const backupKey = `${filePath}_${backup.timestamp}`;
    browserBackups.set(backupKey, backup);
    
    return backupKey;
  } catch {
    return null;
  }
}

function restoreBackup(backupKey) {
  try {
    const backup = browserBackups.get(backupKey);
    if (!backup) return { success: false, error: 'Backup no encontrado' };
    
    fs.writeFileSync(backup.originalPath, backup.content, 'utf8');
    return { success: true, restoredPath: backup.originalPath };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

async function setBrowserDownloadPath(browserId, newPath) {
  const profile = process.env.USERPROFILE || '';
  const config = BROWSER_PATHS[browserId];

  if (!config || browserId === 'firefox') {
    return {
      success: false,
      manual: true,
      instructions: config?.instructions || 'Configurar manualmente en el navegador'
    };
  }

  const prefsPath = path.join(profile, config.prefsPath);
  if (!fs.existsSync(prefsPath)) {
    return { success: false, error: 'Navegador no encontrado' };
  }

  // Crear backup antes de modificar
  const backupKey = createBackup(prefsPath);
  if (!backupKey) {
    return { success: false, error: 'No se pudo crear backup del archivo de configuración' };
  }

  try {
    const content = fs.readFileSync(prefsPath, 'utf8');
    let prefs;
    
    // Intentar hacer parsing con manejo robusto de errores
    try {
      prefs = JSON.parse(content);
    } catch (parseErr) {
      // Si el JSON está malformado, intentar repararlo básicamente
      try {
        // Intentar evaluar de forma segura (solo para JSON de Chrome/Edge)
        const sanitized = content.replace(/,\s*([}\]])/g, '$1').replace(/([}\]])(\s*)/g, '$1');
        prefs = JSON.parse(sanitized);
      } catch {
        return { 
          success: false, 
          error: 'El archivo de configuración está corrupto o en formato desconocido', 
          rollbackAttempted: true 
        };
      }
    }
    
    // Validar estructura básica
    if (typeof prefs !== 'object' || prefs === null) {
      throw new Error('Estructura de configuración inválida');
    }
    
    // Crear objeto download si no existe
    if (!prefs.download) {
      prefs.download = {};
    }
    
    // Validar que download sea un objeto
    if (typeof prefs.download !== 'object' || prefs.download === null) {
      prefs.download = {};
    }
    
    // Establecer la nueva ruta
    prefs.download.default_directory = newPath.replace(/\//g, '\\');
    
    // Escribir de forma segura
    fs.writeFileSync(prefsPath, JSON.stringify(prefs, null, 2), 'utf8');
    
    return { 
      success: true, 
      browserId, 
      newPath, 
      backupKey, 
      note: 'Reinicie el navegador para aplicar cambios' 
    };
  } catch (err) {
    // Si falla, intentar restaurar el backup
    restoreBackup(backupKey);
    return { 
      success: false, 
      error: `Error al modificar configuración: ${err.message}`, 
      rollbackAttempted: true 
    };
  }
}

module.exports = { 
  detectBrowsers, 
  setBrowserDownloadPath, 
  BROWSER_PATHS,
  createBackup,
  restoreBackup
};
