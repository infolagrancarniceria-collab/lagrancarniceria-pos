// Carga el catálogo real de La Gran Carnicería, tomado del documento de
// rediseño de la web (precios, PLUs, marca, familia de corte, destacados y
// promo) — para no tener que cargar producto por producto desde la ficha.
// También crea (si no existen) las categorías del catálogo y las opciones
// de corte estándar para Vacuno, Cerdo y Pollo.
//
// Corre en modo simulación por defecto — no escribe nada, solo imprime qué
// haría. Para aplicar los cambios de verdad:
//
//   npx tsx scripts/cargar-catalogo-real.ts --confirmar
//
// IMPORTANTE — productos que quedaron FUERA de esta carga porque el
// documento no traía un PLU válido y único para ellos (ver el reporte al
// final de la corrida). Antes de correr con --confirmar, revisa ese
// reporte: son ~25 productos (todo Pollo, más algunos de Artesanales) que
// hay que cargar a mano con su PLU real, una vez que alguien lo confirme
// mirando la balanza/el POS actual.

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const confirmar = process.argv.includes("--confirmar");

type FlagBalanza = "NORMAL" | "PESABLE" | "IMPORTE";

interface ProductoCarga {
  plu: string;
  descripcion: string;
  precio: number;
  flagBalanza: FlagBalanza;
  categoria: string;
  marca?: string;
  familiaCorte?: string;
  featured?: boolean;
  promoPrecioUnitario?: number;
  promoGramosMinimos?: number;
  promoEtiqueta?: string;
}

const MARCA_CERDO = "Super Cerdo · Fresco";

// --- Cerdo (18) — todos PESABLE, familia de corte "Cerdo" ---
const CERDO: ProductoCarga[] = [
  { plu: "805", descripcion: "Cuero de Cerdo", precio: 1270, flagBalanza: "PESABLE", categoria: "Cerdo", marca: MARCA_CERDO, familiaCorte: "Cerdo" },
  { plu: "808", descripcion: "Manitos de Cerdo", precio: 2424, flagBalanza: "PESABLE", categoria: "Cerdo", marca: MARCA_CERDO, familiaCorte: "Cerdo" },
  { plu: "669", descripcion: "Resto de Hueso", precio: 2490, flagBalanza: "PESABLE", categoria: "Cerdo", marca: MARCA_CERDO, familiaCorte: "Cerdo" },
  { plu: "806", descripcion: "Pernil Crudo", precio: 3900, flagBalanza: "PESABLE", categoria: "Cerdo", marca: MARCA_CERDO, familiaCorte: "Cerdo" },
  { plu: "794", descripcion: "Cazuela de Cerdo", precio: 3980, flagBalanza: "PESABLE", categoria: "Cerdo", marca: MARCA_CERDO, familiaCorte: "Cerdo" },
  { plu: "815", descripcion: "Paleta de Cerdo", precio: 3980, flagBalanza: "PESABLE", categoria: "Cerdo", marca: MARCA_CERDO, familiaCorte: "Cerdo" },
  { plu: "800", descripcion: "Tocino Chicharrón", precio: 3980, flagBalanza: "PESABLE", categoria: "Cerdo", marca: MARCA_CERDO, familiaCorte: "Cerdo" },
  { plu: "796", descripcion: "Chuleta Parrillera", precio: 4980, flagBalanza: "PESABLE", categoria: "Cerdo", marca: MARCA_CERDO, familiaCorte: "Cerdo" },
  { plu: "795", descripcion: "Chuleta de Centro", precio: 4980, flagBalanza: "PESABLE", categoria: "Cerdo", marca: MARCA_CERDO, familiaCorte: "Cerdo" },
  { plu: "813", descripcion: "Abastero de Cerdo", precio: 4980, flagBalanza: "PESABLE", categoria: "Cerdo", marca: MARCA_CERDO, familiaCorte: "Cerdo" },
  { plu: "809", descripcion: "Plateada de Lomo", precio: 5940, flagBalanza: "PESABLE", categoria: "Cerdo", marca: MARCA_CERDO, familiaCorte: "Cerdo" },
  { plu: "812", descripcion: "Pulpa de Cerdo Magra", precio: 5980, flagBalanza: "PESABLE", categoria: "Cerdo", marca: MARCA_CERDO, familiaCorte: "Cerdo" },
  { plu: "792", descripcion: "Lomo Centro", precio: 6980, flagBalanza: "PESABLE", categoria: "Cerdo", marca: MARCA_CERDO, familiaCorte: "Cerdo" },
  { plu: "807", descripcion: "Malaya de Cerdo Chica 400 g", precio: 6980, flagBalanza: "PESABLE", categoria: "Cerdo", marca: MARCA_CERDO, familiaCorte: "Cerdo" },
  { plu: "814", descripcion: "Costillar Entero", precio: 6980, flagBalanza: "PESABLE", categoria: "Cerdo", marca: MARCA_CERDO, familiaCorte: "Cerdo" },
  { plu: "802", descripcion: "Filete de Cerdo", precio: 7980, flagBalanza: "PESABLE", categoria: "Cerdo", marca: MARCA_CERDO, familiaCorte: "Cerdo" },
  { plu: "810", descripcion: "Costillitas Baby", precio: 7980, flagBalanza: "PESABLE", categoria: "Cerdo", marca: MARCA_CERDO, familiaCorte: "Cerdo", featured: true },
  { plu: "803", descripcion: "Malaya Cerdo 900 g", precio: 9800, flagBalanza: "PESABLE", categoria: "Cerdo", marca: MARCA_CERDO, familiaCorte: "Cerdo" },
];

// --- Vacuno (29 de 30 — "Panita de Vacuno" queda fuera, sin PLU) ---
// Molida Corriente, Molida Especial y Carne Picada van sin familiaCorte
// (ya vienen molidos, no muestran selector de corte — regla explícita del
// documento de rediseño).
const VACUNO: ProductoCarga[] = [
  { plu: "839", descripcion: "Patas de Vacuno", precio: 5980, flagBalanza: "PESABLE", categoria: "Vacuno", familiaCorte: "Vacuno" },
  { plu: "824", descripcion: "Hueso Carnudo", precio: 5980, flagBalanza: "PESABLE", categoria: "Vacuno", familiaCorte: "Vacuno" },
  { plu: "818", descripcion: "Molida Corriente", precio: 8980, flagBalanza: "PESABLE", categoria: "Vacuno" },
  { plu: "817", descripcion: "Molida Especial", precio: 9890, flagBalanza: "PESABLE", categoria: "Vacuno", featured: true },
  { plu: "833", descripcion: "Sobrecostilla", precio: 10980, flagBalanza: "PESABLE", categoria: "Vacuno", familiaCorte: "Vacuno" },
  { plu: "843", descripcion: "Huachalomo", precio: 10980, flagBalanza: "PESABLE", categoria: "Vacuno", familiaCorte: "Vacuno" },
  { plu: "831", descripcion: "Asado Americano", precio: 10980, flagBalanza: "PESABLE", categoria: "Vacuno", familiaCorte: "Vacuno" },
  { plu: "840", descripcion: "Pollo Ganso", precio: 11980, flagBalanza: "PESABLE", categoria: "Vacuno", familiaCorte: "Vacuno" },
  { plu: "828", descripcion: "Asado Carnicero", precio: 11980, flagBalanza: "PESABLE", categoria: "Vacuno", familiaCorte: "Vacuno" },
  { plu: "842", descripcion: "Tapapecho", precio: 11980, flagBalanza: "PESABLE", categoria: "Vacuno", familiaCorte: "Vacuno" },
  { plu: "826", descripcion: "Abastero Vacuno", precio: 11980, flagBalanza: "PESABLE", categoria: "Vacuno", familiaCorte: "Vacuno" },
  { plu: "827", descripcion: "Choclillo", precio: 11980, flagBalanza: "PESABLE", categoria: "Vacuno", familiaCorte: "Vacuno" },
  { plu: "846", descripcion: "Punta de Ganso", precio: 11980, flagBalanza: "PESABLE", categoria: "Vacuno", familiaCorte: "Vacuno" },
  { plu: "845", descripcion: "Palanca de Vacuno", precio: 11980, flagBalanza: "PESABLE", categoria: "Vacuno", familiaCorte: "Vacuno" },
  { plu: "835", descripcion: "Osobuco de Vacuno", precio: 12980, flagBalanza: "PESABLE", categoria: "Vacuno", familiaCorte: "Vacuno" },
  { plu: "819", descripcion: "Churrasco de Vacuno", precio: 12980, flagBalanza: "PESABLE", categoria: "Vacuno", familiaCorte: "Vacuno", featured: true },
  { plu: "838", descripcion: "Punta Picana", precio: 12980, flagBalanza: "PESABLE", categoria: "Vacuno", familiaCorte: "Vacuno" },
  { plu: "829", descripcion: "Carne Picada", precio: 12980, flagBalanza: "PESABLE", categoria: "Vacuno" },
  { plu: "834", descripcion: "Costilla Derecha", precio: 12980, flagBalanza: "PESABLE", categoria: "Vacuno", familiaCorte: "Vacuno" },
  { plu: "830", descripcion: "Posta Rosada", precio: 13980, flagBalanza: "PESABLE", categoria: "Vacuno", familiaCorte: "Vacuno" },
  { plu: "832", descripcion: "Posta Paleta", precio: 13980, flagBalanza: "PESABLE", categoria: "Vacuno", familiaCorte: "Vacuno" },
  { plu: "825", descripcion: "Posta Negra", precio: 13980, flagBalanza: "PESABLE", categoria: "Vacuno", familiaCorte: "Vacuno" },
  { plu: "823", descripcion: "Punta Paleta", precio: 13980, flagBalanza: "PESABLE", categoria: "Vacuno", familiaCorte: "Vacuno" },
  { plu: "822", descripcion: "Asiento", precio: 16980, flagBalanza: "PESABLE", categoria: "Vacuno", familiaCorte: "Vacuno" },
  { plu: "836", descripcion: "Flat Iron", precio: 17980, flagBalanza: "PESABLE", categoria: "Vacuno", familiaCorte: "Vacuno", featured: true },
  { plu: "821", descripcion: "Lomo Liso", precio: 17980, flagBalanza: "PESABLE", categoria: "Vacuno", familiaCorte: "Vacuno" },
  { plu: "820", descripcion: "Lomo Vetado Vacuno", precio: 18980, flagBalanza: "PESABLE", categoria: "Vacuno", familiaCorte: "Vacuno" },
  { plu: "841", descripcion: "Entraña", precio: 18980, flagBalanza: "PESABLE", categoria: "Vacuno", familiaCorte: "Vacuno" },
  { plu: "844", descripcion: "Filete de Vacuno", precio: 24980, flagBalanza: "PESABLE", categoria: "Vacuno", familiaCorte: "Vacuno" },
];

// --- Artesanales (8 de 16 — Choripán/Longaniza comparten PLU entre sabores,
// y Butifarra + las 3 hamburguesas no traían PLU en el documento) ---
const ARTESANALES: ProductoCarga[] = [
  { plu: "816", descripcion: "Hueso Ahumado", precio: 7980, flagBalanza: "PESABLE", categoria: "Artesanales" },
  { plu: "797", descripcion: "Pernil Ahumado", precio: 8900, flagBalanza: "PESABLE", categoria: "Artesanales" },
  { plu: "798", descripcion: "Chuleta Ahumada", precio: 8980, flagBalanza: "PESABLE", categoria: "Artesanales" },
  { plu: "793", descripcion: "Arrollado de Huaso", precio: 9890, flagBalanza: "PESABLE", categoria: "Artesanales" },
  { plu: "799", descripcion: "Lomo Ahumado", precio: 9890, flagBalanza: "PESABLE", categoria: "Artesanales" },
  { plu: "804", descripcion: "Tocino Ahumado", precio: 9800, flagBalanza: "PESABLE", categoria: "Artesanales" },
  { plu: "069", descripcion: "Costillar Ahumado", precio: 11980, flagBalanza: "PESABLE", categoria: "Artesanales" },
  { plu: "837", descripcion: "Pastrami", precio: 22980, flagBalanza: "PESABLE", categoria: "Artesanales" },
];

const PRODUCTOS: ProductoCarga[] = [...CERDO, ...VACUNO, ...ARTESANALES];

// Categorías del catálogo (spec sección 4 y 10) — las últimas 3 quedan
// vacías a propósito, "pendientes de poblar".
const CATEGORIAS = ["Pollo", "Cerdo", "Vacuno", "Artesanales", "Congelados", "Envasado Entero", "Frutas y Hortalizas"];

// Opciones de corte estándar (spec sección 4).
const CORTES: { familia: string; nombre: string; orden: number }[] = [
  ...["Bifes", "Trozo entero", "Medallones", "Molida", "Picada", "Parrilla", "Otro"].map((nombre, orden) => ({
    familia: "Vacuno",
    nombre,
    orden,
  })),
  ...["Bifes", "Trozo entero", "Medallones", "Molida", "Picada", "Parrilla", "Otro"].map((nombre, orden) => ({
    familia: "Cerdo",
    nombre,
    orden,
  })),
  ...["Trozado por unidad", "Parrilla", "Otro"].map((nombre, orden) => ({ familia: "Pollo", nombre, orden })),
];

// Productos reales del documento que quedaron fuera de PRODUCTOS, y por qué
// — no se inventa un PLU para ninguno de estos, hay que confirmarlo contra
// la balanza/el sistema actual antes de cargarlos.
const EXCLUIDOS = [
  "Pollo (16 productos: Panita, Patas, Trutro Largo/Barquillo, Trutro Entero, Cazuela, Ala Entera, Contre, Corazón, Trutro Corto, Trutro Deshuesado, Trutro Ala, Pechuga Entera, Pechuga Trozo, Filete, Pechuga Deshuesada, Pollo Entero) — el documento no trae PLU para ninguno de estos (la tabla de Pollo no tiene columna PLU).",
  "Panita de Vacuno (Fresco) — sin PLU en el documento.",
  "Choripán Tradicional y Choripán Picante — ambos comparten el PLU 801 en el documento (probablemente el mismo código de pesaje para las dos variantes) — hay que decidir si son un solo producto o si tienen PLUs distintos en la balanza real.",
  "Longaniza Tradicional y Longaniza Picante — mismo caso, ambas con PLU 811.",
  "Butifarra — sin PLU en el documento.",
  "Hamburguesa 175 g, Hamburguesa 80 g, Hamburguesa de Queso 180 g — venta por unidad, sin PLU en el documento (probablemente van con código de barras propio, no PLU de balanza).",
];

async function categoriasPorNombre(): Promise<Map<string, number>> {
  const todas = await prisma.categoria.findMany({ where: { nivel: 1 } });
  const mapa = new Map<string, number>();
  for (const c of todas) mapa.set(c.nombre.trim().toLowerCase(), c.id);
  return mapa;
}

function slugCodigo(nombre: string): string {
  return (
    "CAT-" +
    nombre
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "")
  );
}

async function main() {
  console.log(confirmar ? "Modo: CONFIRMAR (se va a escribir en la base de datos)" : "Modo: SIMULACIÓN (no se escribe nada — usa --confirmar para aplicar)");
  console.log("");

  // --- Categorías ---
  const mapaCategorias = await categoriasPorNombre();
  for (const nombre of CATEGORIAS) {
    if (mapaCategorias.has(nombre.toLowerCase())) {
      console.log(`[categoría] "${nombre}" ya existe — se reutiliza.`);
      continue;
    }
    console.log(`[categoría] "${nombre}" no existe — se crearía con código ${slugCodigo(nombre)}.`);
    if (confirmar) {
      const creada = await prisma.categoria.create({ data: { codigo: slugCodigo(nombre), nombre, nivel: 1 } });
      mapaCategorias.set(nombre.toLowerCase(), creada.id);
    }
  }
  console.log("");

  // --- Opciones de corte ---
  for (const c of CORTES) {
    const existente = await prisma.corteOpcion.findUnique({ where: { familia_nombre: { familia: c.familia, nombre: c.nombre } } }).catch(() => null);
    if (existente) {
      console.log(`[corte] ${c.familia} · ${c.nombre} ya existe.`);
      continue;
    }
    console.log(`[corte] ${c.familia} · ${c.nombre} se crearía.`);
    if (confirmar) {
      await prisma.corteOpcion.create({ data: c });
    }
  }
  console.log("");

  // --- Productos ---
  let creados = 0;
  let omitidos = 0;
  for (const p of PRODUCTOS) {
    const yaExiste = await prisma.producto.findUnique({ where: { plu: p.plu } });
    if (yaExiste) {
      console.log(`[producto] PLU ${p.plu} (${p.descripcion}) ya existe — se omite.`);
      omitidos++;
      continue;
    }

    const categoriaId = confirmar
      ? mapaCategorias.get(p.categoria.toLowerCase())
      : mapaCategorias.get(p.categoria.toLowerCase()) ?? -1; // en simulación puede no existir todavía
    if (confirmar && !categoriaId) {
      console.log(`[producto] PLU ${p.plu} (${p.descripcion}): no se encontró la categoría "${p.categoria}" — se omite.`);
      omitidos++;
      continue;
    }

    console.log(`[producto] PLU ${p.plu} — ${p.descripcion} — $${p.precio} — ${p.flagBalanza} — ${p.categoria}`);
    if (confirmar) {
      await prisma.producto.create({
        data: {
          plu: p.plu,
          descripcion: p.descripcion,
          precio: p.precio,
          flagBalanza: p.flagBalanza,
          categoriaId: categoriaId!,
          marca: p.marca ?? null,
          familiaCorte: p.familiaCorte ?? null,
          featured: p.featured ?? false,
          promoPrecioUnitario: p.promoPrecioUnitario ?? null,
          promoGramosMinimos: p.promoGramosMinimos ?? null,
          promoEtiqueta: p.promoEtiqueta ?? null,
        },
      });
    }
    creados++;
  }

  console.log("");
  console.log(`${confirmar ? "Creados" : "Se crearían"}: ${creados}. Ya existentes (omitidos): ${omitidos}.`);
  console.log("");
  console.log("Quedan FUERA de esta carga (sin PLU confiable en el documento — confirmar antes de cargar a mano):");
  for (const linea of EXCLUIDOS) console.log(`  - ${linea}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
