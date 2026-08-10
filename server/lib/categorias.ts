import { prisma } from "../db";

// Un cambio masivo "por categoría" debe alcanzar también a las subcategorías,
// ej. aplicar a "01 Aves" incluye "0101 Pollos" y "010101 Trutros".
export async function obtenerIdsCategoriaYDescendientes(categoriaId: number): Promise<number[]> {
  const todas = await prisma.categoria.findMany({ select: { id: true, padreId: true } });

  const resultado = new Set<number>([categoriaId]);
  let agregoAlguno = true;
  while (agregoAlguno) {
    agregoAlguno = false;
    for (const cat of todas) {
      if (cat.padreId !== null && resultado.has(cat.padreId) && !resultado.has(cat.id)) {
        resultado.add(cat.id);
        agregoAlguno = true;
      }
    }
  }
  return Array.from(resultado);
}
