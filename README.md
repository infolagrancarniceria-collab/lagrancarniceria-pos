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

**Cómo se prueba en cada cambio:** `.github/workflows/build-installer.yml`
arma el instalador en un runner de Windows real de GitHub Actions (no en
este entorno de desarrollo, que es Linux) cada vez que cambia algo relevante
al empaquetado, y además abre la app empaquetada y confirma que se queda
corriendo unos segundos sin crashear — así los errores específicos de
Windows (hubo varios: cómo lanzar `npx` desde Node en Windows, y cómo
Electron resuelve `node_modules/.prisma` sin usar `.asar`) se detectan sin
depender de que alguien lo pruebe a mano en su propia PC. El `.exe` queda
disponible para descargar como artefacto en la página de cada ejecución del
workflow en GitHub (pestaña "Actions").

## Pendiente para producción (no bloquea seguir desarrollando módulos)

Confirmar con una instalación real (no solo en CI) que se puede crear un
producto de prueba y usar el sistema normalmente desde el programa
instalado.
