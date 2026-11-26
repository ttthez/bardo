// Sube PDFs a Drive a través del Apps Script de apps-script/drive.gs.
export function driveAppsScript({ url, secreto, fetchImpl = fetch }) {
  // sin la URL del Apps Script (o con un valor de relleno como "pendiente") se factura igual, sin subir el PDF
  if (!/^https:\/\//.test(url || '') || !secreto) return null;
  return {
    async subir(carpeta, nombre, pdf) {
      const res = await fetchImpl(url, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' }, // evita el preflight; Apps Script lee el cuerpo igual
        body: JSON.stringify({ secreto, carpeta, nombre, pdf: pdf.toString('base64') }),
        redirect: 'follow',
        signal: AbortSignal.timeout(60000)
      });
      const r = await res.json().catch(() => null);
      if (!r?.ok) throw new Error(`Drive: ${r?.error || res.status}`);
      return { id: r.id, url: r.url };
    }
  };
}
