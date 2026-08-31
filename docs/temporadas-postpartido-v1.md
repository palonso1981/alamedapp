# Temporadas / Equipo V1 y Postpartido / Revisión V1

Estado: implementado en `feature/temporadas-postpartido-v1`. Este documento es evolutivo y no sustituye silenciosamente la especificación maestra V0.5.

## Cadena de datos

La relación de dominio queda preparada como:

`Team → Season → SeasonPlayer/SeasonStaff → Match → MatchEvent → replay → revisión`

`teamId` identifica al equipo y permanece estable. En DEV el único ámbito autorizado es `cd-alameda`, pero el dominio no contiene configuración de Firebase ni presupone que el nombre visible sea CD Alameda. Los partidos reales nuevos requieren `teamId` y `seasonId`; los eventos continúan perteneciendo al partido mediante `matchId`.

## Equipo y temporadas

`TeamProfile` contiene `teamId`, nombre, nombre corto, categoría opcional, estado activo y timestamps. `/configuracion` permite editar esos datos, crear temporadas y elegir una única temporada actual.

`Season` usa un `seasonId` estable e independiente de su etiqueta visible. Incluye `teamId`, etiqueta, fechas opcionales, flags `current`/`active` y timestamps. La primera temporada creada queda como actual; cualquier cambio posterior es deliberado. La temporada actual solo es una preselección de UI y nunca se deduce del año del sistema.

Al crear una temporada puede copiarse la configuración de otra. La copia genera nuevas membresías para el nuevo `seasonId`, pero conserva los mismos `playerId` y `staffId`; no duplica personas.

## Identidad maestra y membresía

`MasterPlayer` conserva la identidad y los datos personales: nombre, nombre corto, nacimiento, pierna dominante, foto, capacidad de portero y demás perfil estable. `SeasonPlayer` aporta los datos variables por temporada: dorsal, posición principal y activo/inactivo.

`MasterStaffMember` conserva la persona. `SeasonStaff` aporta rol, rol personalizado y activo/inactivo por temporada.

Resolución de plantilla:

1. si existe una membresía para la temporada, prevalece;
2. en el contexto legacy sin temporada se usan los campos maestros anteriores;
3. seleccionar una temporada sin membresía no inventa participación.

La pantalla Plantilla muestra explícitamente la temporada seleccionada. Cambiar dorsal, posición, rol o actividad en una temporada no altera la membresía de otra. Los partidos conservan snapshots de convocados, staff y roles funcionales, de modo que una edición posterior de la ficha maestra no reinterpreta el histórico.

## Partidos y compatibilidad legacy

Los partidos nuevos requieren `preparation.teamId` y `preparation.seasonId`. Crear partido y consultar partidos preselecciona la temporada actual, pero permite elegir otra. Prepartido resuelve la convocatoria de esa temporada.

Un partido antiguo sin `seasonId` sigue cargando, sincronizando y siendo revisable como `LEGACY · SIN TEMPORADA`. No se le asigna una temporada ficticia. Una futura asignación histórica deberá ser explícita, validada y versionada.

## Persistencia y Firestore DEV

La solución reutiliza almacenamiento local, outbox, revisiones, detección de conflictos y `SyncCoordinator`. No existe una ruta paralela de persistencia.

Estructura remota:

```text
teams/{teamId}
teams/{teamId}/players/{playerId}
teams/{teamId}/staff/{staffId}
teams/{teamId}/seasons/{seasonId}
teams/{teamId}/seasons/{seasonId}/players/{playerId}
teams/{teamId}/seasons/{seasonId}/staff/{staffId}
matches/{matchId}
matches/{matchId}/events/{eventId}
```

Los documentos `matches/{matchId}` guardan la metadata de preparación, incluidos `teamId` y `seasonId`; los eventos no se trasladan a la temporada. Las rules incluidas son solo para `cdalameda-dev`: exigen autenticación, restringen `teamId` a `cd-alameda` y prohíben borrado físico. Antes de producción deben sustituirse por autorización real de club, usuario y rol.

La persistencia de equipo migra de V1 a V2 de forma compatible. Las nuevas entidades de sync usan schema V2; sesiones y eventos mantienen sus migraciones existentes. Cualquier evolución futura debe usar `schemaVersion`, migraciones versionadas, compatibilidad hacia atrás, pruebas y validación en DEV. Nunca debe existir una migración destructiva silenciosa.

## Postpartido y revisión

Finalizar P2 mantiene el estado deportivo `FINISHED`, detiene la captura live y establece un estado de calidad independiente:

- `NOT_REVIEWED`: terminado y pendiente de revisar;
- `IN_REVIEW`: revisión abierta;
- `VALIDATED`: validación deliberada registrada.

Abrir revisión nunca devuelve el partido a `LIVE`. Un partido validado puede reabrirse deliberadamente; se conservan revisión, timestamps de inicio/validación/reapertura y un contador `reviewRevision`. Validar con eventos `pendingReview` requiere confirmación, pero no borra las marcas ni bloquea la decisión.

`/partido/{matchId}/revision` muestra un resumen derivado mediante replay: resultado, marcador P1/P2, rival, fecha, temporada, minutos, disciplina, amenazas, goles, pendientes y procedencia. Reutiliza el Historial completo y el editor de eventos; editar, reordenar, soft-delete o restaurar provoca replay y no modifica agregados manualmente.

`pendingReview` sigue significando “revisar después”. El evento continúa computando. La pantalla permite abrir directamente el historial filtrado por pendientes.

## Procedencia

`MatchEvent.provenance` admite:

- `LIVE`: evento creado durante Directo;
- `MANUAL_REVIEW`: evento incorporado retroactivamente desde revisión;
- `IMPORT`, `VIDEO`, `OFFICIAL_ACT`: valores preparados para usos posteriores.

Editar en revisión un evento nacido `LIVE` conserva `LIVE`. La procedencia describe el origen de creación, no la última pantalla que lo modificó. Los eventos legacy sin procedencia permanecen sin valor: no se inventa un origen. El Historial y el editor hacen visible la procedencia de los eventos nuevos.

## Target minutes

La planificación continúa siendo opcional. Si ningún jugador tiene objetivo, Revisión no muestra el bloque ni genera avisos. Si existen objetivos, muestra únicamente jugador, objetivo, minutos reales derivados del replay y diferencia; no genera recomendaciones ni valoraciones.

## Histórico e importación futura

Las dos temporadas históricas externas no se importan en este bloque y no se han modificado ni el XLSX ni `dashboard-historico`.

Un futuro importador deberá:

- exigir `teamId` y un `seasonId` creado/confirmado explícitamente;
- marcar datos importados con provenance `IMPORT` cuando sean eventos;
- validar previamente y ofrecer previsualización antes de escribir;
- distinguir eventos detallados de agregados de partido;
- no fabricar eventos, minutos ni coordenadas a partir de un total agregado;
- admitir backfill y actualizaciones idempotentes;
- permitir exportación CSV/XLSX y reimportación controlada.

Los agregados históricos, cuando existan sin detalle, necesitarán un modelo separado y explícito; no deben convertirse en cronología falsa.

## Backlog funcional documentado

- Córners y bandas CDA/RIV: diseñar eventos y su relación con ABP, amenazas y secuencias antes de capturarlos.
- Pierna dominante: futuras composiciones de quinteto, filtros y cruces con posición/acciones; no añade carga al Directo V1.
- Vídeo y acta oficial: podrán enriquecer o incorporar datos usando la procedencia correspondiente.
- Dashboard y estadísticas de temporada: solo después de validar la calidad de esta cadena de datos.

## Portabilidad

El dominio no contiene claves, project IDs ni URLs de Firebase. La configuración llega por variables de entorno y los repositorios remotos son adaptadores. Esto permite migrar a otro Firebase, a una cuenta propiedad del club o a otro hosting sin reescribir el motor deportivo.
