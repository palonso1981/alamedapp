# Backup y restore lógico RC3-A

## Alcance real

RC3-A implementa un núcleo puro y una CLI sobre inventarios JSON locales. No se conecta a Firebase, no solicita credenciales y no escribe ningún proyecto remoto. El adaptador autenticado Firestore se añadirá en RC3-B después de crear PROD y autorizar expresamente su uso.

El inventario de entrada tiene kind ALAMEDAPP_LOGICAL_DATASET, schemaVersion 1, environment, projectId y una lista de documentos con path y payload de dominio. El path conserva la identidad Firestore prevista.

## Seguridad de entorno

- DEV solo admite projectId cdalameda-dev.
- PROD rechaza cdalameda-dev y placeholders.
- El inventario debe declarar el mismo entorno y proyecto que la orden.
- Export y validation son siempre lectura.
- Restore/import son DRY RUN por defecto.
- El modo --apply exige --expected-project y --confirm-project iguales al destino literal.
- En RC3-A, --apply escribe únicamente otro archivo JSON local; no existe adaptador remoto.

La app acepta NEXT_PUBLIC_APP_ENV=dev|prod. Por compatibilidad, si falta usa NEXT_PUBLIC_FIREBASE_ENV. Una configuración PROD rechaza el proyecto, cloud y preset DEV, y no permite emuladores.

## Comandos

Compilar herramientas:

    npm run data:compile

Preflight de las variables presentes en el proceso:

    npm run data:preflight

Crear backup desde un inventario local ya obtenido:

    npm run data:backup -- --input inventory.json --output backup.json --source-env dev --source-project cdalameda-dev

Validar inventario o backup:

    npm run data:validate -- backup.json

Planificar restore sobre otro inventario, sin escribir:

    npm run data:restore -- backup.json --target-data prod-inventory.json --target-env prod --target-project FUTURE_REAL_PROJECT_ID

Aplicar únicamente a un archivo local de salida:

    npm run data:restore -- backup.json --target-data prod-inventory.json --target-env prod --target-project FUTURE_REAL_PROJECT_ID --expected-project FUTURE_REAL_PROJECT_ID --confirm-project FUTURE_REAL_PROJECT_ID --apply --output restored-local.json

La salida previa enumera target, CREATE, UNCHANGED, UPDATE_SAFE, CONFLICT, IDs afectados y conflictos. No debe añadirse un adaptador remoto que ignore este plan.

## Contenido del backup

Documentos deportivos:

- clubs;
- players y staff maestros;
- teams;
- seasons;
- memberships;
- matches y events;
- segmentos, anchors y overrides integrados en metadata match.

Access se separa como accessMetadata. Puede contener perfiles, mappings y sesiones con identificadores/hash/versiones porque no existe secreto recuperable almacenado. La herramienta elimina campos denominados code, accessCode, plaintext, rawCode, apiSecret o apiKey. Nunca respalda un código en claro.

Cloudinary no se descarga. cloudinaryReferences conserva ownerPath, provider, publicId, secureUrl si existe y version. No contiene API Secret ni borra activos.

Se excluyen leases, outbox, conflictos locales, analytics operativos y caches de dispositivo.

## Validación

Antes de planificar restore se comprueba:

- schemaVersion y kind soportados;
- paths no vacíos y sin duplicados;
- payloads válidos;
- eventId y path coherentes;
- event → match;
- match → club/team/season;
- membership → identidad maestra;
- ausencia de estado operativo y secretos prohibidos.

Las referencias de jugador/staff del bundle selectivo se resuelven por ID, nunca por nombre.

## Estrategia de restore

- CREATE: ID no existe.
- UNCHANGED: contenido canónico idéntico.
- UPDATE_SAFE: misma identidad y updatedAt de fuente no anterior.
- CONFLICT: mismo ID incompatible, ausencia de evidencia temporal o intento de resucitar tombstone.

Un dry-run nunca puede aplicarse. Un plan con conflictos tampoco. Ejecutar dos veces el mismo bundle produce UNCHANGED y no duplica documentos. El restore conserva todos los IDs.

## Datos que solo existen localmente

Un backup cloud nunca puede recuperar trabajo que no sincronizó. Deben custodiarse por separado:

- outbox pendiente;
- sesión local de captura;
- recovery bundles y conflictos;
- revisiones locales todavía no confirmadas;
- deviceInstallId.

Antes de un backup operativo se comprueba outbox cero. Si no lo está, se exporta primero recuperación desde el dispositivo.

## Cuándo hacer backup

- antes de un deploy importante;
- periódicamente durante la temporada;
- antes de migrar/importar;
- antes de cambios de schema o Rules;
- antes de operaciones administrativas masivas.

No se considera válido hasta demostrar restore completo en un entorno de prueba y verificar conteos, IDs, referencias y replay.

## Credenciales futuras

RC3-B deberá elegir y documentar un mecanismo local de lectura/escritura administrativa: sesión Firebase CLI o credencial compatible con Admin SDK custodiada fuera del repositorio. No habrá backend permanente ni Functions. Ninguna credencial se almacenará en bundles, env examples o Git.
