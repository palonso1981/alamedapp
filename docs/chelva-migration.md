# Migración selectiva Chelva

## Decisión

Chelva es un partido real. Sus jugadores son identidades reales que deben conservar playerId para poder completar después nombre, foto, dorsal y ficha sin romper eventos históricos.

La identidad de exportación es siempre un matchId explícito. Nunca se busca ni se empareja por el texto Chelva.

## Comandos RC3-A

Export local desde un inventario:

    npm run data:export-match -- MATCH_ID --input inventory.json --output chelva-bundle.json --source-env dev --source-project cdalameda-dev

Dry-run de import contra inventario PROD:

    npm run data:import-match -- chelva-bundle.json --target-data prod-inventory.json --target-env prod --target-project FUTURE_REAL_PROJECT_ID

Aplicación de prueba únicamente a archivo local:

    npm run data:import-match -- chelva-bundle.json --target-data prod-inventory.json --target-env prod --target-project FUTURE_REAL_PROJECT_ID --expected-project FUTURE_REAL_PROJECT_ID --confirm-project FUTURE_REAL_PROJECT_ID --apply --output imported-local.json

No existe escritura Firebase en RC3-A.

## Bundle

ALAMEDAPP_MATCH_EXPORT schemaVersion 1 incluye:

- club y team padres;
- season, si el partido la tiene;
- match con preparación, convocatoria y metadata;
- todos sus events;
- players maestros referenciados por convocatoria/eventos;
- memberships relevantes de esos players;
- staff maestro realmente referenciado y memberships correspondientes;
- videoSegments, anchors contenidos en segmentos y videoEventOverrides;
- inventario de eventIds, playerIds, staffIds y advertencias.

Conserva matchId, eventId, playerId, teamId, seasonId, staffId, sequenceId, parentEventId y demás relaciones internas. No crea IDs nuevos ni mapea personas por nombre/dorsal.

Excluye otros partidos, fixtures, Access, accessCodes, accessSessions, leases, analytics, outbox, conflictos/operaciones DEV y personas test no referenciadas.

## Dorsal actual

El partido ya guarda una convocatoria Player propia con number. Directo y Revisión histórica leen ese snapshot, por lo que editar después el número del MasterPlayer no reescribe el dorsal congelado del partido. Plantilla mostrará el dorsal actual de la membership/perfil correspondiente. No se añade un schema nuevo en RC3-A.

## Coordenadas

Chelva se capturó antes de cerrar la orientación canónica. Se exportan e importan origin, target y geometryVersion raw, exactamente como están:

- sin flip;
- sin migración;
- sin heurística;
- sin corrección automática.

La advertencia histórica viaja en integrity.warnings. No invalida jugadores, marcador, cronología, vídeo, sustituciones o goles fiables.

## Secuencia RC3-C

1. Confirmar el matchId remoto exacto.
2. Generar inventario DEV de solo lectura.
3. Exportar el bundle selectivo.
4. Inspeccionar IDs, conteos, warnings y referencias.
5. Validar schema y relaciones.
6. Crear backup previo del PROD todavía limpio/configurado.
7. Ejecutar import dry-run y resolver colisiones.
8. Autorizar y aplicar una única importación.
9. Verificar players, memberships, replay, events, vídeo y coordenadas raw.
10. Ejecutar segunda dry-run: todo debe quedar UNCHANGED.
11. Desplegar Hosting/PWA cuando corresponda.
12. Completar validación alojada multidispositivo y piloto.
