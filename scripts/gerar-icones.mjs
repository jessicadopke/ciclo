// Regenera icons/icon-192.png e icons/icon-512.png a partir do desenho de icons/icone.svg (a fonte).
//   node scripts/gerar-icones.mjs            → grava em icons/
//   node scripts/gerar-icones.mjs <pasta>    → grava na pasta indicada (usado no teste)
// Node puro (zlib), sem dependência: o desenho do SVG está repetido abaixo e é rasterizado por distância,
// com suavização 4x4 por pixel. Se mudar o icone.svg, mude as constantes daqui junto.
import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";

const FUNDO = [0x0e, 0x4f, 0x5c];
const MENTA = [0x7f, 0xe0, 0xd0];
const AMBAR = [0xff, 0xb5, 0x47];
const ESCALA = 7.68; // símbolo = 72% da largura (grade de 48 unidades)
const LARGURA_TRACO = 5.5;
const RAIO = 14;
const INI = [35.3, 15.5]; // M35.3 15.5 A14 14 0 1 0 38 24 (arco grande, sentido anti-horário)
const FIM = [38, 24];
const BOLA = { c: [35.6, 15.6], r: 4.6 };
const SUBPIXEL = 4;

// Arco aproximado como círculo de centro (24, 24) e raio 14, de 0° (ponto 38,24) até o início do traço,
// passando por baixo, esquerda e cima (o ponto inicial do SVG fica a ~0,14 unidade do círculo).
function centroDoArco() {
  const c = [24, 24];
  const a1 = Math.atan2(INI[1] - c[1], INI[0] - c[0]), a2 = Math.atan2(FIM[1] - c[1], FIM[0] - c[0]);
  const vao = (((a1 - a2) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  return { c, a1, vao };
}
const ARCO = centroDoArco();

function distanciaAoArco(x, y) {
  const { c, a1, vao } = ARCO;
  const a = Math.atan2(y - c[1], x - c[0]);
  const percorrido = (((a1 - a) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  if (percorrido <= vao) return Math.abs(Math.hypot(x - c[0], y - c[1]) - RAIO);
  return Math.min(Math.hypot(x - INI[0], y - INI[1]), Math.hypot(x - FIM[0], y - FIM[1]));
}

function corEm(px, py, tam) {
  const k = tam / 512;
  const x = ((px / k - 256) / ESCALA) + 24;
  const y = ((py / k - 256) / ESCALA) + 24;
  if (Math.hypot(x - BOLA.c[0], y - BOLA.c[1]) <= BOLA.r) return AMBAR;
  if (distanciaAoArco(x, y) <= LARGURA_TRACO / 2) return MENTA;
  return FUNDO;
}

function rasterizar(tam) {
  const bruto = Buffer.alloc((tam * 4 + 1) * tam);
  let p = 0;
  for (let j = 0; j < tam; j++) {
    bruto[p++] = 0; // filtro: nenhum
    for (let i = 0; i < tam; i++) {
      const soma = [0, 0, 0];
      for (let sj = 0; sj < SUBPIXEL; sj++) for (let si = 0; si < SUBPIXEL; si++) {
        const c = corEm(i + (si + 0.5) / SUBPIXEL, j + (sj + 0.5) / SUBPIXEL, tam);
        soma[0] += c[0]; soma[1] += c[1]; soma[2] += c[2];
      }
      const n = SUBPIXEL * SUBPIXEL;
      bruto[p++] = Math.round(soma[0] / n); bruto[p++] = Math.round(soma[1] / n); bruto[p++] = Math.round(soma[2] / n);
      bruto[p++] = 255;
    }
  }
  return bruto;
}

const CRC = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
function crc32(b) { let c = 0xffffffff; for (const x of b) c = CRC[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function bloco(tipo, dados) {
  const t = Buffer.from(tipo, "latin1"), len = Buffer.alloc(4), crc = Buffer.alloc(4);
  len.writeUInt32BE(dados.length); crc.writeUInt32BE(crc32(Buffer.concat([t, dados])));
  return Buffer.concat([len, t, dados, crc]);
}
function png(tam) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(tam, 0); ihdr.writeUInt32BE(tam, 4); ihdr[8] = 8; ihdr[9] = 6; // 8 bits, RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    bloco("IHDR", ihdr), bloco("IDAT", deflateSync(rasterizar(tam), { level: 9 })), bloco("IEND", Buffer.alloc(0)),
  ]);
}

const destino = process.argv[2] || new URL("../icons/", import.meta.url).pathname;
mkdirSync(destino, { recursive: true });
for (const tam of [192, 512]) {
  writeFileSync(`${destino}/icon-${tam}.png`, png(tam));
  console.log(`icon-${tam}.png gravado em ${destino}`);
}
