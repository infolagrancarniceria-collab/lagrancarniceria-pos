import { useEffect, useState } from "react";
import { suscribirToasts, type ToastItem } from "../lib/toast";

// Montado una sola vez en Layout.tsx — funciona en cualquier pantalla sin
// que cada una tenga que renderizar nada, solo llamar a mostrarToast().
export function ToastHost() {
  const [items, setItems] = useState<ToastItem[]>([]);

  useEffect(() => suscribirToasts(setItems), []);

  if (items.length === 0) return null;

  return (
    <div className="zona-toasts">
      {items.map((i) => (
        <div key={i.id} className={`toast${i.tipo === "eliminado" ? " toast-eliminado" : ""}`}>
          <b>
            <span className="toast-icono">{i.tipo === "eliminado" ? "🗑" : "✓"}</span>
            {i.texto}
          </b>
          {i.sub && <span className="toast-sub">{i.sub}</span>}
        </div>
      ))}
    </div>
  );
}
