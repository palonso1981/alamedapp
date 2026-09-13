# RC2 · Fiabilidad multidispositivo y offline

Estado: implementación DEV en `feature/rc2-reliability`. No es un despliegue de producción. Las reglas incluidas no se han desplegado automáticamente.

## Contrato de captura

- El bloqueo es exclusivamente por `matchId`: un escritor por partido, pero cualquier número de partidos diferentes puede capturarse a la vez, incluso con el mismo acceso compartido.
- `AccessSession` autoriza el acceso a la aplicación. `MatchCaptureLease` controla una captura concreta; son conceptos independientes.
- El lease vive en `matchCaptureLeases/{matchId}` y contiene solo `matchId`, `clubId`, `teamId`, `captureSessionId`, `accessId`, `deviceInstallId`, estado y tiempos/revisión técnica.
- `deviceInstallId` reutiliza la identidad aleatoria y persistente de RC1. No es una identidad personal ni un fingerprint. La interfaz nunca atribuye la captura a una persona.
- Adquirir, renovar, liberar y tomar control se ejecutan mediante transacciones Firestore. Dos adquisiciones online simultáneas solo pueden dejar un lease vigente.
- Heartbeat: cada 60 segundos y al volver la pestaña a primer plano. Caducidad: 180 segundos. Una pausa breve no abre inmediatamente un segundo escritor.
- Coste aproximado: una captura de 40 minutos mantiene unas 40 renovaciones, más adquisición y liberación (aprox. 42 escrituras de lease por partido; algo más con pausas o reanudaciones). No se escribe cada segundo y no se requieren Functions ni Blaze.
- Finalizar y vaciar la cola, salir mediante el control de Partidos o cambiar de acceso intentan liberar el lease. Un cierre abrupto se resuelve por caducidad.

## Takeover, offline y particiones

- Otro dispositivo con lease activo ve el Directo bloqueado y puede consultar sin escribir. ADMIN/EDITOR puede iniciar un relevo mediante una confirmación explícita.
- Un lease stale puede adquirirse de nuevo. VIEWER nunca adquiere, renueva ni toma control.
- Si un dispositivo ya tenía control y pierde red, puede seguir capturando. Su sesión y outbox se conservan localmente; al reconectar primero revalida el lease y solo después sincroniza.
- Si el partido empieza ya offline y no existía control verificable, la captura solo se habilita tras aceptar `INICIAR CAPTURA OFFLINE BAJO RIESGO`. La sesión queda `UNVERIFIED` y no se envía hasta verificarse.
- Limitación inevitable: durante una partición, Firebase no puede avisar al dispositivo aislado de un takeover. No se promete exclusividad absoluta offline.
- Si A reconecta y B tomó el control, todas las operaciones de la sesión A permanecen íntegras y pasan a conflicto `CAPTURE_LEASE_MISMATCH`. No se suben, no se deduplican por parecido y no pisan la captura B.

## Event Sourcing, revisiones y outbox

- La cronología sigue siendo la única verdad deportiva. El lease no contiene marcador, alineación ni eventos.
- `eventId`, `period + minute + order`, `createdAt`, `provenance`, `sequenceId` y `parentEventId` no cambian.
- Cada operación creada en Directo puede incorporar `captureSessionId`, `captureAccessId` y `captureDeviceInstallId`; son metadata técnica backward-compatible. Operaciones legacy carecen de ella y conservan su comportamiento.
- Un retry mantiene `operationId`, `eventId` y `baseRevision`; el ACK remoto conserva idempotencia. Dos eventos distintos de dos capturas no se consideran duplicados aunque compartan minuto, coordenadas o resultado.
- PENDING/SYNCING y errores transitorios son trabajo enviable. PERMISSION, INVALID_DATA, FATAL y CONFLICT son terminales preservados: no se borran ni se anuncian como un retry normal.
- El indicador, el guard de cambio de acceso y la liberación usan la misma semántica `blocksAccessChange`.
- Cerrar y reabrir recupera sesión, outbox, revisiones, conflictos e IDs. Las operaciones `SYNCING` ya se migraban a `PENDING` con el mismo `operationId`.

## Revocación y recuperación

- Si un acceso se revoca mientras captura offline, al reconectar Firestore devuelve permiso denegado. La operación pasa a error terminal, el Directo se bloquea y la copia local no se elimina ni se reintenta con otra identidad.
- El panel de nube muestra `ACCESO REVOCADO` o `CONTROL DEL PARTIDO PERDIDO`, y permite `EXPORTAR RECUPERACIÓN`.
- El bundle JSON incluye el partido completo, eventos, outbox, revisiones, conflictos y sesión de captura. La exportación es de solo lectura y conserva IDs exactos.
- Recuperación V1: un ADMIN recoge el JSON desde el dispositivo afectado y lo conserva como evidencia para reconciliación controlada. RC2 no autoimporta ni decide qué cronología gana; esa incorporación debe hacerse con una herramienta administrativa revisable antes de producción.

## Rules DEV

`matchCaptureLeases/{matchId}` permite `get` exacto según el club/equipo autorizado, nunca `list`, y solo permite `create/update` a ADMIN/EDITOR con AccessSession válida. Valida identidad del partido, acceso de sesión, tipos, timestamps y revisión incremental. VIEWER no escribe y el borrado físico está prohibido.

Despliegue manual, únicamente cuando el usuario lo autorice:

```powershell
cd C:\AlamedAPP
npx firebase-tools deploy --only firestore:rules --project cdalameda-dev
```

## Inventario DEV y Chelva

No se ha escrito, borrado ni migrado ningún documento durante RC2. La consola remota exige una sesión Google que el entorno automatizado no pudo abrir de forma segura, por lo que el inventario exacto sigue pendiente de una lectura autenticada. No se infieren IDs ni cifras.

Evidencia local versionada:

- `docs/matches-v2-6.md` confirma una prueba contra Chelva y señala estimaciones de vídeo con 1–3 segundos de diferencia mediante anchors separados.
- No hay en el repositorio un `matchId`, fecha, equipo/temporada o recuento de eventos que identifique inequívocamente ese documento remoto.
- Hasta completar la lectura remota, Chelva se clasifica como **dato potencialmente real/ambiguo que no debe tocarse**.
- Sus coordenadas pueden proceder de una etapa anterior a la orientación canónica. No deben reinterpretarse, girarse ni “arreglarse” automáticamente.

Inventario que debe obtenerse antes de PROD, en modo lectura: clubes, equipos, temporadas, plantilla/staff, partidos y subcolecciones `events`, segmentos/anchors/overrides, accesos/sesiones/mappings y leases. Para Chelva: `matchId`, fecha, club/equipo/temporada, rival, número de eventos, provenance, vídeo, anchors, overrides y versión geométrica.

Clasificación exigida al inventariar: fixture/test inequívoco, ambiguo o potencialmente real. El nombre del rival no basta.

## Recuperación ADMIN y auditoría de backup

Si se pierden todos los códigos ADMIN:

```powershell
cd C:\AlamedAPP
npm run access:bootstrap -- <clubId> "<etiqueta>"
```

Este procedimiento no recupera un código antiguo: genera un nuevo bootstrap ADMIN y requiere provisionado controlado. No debe usarse en operativa normal y nunca almacena el código en texto plano.

El futuro backup deberá cubrir `clubs` y sus entidades deportivas/Access, `matches/{matchId}` y `events`, `matchCaptureLeases`, `accessCodes`, referencias de imágenes Cloudinary y, mientras exista trabajo no confirmado, almacenamiento local de partidos, outbox, conflictos, revisiones y sesiones de captura.

## Pendiente para RC3

1. Separación formal DEV/PROD y creación de PROD limpio.
2. Backup/restore probado antes de temporada.
3. Inventario remoto autenticado y migración selectiva opcional de Chelva, conservando versión/orientación original.
4. Herramienta administrativa auditada para importar bundles de recuperación y resolver doble captura sin pérdida.
5. Hosting, observabilidad y política operativa de dispositivos.
