/**
 * Detección de discos físicos, particiones y tipos de almacenamiento.
 */

const { execFile } = require('child_process');
const { promisify } = require('util');
const os = require('os');
const { runPowerShellJson, sanitizePowerShellString } = require('../utils/powershell');
const { formatPercent } = require('../utils/format');

const execFileAsync = promisify(execFile);

const DISK_TYPE_MAP = {
  SSD: 'SSD',
  HDD: 'HDD',
  NVMe: 'NVMe',
  Unspecified: 'Desconocido',
  USB: 'USB',
  Removable: 'USB'
};

function getDiskStatus(percentUsed) {
  if (percentUsed >= 90) return { label: 'CRÍTICO', level: 'critical' };
  if (percentUsed >= 75) return { label: 'ALTO', level: 'warning' };
  if (percentUsed >= 50) return { label: 'MODERADO', level: 'moderate' };
  return { label: 'ESPACIO DISPONIBLE', level: 'ok' };
}

async function detectDisksWindows() {
  const script = `
    $disks = Get-CimInstance Win32_LogicalDisk -Filter "DriveType=3" | ForEach-Object {
      $letter = $_.DeviceID
      $part = $null
      $physical = $null
      $mediaType = 'Unspecified'
      $busType = ''
      $isBoot = $false
      $diskNumber = $null
      
      try {
        $part = Get-Partition -DriveLetter ($letter -replace ':','') -ErrorAction Stop
        if ($part) {
          $diskNumber = $part.DiskNumber
          $disk = Get-Disk -Number $part.DiskNumber -ErrorAction Stop
          if ($disk) {
            $isBoot = $disk.IsBoot -eq $true
            $physical = Get-PhysicalDisk -UniqueId $disk.UniqueId -ErrorAction SilentlyContinue
            if ($physical) {
              $mediaType = $physical.MediaType
              $busType = $physical.BusType
            } else {
              # Fallback: inferir tipo del disco si no se puede obtener PhysicalDisk
              if ($disk.BusType -eq 'USB') {
                $mediaType = 'USB'
                $busType = 'USB'
              } elseif ($disk.BusType -eq 'NVMe') {
                $mediaType = 'NVMe'
                $busType = 'NVMe'
              }
            }
          }
        }
      } catch {
        # Si Get-Partition falla, usar información básica del LogicalDisk
        $mediaType = 'Unspecified'
      }
      
      $total = [int64]$_.Size
      $free = [int64]$_.FreeSpace
      $used = $total - $free
      
      [PSCustomObject]@{
        letter = $letter
        label = $_.VolumeName
        totalBytes = $total
        usedBytes = $used
        freeBytes = $free
        percentUsed = if ($total -gt 0) { [math]::Round(($used / $total) * 100) } else { 0 }
        fileSystem = $_.FileSystem
        mediaType = $mediaType
        busType = $busType
        isSystem = ($letter -eq ($env:SystemDrive))
        isBoot = $isBoot
        diskNumber = $diskNumber
        isAvailable = $_.DriveType -eq 2 -or $_.DriveType -eq 3
      }
    }
    
    $usb = Get-CimInstance Win32_LogicalDisk -Filter "DriveType=2" | ForEach-Object {
      $total = [int64]$_.Size
      $free = [int64]$_.FreeSpace
      $used = $total - $free
      
      [PSCustomObject]@{
        letter = $_.DeviceID
        label = $_.VolumeName
        totalBytes = $total
        usedBytes = $used
        freeBytes = $free
        percentUsed = if ($total -gt 0) { [math]::Round(($used / $total) * 100) } else { 0 }
        fileSystem = $_.FileSystem
        mediaType = 'USB'
        busType = 'USB'
        isSystem = $false
        isBoot = $false
        diskNumber = $null
        isAvailable = $true
      }
    }
    
    @($disks) + @($usb) | ConvertTo-Json -Depth 4
  `;

  const result = await runPowerShellJson(script);
  if (result.success && result.data) {
    const disks = Array.isArray(result.data) ? result.data : [result.data];
    return disks.map(normalizeDisk);
  }
  return detectDisksFallback();
}

async function detectDisksLinux() {
  try {
    const { stdout } = await execFileAsync('lsblk', ['-J', '-b', '-o', 'NAME,SIZE,TYPE,MOUNTPOINT,FSTYPE,ROTA,MODEL'], { encoding: 'utf8' });
    const data = JSON.parse(stdout);
    const disks = [];

    for (const dev of data.blockdevices || []) {
      if (dev.type === 'disk') {
        for (const part of dev.children || []) {
          if (part.mountpoint) {
            const total = parseInt(part.size, 10) || dev.size;
            disks.push(normalizeDisk({
              letter: part.mountpoint,
              label: part.label || dev.model || part.name,
              totalBytes: total,
              usedBytes: Math.round(total * 0.5),
              freeBytes: Math.round(total * 0.5),
              percentUsed: 50,
              fileSystem: part.fstype,
              mediaType: part.rota === '0' ? 'SSD' : 'HDD',
              busType: '',
              isSystem: part.mountpoint === '/'
            }));
          }
        }
      }
    }

    if (disks.length === 0) {
      return detectDisksFallback();
    }

    // Obtener uso real con df
    for (const disk of disks) {
      try {
        const { stdout: dfOut } = await execFileAsync('df', ['-B1', disk.letter], { encoding: 'utf8' });
        const lines = dfOut.trim().split('\n');
        if (lines.length >= 2) {
          const parts = lines[1].split(/\s+/);
          disk.totalBytes = parseInt(parts[1], 10);
          disk.usedBytes = parseInt(parts[2], 10);
          disk.freeBytes = parseInt(parts[3], 10);
          disk.percentUsed = formatPercent(disk.usedBytes, disk.totalBytes);
        }
      } catch {
        // mantener estimación
      }
    }

    return disks;
  } catch {
    return detectDisksFallback();
  }
}

function detectDisksFallback() {
  const home = os.homedir();
  return [{
    letter: process.platform === 'win32' ? 'C:' : '/',
    label: 'Sistema',
    totalBytes: 128 * 1024 ** 3,
    usedBytes: 123 * 1024 ** 3,
    freeBytes: 5 * 1024 ** 3,
    percentUsed: 96,
    fileSystem: 'NTFS',
    mediaType: 'SSD',
    busType: '',
    isSystem: true,
    isFallback: true
  }];
}

function normalizeDisk(raw) {
  let mediaType = raw.mediaType || 'Unspecified';
  if (mediaType === 'Unspecified' && raw.busType === 'NVMe') mediaType = 'NVMe';
  if (raw.mediaType === 'Removable' || raw.busType === 'USB') mediaType = 'USB';

  const typeLabel = DISK_TYPE_MAP[mediaType] || mediaType;
  const status = getDiskStatus(raw.percentUsed || 0);

  return {
    letter: raw.letter,
    label: raw.label || '',
    totalBytes: raw.totalBytes || 0,
    usedBytes: raw.usedBytes || 0,
    freeBytes: raw.freeBytes || 0,
    percentUsed: raw.percentUsed || 0,
    fileSystem: raw.fileSystem || '',
    mediaType: typeLabel,
    busType: raw.busType || '',
    isSystem: !!raw.isSystem,
    isBoot: !!raw.isBoot,
    diskNumber: raw.diskNumber || null,
    isAvailable: raw.isAvailable !== false,
    isFallback: !!raw.isFallback,
    status: status.label,
    statusLevel: status.level
  };
}

async function detectDisks() {
  if (process.platform === 'win32') {
    return detectDisksWindows();
  }
  return detectDisksLinux();
}

function classifyDisks(disks) {
  const availableDisks = disks.filter(d => d.isAvailable);
  
  // Agrupar por diskNumber para evitar tratar particiones como discos independientes
  const diskGroups = new Map();
  for (const disk of availableDisks) {
    const key = disk.diskNumber !== null ? disk.diskNumber : disk.letter;
    if (!diskGroups.has(key)) {
      diskGroups.set(key, []);
    }
    diskGroups.get(key).push(disk);
  }
  
  // Para cada grupo, usar el disco con más espacio libre como representante
  const uniqueDisks = [];
  for (const [key, group] of diskGroups) {
    const representative = group.sort((a, b) => b.freeBytes - a.freeBytes)[0];
    uniqueDisks.push(representative);
  }
  
  // Priorizar SSD/NVMe para el SSD del sistema
  const ssd = uniqueDisks.find((d) => ['SSD', 'NVMe'].includes(d.mediaType) || d.isSystem || d.isBoot);
  
  // Buscar HDD explícito que no sea el mismo disco físico que el SSD
  const hdd = uniqueDisks.find((d) => 
    d.mediaType === 'HDD' && 
    d.diskNumber !== ssd?.diskNumber && 
    d.letter !== ssd?.letter
  );
  
  const usb = uniqueDisks.filter((d) => d.mediaType === 'USB');

  // Si no hay HDD explícito, usar el disco con más espacio libre que no sea SSD del sistema
  let targetHdd = hdd;
  if (!targetHdd) {
    const candidates = uniqueDisks
      .filter((d) => 
        d.diskNumber !== ssd?.diskNumber && 
        d.letter !== ssd?.letter && 
        d.freeBytes > 50 * 1024 ** 3
      )
      .sort((a, b) => b.freeBytes - a.freeBytes);
    targetHdd = candidates[0] || null;
  }

  return { ssd: ssd || uniqueDisks[0], hdd: targetHdd, usb, all: uniqueDisks };
}

function getAvailableDestinations(disks) {
  return disks.filter((d) => {
    const letter = String(d.letter || '').toLowerCase();
    const label = String(d.label || '').toLowerCase();
    const fileSystem = String(d.fileSystem || '').toLowerCase();

    // Nunca usar particiones del sistema o de arranque
    if (d.isSystem || d.isBoot) return false;

    // Excluir rutas Linux en builds de desarrollo
    if (letter.startsWith('/') || letter.includes('swap')) return false;

    // Nunca usar SWAP
    if (
      letter.includes('swap') ||
      label.includes('swap') ||
      fileSystem === 'swap'
    ) {
      return false;
    }

    // Nunca usar EFI o particiones de arranque
    if (
      letter === '/boot/efi' ||
      letter === '/boot' ||
      label.includes('efi')
    ) {
      return false;
    }

    // En Windows, excluir unidad del sistema explícitamente
    if (process.platform === 'win32') {
      const systemDrive = (process.env.SystemDrive || 'C:').toLowerCase();
      if (letter === systemDrive) return false;
    }

    // Debe estar disponible y tener más de 1 GB libre
    return d.isAvailable !== false && d.freeBytes > 1024 * 1024 * 1024;
  });
}

function getRecommendedDestination(disks) {
  const available = getAvailableDestinations(disks);
  if (!available.length) return null;

  // Preferir HDD secundario, luego mayor espacio libre
  const hdd = available.find((d) => d.mediaType === 'HDD');
  if (hdd) return hdd;

  const sorted = [...available].sort((a, b) => b.freeBytes - a.freeBytes);
  return sorted[0];
}

module.exports = {
  detectDisks,
  classifyDisks,
  getDiskStatus,
  getAvailableDestinations,
  getRecommendedDestination
};
