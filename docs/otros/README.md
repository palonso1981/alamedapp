AlamedAPP - Documentación Técnica y DesarrolloEste documento centraliza las decisiones de arquitectura, estructura del proyecto y directrices de desarrollo para AlamedAPP (CD Alameda). Está diseñado para que cualquier desarrollador o IA pueda retomar el proyecto instantáneamente.1. Stack TecnológicoFramework: React 18 + Next.js 14 (App Router).Lenguaje: TypeScript (Tipado estricto obligatorio para el modelo de datos).Estilos: Tailwind CSS + UI components (shadcn/ui o genéricos limpios).Gestión de Estado Local: Zustand (ideal para la línea de tiempo y recálculos rápidos sin latencia).Base de Datos y Backend: Firebase (Firestore, Auth, Storage).Hosting: Vercel (Recomendado para Next.js) o Firebase Hosting.Paradigma Principal: Offline-First PWA (Progressive Web App).2. Variables de Entorno (.env.local)Para arrancar el proyecto, se requerirá un proyecto en Firebase y configurar las siguientes variables:NEXT_PUBLIC_FIREBASE_API_KEY="tu_api_key"
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN="cdalameda-app.firebaseapp.com"
NEXT_PUBLIC_FIREBASE_PROJECT_ID="cdalameda-app"
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET="cdalameda-app.appspot.com"
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID="tu_sender_id"
NEXT_PUBLIC_FIREBASE_APP_ID="tu_app_id"
3. Estructura del Proyecto (Next.js App Router)alamedapp/
├── public/                 # Iconos PWA, manifest.json, imágenes estáticas
├── src/
│   ├── app/                # Rutas de Next.js
│   │   ├── (auth)/         # Rutas de login (Admin y PIN)
│   │   ├── (dashboard)/    # Layout privado (Dashboard, Configuración)
│   │   ├── partido/        # Layout de partido
│   │   │   └── [id]/
│   │   │       ├── directo/    # PANTALLA CRÍTICA (Captura táctil)
│   │   │       ├── revision/   # Resolución de incógnitas (?)
│   │   │       └── publico/    # Vista para aficionados
│   │   ├── layout.tsx      # Root layout con providers (Offline, Auth)
│   │   └── page.tsx        # Home / Redirect
│   ├── components/         # Componentes UI reutilizables
│   │   ├── ui/             # Botones, Modales, Inputs
│   │   ├── court/          # Representación de la pista interactiva
│   │   └── match/          # Marcador, timeline, cronómetro
│   ├── lib/                # Lógica de negocio y utilidades
│   │   ├── firebase.ts     # Inicialización de Firebase
│   │   ├── rules.ts        # Reglas de validación (Ej: max 5 en pista)
│   │   └── stats.ts        # Fórmulas (Impacto x40, eficacia, tanteo)
│   ├── store/              # Estado global (Zustand)
│   │   ├── useMatchStore.ts # Maneja la cronología (Event Sourcing) y recálculos
│   │   └── useAuthStore.ts  # Sesión de usuario
│   └── types/              # Interfaces TypeScript (El modelo de datos NoSQL)
├── tailwind.config.js
└── next.config.mjs         # Configuración PWA (next-pwa)
4. Resumen de Decisiones Arquitectónicas (ADR)ADR-01: Event Sourcing para el Directo. No guardamos "Mario jugó 5 minutos". Guardamos "Mario entró en el min 1" y "Mario salió en el min 6". Todo se recalcula al vuelo.ADR-02: Offline-First. Firestore SDK manejará la caché local. Zustand mantendrá el estado reactivo ultrarrápido (<150ms).ADR-03: Asimetría Inferioridad/Superioridad. La Inferioridad es un "jugador fantasma" (sustitución). La Superioridad es un Estado Global (toggle).ADR-04: Orden Cronológico sin Segundos. Se usa (Minuto + Orden interno). Internamente se guarda un timestamp oculto de milisegundos para desempatar acciones súper rápidas sin preguntar al usuario.ADR-05: Login Ágil y Sin Emails. El Admin usa un "Usuario" (ej. admin) + contraseña. Jugadores/Staff usan su nombre en una lista + PIN numérico. Ningún usuario debe escribir un correo electrónico real. Todo se enmascara internamente para Firebase.5. Instrucciones de Despliegue (Vercel)Subir el repositorio a GitHub.Importar el proyecto en Vercel.Configurar el Framework Preset como Next.js.Añadir las variables de entorno de Firebase.Desplegar. La PWA se autoconfigurará si el manifest.json y el Service Worker están presentes.6. Siguientes Pasos (Roadmap de Desarrollo)[ ] Fase 1: Setup: Configurar Next.js, Tailwind, Zustand y Firebase.[ ] Fase 2: Tipado: Traducir el esquema NoSQL a interfaces TypeScript (types/index.ts).[ ] Fase 3: Motor UI Directo: Migrar el prototipo HTML a componentes React reales en la ruta /partido/[id]/directo.[ ] Fase 4: Motor de Estado: Conectar la UI con Zustand y Firestore para probar el guardado de eventos locales y offline.