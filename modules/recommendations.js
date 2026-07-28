/**
 * Sistema de recomendaciones inteligentes.
 */

const { isProgramPath } = require('../services/analysisService');
const { isProtectedPath } = require('../utils/safety');

const RECOMMENDATIONS = {
  MOVE_TO_HDD: { label: 'MOVER A HDD', emoji: '🟢', level: 'move', color: 'green' },
  ANALYZE: { label: 'ANALIZAR', emoji: '🟡', level: 'analyze', color: 'yellow' },
  KEEP_SSD: { label: 'MANTENER EN SSD', emoji: '🔵', level: 'keep', color: 'blue' },
  DO_NOT_MODIFY: { label: 'NO MODIFICAR', emoji: '🔴', level: 'protected', color: 'red' }
};

const PROGRAM_KEYWORDS = [
  'autocad', 'autodesk', 'revit', 'civil 3d', 'sketchup', 'arcgis', 'qgis',
  'adobe', 'office', 'visual studio', 'windows', 'microsoft'
];

const MOVE_KEYWORDS = [
  'descarga', 'download', 'video', 'render', 'proyecto', 'backup',
  'copia', 'temp', 'cache', 'media', 'musica', 'music', 'imagen', 'picture'
];

function classifyItem(item, context = {}) {
  const nameLower = (item.name || '').toLowerCase();
  const pathLower = (item.path || '').toLowerCase();

  // Protegidos del sistema
  if (isProtectedPath(item.path) || nameLower.includes('windows') || pathLower.includes('\\windows\\')) {
    return { ...RECOMMENDATIONS.DO_NOT_MODIFY, reason: 'Archivo o carpeta del sistema' };
  }

  // Programas instalados
  if (item.type === 'program' || isProgramPath(item.path)) {
    const isHeavyApp = PROGRAM_KEYWORDS.some((k) => nameLower.includes(k));
    return {
      ...RECOMMENDATIONS.KEEP_SSD,
      reason: isHeavyApp
        ? 'Programa que se beneficia del SSD. Reinstalar en HDD si se desea.'
        : 'Programa instalado — no mover manualmente'
    };
  }

  // Carpetas personales grandes
  if (item.type === 'personal' || item.category) {
    const sizeGB = (item.sizeBytes || 0) / (1024 ** 3);

    if (['downloads', 'videos', 'pictures', 'music', 'documents', 'desktop'].includes(item.category || item.id)) {
      if (sizeGB >= 1) {
        return { ...RECOMMENDATIONS.MOVE_TO_HDD, reason: 'Carpeta personal con espacio recuperable' };
      }
      if (sizeGB >= 0.1) {
        return { ...RECOMMENDATIONS.ANALYZE, reason: 'Tamaño moderado — revisar contenido' };
      }
    }
  }

  // Archivos grandes sueltos
  if (item.type === 'file') {
    const ext = (item.extension || '').toLowerCase();
    const sizeGB = (item.sizeBytes || 0) / (1024 ** 3);

    if (['.exe', '.msi', '.dll'].includes(ext)) {
      return { ...RECOMMENDATIONS.DO_NOT_MODIFY, reason: 'Archivo ejecutable o de sistema' };
    }

    if (MOVE_KEYWORDS.some((k) => nameLower.includes(k)) || sizeGB >= 2) {
      return { ...RECOMMENDATIONS.MOVE_TO_HDD, reason: 'Archivo grande o de datos personales' };
    }

    return { ...RECOMMENDATIONS.ANALYZE, reason: 'Revisar antes de mover' };
  }

  // Proyectos de ingeniería
  if (item.type === 'engineering') {
    return { ...RECOMMENDATIONS.MOVE_TO_HDD, reason: 'Proyecto de ingeniería — ideal en HDD' };
  }

  // Por defecto según tamaño
  const sizeGB = (item.sizeBytes || 0) / (1024 ** 3);
  if (sizeGB >= 5) return { ...RECOMMENDATIONS.MOVE_TO_HDD, reason: 'Ocupa espacio significativo' };
  if (sizeGB >= 1) return { ...RECOMMENDATIONS.ANALYZE, reason: 'Tamaño moderado' };

  return { ...RECOMMENDATIONS.KEEP_SSD, reason: 'Tamaño pequeño — puede permanecer en SSD' };
}

function buildRecommendations(items, context = {}) {
  return items.map((item) => {
    const rec = classifyItem(item, context);
    const selectable = rec.level === 'move' || rec.level === 'analyze';

    return {
      ...item,
      recommendation: rec.label,
      recommendationLevel: rec.level,
      recommendationEmoji: rec.emoji,
      recommendationColor: rec.color,
      recommendationReason: rec.reason,
      selected: rec.level === 'move' && selectable,
      selectable
    };
  });
}

function estimateMovableSpace(recommendations) {
  return recommendations
    .filter((r) => r.selected && r.recommendationLevel === 'move')
    .reduce((sum, r) => sum + (r.sizeBytes || 0), 0);
}

module.exports = {
  RECOMMENDATIONS,
  classifyItem,
  buildRecommendations,
  estimateMovableSpace
};
