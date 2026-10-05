import { describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "../index";
import { prisma } from "../db";

const api = request(app);

// GET /margenes mandaba antes solo el array de productos CON costo
// conocido, perdiendo el total real — la pantalla "Mejor margen" nunca
// pudo avisar cuántos productos quedaban fuera por no tener ningún costo
// (ni compra real ni de referencia), aunque el comentario del código ya
// decía que debía hacerlo.
describe("GET /api/productos/margenes — trae el total además de los que sí tienen costo", () => {
  it("el total cuenta también los productos activos sin ningún costo conocido", async () => {
    const categoria = await prisma.categoria.create({ data: { codigo: `CAT-MARG-${Date.now()}`, nombre: "Margen test", nivel: 1 } });

    const conCosto = await prisma.producto.create({
      data: { plu: `PLU-CONCOSTO-${Date.now()}`, descripcion: "Con costo", categoriaId: categoria.id, precio: 10000, flagBalanza: "NORMAL", costoReferencia: 5000 },
    });
    const sinCosto = await prisma.producto.create({
      data: { plu: `PLU-SINCOSTO-${Date.now()}`, descripcion: "Sin costo", categoriaId: categoria.id, precio: 8000, flagBalanza: "NORMAL" },
    });

    const res = await api.get(`/api/productos/margenes?categoriaId=${categoria.id}`);
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(2);
    expect(res.body.conCosto.some((p: { id: number }) => p.id === conCosto.id)).toBe(true);
    expect(res.body.conCosto.some((p: { id: number }) => p.id === sinCosto.id)).toBe(false);
  });
});
