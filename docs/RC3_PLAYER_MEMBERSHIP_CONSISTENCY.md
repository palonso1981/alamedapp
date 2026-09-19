# RC3 · PLAYER/STAFF y memberships consistentes

## Modelo de dominio

- `PLAYER` y `STAFF` son identidades maestras del club. Pueden existir sin pertenecer a una temporada.
- `SEASON_PLAYER` y `SEASON_STAFF` pertenecen a un equipo y una temporada concretos.
- El dorsal canónico vive en `SEASON_PLAYER.number`. `MasterPlayer.number` se conserva temporalmente solo como fallback de compatibilidad para datos anteriores al modelo por temporadas.
- Una membership activa debe referenciar un maestro real del mismo club. Una membership huérfana solo puede transicionar a inactiva con `deletedAt`; no puede reactivarse sin maestro.

## Alta conjunta

La intención «crear identidad y añadir a esta plantilla» persiste ambas entidades localmente y coloca la membership inicial como `atomicCompanion` de la operación base 0 del maestro. El transporte remoto escribe maestro y membership con un único `writeBatch`.

La membership mantiene además su operación independiente. Tras el batch, esa operación se confirma como `ALREADY_APPLIED`; en modificaciones futuras (dorsal, estado o nueva temporada) sincroniza de forma independiente. La misma estrategia se aplica a `STAFF` + `SEASON_STAFF`.

Las Rules usan `existsAfter`/`getAfter`, de modo que aceptan el estado final del batch y rechazan una membership activa aislada. El batch conserva el mismo `operationId` en sus documentos para hacer idempotente un reintento tras perder el acuse.

Orden de entrega obligatorio: desplegar primero `firestore.rules` y después el código cliente que emite batches.

## Limpieza puntual de las cinco memberships huérfanas

No ejecutar sin una nueva autorización explícita. No se debe crear un PLAYER ficticio ni borrar físicamente documentos.

Allowlist cerrada de `playerId`:

- `ee0ef5d0-bd21-4ea0-8353-8f80911948e3`
- `d6607945-f22a-4130-87c2-593103f88b77`
- `d79de760-51a7-415f-9006-295f2d9fc742`
- `b1543d4a-1326-4c77-bbad-2a2454eb6835`
- `2a6e2034-5cc5-4395-97f3-57023697f507`

Procedimiento seguro propuesto:

1. Hacer una lectura y exportación previa de los cinco documentos exactos bajo `clubs/cd-alameda/teams/{teamId}/seasons/{seasonId}/players/{playerId}`.
2. Para cada ID, verificar que el `PLAYER` raíz `clubs/cd-alameda/players/{playerId}` no existe, que la membership sigue activa y que club/equipo/temporada/revisión coinciden con el inventario auditado. Si una condición cambia, abortar toda la operación.
3. En una única transacción administrativa limitada a la allowlist, actualizar cada membership: `payload.active=false`, `payload.deletedAt=<mismo timestamp de la operación>`, `payload.updatedAt=<timestamp>`, `revision=revision+1`, y un `lastOperationId` nuevo y auditable. No modificar dorsal, identidad ni ninguna otra membership.
4. Releer los cinco documentos, confirmar que están inactivos, que no hay escrituras adicionales y que los dorsales quedan libres para memberships activas nuevas.
5. Conservar el export previo como recovery hasta que el usuario valide la plantilla.

La ruta exacta y la revisión de cada documento se resuelven mediante la lectura previa; nunca se construyen por intuición. Las Rules permiten esta transición lógica aunque falte el maestro, pero impiden reactivar la membership huérfana.

## `playerCode` futuro (no implementado)

Propuesta: código estable, visible y sin semántica deportiva, por ejemplo `ALM-000123`. El UUID `playerId` continúa siendo la identidad técnica.

La unicidad debe garantizarse por club con un mapping create-only, por ejemplo `clubs/{clubId}/playerCodes/{normalizedCode}`, creado en la misma transacción que el PLAYER. Para migrar datos existentes se asignarían códigos deterministas por club, se validaría ausencia de colisiones y se haría un backfill reversible antes de mostrar el campo en UI. No se incluye en este hotfix para evitar una migración previa al partido.
