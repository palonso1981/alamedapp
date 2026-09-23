# Estabilización posterior al primer partido oficial

## Líneas Git preservadas

- `75f76b4` es el checkpoint estable usado en el partido y contiene el hotfix de dorsales sobre `c5629cb`.
- `6c4bc7e` es una línea divergente y deliberadamente no integrada. Contiene el modelo futuro de `playerCode`, reservas de dorsal y Rules asociadas.
- La estabilización parte de `75f76b4`. No mezcla, despliega ni migra el modelo futuro.

## Auditoría read-only del partido oficial

Lectura realizada el 21/09/2026 contra `cd-alameda-prod`, sin escrituras. El partido inequívoco es Salesianos San Antonio Abad, 20/09/2026.

- MATCH finalizado, revisión remota 72, P1/P2 cerrados en 20 minutos.
- 121 documentos EVENT: 120 activos y un gol CDA eliminado lógicamente.
- marcador derivado activo 5–1;
- 13 jugadores convocados, cinco plazas finales válidas, ocho en banquillo;
- portero funcional resuelto por replay y 40 minutos acumulados;
- 23 sustituciones, todas reproducibles;
- 43 amenazas activas, 13 faltas, 7 tarjetas, 20 reinicios y 11 pérdidas;
- cero IDs duplicados, posiciones temporales duplicadas, referencias causales rotas, eventos fuera de 0–20, referencias a jugadores inexistentes o memberships ausentes/inactivas;
- todas las revisiones EVENT son 1 salvo el evento eliminado, cuya revisión es 2;
- replay no devuelve incidencias de alineación, sustitución, portero ni orden.

El outbox es estado local del dispositivo y no puede deducirse de Firestore. La ausencia de duplicados o documentos parciales sí confirma que no hay señal remota de sincronización incompleta. Que una acción deportiva no figure en la cronología no puede clasificarse como fallo sin evidencia adicional del operador o vídeo.

## Convocatoria de 14

El límite anterior no respondía a una restricción del motor, persistencia o sync: estaba centralizado en `MAX_CALLED_PLAYERS = 13` y repetido en una etiqueta/mensaje. La regla pasa a 14: cinco titulares y hasta nueve suplentes. `lineup_initialized.squadPlayerIds`, replay, minutos, sustituciones e hidratación ya trabajan con listas sin tamaño fijo.

## Dorsales

El hotfix estable define una ocupación únicamente por membership activa del mismo `teamId + seasonId`, sin `deletedAt` ni `archivedAt`. `MasterPlayer.number` y el nombre no participan en la exclusión. El dorsal es presentación/contexto de temporada; la identidad deportiva e histórica continúa siendo `playerId`.

## Vídeo

La regresión automatizada cubre alta/edición/eliminación de segmentos, anchors, lead, overrides, persistencia, sync, segundo navegador, vídeo vacío y conflictos de metadata. Se mantiene la apertura externa normal de YouTube: probar anchor usa el segundo exacto y ver jugada aplica `max(0, segundo - lead)`. No se ha aplicado un fix especulativo porque no existe todavía un caso concreto reproducible del problema observado por el usuario.

El partido oficial conserva un segmento, un anchor y un override; las referencias a eventos son válidas.

## Modelo futuro `6c4bc7e`

La dirección de dominio es correcta: UUID técnico estable, `playerCode` humano no reutilizable, dorsal canónico en `SEASON_PLAYER`, historial por memberships y nombres repetidos. Antes de desplegarlo deben resolverse como una unidad:

1. compatibilidad temporal entre cliente publicado, Rules nuevas y migración;
2. backup e inventario de PLAYER/memberships;
3. validación de colisiones de dorsal activas antes de crear reservas;
4. migración administrativa idempotente de counter/mappings/reservas;
5. prueba de concurrencia y rollback en emulador y proyecto desechable;
6. deploy coordinado sin mezclarlo con fixes urgentes de partido.

Hay además una decisión visible que cerrar antes de migrar: `6c4bc7e` formatea `playerCode` con cuatro cifras (`0001`), mientras que el criterio de producto recibido para la evolución futura ejemplifica tres (`001`). No afecta a esta estabilización, pero debe fijarse antes de emitir códigos definitivos.

No debe hacerse cherry-pick parcial de sus Rules o transporte transaccional sobre la línea estable.
