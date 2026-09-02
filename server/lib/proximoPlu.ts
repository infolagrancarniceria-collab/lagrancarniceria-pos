import { prisma } from "../db";

// Mayor PLU puramente numérico + 1, considerando también productos
// inactivos porque el PLU es único a nivel de toda la base de datos, no
// solo entre los activos. Usado tanto por el formulario normal de
// Productos (como sugerencia editable) como por la creación rápida desde
// Caja (donde no hay tiempo de pedirle un PLU al cajero).
export async function calcularProximoPlu(): Promise<string> {
  const productos = await prisma.producto.findMany({ select: { plu: true } });
  const maxNumerico = productos.reduce((max, p) => (/^\d+$/.test(p.plu) ? Math.max(max, Number(p.plu)) : max), 0);
  return String(maxNumerico + 1);
}
