import { Fragment, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, formatoCLP, type FacturaAgrupada } from "../api";

function fechaHace(dias: number): string {
  const d = new Date();
  d.setDate(d.getDate() - dias);
  return d.toISOString().slice(0, 10);
}

function hoy(): string {
  return new Date().toISOString().slice(0, 10);
}

// Registro de facturas cargadas — a diferencia de "Historial de
// movimientos", acá cada factura es UNA fila (agrupada por proveedor + N°
// de factura), con sus líneas visibles al expandir. Pensado para revisar o
// respaldar rápido, con exportación a CSV (se abre en Excel) e impresión.
export default function Facturas() {
  const [desde, setDesde] = useState(fechaHace(30));
  const [hasta, setHasta] = useState(hoy());
  const [facturas, setFacturas] = useState<FacturaAgrupada[]>([]);
  const [expandida, setExpandida] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);

  function cargar() {
    setCargando(true);
    setError(null);
    api.inventario
      .facturas({ desde, hasta })
      .then(setFacturas)
      .catch((e) => setError(e.message))
      .finally(() => setCargando(false));
  }

  useEffect(() => {
    cargar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [desde, hasta]);

  const totalGeneral = facturas.reduce((s, f) => s + f.totalNeto, 0);

  function claveFactura(f: FacturaAgrupada): string {
    return `${f.proveedorId}|${f.numeroFactura}`;
  }

  function exportarCsv() {
    const filas = [["Fecha", "Proveedor", "N° Factura", "PLU", "Producto", "Cantidad", "Costo unitario", "Subtotal"]];
    for (const f of facturas) {
      for (const l of f.lineas) {
        filas.push([
          new Date(f.fecha).toLocaleDateString("es-CL"),
          f.proveedor,
          f.numeroFactura,
          l.plu,
          l.producto,
          String(l.cantidad),
          l.costoUnitario != null ? String(l.costoUnitario) : "",
          String(l.subtotal),
        ]);
      }
    }
    const csv = filas.map((fila) => fila.map((c) => `"${c.replace(/"/g, '""')}"`).join(",")).join("\r\n");
    const blob = new Blob([`﻿${csv}`], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `facturas_${desde}_a_${hasta}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div>
      <div className="encabezado-pantalla no-imprimir">
        <h1>Facturas cargadas</h1>
        <div className="fila-inline" style={{ marginBottom: 0 }}>
          <Link to="/inventario/factura" className="boton boton-primario">
            + Cargar factura
          </Link>
          <button type="button" className="boton" onClick={exportarCsv} disabled={facturas.length === 0}>
            Exportar a Excel (CSV)
          </button>
          <button type="button" className="boton" onClick={() => window.print()} disabled={facturas.length === 0}>
            Imprimir
          </button>
          <Link to="/inventario" className="boton">
            Volver a inventario
          </Link>
        </div>
      </div>

      <h1 className="solo-imprimir">Facturas cargadas — {desde} a {hasta}</h1>

      {error && <p className="error no-imprimir">{error}</p>}

      <div className="filtros no-imprimir">
        <label>
          Desde <input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} />
        </label>
        <label>
          Hasta <input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} />
        </label>
      </div>

      {cargando && <p className="no-imprimir">Cargando...</p>}

      <table className="tabla">
        <thead>
          <tr>
            <th>Fecha</th>
            <th>Proveedor</th>
            <th>N° Factura</th>
            <th>Líneas</th>
            <th>Total neto</th>
            <th className="no-imprimir"></th>
          </tr>
        </thead>
        <tbody>
          {facturas.length === 0 && !cargando && (
            <tr>
              <td colSpan={6}>No hay facturas cargadas en este rango de fechas.</td>
            </tr>
          )}
          {facturas.map((f) => {
            const clave = claveFactura(f);
            return (
              <Fragment key={clave}>
                <tr>
                  <td>{new Date(f.fecha).toLocaleDateString("es-CL")}</td>
                  <td>{f.proveedor}</td>
                  <td>{f.numeroFactura}</td>
                  <td>{f.lineas.length}</td>
                  <td>{formatoCLP(f.totalNeto)}</td>
                  <td className="no-imprimir">
                    <button type="button" className="boton" onClick={() => setExpandida(expandida === clave ? null : clave)}>
                      {expandida === clave ? "Ocultar" : "Ver detalle"}
                    </button>
                  </td>
                </tr>
                {expandida === clave && (
                  <tr>
                    <td colSpan={6}>
                      <table className="tabla">
                        <thead>
                          <tr>
                            <th>PLU</th>
                            <th>Producto</th>
                            <th>Cantidad</th>
                            <th>Costo unitario</th>
                            <th>Subtotal</th>
                          </tr>
                        </thead>
                        <tbody>
                          {f.lineas.map((l, i) => (
                            <tr key={i}>
                              <td>{l.plu}</td>
                              <td>{l.producto}</td>
                              <td>{l.cantidad}</td>
                              <td>{l.costoUnitario != null ? formatoCLP(l.costoUnitario) : "—"}</td>
                              <td>{formatoCLP(l.subtotal)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
        {facturas.length > 0 && (
          <tfoot>
            <tr className="fila-total">
              <td colSpan={4}>Total del período</td>
              <td colSpan={2}>{formatoCLP(totalGeneral)}</td>
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}
