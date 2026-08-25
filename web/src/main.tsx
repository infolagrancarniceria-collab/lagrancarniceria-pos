import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>
);

// Registra el service worker que hace que el sistema se pueda "instalar"
// como app en la pantalla de inicio del celular (ver web/public/sw.js) —
// no aplica dentro de la app de Electron (nunca se abre ahí "como app
// instalada" desde un navegador).
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {
      // Si falla (ej. servido por http:// en vez de https/localhost, algo
      // que los service workers exigen), el sistema sigue funcionando
      // igual — la app instalada simplemente no queda disponible.
    });
  });
}
