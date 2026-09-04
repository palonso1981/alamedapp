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

## Evolución V1.1 — analizar y comparar

La navegación se separa en Resumen, Equipo, Jugadores, Porteros y Mapas/Zonas. El ámbito analizado admite temporada, partido, P1/P2, local/visitante y resultado derivado del marcador. La referencia predeterminada de un partido es la media del mismo periodo de la temporada; cuando se analiza P1 o P2 también puede compararse con el otro periodo del mismo partido.

Una media de partido es `total de la muestra / partidos válidos`. Una media de periodo usa `total del periodo / periodos válidos`; nunca mezcla partidos completos y periodos. La presentación comparativa prioriza `valor analizado`, `media de referencia` y `diferencia absoluta`. El signo no recibe automáticamente semántica positiva o negativa: más amenazas generadas y más amenazas recibidas no significan lo mismo.

Los ratios se derivan como `valor / minutosObservados × 40` y son `N/D` sin denominador. Para jugadores, el denominador de los datos “con él en pista” son exclusivamente sus minutos reconstruidos, incluyendo todos sus intervalos de entrada y salida. Esos datos describen al equipo durante sus minutos y no afirman causalidad. Una muestra inferior a 20 minutos se marca como `MUESTRA BAJA`; es un umbral técnico configurable, no una regla deportiva ni un filtro de ranking.

La ficha `/dashboard/jugador/{playerId}` presenta identidad congelada para el partido/temporada, acciones propias, contexto colectivo, evolución de minutos y mapa exacto de tiros. Una amenaza propia solo se atribuye al `playerId` del evento. Las asistencias `PLAYER` se cuentan; `PENDING` no. No se muestra un mapa de pases de asistencia porque el modelo no captura la coordenada del pase y nunca se reutiliza el origen del tiro para inventarla.

## Zonas derivadas V1.1

Las coordenadas normalizadas siguen siendo la fuente de verdad. El resumen de pista 1–6 se deriva desde la perspectiva del portero CDA, situado en la portería izquierda y mirando hacia la derecha: cerca, Z1 derecha/Z2 centro/Z3 izquierda; lejos, Z4 derecha/Z5 centro/Z6 izquierda. En el lienzo canónico, la derecha del portero es la parte inferior. El corte longitudinal técnico es `x = 0.25` (penalti aproximadamente Z2 y doble penalti aproximadamente Z5); los bordes están cubiertos por tests para evitar inversiones futuras.

La portería conserva los puntos exactos y añade una matriz interior 3×2 derivada de `targetX/targetY`. FUERA queda separado del denominador interior. La silueta solo agrega `keeperBodyPart`, y blocaje/rechace/despeje solo agregan `saveOutcome`; ninguno se infiere a partir del target. Toda atribución continúa perteneciendo al portero funcional en el instante del evento.

Una falta crítica es F5 o cualquier falta posterior del mismo equipo en ese periodo. Se deriva de `periodFoulNumber`; P2 reinicia la secuencia. Una falta genérica suma al equipo, pero no se atribuye a una persona.

## Evoluciones posteriores, fuera de V1.1

- Comparación ON/OFF completa con/sin jugador.
- Referencias históricas agregadas, admitiendo que pueden carecer de granularidad espacial o de evento.
- Constructor avanzado de selecciones de partidos y competiciones.
- Almacenamiento real de fotografías y coordenada del pase de asistencia.

Dashboard V1.1 no importa ni modifica `dashboard-historico/` ni el XLSX histórico.
