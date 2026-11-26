// PDF de la Factura C con el QR de ARCA (RG 4892).
import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';
import { CONCEPTOS, numeroLegible } from './comprobante.js';

const fecha = (iso) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '');
const pesos = (n) =>
  '$ ' + Number(n).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function urlQR(c) {
  const datos = {
    ver: 1,
    fecha: c.fecha,
    cuit: Number(c.cuit),
    ptoVta: c.ptoVta,
    tipoCmp: c.cbteTipo,
    nroCmp: c.nro,
    importe: Math.round(c.total * 100) / 100,
    moneda: 'PES',
    ctz: 1,
    tipoDocRec: c.docTipo,
    nroDocRec: Number(c.docNro),
    tipoCodAut: 'E',
    codAut: Number(c.cae)
  };
  return 'https://www.afip.gob.ar/fe/qr/?p=' + Buffer.from(JSON.stringify(datos)).toString('base64');
}

// c: comprobante con nro, cae y caeVto. emisor: { nombre, cuit, domicilio, iibb, inicio, fantasia? }.
// homologacion: marca el PDF como prueba sin validez.
export async function generarPDF(c, emisor, { homologacion = false } = {}) {
  const qr = await QRCode.toBuffer(urlQR(c), { margin: 0, width: 220 });
  const doc = new PDFDocument({ size: 'A4', margin: 36 });
  const partes = [];
  doc.on('data', (b) => partes.push(b));
  const fin = new Promise((ok) => doc.on('end', ok));

  const W = doc.page.width - 72;
  const x0 = 36;
  let y = 36;

  // ORIGINAL
  doc.rect(x0, y, W, 22).stroke();
  doc.font('Helvetica-Bold').fontSize(12).text('ORIGINAL', x0, y + 6, { width: W, align: 'center' });
  y += 22;

  // Cabecera: emisor | letra | comprobante
  const hCab = 120;
  doc.rect(x0, y, W, hCab).stroke();
  doc.moveTo(x0 + W / 2, y + 44).lineTo(x0 + W / 2, y + hCab).stroke();
  doc.rect(x0 + W / 2 - 24, y, 48, 44).stroke();
  doc.font('Helvetica-Bold').fontSize(26).text('C', x0 + W / 2 - 24, y + 4, { width: 48, align: 'center' });
  doc.fontSize(7).text('COD. 011', x0 + W / 2 - 24, y + 33, { width: 48, align: 'center' });

  const col = W / 2 - 40;
  doc.font('Helvetica-Bold').fontSize(14).text(emisor.fantasia || emisor.nombre, x0 + 10, y + 10, { width: col });
  doc.font('Helvetica-Bold').fontSize(8).text('Razón Social: ', x0 + 10, y + 52, { continued: true }).font('Helvetica').text(emisor.nombre, { width: col });
  doc.font('Helvetica-Bold').text('Domicilio Comercial: ', x0 + 10, doc.y + 2, { continued: true }).font('Helvetica').text(emisor.domicilio || '', { width: col });
  doc.font('Helvetica-Bold').text('Condición frente al IVA: ', x0 + 10, doc.y + 2, { continued: true }).font('Helvetica').text('Responsable Monotributo');

  const xd = x0 + W / 2 + 34;
  doc.font('Helvetica-Bold').fontSize(16).text('FACTURA', xd, y + 10);
  doc.fontSize(9);
  const fila = (k, v, yy) => doc.font('Helvetica-Bold').text(k, xd, yy, { continued: true }).font('Helvetica').text(' ' + v);
  fila('Punto de Venta:', String(c.ptoVta).padStart(5, '0') + '    Comp. Nro: ' + String(c.nro).padStart(8, '0'), y + 36);
  fila('Fecha de Emisión:', fecha(c.fecha), y + 52);
  fila('CUIT:', String(emisor.cuit), y + 70);
  fila('Ingresos Brutos:', emisor.iibb || String(emisor.cuit), y + 84);
  fila('Fecha de Inicio de Actividades:', fecha(emisor.inicio), y + 98);
  y += hCab;

  // Período (servicios)
  if (c.concepto !== 1) {
    doc.rect(x0, y + 4, W, 20).stroke();
    doc.fontSize(8);
    const t = `Período Facturado Desde: ${fecha(c.servDesde)}      Hasta: ${fecha(c.servHasta)}      Fecha de Vto. para el pago: ${fecha(c.vtoPago)}`;
    doc.font('Helvetica-Bold').text(t, x0 + 10, y + 10, { width: W - 20 });
    y += 24;
  }

  // Receptor
  doc.rect(x0, y + 4, W, 48).stroke();
  doc.fontSize(8);
  const docLabel = c.docTipo === 80 ? 'CUIT' : c.docTipo === 96 ? 'DNI' : 'Doc.';
  const docVal = c.docTipo === 99 ? '-' : c.docNro;
  doc.font('Helvetica-Bold').text(`${docLabel}: `, x0 + 10, y + 10, { continued: true }).font('Helvetica').text(docVal);
  doc.font('Helvetica-Bold').text('Apellido y Nombre / Razón Social: ', x0 + W / 2 - 60, y + 10, { continued: true }).font('Helvetica').text(c.nombre || '');
  doc.font('Helvetica-Bold').text('Condición frente al IVA: ', x0 + 10, y + 24, { continued: true }).font('Helvetica').text(c.condNombre);
  doc.font('Helvetica-Bold').text('Domicilio: ', x0 + W / 2 - 60, y + 24, { continued: true }).font('Helvetica').text(c.domicilio || '-');
  doc.font('Helvetica-Bold').text('Condición de venta: ', x0 + 10, y + 38, { continued: true }).font('Helvetica').text(c.condVenta);
  doc.font('Helvetica-Bold').text('Concepto: ', x0 + W / 2 - 60, y + 38, { continued: true }).font('Helvetica').text(CONCEPTOS[c.concepto]);
  y += 60;

  // Detalle
  const cols = [
    { t: 'Descripción', w: W - 270, a: 'left' },
    { t: 'Cantidad', w: 60, a: 'right' },
    { t: 'Precio Unit.', w: 100, a: 'right' },
    { t: 'Subtotal', w: 110, a: 'right' }
  ];
  doc.rect(x0, y, W, 18).fillAndStroke('#e6e6e6', '#000');
  doc.fillColor('#000').font('Helvetica-Bold').fontSize(8);
  let xc = x0;
  for (const k of cols) {
    doc.text(k.t, xc + 6, y + 5, { width: k.w - 12, align: k.a });
    xc += k.w;
  }
  y += 22;
  doc.font('Helvetica').fontSize(9);
  for (const it of c.items) {
    const vals = [it.desc, String(it.cant), pesos(it.precio), pesos(it.cant * it.precio)];
    xc = x0;
    const alto = doc.heightOfString(it.desc, { width: cols[0].w - 12 });
    vals.forEach((v, i) => {
      doc.text(v, xc + 6, y, { width: cols[i].w - 12, align: cols[i].a });
      xc += cols[i].w;
    });
    y += Math.max(alto, 12) + 6;
  }

  // Totales
  const yTot = Math.max(y + 20, 560);
  doc.rect(x0, yTot, W, 56).stroke();
  doc.font('Helvetica-Bold').fontSize(9);
  doc.text('Subtotal: ' + pesos(c.total), x0, yTot + 8, { width: W - 12, align: 'right' });
  doc.text('Importe Otros Tributos: ' + pesos(0), x0, yTot + 22, { width: W - 12, align: 'right' });
  doc.fontSize(11).text('Importe Total: ' + pesos(c.total), x0, yTot + 38, { width: W - 12, align: 'right' });

  // Pie: QR + CAE
  const yPie = yTot + 72;
  doc.image(qr, x0, yPie, { width: 90 });
  doc.font('Helvetica-Bold').fontSize(11).text('Comprobante Autorizado', x0 + 104, yPie + 8);
  doc.font('Helvetica').fontSize(7).text('Esta Agencia no se responsabiliza por los datos ingresados en el detalle de la operación', x0 + 104, yPie + 26, { width: 220 });
  doc.font('Helvetica-Bold').fontSize(9);
  doc.text('CAE N°: ' + c.cae, x0, yPie + 10, { width: W - 12, align: 'right' });
  doc.text('Fecha de Vto. de CAE: ' + fecha(c.caeVto), x0, yPie + 26, { width: W - 12, align: 'right' });

  if (homologacion) {
    doc.save();
    doc.rotate(-30, { origin: [doc.page.width / 2, doc.page.height / 2] });
    doc.font('Helvetica-Bold').fontSize(46).fillColor('#cc0000').opacity(0.25);
    doc.text('PRUEBA · SIN VALIDEZ FISCAL', 0, doc.page.height / 2 - 30, { width: doc.page.width, align: 'center' });
    doc.restore();
  }

  doc.end();
  await fin;
  return Buffer.concat(partes);
}

export { numeroLegible };
