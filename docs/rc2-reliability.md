# RC2 · Fiabilidad multidispositivo y offline

Estado: cierre técnico DEV en `feature/rc2-reliability`. No es un despliegue de producción. Las Rules RC2 fueron desplegadas manualmente en `cdalameda-dev`; este cierre no ejecuta ningún despliegue ni operación remota.

## Contrato de captura

- El bloqueo es exclusivamente por `matchId`: un escritor por partido, pero cualquier número de partidos diferentes puede capturarse a la vez, incluso con el mismo acceso compartido.
- `AccessSession` autoriza el acceso a la aplicación. `MatchCaptureLease` controla una captura concreta; son conceptos independientes.
- El lease vive en `matchCaptureLeases/{matchId}` y contiene solo `matchId`, `clubId`, `teamId`, `captureSessionId`, `accessId`, `deviceInstallId`, estado y tiempos/revisión técnica.
- `deviceInstallId` reutiliza la identidad aleatoria y persistente de RC1. No es una identidad personal ni un fingerprint. La interfaz nunca atribuye la captura a una persona.
- Adquirir, renovar, liberar y tomar control se ejecutan mediante transacciones Firestore. Dos adquisiciones online simultáneas solo pueden dejar un lease vigente.
- Heartbeat: cada 60 segundos y al volver la pestaña a primer plano. Caducidad: 180 segundos. Una pausa breve no abre inmediatamente un segundo escritor.
- Coste aproximado: una captura de 40 minutos mantiene unas 40 renovaciones, más adquisición y liberación (aprox. 42 escrituras de lease por partido; algo más con pausas o reanudaciones). No se escribe cada segundo y no se requieren Functions ni Blaze.
- Finalizar y vaciar la cola, salir mediante el control de Partidos o cambiar de acceso intentan liberar el lease. Un cierre abrupto se resuelve por caducidad.

### Documento `matchCaptureLeases/{matchId}`

| Campo | Tipo / contrato |
| --- | --- |
| `entityType` | literal `CAPTURE_LEASE` |
| `matchId` | ID exacto del documento y del partido |
| `clubId`, `teamId` | deben coincidir con la preparación del partido padre |
| `captureSessionId` | UUID técnico de una sesión de captura; no identifica a una persona |
| `accessId` | acceso activo que obtuvo el control |
| `deviceInstallId` | ID aleatorio persistente de instalación; no fingerprint |
| `status` | `ACTIVE` o `RELEASED` |
| `acquiredAt` | instante de adquisición; se conserva al reanudar el mismo propietario |
| `lastSeenAt` | último heartbeat/adquisición/liberación |
| `expiresAt` | vencimiento operativo; `lastSeenAt + 180 s` mientras está activo |
| `revision` | entero iniciado en 1 e incrementado exactamente en cada actualización |

Firestore guarda los tres tiempos como `timestamp`; el dominio los representa en milisegundos. `stale` no se persiste: se deriva cuando `status != ACTIVE` o `expiresAt <= now`. Adquirir un lease inexistente o stale crea un nuevo propietario; reanudar exige la misma sesión y dispositivo; takeover sustituye explícitamente al propietario conservando revisión incremental. Heartbeat y release solo son válidos para el propietario vigente.

Las Rules permiten `get` exacto a una sesión con scope sobre el club/equipo del partido, nunca `list`. Solo ADMIN/EDITOR con AccessSession y Access activos pueden crear/actualizar; VIEWER no puede escribir. No existe hard delete: liberar cambia el estado a `RELEASED`.

## Takeover, offline y particiones

- Otro dispositivo con lease activo ve el Directo bloqueado y puede consultar sin escribir. ADMIN/EDITOR puede iniciar un relevo mediante una confirmación explícita.
- Un lease stale puede adquirirse de nuevo. VIEWER nunca adquiere, renueva ni toma control.
- Si un dispositivo ya tenía control y pierde red, puede seguir capturando. Su sesión y outbox se conservan localmente; al reconectar primero revalida el lease y solo después sincroniza.
- Si el partido empieza ya offline y no existía control verificable, la captura solo se habilita tras aceptar `INICIAR CAPTURA OFFLINE BAJO RIESGO`. La sesión queda `UNVERIFIED` y no se envía hasta verificarse.
- Limitación inevitable: durante una partición, Firebase no puede avisar al dispositivo aislado de un takeover. No se promete exclusividad absoluta offline.
- Si A reconecta y B tomó el control, todas las operaciones de la sesión A permanecen íntegras y pasan a conflicto `CAPTURE_LEASE_MISMATCH`. No se suben, no se deduplican por parecido y no pisan la captura B.

## VIEWER

- Puede consultar Dashboard, Partidos, Plantilla, Revisión y Vídeo dentro de su scope CLUB/TEAMS.
- `/partido/{id}/directo` y las demás rutas de mutación se rechazan antes de montar la captura editable.
- `canMutateSports` es falso, la adquisición/takeover se deniega en el dominio y las Rules deniegan create/update del lease.
- No puede hacer heartbeat, liberar ni modificar un lease. Leer el partido o el lease exacto no cambia revisión, propietario ni vencimiento y no interfiere con el capturador activo.
- No se añade UI específica en este cierre: se mantienen sus pantallas de consulta ya autorizadas.

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

El JSON `ALAMEDAPP_MATCH_RECOVERY` V1 contiene `matchId`, versión y fecha de guardado, sesión deportiva completa (incluidos match, eventos e IDs originales), outbox con `operationId` y payload, revisiones remotas conocidas, estado/conflictos de sync y sesión técnica de captura. Es una lectura inmutable del almacenamiento local. No incluye el código de acceso, su plaintext ni `codeHash`; `accessId` y `deviceInstallId` son identificadores técnicos necesarios para diagnosticar la procedencia. El bundle debe custodiarse como dato sensible del partido aunque no contenga credenciales reutilizables.

## Matriz de validación RC2

`PASS MANUAL` refleja únicamente pruebas realizadas por el usuario. `PASS AUTOMATED` indica cobertura determinista; no se presenta como prueba física. La prueba de partición completa queda expresamente pendiente.

| Escenario | Estado | Evidencia / alcance |
| --- | --- | --- |
| Mismo partido, segundo escritor | PASS MANUAL · PASS AUTOMATED | B queda OCCUPIED; una carrera concede un solo lease |
| Partidos distintos simultáneos | PASS MANUAL · PASS AUTOMATED | lease aislado por `matchId` |
| Captura offline | PASS MANUAL · PASS AUTOMATED | eventos y outbox permanecen locales |
| Reconexión | PASS MANUAL · PASS AUTOMATED | revalidación previa y sync sin pérdida |
| Retry / idempotencia | PASS AUTOMATED | conserva `operationId`, `eventId` y `baseRevision` |
| Cierre / reapertura | PASS AUTOMATED | sesión, outbox, conflictos y revisiones sobreviven |
| Takeover mientras A está offline y posterior reconexión | PASS AUTOMATED · PENDING HOSTED VALIDATION | falta prueba física con dos dispositivos accesibles |
| Acceso revocado durante captura offline | PASS AUTOMATED | error terminal, payload preservado y export disponible |
| VIEWER sobre partido activo | PASS AUTOMATED | sin ruta editable, adquisición ni escritura de lease |
| Export de recuperación | PASS AUTOMATED | IDs, eventos, outbox, conflictos, revisiones y captura; sin secreto en claro |

### Prueba física pendiente en entorno alojado

1. A obtiene el lease.
2. A pierde conexión y registra 2–3 eventos.
3. B abre online el mismo partido y ejecuta takeover.
4. B registra 1–2 eventos y sincroniza.
5. A recupera conexión.

Resultado esperado: `CAPTURE_LEASE_MISMATCH`; A no autosincroniza las operaciones afectadas, conserva íntegros payload e IDs y ofrece export de recuperación; B mantiene intacta su cronología remota. Esta validación se hará en RC3/RC4 sobre una URL alojada. Su ausencia en localhost no es un fallo ni bloquea el cierre técnico RC2.

## Rules DEV

`matchCaptureLeases/{matchId}` permite `get` exacto según el club/equipo autorizado, nunca `list`, y solo permite `create/update` a ADMIN/EDITOR con AccessSession válida. Valida identidad del partido, acceso de sesión, tipos, timestamps y revisión incremental. VIEWER no escribe y el borrado físico está prohibido.

Despliegue manual, únicamente cuando el usuario lo autorice:

```powershell
cd C:\AlamedAPP
npx firebase-tools deploy --only firestore:rules --project cdalameda-dev
```

## Chelva

Decisión de producto: Chelva es un partido real y los convocados creados para él son personas reales. Debe poder migrarse selectivamente a PROD conservando IDs. El diseño del bundle y del proceso está en `docs/rc3-production-plan.md`; este cierre no lee, exporta, transforma ni migra datos remotos.

Las coordenadas se capturaron antes del cierre definitivo de la orientación canónica. Se conservarán como raw data, sin giro automático, heurísticas ni “corrección”. La limitación geométrica histórica no invalida identidad de jugadores, resultado, eventos, cronología, vídeo, sustituciones ni goles.

## Recuperación ADMIN y auditoría de backup

Si se pierden todos los códigos ADMIN:

```powershell
cd C:\AlamedAPP
npm run access:bootstrap -- <clubId> "<etiqueta>"
```

Este procedimiento excepcional genera un Access ADMIN y mapping nuevos para aprovisionamiento manual. No recupera códigos antiguos: SHA-256 no permite reconstruir el plaintext. El secreto se muestra una sola vez en la salida local y no se guarda en Firestore ni debe copiarse a Git. No se ha ejecutado durante este cierre.

El diseño de backup lógico, restore verificable, límites Spark y referencias Cloudinary se detalla en `docs/rc3-production-plan.md`.

## Cierre técnico

RC2 puede considerarse técnicamente cerrado: los escenarios centrales están validados manualmente y automatizados; la única validación física incompleta es el takeover con A aislado y reconectando, clasificada como `PENDING HOSTED VALIDATION`. No se crea PROD ni se despliega nada en este cierre.
