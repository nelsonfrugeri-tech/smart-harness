import { useRef, useState } from "react";
import { Button } from "./Primitives";
export function CopyValue({ value, label }: { value: string; label: string }) {
  const [status, setStatus] = useState("");
  const field = useRef<HTMLTextAreaElement>(null);
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setStatus("Copiado para a área de transferência.");
    } catch {
      field.current?.focus();
      field.current?.select();
      setStatus(
        "Não foi possível copiar. O texto foi selecionado; copie manualmente.",
      );
    }
  }
  return (
    <div className="copy-value">
      <label>
        {label}
        <textarea
          ref={field}
          readOnly
          value={value}
          rows={Math.min(8, Math.max(2, value.split("\n").length))}
          spellCheck={false}
        />
      </label>
      <Button variant="secondary" onClick={copy}>
        Copiar {label.toLowerCase()}
      </Button>
      <p role="status">{status}</p>
    </div>
  );
}
