/**
 * Movimiento seguro de archivos y carpetas.
 */

const fs = require('fs');
const path = require('path');
const { runPowerShell, sanitizePowerShellString } = require('../utils/powershell');
const { validateMoveOperationAsync, pathExists } = require('../utils/safety');
const { sanitizePath } = require('../utils/format');

const DEFAULT_STRUCTURE = {
  documents: 'Documentos',
  downloads: 'Descargas',
  pictures: 'Imágenes',
  videos: 'Videos',
  music: 'Música',
  desktop: 'Escritorio',
  projects: 'Proyectos',
  engineering: 'Proyectos'
};

function buildDestinationPath(baseDest, item) {
  const base = sanitizePath(baseDest);
  const category = item.category || item.id || 'Otros';
  const subFolder = DEFAULT_STRUCTURE[category] || item.name || 'Otros';
  return path.join(base, subFolder);
}

function ensureDirectory(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

async function isFileLocked(filePath) {
  if (process.platform === 'win32') {
    const escaped = filePath.replace(/'/g, "''");
    const script = `
      try {
        $f = [System.IO.File]::Open('${escaped}', 'Open', 'Read', 'None')
        $f.Close()
        'false'
      } catch { 'true' }
    `;
    const result = await runPowerShell(script);
    return result.stdout === 'true';
  }

  try {
    const fd = fs.openSync(filePath, 'r+');
    fs.closeSync(fd);
    return false;
  } catch {
    return true;
  }
}

async function moveItem(source, destination, options = {}) {
  const { simulation = false, onProgress } = options;

  if (!pathExists(source)) {
    return { success: false, error: `Origen no existe: ${source}` };
  }

  if (await isFileLocked(source)) {
    return { success: false, error: `Archivo en uso o bloqueado: ${source}`, locked: true };
  }

  let sizeBytes = 0;
  try {
    const stat = fs.statSync(source);
    sizeBytes = stat.isDirectory() ? await getDirectorySize(source) : stat.size;
  } catch {
    sizeBytes = 0;
  }

  // Validación asíncrona con verificación de espacio real
  const validation = await validateMoveOperationAsync(source, destination, sizeBytes);
  if (!validation.valid) {
    return { success: false, error: validation.errors.join('; '), errors: validation.errors };
  }

  if (simulation) {
    return {
      success: true,
      simulated: true,
      source,
      destination,
      sizeBytes,
      message: `[SIMULACIÓN] Movería ${source} → ${destination}`
    };
  }

  try {
    ensureDirectory(path.dirname(destination));

    if (process.platform === 'win32') {
      const result = await moveItemWindowsSafe(source, destination, sizeBytes);
      if (!result.success) return result;
    } else {
      await copyItemNode(source, destination);
      if (!verifyCopy(source, destination, sizeBytes)) {
        return { success: false, error: 'Verificación de copia fallida — origen no eliminado', source, destination };
      }
      removeSourceSafe(source);
    }

    if (onProgress) onProgress({ source, destination, sizeBytes, status: 'completed' });
    return { success: true, source, destination, sizeBytes };
  } catch (err) {
    return { success: false, error: err.message, source, destination };
  }
}

async function moveItemWindowsSafe(source, destination, expectedSize) {
  const srcEsc = sanitizePowerShellString(source);
  const dstEsc = sanitizePowerShellString(destination);

  const script = `
    $ErrorActionPreference = 'Stop'
    $src = '${srcEsc}'
    $dst = '${dstEsc}'
    if (Test-Path $dst) { throw 'El destino ya existe' }
    $isDir = (Get-Item $src -Force).PSIsContainer
    if ($isDir) {
      Copy-Item -Path $src -Destination $dst -Recurse -Force -ErrorAction Stop
    } else {
      Copy-Item -Path $src -Destination $dst -Force -ErrorAction Stop
    }
    if (-not (Test-Path $dst)) { throw 'Copia fallida: destino no existe' }
    $srcSize = if ($isDir) {
      (Get-ChildItem -Path $src -Recurse -Force -ErrorAction SilentlyContinue | Measure-Object -Property Length -Sum).Sum
    } else {
      (Get-Item $src).Length
    }
    $dstSize = if ($isDir) {
      (Get-ChildItem -Path $dst -Recurse -Force -ErrorAction SilentlyContinue | Measure-Object -Property Length -Sum).Sum
    } else {
      (Get-Item $dst).Length
    }
    if ($null -eq $srcSize) { $srcSize = 0 }
    if ($null -eq $dstSize) { $dstSize = 0 }
    if ($dstSize -lt $srcSize) { throw "Verificación fallida: destino incompleto ($dstSize vs $srcSize bytes)" }
    if ($isDir) {
      Remove-Item -Path $src -Recurse -Force -ErrorAction Stop
    } else {
      Remove-Item -Path $src -Force -ErrorAction Stop
    }
    'OK'
  `;

  const result = await runPowerShell(script, 600000);
  if (result.stdout === 'OK') {
    return { success: true };
  }
  return { success: false, error: result.stderr || result.stdout || 'Error al mover de forma segura' };
}

function copyItemNode(source, destination) {
  const stat = fs.statSync(source);
  if (stat.isDirectory()) {
    fs.cpSync(source, destination, { recursive: true });
  } else {
    fs.copyFileSync(source, destination);
  }
}

function verifyCopy(source, destination, expectedSize) {
  if (!pathExists(destination)) return false;
  try {
    const srcStat = fs.statSync(source);
    const dstStat = fs.statSync(destination);
    if (srcStat.isFile()) {
      return dstStat.isFile() && dstStat.size === srcStat.size;
    }
    if (srcStat.isDirectory()) {
      return dstStat.isDirectory();
    }
  } catch {
    return false;
  }
  return expectedSize >= 0;
}

function removeSourceSafe(source) {
  const stat = fs.statSync(source);
  if (stat.isDirectory()) {
    fs.rmSync(source, { recursive: true, force: true });
  } else {
    fs.unlinkSync(source);
  }
}

async function getDirectorySize(dir) {
  if (process.platform === 'win32') {
    const escaped = sanitizePowerShellString(dir);
    const script = `
      $ErrorActionPreference = 'Stop'
      try {
        (Get-ChildItem -Path '${escaped}' -Recurse -Force -ErrorAction SilentlyContinue |
          Measure-Object -Property Length -Sum -ErrorAction SilentlyContinue).Sum
      } catch {
        0
      }
    `;
    const result = await runPowerShell(script, 300000);
    return parseInt(result.stdout, 10) || 0;
  }

  let total = 0;
  const walk = (d) => {
    try {
      for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, entry.name);
        if (entry.isFile()) total += fs.statSync(p).size;
        else if (entry.isDirectory()) walk(p);
      }
    } catch { /* ignore */ }
  };
  walk(dir);
  return total;
}

async function executeMovePlan(items, destBase, options = {}) {
  const results = [];
  let processed = 0;
  let totalBytes = 0;
  const total = items.length;

  // Calcular espacio total necesario antes de comenzar
  for (const item of items) {
    totalBytes += item.sizeBytes || 0;
  }

  // Validar espacio total en destino antes de comenzar
  if (!options.simulation && destBase) {
    const { hasEnoughSpace } = require('../utils/safety');
    const spaceCheck = await hasEnoughSpace(destBase, totalBytes, 10); // 10% de margen
    if (!spaceCheck.ok) {
      return {
        results: [],
        processed: 0,
        total,
        totalBytes: 0,
        errors: [{ error: `Espacio insuficiente en destino. Necesario: ${spaceCheck.requiredWithMargin || spaceCheck.required}, Disponible: ${spaceCheck.available}` }],
        spaceValidationFailed: true
      };
    }
  }

  for (const item of items) {
    const dest = item.customDest || buildDestinationPath(destBase, item);
    
    // Verificar espacio antes de cada movimiento individual
    if (!options.simulation) {
      const { hasEnoughSpace } = require('../utils/safety');
      const itemSpaceCheck = await hasEnoughSpace(path.dirname(dest) || destBase, item.sizeBytes || 0, 5);
      if (!itemSpaceCheck.ok) {
        results.push({ 
          item, 
          result: { 
            success: false, 
            error: `Espacio insuficiente para ${item.name}. Necesario: ${itemSpaceCheck.requiredWithMargin || itemSpaceCheck.required}, Disponible: ${itemSpaceCheck.available}` 
          }, 
          destination: dest 
        });
        continue;
      }
    }
    
    const result = await moveItem(item.path, dest, {
      ...options,
      onProgress: (p) => options.onProgress?.({ ...p, current: processed + 1, total, item })
    });

    results.push({ item, result, destination: dest });
    if (result.success) {
      processed++;
    }
  }

  return { results, processed, total, totalBytes, errors: results.filter((r) => !r.result.success) };
}

module.exports = {
  DEFAULT_STRUCTURE,
  buildDestinationPath,
  ensureDirectory,
  moveItem,
  executeMovePlan,
  isFileLocked
};
