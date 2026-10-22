import * as fs from "fs";
import * as path from "path";
import * as Handlebars from "handlebars";
import puppeteer, { Browser } from "puppeteer";
import * as QRCode from "qrcode";

import { CONFIG } from "./config";

const ETIQUETA_LABEL_CONFIG = { widthMm: 108, dpi: 360 };
const ALTO_MM_DEFAULT = 85;

// blanco.hbs es la única plantilla que conserva el formato original de 10x6 cm
// (60 mm de alto, sin QR/tara); el resto usa 85 mm. Cada formato lleva
// su propio papel del driver, porque el papel decide el tamaño físico real.
// widthMm es opcional: si no se indica se usa el ancho estándar (108 mm).
const FORMATOS: Record<
  string,
  { heightMm: number; paperSize: string; widthMm?: number; rotarGrados?: number }
> = {
  "blanco.hbs": { heightMm: 60, paperSize: CONFIG.paperSizeBlanco },
  "estandar-clasico-60.hbs": {
    heightMm: 60,
    paperSize: CONFIG.paperSizeBlanco,
  },
  "estandar.hbs": { heightMm: 60, paperSize: CONFIG.paperSizeBlanco },
    "con-rombo.hbs": { heightMm: 60, paperSize: CONFIG.paperSizeBlanco },
  "con-rombo-sinqr.hbs": { heightMm: 60, paperSize: CONFIG.paperSizeBlanco },
  "completa-rombo.hbs": { heightMm: 60, paperSize: CONFIG.paperSizeBlanco },
  "completa-rombo-85.hbs": { heightMm: 85, paperSize: CONFIG.paperSize },
  // Rótulo horizontal 20x10 cm. La Epson solo acepta 108 mm de ancho de rollo,
  // así que el rótulo se dibuja de 208x108 mm (2948x1531 px a 360 dpi) y se
  // imprime girado 90°: el papel "Mate Brilloso 20x10 cm" mide 108 x 208 mm.
  "completa-rombo-20x10.hbs": {
    heightMm: 108,
    widthMm: 208,
    paperSize: CONFIG.paperSize20x10,
    rotarGrados: CONFIG.rotarGrados20x10,
  },
    "con-rombo-sinqr-85.hbs": { heightMm: 85, paperSize: CONFIG.paperSize },
  "muestras.hbs": { heightMm: 25, paperSize: CONFIG.paperSizeMuestras },
  "estandar-85.hbs": { heightMm: 85, paperSize: CONFIG.paperSize },
  "con-rombo-85.hbs": { heightMm: 85, paperSize: CONFIG.paperSize },
  "estandar-sinqr.hbs": { heightMm: 60, paperSize: CONFIG.paperSizeBlanco },
  "estandar-sinqr-85.hbs": { heightMm: 85, paperSize: CONFIG.paperSize },
};

export function formatoDe(archivo: string) {
  const f = FORMATOS[archivo] ?? {
    heightMm: ALTO_MM_DEFAULT,
    paperSize: CONFIG.paperSize,
  };
  const width = Math.round(
    ((f.widthMm ?? ETIQUETA_LABEL_CONFIG.widthMm) / 25.4) *
      ETIQUETA_LABEL_CONFIG.dpi,
  );
  const height = Math.round((f.heightMm / 25.4) * ETIQUETA_LABEL_CONFIG.dpi);
  const rotarGrados = f.rotarGrados ?? 0;
  return {
    paperSize: f.paperSize,
    // Tamaño con el que se dibuja el .hbs
    width,
    height,
    rotarGrados,
    // Tamaño de la imagen final que se imprime (intercambiado si va girada)
    salidaWidth: rotarGrados ? height : width,
    salidaHeight: rotarGrados ? width : height,
  };
}

// Gira la página 90° (para rótulos cuyo lado largo va a lo largo del papel).
function rotarHtml(html: string, formato: ReturnType<typeof formatoDe>): string {
  if (!formato.rotarGrados) return html;
  const transform =
    formato.rotarGrados > 0
      ? `translateX(${formato.height}px) rotate(90deg)`
      : `translateY(${formato.width}px) rotate(-90deg)`;
  const css = `<style>html{width:${formato.salidaWidth}px;height:${formato.salidaHeight}px;overflow:hidden}body{transform-origin:0 0;transform:${transform}}</style>`;
  return html.replace("</head>", `${css}</head>`);
}

const ASSETS_DIR = path.join(__dirname, "..", "assets");
const TEMPLATES_DIR = path.join(ASSETS_DIR, "templates");

// Fondos "-85mm": placeholder generado por código a partir de los originales
// de 60mm (ver scripts/generar-fondos-85mm.ts) — mismo arte, con una banda
// vacía insertada para el alto nuevo. Reemplazar por el arte real de
// Illustrator cuando esté listo (mismas dimensiones: 1531x1205px).
const FONDOS: Record<string, string> = {
  "blanco.hbs": path.join(ASSETS_DIR, "etiqueta-fondo-blanco.png"), // original de 60mm
  "estandar-clasico-60.hbs": path.join(
    ASSETS_DIR,
    "etiqueta-fondo-clasico-60.png",
  ), // estandar original 10x6
  // muestras.hbs ya no usa fondo de imagen: ahora comparte el diseño de
  // estandar.hbs (marco/logo dibujados en CSS), cae al FONDO_DEFAULT sin uso real.
};
const FONDO_DEFAULT = path.join(ASSETS_DIR, "etiqueta-fondo-85mm.png");

export interface EtiquetaParaRenderizar {
  producto: string;
  numeroLote: string;
  fabricante: string;
  fechaFabricacion: string;
  fechaVencimiento: string;
  pesoBruto: string;
  unidadBruto: string;
  cantidadNeta?: string | null;
  unidadNeta: string;
  tara?: string | null;
  proforma: string;
  proveedor?: string | null;
  codigo?: string | null;
  fechaIngreso?: string | null;
  nfpaSalud?: number | null;
  nfpaInflamabilidad?: number | null;
  nfpaReactividad?: number | null;
  qrUrl?: string | null;
  coaValidado?: boolean | null;
}

const UNIDAD_TXT: Record<string, string> = {
  KG: "kg",
  GR: "g",
  ML: "ml",
  L: "L",
};
const LOGO_PATH = path.join(ASSETS_DIR, "logo-excellence.png");
let logoBase64Cache: string | null = null;
function getLogoBase64(): string {
  if (!logoBase64Cache)
    logoBase64Cache = fs.readFileSync(LOGO_PATH).toString("base64");
  return logoBase64Cache;
}

let browser: Browser | null = null;
const fondosCache = new Map<string, string>();

// Si Chrome se cae o se desconecta (falta de memoria, lo mata Windows, etc.),
// `browser` queda con una referencia "viva" pero muerta — sin este chequeo,
// cada intento de imprimir siguiente falla con "Connection closed" hasta
// reiniciar el agente a mano. `connected` detecta eso y relanza solo.
async function getBrowser(): Promise<Browser> {
  if (!browser || !browser.connected) {
    browser = await puppeteer.launch({ headless: true });
  }
  return browser;
}

function getTemplate(archivo: string): HandlebarsTemplateDelegate {
  const ruta = path.join(TEMPLATES_DIR, archivo);
  const html = fs.readFileSync(ruta, "utf-8");
  return Handlebars.compile(html); // siempre lee el archivo actual, sin cache
}

function getFondoBase64(archivo: string): string {
  const rutaFondo = FONDOS[archivo] ?? FONDO_DEFAULT;
  if (!fondosCache.has(rutaFondo)) {
    // Solo blanco.hbs y estandar-clasico-60.hbs usan fondo de imagen; el resto
    // dibuja todo en CSS. Si el PNG no existe no debe tumbar la impresión.
    const base64 = fs.existsSync(rutaFondo)
      ? fs.readFileSync(rutaFondo).toString("base64")
      : "";
    fondosCache.set(rutaFondo, base64);
  }
  return fondosCache.get(rutaFondo)!;
}

export async function construirHtml(
  archivo: string,
  etiqueta: EtiquetaParaRenderizar,
): Promise<string> {
  const esVolumen = etiqueta.unidadNeta === "ML" || etiqueta.unidadNeta === "L";
  const labelNeto = esVolumen ? "CANT. NETO" : "PESO NETO";

  const template = getTemplate(archivo);
  const fondoBase64 = getFondoBase64(archivo);
  const formato = formatoDe(archivo);

  // El QR ya viene armado como data-URI completo (data:image/png;base64,...)
  // desde QRCode.toDataURL, así que el .hbs lo usa directo como src de <img>
  // sin reconstruir nada. Si no hay qrUrl (job viejo o sin backend actualizado),
  // queda vacío y el <img> simplemente no muestra nada.
  const qrDataUrl = etiqueta.qrUrl
    ? await QRCode.toDataURL(etiqueta.qrUrl, { margin: 0, width: 320 })
    : "";

  // Corre siempre en la PC Windows de la impresora: Segoe UI real ya está
  // instalada, así que fontBase64 nunca se manda y los .hbs caen solos al
  // 'Segoe UI' real por nombre (nunca más hace falta Selawik).
  const html = template({
    widthPx: formato.width,
    heightPx: formato.height,
    fondoBase64,
    fallbackFontFamily: "Arial, sans-serif",
    producto: etiqueta.producto,
    numeroLote: etiqueta.numeroLote,
    fabricante: etiqueta.fabricante,
    fechaFabricacion: etiqueta.fechaFabricacion,
    fechaVencimiento: etiqueta.fechaVencimiento,
    pesoBruto: etiqueta.pesoBruto,
    unidadBruto: etiqueta.unidadBruto,
    pesoNeto: etiqueta.cantidadNeta ?? "—",
    unidadNeto: etiqueta.unidadNeta,
    labelNeto,
    tara: etiqueta.tara ?? "—",
    proforma: etiqueta.proforma,
    proveedor: etiqueta.proveedor ?? "—",
    codigo: etiqueta.codigo ?? "—",
    fechaIngreso: etiqueta.fechaIngreso ?? "",
    nfpaSalud: etiqueta.nfpaSalud ?? "",
    nfpaInflamabilidad: etiqueta.nfpaInflamabilidad ?? "",
    nfpaReactividad: etiqueta.nfpaReactividad ?? "",
    qrDataUrl,
    coaValidado: !!etiqueta.coaValidado,
    // proforma llega como " " (un espacio) cuando el formulario usa "En
    // blanco (muestra)", para pasar la validación del backend sin tener un
    // número real — así que un {{#if proforma}} crudo no alcanza para
    // ocultar el campo. hayProforma hace el trim acá, una sola vez.
    hayProforma: !!etiqueta.proforma?.trim(),
    logoBase64: getLogoBase64(),
    unidadNetoLabel: UNIDAD_TXT[etiqueta.unidadNeta] ?? etiqueta.unidadNeta,
    unidadBrutoLabel: UNIDAD_TXT[etiqueta.unidadBruto] ?? etiqueta.unidadBruto,
  });
  return rotarHtml(html, formato);
}

export async function generarImagen(
  archivo: string,
  etiqueta: EtiquetaParaRenderizar,
): Promise<Buffer> {
  const html = await construirHtml(archivo, etiqueta);
  const formato = formatoDe(archivo);
  const b = await getBrowser();
  const page = await b.newPage();
  try {
    await page.setViewport({
      width: formato.salidaWidth,
      height: formato.salidaHeight,
      deviceScaleFactor: 1,
    });
    await page.setContent(html, { waitUntil: "load" });
    await page.evaluateHandle("document.fonts.ready");
    await page.evaluate(() => {
      const w = window as unknown as { ajustarNombreProducto?: () => void };
      if (typeof w.ajustarNombreProducto === "function") {
        w.ajustarNombreProducto();
      }
    });
    return (await page.screenshot({ type: "png" })) as Buffer;
  } finally {
    await page.close();
  }
}
