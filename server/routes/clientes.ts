import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db";

export const clientesRouter = Router();

// Buscar clientes por nombre, RUT o teléfono — usado por el selector de
// cliente en Punto de Venta (crédito/transferencia) para no tener que
// escribir el nombre a mano cada vez y evitar duplicados por typos. Un
// límite chico (20) porque esto se muestra como lista desplegable mientras
// se escribe, no como listado completo. Sin "buscar" (ej. la pantalla
// Clientes) devuelve la lista completa, cada uno con lo que debe pendiente
// (crédito + transferencia sin cobrar) para verlo de un vistazo.
clientesRouter.get("/", async (req, res) => {
  const buscar = typeof req.query.buscar === "string" ? req.query.buscar.trim() : "";

  const clientes = await prisma.cliente.findMany({
    where: buscar
      ? { OR: [{ nombre: { contains: buscar } }, { rut: { contains: buscar } }, { telefono: { contains: buscar } }] }
      : undefined,
    orderBy: { nombre: "asc" },
    take: buscar ? 20 : 500,
  });
  if (buscar) return res.json(clientes);

  const pendientes = await prisma.pagoVenta.groupBy({
    by: ["clienteId"],
    where: { clienteId: { not: null }, cobrado: false },
    _sum: { monto: true },
  });
  const pendientePorCliente = new Map(pendientes.map((p) => [p.clienteId, p._sum.monto ?? 0]));
  res.json(clientes.map((c) => ({ ...c, deudaPendiente: pendientePorCliente.get(c.id) ?? 0 })));
});

clientesRouter.get("/:id", async (req, res) => {
  const id = Number(req.params.id);
  const cliente = await prisma.cliente.findUnique({ where: { id } });
  if (!cliente) return res.status(404).json({ error: "Cliente no encontrado" });
  res.json(cliente);
});

const crearClienteSchema = z.object({
  nombre: z.string().trim().min(1, "El nombre no puede estar vacío"),
  telefono: z.string().trim().optional().nullable(),
  rut: z.string().trim().optional().nullable(),
  notas: z.string().trim().optional().nullable(),
});

clientesRouter.post("/", async (req, res) => {
  const parsed = crearClienteSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0].message });
  }
  const cliente = await prisma.cliente.create({
    data: {
      nombre: parsed.data.nombre,
      telefono: parsed.data.telefono || null,
      rut: parsed.data.rut || null,
      notas: parsed.data.notas || null,
    },
  });
  res.status(201).json(cliente);
});

clientesRouter.put("/:id", async (req, res) => {
  const id = Number(req.params.id);
  const existente = await prisma.cliente.findUnique({ where: { id } });
  if (!existente) return res.status(404).json({ error: "Cliente no encontrado" });

  const parsed = crearClienteSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0].message });
  }
  const cliente = await prisma.cliente.update({
    where: { id },
    data: {
      nombre: parsed.data.nombre,
      telefono: parsed.data.telefono || null,
      rut: parsed.data.rut || null,
      notas: parsed.data.notas || null,
    },
  });
  res.json(cliente);
});

// Estado de cuenta: cuánto debe hoy (crédito + transferencia sin cobrar,
// separado por medio para que se pueda seguir viendo aparte igual que en
// Créditos pendientes) y el historial completo de pagos a crédito o
// transferencia de este cliente, cobrados o no — para ver de un vistazo
// "cuánto me debe fulano" y desde cuándo.
clientesRouter.get("/:id/estado-cuenta", async (req, res) => {
  const id = Number(req.params.id);
  const cliente = await prisma.cliente.findUnique({ where: { id } });
  if (!cliente) return res.status(404).json({ error: "Cliente no encontrado" });

  const pagos = await prisma.pagoVenta.findMany({
    where: { clienteId: id },
    include: { venta: true },
    orderBy: { venta: { fecha: "desc" } },
  });

  const pendientePorMedio: Record<string, number> = { credito: 0, transferencia: 0 };
  for (const pago of pagos) {
    if (!pago.cobrado) {
      pendientePorMedio[pago.medio] = (pendientePorMedio[pago.medio] ?? 0) + pago.monto;
    }
  }
  const totalPendiente = Object.values(pendientePorMedio).reduce((s, m) => s + m, 0);

  res.json({ cliente, pagos, pendientePorMedio, totalPendiente });
});

export default clientesRouter;
