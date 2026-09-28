// Seed de DESARROLLO para el módulo de charcutería — nunca para producción.
// Crea 3 recetas (pastrami, tocino ahumado, longaniza con ciruela), 2 lotes
// de producción completos (con costeo/merma real y envasado) y una venta de
// prueba con FEFO, para poder abrir el programa y ver el módulo con datos
// reales en vez de vacío.
//
// Usa una mezcla a propósito: lo que ya existe como endpoint HTTP normal
// (catálogo, recetas, transferencias, lotes, ventas) se crea llamando a la
// API real en vez de escribir directo con Prisma — así el seed queda
// forzado a pasar por las mismas validaciones y cálculos (costeo, merma,
// FEFO) que usa cualquier persona usando el programa, en vez de arriesgarse
// a insertar datos que la lógica real nunca produciría. Solo lo que no
// tiene endpoint (usuario con rol admin, clave de supervisor, abrir caja)
// se escribe directo con Prisma.
//
// Requiere el servidor corriendo en local (npm run dev:server, puerto
// 5175 por defecto) ANTES de correr este script:
//
//   npx tsx scripts/seed-charcuteria-dev.ts

import { PrismaClient } from "@prisma/client";
import { hashClave } from "../server/lib/clave";

const prisma = new PrismaClient();
const BASE = process.env.SEED_API_BASE ?? "http://localhost:5175/api";

async function llamar<T>(metodo: string, ruta: string, cuerpo?: unknown): Promise<T> {
  const res = await fetch(BASE + ruta, {
    method: metodo,
    headers: cuerpo ? { "Content-Type": "application/json" } : undefined,
    body: cuerpo ? JSON.stringify(cuerpo) : undefined,
  });
  const texto = await res.text();
  let json: unknown;
  try {
    json = texto ? JSON.parse(texto) : undefined;
  } catch {
    json = texto;
  }
  if (!res.ok) {
    throw new Error(`${metodo} ${ruta} -> ${res.status}: ${JSON.stringify(json)}`);
  }
  return json as T;
}

async function main() {
  console.log("== Seed de desarrollo: módulo de charcutería ==");

  // --- Usuario admin de prueba + clave de supervisor + clave personal ---
  const usuario = await prisma.usuario.upsert({
    where: { nombre: "Charcutería Dev" },
    update: { rol: "admin", hashClavePersonal: hashClave("1234") },
    create: { nombre: "Charcutería Dev", rol: "admin", hashClavePersonal: hashClave("1234") },
  });
  console.log(`Usuario listo: ${usuario.nombre} (id ${usuario.id}, rol ${usuario.rol}, clave personal "1234")`);

  const claveSupervisorExistente = await prisma.claveSupervisor.findFirst();
  if (!claveSupervisorExistente) {
    await prisma.claveSupervisor.create({ data: { hashClave: hashClave("1234") } });
    console.log('Clave de supervisor configurada: "1234"');
  }

  // --- Caja abierta (necesaria para poder vender) ---
  let sesion = await prisma.sesionCaja.findFirst({ where: { estado: "abierta" } });
  if (!sesion) {
    sesion = await prisma.sesionCaja.create({ data: { usuarioAperturaId: usuario.id, fondoFijoInicial: 20000 } });
    console.log(`Caja abierta (sesión ${sesion.id})`);
  }

  // --- Materia prima de carnicería (si no existen ya) ---
  let categoriaCarnes = await prisma.categoria.findFirst({ where: { nombre: "Carnes" } });
  if (!categoriaCarnes) {
    categoriaCarnes = await prisma.categoria.create({ data: { codigo: "CARNES-DEV", nombre: "Carnes", nivel: 1 } });
  }

  async function productoCarniceria(plu: string, descripcion: string, precio: number, stockActual: number) {
    return prisma.producto.upsert({
      where: { plu },
      update: { precio, stockActual },
      create: { plu, descripcion, categoriaId: categoriaCarnes!.id, precio, flagBalanza: "PESABLE", stockActual },
    });
  }

  const lomoVetado = await productoCarniceria("9001-DEV", "Lomo Vetado", 8990, 30);
  const panceta = await productoCarniceria("9002-DEV", "Panceta de Cerdo", 5990, 30);
  const carneMolida = await productoCarniceria("9003-DEV", "Carne de Cerdo Molida", 4990, 30);
  console.log("Materia prima de carnicería lista (Lomo Vetado, Panceta de Cerdo, Carne de Cerdo Molida)");

  // --- Catálogo de charcutería: insumos y envases comunes ---
  async function crearItemSiNoExiste(codigo: string, datos: Record<string, unknown>) {
    const existente = await prisma.itemCharcuteria.findUnique({ where: { codigo } });
    if (existente) return existente;
    return llamar("POST", "/charcuteria/items", { usuarioId: usuario.id, codigo, ...datos });
  }

  const salCurante = await crearItemSiNoExiste("INS-SAL-CURANTE", {
    nombre: "Sal curante", tipoItem: "insumo", unidadMedida: "gramos",
  });
  const especiasPastrami = await crearItemSiNoExiste("INS-ESPECIAS-PASTRAMI", {
    nombre: "Mezcla de especias pastrami", tipoItem: "insumo", unidadMedida: "gramos",
  });
  const cirvelaDeshidratada = await crearItemSiNoExiste("INS-CIRUELA", {
    nombre: "Ciruela deshidratada picada", tipoItem: "insumo", unidadMedida: "gramos",
  });
  const tripaNatural = await crearItemSiNoExiste("INS-TRIPA", {
    nombre: "Tripa natural", tipoItem: "insumo", unidadMedida: "unidad",
  });
  const bolsa200 = await crearItemSiNoExiste("ENV-BOLSA-200", {
    nombre: "Bolsa vacío 200g", tipoItem: "envase_etiqueta", unidadMedida: "unidad",
  });
  const etiqueta = await crearItemSiNoExiste("ENV-ETIQUETA", {
    nombre: "Etiqueta con datos de rotulado", tipoItem: "envase_etiqueta", unidadMedida: "unidad",
  });
  console.log("Insumos y envases listos");

  // --- Materia prima de charcutería (paralela) ---
  const mpLomo = await crearItemSiNoExiste("MP-LOMO-PASTRAMI", { nombre: "Lomo para pastrami", tipoItem: "materia_prima", unidadMedida: "gramos" });
  const mpPanceta = await crearItemSiNoExiste("MP-PANCETA", { nombre: "Panceta para tocino ahumado", tipoItem: "materia_prima", unidadMedida: "gramos" });
  const mpMolida = await crearItemSiNoExiste("MP-CERDO-MOLIDA", { nombre: "Cerdo molido para longaniza", tipoItem: "materia_prima", unidadMedida: "gramos" });

  // --- 3 productos elaborados + sus recetas ---
  interface DefinicionReceta {
    codigoElaborado: string;
    nombreElaborado: string;
    vidaUtilDias: number;
    rendimientoEsperadoPct: number;
    dosisSalesCurantesPorKg: number;
    ingredientes: { itemId: number; cantidadPorLoteBase: number; unidad: "gramos" | "unidad" }[];
    codigoSku: string;
    nombreSku: string;
    formatoGramos: number;
    precioVenta: number;
  }

  const definiciones: DefinicionReceta[] = [
    {
      codigoElaborado: "PE-PASTRAMI", nombreElaborado: "Pastrami elaborado", vidaUtilDias: 15,
      rendimientoEsperadoPct: 70, dosisSalesCurantesPorKg: 25,
      ingredientes: [
        { itemId: mpLomo.id, cantidadPorLoteBase: 3000, unidad: "gramos" },
        { itemId: salCurante.id, cantidadPorLoteBase: 75, unidad: "gramos" },
        { itemId: especiasPastrami.id, cantidadPorLoteBase: 60, unidad: "gramos" },
      ],
      codigoSku: "SKU-PASTRAMI-200", nombreSku: "Pastrami artesanal 200g", formatoGramos: 200, precioVenta: 9990,
    },
    {
      codigoElaborado: "PE-TOCINO", nombreElaborado: "Tocino ahumado elaborado", vidaUtilDias: 20,
      rendimientoEsperadoPct: 65, dosisSalesCurantesPorKg: 22,
      ingredientes: [
        { itemId: mpPanceta.id, cantidadPorLoteBase: 3000, unidad: "gramos" },
        { itemId: salCurante.id, cantidadPorLoteBase: 66, unidad: "gramos" },
      ],
      codigoSku: "SKU-TOCINO-200", nombreSku: "Tocino ahumado 200g", formatoGramos: 200, precioVenta: 8490,
    },
    {
      codigoElaborado: "PE-LONGANIZA-CIRUELA", nombreElaborado: "Longaniza con ciruela elaborada", vidaUtilDias: 10,
      rendimientoEsperadoPct: 85, dosisSalesCurantesPorKg: 18,
      ingredientes: [
        { itemId: mpMolida.id, cantidadPorLoteBase: 3000, unidad: "gramos" },
        { itemId: cirvelaDeshidratada.id, cantidadPorLoteBase: 300, unidad: "gramos" },
        { itemId: salCurante.id, cantidadPorLoteBase: 54, unidad: "gramos" },
        { itemId: tripaNatural.id, cantidadPorLoteBase: 6, unidad: "unidad" },
      ],
      codigoSku: "SKU-LONGANIZA-CIRUELA-200", nombreSku: "Longaniza con ciruela 200g", formatoGramos: 200, precioVenta: 7490,
    },
  ];

  const recetasCreadas: { def: DefinicionReceta; peId: number; skuId: number; skuProductoEspejoId: number; recetaId: number }[] = [];

  for (const def of definiciones) {
    let pe = await prisma.itemCharcuteria.findUnique({ where: { codigo: def.codigoElaborado } });
    if (!pe) {
      pe = await llamar("POST", "/charcuteria/items", {
        usuarioId: usuario.id, codigo: def.codigoElaborado, nombre: def.nombreElaborado,
        tipoItem: "producto_elaborado", unidadMedida: "gramos", vidaUtilDias: def.vidaUtilDias,
      });
    }

    let sku = await prisma.itemCharcuteria.findUnique({ where: { codigo: def.codigoSku } });
    if (!sku) {
      sku = await llamar("POST", "/charcuteria/items", {
        usuarioId: usuario.id, codigo: def.codigoSku, nombre: def.nombreSku, tipoItem: "producto_terminado",
        formatoGramos: def.formatoGramos, productoElaboradoId: pe.id, linea: "tabla", precioVenta: def.precioVenta,
      });
    }

    let receta = await prisma.receta.findFirst({ where: { productoElaboradoId: pe.id, activa: true } });
    if (!receta) {
      receta = await llamar("POST", "/charcuteria/recetas", {
        usuarioId: usuario.id, productoElaboradoId: pe.id,
        rendimientoEsperadoPct: def.rendimientoEsperadoPct, dosisSalesCurantesPorKg: def.dosisSalesCurantesPorKg,
        ingredientes: def.ingredientes,
      });
    }

    recetasCreadas.push({ def, peId: pe.id, skuId: sku.id, skuProductoEspejoId: sku.productoEspejoId!, recetaId: receta.id });
    console.log(`Receta lista: ${def.nombreElaborado} (v${receta.version})`);
  }

  // --- Transferencias: suficiente materia prima para 2 lotes ---
  async function transferirSiHaceFalta(productoOrigenId: number, itemDestinoId: number, cantidadKg: number) {
    const item = await prisma.itemCharcuteria.findUnique({ where: { id: itemDestinoId } });
    if (item && item.stockActual >= cantidadKg * 1000) return; // ya alcanza
    await llamar("POST", "/charcuteria/transferencias", {
      usuarioId: usuario.id, productoOrigenId, itemDestinoId, cantidad: cantidadKg,
    });
  }

  await transferirSiHaceFalta(lomoVetado.id, mpLomo.id, 6);
  await transferirSiHaceFalta(panceta.id, mpPanceta.id, 6);
  await transferirSiHaceFalta(carneMolida.id, mpMolida.id, 6);
  console.log("Transferencias de materia prima listas");

  // Insumos de charcutería (sal, especias, ciruela, tripa) no tienen un
  // "producto de carnicería" de origen — se cargan directo como compra
  // manual (ajuste de stock), ya que este seed es solo para tener datos de
  // prueba, no para simular una compra real a un proveedor de insumos.
  async function asegurarStockInsumo(itemId: number, minimoNecesario: number) {
    const item = await prisma.itemCharcuteria.findUniqueOrThrow({ where: { id: itemId } });
    if (item.stockActual >= minimoNecesario) return;
    const faltante = minimoNecesario - item.stockActual;
    await prisma.$transaction([
      prisma.itemCharcuteria.update({ where: { id: itemId }, data: { stockActual: { increment: faltante }, costoReferencia: item.costoReferencia ?? 10 } }),
      prisma.movimientoCharcuteria.create({
        data: { itemId, tipo: "entrada", motivo: "compra", cantidad: faltante, usuarioId: usuario.id },
      }),
    ]);
  }
  await asegurarStockInsumo(salCurante.id, 300);
  await asegurarStockInsumo(especiasPastrami.id, 100);
  await asegurarStockInsumo(cirvelaDeshidratada.id, 400);
  await asegurarStockInsumo(tripaNatural.id, 10);
  await asegurarStockInsumo(bolsa200.id, 30);
  await asegurarStockInsumo(etiqueta.id, 30);
  console.log("Stock de insumos/envases listo");

  // --- 2 lotes completos: pastrami y tocino ahumado (cerrados y envasados) ---
  async function crearLoteCompleto(def: DefinicionReceta, recetaId: number, mpItemId: number, skuId: number) {
    const codigoLoteExistente = await prisma.loteProduccion.findFirst({
      where: { recetaId, estado: { in: ["terminado", "envasado", "cerrado"] } },
    });
    if (codigoLoteExistente) {
      console.log(`Lote ya existía para ${def.nombreElaborado}: ${codigoLoteExistente.codigo}`);
      return;
    }

    const lote = await llamar<{ id: number; codigo: string }>("POST", "/charcuteria/lotes", { usuarioId: usuario.id, recetaId });
    await llamar("POST", `/charcuteria/lotes/${lote.id}/insumos`, { usuarioId: usuario.id, itemId: mpItemId, cantidad: 3000 });
    for (const ing of def.ingredientes) {
      if (ing.itemId === mpItemId) continue;
      await llamar("POST", `/charcuteria/lotes/${lote.id}/insumos`, { usuarioId: usuario.id, itemId: ing.itemId, cantidad: ing.cantidadPorLoteBase });
    }
    const pesoSalidaKg = Math.round(3 * (def.rendimientoEsperadoPct / 100) * 100) / 100;
    await llamar("PUT", `/charcuteria/lotes/${lote.id}/cerrar`, {
      usuarioId: usuario.id, pesoSalidaKg, horasManoObra: 3, costoHoraManoObra: 3500,
    });
    const unidadesGeneradas = Math.floor((pesoSalidaKg * 1000) / def.formatoGramos);
    await llamar("POST", `/charcuteria/lotes/${lote.id}/envasar`, {
      usuarioId: usuario.id, skuId, cantidadUnidadesGeneradas: unidadesGeneradas, pesoRealTotalUsadoG: unidadesGeneradas * def.formatoGramos,
      envaseItemId: bolsa200.id, envasesConsumidos: unidadesGeneradas, etiquetaItemId: etiqueta.id, etiquetasConsumidas: unidadesGeneradas,
    });
    console.log(`Lote completo: ${lote.codigo} (${def.nombreElaborado}) — ${unidadesGeneradas} unidades de ${def.nombreSku}`);
  }

  const pastrami = recetasCreadas[0];
  const tocino = recetasCreadas[1];
  await crearLoteCompleto(pastrami.def, pastrami.recetaId, mpLomo.id, pastrami.skuId);
  await crearLoteCompleto(tocino.def, tocino.recetaId, mpPanceta.id, tocino.skuId);

  // --- Venta de prueba (FEFO) ---
  const ventaExistente = await prisma.venta.findFirst({ where: { origenPedidoWebId: null, businessUnitId: 2 } });
  if (!ventaExistente) {
    const venta = await llamar<{ id: number }>("POST", "/caja/ventas", { usuarioId: usuario.id, auxiliar: true });
    await llamar("POST", `/caja/ventas/${venta.id}/items`, { productoId: pastrami.skuProductoEspejoId, cantidad: 1 });
    const ventaConItem = await llamar<{ total: number }>("GET", `/caja/ventas/${venta.id}`);
    await llamar("POST", `/caja/ventas/${venta.id}/pagos`, { medio: "efectivo", monto: ventaConItem.total });
    await llamar("POST", `/caja/ventas/${venta.id}/confirmar`, { usuarioId: usuario.id });
    console.log(`Venta de prueba confirmada (venta #${venta.id}, 1x ${pastrami.def.nombreSku})`);
  } else {
    console.log("Ya había una venta de charcutería de prueba, no se creó otra");
  }

  console.log("\n== Seed listo ==");
  console.log('Usuario "Charcutería Dev" — clave personal y clave de supervisor: 1234');
}

main()
  .catch((e) => {
    console.error("Seed falló:", e.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
