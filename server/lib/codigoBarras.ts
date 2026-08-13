export interface CodigoBalanzaDecodificado {
  plu: string;
  pesoKg: number;
}

function checksumEan13Valido(codigo: string): boolean {
  let suma = 0;
  for (let i = 0; i < 12; i++) {
    const digito = Number(codigo[i]);
    suma += i % 2 === 0 ? digito : digito * 3;
  }
  const verificador = (10 - (suma % 10)) % 10;
  return verificador === Number(codigo[12]);
}

// Formato confirmado por foto real de ticket: para productos "Pesable", la
// balanza imprime un código de 13 dígitos: "2" + PLU (6 dígitos) + peso en
// gramos (5 dígitos) + dígito verificador (ej. PLU 1, 226 g -> "2000001002261").
// No confirmado todavía para productos "Importe" (precio fijo) — no se
// decodifica ese caso, solo el de productos pesables.
export function decodificarCodigoBalanza(codigo: string): CodigoBalanzaDecodificado | null {
  if (!/^2\d{12}$/.test(codigo)) return null;
  if (!checksumEan13Valido(codigo)) return null;
  const plu = codigo.slice(1, 7).replace(/^0+/, "") || "0";
  const pesoGramos = Number(codigo.slice(7, 12));
  return { plu, pesoKg: pesoGramos / 1000 };
}
