import { Router } from "express";
import { networkInterfaces } from "node:os";
import { z } from "zod";
import { prisma } from "../db";
import { sincronizarCatalogoConWeb } from "../lib/syncWeb";

export const configuracionRouter = Router();

// Para poder conectar otro equipo (ej. un monitor en el mesón) por WiFi al
// mismo servidor, sin tener que buscar la IP a mano con "ipconfig" — se
// descartan direcciones internas/loopback, solo interesan las de la red
// local real.
configuracionRouter.get("/direccion-red", async (_req, res) => {
  const interfaces = networkInterfaces();
  const direcciones: string[] = [];
  for (const detalles of Object.values(interfaces)) {
    for (const info of detalles ?? []) {
      if (info.family === "IPv4" && !info.internal) {
        direcciones.push(info.address);
      }
    }
  }
  res.json({ direcciones, puerto: Number(process.env.PORT) || 5175 });
});

configuracionRouter.get("/ia/estado", async (_req, res) => {
  const config = await prisma.configuracionIA.findFirst();
  res.json({ configurada: !!config });
});

const configurarIaSchema = z.object({
  claveApiAnthropic: z.string().trim().min(1, "Falta la clave de API"),
});

configuracionRouter.post("/ia", async (req, res) => {
  const parsed = configurarIaSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0].message });
  }
  const { claveApiAnthropic } = parsed.data;

  const existente = await prisma.configuracionIA.findFirst();
  if (existente) {
    await prisma.configuracionIA.update({ where: { id: existente.id }, data: { claveApiAnthropic } });
  } else {
    await prisma.configuracionIA.create({ data: { claveApiAnthropic } });
  }
  res.status(204).send();
});

// No devuelve syncApiKey (mismo criterio que /ia/estado con la clave de
// IA) — solo si ya hay algo guardado y, de haberlo, la URL (que no es
// secreta, sirve para mostrarla en la pantalla).
configuracionRouter.get("/sync-web/estado", async (_req, res) => {
  const config = await prisma.configuracionSyncWeb.findFirst();
  res.json({
    configurada: !!(config?.webSyncUrl && config?.syncApiKey),
    webSyncUrl: config?.webSyncUrl ?? null,
  });
});

const configurarSyncWebSchema = z.object({
  webSyncUrl: z.string().trim().url("La URL no es válida (debe empezar con https://)"),
  syncApiKey: z.string().trim().min(1, "Falta la llave de sync"),
});

configuracionRouter.post("/sync-web", async (req, res) => {
  const parsed = configurarSyncWebSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0].message });
  }
  const { webSyncUrl, syncApiKey } = parsed.data;

  const existente = await prisma.configuracionSyncWeb.findFirst();
  if (existente) {
    await prisma.configuracionSyncWeb.update({ where: { id: existente.id }, data: { webSyncUrl, syncApiKey } });
  } else {
    await prisma.configuracionSyncWeb.create({ data: { webSyncUrl, syncApiKey } });
  }
  // Sincroniza al tiro (sin esperarla) para que la pantalla no tenga que
  // esperar los hasta 5 minutos del ciclo normal para confirmar que quedó
  // bien configurado.
  void sincronizarCatalogoConWeb();
  res.status(204).send();
});
