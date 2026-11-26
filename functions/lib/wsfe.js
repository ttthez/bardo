// WSFEv1: factura electrónica (Factura C de monotributo, tipo 11).
import { esc, llamar } from './soap.js';

export const URLS_WSFE = {
  homo: 'https://wswhomo.afip.gov.ar/wsfev1/service.asmx',
  prod: 'https://servicios1.afip.gov.ar/wsfev1/service.asmx'
};
const NS = 'http://ar.gov.afip.dif.FEV1/';

const lista = (x) => (x == null ? [] : Array.isArray(x) ? x : [x]);

function auth({ token, sign, cuit }) {
  return `<Auth><Token>${esc(token)}</Token><Sign>${esc(sign)}</Sign><Cuit>${esc(cuit)}</Cuit></Auth>`;
}

function errores(res) {
  return lista(res?.Errors?.Err).map((e) => `${e.Code}: ${e.Msg}`);
}

async function metodo(entorno, nombre, interior, fetchImpl) {
  const body = await llamar(URLS_WSFE[entorno], NS + nombre, `<${nombre} xmlns="${NS}">${interior}</${nombre}>`, {
    fetchImpl
  });
  return body[`${nombre}Response`]?.[`${nombre}Result`];
}

export async function dummy({ entorno, fetchImpl }) {
  return metodo(entorno, 'FEDummy', '', fetchImpl);
}

export async function ultimoAutorizado({ entorno, credenciales, ptoVta, cbteTipo = 11, fetchImpl }) {
  const r = await metodo(
    entorno,
    'FECompUltimoAutorizado',
    auth(credenciales) + `<PtoVta>${ptoVta}</PtoVta><CbteTipo>${cbteTipo}</CbteTipo>`,
    fetchImpl
  );
  const errs = errores(r);
  if (errs.length) throw new Error(`ARCA: ${errs.join(' · ')}`);
  return Number(r.CbteNro);
}

export async function consultar({ entorno, credenciales, ptoVta, nro, cbteTipo = 11, fetchImpl }) {
  const r = await metodo(
    entorno,
    'FECompConsultar',
    auth(credenciales) +
      `<FeCompConsReq><CbteTipo>${cbteTipo}</CbteTipo><CbteNro>${nro}</CbteNro><PtoVta>${ptoVta}</PtoVta></FeCompConsReq>`,
    fetchImpl
  );
  const errs = errores(r);
  if (errs.length) throw new Error(`ARCA: ${errs.join(' · ')}`);
  return r.ResultGet;
}

export async function condicionesIvaReceptor({ entorno, credenciales, fetchImpl }) {
  const r = await metodo(
    entorno,
    'FEParamGetCondicionIvaReceptor',
    auth(credenciales) + '<ClaseCmp>C</ClaseCmp>',
    fetchImpl
  );
  return lista(r?.ResultGet?.CondicionIvaReceptor).map((c) => ({ id: Number(c.Id), desc: c.Desc }));
}

const plata = (n) => (Math.round(n * 100) / 100).toFixed(2);
const aaaammdd = (iso) => iso.replace(/-/g, '');

// Arma el XML de un comprobante. `c` sale de armarComprobante() con el número ya asignado.
export function xmlDetalle(c) {
  const serv =
    c.concepto === 1
      ? ''
      : `<FchServDesde>${aaaammdd(c.servDesde)}</FchServDesde><FchServHasta>${aaaammdd(c.servHasta)}</FchServHasta>` +
        `<FchVtoPago>${aaaammdd(c.vtoPago)}</FchVtoPago>`;
  return (
    '<FECAEDetRequest>' +
    `<Concepto>${c.concepto}</Concepto><DocTipo>${c.docTipo}</DocTipo><DocNro>${c.docNro}</DocNro>` +
    `<CbteDesde>${c.nro}</CbteDesde><CbteHasta>${c.nro}</CbteHasta><CbteFch>${aaaammdd(c.fecha)}</CbteFch>` +
    `<ImpTotal>${plata(c.total)}</ImpTotal><ImpTotConc>0</ImpTotConc><ImpNeto>${plata(c.total)}</ImpNeto>` +
    '<ImpOpEx>0</ImpOpEx><ImpTrib>0</ImpTrib><ImpIVA>0</ImpIVA>' +
    serv +
    '<MonId>PES</MonId><MonCotiz>1</MonCotiz>' +
    `<CondicionIVAReceptorId>${c.condIva}</CondicionIVAReceptorId>` +
    '</FECAEDetRequest>'
  );
}

// Pide el CAE de un comprobante. Devuelve { ok, cae, caeVto, obs, errores }.
export async function solicitarCAE({ entorno, credenciales, c, fetchImpl }) {
  const interior =
    auth(credenciales) +
    `<FeCAEReq><FeCabReq><CantReg>1</CantReg><PtoVta>${c.ptoVta}</PtoVta><CbteTipo>${c.cbteTipo}</CbteTipo></FeCabReq>` +
    `<FeDetReq>${xmlDetalle(c)}</FeDetReq></FeCAEReq>`;
  const r = await metodo(entorno, 'FECAESolicitar', interior, fetchImpl);
  const det = lista(r?.FeDetResp?.FECAEDetResponse)[0] || {};
  const obs = lista(det.Observaciones?.Obs).map((o) => `${o.Code}: ${o.Msg}`);
  const errs = errores(r);
  const ok = det.Resultado === 'A' && !!det.CAE;
  const vto = det.CAEFchVto ? `${det.CAEFchVto.slice(0, 4)}-${det.CAEFchVto.slice(4, 6)}-${det.CAEFchVto.slice(6, 8)}` : null;
  return { ok, cae: det.CAE || null, caeVto: vto, obs, errores: errs, resultado: det.Resultado || r?.FeCabResp?.Resultado };
}
