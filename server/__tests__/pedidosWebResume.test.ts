import { describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "../index";
import { crearFixturesBasicas, crearPedidoWeb } from "./fixtures";

const api = request(app);

// Antes, "Pedidos web" solo miraba si ventaGeneradaId existía para decidir
// si mostraba "Ir a pistolear" — pero esa venta se crea apenas se entra a
// pistolear, incluso si queda a medio escanear. El cajero que salía antes
// de terminar y volvía a la lista se quedaba sin botón para retomarlo (la
// única señal visible era que ya "tenía venta", sin importar si estaba
// confirmada o no). Ahora el pedido también expone el estado de esa venta
// para distinguir los dos casos.
describe("GET /api/pedidos-web — ventaGeneradaEstado", () => {
  it("es null si el pedido todavía no tiene ninguna venta", async () => {
    const pedido = await crearPedidoWeb();

    const res = await api.get("/api/pedidos-web");
    const encontrado = res.body.find((p: { id: number }) => p.id === pedido.id);

    expect(encontrado.ventaGeneradaId).toBeNull();
    expect(encontrado.ventaGeneradaEstado).toBeNull();
  });

  it("es 'abierta' mientras el pedido se está pistoleando y no se ha confirmado", async () => {
    const { usuario } = await crearFixturesBasicas();
    const pedido = await crearPedidoWeb();
    await api.post(`/api/caja/ventas/desde-pedido-web/${pedido.id}`).send({ usuarioId: usuario.id });

    const res = await api.get("/api/pedidos-web");
    const encontrado = res.body.find((p: { id: number }) => p.id === pedido.id);

    expect(encontrado.ventaGeneradaId).not.toBeNull();
    expect(encontrado.ventaGeneradaEstado).toBe("abierta");
  });
});
