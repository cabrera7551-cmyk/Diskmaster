/**
 * Utilidades de formateo para tamaños, rutas y porcentajes.
 */

function formatBytes(bytes, decimals = 1) {
  if (bytes === 0 || bytes == null || isNaN(bytes)) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(Math.abs(bytes)) / Math.log(k));
  const value = bytes / Math.pow(k, i);
  return `${value.toFixed(decimals)} ${sizes[i]}`;
}

function formatPercent(used, total) {
  if (!total || total === 0) return 0;
  return Math.min(100, Math.round((used / total) * 100));
}

function formatDuration(ms) {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  if (hours > 0) return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}

function formatTimestamp(date = new Date()) {
  return date.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function sanitizePath(path) {
  if (!path) return '';
  return path.replace(/[/\\]+$/, '');
}

module.exports = { formatBytes, formatPercent, formatDuration, formatTimestamp, sanitizePath };
