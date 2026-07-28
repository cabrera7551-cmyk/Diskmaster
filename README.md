# DISKMASTER_v1

Herramienta portable de escritorio para técnicos informáticos. Ayuda a analizar almacenamiento, identificar datos movibles del SSD al HDD, redirigir carpetas personales de Windows y ejecutar cambios de forma segura.

## Requisitos

- **Windows 10/11** (para funcionalidad completa)
- **Node.js 18+** (solo para desarrollo y compilación)

## Estructura

```
DiskMaster/
├── src/           # Proceso principal Electron
├── ui/            # Interfaz HTML/CSS/JS
├── services/      # Discos, análisis, movimiento, navegadores
├── modules/       # Recomendaciones, simulación, verificación
├── utils/         # Formato, logs, seguridad, PowerShell
├── reports/       # Generación de reportes
└── assets/        # Recursos estáticos
```

## Desarrollo

```bash
cd DiskMaster
npm install
npm start
```

## Compilar portable para Windows

Desde Windows (o cross-compile):

```bash
npm run build
```

Genera `dist/DiskMaster.exe` — ejecutable portable sin instalador.

## Uso

1. Copiar `DiskMaster.exe` a USB o carpeta local
2. Ejecutar en el equipo del cliente
3. **ANALIZAR SISTEMA** — detecta discos y carpetas
4. Revisar recomendaciones y seleccionar elementos
5. Activar **MODO SIMULACIÓN** para previsualizar sin cambios
6. **▶ EJECUTAR AHORA** — vista previa → confirmación → ejecución
7. Exportar reporte TXT/HTML al finalizar

## Seguridad

- No modifica Windows, System32 ni Program Files automáticamente
- No mueve programas instalados manualmente
- Verifica espacio en destino antes de mover
- Omite archivos bloqueados/en uso
- Siempre muestra vista previa antes de ejecutar

## Notas

- La redirección de carpetas de Windows usa el registro de usuario (Known Folders)
- Chrome/Edge: configuración de descargas automática; Firefox: instrucciones manuales
- Al cerrar la aplicación no quedan procesos en segundo plano
