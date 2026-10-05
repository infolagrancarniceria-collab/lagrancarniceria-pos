import { describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "../index";
import { prisma } from "../db";
import { crearFixturesBasicas } from "./fixtures";

const api = request(app);

// Recorte representativo del formato real exportado por el programa
// anterior (ver 9d178705-respaldo_recetas_2026-10-01.json) — cubre: un
// ingrediente con unidad "diente", uno con "ml", uno con cantidad 0 (debe
// omitirse), un ingrediente repetido entre dos recetas (debe reusarse, no
// duplicarse) y una receta "pendiente" sin ingredientes (debe importarse
// igual, como borrador).
// sufijo único por llamado — la tabla de catálogo es global y persiste
// entre tests (comparten el mismo archivo SQLite, ver vitest.config.ts),
// así que dos tests no pueden usar el mismo nombre de receta sin chocar
// con el chequeo de "ya existe" del propio importador.
function datosDePrueba(sufijo: string) {
  const sal = `Sal-${sufijo}`;
  return {
    recetas: {
      damasco: {
        nombre: `Longaniza con damasco turco ${sufijo}`,
        categoria: "Longanizas",
        preparacion: "Hidratar el damasco...",
        ingredientes: [
          { id: "fruta", nombre: `Damasco turco seco ${sufijo}`, cantidad: 70, unidad: "g" },
          { id: "sal", nombre: sal, cantidad: 15, unidad: "g" },
          { id: "vino", nombre: `Vino blanco seco ${sufijo}`, cantidad: 15, unidad: "ml" },
        ],
      },
      butifarra: {
        nombre: `Butifarra ${sufijo}`,
        categoria: "Embutidos",
        preparacion: "Vinagre; sin vino.",
        ingredientes: [
          { id: "sal", nombre: sal, cantidad: 15, unidad: "g" },
          { id: "ajo", nombre: `Ajo fresco ${sufijo}`, cantidad: 1.5, unidad: "diente" },
          { id: "paprika", nombre: `Paprika ${sufijo}`, cantidad: 0, unidad: "g" },
        ],
      },
      costillar_ahumado: {
        nombre: `Costillar ahumado ${sufijo}`,
        categoria: "Ahumados",
        pendiente: true,
        preparacion: "Pendiente de completar.",
        ingredientes: [],
      },
    },
    pruebas: [{ id: "p1", receta: "damasco", nombre: "prueba 1", fecha: "2026-09-07", calificacion: 4 }],
    actualizado: "2026-09-28T22:21:30.489Z",
    eliminadas: [],
    formato: "La Gran Carnicería · Programa de Recetas",
    version: 3,
  };
}

describe("Charcutería — importar recetas del programa anterior", () => {
  it("importa productos elaborados y recetas como borrador (sin rendimiento, inactivas), reusando ingredientes repetidos y mapeando unidades", async () => {
    const { usuario } = await crearFixturesBasicas();
    const s = `imp1-${Date.now()}`;

    const res = await api.post("/api/charcuteria/recetas/importar-json").send({ usuarioId: usuario.id, datos: datosDePrueba(s) });
    expect(res.status).toBe(201);
    expect(res.body.creadas).toHaveLength(3);
    expect(res.body.omitidas).toHaveLength(0);

    const damasco = res.body.creadas.find((c: { nombre: string }) => c.nombre === `Longaniza con damasco turco ${s}`);
    expect(damasco.ingredientesCreados).toBe(3); // Damasco turco seco, Sal, Vino blanco seco
    expect(damasco.ingredientesReusados).toBe(0);

    const receta = await prisma.receta.findUnique({ where: { id: damasco.recetaId }, include: { ingredientes: { include: { item: true } } } });
    expect(receta).toBeTruthy();
    expect(receta!.activa).toBe(false);
    expect(receta!.rendimientoEsperadoPct).toBeNull();
    const vino = receta!.ingredientes.find((i) => i.item.nombre === `Vino blanco seco ${s}`);
    expect(vino!.unidad).toBe("gramos"); // ml se trata como gramos
    expect(vino!.cantidadPorLoteBase).toBe(15);

    const productoElaborado = await prisma.itemCharcuteria.findUnique({ where: { id: receta!.productoElaboradoId } });
    expect(productoElaborado!.categoria).toBe("Longanizas");

    // Butifarra: "Sal" ya existía (creada al importar damasco) -> se reusa,
    // no se duplica; "Ajo fresco" en "diente" -> unidad "unidad"; "Paprika"
    // con cantidad 0 -> se omite.
    const butifarra = res.body.creadas.find((c: { nombre: string }) => c.nombre === `Butifarra ${s}`);
    expect(butifarra.ingredientesReusados).toBe(1); // Sal
    expect(butifarra.ingredientesCreados).toBe(1); // Ajo fresco
    expect(butifarra.ingredientesOmitidos).toHaveLength(1);
    expect(butifarra.ingredientesOmitidos[0]).toMatch(/Paprika/);

    const recetaButifarra = await prisma.receta.findUnique({
      where: { id: butifarra.recetaId },
      include: { ingredientes: { include: { item: true } } },
    });
    const ajo = recetaButifarra!.ingredientes.find((i) => i.item.nombre === `Ajo fresco ${s}`);
    expect(ajo!.unidad).toBe("unidad");
    expect(ajo!.cantidadPorLoteBase).toBe(1.5);

    const sal = await prisma.itemCharcuteria.findMany({ where: { nombre: `Sal-${s}` } });
    expect(sal).toHaveLength(1); // no se duplicó entre las dos recetas

    // Costillar ahumado: sin ingredientes, se importa igual como borrador.
    const costillar = res.body.creadas.find((c: { nombre: string }) => c.nombre === `Costillar ahumado ${s}`);
    expect(costillar).toBeTruthy();
    const recetaCostillar = await prisma.receta.findUnique({ where: { id: costillar.recetaId }, include: { ingredientes: true } });
    expect(recetaCostillar!.ingredientes).toHaveLength(0);
  });

  it("no duplica un producto elaborado si se vuelve a importar el mismo archivo", async () => {
    const { usuario } = await crearFixturesBasicas();
    const s = `imp2-${Date.now()}`;
    await api.post("/api/charcuteria/recetas/importar-json").send({ usuarioId: usuario.id, datos: datosDePrueba(s) });

    const segundaVez = await api.post("/api/charcuteria/recetas/importar-json").send({ usuarioId: usuario.id, datos: datosDePrueba(s) });
    expect(segundaVez.status).toBe(201);
    expect(segundaVez.body.creadas).toHaveLength(0);
    expect(segundaVez.body.omitidas).toHaveLength(3);
    expect(segundaVez.body.omitidas[0].motivo).toMatch(/ya existe/i);
  });

  it("no deja crear un lote con una receta importada hasta confirmar el rendimiento esperado", async () => {
    const { usuario } = await crearFixturesBasicas();
    const s = `imp3-${Date.now()}`;
    const importar = await api
      .post("/api/charcuteria/recetas/importar-json")
      .send({ usuarioId: usuario.id, datos: datosDePrueba(s) });
    const damasco = importar.body.creadas.find((c: { nombre: string }) => c.nombre === `Longaniza con damasco turco ${s}`);

    const lote = await api.post("/api/charcuteria/lotes").send({ usuarioId: usuario.id, recetaId: damasco.recetaId });
    expect(lote.status).toBe(400);
    expect(lote.body.error).toMatch(/rendimiento esperado/i);
  });
});
