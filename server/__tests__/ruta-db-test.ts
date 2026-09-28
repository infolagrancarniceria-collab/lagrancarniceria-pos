import path from "node:path";

// Ruta absoluta a propósito: las rutas relativas de SQLite en Prisma se
// resuelven contra la carpeta de schema.prisma, no contra quien las use —
// una relativa acá apuntaría al lugar equivocado. Importado tanto por
// setup.ts (para correr las migraciones) como por vitest.config.ts en la
// raíz (para inyectar DATABASE_URL) — vive en __tests__, no al revés, para
// no meter un archivo de la raíz dentro del build de server/tsconfig.json.
export const RUTA_DB_TEST = path.join(__dirname, "test.db");
