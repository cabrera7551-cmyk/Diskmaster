/**
 * DISKMASTER — Controlador de interfaz (renderer)
 */

(() => {
  'use strict';

  const state = {
    disks: [],
    classification: null,
    recommendations: [],
    engineeringProjects: [],
    folderLocations: [],
    browsers: [],
    availableDestinations: [],
    recommendedDestination: null,
    destPath: '',
    folderRedirects: [],
    simulationMode: false,
    lastReport: null,
    analyzing: false,
    platform: 'unknown'
  };

  // DOM refs
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

  const els = {
    statusText: $('#status-text'),
    statusBadge: $('#status-badge'),
    simulationMode: $('#simulation-mode'),
    diskGrid: $('#disk-grid'),
    recommendationsBody: $('#recommendations-body'),
    destPanel: $('#dest-panel'),
    destPath: $('#dest-path'),
    terminal: $('#terminal'),
    logFull: $('#log-full'),
    previewModal: $('#preview-modal'),
    reportModal: $('#report-modal'),
    confirmModal: $('#confirm-modal'),
    previewActions: $('#preview-actions'),
    previewSpace: $('#preview-space'),
    previewDest: $('#preview-dest'),
    previewRisks: $('#preview-risks'),
    executionProgress: $('#execution-progress'),
    execSteps: $('#exec-steps'),
    execProgressBar: $('#exec-progress-bar'),
    execDetail: $('#exec-detail'),
    reportBody: $('#report-body'),
    folderRedirectList: $('#folder-redirect-list'),
    engineeringList: $('#engineering-list'),
    browserList: $('#browser-list'),
    installPrefPath: $('#install-pref-path'),
    destInfo: $('#dest-info'),
    driveModal: $('#drive-modal'),
    driveOptions: $('#drive-options'),
    driveModalHint: $('#drive-modal-hint')
  };

  // --- Init ---
  async function init() {
    if (!window.diskMaster) {
      terminalLog('Error: API no disponible. Ejecutar con Electron.', 'error');
      return;
    }

    const initial = await window.diskMaster.getInitialState();
    state.simulationMode = initial.simulationMode;
    state.platform = initial.platform || 'unknown';

    window.diskMaster.onLogEntry((entry) => terminalLog(entry.message, entry.level));
    window.diskMaster.onProgress(handleProgress);

    bindEvents();

    if (state.platform !== 'win32') {
      terminalLog('Modo desarrollo: funcionalidad completa disponible en Windows 10/11', 'warn');
    }

    terminalLog('Sistema listo. Esperando órdenes...');
  }

  function bindEvents() {
    // Navigation
    $$('.nav-tab').forEach((tab) => {
      tab.addEventListener('click', () => switchView(tab.dataset.view));
    });

    // Main actions
    $('#btn-analyze').addEventListener('click', analyzeSystem);
    $('#btn-move-selected').addEventListener('click', () => {
      switchView('dashboard');
      if (state.destPath) previewActions_flow(false);
      else showConfirm('Selecciona un destino primero o analiza el sistema.', () => {});
    });
    $('#btn-redirect').addEventListener('click', () => switchView('folders'));
    $('#btn-install-config').addEventListener('click', () => switchView('install'));
    $('#btn-execute').addEventListener('click', () => previewActions_flow(false));

    // Destination
    $('#btn-select-dest-drive').addEventListener('click', selectDestDrive);
    $('#btn-select-dest').addEventListener('click', selectDestFolder);
    $('#btn-select-install-path').addEventListener('click', async () => {
      const folder = await window.diskMaster.selectFolder();
      if (folder) els.installPrefPath.value = folder;
    });

    // Simulation
    els.simulationMode.addEventListener('change', async (e) => {
      state.simulationMode = e.target.checked;
      await window.diskMaster.toggleSimulation(state.simulationMode);
      terminalLog(state.simulationMode ? 'Modo simulación ACTIVADO — no se realizarán cambios' : 'Modo simulación DESACTIVADO', 'warn');
    });

    // Preview modal
    $('#preview-close').addEventListener('click', closePreview);
    $('#preview-cancel').addEventListener('click', closePreview);
    $('#preview-modify').addEventListener('click', closePreview);
    $('#preview-execute').addEventListener('click', executePlan);

    // Report modal
    $('#report-close').addEventListener('click', () => els.reportModal.hidden = true);
    $('#report-ok').addEventListener('click', () => els.reportModal.hidden = true);
    $('#export-txt').addEventListener('click', () => exportReport('txt'));
    $('#export-html').addEventListener('click', () => exportReport('html'));

    // Confirm modal
    $('#confirm-cancel').addEventListener('click', () => els.confirmModal.hidden = true);

    // Drive modal
    $('#drive-modal-close').addEventListener('click', closeDriveModal);
    $('#drive-modal-cancel').addEventListener('click', closeDriveModal);
  }

  // --- Views ---
  function switchView(viewId) {
    $$('.nav-tab').forEach((t) => t.classList.toggle('active', t.dataset.view === viewId));
    $$('.view').forEach((v) => v.classList.toggle('active', v.id === `view-${viewId}`));
  }

  // --- Terminal / Log ---
  function terminalLog(msg, level = 'info') {
    const line = document.createElement('div');
    line.className = `terminal-line${level === 'warn' ? ' warn' : ''}${level === 'error' ? ' error' : ''}`;
    line.textContent = `> ${msg}`;
    els.terminal.appendChild(line);
    els.terminal.scrollTop = els.terminal.scrollHeight;

    const logLine = document.createElement('div');
    logLine.textContent = `[${new Date().toLocaleTimeString('es-ES')}] ${msg}`;
    els.logFull.appendChild(logLine);
    els.logFull.scrollTop = els.logFull.scrollHeight;
  }

  function setStatus(text, type = 'ok') {
    els.statusText.textContent = text;
    els.statusText.className = type === 'ok' ? 'status-ok' : type === 'busy' ? 'status-busy' : 'status-error';
  }

  // --- Analyze ---
  async function analyzeSystem() {
    if (state.analyzing) return;
    state.analyzing = true;
    setStatus('analizando', 'busy');
    $('#btn-analyze').disabled = true;
    $('#btn-analyze').classList.add('spinner-inline');

    try {
      terminalLog('Analizando unidades...');
      const result = await window.diskMaster.analyzeSystem();

      state.disks = result.disks;
      state.classification = result.classification;
      state.recommendations = result.recommendations;
      state.engineeringProjects = result.engineeringProjects;
      state.folderLocations = result.folderLocations;
      state.browsers = result.browsers;
      state.availableDestinations = result.availableDestinations || await window.diskMaster.getAvailableDestinations();
      state.recommendedDestination = result.recommendedDestination || null;

      renderDisks(result.disks);
      renderRecommendations(result.recommendations);
      renderFolderRedirects(result.folderLocations);
      renderEngineering(result.engineeringProjects);
      renderBrowsers(result.browsers);
      renderDestInfo();

      els.destPanel.hidden = false;
      els.destPath.value = '';
      els.destPath.placeholder = 'Seleccione una unidad de destino...';

      if (state.recommendedDestination) {
        terminalLog(`Destino recomendado: ${state.recommendedDestination.letter} (${state.recommendedDestination.mediaType}) — ${formatBytes(state.recommendedDestination.freeBytes)} libres`);
      } else {
        terminalLog('No hay unidad secundaria válida. Conecte un HDD o seleccione manualmente otra unidad.', 'warn');
      }

      terminalLog(`Sugerencia: se detectaron ${result.totalMovableFormatted} movibles al HDD`);
      terminalLog('Seleccione una unidad de destino antes de ejecutar cambios');
      setStatus('listo', 'ok');
    } catch (err) {
      terminalLog(`Error en análisis: ${err.message}`, 'error');
      setStatus('error', 'error');
    } finally {
      state.analyzing = false;
      $('#btn-analyze').disabled = false;
      $('#btn-analyze').classList.remove('spinner-inline');
    }
  }

  // --- Render disks ---
  function renderDisks(disks) {
    els.diskGrid.innerHTML = disks.map((disk) => {
      const statusClass = disk.statusLevel === 'critical' ? 'critical'
        : disk.statusLevel === 'warning' ? 'warning' : 'ok';
      const barClass = statusClass;

      return `
        <div class="disk-card">
          <div class="disk-title">[ ${disk.mediaType} :: ${disk.letter} ${formatBytes(disk.totalBytes)} ]</div>
          <div class="progress-bar">
            <div class="progress-fill ${barClass}" style="width:${disk.percentUsed}%"></div>
          </div>
          <div class="disk-stats">usado ${formatBytes(disk.usedBytes)} / libre ${formatBytes(disk.freeBytes)} (${disk.percentUsed}%)</div>
          <div class="disk-status ${statusClass}">${disk.statusLevel === 'critical' ? '⚠ ' : ''}${disk.status.toLowerCase()}</div>
        </div>
      `;
    }).join('');
  }

  function renderDestInfo() {
    if (!els.destInfo) return;

    if (!state.availableDestinations.length) {
      els.destInfo.className = 'dest-info warn';
      els.destInfo.textContent = 'No hay unidades de destino disponibles. Se requiere una unidad secundaria (por ejemplo D:) con al menos 1 GB libre.';
      return;
    }

    if (state.destPath) {
      const selectedDrive = getDestDriveLetter();
      const drive = state.availableDestinations.find((d) => d.letter === selectedDrive);
      els.destInfo.className = 'dest-info ok';
      els.destInfo.textContent = drive
        ? `Destino: ${drive.letter} (${drive.mediaType}) — ${formatBytes(drive.freeBytes)} libres de ${formatBytes(drive.totalBytes)}`
        : `Destino seleccionado: ${state.destPath}`;
      return;
    }

    if (state.recommendedDestination) {
      els.destInfo.className = 'dest-info';
      els.destInfo.textContent = `Recomendado: ${state.recommendedDestination.letter} (${state.recommendedDestination.mediaType}). Pulse "Seleccionar Unidad" para confirmar.`;
      return;
    }

    els.destInfo.className = 'dest-info warn';
    els.destInfo.textContent = 'Seleccione manualmente una unidad de destino antes de mover archivos.';
  }

  function getDestDriveLetter() {
    const match = String(state.destPath || '').match(/^[A-Za-z]:/);
    return match ? match[0].toUpperCase() : (state.classification?.hdd?.letter || 'D:');
  }
  function renderRecommendations(items) {
    if (!items.length) {
      els.recommendationsBody.innerHTML = '<tr class="empty-row"><td colspan="5">No se encontraron elementos</td></tr>';
      return;
    }

    els.recommendationsBody.innerHTML = items.map((item) => {
      const id = item.id || item.key || item.name;
      const recClass = {
        move: 'rec-move',
        analyze: 'rec-analyze',
        keep: 'rec-keep',
        protected: 'rec-protected'
      }[item.recommendationLevel] || '';

      const canCheck = item.selectable !== false && item.recommendationLevel !== 'protected';

      return `
        <tr data-id="${escHtml(id)}">
          <td>${escHtml(item.name)}</td>
          <td>${item.sizeFormatted || formatBytes(item.sizeBytes)}</td>
          <td>${escHtml(item.type || '—')}</td>
          <td class="${recClass}">${item.recommendationEmoji || ''} ${escHtml(item.recommendation)}</td>
          <td>${canCheck ? `<input type="checkbox" class="rec-checkbox" data-id="${escHtml(id)}" ${item.selected ? 'checked' : ''}>` : ''}</td>
        </tr>
      `;
    }).join('');

    els.recommendationsBody.querySelectorAll('.rec-checkbox').forEach((cb) => {
      cb.addEventListener('change', (e) => {
        const id = e.target.dataset.id;
        const rec = state.recommendations.find((r) => (r.id || r.key || r.name) === id);
        if (rec) rec.selected = e.target.checked;
      });
    });
  }

  // --- Folder redirects ---
  function renderFolderRedirects(locations) {
    const hddLetter = getDestDriveLetter().replace(/:$/, '') + ':';

    els.folderRedirectList.innerHTML = locations.map((folder) => {
      const newPath = `${hddLetter}\\${folder.label}`;
      return `
        <div class="folder-item" data-key="${folder.key}">
          <div class="folder-item-header">${escHtml(folder.label)}</div>
          <div class="folder-paths">
            <span class="path-label">ANTES:</span>
            <span class="path-value">${escHtml(folder.current)}</span>
            <span class="path-label">DESPUÉS:</span>
            <span class="path-value path-new folder-new-path">${escHtml(newPath)}</span>
          </div>
          <button class="btn btn-secondary btn-redirect-folder" data-key="${folder.key}" data-label="${escHtml(folder.label)}" data-current="${escHtml(folder.current)}" data-new="${escHtml(newPath)}">
            CAMBIAR RUTA
          </button>
        </div>
      `;
    }).join('');

    els.folderRedirectList.querySelectorAll('.btn-redirect-folder').forEach((btn) => {
      btn.addEventListener('click', () => {
        const redirect = {
          key: btn.dataset.key,
          label: btn.dataset.label,
          currentPath: btn.dataset.current,
          newPath: btn.dataset.new
        };

        showConfirm(
          `<strong>${escHtml(redirect.label)}</strong><br><br>
           <span class="path-label">Origen:</span> ${escHtml(redirect.currentPath)}<br>
           <span class="path-label">Destino:</span> <span class="path-new">${escHtml(redirect.newPath)}</span><br><br>
           Se moverán los archivos existentes y se actualizará la ruta de la carpeta de usuario.<br>
           <strong style="color:var(--warning)">¿Confirmar cambio?</strong>`,
          () => {
            const existing = state.folderRedirects.find((r) => r.key === redirect.key);
            if (!existing) state.folderRedirects.push(redirect);
            terminalLog(`Ruta de ${redirect.label} programada → ${redirect.newPath}`);
            btn.textContent = '✓ PROGRAMADO';
            btn.disabled = true;
          }
        );
      });
    });
  }

  // --- Engineering ---
  function renderEngineering(projects) {
    if (!projects.length) {
      els.engineeringList.innerHTML = '<p style="color:var(--text-dim)">No se detectaron proyectos. Analiza el sistema primero.</p>';
      return;
    }

    els.engineeringList.innerHTML = projects.map((p) => `
      <div class="eng-item">
        <div style="display:flex;justify-content:space-between;align-items:center">
          <span style="color:var(--green)">${escHtml(p.name)}</span>
          <span>${p.sizeFormatted} (${p.fileCount} archivos)</span>
        </div>
        <div style="font-size:11px;color:var(--text-dim);margin-top:4px">${escHtml(p.path)}</div>
        <label style="display:flex;align-items:center;gap:6px;margin-top:8px;font-size:12px">
          <input type="checkbox" class="eng-checkbox" data-id="${escHtml(p.id)}" ${isEngineeringSelected(p.id) ? 'checked' : ''}>
          Mover a HDD
        </label>
      </div>
    `).join('');

    els.engineeringList.querySelectorAll('.eng-checkbox').forEach((cb) => {
      cb.addEventListener('change', (e) => toggleEngineeringSelection(e.target.dataset.id, e.target.checked));
    });
  }

  function isEngineeringSelected(id) {
    const rec = state.recommendations.find((r) => r.id === id);
    return rec ? !!rec.selected : true;
  }

  function toggleEngineeringSelection(id, selected) {
    const rec = state.recommendations.find((r) => r.id === id);
    if (rec) {
      rec.selected = selected;
      const tableCb = els.recommendationsBody.querySelector(`.rec-checkbox[data-id="${CSS.escape(id)}"]`);
      if (tableCb) tableCb.checked = selected;
    }
  }

  // --- Browsers ---
  function renderBrowsers(browsers) {
    if (!browsers.length) {
      els.browserList.innerHTML = '<p style="color:var(--text-dim)">No se detectaron navegadores instalados.</p>';
      return;
    }

    const hddLetter = getDestDriveLetter().replace(/:$/, '') + ':';
    const defaultDl = `${hddLetter}\\Descargas`;

    els.browserList.innerHTML = browsers.map((b) => `
      <div class="browser-item">
        <div style="color:var(--green);margin-bottom:6px">${escHtml(b.name)}</div>
        <div style="font-size:11px;color:var(--text-muted)">Ubicación actual: ${escHtml(b.currentDownloadPath)}</div>
        ${b.canAutoConfigure
          ? `<button class="btn btn-secondary btn-set-download" data-id="${b.id}" data-path="${escHtml(defaultDl)}" style="margin-top:8px">
               Configurar → ${escHtml(defaultDl)}
             </button>`
          : `<p class="note" style="margin-top:8px">${escHtml(b.instructions)}</p>`
        }
      </div>
    `).join('');

    els.browserList.querySelectorAll('.btn-set-download').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const result = await window.diskMaster.setBrowserDownload(btn.dataset.id, btn.dataset.path);
        if (result.success) {
          terminalLog(`Descargas de ${btn.dataset.id} → ${btn.dataset.path}`);
          btn.textContent = '✓ Configurado';
        } else if (result.instructions) {
          terminalLog(result.instructions, 'warn');
        }
      });
    });
  }

  // --- Preview & Execute ---
  async function previewActions_flow(andExecute = false) {
    const selectedIds = getSelectedIds();
    if (!selectedIds.length && !state.folderRedirects.length) {
      showConfirm('No hay elementos seleccionados. Selecciona al menos uno en la tabla de recomendaciones.', () => {});
      return;
    }

    if (!state.destPath) {
      showConfirm('Debe seleccionar una unidad de destino antes de continuar.<br><br>Use el botón <strong>Seleccionar Unidad</strong> o <strong>Examinar</strong>.', () => {});
      return;
    }

    const plan = buildPlan(selectedIds);
    const preview = await window.diskMaster.buildPreview(plan);

    if (preview.error) {
      showConfirm(`No se puede continuar:<br><br>${escHtml(preview.error)}`, () => {});
      return;
    }

    renderPreview(preview);
    els.previewModal.hidden = false;
    els.executionProgress.hidden = true;
    $('#preview-execute').hidden = false;

    if (andExecute) await executePlan();
  }

  function buildPlan(selectedIds) {
    return {
      selectedIds,
      folderRedirects: state.folderRedirects,
      destBase: state.destPath
    };
  }

  function getSelectedIds() {
    return state.recommendations
      .filter((r) => r.selected)
      .map((r) => r.id || r.key || r.name);
  }

  function renderPreview(preview) {
    const moveCount = preview.moveActions?.length || preview.actions?.filter((a) => a.type === 'move').length || 0;
    const redirectCount = preview.redirectActions?.length || preview.actions?.filter((a) => a.type === 'redirect').length || 0;

    els.previewActions.innerHTML = (preview.actions || []).map((a) =>
      `<li>${escHtml(a.name)} — ${a.sizeFormatted || ''} (${a.type === 'redirect' ? 'cambiar ruta' : 'mover'})${a.error ? ` <span style="color:var(--error)">[${escHtml(a.error)}]</span>` : ''}</li>`
    ).join('') || '<li>Ninguna acción seleccionada</li>';

    els.previewSpace.textContent = preview.summary?.spaceToFreeFormatted || '0 B';
    els.previewDest.textContent = preview.summary?.destBase || state.destPath || '—';

    const risks = [...(preview.risks || [])];
    if (state.simulationMode) {
      risks.unshift('MODO SIMULACIÓN ACTIVO — no se modificarán archivos.');
    }
    risks.push(`Resumen: ${moveCount} movimiento(s), ${redirectCount} redirección(es).`);

    els.previewRisks.innerHTML = risks.length
      ? risks.map((r) => `<p>⚠ ${escHtml(r)}</p>`).join('')
      : '';
  }

  async function executePlan() {
    if (!state.destPath) {
      showConfirm('Debe seleccionar un destino antes de ejecutar.', () => {});
      return;
    }

    if (!state.simulationMode) {
      const confirmed = await confirmExecution();
      if (!confirmed) return;
    }

    $('#preview-execute').hidden = true;
    els.executionProgress.hidden = false;
    setStatus('ejecutando', 'busy');

    const selectedIds = getSelectedIds();
    const plan = buildPlan(selectedIds);

    try {
      const result = await window.diskMaster.executePlan(plan);

      renderExecSteps(result.steps || []);
      els.execProgressBar.style.width = '100%';

      const failed = result.moveResults?.errors?.length || 0;
      const processed = result.moveResults?.processed || 0;
      const total = result.moveResults?.total || 0;

      els.execDetail.textContent = result.simulation
        ? 'Simulación completada — no se realizaron cambios'
        : failed
          ? `Completado con ${failed} error(es). Procesados: ${processed}/${total}`
          : `Procesados correctamente: ${processed}/${total}`;

      state.lastReport = result.report;
      showReport(result.report, result.simulation);

      if (result.error) {
        terminalLog(result.error, 'error');
      } else if (!result.simulation) {
        terminalLog('Operación completada.');
        await analyzeSystem();
      } else {
        terminalLog('Simulación completada — revise el reporte');
      }

      setStatus('listo', 'ok');
    } catch (err) {
      terminalLog(`Error en ejecución: ${err.message}`, 'error');
      setStatus('error', 'error');
    }
  }

  function renderExecSteps(steps) {
    els.execSteps.innerHTML = steps.map((s) => {
      const icon = s.status === 'completed' ? '✓'
        : s.status === 'running' ? '◉'
        : s.status === 'warning' ? '⚠' : '○';
      const cls = s.status === 'completed' ? 'done'
        : s.status === 'running' ? 'running' : 'pending';
      return `<div class="exec-step"><span class="step-icon ${cls}">${icon}</span>${escHtml(s.label)}</div>`;
    }).join('');
  }

  function handleProgress({ channel, data }) {
    if (channel === 'execution' && data.steps) {
      renderExecSteps(data.steps);
      const completed = data.steps.filter((s) => s.status === 'completed').length;
      const total = data.steps.length;
      els.execProgressBar.style.width = `${Math.round((completed / total) * 100)}%`;
      if (data.detail) els.execDetail.textContent = data.detail;
    }
    if (channel === 'move-progress' && data.item) {
      els.execDetail.textContent = `Moviendo: ${data.item.name} (${data.current}/${data.total})`;
    }
  }

  // --- Report ---
  function showReport(report, simulated) {
    els.reportBody.innerHTML = `
      <div class="report-grid">
        <div class="report-block">
          <h4>SSD</h4>
          <div class="report-row"><span>Antes:</span><span>${report.ssd.before}</span></div>
          <div class="report-row"><span>Después:</span><span style="color:var(--green)">${report.ssd.after}</span></div>
          <div class="report-row"><span>Liberado:</span><span style="color:var(--green)">${report.ssd.freed}</span></div>
        </div>
        <div class="report-block">
          <h4>HDD</h4>
          <div class="report-row"><span>Antes:</span><span>${report.hdd.before}</span></div>
          <div class="report-row"><span>Después:</span><span>${report.hdd.after}</span></div>
        </div>
        <div class="report-block">
          <h4>ACCIONES ${simulated ? '(SIMULACIÓN)' : ''}</h4>
          ${report.actions.map((a) => `<div class="report-row"><span>✓ ${escHtml(a.name)}</span></div>`).join('')}
        </div>
        <div class="report-block">
          <h4>ERRORES: ${report.errors}</h4>
          ${report.errorDetails.length
            ? report.errorDetails.map((e) => `<div style="color:var(--error);font-size:11px">${escHtml(e)}</div>`).join('')
            : '<div style="color:var(--green)">Ninguno</div>'
          }
        </div>
      </div>
    `;
    els.reportModal.hidden = false;
  }

  async function exportReport(format) {
    if (!state.lastReport) return;
    await window.diskMaster.exportReport(state.lastReport, format);
  }

  // --- Helpers ---
  function closePreview() {
    els.previewModal.hidden = true;
  }

  function showConfirm(html, onConfirm) {
    $('#confirm-body').innerHTML = html;
    els.confirmModal.hidden = false;

    const okBtn = $('#confirm-ok');
    const newOk = okBtn.cloneNode(true);
    okBtn.parentNode.replaceChild(newOk, okBtn);
    newOk.addEventListener('click', () => {
      els.confirmModal.hidden = true;
      onConfirm();
    });
  }

  async function selectDestFolder() {
    const folder = await window.diskMaster.selectFolder();
    if (folder) {
      // Validación básica de la ruta seleccionada
      const folderStr = String(folder).trim();
      if (!folderStr) {
        showConfirm('La ruta seleccionada está vacía. Por favor seleccione una carpeta válida.', () => {});
        return;
      }
      
      // Validar que no sea una ruta del sistema
      const lowerFolder = folderStr.toLowerCase();
      if (lowerFolder.includes('windows') || lowerFolder.includes('system32') || 
          lowerFolder.includes('program files') || lowerFolder.includes('programdata')) {
        showConfirm('No se pueden seleccionar carpetas del sistema como destino. Por favor seleccione otra carpeta.', () => {});
        return;
      }
      
      // Validar que la ruta tenga un formato válido
      if (process.platform === 'win32' && !/^[A-Za-z]:\\/.test(folderStr)) {
        showConfirm('La ruta seleccionada no tiene un formato válido de Windows. Por favor seleccione una carpeta válida.', () => {});
        return;
      }
      
      state.destPath = folderStr;
      els.destPath.value = folderStr;
      renderDestInfo();
      terminalLog(`Destino seleccionado: ${folderStr}`);
    }
  }

  async function selectDestDrive() {
    if (!state.availableDestinations.length) {
      if (!state.disks.length) {
        terminalLog('Analice el sistema primero para detectar unidades disponibles.', 'warn');
        return;
      }
      state.availableDestinations = await window.diskMaster.getAvailableDestinations();
    }

    if (!state.availableDestinations.length) {
      showConfirm(
        'No hay unidades de destino válidas disponibles.<br><br>' +
        'Se requiere una unidad secundaria (por ejemplo <strong>D:</strong>) con al menos 1 GB libre.<br>' +
        'La unidad del sistema (<strong>C:</strong>) no puede usarse como destino.',
        () => {}
      );
      return;
    }

    openDriveModal();
  }

  function openDriveModal() {
    const recommendedLetter = state.recommendedDestination?.letter;

    els.driveOptions.innerHTML = state.availableDestinations.map((drive) => {
      const isRecommended = drive.letter === recommendedLetter;
      return `
        <button type="button" class="drive-option${isRecommended ? ' recommended' : ''}" data-letter="${escHtml(drive.letter)}">
          <div>
            <div class="drive-option-title">${escHtml(drive.letter)} — ${escHtml(drive.mediaType)}</div>
            <div class="drive-option-meta">${formatBytes(drive.usedBytes)} usados / ${formatBytes(drive.freeBytes)} libres (${drive.percentUsed}%)</div>
          </div>
          ${isRecommended ? '<span class="drive-option-badge">RECOMENDADA</span>' : ''}
        </button>
      `;
    }).join('');

    els.driveModalHint.textContent = recommendedLetter
      ? `Se recomienda ${recommendedLetter}. No se permite la unidad del sistema.`
      : 'Seleccione una unidad secundaria válida.';

    els.driveOptions.querySelectorAll('.drive-option').forEach((btn) => {
      btn.addEventListener('click', () => {
        const letter = btn.dataset.letter;
        applyDestinationDrive(letter);
        closeDriveModal();
      });
    });

    els.driveModal.hidden = false;
  }

  function closeDriveModal() {
    els.driveModal.hidden = true;
  }

  function applyDestinationDrive(letter) {
    state.destPath = `${letter}\\DiskMasterData`;
    els.destPath.value = state.destPath;
    renderDestInfo();
    renderFolderRedirects(state.folderLocations);
    renderBrowsers(state.browsers);
    terminalLog(`Unidad seleccionada: ${letter}`);
  }

  function confirmExecution() {
    return new Promise((resolve) => {
      $('#confirm-body').innerHTML =
        `<strong>Confirmación final</strong><br><br>` +
        `Destino: <span class="path-new">${escHtml(state.destPath)}</span><br>` +
        `Elementos seleccionados: ${getSelectedIds().length}<br>` +
        `Redirecciones programadas: ${state.folderRedirects.length}<br><br>` +
        `<strong style="color:var(--warning)">¿Ejecutar operación real?</strong>`;

      els.confirmModal.hidden = false;

      const okBtn = $('#confirm-ok');
      const cancelBtn = $('#confirm-cancel');
      const newOk = okBtn.cloneNode(true);
      const newCancel = cancelBtn.cloneNode(true);
      okBtn.parentNode.replaceChild(newOk, okBtn);
      cancelBtn.parentNode.replaceChild(newCancel, cancelBtn);

      newOk.addEventListener('click', () => {
        els.confirmModal.hidden = true;
        resolve(true);
      });
      newCancel.addEventListener('click', () => {
        els.confirmModal.hidden = true;
        resolve(false);
      });
    });
  }

  function formatBytes(bytes) {
    if (!bytes || isNaN(bytes)) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(Math.abs(bytes)) / Math.log(k));
    return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
  }

  function escHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // Boot
  document.addEventListener('DOMContentLoaded', init);
})();
