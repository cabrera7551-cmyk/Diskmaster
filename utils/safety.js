/**
 * Validaciones de seguridad antes de mover o modificar archivos.
 */

const fs = require('fs');
const path = require('path');
const { runPowerShell } = require('./powershell');

const PROTECTED_PATHS = [
  'windows',
  'system32',
  'syswow64',
  'program files',
  'program files (x86)',
  'programdata',
  'programdata\\microsoft\\windows',
  'drivers',
  '$recycle.bin',
  'recovery',
  'boot',
  'system volume information',
  'system32\\config',
  'system32\\logfiles',
  'windows\\temp',
  'windows\\minidump',
  'windows\\prefetch',
  'windows\\installer',
  'windows\\winsxs',
  'windows\\servicing'
];

const PROTECTED_USER_FOLDERS = [
  'appdata\\local\\packages',
  'appdata\\local\\microsoft',
  'appdata\\roaming\\microsoft',
  'appdata\\local\\temp',
  'appdata\\local\\temporary internet files'
];

const LINUX_NON_DESTINATION = ['/', '/boot', '/boot/efi', '/home', '/swap', '[swap]'];

function normalizeForCompare(p) {
  return path.normalize(p).toLowerCase().replace(/\//g, '\\');
}

function isProtectedPath(targetPath) {
  const normalized = normalizeForCompare(targetPath);
  const parts = normalized.split('\\').filter(Boolean);

  for (const protectedPart of PROTECTED_PATHS) {
    if (normalized.includes(protectedPart)) return true;
  }

  for (const uf of PROTECTED_USER_FOLDERS) {
    if (normalized.includes(uf)) return true;
  }

  // Raíz del sistema
  if (/^[a-z]:\\windows/i.test(normalized)) return true;

  return false;
}

function getDriveRoot(targetPath) {
  if (!targetPath) return '';
  if (process.platform === 'win32') {
    const match = String(targetPath).match(/^[a-zA-Z]:/);
    return match ? `${match[0].toUpperCase()}:` : path.parse(targetPath).root;
  }
  return path.parse(targetPath).root || targetPath;
}

function isSystemDestination(destPath, disks = []) {
  if (!destPath) return true;

  const normalized = normalizeForCompare(destPath);
  const root = normalizeForCompare(getDriveRoot(destPath));

  if (LINUX_NON_DESTINATION.some((p) => normalized === normalizeForCompare(p) || root === normalizeForCompare(p))) {
    return true;
  }

  if (/^[a-z]:\\windows/i.test(normalized)) return true;

  const matchingDisk = disks.find((d) => {
    const letter = normalizeForCompare(String(d.letter || ''));
    return letter && (root === letter || root.startsWith(letter));
  });

  if (matchingDisk && (matchingDisk.isSystem || matchingDisk.isBoot)) {
    return true;
  }

  if (process.platform === 'win32') {
    const systemDrive = (process.env.SystemDrive || 'C:').toUpperCase();
    if (root.toUpperCase() === systemDrive) return true;
  }

  return false;
}

function validateDestination(destPath, disks = [], requiredBytes = 0) {
  const errors = [];

  if (!destPath || !String(destPath).trim()) {
    errors.push('Debe seleccionar una unidad o carpeta de destino.');
    return { valid: false, errors };
  }

  if (isSystemDestination(destPath, disks)) {
    errors.push('No se puede usar la unidad del sistema como destino.');
  }

  if (isProtectedPath(destPath)) {
    errors.push('La ruta de destino está protegida por el sistema.');
  }

  const driveRoot = getDriveRoot(destPath);
  const pathToCheck = pathExists(destPath) ? destPath : driveRoot;

  if (!pathExists(pathToCheck)) {
    errors.push(`La unidad de destino no existe o no está accesible: ${driveRoot || destPath}`);
  }

  return { valid: errors.length === 0, errors };
}

async function hasEnoughSpace(destPath, requiredBytes, marginPercent = 5) {
  try {
    if (process.platform === 'win32') {
      // Validación real de espacio en Windows usando PowerShell
      const driveLetter = path.parse(destPath).root;
      const driveName = driveLetter.replace(':','').replace('\\','');
      const escaped = driveName.replace(/'/g, "''");
      const script = `
        $ErrorActionPreference = 'Stop'
        try {
          $drive = Get-PSDrive -Name '${escaped}' -ErrorAction Stop
          if ($drive) {
            $free = [int64]$drive.Free
            $required = [int64]${requiredBytes} * (1 + ${marginPercent} / 100)
            $ok = $free -ge $required
            @{
              ok = $ok
              available = $free
              required = [int64]${requiredBytes}
              margin = ${marginPercent}
              requiredWithMargin = $required
            } | ConvertTo-Json
          } else {
            @{ ok = $false; error = 'Unidad no encontrada' } | ConvertTo-Json
          }
        } catch {
          @{ ok = $false; error = $_.Exception.Message } | ConvertTo-Json
        }
      `;
      const result = await runPowerShell(script);
      if (result.success && result.stdout) {
        try {
          const data = JSON.parse(result.stdout);
          return data;
        } catch {
          return { ok: false, error: 'Error al parsear respuesta de espacio' };
        }
      }
      return { ok: false, error: 'No se pudo verificar espacio en destino' };
    }
    
    const stats = fs.statfsSync ? fs.statfsSync(destPath) : null;
    if (!stats) return { ok: true, available: null, required: requiredBytes };
    const available = stats.bfree * stats.bsize;
    const required = requiredBytes * (1 + marginPercent / 100);
    return {
      ok: available >= required,
      available,
      required: requiredBytes,
      margin: marginPercent,
      requiredWithMargin: required
    };
  } catch (err) {
    return { ok: false, error: `No se pudo verificar espacio en destino: ${err.message}` };
  }
}

function pathExists(p) {
  try {
    fs.accessSync(p, fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function isSameOrParent(parent, child) {
  const p = normalizeForCompare(parent);
  const c = normalizeForCompare(child);
  return c === p || c.startsWith(p + '\\');
}

function validateMoveOperation(source, destination, sizeBytes) {
  const errors = [];

  if (!source || !destination) {
    errors.push('Origen o destino no definidos');
    return { valid: false, errors };
  }

  if (isProtectedPath(source)) {
    errors.push(`Ruta protegida del sistema: ${source}`);
  }

  if (isSameOrParent(source, destination)) {
    errors.push('El destino no puede estar dentro del origen');
  }

  if (isSameOrParent(destination, source)) {
    errors.push('El origen no puede estar dentro del destino');
  }

  if (!pathExists(source)) {
    errors.push(`Origen no existe: ${source}`);
  }

  // Validación síncrona básica (sin verificar espacio real)
  return { valid: errors.length === 0, errors, space: null };
}

async function validateMoveOperationAsync(source, destination, sizeBytes) {
  const errors = [];

  if (!source || !destination) {
    errors.push('Origen o destino no definidos');
    return { valid: false, errors, space: null };
  }

  if (isProtectedPath(source)) {
    errors.push(`Ruta protegida del sistema: ${source}`);
  }

  if (isSameOrParent(source, destination)) {
    errors.push('El destino no puede estar dentro del origen');
  }

  if (isSameOrParent(destination, source)) {
    errors.push('El origen no puede estar dentro del destino');
  }

  if (!pathExists(source)) {
    errors.push(`Origen no existe: ${source}`);
  }

  // Validación asíncrona de espacio
  const space = await hasEnoughSpace(getDriveRoot(destination) || destination, sizeBytes);
  if (space.ok === false) {
    if (space.error) {
      errors.push(space.error);
    } else {
      errors.push(`Espacio insuficiente en destino. Necesario: ${space.required || sizeBytes} bytes, disponible: ${space.available ?? 0} bytes`);
    }
  }

  return { valid: errors.length === 0, errors, space };
}

module.exports = {
  isProtectedPath,
  isSystemDestination,
  validateDestination,
  getDriveRoot,
  hasEnoughSpace,
  pathExists,
  validateMoveOperation,
  validateMoveOperationAsync,
  PROTECTED_PATHS
};
