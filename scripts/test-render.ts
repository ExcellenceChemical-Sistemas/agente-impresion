// Script de verificación de una sola vez: renderiza las 4 plantillas con
// datos de prueba (incluyendo tara y qrUrl) y guarda los PNG resultantes en
// scripts/out/ para inspección visual. No forma parte del flujo real.
import * as fs from 'fs';
import * as path from 'path';
import { generarImagen, EtiquetaParaRenderizar } from '../src/etiqueta-generator';

const OUT_DIR = path.join(__dirname, 'out');
if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR);

const base: EtiquetaParaRenderizar = {
  producto: 'ACIDO CLORHIDRICO AL 33% GRADO TECNICO',
  numeroLote: 'L-2026-00123',
  fabricante: 'Quimica Industrial del Peru S.A.',
  fechaFabricacion: '01/2026',
  fechaVencimiento: '01/2028',
  pesoBruto: '1.140',
  unidadBruto: 'KG',
  cantidadNeta: '1.000',
  unidadNeta: 'KG',
  tara: '0.140',
  proforma: 'PF01-4521',
  nfpaSalud: 3,
  nfpaInflamabilidad: 0,
  nfpaReactividad: 1,
  qrUrl: 'http://localhost:3001/e/PRUEBA-TOKEN-123',
  coaValidado: true,
};

const casos = [
  { archivo: 'estandar.hbs', salida: 'estandar.png' },
  { archivo: 'estandar-clasico-60.hbs', salida: 'estandar-clasico-60.png' },
  { archivo: 'con-rombo.hbs', salida: 'con-rombo.png' },
  { archivo: 'blanco.hbs', salida: 'blanco.png' },
  { archivo: 'muestras.hbs', salida: 'muestras.png' },
  { archivo: 'estandar-85.hbs', salida: 'estandar-85.png' },
  { archivo: 'con-rombo-85.hbs', salida: 'con-rombo-85.png' },
];

(async () => {
  for (const { archivo, salida } of casos) {
    const png = await generarImagen(archivo, base);
    fs.writeFileSync(path.join(OUT_DIR, salida), png);
    console.log('generado', salida);
  }
  process.exit(0);
})();
