/**
 * Redirección de carpetas personales de Windows (Known Folders).
 */

const { runPowerShellJson, runPowerShell, sanitizePowerShellString } = require('../utils/powershell');
const { getUserProfile, USER_FOLDERS } = require('../services/analysisService');
const path = require('path');
const fs = require('fs');

// Almacenamiento de backups en memoria
const registryBackups = new Map();

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
      registryBackups.set(folderKey, backup);
      return backup;
    } catch {
      return null;
    }
  }
  return null;
}

async function restoreRegistryValue(folderKey) {
  if (process.platform !== 'win32') return { success: false, error: 'Solo disponible en Windows' };

  const backup = registryBackups.get(folderKey);
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
    return { success: true, folderKey, restoredValue: backup.originalValue };
  }

  return { success: false, error: result.stderr || 'Error al restaurar valor del registro' };
}

async function redirectFolder(folderKey, newPath, options = {}) {
  const { simulation = false, moveContents = true } = options;

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

  const escaped = sanitizePowerShellString(newPath);
  const escapedCurrent = sanitizePowerShellString(currentPath);
  
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
        backupCreated: true,
        verificationPassed: true
      };
    } else {
      // Si la verificación falla, restaurar el backup
      await restoreRegistryValue(folderKey);
      return { 
        success: false, 
        error: 'La redirección no se verificó correctamente - se restauró el valor original', 
        rollbackAttempted: true,
        verification 
      };
    }
  }

  // Si falla, intentar restaurar el backup
  await restoreRegistryValue(folderKey);
  return { success: false, error: result.stderr || 'Error al redirigir carpeta', rollbackAttempted: true };
}

async function verifyFolderRedirect(folderKey, expectedPath) {
  const locations = await getCurrentFolderLocations();
  const current = locations.find((l) => l.key === folderKey);
  const match = current?.current?.toLowerCase() === expectedPath.toLowerCase();
  return { verified: match, current: current?.current, expected: expectedPath };
}

module.exports = {
  FOLDER_REGISTRY_MAP,
  getCurrentFolderLocations,
  redirectFolder,
  verifyFolderRedirect,
  backupRegistryValue,
  restoreRegistryValue
};
