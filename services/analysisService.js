/**
 * Análisis de carpetas de usuario y archivos grandes.
 */

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');
const os = require('os');
const { runPowerShellJson, sanitizePowerShellString } = require('../utils/powershell');
const { formatBytes } = require('../utils/format');

const execFileAsync = promisify(execFile);

const USER_FOLDERS = [
  { key: 'downloads', names: ['Downloads', 'Descargas'], label: 'Descargas' },
  { key: 'documents', names: ['Documents', 'Documentos'], label: 'Documentos' },
  { key: 'pictures', names: ['Pictures', 'Imágenes', 'Imagenes'], label: 'Imágenes' },
  { key: 'videos', names: ['Videos', 'Vídeos'], label: 'Videos' },
  { key: 'music', names: ['Music', 'Música', 'Musica'], label: 'Música' },
  { key: 'desktop', names: ['Desktop', 'Escritorio'], label: 'Escritorio' }
];

const PROGRAM_INDICATORS = [
  'program files',
  'program files (x86)',
  'appdata\\local\\programs',
  'autodesk',
  'microsoft office'
];

function getUserProfile() {
  return process.env.USERPROFILE || process.env.HOME || os.homedir();
}

function resolveUserFolder(folderDef) {
  const profile = getUserProfile();
  for (const name of folderDef.names) {
    const p = path.join(profile, name);
    if (fs.existsSync(p)) return p;
  }
  return path.join(profile, folderDef.names[0]);
}

async function getFolderSizeWindows(folderPath) {
  const escaped = sanitizePowerShellString(folderPath);
  const script = `
    $path = '${escaped}'
    if (Test-Path $path) {
      $size = (Get-ChildItem -Path $path -Recurse -Force -ErrorAction SilentlyContinue | Measure-Object -Property Length -Sum -ErrorAction SilentlyContinue).Sum
      if ($null -eq $size) { $size = 0 }
      @{ path = $path; sizeBytes = [int64]$size } | ConvertTo-Json
    } else {
      @{ path = $path; sizeBytes = 0 } | ConvertTo-Json
    }
  `;
  const result = await runPowerShellJson(script, 300000);
  if (result.success && result.data) {
    return result.data.sizeBytes || 0;
  }
  return getFolderSizeNode(folderPath, 3);
}

function getFolderSizeNode(folderPath, maxDepth = 2, currentDepth = 0) {
  if (!fs.existsSync(folderPath)) return 0;
  let total = 0;

  try {
    const entries = fs.readdirSync(folderPath, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(folderPath, entry.name);
      try {
        if (entry.isFile()) {
          total += fs.statSync(fullPath).size;
        } else if (entry.isDirectory() && currentDepth < maxDepth) {
          total += getFolderSizeNode(fullPath, maxDepth, currentDepth + 1);
        }
      } catch (err) {
        // Archivo bloqueado o sin permisos - continuar silenciosamente
      }
    }
  } catch (err) {
    // Sin permisos - continuar silenciosamente
  }
  return total;
}

async function getFolderSize(folderPath) {
  if (process.platform === 'win32') {
    return getFolderSizeWindows(folderPath);
  }
  try {
    const { stdout } = await execFileAsync('du', ['-sb', folderPath], { encoding: 'utf8', timeout: 120000 });
    return parseInt(stdout.split('\t')[0], 10) || 0;
  } catch {
    return getFolderSizeNode(folderPath, 4);
  }
}

async function analyzeUserFolders(onProgress) {
  const items = [];
  let totalMovable = 0;

  for (const folder of USER_FOLDERS) {
    const folderPath = resolveUserFolder(folder);
    if (onProgress) onProgress(`Analizando ${folder.label}...`);

    const sizeBytes = await getFolderSize(folderPath);
    if (sizeBytes > 0) {
      items.push({
        id: folder.key,
        name: folder.label,
        path: folderPath,
        sizeBytes,
        sizeFormatted: formatBytes(sizeBytes),
        type: 'personal',
        category: folder.key
      });
      totalMovable += sizeBytes;
    }
  }

  return { items, totalMovable };
}

async function findLargeFiles(rootPath, minSizeBytes = 500 * 1024 * 1024, limit = 20) {
  if (process.platform === 'win32') {
    const escaped = sanitizePowerShellString(rootPath);
    const script = `
      $min = ${minSizeBytes}
      $files = Get-ChildItem -Path '${escaped}' -Recurse -Force -File -ErrorAction SilentlyContinue |
        Where-Object { $_.Length -ge $min } |
        Sort-Object Length -Descending |
        Select-Object -First ${limit} |
        ForEach-Object {
          @{ name = $_.Name; path = $_.FullName; sizeBytes = [int64]$_.Length; extension = $_.Extension }
        }
      @($files) | ConvertTo-Json
    `;
    const result = await runPowerShellJson(script, 300000);
    if (result.success && result.data) {
      const files = Array.isArray(result.data) ? result.data : (result.data ? [result.data] : []);
      return files.map((f) => ({
        ...f,
        sizeFormatted: formatBytes(f.sizeBytes),
        type: 'file'
      }));
    }
  }

  return findLargeFilesNode(rootPath, minSizeBytes, limit);
}

function findLargeFilesNode(rootPath, minSize, limit, results = []) {
  if (!fs.existsSync(rootPath) || results.length >= limit) return results;

  try {
    const entries = fs.readdirSync(rootPath, { withFileTypes: true });
    for (const entry of entries) {
      if (results.length >= limit) break;
      const fullPath = path.join(rootPath, entry.name);
      try {
        if (entry.isFile()) {
          const stat = fs.statSync(fullPath);
          if (stat.size >= minSize) {
            results.push({
              name: entry.name,
              path: fullPath,
              sizeBytes: stat.size,
              sizeFormatted: formatBytes(stat.size),
              extension: path.extname(entry.name),
              type: 'file'
            });
          }
        } else if (entry.isDirectory() && !entry.name.startsWith('.')) {
          findLargeFilesNode(fullPath, minSize, limit, results);
        }
      } catch {
        // ignorar
      }
    }
  } catch {
    // ignorar
  }

  return results.sort((a, b) => b.sizeBytes - a.sizeBytes).slice(0, limit);
}

async function detectInstalledPrograms() {
  if (process.platform !== 'win32') {
    return [];
  }

  const script = `
    $paths = @(
      "${process.env.ProgramFiles || 'C:\\Program Files'}",
      "${process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)'}"
    )
    $programs = foreach ($base in $paths) {
      if (Test-Path $base) {
        Get-ChildItem $base -Directory -ErrorAction SilentlyContinue | ForEach-Object {
          $size = (Get-ChildItem $_.FullName -Recurse -Force -ErrorAction SilentlyContinue | Measure-Object -Property Length -Sum -ErrorAction SilentlyContinue).Sum
          if ($size -gt 100MB) {
            [PSCustomObject]@{
              name = $_.Name
              path = $_.FullName
              sizeBytes = [int64]($size ?? 0)
            }
          }
        }
      }
    }
    @($programs) | Sort-Object sizeBytes -Descending | Select-Object -First 15 | ConvertTo-Json
  `;

  const result = await runPowerShellJson(script, 180000);
  if (result.success && result.data) {
    const progs = Array.isArray(result.data) ? result.data : [result.data];
    return progs.map((p) => ({
      name: p.name,
      path: p.path,
      sizeBytes: p.sizeBytes || 0,
      sizeFormatted: formatBytes(p.sizeBytes || 0),
      type: 'program'
    }));
  }
  return [];
}

function isProgramPath(p) {
  const lower = p.toLowerCase();
  return PROGRAM_INDICATORS.some((ind) => lower.includes(ind));
}

module.exports = {
  USER_FOLDERS,
  getUserProfile,
  resolveUserFolder,
  analyzeUserFolders,
  findLargeFiles,
  detectInstalledPrograms,
  getFolderSize,
  isProgramPath
};
