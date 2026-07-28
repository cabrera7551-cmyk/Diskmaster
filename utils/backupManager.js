/**
 * Gestor centralizado de backups persistentes en disco.
 * Proporciona almacenamiento seguro en JSON con rotación automática.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

class BackupManager {
  constructor(backupDir) {
    this.backupDir = backupDir;
    this.memoryCache = new Map(); // Caché en memoria para acceso rápido
    this.maxBackupsPerType = 10; // Máximo de backups por tipo
    this.maxBackupAge = 30 * 24 * 60 * 60 * 1000; // 30 días en milisegundos
    this.ensureBackupDir();
  }

  ensureBackupDir() {
    try {
      if (!fs.existsSync(this.backupDir)) {
        fs.mkdirSync(this.backupDir, { recursive: true });
      }
    } catch (err) {
      console.error('Error al crear directorio de backups:', err.message);
    }
  }

  /**
   * Genera un ID único para el backup
   */
  generateBackupId(type, key) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const hash = crypto.createHash('md5').update(`${type}_${key}_${timestamp}`).digest('hex').substring(0, 8);
    return `${type}_${key}_${timestamp}_${hash}`;
  }

  /**
   * Obtiene la ruta del archivo de backup
   */
  getBackupPath(backupId) {
    return path.join(this.backupDir, `${backupId}.json`);
  }

  /**
   * Guarda un backup en disco y en caché
   */
  saveBackup(type, key, data) {
    try {
      const backupId = this.generateBackupId(type, key);
      const backupPath = this.getBackupPath(backupId);

      const backup = {
        id: backupId,
        type: type,
        key: key,
        data: data,
        timestamp: new Date().toISOString(),
        version: '1.0'
      };

      // Guardar en disco
      fs.writeFileSync(backupPath, JSON.stringify(backup, null, 2), 'utf8');

      // Guardar en caché
      this.memoryCache.set(backupId, backup);

      // Limpiar backups antiguos
      this.cleanupOldBackups(type, key);

      return { success: true, backupId, backup };
    } catch (err) {
      console.error('Error al guardar backup:', err.message);
      return { success: false, error: err.message };
    }
  }

  /**
   * Carga un backup desde disco o caché
   */
  loadBackup(backupId) {
    try {
      // Primero intentar desde caché
      if (this.memoryCache.has(backupId)) {
        return { success: true, backup: this.memoryCache.get(backupId), source: 'cache' };
      }

      // Si no está en caché, cargar desde disco
      const backupPath = this.getBackupPath(backupId);
      if (!fs.existsSync(backupPath)) {
        return { success: false, error: 'Backup no encontrado' };
      }

      const content = fs.readFileSync(backupPath, 'utf8');
      const backup = JSON.parse(content);

      // Validar estructura básica
      if (!backup.id || !backup.type || !backup.data) {
        return { success: false, error: 'Backup corrupto: estructura inválida' };
      }

      // Guardar en caché
      this.memoryCache.set(backupId, backup);

      return { success: true, backup, source: 'disk' };
    } catch (err) {
      console.error('Error al cargar backup:', err.message);
      return { success: false, error: err.message };
    }
  }

  /**
   * Lista todos los backups de un tipo y clave
   */
  listBackups(type, key) {
    try {
      if (!fs.existsSync(this.backupDir)) {
        return [];
      }

      const files = fs.readdirSync(this.backupDir);
      const pattern = new RegExp(`^${type}_${key}_`);
      const backupFiles = files.filter(f => pattern.test(f) && f.endsWith('.json'));

      const backups = [];
      for (const file of backupFiles) {
        const backupId = file.replace('.json', '');
        const result = this.loadBackup(backupId);
        if (result.success) {
          backups.push(result.backup);
        }
      }

      // Ordenar por timestamp (más reciente primero)
      return backups.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    } catch (err) {
      console.error('Error al listar backups:', err.message);
      return [];
    }
  }

  /**
   * Obtiene el backup más reciente de un tipo y clave
   */
  getLatestBackup(type, key) {
    const backups = this.listBackups(type, key);
    return backups.length > 0 ? backups[0] : null;
  }

  /**
   * Elimina un backup específico
   */
  deleteBackup(backupId) {
    try {
      // Eliminar de caché
      this.memoryCache.delete(backupId);

      // Eliminar de disco
      const backupPath = this.getBackupPath(backupId);
      if (fs.existsSync(backupPath)) {
        fs.unlinkSync(backupPath);
      }

      return { success: true, backupId };
    } catch (err) {
      console.error('Error al eliminar backup:', err.message);
      return { success: false, error: err.message };
    }
  }

  /**
   * Limpia backups antiguos de un tipo y clave
   */
  cleanupOldBackups(type, key) {
    try {
      const backups = this.listBackups(type, key);
      
      // Mantener solo los más recientes (según maxBackupsPerType)
      if (backups.length > this.maxBackupsPerType) {
        const toDelete = backups.slice(this.maxBackupsPerType);
        for (const backup of toDelete) {
          this.deleteBackup(backup.id);
        }
      }

      // Eliminar backups antiguos por fecha
      const now = Date.now();
      for (const backup of backups) {
        const backupAge = now - new Date(backup.timestamp).getTime();
        if (backupAge > this.maxBackupAge) {
          this.deleteBackup(backup.id);
        }
      }

      return { success: true, cleaned: true };
    } catch (err) {
      console.error('Error al limpiar backups antiguos:', err.message);
      return { success: false, error: err.message };
    }
  }

  /**
   * Limpia todos los backups (para testing o reset)
   */
  clearAllBackups() {
    try {
      if (!fs.existsSync(this.backupDir)) {
        return { success: true, message: 'No hay directorio de backups' };
      }

      const files = fs.readdirSync(this.backupDir);
      let deleted = 0;

      for (const file of files) {
        if (file.endsWith('.json')) {
          const filePath = path.join(this.backupDir, file);
          fs.unlinkSync(filePath);
          deleted++;
        }
      }

      // Limpiar caché
      this.memoryCache.clear();

      return { success: true, deleted };
    } catch (err) {
      console.error('Error al limpiar todos los backups:', err.message);
      return { success: false, error: err.message };
    }
  }

  /**
   * Carga todos los backups al iniciar la aplicación
   */
  loadAllBackups() {
    try {
      if (!fs.existsSync(this.backupDir)) {
        return { success: true, loaded: 0 };
      }

      const files = fs.readdirSync(this.backupDir);
      let loaded = 0;

      for (const file of files) {
        if (file.endsWith('.json')) {
          const backupId = file.replace('.json', '');
          const result = this.loadBackup(backupId);
          if (result.success) {
            loaded++;
          }
        }
      }

      return { success: true, loaded };
    } catch (err) {
      console.error('Error al cargar todos los backups:', err.message);
      return { success: false, error: err.message };
    }
  }

  /**
   * Obtiene estadísticas de backups
   */
  getStats() {
    try {
      if (!fs.existsSync(this.backupDir)) {
        return {
          totalBackups: 0,
          byType: {},
          totalSize: 0,
          cacheSize: this.memoryCache.size
        };
      }

      const files = fs.readdirSync(this.backupDir);
      const backupFiles = files.filter(f => f.endsWith('.json'));

      const byType = {};
      let totalSize = 0;

      for (const file of backupFiles) {
        const filePath = path.join(this.backupDir, file);
        const stats = fs.statSync(filePath);
        totalSize += stats.size;

        // Extraer tipo del nombre del archivo
        const parts = file.split('_');
        if (parts.length >= 1) {
          const type = parts[0];
          byType[type] = (byType[type] || 0) + 1;
        }
      }

      return {
        totalBackups: backupFiles.length,
        byType,
        totalSize,
        cacheSize: this.memoryCache.size
      };
    } catch (err) {
      console.error('Error al obtener estadísticas:', err.message);
      return {
        totalBackups: 0,
        byType: {},
        totalSize: 0,
        cacheSize: this.memoryCache.size,
        error: err.message
      };
    }
  }
}

module.exports = { BackupManager };