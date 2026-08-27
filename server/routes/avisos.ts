import { Router } from "express";
import { calcularAvisosCriticos } from "../lib/avisos";

export const avisosRouter = Router();

// Avisos proactivos (caja de un día anterior sin cerrar, stock bajo, cajas
// de cámara estancadas, ajustes pendientes de cámara) — a pedido del
// usuario, para no depender de entrar a cada pantalla a revisar si hay
// algo pendiente. El frontend consulta esto al cargar y después cada
// cierto tiempo (ver Layout.tsx) para mantener el aviso en el menú al día.
avisosRouter.get("/", async (_req, res) => {
  const avisos = await calcularAvisosCriticos();
  res.json(avisos);
});
