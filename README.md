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

## Instalador de Windows

`npm run dist:win` genera `release/La Gran Carnicería POS Setup <version>.exe`
(instalador NSIS, arquitectura x64). Pasos que hace en orden:

1. Compila la web y el servidor (`npm run build`).
2. Genera `prisma/plantilla.db` — una base de datos SQLite vacía pero con
   todas las migraciones ya aplicadas (`npm run db:plantilla`). Esta
   plantilla se empaqueta dentro del instalador y es la que se copia a la
   carpeta del usuario la primera vez que alguien abre el programa (ver
   `electron/main.js`, función `prepararBaseDeDatos`). Si se agrega una
   migración nueva a `prisma/migrations`, hay que regenerarla (el script
   `db:plantilla` ya lo hace automáticamente como parte de `dist:win`).
3. Empaqueta con `electron-builder --win`.

Detalles no obvios de la configuración (en `package.json`, clave `"build"`):

- El motor de Prisma para SQLite es un binario nativo por sistema operativo.
  `prisma/schema.prisma` genera tanto el binario "native" (para seguir
  desarrollando en Linux/Mac) como el de "windows" (`binaryTargets`).
- Ese binario no puede ejecutarse desde dentro de un `.asar` (el archivo
  comprimido donde Electron empaqueta el código), así que se configura
  `asarUnpack` para dejarlo como archivo suelto.
- `node_modules/.prisma` (donde vive ese binario) empieza con un punto, y el
  empaquetador de Electron no lo detecta como una dependencia real aunque se
  liste explícitamente — así que `scripts/after-pack.js` (hook `afterPack`)
  lo copia a mano después de armar la app, al mismo lugar donde debería
  haber quedado.
- La base de datos real (`datos.db`, con los datos del local) vive en la
  carpeta de datos del usuario de Windows (`app.getPath('userData')`), no
  dentro de la carpeta de instalación — esa carpeta queda de solo lectura
  una vez instalado el programa.

**Cómo se probó:** el build se verificó completo (estructura de archivos,
motor de Prisma incluido, formato del `.exe` válido) y se simuló el flujo de
"primer arranque" (copiar la plantilla, levantar el servidor, crear datos de
prueba) corriendo el mismo `dist-server/index.js` compilado, apuntado a una
copia de la plantilla — funcionó de punta a punta. Lo que falta, porque este
entorno de desarrollo no tiene Windows real, es abrir el `.exe` instalador en
un PC con Windows y confirmar que la ventana abre y se ve bien.

## Pendiente para producción (no bloquea seguir desarrollando módulos)

Probar el instalador en un PC con Windows real (ver sección anterior).
