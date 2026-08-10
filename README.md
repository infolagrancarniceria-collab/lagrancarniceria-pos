# Sistema POS Carnicería

Ver `CLAUDE.md` para el contexto completo del proyecto, la arquitectura y el
alcance de cada módulo.

## Módulo 1: Gestión de precios

Incluye: catálogo de productos y categorías (3 niveles), cambio de precio
individual, cambio masivo (por categoría o planilla CSV) e historial de
cambios.

## Cómo correrlo en modo desarrollo

Requisitos: Node.js 20 o superior.

```bash
npm install
cp .env.example .env
npx prisma migrate dev
npm run dev            # levanta el servidor (puerto 5175) y la web (puerto 5174)
```

Abrir `http://localhost:5174` en el navegador. Para probarlo también como
aplicación de escritorio (Electron), en otra terminal, con `npm run dev`
corriendo:

```bash
npm run dev:electron
```

## Estructura del proyecto

- `prisma/schema.prisma` — modelo de datos (productos, categorías, usuarios,
  historial de precios).
- `server/` — API local (Express). Rutas en `server/routes/`.
- `web/` — interfaz (React). Páginas en `web/src/pages/`.
- `electron/main.js` — cascarón de escritorio.

## Formato de planilla para carga masiva de precios

Archivo CSV con dos columnas:

```csv
plu,precio_nuevo
1001,4000
2001,1800
```

## Pendiente para producción (no bloquea seguir desarrollando módulos)

Falta armar el instalador de Windows (empaquetado con `electron-builder`) y
definir dónde vive la base de datos SQLite en un PC ya instalado (hoy usa
`DATABASE_URL` de `.env`, pensado para desarrollo). Se resuelve cuando el
sistema esté más completo y listo para instalarse en el PC del local.
