import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db";
import { fechaLocalYMD } from "../lib/respaldos";
import { calcularReporteVentas } from "./reportes";

export const whatsappRouter = Router();

async function obtenerOConfigDefault() {
  const existente = await prisma.configuracionWhatsapp.findFirst();
  if (existente) return existente;
  return prisma.configuracionWhatsapp.create({ data: {} });
}

whatsappRouter.get("/configuracion", async (_req, res) => {
  const config = await obtenerOConfigDefault();
  res.json({ numeroDueno: config.numeroDueno });
});

const configurarSchema = z.object({
  numeroDueno: z.string().trim().min(1, "Falta el número de WhatsApp"),
});

whatsappRouter.post("/configuracion", async (req, res) => {
  const parsed = configurarSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0].message });
  }
  const existente = await obtenerOConfigDefault();
  const actualizado = await prisma.configuracionWhatsapp.update({
    where: { id: existente.id },
    data: { numeroDueno: parsed.data.numeroDueno },
  });
  res.json({ numeroDueno: actualizado.numeroDueno });
});

const formatoCLP = new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP", maximumFractionDigits: 0 });

function construirMensajeResumenDiario(
  fecha: string,
  reporte: Awaited<ReturnType<typeof calcularReporteVentas>>
): string {
  const lineas = [
    `Resumen del día — ${fecha}`,
    "",
    `Ventas: ${reporte.cantidadVentas}`,
    `Total vendido: ${formatoCLP.format(reporte.totalVentas)}`,
  ];
  if (reporte.cantidadVentasOnline > 0) {
    lineas.push(`De eso, pedidos web: ${reporte.cantidadVentasOnline} (${formatoCLP.format(reporte.totalVentasOnline)})`);
  }
  if (reporte.masVendidosPorCantidad.length > 0) {
    lineas.push("", "Más vendidos:");
    for (const p of reporte.masVendidosPorCantidad.slice(0, 5)) {
      lineas.push(`- ${p.descripcion}: ${p.cantidad}`);
    }
  }
  return lineas.join("\n");
}

// Se consulta periódicamente desde la app (ver Layout.tsx) mientras esté
// abierta — no hay envío 100% automático (eso requeriría contratar una API
// de WhatsApp Business, con costo por mensaje). Pasadas las 15:30 del día,
// la primera vez que se consulta arma el mensaje, marca el día como
// "ya preparado" (para no repetirlo de nuevo el mismo día aunque se
// vuelva a consultar) y lo devuelve listo para que el frontend abra
// WhatsApp con el texto ya escrito — solo falta un clic para mandarlo.
whatsappRouter.get("/resumen-pendiente", async (_req, res) => {
  const config = await obtenerOConfigDefault();
  if (!config.numeroDueno) return res.json({ pendiente: false });

  const ahora = new Date();
  const hoy = fechaLocalYMD(ahora);
  if (config.ultimoResumenPreparadoFecha === hoy) return res.json({ pendiente: false });

  const HORA_ENVIO = 15.5; // 15:30
  const horaActual = ahora.getHours() + ahora.getMinutes() / 60;
  if (horaActual < HORA_ENVIO) return res.json({ pendiente: false });

  const reporte = await calcularReporteVentas(hoy, hoy);
  const mensaje = construirMensajeResumenDiario(hoy, reporte);

  await prisma.configuracionWhatsapp.update({
    where: { id: config.id },
    data: { ultimoResumenPreparadoFecha: hoy },
  });

  res.json({ pendiente: true, mensaje, numeroDueno: config.numeroDueno });
});
