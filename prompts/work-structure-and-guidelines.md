hola cladue actua como experto software engineer, mi proyecto esta en gree ncon una prueba tecnica con los siguientes requerimientos: 

## Overview

Build a theater seat reservation system that handles concurrent booking attempts while maintaining data integrity.

This challenge simulates real-world scenarios where multiple users compete for limited seats simultaneously. Your solution must ensure data consistency and provide visibility into system behavior through monitoring.

<aside>
🫶

We understand this is a technical assessment and may require significant time and effort. We're appealing to your seniority and experience to evaluate how best to approach it within a reasonable timeframe of 3-4 hours. We respect everyone's time and appreciate your consideration.

</aside>

## **Data Model**

**Keep it simple.** Focus on modeling:

- **Reservations/Bookings** (the core entity)
- **Seats** (what's being reserved)
- **Theater**
- Any additional entities you deem necessary to **increase system visibility, functionality and monitoring**

**No need to model:**

- Users or user authentication
- Payment systems
- Access control or permissions

### **Reservation Lifecycle:**

1. **Start** - User initiates a reservation, seats are temporarily locked
2. **Confirm** - User completes payment/confirmation, seats become permanently booked
3. **Cancel** - User explicitly cancels OR system auto-cancels after timeout (5 minutes)

## What You Need to Define

As part of this challenge, you are expected to make architectural/design decisions. **Please document these decisions in your README.**

### 1. API Endpoints

- What endpoints are needed?
- What request/response formats?
- What HTTP methods and status codes?

### 2. System Architecture

- What modules and layers will you create?
- How will you structure your NestJS application?
- How will services interact?

### 3. Technology Choices

- What database features will you leverage?
- What libraries or tools will you use for monitoring?
- Any additional technologies needed?

### 4. Monitoring System

- What dashboards or interfaces will you build?
- How will you collect and visualize them?
- What metrics are important to track?

<aside>
💡

**You must build a monitoring solution that allows real-time observation of the system.** This should be a simple dashboard or console interface where someone can visually track what's happening in the backend as it happens.

</aside>

## Technical Stack

- **NestJS** (required)

## Submission

1. Your code (GitHub repo)
2. [**README.md](http://readme.md/) file** with:
    - Setup instructions
    - How to run the project
    - Dependencies and versions
    - Any special configuration needed
    - Known issues or limitations (if any)
3. Any assumptions or trade-offs you made



Archivos de referencia:

- `./architecture.md` — Arquitectura general, módulos, reglas no negociables
- `./db-structure.md` — Schema Prisma, enums, constraints, índices
- `./env-loader.md` — Variables de entorno y configuración
- `./testing.md` — Estrategia de tests e2e y concurrencia

---

# Agent Guidelines — Coding Standards & Best Practices

> Estas guidelines son obligatorias para todos los agentes que generen código en este proyecto.

---

## G1. Estructura de Carpetas (Feature-Based)

```
src/
├── common/                     # Shared utilities, filters, pipes, decorators
│   ├── filters/
│   │   └── prisma-exception.filter.ts
│   ├── pipes/
│   ├── decorators/
│   ├── interceptors/
│   ├── types/                  # Shared types/interfaces across modules
│   │   └── common.types.ts
│   └── utils/
│       └── date/
│           ├── date.utils.ts   # date-fns helpers
│           ├── timezone.utils.ts # timezone conversion helpers
│           └── date.constants.ts # format patterns, default TZ
├── prisma/
│   ├── prisma.module.ts
│   └── prisma.service.ts
├── queue/
│   ├── queue.module.ts
│   └── queue.constants.ts
├── reservation/
│   ├── reservation.module.ts
│   ├── reservation.controller.ts
│   ├── reservation.service.ts
│   ├── reservation.processor.ts
│   ├── dto/
│   │   ├── create-reservation.dto.ts
│   │   └── reservation-response.dto.ts
│   ├── types/
│   │   └── reservation.types.ts
│   └── constants/
│       └── state-machine.ts
├── seat/
│   ├── seat.module.ts
│   ├── seat.controller.ts
│   ├── seat.service.ts
│   ├── dto/
│   │   └── seat-query.dto.ts
│   └── types/
│       └── seat.types.ts
├── monitoring/
│   ├── monitoring.module.ts
│   ├── monitoring.controller.ts
│   ├── monitoring.service.ts
│   └── types/
│       └── monitoring.types.ts
├── scheduler/
│   ├── scheduler.module.ts
│   └── scheduler.service.ts
├── health/
│   ├── health.module.ts
│   └── health.controller.ts
├── app.module.ts
└── main.ts
```

**Reglas:**
- Organizar por **feature module**, NO por rol técnico
- Cada módulo tiene su propia carpeta `dto/`, `types/`, `constants/` según necesidad
- **NO usar barrel files (index.ts)** — causan builds lentos y problemas con Jest
- Imports siempre con ruta directa: `import { X } from './reservation/reservation.service'`

---

## G2. TypeScript — Reglas Estrictas

### Configuración obligatoria (tsconfig.json)
- `"strict": true` — SIEMPRE activado
- `"noUncheckedIndexedAccess": true`
- `"noImplicitReturns": true`
- `"forceConsistentCasingInFileNames": true`

### Tipos
- **NUNCA** usar `any` — usar `unknown` y narrowing explícito
- Usar `interface` para shapes de objetos extensibles
- Usar `type` para unions, intersections, mapped types
- DTOs son **clases** (para que funcionen los decoradores de class-validator)
- Types/interfaces que no son DTOs van en archivos `.types.ts`
- Tipos específicos de un módulo van en `modulo/types/`
- Tipos compartidos van en `common/types/`

### Discriminated Unions para estados
```typescript
// Ejemplo para responses con estado
type ApiResponse<T> =
  | { success: true; data: T }
  | { success: false; error: string; code: number }
```

### Const Assertions para constantes
```typescript
export const RESERVATION_STATUS = {
  PENDING: 'PENDING',
  CONFIRMED: 'CONFIRMED',
  CANCELLED: 'CANCELLED',
  REJECTED: 'REJECTED',
} as const;

export type ReservationStatus = (typeof RESERVATION_STATUS)[keyof typeof RESERVATION_STATUS];
```

### Reglas generales
- Preferir `readonly` en propiedades que no cambian
- Usar utility types (`Pick`, `Omit`, `Partial`, `Required`) en vez de duplicar definiciones
- Nunca usar type assertions (`as`) salvo que sea absolutamente necesario
- Return types explícitos en funciones públicas de services

---

## G3. NestJS — Convenciones

### Módulos
- Un módulo = un concepto de dominio
- Registrar providers en `providers[]`, exportar en `exports[]` lo que otros módulos necesiten
- Módulos globales: `ConfigModule`, `PrismaModule`, `ScheduleModule`

### Controllers
- Solo manejan HTTP: routing, parsing, response formatting
- **CERO lógica de negocio** en controllers
- Delegar TODO al service correspondiente
- Usar decoradores de status code: `@HttpCode(HttpStatus.CREATED)`, etc.

### Services
- Toda la lógica de negocio vive aquí
- Independientes del transporte (HTTP, WebSocket, etc.)
- Inyectar dependencias vía constructor, NUNCA instanciar con `new`

### DTOs y Validación
- DTOs son **clases** con decoradores de `class-validator`
- Decoradores obligatorios: `@IsString()`, `@IsInt()`, `@IsNotEmpty()`, `@IsUUID()`, etc.
- `@IsOptional()` para campos opcionales
- `@Transform()` de class-transformer para normalización de datos
- ValidationPipe global: `whitelist: true`, `forbidNonWhitelisted: true`, `transform: true`

### Error Handling
- Usar `PrismaExceptionFilter` global para mapear errores de Prisma:
  - `P2002` → `409 Conflict`
  - `P2025` → `404 Not Found`
  - `P2034` → Retry (transaction conflict)
- Usar `HttpException` y sus subclases (`ConflictException`, `NotFoundException`, `BadRequestException`)
- **NUNCA** exponer detalles internos (stack traces, queries) en responses de producción

### Dependency Injection
- Scope por defecto: **Singleton** (no cambiar a menos que sea necesario)
- Usar `@Injectable()` en todos los providers
- Para config-dependent services usar `useFactory`

---

## G4. Prisma ORM — Convenciones

### PrismaService
- Extiende `PrismaClient`, decorado con `@Injectable()`
- Registrado en `PrismaModule` (global), exportado para uso en otros módulos
- **UNA sola instancia** por proceso — NestJS maneja el lifecycle

### Transactions
- **Batched**: `prisma.$transaction([op1, op2])` para operaciones independientes atómicas
- **Interactive**: `prisma.$transaction(async (tx) => { ... })` para operaciones dependientes
- Mantener transacciones **CORTAS** — minimizar tiempo de lock
- Configurar `timeout` y `maxWait` apropiados

### Optimistic Locking (Patrón del proyecto)
```typescript
// Patrón updateMany + count check
const result = await tx.eventSeat.updateMany({
  where: { id: seatId, status: 'AVAILABLE' },
  data: { status: 'HELD' },
});
if (result.count === 0) {
  throw new ConflictException('Seat no longer available');
}
```

### Error Handling con Prisma
```typescript
import { Prisma } from '@prisma/client';

if (error instanceof Prisma.PrismaClientKnownRequestError) {
  switch (error.code) {
    case 'P2002': throw new ConflictException('Duplicate entry');
    case 'P2025': throw new NotFoundException('Record not found');
  }
}
```

### Migrations
- `prisma migrate dev --name <description>` en local
- `prisma migrate deploy` en CI/CD y producción
- **NUNCA** editar una migración ya deployada — crear una nueva correctiva
- Commitear archivos de migración al repo

---

## G5. date-fns — Manejo de Fechas y Timezones

### Principio: Almacenar UTC, Mostrar Local
- Base de datos: siempre `TIMESTAMPTZ` (UTC)
- Almacenar timezone como IANA identifier (`America/Mexico_City`) junto al evento
- Convertir a local solo en la capa de response/display

### Paquetes
- `date-fns` — manipulación core (format, parse, add, sub, isAfter, isBefore)
- `@date-fns/tz` — operaciones timezone-aware (`TZDate`, `formatInTimeZone`)
- `@date-fns/utc` — operaciones UTC-only en servidor (`UTCDate`)

### Estructura de utils
```
src/common/utils/date/
├── date.utils.ts        # Helpers: formatDate, parseDate, addMinutes, isExpired
├── timezone.utils.ts    # Helpers: toUTC, toLocalTime, formatInTZ
└── date.constants.ts    # FORMAT_ISO, FORMAT_DISPLAY, DEFAULT_TZ, etc.
```

### Patrones de formato (Unicode tokens)
```typescript
export const DATE_FORMATS = {
  ISO_DATE: 'yyyy-MM-dd',
  ISO_DATETIME: "yyyy-MM-dd'T'HH:mm:ss.SSSxxx",
  DISPLAY_DATE: 'MMM d, yyyy',
  DISPLAY_TIME: 'h:mm a',
  DISPLAY_DATETIME: 'MMM d, yyyy h:mm a zzz',
} as const;
```

### Ejemplo de helpers
```typescript
import { addMinutes, isAfter } from 'date-fns';
import { UTCDate } from '@date-fns/utc';

export function createExpirationDate(ttlMinutes: number): Date {
  return addMinutes(new UTCDate(), ttlMinutes);
}

export function isExpired(expiresAt: Date): boolean {
  return isAfter(new UTCDate(), expiresAt);
}
```

---

## G6. Concurrencia — Reglas del Proyecto

### Triple protección anti double-booking
1. **Capa 1**: `idempotencyKey` UNIQUE en Reservation — previene requests duplicados
2. **Capa 2**: `updateMany` con WHERE `status='AVAILABLE'` — optimistic locking en aplicación
3. **Capa 3**: UNIQUE constraint `(eventSeatId, isActive)` en ReservationSeat — protección a nivel DB

### Patrón de reserva atómica
```typescript
await prisma.$transaction(async (tx) => {
  // 1. Crear reservation (PENDING)
  // 2. updateMany seats WHERE status='AVAILABLE' → 'HELD'
  // 3. Verificar count === expected
  // 4. Crear ReservationSeat con isActive=true
  // 5. Crear AuditLog
});
```

### Idempotencia
- Catch `P2002` en `idempotencyKey` → retornar la reservación existente
- NO crear tabla separada de idempotency — usar columna UNIQUE directamente

### Timeout de reservaciones
- CRON cada minuto busca PENDING con `expiresAt < now()`
- Transición atómica: PENDING → REJECTED + HELD → AVAILABLE + isActive → false

---

## G7. Auditoría y Monitoring

### Cada transición de estado genera AuditLog
- Campos obligatorios: `action`, `previousStatus`, `newStatus`, `triggeredBy`, `metadata`
- `triggeredBy` valores: `api` | `worker` | `cron` | `dlq`
- `metadata` es JSON libre para contexto adicional

### Métricas a trackear
- Total reservaciones por estado
- Seats disponibles/held/booked por evento
- Jobs en cola / procesados / fallidos
- Tiempo promedio de confirmación
- Reservaciones expiradas por período

---

## G8. Naming Conventions

| Elemento | Convención | Ejemplo |
|----------|-----------|---------|
| Archivos | kebab-case | `reservation.service.ts` |
| Clases | PascalCase | `ReservationService` |
| Interfaces | PascalCase, prefijo I opcional | `ReservationResponse` |
| Types | PascalCase | `SeatStatus` |
| Variables/funciones | camelCase | `createReservation` |
| Constantes | UPPER_SNAKE_CASE | `RESERVATION_TTL_MINUTES` |
| Enums (Prisma) | PascalCase valores | `PENDING`, `CONFIRMED` |
| DTOs | PascalCase + sufijo Dto | `CreateReservationDto` |
| Endpoints | kebab-case, plural | `/reservations`, `/event-seats` |
| DB tables | PascalCase (Prisma default) | `Reservation`, `EventSeat` |
| DB columns | camelCase (Prisma default) | `idempotencyKey`, `expiresAt` |

---

## G9. Reglas Generales para Agentes

1. **Leer antes de escribir** — siempre leer el archivo existente antes de modificarlo
2. **No sobre-ingeniar** — implementar lo mínimo necesario, no agregar features no pedidas
3. **No duplicar código** — si algo se repite, extraer a common/utils
4. **Tests primero en mente** — escribir código testeable (inyección de dependencias, funciones puras)
5. **Commits atómicos** — un commit por feature/fix, mensaje descriptivo
6. **Respetar la arquitectura** — seguir los archivos de referencia (`architecture.md`, `db-structure.md`)
7. **Errores descriptivos** — mensajes de error claros para el consumidor de la API
8. **No secrets en código** — todo via environment variables con ConfigModule
9. **Imports ordenados** — externos primero, luego internos, luego relativos
10. **Sin comentarios obvios** — solo comentar lógica no evidente 