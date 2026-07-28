/**
 * Registro de actividad en memoria y archivo.
 */

const fs = require('fs');
const path = require('path');
const { formatTimestamp } = require('./format');

class ActivityLogger {
  constructor(logDir) {
    this.entries = [];
    this.listeners = [];
    this.logDir = logDir;
    this.maxFileSize = 10 * 1024 * 1024; // 10 MB máximo por archivo
    this.maxLogFiles = 5; // Mantener máximo 5 archivos de log
    this.ensureLogDir();
  }

  ensureLogDir() {
    try {
      if (!fs.existsSync(this.logDir)) {
        fs.mkdirSync(this.logDir, { recursive: true });
      }
    } catch (err) {
      // Portable: puede fallar en USB de solo lectura
      console.error('Error al crear directorio de logs:', err.message);
    }
  }

  onEntry(callback) {
    this.listeners.push(callback);
    return () => {
      this.listeners = this.listeners.filter((cb) => cb !== callback);
    };
  }

  log(message, level = 'info') {
    const entry = {
      timestamp: formatTimestamp(),
      message,
      level,
      iso: new Date().toISOString()
    };
    this.entries.push(entry);
    this.listeners.forEach((cb) => cb(entry));
    this.appendToFile(entry);
    return entry;
  }

  logError(message, error = null) {
    const errorMessage = error ? `${message}: ${error.message}` : message;
    const entry = this.log(errorMessage, 'error');
    if (error && error.stack) {
      this.log(`Stack trace: ${error.stack}`, 'error');
    }
    return entry;
  }

  logWarning(message) {
    return this.log(message, 'warn');
  }

  appendToFile(entry) {
    try {
      const logFile = path.join(this.logDir, `diskmaster_${new Date().toISOString().slice(0, 10)}.log`);
      const line = `[${entry.timestamp}] [${entry.level.toUpperCase()}] ${entry.message}\n`;
      
      // Verificar tamaño del archivo y rotar si es necesario
      if (fs.existsSync(logFile)) {
        const stats = fs.statSync(logFile);
        if (stats.size >= this.maxFileSize) {
          this.rotateLogFile(logFile);
        }
      }
      
      // Después de rotar, el archivo puede no existir, así que escribir directamente
      fs.appendFileSync(logFile, line, 'utf8');
      this.cleanupOldLogs();
    } catch (err) {
      // Ignorar errores de escritura en modo portable, pero loggear a consola
      console.error('Error al escribir en log:', err.message);
    }
  }

  rotateLogFile(currentFile) {
    try {
      const baseName = path.basename(currentFile, '.log');
      const dirName = path.dirname(currentFile);
      
      // Encontrar el número más alto de archivos rotados
      let maxNum = 0;
      for (let i = 1; i <= this.maxLogFiles; i++) {
        const rotatedFile = path.join(dirName, `${baseName}.${i}.log`);
        if (fs.existsSync(rotatedFile)) {
          maxNum = i;
        }
      }
      
      // Rotar archivos existentes
      for (let i = maxNum; i >= 1; i--) {
        const oldFile = path.join(dirName, `${baseName}.${i}.log`);
        const newFile = path.join(dirName, `${baseName}.${i + 1}.log`);
        if (fs.existsSync(oldFile) && i < this.maxLogFiles) {
          fs.renameSync(oldFile, newFile);
        } else if (i >= this.maxLogFiles) {
          fs.unlinkSync(oldFile); // Eliminar el más antiguo
        }
      }
      
      // Mover el archivo actual a .1
      const rotatedFile = path.join(dirName, `${baseName}.1.log`);
      fs.renameSync(currentFile, rotatedFile);
    } catch (err) {
      console.error('Error al rotar archivo de log:', err.message);
    }
  }

  cleanupOldLogs() {
    try {
      const files = fs.readdirSync(this.logDir);
      const logFiles = files.filter(f => f.startsWith('diskmaster_') && f.endsWith('.log'));
      
      // Si hay más archivos de los permitidos, eliminar los más antiguos
      if (logFiles.length > this.maxLogFiles) {
        const logFilesWithStats = logFiles.map(f => {
          const filePath = path.join(this.logDir, f);
          try {
            const stats = fs.statSync(filePath);
            return { file: f, path: filePath, mtime: stats.mtime };
          } catch {
            return { file: f, path: filePath, mtime: new Date(0) };
          }
        }).sort((a, b) => a.mtime - b.mtime);
        
        const filesToDelete = logFilesWithStats.slice(0, logFiles.length - this.maxLogFiles);
        for (const fileToDelete of filesToDelete) {
          try {
            fs.unlinkSync(fileToDelete.path);
          } catch (err) {
            console.error('Error al eliminar archivo de log antiguo:', err.message);
          }
        }
      }
    } catch (err) {
      console.error('Error al limpiar logs antiguos:', err.message);
    }
  }

  getEntries() {
    return [...this.entries];
  }

  clear() {
    this.entries = [];
  }

  exportText() {
    return this.entries.map((e) => `[${e.timestamp}] [${e.level.toUpperCase()}] ${e.message}`).join('\n');
  }
}

module.exports = { ActivityLogger };
