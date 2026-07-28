/**
 * Detección de proyectos de ingeniería (AutoCAD, Civil 3D, Revit, etc.)
 */

const fs = require('fs');
const path = require('path');
const { runPowerShellJson } = require('../utils/powershell');
const { formatBytes } = require('../utils/format');
const { getUserProfile } = require('../services/analysisService');

const ENGINEERING_EXTENSIONS = [
  '.dwg', '.dxf', '.dwt', '.rvt', '.rfa', '.ifc', '.landxml',
  '.pdf', '.xlsx', '.docx', '.skp', '.shp', '.gdb'
];

const ENGINEERING_KEYWORDS = [
  'autocad', 'civil 3d', 'civil3d', 'autodesk', 'revit', 'sketchup',
  'arcgis', 'qgis', 'proyecto', 'planos', 'render', 'lands'
];

const SEARCH_ROOTS = [];

async function getSearchRoots() {
  const profile = getUserProfile();
  const roots = [
    profile,
    path.join(profile, 'Documents'),
    path.join(profile, 'Documentos'),
    path.join(profile, 'Desktop'),
    path.join(profile, 'Escritorio')
  ];

  // Agregar dinámicamente las unidades disponibles en Windows
  if (process.platform === 'win32') {
    try {
      const { runPowerShellJson } = require('../utils/powershell');
      const script = `
        Get-PSDrive -PSProvider FileSystem | 
          Where-Object { $_.Name -ne 'C' -and $_.Used -gt 0 } | 
          Select-Object -ExpandProperty Root
      `;
      const result = await runPowerShellJson(script);
      if (result.success && result.data) {
        const drives = Array.isArray(result.data) ? result.data : [result.data];
        drives.forEach(drive => {
          if (drive && typeof drive === 'string') {
            roots.push(drive);
          }
        });
      }
    } catch {
      // Si falla la detección, no agregar unidades adicionales
    }
  }

  return [...new Set(roots.filter((r) => {
    try { return fs.existsSync(r); } catch { return false; }
  }))];
}

async function scanEngineeringProjects(onProgress) {
  const projects = [];
  const roots = await getSearchRoots();

  if (process.platform === 'win32') {
    return scanEngineeringWindows(onProgress);
  }

  for (const root of roots) {
    if (onProgress) onProgress(`Buscando proyectos en ${root}...`);
    scanDirectory(root, projects, 0, 4);
  }

  return groupProjects(projects);
}

async function scanEngineeringWindows(onProgress) {
  const extArray = ['.dwg', '.dxf', '.dwt', '.rvt', '.rfa', '.ifc', '.landxml', '.pdf', '.xlsx', '.docx', '.skp', '.shp', '.gdb'];
  const extsString = extArray.map(e => `'${e}'`).join(', ');
  
  // Obtener unidades de búsqueda dinámicamente
  const roots = await getSearchRoots();
  const rootsString = roots.map(r => `'${r.replace(/'/g, "''")}'`).join(', ');
  
  const script = `
    $roots = @(${rootsString})
    $exts = @(${extsString})
    $results = @()
    foreach ($root in $roots) {
      if (-not (Test-Path $root)) { continue }
      Get-ChildItem -Path $root -Recurse -Force -File -ErrorAction SilentlyContinue |
        Where-Object { $exts -contains $_.Extension.ToLower() } |
        Select-Object -First 500 |
        ForEach-Object {
          $results += [PSCustomObject]@{
            name = $_.Name
            path = $_.FullName
            sizeBytes = [int64]$_.Length
            extension = $_.Extension
            folder = Split-Path $_.FullName -Parent
          }
        }
    }
    $results | ConvertTo-Json
  `;

  if (onProgress) onProgress('Escaneando archivos de ingeniería...');
  const result = await runPowerShellJson(script, 300000);

  if (result.success && result.data) {
    const files = Array.isArray(result.data) ? result.data : [result.data];
    return groupProjects(files.filter(Boolean));
  }

  const projects = [];
  for (const root of roots) {
    scanDirectory(root, projects, 0, 3);
  }
  return groupProjects(projects);
}

function scanDirectory(dir, results, depth, maxDepth) {
  if (depth > maxDepth || !fs.existsSync(dir)) return;

  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      const nameLower = entry.name.toLowerCase();

      if (entry.isDirectory()) {
        const isProjectFolder = ENGINEERING_KEYWORDS.some((k) => nameLower.includes(k));
        if (isProjectFolder || depth < 2) {
          scanDirectory(fullPath, results, depth + 1, maxDepth);
        }
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (ENGINEERING_EXTENSIONS.includes(ext)) {
          try {
            const stat = fs.statSync(fullPath);
            results.push({
              name: entry.name,
              path: fullPath,
              folder: dir,
              sizeBytes: stat.size,
              extension: ext
            });
          } catch {
            // archivo bloqueado
          }
        }
      }
    }
  } catch {
    // sin permisos
  }
}

function groupProjects(files) {
  const groups = new Map();

  for (const file of files) {
    const folder = file.folder || path.dirname(file.path);
    const folderName = path.basename(folder);
    const key = folder;

    if (!groups.has(key)) {
      groups.set(key, {
        id: `eng_${groups.size}`,
        name: folderName,
        path: folder,
        files: [],
        sizeBytes: 0,
        type: 'engineering'
      });
    }

    const group = groups.get(key);
    group.files.push(file);
    group.sizeBytes += file.sizeBytes || 0;
  }

  return [...groups.values()]
    .filter((g) => g.sizeBytes > 10 * 1024 * 1024)
    .map((g) => ({
      ...g,
      sizeFormatted: formatBytes(g.sizeBytes),
      fileCount: g.files.length
    }))
    .sort((a, b) => b.sizeBytes - a.sizeBytes);
}

module.exports = { scanEngineeringProjects, ENGINEERING_EXTENSIONS, ENGINEERING_KEYWORDS };
