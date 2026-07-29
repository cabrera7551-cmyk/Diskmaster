/* DISKMASTER v2.0 — navegacion y datos mock (maqueta visual, sin IPC ni logica real) */

(function () {
  'use strict';

  var MOCK = {
    metrics: [
      { label: 'usado', value: '312 GB', note: '65% de la unidad C:' },
      { label: 'libre', value: '168 GB', note: '35% disponible' },
      { label: 'duplicados', value: '6.2 GB', note: '142 archivos repetidos' }
    ],
    usage: [
      { label: 'sistema', percent: 22, color: 'var(--seg-1)' },
      { label: 'documentos', percent: 15, color: 'var(--seg-2)' },
      { label: 'multimedia', percent: 28, color: 'var(--seg-3)' }
    ],
    largeFiles: [
      { name: 'backup_proyecto.zip', size: '2.1 GB' },
      { name: 'captura_pantalla.mp4', size: '1.4 GB' },
      { name: 'node_modules.cache', size: '890 MB' }
    ],
    drives: [
      { label: 'C: // sistema', value: '480 GB', note: 'SSD NVMe — 312 GB usados' },
      { label: 'D: // datos', value: '1.0 TB', note: 'HDD — 640 GB usados' },
      { label: 'E: // respaldo', value: '2.0 TB', note: 'HDD externo — 210 GB usados' }
    ],
    analyzeProgress: [
      { label: 'C:\\Windows', status: 'completado', percent: 100 },
      { label: 'C:\\Usuarios\\kevin', status: 'completado', percent: 100 },
      { label: 'C:\\Program Files', status: 'analizando', percent: 62 },
      { label: 'D:\\Proyectos', status: 'en cola', percent: 0 }
    ],
    explore: [
      { name: 'Descargas', type: 'carpeta', size: '18.4 GB', modified: '2026-07-28 21:14' },
      { name: 'Documentos', type: 'carpeta', size: '6.9 GB', modified: '2026-07-27 09:02' },
      { name: 'Videos', type: 'carpeta', size: '42.1 GB', modified: '2026-07-25 18:47' },
      { name: 'Proyectos', type: 'carpeta', size: '11.2 GB', modified: '2026-07-29 01:33' },
      { name: 'backup_proyecto.zip', type: 'archivo', size: '2.1 GB', modified: '2026-07-24 12:10' },
      { name: 'captura_pantalla.mp4', type: 'archivo', size: '1.4 GB', modified: '2026-07-22 16:55' },
      { name: 'node_modules.cache', type: 'archivo', size: '890 MB', modified: '2026-07-21 08:20' },
      { name: 'notas.txt', type: 'archivo', size: '12 KB', modified: '2026-07-20 23:41' }
    ],
    manage: [
      { name: 'backup_proyecto.zip', location: 'C:\\Usuarios\\kevin\\Descargas', size: '2.1 GB', state: 'listo para mover' },
      { name: 'captura_pantalla.mp4', location: 'C:\\Usuarios\\kevin\\Videos', size: '1.4 GB', state: 'listo para mover' },
      { name: 'node_modules.cache', location: 'C:\\Proyectos\\diskmaster', size: '890 MB', state: 'seguro de limpiar', accent: true },
      { name: 'temp_instaladores', location: 'C:\\Temp', size: '3.4 GB', state: 'seguro de limpiar', accent: true },
      { name: 'fotos_2024 (duplicado)', location: 'C:\\Usuarios\\kevin\\Imagenes', size: '1.2 GB', state: 'revisar' }
    ],
    recommendations: [
      { item: 'C:\\Temp\\temp_instaladores', size: '3.4 GB', type: 'temporales', action: 'eliminar' },
      { item: 'C:\\Usuarios\\kevin\\Descargas\\backup_proyecto.zip', size: '2.1 GB', type: 'respaldo', action: 'mover a D:' },
      { item: 'C:\\Usuarios\\kevin\\Videos\\captura_pantalla.mp4', size: '1.4 GB', type: 'multimedia', action: 'mover a D:' },
      { item: 'C:\\Proyectos\\diskmaster\\node_modules.cache', size: '890 MB', type: 'cache', action: 'eliminar' },
      { item: 'C:\\Usuarios\\kevin\\Imagenes\\fotos_2024', size: '1.2 GB', type: 'duplicado', action: 'revisar' }
    ],
    toggles: [
      { label: 'modo simulacion', desc: 'mostrar cambios sin aplicarlos', checked: true },
      { label: 'analisis al iniciar', desc: 'escanear unidades al abrir la app', checked: false },
      { label: 'confirmar antes de mover', desc: 'pedir confirmacion en cada accion', checked: true },
      { label: 'crear respaldo automatico', desc: 'copia de seguridad previa a limpiar', checked: true },
      { label: 'notificaciones', desc: 'avisar al terminar un analisis', checked: false }
    ],
    paths: [
      { label: 'ruta de instalaciones', desc: 'destino sugerido para nuevos programas', value: 'D:\\Programas' },
      { label: 'ruta de descargas', desc: 'carpeta redirigida del navegador', value: 'D:\\Descargas' },
      { label: 'ruta de respaldos', desc: 'ubicacion de las copias de seguridad', value: 'E:\\Respaldos\\diskmaster' }
    ],
    history: [
      { time: '2026-07-29 03:42', text: 'scan --drive C: // 312 GB usados, 142 duplicados', accent: true },
      { time: '2026-07-29 03:18', text: 'move C:\\Descargas\\backup_proyecto.zip -> D:\\Respaldos' },
      { time: '2026-07-28 22:05', text: 'clean --temp // 3.4 GB liberados', accent: true },
      { time: '2026-07-28 19:47', text: 'scan --drive D: // 640 GB usados' },
      { time: '2026-07-28 11:30', text: 'config set install-path D:\\Programas' },
      { time: '2026-07-27 16:12', text: 'backup create // 1.8 GB en E:\\Respaldos' },
      { time: '2026-07-27 09:55', text: 'recommend --min-size 500MB // 5 sugerencias' },
      { time: '2026-07-26 20:03', text: 'scan --all // 3 unidades detectadas' }
    ]
  };

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function renderMetrics(container, items) {
    if (!container) return;
    container.textContent = '';
    items.forEach(function (item) {
      var card = el('div', 'metric-card');
      card.appendChild(el('div', 'metric-label', item.label));
      card.appendChild(el('div', 'metric-value', item.value));
      if (item.note) card.appendChild(el('div', 'metric-note', item.note));
      container.appendChild(card);
    });
  }

  function renderUsage() {
    var bar = document.getElementById('usage-bar');
    var legend = document.getElementById('usage-legend');
    if (!bar || !legend) return;
    bar.textContent = '';
    legend.textContent = '';
    MOCK.usage.forEach(function (seg) {
      var fill = el('div', 'usage-seg');
      fill.style.width = seg.percent + '%';
      fill.style.background = seg.color;
      bar.appendChild(fill);

      var item = el('div', 'legend-item');
      var swatch = el('span', 'legend-swatch');
      swatch.style.background = seg.color;
      item.appendChild(swatch);
      item.appendChild(el('span', null, seg.label));
      legend.appendChild(item);
    });
  }

  function renderLargeFiles() {
    var list = document.getElementById('large-files');
    if (!list) return;
    list.textContent = '';
    MOCK.largeFiles.forEach(function (file) {
      var row = el('li', 'file-row');
      row.appendChild(el('span', 'file-name', file.name));
      row.appendChild(el('span', 'file-size', file.size));
      list.appendChild(row);
    });
  }

  function renderAnalyzeProgress() {
    var container = document.getElementById('analyze-progress');
    if (!container) return;
    container.textContent = '';
    MOCK.analyzeProgress.forEach(function (entry) {
      var row = el('div', 'progress-row');
      var meta = el('div', 'progress-meta');
      meta.appendChild(el('span', null, entry.label));
      var status = el('strong', null, entry.status + ' ' + entry.percent + '%');
      meta.appendChild(status);
      row.appendChild(meta);

      var track = el('div', 'progress-track');
      var fill = el('div', 'progress-fill');
      fill.style.width = entry.percent + '%';
      track.appendChild(fill);
      row.appendChild(track);
      container.appendChild(row);
    });
  }

  function renderExplore() {
    var body = document.getElementById('explore-body');
    if (!body) return;
    body.textContent = '';
    MOCK.explore.forEach(function (entry) {
      var tr = el('tr');
      tr.appendChild(el('td', 'cell-name', entry.name));
      var typeCell = el('td');
      typeCell.appendChild(el('span', 'tag', entry.type));
      tr.appendChild(typeCell);
      tr.appendChild(el('td', 'cell-size', entry.size));
      tr.appendChild(el('td', null, entry.modified));
      body.appendChild(tr);
    });
  }

  function renderManage() {
    var body = document.getElementById('manage-body');
    if (!body) return;
    body.textContent = '';
    MOCK.manage.forEach(function (entry, index) {
      var tr = el('tr');

      var checkCell = el('td', 'col-check');
      var checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.id = 'manage-item-' + index;
      checkbox.setAttribute('aria-label', 'seleccionar ' + entry.name);
      checkCell.appendChild(checkbox);
      tr.appendChild(checkCell);

      tr.appendChild(el('td', 'cell-name', entry.name));
      tr.appendChild(el('td', null, entry.location));
      tr.appendChild(el('td', 'cell-size', entry.size));

      var stateCell = el('td');
      stateCell.appendChild(el('span', entry.accent ? 'tag tag-accent' : 'tag', entry.state));
      tr.appendChild(stateCell);

      body.appendChild(tr);
    });
  }

  function renderRecommendations() {
    var body = document.getElementById('recommendations-body');
    if (!body) return;
    body.textContent = '';
    MOCK.recommendations.forEach(function (entry) {
      var tr = el('tr');
      tr.appendChild(el('td', 'cell-name', entry.item));
      tr.appendChild(el('td', 'cell-size', entry.size));
      tr.appendChild(el('td', null, entry.type));
      var actionCell = el('td');
      actionCell.appendChild(el('span', 'tag tag-accent', entry.action));
      tr.appendChild(actionCell);
      body.appendChild(tr);
    });
  }

  function renderSettings() {
    var toggles = document.getElementById('settings-toggles');
    if (toggles) {
      toggles.textContent = '';
      MOCK.toggles.forEach(function (entry, index) {
        var row = el('div', 'setting-row');
        var info = el('div');
        var label = el('label', 'setting-label', entry.label);
        label.setAttribute('for', 'toggle-' + index);
        info.appendChild(label);
        info.appendChild(el('div', 'setting-desc', entry.desc));
        row.appendChild(info);

        var toggle = el('span', 'toggle');
        var input = document.createElement('input');
        input.type = 'checkbox';
        input.id = 'toggle-' + index;
        input.checked = entry.checked;
        toggle.appendChild(input);
        toggle.appendChild(el('span', 'toggle-track'));
        row.appendChild(toggle);

        toggles.appendChild(row);
      });
    }

    var paths = document.getElementById('settings-paths');
    if (paths) {
      paths.textContent = '';
      MOCK.paths.forEach(function (entry) {
        var row = el('div', 'setting-row');
        var info = el('div');
        info.appendChild(el('div', 'setting-label', entry.label));
        info.appendChild(el('div', 'setting-desc', entry.desc));
        row.appendChild(info);
        row.appendChild(el('span', 'path-value', entry.value));
        paths.appendChild(row);
      });
    }
  }

  function renderHistory() {
    var log = document.getElementById('history-log');
    if (!log) return;
    log.textContent = '';
    MOCK.history.forEach(function (entry) {
      var row = el('div', entry.accent ? 'log-row is-accent' : 'log-row');
      row.appendChild(el('span', 'log-time', '[' + entry.time + ']'));
      row.appendChild(el('span', 'log-text', entry.text));
      log.appendChild(row);
    });
  }

  function showView(name) {
    var views = document.querySelectorAll('.view');
    for (var i = 0; i < views.length; i++) {
      views[i].classList.toggle('active', views[i].id === 'view-' + name);
    }
    var items = document.querySelectorAll('.nav-item');
    for (var j = 0; j < items.length; j++) {
      items[j].classList.toggle('active', items[j].dataset.view === name);
    }
    window.scrollTo(0, 0);
  }

  function initNav() {
    var nav = document.getElementById('sidebar-nav');
    if (!nav) return;
    nav.addEventListener('click', function (event) {
      var item = event.target.closest('.nav-item');
      if (!item) return;
      showView(item.dataset.view);
    });
  }

  function init() {
    renderMetrics(document.getElementById('metric-cards'), MOCK.metrics);
    renderMetrics(document.getElementById('analyze-drives'), MOCK.drives);
    renderUsage();
    renderLargeFiles();
    renderAnalyzeProgress();
    renderExplore();
    renderManage();
    renderRecommendations();
    renderSettings();
    renderHistory();
    initNav();
  }

  document.addEventListener('DOMContentLoaded', init);
})();
