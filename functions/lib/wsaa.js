// WSAA: autenticación con certificado. Devuelve el ticket de acceso (token + sign) que piden los demás servicios.
import forge from 'node-forge';
import { llamar, parsearXml } from './soap.js';

export const URLS_WSAA = {
  homo: 'https://wsaahomo.afip.gov.ar/ws/services/LoginCms',
  prod: 'https://wsaa.afip.gov.ar/ws/services/LoginCms'
};

// Fecha ISO en hora de Argentina (UTC-3), como la espera el WSAA.
export function isoArgentina(d) {
  const t = new Date(d.getTime() - 3 * 3600e3);
  return t.toISOString().replace(/\.\d{3}Z$/, '-03:00');
}

export function armarTRA(servicio, ahora = new Date()) {
  return (
    '<?xml version="1.0" encoding="UTF-8"?>' +
    '<loginTicketRequest version="1.0"><header>' +
    `<uniqueId>${Math.floor(ahora.getTime() / 1000)}</uniqueId>` +
    `<generationTime>${isoArgentina(new Date(ahora.getTime() - 10 * 60e3))}</generationTime>` +
    `<expirationTime>${isoArgentina(new Date(ahora.getTime() + 10 * 60e3))}</expirationTime>` +
    `</header><service>${servicio}</service></loginTicketRequest>`
  );
}

// Firma el TRA en CMS (PKCS#7 SignedData con el contenido adentro) y lo devuelve en base64.
export function firmarTRA(tra, certPem, keyPem) {
  const cert = forge.pki.certificateFromPem(certPem);
  const key = forge.pki.privateKeyFromPem(keyPem);
  const p7 = forge.pkcs7.createSignedData();
  p7.content = forge.util.createBuffer(tra, 'utf8');
  p7.addCertificate(cert);
  p7.addSigner({
    key,
    certificate: cert,
    digestAlgorithm: forge.pki.oids.sha256,
    authenticatedAttributes: [
      { type: forge.pki.oids.contentType, value: forge.pki.oids.data },
      { type: forge.pki.oids.messageDigest },
      { type: forge.pki.oids.signingTime, value: new Date() }
    ]
  });
  p7.sign();
  return forge.util.encode64(forge.asn1.toDer(p7.toAsn1()).getBytes());
}

// Pide un ticket nuevo. ARCA no da otro mientras el anterior siga vigente: hay que guardarlo (ver `ticket`).
export async function pedirTicket({ entorno, certPem, keyPem, servicio = 'wsfe', fetchImpl }) {
  const cms = firmarTRA(armarTRA(servicio), certPem, keyPem);
  const cuerpo =
    '<loginCms xmlns="http://wsaa.view.sua.dvadac.desein.afip.gov">' + `<in0>${cms}</in0></loginCms>`;
  const body = await llamar(URLS_WSAA[entorno], '', cuerpo, { fetchImpl });
  const ret = body.loginCmsResponse?.loginCmsReturn;
  if (!ret) throw new Error('WSAA no devolvió el ticket');
  const ta = parsearXml(ret).loginTicketResponse;
  return {
    token: ta.credentials.token,
    sign: ta.credentials.sign,
    vence: new Date(ta.header.expirationTime).getTime(),
    entorno,
    servicio
  };
}

// Devuelve un ticket vigente usando un caché { leer(), guardar(ta) } (archivo local o la base).
export async function ticket({ entorno, certPem, keyPem, servicio = 'wsfe', cache, fetchImpl }) {
  const guardado = cache ? await cache.leer() : null;
  if (guardado && guardado.entorno === entorno && guardado.vence - Date.now() > 10 * 60e3) return guardado;
  try {
    const ta = await pedirTicket({ entorno, certPem, keyPem, servicio, fetchImpl });
    if (cache) await cache.guardar(ta);
    return ta;
  } catch (e) {
    if (/alreadyAuthenticated|ya posee un TA valido/i.test(e.message)) {
      throw new Error(
        'ARCA dice que ya hay un ticket vigente para este certificado pero no lo tenemos guardado. ' +
          'Hay que esperar a que venza (hasta 12 horas) o usar el que se guardó en otro lado.'
      );
    }
    throw e;
  }
}
