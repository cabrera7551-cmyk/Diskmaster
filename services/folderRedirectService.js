/**
 * Redirección de carpetas personales de Windows (Known Folders).
 */

const { runPowerShellJson, runPowerShell, sanitizePowerShellString } = require('../utils/powershell');
const { getUserProfile, USER_FOLDERS } = require('../services/analysisService');
const { BackupManager } = require('../utils/backupManager');
const { executeMovePlan, getDirectorySize } = require('../services/moveService');
const { hasEnoughSpace } = require('../utils/safety');
const { formatBytes } = require('../utils/format');
const path = require('path');
const fs = require('fs');

// Almacenamiento de backups en memoria (para compatibilidad, ahora respaldado por disco)
const registryBackups = new Map();

// Inicializar gestor de backups
let backupManager = null;

function getBackupManager() {
  if (!backupManager) {
    const app = require('electron').app || { getPath: () => require('os').tmpdir() };
    const userData = app.getPath('userData');
    const backupDir = path.join(userData, 'backups', 'folder_redirects');
    backupManager = new BackupManager(backupDir);
    // Cargar backups existentes al iniciar
    backupManager.loadAllBackups();
  }
  return backupManager;
}

const FOLDER_REGISTRY_MAP = {
  downloads: '{374DE290-123F-4565-9164-39C4925E467B}',
  documents: '{FDD39AD0-238F-46AF-ADB4-6C85480369C7}',
  pictures: '{33E28130-4E1E-4676-8357-9865C3A594C7}',
  videos: '{18989B1D-99B5-455B-843C-ABE7E44393E8}',
  music: '{4BD8D571-6D19-48D8-9746-34914C5C83B4}',
  desktop: '{B4BFCC3A-DB2C-424C-B029-7FE99A87C641}'
};

async function getCurrentFolderLocations() {
  if (process.platform !== 'win32') {
    return USER_FOLDERS.map((f) => ({
      key: f.key,
      label: f.label,
      current: path.join(getUserProfile(), f.names[0]),
      isDefault: true
    }));
  }

  const script = `
    $folders = @(
      @{ key = 'downloads'; guid = '{374DE290-123F-4565-9164-39C4925E467B}'; label = 'Descargas' },
      @{ key = 'documents'; guid = '{FDD39AD0-238F-46AF-ADB4-6C85480369C7}'; label = 'Documentos' },
      @{ key = 'pictures'; guid = '{33E28130-4E1E-4676-8357-9865C3A594C7}'; label = 'Imágenes' },
      @{ key = 'videos'; guid = '{18989B1D-99B5-455B-843C-ABE7E44393E8}'; label = 'Videos' },
      @{ key = 'music'; guid = '{4BD8D571-6D19-48D8-9746-34914C5C83B4}'; label = 'Música' },
      @{ key = 'desktop'; guid = '{B4BFCC3A-DB2C-424C-B029-7FE99A87C641}'; label = 'Escritorio' }
    )
    $results = foreach ($f in $folders) {
      $shell = New-Object -ComObject Shell.Application
      $folder = $shell.NameSpace($f.guid).Self
      [PSCustomObject]@{
        key = $f.key
        label = $f.label
        current = $folder.Path
        isDefault = $true
      }
    }
    @($results) | ConvertTo-Json
  `;

  const result = await runPowerShellJson(script);
  if (result.success && result.data) {
    return Array.isArray(result.data) ? result.data : [result.data];
  }

  return USER_FOLDERS.map((f) => ({
    key: f.key,
    label: f.label,
    current: path.join(getUserProfile(), f.names[0]),
    isDefault: true
  }));
}

async function backupRegistryValue(folderKey) {
  if (process.platform !== 'win32') return null;

  const guid = FOLDER_REGISTRY_MAP[folderKey];
  if (!guid) return null;

  const script = `
    $regPath = "HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\User Shell Folders"
    $value = Get-ItemProperty -Path $regPath -Name '${guid}' -ErrorAction SilentlyContinue
    if ($value) {
      @{
        folderKey = '${folderKey}'
        guid = '${guid}'
        originalValue = $value.'${guid}'
        timestamp = (Get-Date).ToString('o')
      } | ConvertTo-Json
    } else {
      $null
    }
  `;

  const result = await runPowerShell(script);
  if (result.success && result.stdout && result.stdout !== 'null') {
    try {
      const backup = JSON.parse(result.stdout);
      
      // Guardar en memoria (compatibilidad)
      registryBackups.set(folderKey, backup);
      
      // Guardar en disco con BackupManager
      const manager = getBackupManager();
      const saveResult = manager.saveBackup('folder_redirect', folderKey, backup);
      
      if (saveResult.success) {
        backup.backupId = saveResult.backupId;
        backup.persisted = true;
      }
      
      return backup;
    } catch {
      return null;
    }
  }
  return null;
}

async function restoreRegistryValue(folderKey) {
  if (process.platform !== 'win32') return { success: false, error: 'Solo disponible en Windows' };

  let backup = registryBackups.get(folderKey);
  
  // Si no está en memoria, intentar cargar desde disco
  if (!backup) {
    const manager = getBackupManager();
    const latestBackup = manager.getLatestBackup('folder_redirect', folderKey);
    if (latestBackup) {
      backup = latestBackup.data;
      // Restaurar en memoria para accesos futuros
      registryBackups.set(folderKey, backup);
    }
  }
  
  if (!backup) {
    return { success: false, error: 'No hay backup disponible para esta carpeta' };
  }

  const script = `
    $regPath = "HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\User Shell Folders"
    Set-ItemProperty -Path $regPath -Name '${backup.guid}' -Value '${backup.originalValue}' -Type ExpandString
    $regPath2 = "HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Shell Folders"
    if (Test-Path $regPath2) {
      Set-ItemProperty -Path $regPath2 -Name '${backup.guid}' -Value '${backup.originalValue}'
    }
    # Notificar al shell
    Add-Type @"
    using System;
    using System.Runtime.InteropServices;
    public class ShellNotify {
      [DllImport("shell32.dll")] public static extern void SHChangeNotify(int eventId, int flags, IntPtr item1, IntPtr item2);
    }
"@
    [ShellNotify]::SHChangeNotify(0x8000000, 0x1000, [IntPtr]::Zero, [IntPtr]::Zero)
    @{ success = $true } | ConvertTo-Json
  `;

  const result = await runPowerShellJson(script);
  if (result.success && result.data?.success) {
    return { success: true, folderKey, restoredValue: backup.originalValue, backupId: backup.backupId };
  }

  return { success: false, error: result.stderr || 'Error al restaurar valor del registro' };
}

async function redirectFolder(folderKey, newPath, options = {}) {
  const { simulation = false, moveContents = true, onProgress } = options;

  if (process.platform !== 'win32') {
    return {
      success: simulation,
      simulated: simulation,
      message: 'Redirección de carpetas solo disponible en Windows',
      folderKey,
      newPath
    };
  }

  const guid = FOLDER_REGISTRY_MAP[folderKey];
  if (!guid) {
    return { success: false, error: `Carpeta desconocida: ${folderKey}` };
  }

  if (simulation) {
    const locations = await getCurrentFolderLocations();
    const current = locations.find((l) => l.key === folderKey);
    return {
      success: true,
      simulated: true,
      folderKey,
      currentPath: current?.current,
      newPath,
      message: `[SIMULACIÓN] Cambiaría ${current?.current} → ${newPath}`
    };
  }

  // Obtener la ruta actual antes de modificar
  const locations = await getCurrentFolderLocations();
  const current = locations.find((l) => l.key === folderKey);
  const currentPath = current?.current;

  if (!currentPath) {
    return { success: false, error: 'No se pudo determinar la ruta actual de la carpeta' };
  }

  // Verificar que la ruta actual existe
  if (!fs.existsSync(currentPath)) {
    return { success: false, error: `La ruta actual no existe: ${currentPath}` };
  }

  // Crear backup antes de modificar
  const backup = await backupRegistryValue(folderKey);
  if (!backup) {
    return { success: false, error: 'No se pudo crear backup del registro' };
  }

  // Variables para seguimiento del movimiento
  let moveResults = null;
  let filesMoved = 0;
  let sizeMoved = 0;

  // FASE 1: Mover archivos si moveContents=true
  if (moveContents) {
    try {
      // Calcular tamaño de la carpeta actual
      if (onProgress) onProgress({ phase: 'calculate_size', message: 'Calculando tamaño de carpeta...' });
      const folderSize = await getDirectorySize(currentPath);
      
      if (onProgress) onProgress({ phase: 'validate_space', message: 'Validando espacio en destino...' });
      
      // Validar espacio en destino
      const spaceCheck = await hasEnoughSpace(newPath, folderSize, 10); // 10% de margen
      if (!spaceCheck.ok) {
        return {
          success: false,
          error: `Espacio insuficiente en destino. Necesario: ${formatBytes(spaceCheck.requiredWithMargin || spaceCheck.required)}, Disponible: ${formatBytes(spaceCheck.available)}`,
          spaceValidationFailed: true,
          backupCreated: true
        };
      }

      // Preparar item para moveService
      const moveItem = {
        id: folderKey,
        name: folderKey,
        path: currentPath,
        sizeBytes: folderSize,
        sizeFormatted: formatBytes(folderSize),
        category: folderKey,
        customDest: newPath
      };

      // Mover archivos usando executeMovePlan
      if (onProgress) onProgress({ phase: 'move_files', message: 'Moviendo archivos...' });
      
      moveResults = await executeMovePlan([moveItem], newPath, {
        simulation: false,
        onProgress: (p) => onProgress?.({ ...p, phase: 'move_files' })
      });

      if (moveResults.errors.length > 0) {
        // Rollback: mover archivos de vuelta
        if (onProgress) onProgress({ phase: 'rollback_move', message: 'Rollback: moviendo archivos de vuelta...' });
        
        const rollbackMove = await executeMovePlan(
          [{ path: newPath, customDest: currentPath, sizeBytes: folderSize }],
          currentPath,
          { simulation: false }
        );

        return {
          success: false,
          error: `Error al mover archivos: ${moveResults.errors[0].error}`,
          moveErrors: moveResults.errors,
          rollbackAttempted: true,
          rollbackSuccess: rollbackMove.errors.length === 0,
          backupCreated: true
        };
      }

      // Verificar que los archivos llegaron al destino
      if (onProgress) onProgress({ phase: 'verify_move', message: 'Verificando movimiento...' });
      
      const verification = await verifyMoveResult(currentPath, newPath, folderSize);
      if (!verification.allFilesPresent) {
        // Rollback: mover archivos de vuelta
        if (onProgress) onProgress({ phase: 'rollback_move', message: 'Rollback: moviendo archivos de vuelta...' });
        
        const rollbackMove = await executeMovePlan(
          [{ path: newPath, customDest: currentPath, sizeBytes: folderSize }],
          currentPath,
          { simulation: false }
        );

        return {
          success: false,
          error: 'Verificación de movimiento falló - archivos restaurados',
          verificationFailed: true,
          verification,
          rollbackAttempted: true,
          rollbackSuccess: rollbackMove.errors.length === 0,
          backupCreated: true
        };
      }

      filesMoved = moveResults.processed;
      sizeMoved = moveResults.totalBytes;

    } catch (err) {
      // Rollback en caso de error durante el movimiento
      try {
        if (onProgress) onProgress({ phase: 'rollback_move', message: 'Rollback: moviendo archivos de vuelta...' });
        
        const rollbackMove = await executeMovePlan(
          [{ path: newPath, customDest: currentPath }],
          currentPath,
          { simulation: false }
        );

        return {
          success: false,
          error: `Error durante movimiento: ${err.message}`,
          rollbackAttempted: true,
          rollbackSuccess: rollbackMove.errors.length === 0,
          backupCreated: true
        };
      } catch (rollbackErr) {
        return {
          success: false,
          error: `Error crítico: ${err.message}. Rollback falló: ${rollbackErr.message}`,
          rollbackAttempted: true,
          rollbackSuccess: false,
          backupCreated: true
        };
      }
    }
  }

  // FASE 2: Modificar el registro de Windows (solo después de mover archivos exitosamente)
  const escaped = sanitizePowerShellString(newPath);
  const escapedCurrent = sanitizePowerShellString(currentPath);
  
  if (onProgress) onProgress({ phase: 'update_registry', message: 'Actualizando registro de Windows...' });
  
  const script = `
    $guid = '${guid}'
    $newPath = '${escaped}'
    $currentPath = '${escapedCurrent}'
    
    # Crear directorio de destino si no existe
    if (-not (Test-Path $newPath)) { 
      New-Item -ItemType Directory -Path $newPath -Force | Out-Null 
    }
    
    # Verificar que el destino existe
    if (-not (Test-Path $newPath)) {
      throw 'No se pudo crear el directorio de destino'
    }
    
    # Modificar el registro
    $regPath = "HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\User Shell Folders"
    Set-ItemProperty -Path $regPath -Name $guid -Value $newPath -Type ExpandString -ErrorAction Stop
    
    $regPath2 = "HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Shell Folders"
    if (Test-Path $regPath2) {
      Set-ItemProperty -Path $regPath2 -Name $guid -Value $newPath -ErrorAction Stop
    }
    
    # Notificar al shell
    Add-Type @"
    using System;
    using System.Runtime.InteropServices;
    public class ShellNotify {
      [DllImport("shell32.dll")] public static extern void SHChangeNotify(int eventId, int flags, IntPtr item1, IntPtr item2);
    }
"@
    [ShellNotify]::SHChangeNotify(0x8000000, 0x1000, [IntPtr]::Zero, [IntPtr]::Zero)
    
    @{ success = $true; path = $newPath; previousPath = $currentPath } | ConvertTo-Json
  `;

  const result = await runPowerShellJson(script);
  if (result.success && result.data?.success) {
    // Verificar que el cambio se aplicó correctamente
    const verification = await verifyFolderRedirect(folderKey, newPath);
    if (verification.verified) {
      return { 
        success: true, 
        folderKey, 
        newPath, 
        previousPath: currentPath,
        moveContents, 
        filesMoved,
        sizeMoved,
        sizeMovedFormatted: formatBytes(sizeMoved),
        backupCreated: true,
        verificationPassed: true,
        moveResults
      };
    } else {
      // Si la verificación falla, restaurar el backup del registro
      // Y también rollback del movimiento si se movieron archivos
      if (onProgress) onProgress({ phase: 'rollback_all', message: 'Rollback completo: registro y archivos...' });
      
      await restoreRegistryValue(folderKey);
      
      if (moveContents && moveResults) {
        const rollbackMove = await executeMovePlan(
          [{ path: newPath, customDest: currentPath, sizeBytes: sizeMoved }],
          currentPath,
          { simulation: false }
        );
      }
      
      return { 
        success: false, 
        error: 'La redirección no se verificó correctamente - se restauró el valor original', 
        rollbackAttempted: true,
        rollbackMoveSuccess: !moveContents || (moveResults && moveResults.errors.length === 0),
        verification 
      };
    }
  }

  // Si falla la modificación del registro, hacer rollback del movimiento
  if (onProgress) onProgress({ phase: 'rollback_move', message: 'Rollback: moviendo archivos de vuelta por fallo de registro...' });
  
  if (moveContents && moveResults) {
    const rollbackMove = await executeMovePlan(
      [{ path: newPath, customDest: currentPath, sizeBytes: sizeMoved }],
      currentPath,
      { simulation: false }
    );
  }
  
  // Restaurar el backup del registro
  await restoreRegistryValue(folderKey);
  
  return { 
    success: false, 
    error: result.stderr || 'Error al redirigir carpeta', 
    rollbackAttempted: true,
    rollbackMoveSuccess: !moveContents || (moveResults && moveResults.errors.length === 0)
  };
}

async function verifyFolderRedirect(folderKey, expectedPath) {
  const locations = await getCurrentFolderLocations();
  const current = locations.find((l) => l.key === folderKey);
  const match = current?.current?.toLowerCase() === expectedPath.toLowerCase();
  return { verified: match, current: current?.current, expected: expectedPath };
}

/**
 * Verifica que el movimiento de archivos se completó correctamente
 */
async function verifyMoveResult(sourcePath, destPath, expectedSize) {
  try {
    // Verificar que el destino existe
    if (!fs.existsSync(destPath)) {
      return { allFilesPresent: false, reason: 'Destino no existe' };
    }

    // Verificar que el origen ya no tiene archivos (opcional, puede fallar si hay archivos bloqueados)
    const sourceExists = fs.existsSync(sourcePath);
    let sourceFiles = 0;
    if (sourceExists) {
      try {
        sourceFiles = fs.readdirSync(sourcePath).length;
      } catch {
        // No se puede leer el origen, puede estar bloqueado
      }
    }

    // Verificar que el destino tiene archivos
    let destFiles = 0;
    try {
      destFiles = fs.readdirSync(destPath).length;
    } catch {
      return { allFilesPresent: false, reason: 'No se puede leer el destino' };
    }

    if (destFiles === 0) {
      return { allFilesPresent: false, reason: 'Destino está vacío' };
    }

    // Verificar tamaño del destino (si se proporcionó tamaño esperado)
    if (expectedSize > 0) {
      const destSize = await getDirectorySize(destPath);
      // Permitir una pequeña variación (+/- 5%) por archivos de sistema ocultos
      const sizeDiff = Math.abs(destSize - expectedSize);
      const allowedDiff = expectedSize * 0.05;
      
      if (sizeDiff > allowedDiff) {
        return { 
          allFilesPresent: false, 
          reason: `Tamaño del destino no coincide. Esperado: ${formatBytes(expectedSize)}, Actual: ${formatBytes(destSize)}`,
          expectedSize,
          actualSize: destSize
        };
      }
    }

    return {
      allFilesPresent: true,
      sourceFiles,
      destFiles,
      sourceStillHasFiles: sourceFiles > 0
    };
  } catch (err) {
    return { allFilesPresent: false, reason: `Error en verificación: ${err.message}` };
  }
}

module.exports = {
  FOLDER_REGISTRY_MAP,
  getCurrentFolderLocations,
  redirectFolder,
  verifyFolderRedirect,
  verifyMoveResult,
  backupRegistryValue,
  restoreRegistryValue,
  getBackupManager,
  // Funciones adicionales para gestión de backups
  getBackupStats: () => getBackupManager().getStats(),
  listBackups: (type, key) => getBackupManager().listBackups(type, key),
  deleteBackup: (backupId) => getBackupManager().deleteBackup(backupId),
  clearAllBackups: () => getBackupManager().clearAllBackups()
};
