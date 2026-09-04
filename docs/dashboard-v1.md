# Dashboard V1 — métricas derivadas

## Alcance y fuente de verdad

Dashboard V1 es una vista de lectura sobre las sesiones locales que ya están disponibles en el dispositivo. El índice de partidos sirve únicamente para localizar y filtrar sesiones; todas las métricas deportivas se recalculan desde la cronología vigente mediante `replayMatch` y helpers puros de `dashboardAnalytics`.

No se persisten goles, minutos, porcentajes, faltas ni agregados del Dashboard. Editar, restaurar, reordenar o revisar un evento cambia el siguiente cálculo porque cambia la cronología fuente.

El ámbito se aplica en este orden: `currentClubId → teamId → seasonId → matchId`. Se comprueba tanto el catálogo como la preparación del partido para impedir cruces entre clubes. Los partidos eliminados nunca se incluyen y los archivados se excluyen por defecto.

## Métricas V1

- Resumen: partidos, victorias/empates/derrotas de partidos finalizados, goles y amenazas CDA/RIV.
- Jugadores: partidos con presencia en pista, minutos derivados, goles, asistencias confirmadas y amenazas CDA con autor registrado.
- Objetivos: solo aparecen cuando el partido contiene `targetMinutes`; se comparan con minutos reales sin generar recomendaciones.
- Amenazas: cada `threat_recorded` activo cuenta una vez. GOL, PARADA, FUERA y BLOQUEADO legacy se mantienen separados.
- Segunda jugada: todo evento con `parentEventId` es una nueva amenaza. Una cadena A→B→C cuenta tres amenazas, dos amenazas de segunda jugada y el gol de C como gol de segunda jugada.
- Fases: se usa `effectiveThreatPhase`; los hijos reflejan la fase de la raíz y no generan una categoría táctica independiente.
- Disciplina: faltas y tarjetas se derivan del replay. Una falta genérica con `playerId = null` cuenta para el equipo sin atribución personal artificial.
- Asistencias: solo `status: PLAYER` suma una asistencia. `NONE` y `PENDING` no suman.

## Portero funcional y porcentaje

La atribución se resuelve con replay en la posición cronológica exacta del evento. No se usa la posición natural, `canPlayGoalkeeper` ni el primer portero de la plantilla. Los minutos de portero se calculan por intervalos de rol funcional.

El porcentaje mostrado es:

`PARADAS / (PARADAS + GOLES) × 100`

FUERA no entra en el denominador. Cuando no existe denominador o no puede reconstruirse una identidad funcional única se muestra `N/D`.

`targetX/targetY` y `keeperBodyPart` permanecen independientes. El mapa de portería representa la coordenada normalizada original y conserva `geometryVersion`; la distribución corporal solo usa `keeperBodyPart`. Para detalles V1 sin parte corporal moderna se muestra ausencia de granularidad, no una conversión inventada.

## Mapas y orientación

El mapa de origen usa `origin.x/y` sobre la pista canónica 2:1: portería CDA a la izquierda, rival a la derecha y CDA ataca a la derecha en ambos periodos. El mapa de destino rival usa `goalTarget.x/y` sin sustituir las coordenadas raw por zonas.

## Calidad, revisión e históricos

`MANUAL_REVIEW` tiene el mismo valor deportivo que `LIVE`; el Dashboard indica cuántos eventos fueron añadidos en revisión. `pendingReview` no excluye datos y genera una advertencia discreta. El estado `VALIDATED` se presenta como calidad, no como condición para calcular.

La granularidad ausente se expresa como `N/D`. V1 trabaja con `EVENTOS COMPLETOS` del modelo actual y no presupone que futuros `AGREGADOS HISTÓRICOS` tengan fase, coordenada, destino o parte corporal. No se toca ni importa `dashboard-historico/` ni el XLSX histórico.

## Offline y rendimiento

La ruta `/dashboard` carga en una sola pasada el catálogo y las sesiones locales; después filtra y deriva en memoria. No realiza una consulta remota por widget y sigue funcionando sin Internet para los partidos presentes en el dispositivo.
