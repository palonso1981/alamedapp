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

## Dashboard V2.2 — intervalos competitivos y trazabilidad común

Clave y Oro se derivan con una única proyección cronológica reutilizable. El motor cruza los
intervalos de marcador con los intervalos de alineación y de portero funcional. Clave incluye
solo los tramos con `abs(GF-GC) <= 1`; Oro añade la intersección con `[P2 min 15, P2 min 20]`.
La ventana empieza en el minuto global 35 aunque no exista un evento exactamente en ese borde.
Un portero que juega 40 minutos puede, por tanto, acumular menos minutos competitivos.

La granularidad sigue siendo el minuto deportivo entero. Un evento se clasifica con el marcador
inmediatamente anterior; si es gol, el marcador resultante rige desde ese mismo minuto hasta el
siguiente evento. No se inventan segundos ni fracciones. Bajo Clave/Oro, las métricas de eventos
y los ratios por 40 se recalculan sobre la proyección filtrada. `PTS EN PISTA` representa el
parcial de los intervalos compatibles, mientras partidos y muestras continúan siendo magnitudes
de partido y no se convierten en duraciones.

Las posiciones visibles pasan por un formatter de presentación central que normaliza aliases
actuales y legacy (`GOALKEEPER/PORTERO`, `FIXO/CIERRE`, `WINGER/ALA`, `PIVOT/PÍVOT` y
`UNIVERSAL`) sin modificar el valor almacenado. La cabecera comparativa usa dos mitades reales,
permanece anclada bajo la cabecera global y conserva un contexto secundario compacto.

`IndividualEventPoint` conserva `matchId + eventId` y puede abrir el evento exacto. El mismo
resolver y panel se reutilizan en mapas generales, de jugador y de portero; las coordenadas
pueden repetirse sin ambigüedad. En portería, origen, destino, parte corporal y desenlace son
datos distintos. Un punto agregado —por ejemplo una jornada en una evolución— no recibe un
`eventId` ficticio ni ofrece `VER EVENTO`. El fixture `?fixture=1` sigue siendo exclusivamente
memoria de desarrollo: no escribe repositorios, outbox ni Firebase.

## Dashboard V2.3 — scope competitivo y navegación analítica

La cabecera queda compuesta por dos niveles dentro del mismo sticky: scope principal compacto
y, solo cuando aporta información, identidad CDA/referencia o A/B. Los filtros avanzados viven
fuera de ese contenedor y se expanden en el flujo normal; desplazan el contenido y desaparecen
al hacer scroll, sin overlay. Competición es parte del scope principal junto a club, equipo y
temporada. Se reutiliza `competitionType` (`LEAGUE`, `CUP`, `FRIENDLY`, `OTHER`); un partido
legacy sin valor se analiza como `UNSPECIFIED` sin migrarlo. La URL prevalece; sin parámetro se
elige Liga cuando existe, la única competición cuando solo hay una y Todas en el resto. Las
referencias heredan competición, por lo que “Media temporada” bajo Liga nunca mezcla Copa o
amistosos. Creación y Prepartido siguen siendo los puntos de edición; Directo no cambia.

Los porcentajes Clave/Oro dividen los minutos de intersección del jugador entre la duración
cronológica Clave/Oro del equipo en el mismo scope. El denominador no se multiplica por cinco y
un denominador cero se presenta como N/D. Los balances se definen centralmente solo para pares
homogéneos: GF-GC, REM-AME, A puerta y Cercanos, disponibles en Total, Por partido y Por 40.
SCORE ALAM, Clave/Oro, A puerta y Cercanas conservan sus definiciones anteriores.

Portero es un filtro global temporal: conserva toda la actividad del equipo únicamente durante
los intervalos en los que la persona seleccionada ocupa el rol funcional de portero normal. Los
intervalos P-J se excluyen y el filtro se intersecta con periodo, competición, sede y Clave/Oro.
El análisis de porteros comparte una columna simétrica con foto, KPI, mapa de origen en campo,
mapa de destino en portería, cuerpo, desenlaces y evolución.

Las fases aparecen después del resumen de Equipo. Su barra conserva volumen sólido y referencia
discontinua y añade el marcador visible GF/GC del scope. El detalle accesible informa volumen,
referencia, goles y porcentaje. La navegación de un punto mantiene identidad exclusiva
`matchId + eventId` y añade un `returnTo` interno validado: Revisión muestra “Volver al análisis”
y recupera ruta, query, sección, filtros y anchor. Se rechazan orígenes externos, rutas que no
sean Dashboard y variantes protocol-relative.

## Dashboard V2.4 — referencia flexible y escalabilidad

`analysisScope` y `referenceScope` son scopes completos e independientes. La referencia puede
ser un preset, un partido elegido manualmente o una selección personalizada de competición,
rivales, sede, resultado y periodo. Un rival significa siempre “partidos de CDA contra ese
rival”; nunca se interpreta como la temporada completa de un tercero. La referencia hereda la
competición del análisis al crearse y solo cruza competiciones mediante una elección explícita.
Ambos scopes se codifican por separado en la URL (`a*` y `r*`) y sobreviven navegación, recarga,
fichas y trazabilidad.

El selector de partidos es un combobox buscable por rival, jornada, fecha y competición. Sus
labels combinan jornada o competición, rival, fecha y marcador cuando está disponible. La
comparación partido contra partido usa magnitudes brutas; si las muestras tienen distinto
número de partidos, el benchmark primario cambia a media por partido para no enfrentar, por
ejemplo, 10 remates contra 60 acumulados en cinco encuentros.

La ficha de jugador conserva el comparador numérico simétrico y añade mapas y evoluciones A/B
para jugador contra jugador o el mismo jugador en dos scopes. Cada mapa usa exclusivamente sus
propios eventos y mantiene `matchId + eventId` y `returnTo`, incluido el lado de procedencia. La
media de plantilla no inventa una posición espacial media: no se muestra un mapa ficticio.

Todas las evoluciones por partido mantienen el ancho de su contenedor. Las observaciones se
comprimen reduciendo gap y densidad de etiquetas para 5, 15 o 30 partidos; no se elimina ningún
dato y no existe scroll horizontal interno. El tooltip conserva rival, fecha, contexto y valor.

Partidos incorpora filtros compactos por temporada, competición, jornada, rival y texto. En
Plantilla, “Añadir del club” busca identidades maestras activas y crea únicamente la membership
de temporada. El `playerId` permanece estable, las personas ya vinculadas se marcan y no pueden
duplicarse, y Archivados conserva su semántica de ciclo de vida. El flujo usa el repositorio
offline-first y su outbox existente; no añade una segunda relación ni agregados persistidos.
