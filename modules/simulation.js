/**
 * Modo simulación — previsualización sin cambios reales.
 */

const { buildDestinationPath } = require('../services/moveService');
const { estimateMovableSpace } = require('../modules/recommendations');
const { formatBytes } = require('../utils/format');

function buildSimulationPreview(plan) {
  const {
    selectedItems = [],
    folderRedirects = [],
    destBase = null,
    disks = {}
  } = plan;

  const moveActions = selectedItems.map((item) => {
    if (!destBase) {
      return {
        type: 'move',
        name: item.name,
        source: item.path,
        destination: '[DESTINO NO ESPECIFICADO]',
        sizeBytes: item.sizeBytes || 0,
        sizeFormatted: item.sizeFormatted || formatBytes(item.sizeBytes || 0),
        error: 'No se especificó destino'
      };
    }
    return {
      type: 'move',
      name: item.name,
      source: item.path,
      destination: item.customDest || buildDestinationPath(destBase, item),
      sizeBytes: item.sizeBytes || 0,
      sizeFormatted: item.sizeFormatted || formatBytes(item.sizeBytes || 0)
    };
  });

  const redirectActions = folderRedirects.map((r) => ({
    type: 'redirect',
    name: r.label || r.key,
    source: r.currentPath || r.current,
    destination: r.newPath,
    sizeBytes: r.sizeBytes || 0
  }));

  const totalMoveBytes = moveActions.reduce((s, a) => s + a.sizeBytes, 0);
  const totalRedirectBytes = redirectActions.reduce((s, a) => s + a.sizeBytes, 0);
  const totalBytes = totalMoveBytes + totalRedirectBytes;

  const ssdBefore = disks.ssd?.usedBytes || 0;
  const hddBefore = disks.hdd?.usedBytes || 0;

  return {
    simulation: true,
    actions: [...moveActions, ...redirectActions],
    moveActions,
    redirectActions,
    summary: {
      totalActions: moveActions.length + redirectActions.length,
      spaceToFree: totalBytes,
      spaceToFreeFormatted: formatBytes(totalBytes),
      destBase,
      ssdBefore,
      ssdAfter: Math.max(0, ssdBefore - totalBytes),
      ssdBeforeFormatted: formatBytes(ssdBefore),
      ssdAfterFormatted: formatBytes(Math.max(0, ssdBefore - totalBytes)),
      hddBefore,
      hddAfter: hddBefore + totalBytes,
      hddBeforeFormatted: formatBytes(hddBefore),
      hddAfterFormatted: formatBytes(hddBefore + totalBytes)
    },
    risks: buildRiskWarnings(moveActions, redirectActions)
  };
}

function buildRiskWarnings(moves, redirects) {
  const warnings = [];

  if (moves.some((m) => m.source?.toLowerCase().includes('program files'))) {
    warnings.push('Se detectaron rutas de programas — no se recomienda moverlas manualmente.');
  }

  if (moves.some((m) => m.error === 'No se especificó destino')) {
    warnings.push('ALGUNOS ELEMENTOS NO TIENEN DESTINO ESPECIFICADO — DEBE SELECCIONAR UN DESTINO VÁLIDO.');
  }

  if (redirects.length > 0) {
    warnings.push('Cambiar rutas de carpetas de Windows requiere reinicio de aplicaciones abiertas.');
  }

  if (moves.length > 5) {
    warnings.push('Operación extensa — verifique espacio en destino y conexión eléctrica.');
  }

  return warnings;
}

module.exports = { buildSimulationPreview, buildRiskWarnings };
