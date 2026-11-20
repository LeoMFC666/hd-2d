import * as THREE from 'three';

import { type MoldCell, findMold } from './HouseModel';
import { Art, PX, box, dataTexture, invisible, plain, roof, roofTexture, stripe, textured, wall } from './ModelKit';

/**
 * Terminal das balsas (Seagallop) das Ilhas Sevii: o predio de telhado
 * vermelho de chapa ondulada sobre a agua, no fim do pier, com duas torres
 * de amarracao de cada lado (estrutura vermelha e base branca na agua).
 *
 * Bloco de 7x6: linha 0 = o fim do pier (3 celulas no meio: tabuas e a
 * marquise da porta dos fundos); linhas 1-5 = o predio (colunas 1-5) e as
 * torres (colunas 0 e 6). Os ids mudam com o tileset (Ilhas 1-3, 4-5 e
 * 6-7); a arte e a mesma em todos.
 *
 * Medidas da arte (px, linhas a partir do fim do pier), pela regra da
 * dobra (linha = z - y):
 *  - telhado de 16 a 63 (beiral vermelho-escuro 57-62), fachada cinza com
 *    as janelas e o "V" de 63 a 88: parede de 1,56 de altura em z = 5,5,
 *    telhado de z 2,56 a 5,5;
 *  - torres: base branca 40-50 e estrutura 26-40 (a de cima) e 72-82 /
 *    58-72 (a de baixo): frente em z = 3,16 e 5,16, base de 0,66 e
 *    estrutura de 0,88 acima dela, encostada no predio;
 *  - pier: tabuas 0-11 e a marquise 12-15. Entre o fim do pier e o fundo
 *    do predio (z 0,75 a 2,56) fica uma passarela de tabuas.
 */

const PIER = null;

export const FERRY_TERMINAL_MOLDS: ReadonlyArray<readonly (readonly MoldCell[])[]> = [
  // Ilhas 1-3 (Two Island) e Navel Rock (torres com o mar fundo atras:
  // 378/379, 36D/36E, 374/375, 376/377).
  [
    [PIER, PIER, 0x2b4, 0x2b5, 0x2b6, PIER, PIER],
    [[0x290, 0x378], 0x2f0, 0x2f1, 0x2f1, 0x2f1, 0x2f2, [0x2d7, 0x379]],
    [0x2a4, 0x2f8, 0x2f9, 0x2f9, 0x2f9, 0x2fa, 0x2e7],
    [[0x298, 0x36d], 0x300, 0x301, 0x301, 0x301, 0x302, [0x2df, 0x36e]],
    [[0x2a4, 0x374], 0x2f3, 0x2f4, 0x2f5, 0x2f6, 0x2f7, [0x2e7, 0x375]],
    [[0x2ac, 0x376], 0x30b, 0x30c, 0x30d, 0x30e, 0x30f, [0x2ef, 0x377]],
  ],
  // Ilhas 4-5 (Four e Five Island: torres e linha de baixo em duas versoes).
  [
    [PIER, PIER, 0x2f8, 0x2f9, 0x2fa, PIER, PIER],
    [[0x286, 0x2c6], 0x2cb, 0x2cc, 0x2cc, 0x2cc, 0x2cd, [0x287, 0x2c7]],
    [[0x296, 0x2d6], 0x2d3, 0x2d4, 0x2d4, 0x2d4, 0x2d5, [0x297, 0x2d7]],
    [[0x28e, 0x2ce], 0x2db, 0x2dc, 0x2dc, 0x2dc, 0x2dd, [0x28f, 0x2cf]],
    [[0x296, 0x2d6], 0x2e3, 0x2e4, 0x2e5, 0x2e6, 0x2e7, [0x297, 0x2d7]],
    [[0x29e, 0x2de], [0x2f3, 0x2eb], [0x2f4, 0x2ec], [0x2f5, 0x2ed], [0x2f6, 0x2ee], [0x2f7, 0x2ef], [0x29f, 0x2df]],
  ],
  // Ilhas 6-7 (Six e Seven Island) e Birth Island (torres com o mar fundo
  // atras: 322/323, 320/321, 324/325, 326/327).
  [
    [PIER, PIER, 0x2e3, 0x2e4, 0x2e5, PIER, PIER],
    [[0x282, 0x322], 0x2e8, 0x2e9, 0x2e9, 0x2e9, 0x2ea, [0x286, 0x323]],
    [0x290, 0x2f0, 0x2f1, 0x2f1, 0x2f1, 0x2f2, 0x296],
    [[0x288, 0x320], 0x2f8, 0x2f9, 0x2f9, 0x2f9, 0x2fa, [0x28e, 0x321]],
    [[0x290, 0x324], 0x2eb, 0x2ec, 0x2ed, 0x2ee, 0x2ef, [0x296, 0x325]],
    [[0x298, 0x326], 0x2fb, 0x2fc, 0x2fd, 0x2fe, 0x2ff, [0x29e, 0x327]],
  ],
];

// One Island: o terminal fica na emenda com a Praia do Tesouro (o mapa de
// baixo). Em One Island so o fim do pier e a primeira linha do predio
// (torres em versao com areia: 2BD/2B7); as 4 linhas de baixo estao no
// topo da Praia. O modelo inteiro e posto por One Island; na Praia as
// celulas so voltam a ser agua.
const ONE_ISLAND_TOP: readonly (readonly MoldCell[])[] = [
  [PIER, PIER, 0x2b4, 0x2b5, 0x2b6, PIER, PIER],
  [0x2bd, 0x2f0, 0x2f1, 0x2f1, 0x2f1, 0x2f2, 0x2b7],
];

export const ONE_ISLAND_BELOW: readonly (readonly number[])[] = [
  [0x2cd, 0x2f8, 0x2f9, 0x2f9, 0x2f9, 0x2fa, 0x2c7],
  [0x2c5, 0x300, 0x301, 0x301, 0x301, 0x302, 0x2bf],
  [0x2cd, 0x2f3, 0x2f4, 0x2f5, 0x2f6, 0x2f7, 0x2c7],
  [0x2d5, 0x2fb, 0x2fc, 0x2fd, 0x2fe, 0x2ff, 0x2cf],
];

export const FERRY_TERMINAL_WIDTH = 7;
export const FERRY_TERMINAL_HEIGHT = 6;

export interface FoundTerminal {
  x: number;
  y: number;
  // full: o terminal inteiro no mapa; top: so as 2 linhas de cima (One
  // Island), o resto vem de ONE_ISLAND_BELOW; bottom: so as 4 de baixo
  // (Praia do Tesouro), sem modelo.
  part: 'full' | 'top' | 'bottom';
}

/** Celulas do bloco que sao do terminal (na linha do pier, so as 3 do meio). */
export function isFerryTerminalCell(col: number, row: number): boolean {
  return row > 0 || (col >= 2 && col <= 4);
}

export function findFerryTerminals(
  width: number,
  height: number,
  metatileAt: (x: number, y: number) => number,
): FoundTerminal[] {
  const found: FoundTerminal[] = FERRY_TERMINAL_MOLDS.flatMap((mold) =>
    findMold(width, height, metatileAt, mold).map((at) => ({ ...at, part: 'full' as const })));

  for (const at of findMold(width, height, metatileAt, ONE_ISLAND_TOP)) {
    if (at.y + ONE_ISLAND_TOP.length === height) {
      found.push({ ...at, part: 'top' });
    }
  }

  for (const at of findMold(width, height, metatileAt, ONE_ISLAND_BELOW)) {
    if (at.y === 0) {
      found.push({ x: at.x, y: at.y - 2, part: 'bottom' });
    }
  }

  return found;
}

/** Metatiles das linhas que vem do mapa de baixo (pedidos ao montar). */
export function ferryTerminalExtraMetatiles(): number[] {
  return [...new Set(ONE_ISLAND_BELOW.flat())];
}

const FACADE_TOP = 63;
const FACADE_BOTTOM = 88;
const ROOF_TOP = 16;
const WALL = (FACADE_BOTTOM - FACADE_TOP) / PX;
const FRONT = FACADE_BOTTOM / PX;
const BACK = ROOF_TOP / PX + WALL;
const PIER_END = 12 / PX;

/** Recorte sem a agua (pixels azuis): os vaos da estrutura das torres. */
function withoutWater(art: Art, x: number, y: number, w: number, h: number): THREE.DataTexture {
  const data = art.cut(x, y, w, h);

  for (let p = 0; p < data.length; p += 4) {
    if (data[p + 2] > data[p] + 40 && data[p + 2] >= data[p + 1]) {
      data[p + 3] = 0;
    }
  }

  return dataTexture(data, w, h);
}

/**
 * `art`: a arte preparada (sem o chao); `raw`: a arte original do bloco,
 * para as tabuas do pier (a linha 0 fica no mapa e sai da preparada).
 */
export function buildFerryTerminal(art: Art, raw: Art): THREE.Group {
  const root = new THREE.Group();
  root.name = 'ferry-terminal';

  // Corpo: laterais com a faixa da fachada; a frente e o plano da arte.
  const facadeColumn = art.plainestColumn(20, 40, FACADE_TOP, FACADE_BOTTOM, true);
  const side = textured(stripe(art, facadeColumn, FACADE_TOP, FACADE_BOTTOM), 0.8);
  const roofRed = art.color(40, 40);
  const eaveRed = art.color(40, 60);

  root.add(box(1.02, 5.98, 0, WALL, BACK, FRONT - 0.01, [side, side, plain(roofRed, 0.8), invisible(), invisible(), side]));
  root.add(wall(1, FRONT, 6, FRONT, 0, WALL, textured(art.texture(16, FACADE_TOP, 80, FACADE_BOTTOM - FACADE_TOP), 0.97)));

  // Telhado de chapa: duas aguas baixas (as ondas correm de norte a sul).
  root.add(roof({
    kind: 'gable',
    bounds: { x0: 0.94, x1: 6.06, z0: BACK - 0.08, z1: FRONT + 0.08 },
    mapBounds: { x0: 1, x1: 6, z0: BACK, z1: FRONT },
    y: WALL,
    rise: 0.22,
    map: roofTexture(art, 16, ROOF_TOP, 80, FACADE_TOP - ROOF_TOP),
    gableMaterial: plain(roofRed, 0.7),
  }));
  // Beiral: faixa vermelho-escura em pe na frente.
  root.add(box(0.94, 6.06, WALL - 0.08, WALL + 0.005, FRONT + 0.04, FRONT + 0.08, plain(eaveRed, 0.9)));

  // Torres de amarracao: base branca na agua e a estrutura vermelha em
  // cima, encostada no predio.
  const baseSide = plain(art.color(4, 45), 0.8);
  const frameSide = plain(art.color(6, 28), 0.8);

  for (const rowBase of [40, 72]) {
    const rowFrame = rowBase - 14;
    // Base de 11 px (40-50, com o contorno de baixo): frente onde ela toca
    // a agua.
    const zFront = (rowBase + 11) / PX;

    for (const east of [false, true]) {
      // Arte da coluna: oeste px 0-16 (base 1-10), leste o espelho.
      const cell = east ? 6 * PX : 0;
      const basePx = east ? [cell + 6, cell + 15] : [cell + 1, cell + 10];
      const framePx = east ? [cell, cell + 15] : [cell + 1, cell + 16];
      const base = textured(withoutWater(art, basePx[0], rowBase, basePx[1] - basePx[0], 11), 1);
      const frame = textured(withoutWater(art, framePx[0], rowFrame, framePx[1] - framePx[0], 14), 1, true);
      const baseH = 11 / PX;
      const frameH = 14 / PX;

      root.add(box(basePx[0] / PX, basePx[1] / PX, 0, baseH, zFront - 0.42, zFront, [
        baseSide, baseSide, baseSide, invisible(), base, baseSide,
      ]));
      root.add(box(framePx[0] / PX, framePx[1] / PX, baseH, baseH + frameH, zFront - 0.36, zFront - 0.02, [
        frameSide, frameSide, frameSide, invisible(), frame, frame,
      ]));
    }
  }

  // Passarela de tabuas do fim do pier ate o fundo do predio, e a marquise
  // da porta dos fundos.
  const planks = raw.texture(33, 0, 47, 12);
  const length = BACK - PIER_END;

  planks.wrapT = THREE.RepeatWrapping;
  planks.needsUpdate = true;

  const deck = new THREE.Mesh(new THREE.PlaneGeometry(47 / PX, length), textured(planks, 0.95, true));

  deck.rotateX(-Math.PI / 2);
  deck.position.set((33 + 47 / 2) / PX, 0.04, PIER_END + length / 2);
  (deck.geometry.attributes.uv as THREE.BufferAttribute).array.forEach((_, index, array) => {
    if (index % 2 === 1) {
      (array as Float32Array)[index] *= length / (12 / PX);
    }
  });
  deck.geometry.attributes.uv.needsUpdate = true;
  root.add(deck);

  const canopy = plain(raw.color(40, 13), 0.95);

  root.add(box(38 / PX, 74 / PX, 1.0, 1.08, BACK - 0.3, BACK, canopy));
  root.add(wall(70 / PX, BACK - 0.004, 42 / PX, BACK - 0.004, 0, 1.0, plain(art.color(40, 64), 0.5)));

  return root;
}
