# Persistencia real, Firebase DEV y offline-first V1

## Decisión arquitectónica

Directo continúa siendo **local-first**. Cada gesto sigue este orden:

1. el comando modifica la cronología local;
2. sesión y outbox se escriben juntas en el dispositivo;
3. Zustand actualiza replay y UI sin esperar a la red;
4. el coordinador intenta enviar únicamente las entidades modificadas.

Firebase nunca está en el camino crítico. Un fallo remoto no revierte ni elimina
la captura local.

## Fuente de verdad

Los `MatchEvent` siguen siendo la única fuente deportiva. Marcador, minutos,
alineación, disciplina y estados se reconstruyen mediante replay. Firestore no
mantiene copias agregadas autoritativas de esos valores.

La metadata remota contiene convocatoria y estado operativo del partido (reloj,
periodos cerrados y contexto de revisión), pero no resultados deportivos
calculados.

## Almacenamiento local

Se conserva `localStorage` en V1 porque una sesión de partido tiene un volumen
pequeño, su escritura síncrona encaja con el store existente y evita introducir
una hidratación asíncrona de IndexedDB en una pantalla ya validada. La garantía
durable no depende de la memoria de React ni de la caché de Firestore.

La envoltura `storageVersion: 2` guarda atómicamente bajo la misma clave:

- sesión y cronología;
- historial local de undo/redo;
- outbox;
- revisiones remotas conocidas;
- último sync, último error y conflictos.

El límite práctico de `localStorage` debe reevaluarse antes de añadir vídeo,
archivos o temporadas completas. Esos datos no deben incorporarse a esta
envoltura.

## Repositorios

- `LocalMatchRepository`: carga/guarda la sesión, calcula diferencias, compacta
  operaciones pendientes y administra el estado durable de sync.
- `RemoteMatchRepository`: contrato de aplicación idempotente de una operación.
- `FirestoreDevMatchRepository`: implementación Firestore mediante transacción.
- `MatchSyncCoordinator`: procesa la outbox sin bloquear captura, clasifica
  errores, reintenta y detiene sobrescrituras conflictivas.

El dominio y el motor de replay no importan `localStorage`, Firestore ni el SDK.

## Modelo Firestore

```text
matches/{matchId}
  schemaVersion
  matchId
  entityType = MATCH
  entityId
  revision
  lastOperationId
  clientUpdatedAt
  serverUpdatedAt
  removed = false
  payload = MatchRemoteMetadata

matches/{matchId}/events/{eventId}
  schemaVersion
  matchId
  entityType = EVENT
  entityId = eventId
  revision
  lastOperationId
  clientUpdatedAt
  serverUpdatedAt
  removed
  payload = MatchEvent
```

El ID de documento del evento es exactamente el UUID creado por el cliente. No
se usa `addDoc`. `sequenceId`, `parentEventId`, `pendingReview`, GoalTarget,
asistencia, soft delete y todos los campos discriminados viajan dentro del
evento sin cambiar sus identificadores.

Un undo que retira por completo un evento produce un tombstone remoto; soft
delete/restaurar continúan siendo UPSERT del mismo evento con su `deletedAt`.

## Outbox e idempotencia

Cada operación tiene un UUID estable antes del primer intento. Un retry conserva
ese ID. El documento remoto guarda `lastOperationId`; si el servidor aplicó la
transacción pero el cliente perdió el ACK, el siguiente intento devuelve
`ALREADY_APPLIED` sin incrementar revisión ni crear otro documento.

Mientras una operación de una entidad sigue `PENDING` o `ERROR`, nuevas
ediciones se compactan sobre ella conservando el ID y `baseRevision`. Una
operación ya `SYNCING` no se pisa: el cambio posterior queda encadenado y se
rebasa a la revisión confirmada al llegar el ACK.

Estados durables: `PENDING`, `SYNCING`, `ERROR` y `CONFLICT`. Una cola vacía con
`lastSyncedAt` representa `SYNCED`. Al reabrir la aplicación, cualquier
`SYNCING` interrumpido migra de nuevo a `PENDING` con el mismo ID.

## Revisiones y conflictos

Cada entidad remota tiene `revision`. La operación declara `baseRevision` y la
transacción solo escribe si coincide. El mismo `operationId` es una excepción
idempotente segura.

Si el remoto tiene otra revisión, se conserva:

- payload local pendiente;
- revisión y payload remotos;
- registro del conflicto;
- cronología local operativa.

No hay last-write-wins silencioso. V1 asume un registrador activo principal por
partido y todavía no ofrece merge gráfico de conflictos.

## Offline, cierre y reconexión

Sin red o sin configuración Firebase DEV, el partido carga y funciona desde el
registro local. Las operaciones quedan pendientes. Cerrar el navegador conserva
sesión y outbox en la misma envoltura. Al evento `online`, al montar Directo y
periódicamente mientras está abierto, el coordinador vuelve a procesarlas.

Los errores se clasifican como offline, transitorios, permisos, datos inválidos,
conflicto o fatales. Solo los recuperables tienen reintento automático; ninguna
categoría elimina la operación local.

No se activa la caché offline de Firestore: nuestra garantía explícita es la
envoltura local y la outbox testeable. Firestore se usa como destino transaccional
cuando hay conexión.

## Migraciones

- almacenamiento V1 → V2: conserva la sesión, crea estado sync vacío y, en la
  primera escritura V2, genera un baseline remoto de metadata y eventos;
- operaciones que quedaron `SYNCING` → `PENDING` al reabrir;
- normalizaciones legacy ya existentes (faltas sin `source`, `pendingReview`,
  `sequenceId` y fases de secuencia) siguen siendo deterministas e idempotentes.

Al guardar correctamente se escribe `storageVersion: 2`. Los eventos mantienen
su `schemaVersion` deportivo independiente.

## UX de estado

`Guardado local` sigue informando que el gesto está seguro en el dispositivo. Un
segundo indicador discreto informa por separado: solo dispositivo, pendientes,
sincronizando, sincronizado, error o conflicto. Su detalle muestra último sync y
permite reintentar errores sin presentar el fallo remoto como pérdida local.

Los fixtures `prueba`, `prueba-8` y `prueba-porteria` permanecen exclusivamente
locales y nunca generan outbox remota.

## Firebase DEV y emuladores

La configuración antigua hardcodeada se retiró. La aplicación solo habilita el
adaptador si `NEXT_PUBLIC_FIREBASE_ENV=dev` y existen las variables de
`.env.example`. Para desarrollo puede conectarse a Auth/Firestore Emulator.

Las reglas incluidas exigen usuario autenticado, verifican IDs/rutas y prohíben
delete físico. Para DEV puede habilitarse Auth anónima. Antes de producción hay
que sustituirla por autorización real de club/rol/partido; no se ha inventado ese
modelo en esta fase.

## Pendiente antes de producción

- autenticación y autorización definitivas;
- UI de resolución/merge de conflictos;
- pruebas de reglas con `@firebase/rules-unit-testing` en CI;
- política de retención/auditoría de tombstones;
- telemetría segura y alertas operativas;
- evaluación IndexedDB si el registro local crece fuera del alcance de partido;
- recuperación remota completa en un dispositivo sin baseline local;
- rotación/configuración separada por entornos y despliegue de reglas revisadas.
