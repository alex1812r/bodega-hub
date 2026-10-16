/**
 * Plantillas HTML del banco sintético (SCN-10e). Cada página es un "escenario"
 * de tamaño fijo en px CSS que Playwright fotografía con `scale`; el lado mayor
 * resultante (size × scale) queda ≤ 1600 px.
 */
import { CLIENT, SUPPLIERS } from "./data";
import {
  computeTotals,
  escapeHtml as h,
  formatBs,
  formatDate,
  IVA_GENERAL_PCT,
  type InvoiceSpec,
  type InvoiceTotals,
  type LineSpec,
} from "./model";

export type RenderedPage = { html: string; width: number; height: number; scale: number };

const FISCAL_STAGE = { width: 820, height: 1100, scale: 1.45 };
const THERMAL_STAGE = { width: 640, height: 1150, scale: 1.38 };
const TABLE_STAGE = { width: 900, height: 1150, scale: 1.38 };
const NOTE_STAGE = { width: 820, height: 1100, scale: 1.45 };
const POSTER_STAGE = { width: 1100, height: 800, scale: 1.4 };

function doc(body: string, css: string, stage: { width: number; height: number }): string {
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><style>
*{box-sizing:border-box;margin:0;padding:0}
html,body{width:${stage.width}px;height:${stage.height}px;overflow:hidden}
${css}
</style></head><body>${body}</body></html>`;
}

function supplierOf(spec: InvoiceSpec) {
  const supplier = spec.supplierKey ? SUPPLIERS[spec.supplierKey] : undefined;
  if (!supplier) throw new Error(`${spec.id}: proveedor desconocido ${spec.supplierKey}`);
  return supplier;
}

/* ------------------------------------------------------------------ fiscal */

const FISCAL_CSS = `
body{background:#d9d6cf;font-family:Arial,Helvetica,sans-serif;color:#111}
.paper{position:absolute;left:22px;top:20px;width:776px;height:1060px;background:#fbfaf6;
  box-shadow:0 2px 10px rgba(0,0,0,.35);padding:30px 34px;overflow:hidden}
.head{display:flex;justify-content:space-between;border-bottom:2px solid #111;padding-bottom:10px}
.sup .name{font-size:19px;font-weight:bold;letter-spacing:.3px}
.sup div{font-size:12.5px;line-height:1.45}
.box{border:2px solid #111;padding:8px 12px;min-width:230px;font-size:12.5px;line-height:1.55}
.box .doc{font-size:20px;font-weight:bold;text-align:center;letter-spacing:2px}
.box .num{font-size:15px;font-weight:bold;color:#a00}
.client{border:1px solid #333;margin-top:12px;padding:7px 10px;font-size:12px;line-height:1.55}
table{width:100%;border-collapse:collapse;margin-top:12px;font-size:12px}
th{background:#e7e5df;border:1px solid #333;padding:5px 4px;font-size:11px}
td{border-left:1px solid #333;border-right:1px solid #333;padding:5px 5px;vertical-align:top}
tbody tr:last-child td{border-bottom:1px solid #333}
td.n{text-align:right;white-space:nowrap;font-family:"Courier New",monospace;font-size:12.5px}
td.c{text-align:center;font-family:"Courier New",monospace}
.totals{margin-top:12px;display:flex;justify-content:space-between;align-items:flex-start;gap:16px}
.obs{flex:1;border:1px solid #333;padding:8px;font-size:11.5px;line-height:1.5}
.obs b{display:block;margin-bottom:3px}
.sum{width:330px;border:1px solid #333;font-size:12.5px}
.sum div{display:flex;justify-content:space-between;padding:4px 8px;border-bottom:1px solid #bbb}
.sum div span:last-child{font-family:"Courier New",monospace;font-size:13px}
.sum .grand{font-weight:bold;font-size:14.5px;background:#e7e5df;border-bottom:none}
.legal{position:absolute;left:34px;right:34px;bottom:24px;font-size:9.5px;line-height:1.45;color:#333;
  border-top:1px solid #777;padding-top:6px}
.cont{margin-top:14px;text-align:right;font-size:12px;font-style:italic}
.page{position:absolute;right:34px;bottom:78px;font-size:11px}
.stamp{display:inline-block;border:2px solid #b02020;color:#b02020;font-weight:bold;padding:3px 8px;
  transform:rotate(-4deg);margin:10px 0 8px;letter-spacing:1px;font-size:12px}
.shadow{position:absolute;inset:0;pointer-events:none;
  background:linear-gradient(128deg,rgba(0,0,0,0) 0%,rgba(0,0,0,0) 47%,rgba(0,0,0,.5) 51%,rgba(0,0,0,.6) 70%,rgba(0,0,0,.66) 100%)}
`;

function fiscalRows(spec: InvoiceSpec, lines: LineSpec[], totals: InvoiceTotals, offset: number): string {
  return lines
    .map((line, i) => {
      const total = totals.lineTotals[offset + i] / 100;
      const cells = [
        spec.showCodes ? `<td class="c">${h(line.supplierSku ?? "")}</td>` : "",
        `<td>${h(line.rawText)}</td>`,
        `<td class="c">${line.quantity}</td>`,
        `<td class="n">${formatBs(line.unitPrice)}</td>`,
        spec.showDiscount ? `<td class="c">${line.discountPct ? `${line.discountPct},00` : "0,00"}</td>` : "",
        `<td class="n">${formatBs(total)}</td>`,
      ];
      return `<tr>${cells.join("")}</tr>`;
    })
    .join("");
}

function fiscalPage(spec: InvoiceSpec, lines: LineSpec[], offset: number, page: number, pages: number): string {
  const supplier = supplierOf(spec);
  const totals = computeTotals(spec);
  const isLast = page === pages;
  const head = [
    spec.showCodes ? `<th style="width:78px">CÓDIGO</th>` : "",
    `<th>DESCRIPCIÓN</th>`,
    `<th style="width:52px">CANT.</th>`,
    `<th style="width:108px">PRECIO UNIT. Bs</th>`,
    spec.showDiscount ? `<th style="width:56px">DESC. %</th>` : "",
    `<th style="width:110px">TOTAL Bs</th>`,
  ].join("");
  const sum = (label: string, bs: number, cls = "") =>
    `<div class="${cls}"><span>${label}</span><span>${formatBs(bs)}</span></div>`;
  const pct = spec.globalDiscountPct ?? 0;
  const footer = isLast
    ? `<div class="totals">
        <div class="obs">
          <b>OBSERVACIONES:</b>
          ${spec.footerNote ? `<div class="stamp">${h(spec.footerNote)}</div>` : "Mercancía viaja por cuenta y riesgo del comprador."}
          ${spec.printedRate ? `<div style="margin-top:8px">Tasa de cambio BCV del día: Bs ${formatBs(spec.printedRate)}</div>` : ""}
          <div style="margin-top:4px">Condición de pago: CONTADO</div>
        </div>
        <div class="sum">
          ${sum("SUB-TOTAL", totals.subtotal / 100)}
          ${pct ? sum(`DESCUENTO GLOBAL ${pct}%`, -totals.discount / 100) : ""}
          ${sum("MONTO EXENTO (E)", totals.exento / 100)}
          ${sum(`BASE IMPONIBLE G ${IVA_GENERAL_PCT}%`, totals.baseG / 100)}
          ${sum(`IVA G ${IVA_GENERAL_PCT}%`, totals.iva / 100)}
          ${sum("TOTAL A PAGAR Bs", totals.total / 100, "grand")}
        </div>
      </div>`
    : `<div class="cont">Continúa en la página siguiente...</div>`;
  const body = `<div class="paper">
    <div class="head">
      <div class="sup">
        <div class="name">${h(supplier.name)}</div>
        <div>RIF: ${h(supplier.taxId)}</div>
        <div>${h(supplier.address)}</div>
        <div>Telf: ${h(supplier.phone)}</div>
      </div>
      <div class="box">
        <div class="doc">FACTURA</div>
        <div>Nº <span class="num">${h(spec.number ?? "")}</span></div>
        <div>Nº de Control: ${h(spec.controlNumber ?? "")}</div>
        <div>Fecha de emisión: ${formatDate(spec.date ?? "")}</div>
      </div>
    </div>
    <div class="client">
      <div><b>Razón social:</b> ${h(CLIENT.name)} &nbsp;&nbsp; <b>RIF:</b> ${h(CLIENT.taxId)}</div>
      <div><b>Domicilio fiscal:</b> ${h(CLIENT.address)}</div>
    </div>
    <table><thead><tr>${head}</tr></thead><tbody>${fiscalRows(spec, lines, totals, offset)}</tbody></table>
    ${footer}
    ${pages > 1 ? `<div class="page">Página ${page} de ${pages}</div>` : ""}
    <div class="legal">
      SIN DERECHO A CRÉDITO FISCAL SI NO SE IDENTIFICA EL COMPRADOR. ESTA FACTURA VA SIN TACHADURA NI ENMIENDA.<br>
      IMPRENTA: GRAFICAS EL ÁVILA, C.A. RIF: J-30111222-3. Providencia Administrativa SENIAT/INTI/0071 de fecha 12/03/2019.
      Nº de Control desde el 00-0000001 hasta el 00-0050000. Fecha de elaboración: 15/07/2026.
    </div>
    ${spec.effect === "shadow" ? `<div class="shadow"></div>` : ""}
  </div>`;
  return doc(body, FISCAL_CSS, FISCAL_STAGE);
}

function renderFiscal(spec: InvoiceSpec): RenderedPage[] {
  const split = spec.pageSplit ?? spec.lines.length;
  const chunks = split < spec.lines.length ? [spec.lines.slice(0, split), spec.lines.slice(split)] : [spec.lines];
  let offset = 0;
  return chunks.map((chunk, i) => {
    const html = fiscalPage(spec, chunk, offset, i + 1, chunks.length);
    offset += chunk.length;
    return { html, ...FISCAL_STAGE };
  });
}

/* ----------------------------------------------------------------- thermal */

const THERMAL_CSS = `
body{font-family:Consolas,"Courier New",monospace}
.ticket{position:absolute;width:350px;background:#f7f6f1;padding:22px 18px 30px;color:#1d1d1d;font-size:13.5px;line-height:1.42;
  box-shadow:0 6px 18px rgba(0,0,0,.45)}
.ticket .c{text-align:center}
.ticket .b{font-weight:bold}
.ticket .row{display:flex;justify-content:space-between;white-space:pre}
.ticket hr{border:none;border-top:1px dashed #555;margin:6px 0}
.ticket .bar{letter-spacing:.5px;color:#333}
.ticket .torn{position:absolute;left:0;right:0;bottom:-8px;height:10px;
  background:linear-gradient(135deg,#f7f6f1 33%,transparent 33%) 0 0/12px 12px,linear-gradient(225deg,#f7f6f1 33%,transparent 33%) 0 0/12px 12px}
.wood{background:
  radial-gradient(ellipse at 30% 20%,rgba(255,220,170,.25),rgba(0,0,0,.35) 75%),
  repeating-linear-gradient(88deg,#8a5a2e 0 7px,#7b4f27 7px 10px,#946338 10px 19px,#83552b 19px 23px)}
.counter{background:linear-gradient(160deg,#9aa0a3,#6f7579)}
.dark{background:linear-gradient(160deg,#3a3229,#1c1814)}
`;

function thermalTicket(spec: InvoiceSpec): string {
  const supplier = supplierOf(spec);
  const totals = computeTotals(spec);
  const items = spec.lines
    .map((line, i) => {
      const left = `${line.quantity} x ${formatBs(line.unitPrice)}`;
      return `<div class="bar">${h(line.barcode ?? "")}</div>
        <div>${h(line.rawText)}</div>
        <div class="row"><span>  ${left}</span><span>${formatBs(totals.lineTotals[i] / 100)}</span></div>`;
    })
    .join("");
  const row = (label: string, bs: number, bold = false) =>
    `<div class="row${bold ? " b" : ""}"><span>${label}</span><span>${formatBs(bs)}</span></div>`;
  return `<div class="c b" style="font-size:15px">${h(supplier.name)}</div>
    <div class="c">RIF: ${h(supplier.taxId)}</div>
    <div class="c">${h(supplier.address)}</div>
    <div class="c">TLF ${h(supplier.phone)}</div>
    <hr>
    <div class="c b">ORDEN DE DESPACHO</div>
    <div class="row"><span>Nº ${h(spec.number ?? "")}</span><span>FECHA: ${formatDate(spec.date ?? "")}</span></div>
    <div class="row"><span>HORA: ${h(spec.time ?? "")}</span><span>CAJA 02</span></div>
    <div>CLIENTE: ${h(CLIENT.name)}</div>
    <div>RIF: ${h(CLIENT.taxId)}</div>
    <hr>
    ${items}
    <hr>
    ${row("SUBTTL", totals.subtotal / 100)}
    ${row("EXENTO", totals.exento / 100)}
    ${row(`BI G${IVA_GENERAL_PCT},00%`, totals.baseG / 100)}
    ${row(`IVA G${IVA_GENERAL_PCT},00%`, totals.iva / 100)}
    <hr>
    ${row("TOTAL Bs", totals.total / 100, true)}
    <hr>
    <div>ITEMS: ${spec.lines.length}</div>
    <div class="c" style="margin-top:8px">GRACIAS POR SU COMPRA</div>
    <div class="torn"></div>`;
}

function renderThermal(spec: InvoiceSpec): RenderedPage[] {
  const ticket = thermalTicket(spec);
  if (spec.effect === "rotate") {
    const css = `${THERMAL_CSS}
      body{position:relative}
      .ticket{left:265px;top:120px;transform:rotate(8deg);transform-origin:50% 40%}`;
    return [{ html: doc(`<div class="wood" style="position:absolute;inset:0"></div><div class="ticket">${ticket}</div>`, css, TABLE_STAGE), ...TABLE_STAGE }];
  }
  if (spec.effect === "blur") {
    const css = `${THERMAL_CSS}
      .ticket{left:145px;top:90px;transform:rotate(-1.5deg);background:#efeee6;color:#6a6a66;filter:blur(1.1px) contrast(.65)}`;
    return [{ html: doc(`<div class="counter" style="position:absolute;inset:0"></div><div class="ticket">${ticket}</div>`, css, THERMAL_STAGE), ...THERMAL_STAGE }];
  }
  if (spec.effect === "dark") {
    const css = `${THERMAL_CSS}
      body{background:#0b0907}
      .scene{position:absolute;inset:-12px;filter:blur(3.4px) brightness(.34) contrast(.85)}
      .ticket{left:150px;top:110px;transform:rotate(3deg)}`;
    return [{ html: doc(`<div class="scene"><div class="dark" style="position:absolute;inset:0"></div><div class="ticket">${ticket}</div></div>`, css, THERMAL_STAGE), ...THERMAL_STAGE }];
  }
  const css = `${THERMAL_CSS} .ticket{left:145px;top:90px}`;
  return [{ html: doc(`<div class="counter" style="position:absolute;inset:0"></div><div class="ticket">${ticket}</div>`, css, THERMAL_STAGE), ...THERMAL_STAGE }];
}

/* ------------------------------------------------------------- handwritten */

const NOTE_CSS = `
body{background:#cfc8bb}
.form{position:absolute;left:40px;top:34px;width:740px;height:1030px;background:#fffdf4;
  box-shadow:0 3px 12px rgba(0,0,0,.35);padding:30px 34px;font-family:"Times New Roman",serif;color:#26324a}
.pre{color:#2a3550}
.title{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #2a3550;padding-bottom:10px}
.title .name{font-size:20px;font-weight:bold}
.title .meta{font-size:13px;line-height:1.5}
.nb{border:2px solid #2a3550;padding:6px 14px;text-align:center}
.nb .t{font-size:18px;font-weight:bold;letter-spacing:1px}
.nb .n{font-size:20px;color:#b3261e;font-family:"Courier New",monospace;font-weight:bold}
.hand{font-family:"Segoe Script","Comic Sans MS",cursive;color:#1b3a8f;font-size:19px}
.field{margin-top:14px;font-size:14px;display:flex;gap:10px;align-items:baseline}
.field .line{flex:1;border-bottom:1px solid #2a3550;min-height:28px;padding-left:6px}
table{width:100%;border-collapse:collapse;margin-top:18px}
th{border:1.5px solid #2a3550;font-size:13px;padding:5px;background:#eef0f6}
td{border-left:1.5px solid #2a3550;border-right:1.5px solid #2a3550;border-bottom:1px solid #9aa3bb;height:44px;padding:2px 8px}
tbody tr:last-child td{border-bottom:1.5px solid #2a3550}
.tot{display:flex;justify-content:flex-end;margin-top:12px;font-size:15px;align-items:baseline;gap:12px}
.tot .box{border:1.5px solid #2a3550;min-width:200px;padding:4px 10px;text-align:right}
.sign{position:absolute;bottom:60px;left:34px;right:34px;display:flex;justify-content:space-between;font-size:13px}
.sign div{width:42%;border-top:1px solid #2a3550;text-align:center;padding-top:4px}
`;

function renderHandwritten(spec: InvoiceSpec): RenderedPage[] {
  const supplier = supplierOf(spec);
  const totals = computeTotals(spec);
  const tilt = [-0.8, 0.5, -0.3, 0.9, -0.6, 0.4];
  const rows = spec.lines
    .map((line, i) => {
      const t = tilt[i % tilt.length];
      return `<tr>
        <td class="hand" style="text-align:center;transform:rotate(${t}deg)">${line.quantity}</td>
        <td class="hand" style="transform:rotate(${t}deg)">${h(line.rawText)}</td>
        <td class="hand" style="text-align:right;transform:rotate(${-t}deg)">${formatBs(line.unitPrice)}</td>
        <td class="hand" style="text-align:right;transform:rotate(${t}deg)">${formatBs(totals.lineTotals[i] / 100)}</td>
      </tr>`;
    })
    .join("");
  const blanks = Array.from({ length: Math.max(0, 9 - spec.lines.length) }, () => "<tr><td></td><td></td><td></td><td></td></tr>").join("");
  const body = `<div class="form">
    <div class="title pre">
      <div>
        <div class="name">${h(supplier.name)}</div>
        <div class="meta">RIF: ${h(supplier.taxId)}<br>${h(supplier.address)}<br>Telf: ${h(supplier.phone)}</div>
      </div>
      <div class="nb"><div class="t">NOTA DE ENTREGA</div><div class="n">Nº ${h(spec.number ?? "")}</div></div>
    </div>
    <div class="field pre"><span>Fecha:</span><span class="line hand">${formatDate(spec.date ?? "")}</span></div>
    <div class="field pre"><span>Cliente:</span><span class="line hand">Comercial La Esquina de Petare</span></div>
    <div class="field pre"><span>Dirección:</span><span class="line hand">Petare, calle Guanchez</span></div>
    <table class="pre"><thead><tr><th style="width:70px">CANT.</th><th>DESCRIPCIÓN</th><th style="width:140px">PRECIO Bs</th><th style="width:150px">TOTAL Bs</th></tr></thead>
    <tbody>${rows}${blanks}</tbody></table>
    <div class="tot pre"><span><b>TOTAL Bs</b></span><span class="box hand">${formatBs(totals.subtotal / 100)}</span></div>
    <div class="field pre" style="margin-top:22px"><span>Observaciones:</span><span class="line hand">Entregado completo, pago contra entrega</span></div>
    <div class="sign pre"><div>Entregado por</div><div>Recibido conforme</div></div>
    <div class="hand" style="position:absolute;bottom:92px;left:90px;font-size:24px;transform:rotate(-6deg)">J. Pérez</div>
  </div>`;
  return [{ html: doc(body, NOTE_CSS, NOTE_STAGE), ...NOTE_STAGE }];
}

/* ------------------------------------------------------------------ poster */

const POSTER_CSS = `
body{background:#e8e2d6;font-family:"Arial Black",Arial,sans-serif}
.poster{position:absolute;left:40px;top:30px;width:1020px;height:740px;
  background:radial-gradient(circle at 75% 35%,#fff36b 0,#ffd400 38%,#ff9f00 100%);border:10px solid #d6141c;
  box-shadow:0 6px 20px rgba(0,0,0,.4);overflow:hidden}
.ribbon{position:absolute;left:-10px;top:36px;background:#d6141c;color:#fff;font-size:54px;padding:8px 46px;transform:rotate(-4deg);letter-spacing:2px;white-space:nowrap}
.pack{position:absolute;right:90px;top:120px;width:300px;height:420px;border-radius:16px;
  background:linear-gradient(180deg,#fff8d8 0 18%,#f4c81f 18% 74%,#1f5fbf 74% 100%);box-shadow:8px 10px 0 rgba(0,0,0,.25);
  text-align:center;color:#1f3f8f}
.pack .logo{margin-top:120px;font-size:84px;color:#c4161c;text-shadow:3px 3px 0 #fff}
.pack .sub{font-size:22px;color:#1f3f8f;font-family:Arial,sans-serif;font-weight:bold}
.pack .kg{position:absolute;bottom:22px;left:0;right:0;color:#fff;font-size:40px}
.copy{position:absolute;left:60px;top:190px;width:520px;color:#3a1600}
.copy .p1{font-size:54px;line-height:1.05}
.copy .p2{font-family:Arial,sans-serif;font-size:26px;font-weight:bold;margin-top:14px}
.price{position:absolute;left:60px;top:440px;background:#d6141c;color:#fff;border-radius:50%;width:300px;height:220px;
  display:flex;flex-direction:column;justify-content:center;align-items:center;transform:rotate(-6deg)}
.price .a{font-family:Arial,sans-serif;font-size:22px;font-weight:bold}
.price .b{font-size:52px}
.foot{position:absolute;left:0;right:0;bottom:0;background:#1f5fbf;color:#fff;font-family:Arial,sans-serif;font-size:20px;padding:10px 24px;font-weight:bold}
`;

function renderPoster(): RenderedPage[] {
  const body = `<div class="poster">
    <div class="ribbon">¡OFERTA DE LA SEMANA!</div>
    <div class="copy"><div class="p1">La harina de toda la vida</div><div class="p2">Para tus arepas, hallacas y empanadas</div></div>
    <div class="price"><div class="a">PRECIO ESPECIAL</div><div class="b">Bs 980,00</div><div class="a">c/u</div></div>
    <div class="pack"><div class="logo">P.A.N.</div><div class="sub">HARINA DE MAÍZ BLANCO<br>PRECOCIDA</div><div class="kg">1 Kg</div></div>
    <div class="foot">Válido hasta agotar existencia · Bodega La Esquina · Síguenos @bodegalaesquina</div>
  </div>`;
  return [{ html: doc(body, POSTER_CSS, POSTER_STAGE), ...POSTER_STAGE }];
}

export function renderInvoice(spec: InvoiceSpec): RenderedPage[] {
  switch (spec.kind) {
    case "fiscal":
      return renderFiscal(spec);
    case "thermal":
      return renderThermal(spec);
    case "handwritten":
      return renderHandwritten(spec);
    case "poster":
      return renderPoster();
  }
}
