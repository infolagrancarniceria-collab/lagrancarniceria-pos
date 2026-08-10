import type { KeyboardEvent } from "react";

const SELECTOR_CAMPOS =
  'input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([disabled]), select:not([disabled]), textarea:not([disabled])';

// Convierte Enter en "saltar al siguiente campo" (como Tab) dentro de un
// <form>, y recién en el último campo, Enter manda el formulario — así se
// puede cargar una fila completa sin soltar el teclado ni usar el mouse.
export function manejarEnterComoTab(e: KeyboardEvent<HTMLFormElement>) {
  if (e.key !== "Enter") return;

  const objetivo = e.target as HTMLElement;
  if (objetivo.tagName === "TEXTAREA" || objetivo.tagName === "BUTTON") return;

  const formulario = e.currentTarget;
  const campos = Array.from(formulario.querySelectorAll<HTMLElement>(SELECTOR_CAMPOS));
  const indiceActual = campos.indexOf(objetivo);
  if (indiceActual === -1) return;

  e.preventDefault();

  const siguiente = campos[indiceActual + 1];
  if (siguiente) {
    siguiente.focus();
    if (siguiente instanceof HTMLInputElement) siguiente.select();
  } else {
    formulario.requestSubmit();
  }
}
