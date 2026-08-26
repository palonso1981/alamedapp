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

## Contrato de secuencias y segunda jugada

Una segunda amenaza originada por un rechace o balón vivo no es una novena
fase. Continúa conservando su propia fase táctica y se relaciona causalmente
con la amenaza anterior mediante dos campos opcionales del evento:

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

El vínculo se conserva aunque el padre tenga soft delete, porque la identidad
inmutable del evento sigue existiendo en la cronología. Reordenar una
continuación antes de su causa se rechaza por integridad.

La futura UX podrá ofrecer “segunda jugada” tras una parada/rechace y crear el
nuevo evento con estos campos. Amenazas ofensivas y defensivas deben reutilizar
el mismo contrato, lo que permitirá reconstruir cadenas, medir conversiones
tras rechace y mostrar una secuencia como unidad visual sin reinterpretar la
fase original.

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

`jugador → origen → consecuencia → fase → autoguardado`.

Consecuencia y fase son pasos distintos. No se crea evento antes de completar
ambos. POSICIONAL y TRANSICIÓN ocupan el primer nivel; BANDA, CÓRNER, FALTA y
PORTERO-JUGADOR el intermedio; PENALTI y DOBLE PENALTI el compacto. Esta
jerarquía es presentación basada en el histórico, no taxonomía ni regla rígida.

El recorrido RIV tiene una definición propia aunque provisionalmente use los
mismos dos pasos visibles. La arquitectura permite sustituirlo más adelante
por:

`origen → GoalTargetPicker → consecuencia/posición → detalles → fase`.

`GoalTargetPicker` podrá inferir hipótesis de GOL, PARADA o FUERA según el punto
de llegada, derivar el portero de la alineación y pedir solo los detalles
compatibles. No se implementa todavía la portería ni se acopla el motor de
eventos a esa hipótesis UX.

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
