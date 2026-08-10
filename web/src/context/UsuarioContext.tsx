import React, { createContext, useContext, useEffect, useState } from "react";
import type { Usuario } from "../api";

interface UsuarioContextValue {
  usuario: Usuario | null;
  setUsuario: (usuario: Usuario | null) => void;
}

const UsuarioContext = createContext<UsuarioContextValue | undefined>(undefined);
const CLAVE_STORAGE = "lgc_usuario";

export function UsuarioProvider({ children }: { children: React.ReactNode }) {
  const [usuario, setUsuarioState] = useState<Usuario | null>(() => {
    const guardado = localStorage.getItem(CLAVE_STORAGE);
    return guardado ? JSON.parse(guardado) : null;
  });

  useEffect(() => {
    if (usuario) localStorage.setItem(CLAVE_STORAGE, JSON.stringify(usuario));
    else localStorage.removeItem(CLAVE_STORAGE);
  }, [usuario]);

  return (
    <UsuarioContext.Provider value={{ usuario, setUsuario: setUsuarioState }}>
      {children}
    </UsuarioContext.Provider>
  );
}

export function useUsuario() {
  const ctx = useContext(UsuarioContext);
  if (!ctx) throw new Error("useUsuario debe usarse dentro de UsuarioProvider");
  return ctx;
}
