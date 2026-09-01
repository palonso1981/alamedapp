# Multiclub Lite V1

## Jerarquía canónica

`Club → identidades maestras de jugadores/staff → equipos → temporadas → memberships → partidos`.

- `clubId` es estable y no depende del nombre visible.
- `playerId` y `staffId` identifican personas dentro de un club. Nunca se duplican al participar en varios equipos o temporadas.
- `teamId` identifica desde esta versión a un equipo deportivo real. El alias histórico `teamId = cd-alameda` sigue siendo legible únicamente como compatibilidad.
- una temporada pertenece a un único `clubId + teamId`.
- un partido nuevo guarda `clubId`, `teamId` y `seasonId`; los eventos y snapshots siguen siendo independientes de cambios posteriores en la plantilla.

## Club actual

La selección local `currentClubId` se guarda en `alamedapp:clubs:index:v1`. Si el club actual se archiva o elimina y existe otro activo, se selecciona uno activo. Cambiar de club cambia equipos, temporadas, identidades, partidos y búsquedas visibles; no mezcla agregados.

El club histórico conocido se interpreta determinísticamente como `cd-alameda`. No se asignan clubes o temporadas por intuición a otros datos.

## Plantilla e identidades

`/plantilla` mantiene dos vistas:

- **Plantilla del equipo/temporada**: memberships, dorsal, posición y actividad de esa plantilla.
- **Jugadores del club**: registro maestro único, archivado/reactivación y dependencias actuales.

Archivar un equipo o temporada no archiva personas. Copiar plantilla copia memberships y conserva `playerId`. En Prepartido, el buscador de extras consulta todos los jugadores activos del club del partido, incluidos jugadores de otros equipos o sin membership. `Solo este partido` crea snapshot y convocatoria; `Añadir también a plantilla` crea una membership sin duplicar la persona.

## Temporadas y partidos legacy

- activas: visibles normalmente;
- archivadas: visibles solo con `Mostrar archivadas`;
- eliminadas/tombstone: nunca seleccionables ni visibles en operativa normal.

Un partido sin `seasonId` continúa como `LEGACY · SIN ASIGNAR`. La acción explícita **Asignar temporada** modifica únicamente la preparación del mismo `matchId`; conserva eventos, snapshots, `reviewStatus`, procedencia y revisiones offline-first.

## Persistencia y migración

- almacenamiento de plantilla: V3 → V4;
- estado de sync: V2 → V3;
- outbox nueva: `namespace: CLUBS | LEGACY_TEAMS`.

Una operación anterior sin namespace se migra a `LEGACY_TEAMS` conservando `operationId`, entidad, estado, `baseRevision`, intentos, timestamps y conflicto. Las revisiones se renombran de forma determinista a `legacy_teams:<tipo>:<id>`. Las operaciones nuevas usan `clubs:<tipo>:<id>`, evitando que una revisión legacy provoque un conflicto falso en el documento canónico. La migración es idempotente y no convierte ni mueve documentos remotos.

Las escrituras nuevas tienen una única fuente canónica:

- `clubs/{clubId}`
- `clubs/{clubId}/players/{playerId}`
- `clubs/{clubId}/staff/{staffId}`
- `clubs/{clubId}/teams/{teamId}`
- `clubs/{clubId}/teams/{teamId}/seasons/{seasonId}`
- memberships bajo la temporada.

Las operaciones pendientes antiguas terminan en `teams/...`; no se genera doble escritura legacy/canónica para cambios nuevos. Los tombstones continúan viajando como UPSERT y nunca como borrado físico.

## Firestore DEV

Las reglas añadidas son exclusivas de `cdalameda-dev`, requieren Authentication, permiten solo `get` individual para transacciones y `create/update` con `clubId`, `entityType`, `entityId` y padres coherentes. `list` y `delete` están prohibidos. Antes de producción deben sustituirse Anonymous Auth y estas reglas DEV por autorización real de club/usuario/rol.

La URL de fotografía continúa siendo un mecanismo provisional. Firebase Storage queda fuera de esta fase.

## Analítica futura

La futura agregación por jugador se hará mediante `playerId` a través de equipos y temporadas. No se guardan estadísticas agregadas como segunda fuente de verdad.
