# Plantilla V1 y Prepartido V1

## Ciclo funcional

`Plantilla → Partidos → Prepartido → Directo`.

Plantilla contiene identidades estables del equipo. Prepartido selecciona qué
personas participan en un encuentro y, al iniciar, congela el snapshot visible
que consumirá Directo. Los demos `prueba`, `prueba-8` y `prueba-porteria`
continúan usando fixtures locales independientes.

## Plantilla maestra

El equipo DEV usa el `teamId` estable `cd-alameda`. Un `MasterPlayer` contiene:

- `playerId` UUID estable, independiente de dorsal y nombre;
- nombre completo y `displayName` corto;
- dorsal editable;
- `photoUrl` opcional;
- fecha de nacimiento opcional;
- posición principal (`GOALKEEPER`, `FIXO`, `WINGER`, `PIVOT` o `UNIVERSAL`);
- pie dominante (`RIGHT`, `LEFT` o `BOTH`);
- capacidad `canPlayGoalkeeper`, independiente de la posición principal;
- `role` V1 se conserva únicamente como compatibilidad de datos anteriores;
- `active`, `createdAt` y `updatedAt`.

Los dorsales no pueden repetirse entre jugadores activos. Inactivar es la
operación normal de baja; no se hace hard delete y los partidos históricos
siguen resolviendo el mismo `playerId`.

`MasterStaffMember` es una entidad separada con `staffId`, nombres, foto,
activo y rol flexible (`HEAD_COACH`, `ASSISTANT_COACH`, `DELEGATE`,
`FITNESS_COACH`, `OTHER`). Nunca puede entrar en pista ni intervenir como
jugador; su snapshot del partido sí sigue admitiendo disciplina desde Directo.

### Fotografías

V1 guarda únicamente una URL opcional y reutiliza los avatares con dorsal o
iniciales como fallback. Firebase Storage, recorte y subida de imágenes quedan
fuera de esta fase: no se guardan blobs ni base64 dentro de la envoltura local.

## Referencia y snapshot histórico

La preparación conserva selecciones mediante `playerId`/`staffId`. Al cambiar
la selección se actualizan `session.players` y `session.staff` como snapshots
explícitos de nombre corto, nombre completo, dorsal, foto y rol visibles.

Al iniciar el partido esos snapshots quedan congelados. Cambiar o inactivar
después la ficha maestra no reescribe el pasado. Los eventos deportivos siguen
referenciando exclusivamente el ID estable; no duplican nombres ni dorsales.

## Offline-first y Firestore

La plantilla usa la misma coordinación ya validada: escritura local inmediata,
outbox durable, operationId estable, revisión base, transacción remota,
idempotencia, conflicto sin last-write-wins y reintento tras reconexión.

```text
teams/cd-alameda/players/{playerId}
teams/cd-alameda/staff/{staffId}
```

Cada documento contiene `revision`, `lastOperationId`, timestamps y `payload`.
No hay borrado físico. Las reglas DEV deben limitarse al equipo
`cd-alameda`, exigir `request.auth != null` y validar `entityId`/tipo. Los
permisos productivos de club y rol siguen pendientes.

## Partido y Prepartido

Los datos básicos V1 son rival, local/visitante, fecha, hora opcional,
tipo de competición estructurado (`LEAGUE`, `CUP`, `FRIENDLY`, `OTHER`),
detalle libre cuando el tipo es `OTHER`, nombre concreto de competición,
categoría y jornada numérica opcional. El ciclo de estado es:

- `DRAFT`: preparación editable;
- `READY`: convocatoria y datos mínimos guardados, todavía editable;
- `LIVE`: alineación inicial congelada y Directo activo;
- `FINISHED`: derivado al cerrar el partido.

La convocatoria toma únicamente jugadores activos y admite hasta 13 personas:
cinco titulares más ocho suplentes. El banquillo es la diferencia derivada entre
convocados y titulares. Staff presente se selecciona desde staff activo.

Guardar como `READY` no exige decidir el quinteto. Para iniciar sí se exigen
cinco titulares exactos y un jugador capaz de ejercer de portero elegido
explícitamente dentro del quinteto. El evento
`lineup_initialized` guarda `goalkeeperPlayerId`; esto resuelve sin ambigüedad el
caso de dos porteros naturales titulares.

## Slots funcionales durante el partido

La posición natural y la capacidad del perfil nunca deciden por sí solas el
rol que una persona ocupa durante el partido. Las sustituciones reemplazan una
persona dentro de un slot funcional: quien entra hereda el rol funcional de
quien sale. Por tanto, si sale el portero funcional, el entrante pasa a ejercer
de portero aunque su posición principal sea de campo; si un portero natural
entra por un jugador de campo, continúa en un slot de campo. Replay mantiene
también esta identidad al sustituir al portero-jugador. Los eventos antiguos
sin `goalkeeperPlayerId` solo infieren el slot cuando existe un único candidato
inequívoco en el quinteto inicial.

## Partido finalizado y corrección

`FINISHED` no vuelve a `LIVE`. Directo queda bloqueado para captura ordinaria,
pero ofrece una entrada deliberada a revisión. El usuario elige P1/P2 y minuto,
y toda alta, edición, soft delete o restauración sigue actuando sobre la
cronología y ejecutando replay completo. Cerrar revisión devuelve al estado
finalizado; no reinicia el reloj ni el partido.

## Faltas sin jugador durante captura

El `+` junto al contador CDA/RIV registra, tras un segundo toque de confirmación,
una falta válida con `playerId: null`. No se marca automáticamente como pendiente
de revisión y computa normalmente en la numeración derivada del periodo. El
editor permite asignar posteriormente el jugador sin alterar contadores
agregados: edición, reordenación, undo, delete y restore recalculan la secuencia
mediante replay.

El inicio usa un ID determinista para la alineación y devuelve la sesión
existente si ya está `LIVE`: doble toque, retry o recarga no crean otra
alineación. Después de `LIVE`, Prepartido deja de editar y remite a Directo.

## Planificación opcional

`targetMinutes` es metadata opcional por `playerId`, limitada en V1 a 0–40.
No es un evento, no condiciona sustituciones ni bloquea el inicio. Si existe al
menos un valor se muestra únicamente la suma informativa. No se implementan
porcentajes, conversiones, alertas ni comparación plan/real; los minutos reales
continúan derivados por replay.

## Transición a Directo

Al iniciar: P1, minuto transcurrido 0 (20 restante), cronología con una única
alineación, cinco titulares, portero explícito, suplentes y staff seleccionados.
Marcador, disciplina y minutos arrancan derivados desde esa cronología. La
metadata del partido y el evento se envían por la outbox existente.

## Deuda separada

GoalTargetPicker mantiene una microiteración posterior: ampliar su superficie y
corregir la tolerancia visual junto a postes y larguero para que toques interiores
no se clasifiquen como `FUERA`. No forma parte de Plantilla/Prepartido.
