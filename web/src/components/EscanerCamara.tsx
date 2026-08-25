import { useEffect, useRef, useState } from "react";
import { BrowserMultiFormatReader } from "@zxing/browser";
import { BarcodeFormat, DecodeHintType } from "@zxing/library";

interface Props {
  onDetectado: (texto: string) => void;
  onCerrar: () => void;
}

// Escanea el código de barras de una etiqueta de cámara usando la cámara
// del celular — alternativa al lector físico tipo "teclado" para cuando se
// usa el celular solo (ver "Salida de cámara"). Reutilizable: solo avisa
// el texto detectado, quien lo use decide qué hacer con él (ej. buscar la
// caja), igual que ya hace el lector físico.
export default function EscanerCamara({ onDetectado, onCerrar }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let controls: { stop: () => void } | null = null;
    let desmontado = false;
    let yaDetectado = false;

    // Las etiquetas de cámara siempre usan Code128-C (ver
    // EtiquetaCamara.tsx) — restringir el formato hace el escaneo más
    // rápido y evita falsos positivos con otros tipos de código de barras.
    const hints = new Map();
    hints.set(DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.CODE_128]);
    const reader = new BrowserMultiFormatReader(hints);

    reader
      .decodeFromVideoDevice(undefined, videoRef.current ?? undefined, (resultado) => {
        if (desmontado || yaDetectado || !resultado) return;
        yaDetectado = true;
        onDetectado(resultado.getText());
      })
      .then((c) => {
        if (desmontado) {
          c.stop();
          return;
        }
        controls = c;
      })
      .catch(() => {
        if (!desmontado) {
          setError(
            "No se pudo acceder a la cámara — revisa que le hayas dado permiso al navegador, o usa el ingreso manual."
          );
        }
      });

    return () => {
      desmontado = true;
      controls?.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="modal-fondo no-imprimir">
      <div className="modal-contenido tarjeta escaner-camara">
        <h2>Escanear caja</h2>
        {error ? (
          <p className="error">{error}</p>
        ) : (
          <>
            <p className="ayuda">Apunta la cámara al código de barras de la etiqueta.</p>
            <video ref={videoRef} className="escaner-camara-video" muted playsInline />
          </>
        )}
        <button type="button" className="boton" onClick={onCerrar}>
          Cancelar
        </button>
      </div>
    </div>
  );
}
