/**
 * Ejecutor de comandos PowerShell para Windows.
 */

const { execFile } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);

/**
 * Sanitiza una cadena para usarla de forma segura en PowerShell
 * Escapa caracteres especiales que podrían usarse para inyección
 */
function sanitizePowerShellString(str) {
  if (str === null || str === undefined) return '';
  const strStr = String(str);
  // Escapar comillas simples duplicándolas
  return strStr.replace(/'/g, "''");
}

/**
 * Sanitiza una ruta de archivo para PowerShell
 */
function sanitizePowerShellPath(str) {
  if (str === null || str === undefined) return '';
  const strStr = String(str);
  // Escapar comillas y validar caracteres básicos
  const sanitized = strStr.replace(/'/g, "''");
  // Validar que no contenga caracteres peligrosos
  const dangerousChars = /[;&|`$()]/;
  if (dangerousChars.test(sanitized)) {
    throw new Error(`Ruta contiene caracteres no permitidos: ${strStr}`);
  }
  return sanitized;
}

async function runPowerShell(script, timeout = 120000) {
  if (process.platform !== 'win32') {
    return { success: false, stdout: '', stderr: 'PowerShell solo disponible en Windows', data: null };
  }

  try {
    const { stdout, stderr } = await execFileAsync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
      { timeout, maxBuffer: 50 * 1024 * 1024, encoding: 'utf8' }
    );
    return { success: true, stdout: stdout.trim(), stderr: stderr.trim(), data: null };
  } catch (err) {
    return {
      success: false,
      stdout: err.stdout?.trim() || '',
      stderr: err.stderr?.trim() || err.message,
      data: null
    };
  }
}

async function runPowerShellJson(script, timeout = 120000) {
  const result = await runPowerShell(script, timeout);
  if (!result.success) return result;

  try {
    result.data = JSON.parse(result.stdout || 'null');
    return result;
  } catch {
    // Intentar extraer JSON del output
    const match = result.stdout.match(/\[[\s\S]*\]|\{[\s\S]*\}/);
    if (match) {
      try {
        result.data = JSON.parse(match[0]);
        return result;
      } catch {
        result.data = null;
      }
    }
    return result;
  }
}

module.exports = { 
  runPowerShell, 
  runPowerShellJson,
  sanitizePowerShellString,
  sanitizePowerShellPath
};
