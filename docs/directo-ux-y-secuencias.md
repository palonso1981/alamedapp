# Directo local: jerarquía UX y secuencias de amenazas

## Evidencia histórica para la jerarquía de fases

Fuente analizada: `docs/stats/BBDD_amenazas_CD_Alameda_2024-26_.xlsx`, hoja
`Amenazas`.

- 1.585 amenazas de 51 partidos entre 2024-25 y 2025-26.
- POSICIONAL: 609 (38,4%).
- TRANSICIÓN: 281 (17,7%).
- PORTERO JUGADOR: 169 (10,7%).
- PENALTI: 4 (0,3%).
- DOBLE PENALTI: 12 (0,8%).
- ABP agregada: 507 (32,0%).

El subtipo de ABP solo está informado de manera consistente en 2025-26. En
las 250 ABP desglosadas de esa temporada aparecen BANDA 129 (51,6%), CÓRNER
88 (35,2%) y FALTA 33 (13,2%). Las 257 ABP de 2024-25 no tienen subtipo, por
lo que esos porcentajes sirven para ordenar la interfaz, pero no para estimar
con precisión la frecuencia global de cada subtipo.

La primera jerarquía UX queda deliberadamente en tres niveles:

1. Acceso máximo: POSICIONAL y TRANSICIÓN.
2. Acceso intermedio: BANDA, CÓRNER, FALTA y PORTERO-JUGADOR.
3. Acceso compacto: PENALTI y DOBLE PENALTI.

La jerarquía es configuración de presentación, no una regla deportiva ni una
restricción del modelo. Las ocho fases siguen disponibles y podrán cambiar de
peso sin migrar eventos históricos.

## Disciplina y estado numérico

Una tarjeta y una modificación de alineación son hechos distintos. Una roja
propia genera siempre un `card_recorded`. Solo cuando el operador confirma que
la acción reduce el quinteto se añade, en el mismo comando reversible, una
`substitution` desde el jugador en pista hacia `slot:inferiority`.

Esto permite registrar tarjetas a jugadores de pista o banquillo sin deducir
automáticamente una inferioridad. El replay deriva disciplina de las tarjetas
y el estado numérico exclusivamente de las sustituciones.

La sustitución hacia `slot:inferiority` conserva `relatedCardEventId`: el replay
puede explicar qué roja propia a un jugador que estaba en pista originó la
reducción. Una roja de banquillo o staff no sirve como causa. La V1 no inventa
una duración reglamentaria automática; la inferioridad termina con una
sustitución explícita desde la plaza especial hacia un jugador real. Duración,
gol rival y reglas configurables quedan pendientes de modelar por competición.

### Cortafuegos de alineación

El replay publica una validación derivada de alineación, nunca un contador UI:

- situación normal: cinco jugadores reales y un portero funcional;
- inferioridad justificada: cuatro jugadores reales, la plaza especial y una
  roja propia activa relacionada;
- PORTERO-JUGADOR: siguen siendo cinco personas y el evento de estado identifica
  qué jugador en pista asume la portería.

Una plaza sin causa, cuatro personas en situación normal o un portero no
determinable mantienen una alerta persistente y bloquean amenazas, faltas,
tarjetas y estados deportivos nuevos. Undo/redo, edición, soft delete,
restauración, sustituciones de reparación y selección/corrección del P-J siguen
disponibles para evitar un bloqueo circular. Las sesiones locales antiguas no
se reescriben: se cargan, se reproducen y muestran el diagnóstico hasta ser
corregidas.

## Contrato de secuencias y segunda jugada

Una segunda amenaza originada por un rechace no es una novena fase ni una
segunda parte del mismo evento. Es otro disparo, con sus propias coordenadas y
desenlace, relacionado causalmente con la amenaza anterior mediante dos campos
opcionales del evento:

- `sequenceId`: identificador estable de toda la cadena. En una amenaza raíz
  coincide con el `id` de esa amenaza.
- `parentEventId`: `id` de la amenaza inmediatamente anterior que provoca la
  continuación.

Una amenaza independiente tiene `sequenceId = id` y no tiene
`parentEventId`. Una continuación hereda `sequenceId` y referencia a su padre.
El replay valida que el padre:

- exista y sea otra amenaza;
- pertenezca al mismo partido;
- esté cronológicamente antes que la continuación;
- pertenezca a la misma secuencia.

Un padre con continuaciones activas no puede eliminarse lógicamente: el motor
bloquea la operación y señala la dependencia. Tampoco admite padres de otro
partido, posteriores o pertenecientes a otra secuencia. Reordenar una
continuación antes de su causa se rechaza por integridad y nunca provoca una
cascada silenciosa.

La UX defensiva ofrece “2ª jugada” únicamente tras una parada con `REBOUND`.
El rechace ya queda guardado y no crea nada por sí solo. Si se inicia la
continuación, el nuevo origen crea otro evento con el mismo `sequenceId` y con
el anterior como `parentEventId`; la cadena puede continuar A → B → C.
`CATCH` cierra la acción y `CLEARANCE` no fuerza continuidad. Cancelar la
oferta o una captura hija incompleta no elimina el padre ya guardado ni crea un
evento fantasma.

La fase es contexto de la secuencia. La amenaza raíz exige siempre selección
explícita —también cuando termina en `FUERA`— y ninguna amenaza RIV moderna se
guarda sin ella. Las hijas no muestran selector: heredan automáticamente la
fase efectiva de la raíz tanto en `GOL` como en `FUERA` o `PARADA`. El campo
`phase` se mantiene materializado en cada evento por compatibilidad local, pero
el motor lo sincroniza con la raíz y el editor solo permite cambiarlo desde
ella. Editar la fase de A actualiza B/C; una acción que realmente cambia de
fase debe cerrarse y comenzar como una nueva secuencia ROOT.

## Captura en Directo y enriquecimiento posterior

El Directo conserva únicamente datos críticos, temporalmente sensibles o muy
valiosos y rápidos de registrar. En esta capa se exige la cronología
`period + minute + order`, la alineación, las sustituciones, el origen y la
consecuencia de amenazas, su fase, el jugador propio implicado cuando sea
estructural, la disciplina propia y los estados de juego.

La Revisión no es una repetición del Directo. Completa información recuperable
mediante acta, vídeo, descanso, final del partido u observación posterior, por
ejemplo identidad de un rival amonestado, motivo de una incidencia, ubicación
opcional de una falta, etiquetas secundarias y observaciones. La interfaz de
captura no debe pedir un dato que el sistema ya conoce ni uno que pueda
recuperarse con fiabilidad después si hacerlo aumenta el riesgo de perder la
siguiente acción.

## Arquitectura de interacción contextual

Jugadores, pista y marcador actúan como iniciadores de intención:

- jugador CDA en pista → jugador de banquillo: sustitución;
- jugador CDA en pista → punto de pista: amenaza CDA del jugador;
- punto de pista en estado neutro: amenaza RIV;
- jugador CDA: acciones disciplinarias de ese jugador;
- contexto RIV junto al marcador: tarjetas rivales sin identidad obligatoria.

Las superficies contextuales comparten un mecanismo de anclaje, orientación
hacia el espacio disponible, cancelación y transición entre pasos. En móvil se
pueden convertir en un dock temporal situado en la mitad opuesta al punto para
mantener origen y opciones visibles. Nunca deben crear scroll horizontal ni
salir de los límites de la pista.

La amenaza CDA actual usa el recorrido configurado:

`jugador → origen → consecuencia → fase → [asistencia si GOL] → autoguardado`.

Consecuencia y fase son pasos distintos. No se crea evento antes de completar
ambos. POSICIONAL y TRANSICIÓN ocupan el primer nivel; BANDA, CÓRNER, FALTA y
PORTERO-JUGADOR el intermedio; PENALTI y DOBLE PENALTI el compacto. Esta
jerarquía es presentación basada en el histórico, no taxonomía ni regla rígida.

En un GOL CDA, el evento no se guarda hasta decidir asistencia. Los candidatos
son exclusivamente los jugadores que el replay sitúa en pista en ese instante,
excluido el goleador. `NONE` expresa que no hubo asistencia atribuible;
`PENDING` expresa que debe revisarse y activa la misma marca `pendingReview`
del evento. No existe un segundo concepto paralelo de pendiente. Resolver la
asistencia desde el editor permite retirar esa marca. Goles y asistencias se
derivarán de eventos; no se persistirán contadores agregados.

El recorrido RIV tiene una definición propia:

`origen → GoalTargetPicker → detalles compatibles → fase → autoguardado`.

`GoalTargetPicker` representa frontalmente la portería CDA con postes, larguero,
red/profundidad, una zona exterior amplia y una figura de guardia proporcionada.
El toque normalizado infiere FUERA fuera del marco y propone GOL o PARADA dentro.
La zona táctil de intervención es más amplia que el cuerpo dibujado: cubre brazos,
zonas bajas, escuadras y proximidad de postes. Como una misma coordenada real
puede ser gol o parada, la V2 confirma el resultado interior sin desplazar el
punto; así no obliga a falsear la posición para obtener PARADA. Una parada deriva
`UPPER`/`LOWER` y pide solo `CATCH`, `REBOUND` o `CLEARANCE`. El operador no
elige al portero: replay lo resuelve desde la alineación exacta del evento.
Al activar Portero-Jugador se elige explícitamente una de las cinco personas en
pista. Los eventos legacy sin esa identidad quedan `PENDING` y activan el
cortafuegos/pending review donde corresponda; nunca se inventa una persona.

El destino usa coordenadas `{x, y}` entre 0 y 1 sobre un lienzo frontal
canónico, con `geometryVersion: 2`; no persiste píxeles ni zonas agregadas. El
resultado deportivo sigue siendo un campo del evento y el detalle espacial se
valida contra la geometría de su versión. `WOODWORK` queda reservado como
detalle futuro del destino (palo/travesaño), no como cuarta consecuencia al
nivel de GOL/PARADA/FUERA.

La división corporal V2 es estable: `y < 0.55` deriva `UPPER` y el resto
`LOWER`. Se calcula desde el punto real seleccionado. La versión geométrica se
persiste para mantener exactamente la semántica V1 de sesiones anteriores.

Las amenazas RIV anteriores sin `defensive` continúan siendo eventos válidos
legacy y no reciben destinos inventados durante migración. Las capturas nuevas
guardan `defensive.version = 1`, destino, referencia de portero y, si procede,
zona corporal y desenlace de parada.

La pista usa una orientación analítica canónica permanente: portería CDA a la
izquierda, portería rival a la derecha y ataque CDA hacia la derecha en P1 y
P2. No se invierten coordenadas al descanso. Esta convención se mantendrá en
importaciones, gráficos y revisión para que una misma `{x, y}` conserve
significado espacial durante toda la vida del dato.

## Disciplina contextual y faltas

Las acciones de un jugador en pista son COMETE FALTA, RECIBE FALTA, AMARILLA y
ROJA. Continúan disponibles sin activar modos, y no invalidan los gestos del
jugador hacia pista o banquillo. Un jugador de banquillo en estado neutro solo
ofrece AMARILLA y ROJA; tras seleccionar previamente un jugador en pista, el
mismo toque significa sustitución.

Tarjeta e inferioridad siguen siendo hechos independientes. La roja de un
jugador en pista ofrece `solo tarjeta` o `tarjeta + reducción 4v5`; la roja de
banquillo nunca modifica la alineación. Las tarjetas rivales se capturan junto
al marcador sin jugador rival obligatorio y podrán completar su identidad en
Revisión.

Una falta en directo exige el `playerId` CDA del infractor o receptor. Su
numeración, acumulado anterior y posterior y cualquier umbral alcanzado se
derivan mediante replay. El evento admite `origin?: { x, y }` normalizado, pero
la ubicación no es obligatoria ni añade gestos al Directo actual. Los umbrales
de faltas se suministran como configuración de competición; por defecto no hay
ninguna regla reglamentaria implícita.

## Revisión del partido y procedencia futura

La futura Revisión agrupará pendientes `?`, vídeo, acta oficial, discrepancias,
completado de datos, observaciones del rival, cuestionario táctico y validación
final. El modelo deberá poder asociar cada enriquecimiento con una procedencia
normalizada, al menos: `DIRECTO`, `REVISION_MANUAL`, `VIDEO`, `ACTA_OFICIAL` e
`IMPORTACION`, conservando valor original, fecha, confianza y confirmación
humana cuando corresponda. Esta capa de procedencia se documenta ahora, pero no
se fuerza una migración prematura de los eventos locales.

## Consolidación de superficie, convocatoria y cronología

La superficie interactiva de pista mantiene siempre `aspect-ratio: 2 / 1`,
correspondiente a 40 × 20 m. Porterías y marcas se dibujan dentro del mismo
sistema SVG, pero las coordenadas de captura continúan normalizadas respecto al
rectángulo táctil. Un cambio de tamaño modifica simultáneamente ancho y alto;
nunca deforma la geometría ni altera `{x, y}`.

Tablet horizontal es la composición prioritaria. La pista recibe el espacio
principal; encabezado y estados se compactan, el banquillo se dispone junto a
una línea lateral y la cronología normal muestra una franja baja con scroll
propio. La cronología o el editor pueden expandirse sobre la superficie porque
son tareas secundarias. Tablet vertical reorganiza la cuadrícula sin deformar
la pista, y móvil usa flujo vertical sin scroll horizontal global.

La franja inferior horizontal reserva aproximadamente un 62 % al banquillo y
un 38 % a la cronología. El banquillo abandona la tarjeta rectangular: usa
objetivos táctiles compactos de 44–52 px basados en avatar, dorsal y nombre
corto, sin minutos ni información secundaria. El modo compacto de cronología
muestra como máximo los cuatro acontecimientos más recientes; al expandirse
recupera todos los eventos, filtros, edición, reordenación, borrado y
restauración.

La convocatoria consumida por Directo separa dos colecciones:

- `players`: id, nombre, dorsal, foto y atributos deportivos;
- `staff`: id, nombre, foto y rol libre, sin un enum cerrado de cargos.

El escenario demo contiene 12 jugadores (5 iniciales y 7 suplentes) y tres
técnicos. La cuadrícula horizontal admite 8 suplentes + 3 técnicos sin scroll.
`PlayerAvatar` prioriza foto y dorsal; sin foto el dorsal ocupa el centro. El
staff usa un avatar secundario y nunca entra en pista, inicia amenaza,
sustitución o falta. Solo admite las acciones contextuales compatibles de
amarilla y roja; su disciplina computa sin modificar alineación ni minutos.

`/partido/prueba/directo` migra de forma idempotente únicamente su fixture
demo: una sesión local antigua de ocho jugadores recibe los cuatro jugadores y
el staff ausentes, y las convocatorias de sus alineaciones se amplían también
en `past` y `future`, conservando reloj y eventos. Ningún `matchId` real usa
esta regla. `/partido/prueba-8/directo` añade un decimotercer jugador demo para
validar visualmente 5 en pista + 8 suplentes + 3 técnicos.

`/partido/prueba-porteria/directo` es el laboratorio limpio del Directo real:
P1 0', marcador y disciplina a cero, cinco titulares (portero determinable),
siete suplentes y tres técnicos. Su única entrada inicial es el evento técnico
de alineación requerido por Event Sourcing; no contiene acciones deportivas.
El botón discreto `↺ DEMO`, visible exclusivamente en `prueba` y
`prueba-porteria`, sustituye solo la sesión local seleccionada por su fixture
inicial tras confirmación. Nunca aparece ni actúa sobre un partido real.

## Cabecera y ergonomía del reloj

El marcador integra por equipo goles, faltas del periodo y tarjetas amarillas y
rojas, todos derivados del replay. Pulsar un contador de faltas o tarjetas abre
la cronología filtrada a los eventos fuente; la corrección se realiza editando,
eliminando o restaurando esos eventos, nunca escribiendo un agregado. El énfasis
de umbral solo se activa cuando la competición inyecta umbrales; la V1 local no
presupone ninguno.

El reloj lateral conserva lado izquierdo/derecho y añade slots discretos
arriba/centro/abajo, persistidos como preferencia local. En tablet los botones
`+1/-1` quedan en la columna exterior y el minuto hacia el interior para que el
pulgar no lo tape. No se guardan coordenadas libres y en móvil se mantiene la
composición compacta adaptada.

La cronología de Directo ya no tiene un límite conceptual de cinco eventos.
El listado compacto incluye todos los eventos —también los eliminados
lógicamente para poder restaurarlos— ordenados por `period + minute + order`.
El gesto de arrastre solo reordena dentro del mismo periodo y minuto. La vista
puede filtrar `TODOS` o `PENDIENTES`, muestra el contador `?` y abre un editor
reutilizable por tipo de evento. Guardar utiliza las operaciones de edición y
reordenación del Event Sourcing y ejecuta replay completo; nunca edita un
marcador, alineación, minutos, faltas o estados derivados.

El soft delete se aplica directamente a faltas, tarjetas, estados, amenazas,
goles, asistencias, pendientes y sustituciones que no tengan dependencias
posteriores. Si eliminar un evento causal dejara incoherente otro evento —por
ejemplo, borrar el cambio que puso en pista al autor de una amenaza posterior—
el motor conserva la cronología y devuelve un bloqueo de dominio explícito. La
UI lo muestra junto al listado e indica que debe editarse o eliminarse primero
el dependiente; nunca presenta un toque aparentemente inerte.

`pendingReview` es una marca transversal del evento, no un estado de
incompletitud. Un evento marcado sigue siendo válido y continúa computando. El
futuro cierre podrá avisar “Tienes N eventos pendientes de revisión” y ofrecer
revisarlos ahora o después, sin bloquear el cierre del partido. El editor no
depende de que el partido esté en curso y se reutilizará en una pantalla futura
de Revisión de vídeo.

Los goles rivales no añaden preguntas obligatorias en Directo. Durante una
revisión posterior podrán enriquecerse con una taxonomía configurable de causa
defensiva (por ejemplo pérdida de pase, pérdida 1×1, error defensivo, segunda
jugada u otro). Esa causa futura será distinta de la fase táctica existente;
en particular, no duplicará `TRANSITION`. Este requisito queda documentado y
no se implementa todavía.

### Acta oficial PDF (requisito futuro)

Cada partido podrá conservar el PDF original y proponer desde él resultado,
jugadores, rival, dorsales, goleadores, tarjetas, expulsiones, incidencias,
árbitros y pabellón. La propuesta se comparará con el registro, mostrará
discrepancias y nunca sobrescribirá automáticamente datos validados. OCR,
extracción y almacenamiento del PDF quedan fuera del bloque local actual.

### Cuestionario táctico configurable del rival (requisito futuro)

La revisión podrá incluir una plantilla configurable, sin cambios de código,
para registrar patrones del rival: defensa de córner/ABP, estructuras,
presión, salida, portero-jugador, transiciones, jugadores relevantes,
fortalezas, debilidades y observaciones libres. Las respuestas se asociarán al
partido y rival para construir histórico de scouting. No forma parte del
Directo ni se implementa en este bloque.

## Informe de partido futuro

El informe de partido se generará desde la cronología y sus derivados, no desde
contadores independientes. Podrá integrar alineaciones, marcador, minutos,
amenazas, disciplina, estados, secuencias, revisión y procedencia. Su formato
PDF y distribución quedan para una fase posterior.

## Consolidación UX final previa a Firebase (agosto 2026)

### Reloj y cierre seguro

`MatchSession.minute` continúa siendo tiempo transcurrido por periodo (0–20) y
es la única referencia temporal operativa junto con `period + order`. El rail
proyecta una cuenta atrás mediante `remaining = duration - elapsed`: comienza
en 20 y termina en 0. Los signos describen el valor visible: `+1` añade tiempo
restante y `−1` lo consume. Esta proyección no se persiste.

El rail concentra periodo, cuenta atrás, superioridad, P-J y estado numérico,
pero separa físicamente las acciones de cierre. `FINALIZAR PARTE` requiere una
confirmación corta, completa el reloj hasta 20 para liquidar los minutos de los
jugadores activos y deja P1 cerrada. No cambia automáticamente a P2. Solo
después aparece `INICIAR 2ª PARTE`, que abre P2 en 0 transcurridos/20 restantes.
En P2, `FINALIZAR PARTIDO` aplica la misma liquidación. Un periodo cerrado no
admite nuevas capturas deportivas accidentales; su cronología sigue editable
desde Historial.

Los IDs demo `prueba` y `prueba-porteria` disponen de reinicio local confirmado:
P1 inicial, reloj 20 restante, cero acciones deportivas, alineación válida de
cinco, siete suplentes, tres técnicos, estados e historiales limpios. El evento
técnico de alineación permanece como raíz necesaria del replay. Ningún otro
`matchId` puede usar este reinicio.

### Historial bajo demanda y banquillo

La captura normal ya no reserva espacio permanente a la cronología. El acceso
compacto `HISTORIAL · N` (y `? N` cuando corresponda) abre una superficie
secundaria con scroll y editor completo. El filtro inicial es `ACTIVOS`;
`PENDIENTES` conserva solo activos marcados y `ELIMINADOS` aísla los soft
deleted. Un borrado desaparece inmediatamente de Activos sin perder su posible
restauración. Pulsar faltas o tarjetas en la cabecera abre la misma superficie
con filtro disciplinario, nunca edita el contador agregado.

Los suplentes muestran bajo el avatar sus minutos totales derivados del replay.
Los jugadores en pista mantienen el tramo actual dominante y el total entre
paréntesis. La cuadrícula horizontal conserva once objetivos táctiles para el
escenario extremo de ocho suplentes y tres técnicos, sin convertir al staff en
jugadores ni habilitarle acciones deportivas incompatibles.

### Zonas espaciales versionadas

Las coordenadas normalizadas crudas siguen siendo la fuente de verdad. Los
helpers analíticos V1 derivan, sin persistir nuevos agregados:

- pista canónica (portería CDA a la izquierda en P1 y P2): 3 columnas × 2
  carriles;
- marco de portería: 3 columnas × 2 alturas;
- exterior: izquierda, derecha, alto y bajo.

Cambiar una taxonomía futura exige una nueva versión del helper, no reinterpretar
silenciosamente eventos existentes.

### Portería: destino y anatomía independientes

La captura rival comienza tocando el destino del balón. Fuera del marco se
registra `FUERA` en ese mismo gesto y se pasa a fase. Dentro no existe inferencia
ni preselección: se elige `GOL` o se toca directamente la región anatómica del
portero que intervino. Esa segunda coordenada conceptual no modifica el destino.

El detalle defensivo V2 persiste una de seis fuentes anatómicas: `HEAD`,
`TORSO`, `LEFT_ARM_HAND`, `RIGHT_ARM_HAND`, `LEFT_LEG_FOOT` o
`RIGHT_LEG_FOOT`. `UPPER/LOWER` se deriva de la parte, no del punto del balón.
En la vista frontal la derecha anatómica del portero aparece a la izquierda de
pantalla. Tras una parada se elige blocaje, rechace o despeje; el resto del flujo
de fase, segunda jugada, `sequenceId`, `parentEventId` y portero derivado por
replay no cambia. El detalle V1 anterior sigue siendo importable y reproducible.

P-J es un estado deportivo con identidad funcional explícita y se hereda como
contexto de los eventos posteriores. La fase táctica `FLYING_GOALKEEPER` sigue
siendo una clasificación de la acción: estado y fase no son sinónimos ni se
autocompletan mutuamente.

### Plan futuro de participación

La planificación previa podrá asociar `targetMinutes` a cada `playerId` como
metadato de partido, fuera de la cronología. Un porcentaje se convertirá usando
la duración reglamentaria configurada. Será orientativo y no bloqueará cambios
ni captura: el análisis comparará plan frente a minutos reales derivados. Los
totales de cinco jugadores simultáneos son información de consistencia, no una
segunda fuente de minutos.
