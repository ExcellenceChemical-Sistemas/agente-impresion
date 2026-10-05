import 'dotenv/config';

function requerida(nombre: string): string {
  const valor = process.env[nombre];
  if (!valor) throw new Error(`Falta la variable de entorno ${nombre}`);
  return valor;
}

function backendUrl(): string {
  const valor = requerida('BACKEND_URL');
  // AGENT_TOKEN va en el header x-agent-token en cada request: con http:// viajaría en claro.
  if (!valor.startsWith('https://') && !valor.startsWith('http://localhost') && !valor.startsWith('http://127.0.0.1')) {
    throw new Error(`BACKEND_URL debe usar https:// (o apuntar a localhost para desarrollo): "${valor}"`);
  }
  return valor;
}

export const CONFIG = {
  backendUrl: backendUrl(),
  agentToken: requerida('AGENT_TOKEN'),
  printerName: process.env.EPSON_PRINTER_NAME ?? 'EPSON TM-C3500 Ver2',
  paperSize: process.env.EPSON_PAPER_SIZE ?? 'Mate Brilloso 10x8.5 cm',
  // Papel de la etiqueta blanca, que conserva el formato original de 10x6 cm.
  paperSizeQr: process.env.EPSON_PAPER_SIZE_QR ?? 'Mate Brilloso 10x7.5 cm',
  paperSizeBlanco: process.env.EPSON_PAPER_SIZE_BLANCO ?? 'Mate Brilloso 10x6 cm',
  // Papel chico de la etiqueta de muestras (10x2.5 cm). Debe existir con este
  // nombre exacto como tamaño de papel personalizado en el driver de Windows
  // de la impresora: si no existe, imprimir-etiqueta.ps1 falla listando los
  // nombres de papel disponibles en esa máquina.
  paperSizeMuestras: process.env.EPSON_PAPER_SIZE_MUESTRAS ?? 'Mate Brilloso 10x2.5 cm',
  pollIntervalMs: Number(process.env.POLL_INTERVAL_MS ?? 3000),
};