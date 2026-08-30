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
- rol mínimo `GOALKEEPER | FIELD`;
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
competición, categoría y jornada. El ciclo de estado es:

- `DRAFT`: preparación editable;
- `READY`: validaciones completas, todavía editable;
- `LIVE`: alineación inicial congelada y Directo activo;
- `FINISHED`: derivado al cerrar el partido.

La convocatoria toma únicamente jugadores activos y admite hasta 13 personas:
cinco titulares más ocho suplentes. El banquillo es la diferencia derivada entre
convocados y titulares. Staff presente se selecciona desde staff activo.

Para iniciar se exige rival, fecha, cinco titulares exactos y un portero natural
elegido explícitamente dentro del quinteto. El evento
`lineup_initialized` guarda `goalkeeperPlayerId`; esto resuelve sin ambigüedad el
caso de dos porteros naturales titulares.

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
