/**
 * Generación de reportes finales (TXT, HTML).
 */

const fs = require('fs');
const path = require('path');
const { formatBytes, formatTimestamp } = require('../utils/format');

function buildReportData(session) {
  const {
    disks = {},
    preview = {},
    moveResults = {},
    verification = {},
    errors = [],
    startTime,
    endTime
  } = session;

  // Procesar resultados de movimiento para incluir detalles específicos
  const actionDetails = [];
  if (moveResults.results) {
    for (const mr of moveResults.results) {
      actionDetails.push({
        name: mr.item?.name || 'Desconocido',
        type: 'move',
        source: mr.item?.path || 'N/A',
        destination: mr.destination || 'N/A',
        sizeBytes: mr.item?.sizeBytes || 0,
        sizeFormatted: mr.item?.sizeFormatted || '0 B',
        success: mr.result?.success || false,
        error: mr.result?.error || null
      });
    }
  }
  
  // Agregar acciones de redirección si existen
  if (preview.redirectActions) {
    for (const ra of preview.redirectActions) {
      actionDetails.push({
        name: ra.name || 'Redirección',
        type: 'redirect',
        source: ra.source || 'N/A',
        destination: ra.destination || 'N/A',
        sizeBytes: ra.sizeBytes || 0,
        sizeFormatted: formatBytes(ra.sizeBytes || 0),
        success: true,
        error: null
      });
    }
  }

  // Procesar errores con más detalle
  const detailedErrors = [];
  for (const error of errors) {
    if (typeof error === 'string') {
      detailedErrors.push({ message: error, type: 'general' });
    } else if (error && typeof error === 'object') {
      detailedErrors.push({
        message: error.error || error.message || 'Error desconocido',
        type: error.type || 'general',
        item: error.item || null,
        source: error.source || null,
        destination: error.destination || null
      });
    }
  }

  return {
    title: 'DISKMASTER — RESUMEN DEL SERVICIO',
    timestamp: formatTimestamp(new Date()),
    ssd: {
      before: disks.ssdBeforeFormatted || formatBytes(disks.ssd?.usedBytes),
      after: preview.summary?.ssdAfterFormatted || formatBytes(disks.ssdAfter),
      freed: preview.summary?.spaceToFreeFormatted || '0 B'
    },
    hdd: {
      before: disks.hddBeforeFormatted || formatBytes(disks.hdd?.usedBytes),
      after: preview.summary?.hddAfterFormatted || formatBytes(disks.hddAfter)
    },
    actions: actionDetails,
    errors: detailedErrors.length,
    errorDetails: detailedErrors,
    duration: endTime && startTime ? endTime - startTime : 0,
    verification: verification.allPassed ? 'Completada' : 'Con advertencias',
    processed: moveResults.processed || 0,
    total: moveResults.total || 0
  };
}

function generateTextReport(data) {
  const lines = [
    '═'.repeat(50),
    data.title,
    '═'.repeat(50),
    '',
    `Fecha: ${data.timestamp}`,
    '',
    'SSD ANTES:  ' + data.ssd.before,
    'SSD DESPUÉS: ' + data.ssd.after,
    'ESPACIO LIBERADO: ' + data.ssd.freed,
    '',
    'HDD ANTES:  ' + data.hdd.before,
    'HDD DESPUÉS: ' + data.hdd.after,
    '',
    `PROCESADOS: ${data.processed}/${data.total}`,
    '',
    'ACCIONES:',
    ...data.actions.map((a) => {
      const status = a.success ? '✓' : '✗';
      const size = a.sizeFormatted ? ` (${a.sizeFormatted})` : '';
      const error = a.error ? ` [ERROR: ${a.error}]` : '';
      return `  ${status} ${a.name} (${a.type})${size}${error}`;
    }),
    '',
    `ERRORES: ${data.errors}`,
    ...(data.errorDetails.length ? data.errorDetails.map((e) => {
      const item = e.item ? ` [${e.item}]` : '';
      return `  - ${e.message}${item}`;
    }) : ['  Ninguno']),
    '',
    `VERIFICACIÓN: ${data.verification}`,
    '═'.repeat(50)
  ];
  return lines.join('\n');
}

function generateHtmlReport(data) {
  const actionsHtml = data.actions.map((a) => {
    const statusClass = a.success ? 'ok' : 'error';
    const statusIcon = a.success ? '✓' : '✗';
    const size = a.sizeFormatted ? ` <span style="color:var(--text-dim)">(${a.sizeFormatted})</span>` : '';
    const error = a.error ? ` <span class="error">[ERROR: ${a.error}]</span>` : '';
    return `<li class="${statusClass}">${statusIcon} ${a.name} (${a.type})${size}${error}</li>`;
  }).join('');

  const errorsHtml = data.errorDetails.length 
    ? data.errorDetails.map((e) => {
        const item = e.item ? ` <span style="color:var(--text-dim)">[${e.item}]</span>` : '';
        return `<li class="error">${e.message}${item}</li>`;
      }).join('')
    : '<li class="ok">Ninguno</li>';

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <title>DiskMaster Report</title>
  <style>
    body { background: #0d1117; color: #c9d6cf; font-family: 'Consolas', monospace; padding: 2rem; }
    h1 { color: #3ddc84; border-bottom: 1px solid #1f6f4a; padding-bottom: 0.5rem; }
    .panel { background: #111820; border: 1px solid #1f6f4a; border-radius: 8px; padding: 1rem; margin: 1rem 0; }
    .label { color: #3ddc84; }
    .ok { color: #3ddc84; }
    .error { color: #e0533f; }
    .text-dim { color: #6e7681; }
    table { width: 100%; border-collapse: collapse; }
    td { padding: 6px 0; border-top: 1px solid #1f2d26; }
    ul { list-style: none; padding: 0; }
    li { padding: 4px 0; }
  </style>
</head>
<body>
  <h1>${data.title}</h1>
  <p>Fecha: ${data.timestamp}</p>

  <div class="panel">
    <div class="label">ALMACENAMIENTO SSD</div>
    <table>
      <tr><td>Antes</td><td>${data.ssd.before}</td></tr>
      <tr><td>Después</td><td class="ok">${data.ssd.after}</td></tr>
      <tr><td>Liberado</td><td class="ok">${data.ssd.freed}</td></tr>
    </table>
  </div>

  <div class="panel">
    <div class="label">ALMACENAMIENTO HDD</div>
    <table>
      <tr><td>Antes</td><td>${data.hdd.before}</td></tr>
      <tr><td>Después</td><td>${data.hdd.after}</td></tr>
    </table>
  </div>

  <div class="panel">
    <div class="label">PROCESADOS: ${data.processed}/${data.total}</div>
  </div>

  <div class="panel">
    <div class="label">ACCIONES REALIZADAS</div>
    <ul>${actionsHtml}</ul>
  </div>

  <div class="panel">
    <div class="label">ERRORES: ${data.errors}</div>
    <ul>${errorsHtml}</ul>
  </div>

  <p>Verificación: ${data.verification}</p>
</body>
</html>`;
}

function saveReport(content, outputDir, format = 'txt') {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const filename = `DiskMaster_Report_${timestamp}.${format}`;
  const fullPath = path.join(outputDir, filename);

  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(fullPath, content, 'utf8');

  return fullPath;
}

module.exports = {
  buildReportData,
  generateTextReport,
  generateHtmlReport,
  saveReport
};
