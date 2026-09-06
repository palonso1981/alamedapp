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

## Dashboard V2 — scope analítico persistente

Dashboard V2 sigue derivando todo desde el event log local y los catálogos. No persiste
medias, porcentajes, rankings, zonas ni scores. El fixture `?fixture=1` vive solo en memoria
y permite validar una temporada poblada sin escribir en Firebase ni localStorage.

`DashboardScopeV2` centraliza club, equipo, temporada, partidos, periodo, sede, resultado,
rivales, fases, jugadores, porteros, zonas de origen, zonas de portería y desenlaces. Las
selecciones son OR dentro de una dimensión y AND entre dimensiones. Los scopes de análisis
(`a*`) y referencia (`r*`) se serializan por separado en la URL junto con sección y modo;
Resumen, Equipo, Jugadores, Porteros, Mapas y fichas conservan contexto al navegar o recargar.
La referencia por defecto es la media de temporada homogénea con el periodo y filtros de
evento. Los presets de sede, resultado, P1/P2 y selección filtrada no cambian el análisis.

### Denominadores

- `TOTALES`: suma de eventos válidos.
- `POR PARTIDO`: equipo entre partidos observados; jugador solo entre partidos con minutos.
- `POR 40`: equipo entre minutos observados × 40; jugador entre sus minutos reales × 40.
- Sin denominador se muestra N/D.
- Un total multip partido nunca se compara contra un bruto de media: la referencia se
  normaliza por partido. Las diferencias porcentuales se expresan en puntos porcentuales.

### Jugadores, PTS EN PISTA y SCORE

Las asistencias cuentan solo con estado `PLAYER`. Las métricas `EQUIPO CON ÉL EN PISTA`
recorren todos los intervalos reales y no afirman causalidad. `PTS EN PISTA` se calcula por
partido con el parcial durante sus minutos: victoria 3, empate 1 y derrota 0; convive con
GF, GC y +/-.

`SCORE ALAM` es experimental. Producción promedia percentiles de goles/40, asistencias/40 y
remates/40. En pista promedia remates del equipo/40, inverso de amenazas/40 y PTS EN PISTA
por partido. Ambos bloques pesan 50%. El raw se contrae hacia 50 con
`reliability = min(1, minutos / 80)`; 80 está centralizado y es configurable. Con menos de
tres jugadores comparables o sin denominadores el score es N/D. La interfaz expone
subscores, minutos y fiabilidad.

### Mapas, porteros y P-J

Los mapas mantienen los puntos exactos y añaden zonas clicables. Z1–Z6 conservan la
perspectiva del portero CDA; la matriz 3×2 de destino en portería es un sistema distinto.
`BLOQUEADO` solo aparece si existe en eventos legacy.

Porteros usa el rol funcional reconstruido, muestra cantidad y porcentaje de
blocaje/despeje/rechace, y excluye los intervalos de Portero-Jugador. P-J dispone de resumen
separado (minutos, remates, amenazas, GF y GC) cuando lo utiliza CDA o el rival, sin
contaminar estadísticas de portero normal.

## Dashboard V2.1 — comprensión, contexto y trazabilidad

V2.1 mantiene el motor V2 y centraliza la explicación de métricas en `MetricDefinition`:
nombre, abreviatura, descripción, fórmula, denominador, unidad, formato y dirección
semántica. Las comparaciones pueden indicar una ventaja solo cuando el significado es
inequívoco; minutos y otras métricas neutrales no declaran un ganador. La referencia se
muestra con valor numérico y toda ayuda importante se abre también por tap.

`A PUERTA` se deriva como `GOL + PARADA`; FUERA queda excluido. `CERCANAS` agrupa
objetivamente Z1+Z2+Z3 y `LEJANAS` Z4+Z5+Z6. No existe una métrica de “alto peligro”:
la combinación cercana+a puerta se obtiene cruzando ambos filtros. Cantidades y porcentajes
se recalculan desde los eventos, nunca se persisten.

### Minutos de contexto competitivo

`MINUTOS CLAVE` son los intervalos en los que el jugador está en pista y
`abs(GF-GC) <= 1`. `MINUTOS DE ORO` aplica la misma condición desde P2 minuto 15 hasta el
final reglamentario. Se reconstruyen con cronología, marcador y alineaciones, y se pueden
combinar con sede, periodo, rival, fase, zona y resultado. No forman parte de SCORE ALAM
en V2.1.

AlamedAPP solo captura el minuto entero del reloj deportivo. Por tanto el Dashboard muestra
`P2 · min 16` y nunca inventa segundos deportivos. Cada evento sí conserva `createdAt`, un
timestamp real de creación en milisegundos que el motor no modifica al editar (la edición
actualiza `updatedAt`). Cuando es válido se presenta aparte como `Registrado a las HH:mm:ss`:
es una referencia de captura útil para localizar vídeo futuro, no el reloj del partido.

### Evolución y comparación

Equipo, jugador y portero ofrecen gráficos anchos, ordenados por fecha y compatibles con el
scope activo. No se interpolan partidos ausentes de un jugador: su evolución solo incluye
partidos con participación. Los comparadores mantienen visibles muestra, minutos y
denominadores; SCORE ALAM conserva exactamente la fórmula experimental V2 y muestra la
fiabilidad derivada de los minutos.

### Punto a evento

Las coordenadas de pista son `(x,y)` normalizadas en `[0,1]`: `x` recorre longitudinalmente
la pista canónica desde la portería CDA izquierda hacia la rival derecha, e `y` recorre de
arriba abajo en pantalla. El destino de portería conserva su propio `goalTarget.x/y` y la
versión de geometría. Ni los valores mostrados `X 40 · Y 64` ni las zonas se usan como
identidad.

Cada punto se resuelve exclusivamente mediante `matchId + eventId`, incluso si dos acciones
tienen coordenadas idénticas. El tap abre detalle estable y `VER EVENTO` navega a Revisión
con el `eventId`, donde se selecciona ese evento concreto. El scope del Dashboard permanece
en la URL para volver al mismo análisis. En el futuro este detalle podrá ofrecer `VER VÍDEO`
usando matchId, eventId, periodo/minuto y, como ayuda secundaria, el `createdAt` real; no se
deducirá nunca una posición de vídeo a partir de segundos deportivos inexistentes.
