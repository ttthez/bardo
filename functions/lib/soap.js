// Llamadas SOAP mínimas a los web services de ARCA.
import { XMLParser } from 'fast-xml-parser';

const parser = new XMLParser({
  ignoreAttributes: true,
  removeNSPrefix: true,
  parseTagValue: false, // todo como texto: los CAE y CUIT no deben perder dígitos
  trimValues: true
});

export function esc(v) {
  return String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function parsearXml(xml) {
  return parser.parse(xml);
}

export async function llamar(url, soapAction, cuerpo, { timeoutMs = 30000, fetchImpl = fetch } = {}) {
  const envelope =
    '<?xml version="1.0" encoding="utf-8"?>' +
    '<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">' +
    `<soap:Body>${cuerpo}</soap:Body></soap:Envelope>`;
  const res = await fetchImpl(url, {
    method: 'POST',
    headers: { 'Content-Type': 'text/xml; charset=utf-8', SOAPAction: `"${soapAction}"` },
    body: envelope,
    signal: AbortSignal.timeout(timeoutMs)
  });
  const texto = await res.text();
  let doc;
  try {
    doc = parsearXml(texto);
  } catch {
    throw new Error(`Respuesta no válida de ARCA (${res.status}): ${texto.slice(0, 300)}`);
  }
  const body = doc?.Envelope?.Body;
  if (!body) throw new Error(`Respuesta sin cuerpo SOAP (${res.status}): ${texto.slice(0, 300)}`);
  if (body.Fault) {
    const f = body.Fault;
    const err = new Error(`ARCA: ${f.faultstring || f.faultcode || 'error SOAP'}`);
    err.faultcode = f.faultcode;
    throw err;
  }
  return body;
}
