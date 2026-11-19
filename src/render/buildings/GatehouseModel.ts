import * as THREE from 'three';

import { Art, PX, box, invisible, plain, roof, stripe, textured, wall } from './ModelKit';

/**
 * Modelo 3D das PORTARIAS do FRLG (as casas de guarda entre rotas e
 * cidades) e da ENTRADA DO CAMINHO SUBTERRANEO, que usam as mesmas pecas
 * do tileset PRIMARIO:
 *
 *   044 045.. 046   beirada de tras do telhado de chapa ondulada
 *   04C 04D.. 04E   telhado (0 a 3 linhas)
 *   183 184.. 185   pe do telhado (faixa escura do beiral)
 *   1B6 1B5.. 1B7   faixa de janelas
 *   05C ... 05E     tijolo (com o alto da entrada nas norte-sul)
 *   064 065.. 066   base (com a abertura 190-192 nas norte-sul)
 *
 * Leste-oeste (Rotas 7, 8, 11, 15, 16, 18): fachada de 2 linhas (janelas
 * e base) e um vestibulo estreito de cada lado (138/140/148 a oeste,
 * 13C/144/14C a leste), com um telhadinho de uma agua e dois pilares - e
 * por ele que se entra (os warps sao as setas 140/144).
 *
 * Norte-sul (Rotas 2, 5, 6, 12): fachada de 3 linhas com a entrada da
 * frente (marquise 188-18A sobre a abertura 190-192) e, atras, a entrada
 * do outro lado (178-17A, uma beirada de marquise que aparece acima do
 * telhado).
 *
 * Medidas tiradas da arte (pixels): telhado com 3 linhas, faixa escura do
 * beiral nas ultimas 5 linhas dele; vestibulo com 7 px de telhado e
 * pilares de 8 px que terminam meio tile acima da base.
 */

const ROOF_TOP = 0x044;
const ROOF_MID = 0x045;
const ROOF_END = 0x046;
const ROOF_LEFT = 0x04c;
const ROOF_FILL = 0x04d;
const ROOF_RIGHT = 0x04e;
const EAVE_LEFT = 0x183;
const EAVE_FILL = 0x184;
const EAVE_RIGHT = 0x185;
const BASE_LEFT = new Set([0x064, 0x2b8]);
const PORCH_TOP = new Set([0x188]);
const PORCH_DOOR = new Set([0x190]);
const VESTIBULE_WEST = 0x140;
const VESTIBULE_EAST = 0x144;
const BACK_LEFT = new Set([0x178, 0x310]);
const BACK_RIGHT = new Set([0x17a, 0x312]);

export interface FoundGatehouse {
  kind: 'gate-ew' | 'gate-ns';
  // Bloco (com vestibulos e a linha da entrada de tras), em metatiles.
  x: number;
  y: number;
  width: number;
  height: number;
  // Corpo dentro do bloco: colunas [bodyX0, bodyX1) e linhas da beirada de
  // tras (topRow) ate a base (baseRow), inclusive.
  bodyX0: number;
  bodyX1: number;
  topRow: number;
  eaveRow: number;
  baseRow: number;
  // Parte de tras sem fachada (Rota 16: duas portarias coladas, a de tras
  // escondida atras da da frente). Altura da parede e frente vem da de
  // baixo (ver linkStackedGatehouses).
  facadeless?: { wallHeight: number; front: number };
  vestibules: { west: boolean; east: boolean };
  // Colunas [c0, c1) da marquise da frente e da entrada de tras.
  porch: [number, number] | null;
  back: [number, number] | null;
  // Blocos do bloco que sao da construcao (o resto fica no chao).
  mask: (col: number, row: number) => boolean;
}

/** Acha as portarias (corpo com telhado de chapa e beiral 183-185). */
export function findGatehouses(
  width: number,
  height: number,
  metatileAt: (x: number, y: number) => number,
): FoundGatehouse[] {
  const found: FoundGatehouse[] = [];

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (metatileAt(x, y) !== ROOF_TOP) {
        continue;
      }

      let end = x + 1;

      while (end < width && metatileAt(end, y) === ROOF_MID) {
        end++;
      }

      if (metatileAt(end, y) !== ROOF_END || end - x + 1 < 4) {
        continue;
      }

      const bodyWidth = end - x + 1;
      let row = y + 1;

      while (row < height && metatileAt(x, row) === ROOF_LEFT && metatileAt(end, row) === ROOF_RIGHT && metatileAt(x + 1, row) === ROOF_FILL) {
        row++;
      }

      if (metatileAt(x, row) !== EAVE_LEFT || metatileAt(end, row) !== EAVE_RIGHT || metatileAt(x + 1, row) !== EAVE_FILL) {
        continue;
      }

      // Portaria colada logo abaixo (Rota 16): esta e a parte de tras, sem
      // fachada; os vestibulos dela ficam na linha do beiral.
      if (metatileAt(x, row + 1) === ROOF_TOP && metatileAt(end, row + 1) === ROOF_END) {
        const west = metatileAt(x - 1, row - 1) === VESTIBULE_WEST;
        const east = metatileAt(end + 1, row - 1) === VESTIBULE_EAST;
        const blockX = x - (west ? 1 : 0);
        const bodyX0 = x - blockX;
        const bodyX1 = bodyX0 + bodyWidth;
        const baseRow = row - y;

        found.push({
          kind: 'gate-ew',
          x: blockX,
          y,
          width: bodyWidth + (west ? 1 : 0) + (east ? 1 : 0),
          height: baseRow + 1,
          bodyX0,
          bodyX1,
          topRow: 0,
          eaveRow: baseRow,
          baseRow,
          facadeless: { wallHeight: 0, front: 0 },
          vestibules: { west, east },
          porch: null,
          back: null,
          mask: (col, r) => (col >= bodyX0 && col < bodyX1) || (r >= baseRow - 3 && ((col < bodyX0 && west) || (col >= bodyX1 && east))),
        });

        continue;
      }

      // Fachada: ate a linha da base (064 ou a variante de Viridian 2B8).
      let base = row + 1;

      while (base < height && base - row <= 3 && !BASE_LEFT.has(metatileAt(x, base))) {
        base++;
      }

      if (base >= height || !BASE_LEFT.has(metatileAt(x, base))) {
        continue;
      }

      let porch: [number, number] | null = null;
      let porchLeft = -1;

      for (let col = x; col <= end; col++) {
        if (PORCH_DOOR.has(metatileAt(col, base))) {
          porchLeft = col;
        }
      }

      if (porchLeft >= 0) {
        let porchRight = porchLeft + 1;

        while (porchRight <= end && metatileAt(porchRight, base) !== 0x192) {
          porchRight++;
        }

        porch = [porchLeft - x, porchRight - x + 1];
      }

      const west = metatileAt(x - 1, base - 1) === VESTIBULE_WEST;
      const east = metatileAt(end + 1, base - 1) === VESTIBULE_EAST;

      let back: [number, number] | null = null;

      for (let col = x; col <= end; col++) {
        if (BACK_LEFT.has(metatileAt(col, y - 1))) {
          let right = col + 1;

          while (right <= end && !BACK_RIGHT.has(metatileAt(right, y - 1))) {
            right++;
          }

          if (right <= end) {
            back = [col - x, right - x + 1];
          }

          break;
        }
      }

      const ew = (west || east) && !porch;
      const blockX = x - (west ? 1 : 0);
      const blockY = y - (back ? 1 : 0);
      const bodyX0 = x - blockX;
      const bodyX1 = bodyX0 + bodyWidth;
      const topRow = y - blockY;
      const baseRow = base - blockY;
      const blockWidth = bodyWidth + (west ? 1 : 0) + (east ? 1 : 0);

      found.push({
        kind: ew ? 'gate-ew' : 'gate-ns',
        x: blockX,
        y: blockY,
        width: blockWidth,
        height: baseRow + 1,
        bodyX0,
        bodyX1,
        topRow,
        eaveRow: row - blockY,
        baseRow,
        vestibules: { west, east },
        porch: porch ? [porch[0] + bodyX0, porch[1] + bodyX0] : null,
        back: back ? [back[0] + bodyX0, back[1] + bodyX0] : null,
        mask: (col, row) => {
          if (col >= bodyX0 && col < bodyX1) {
            return row >= topRow || (!!back && row === topRow - 1 && col >= back[0] + bodyX0 && col < back[1] + bodyX0);
          }

          // Vestibulos: as 4 linhas de baixo da coluna do lado.
          return row >= baseRow - 3 && row <= baseRow && ((col < bodyX0 && west) || (col >= bodyX1 && east));
        },
      });
    }
  }

  return found;
}

/**
 * Parte de tras sem fachada: a parede tem a altura da portaria de baixo e
 * a frente encosta no fundo dela, para o telhado cair no lugar da arte.
 */
export function linkStackedGatehouses(gates: FoundGatehouse[]): void {
  for (const gate of gates) {
    if (!gate.facadeless) {
      continue;
    }

    const below = gates.find((other) => !other.facadeless && other.x + other.bodyX0 === gate.x + gate.bodyX0
      && other.y + other.topRow === gate.y + gate.baseRow + 1);

    if (!below) {
      continue;
    }

    const wallHeight = below.baseRow - below.eaveRow;
    const belowRoofRows = below.eaveRow - below.topRow + 1;

    gate.facadeless.wallHeight = wallHeight;
    // Fundo da de baixo, no espaco do bloco desta.
    gate.facadeless.front = below.y - gate.y + below.baseRow + 1 - belowRoofRows;
  }
}

const ROOF_RISE = 0.32;
const ROOF_OVERHANG = 0.1;

/** Monta a portaria (origem no canto noroeste do bloco). */
export function buildGatehouseModel(art: Art, gate: FoundGatehouse): THREE.Group {
  const root = new THREE.Group();
  root.name = gate.kind;

  const entrance = new THREE.Group();
  entrance.name = 'entrance';
  root.add(entrance);
  root.userData.entrance = entrance;

  const bx0 = gate.bodyX0;
  const bx1 = gate.bodyX1;
  const pxBody0 = bx0 * PX;
  const pxBody1 = bx1 * PX;

  // Telhado: da primeira linha com arte (beirada de tras) ate o fim do
  // beiral (a linha 183 termina com 5 px escuros). A fachada comeca na
  // linha seguinte e vai ate o ultimo pixel da base.
  const [roofTop] = art.rows(pxBody0 + 4, pxBody1 - 4, gate.topRow * PX);
  const facadeTop = (gate.eaveRow + 1) * PX;
  const [, measuredBottom] = art.rows(pxBody0, pxBody0 + PX, facadeTop);
  const facadeless = gate.facadeless && gate.facadeless.wallHeight > 0 ? gate.facadeless : null;
  const facadeBottom = facadeless ? facadeTop - 1 : measuredBottom;
  const front = facadeless ? facadeless.front : (facadeBottom + 1) / PX;
  const wallHeight = facadeless ? facadeless.wallHeight : (facadeBottom + 1 - facadeTop) / PX;
  const depth = (facadeTop - roofTop) / PX;
  const back = front - depth;

  // Cores da arte: parede (tijolo), chapa do telhado, sombra.
  // Faixa das laterais: uma coluna lisa da fachada fora dos pilares e da
  // entrada (o escuro da abertura nao pode virar parede).
  const sideX1 = gate.porch ? gate.porch[0] * PX : pxBody1 - 10;
  const facadeColumn = art.plainestColumn(pxBody0 + 10, Math.max(pxBody0 + 11, sideX1), facadeTop, facadeBottom + 1);
  const side = stripe(art, facadeColumn, facadeTop, facadeBottom + 1);
  const roofGrey = art.color(pxBody0 + PX + 4, roofTop + PX);
  const shadow = art.color(pxBody0 + PX + 4, facadeTop - 1);

  // Corpo: laterais e fundo com a faixa da fachada (janelas e tijolo
  // continuam em volta), frente invisivel (a fachada vai num plano).
  root.add(box(bx0 + 0.02, bx1 - 0.02, 0, wallHeight, back, front - 0.01, [
    textured(side, 0.82),
    textured(side, 0.7),
    plain(roofGrey, 0.8),
    plain(shadow, 0.5),
    invisible(),
    textured(side, 0.6),
  ]));

  // Fachada em pe, em tamanho natural (a parte de tras sem fachada fica
  // colada no fundo da da frente).
  if (!facadeless) {
    root.add(wall(bx0, front, bx1, front, 0, wallHeight,
      textured(art.texture(pxBody0, facadeTop, pxBody1 - pxBody0, facadeBottom + 1 - facadeTop), 0.97)));
  }

  // Pilares brancos das quinas (8 px na arte): saem um pouco da parede.
  const pillarWidth = 0.5;
  const pillarDepth = 0.08;

  for (const [x0, px] of facadeless ? [] : [[bx0, pxBody0], [bx1 - pillarWidth, pxBody1 - 8]] as const) {
    const pillarArt = art.texture(px, facadeTop - 4, 8, facadeBottom + 1 - facadeTop + 4);
    const pillarSide = plain(art.color(px + 3, facadeTop + 8), 0.75);

    root.add(box(x0, x0 + pillarWidth, 0, wallHeight + 0.25, front - 0.02, front + pillarDepth, [
      pillarSide, pillarSide, plain(art.color(px + 3, facadeTop + 8), 0.95), pillarSide,
      textured(pillarArt), pillarSide,
    ]));
  }

  // Telhado de chapa: duas aguas baixas, cumeeira no meio (as ondas da
  // chapa correm de norte a sul, como na arte).
  const bounds = { x0: bx0 - ROOF_OVERHANG, x1: bx1 + ROOF_OVERHANG, z0: back - ROOF_OVERHANG, z1: front + ROOF_OVERHANG };
  const roofArt = art.texture(pxBody0, roofTop, pxBody1 - pxBody0, facadeTop - roofTop);
  root.add(roof({
    kind: 'gable',
    bounds,
    y: wallHeight,
    rise: ROOF_RISE,
    map: roofArt,
    gableMaterial: plain(art.color(facadeColumn, facadeTop + 18), 0.7),
  }));

  // Espessura do beiral: faixa escura em pe na beirada da frente.
  const fascia = plain(art.color(pxBody0 + PX + 4, facadeTop - 3), 0.85);
  root.add(box(bounds.x0, bounds.x1, wallHeight - 0.07, wallHeight + 0.005, bounds.z1 - 0.04, bounds.z1, fascia));

  if (gate.kind === 'gate-ew') {
    // As celulas dos vestibulos sao metade construcao, metade chao: fica
    // so o que tem cor do corpo (chapa, pilares, sombra).
    const colors = art.palette(pxBody0, roofTop, pxBody1, facadeBottom + 1);

    for (const side of ['west', 'east'] as const) {
      if (gate.vestibules[side]) {
        const cell = (side === 'west' ? gate.bodyX0 - 1 : gate.bodyX1) * PX;

        art.keepOnly(cell, (gate.baseRow - 3) * PX, cell + PX, (gate.baseRow + 1) * PX, colors);
      }
    }

    buildVestibules(root, art, gate, front, wallHeight);
  } else {
    buildPorches(root, entrance, art, gate, front, back, wallHeight);
  }

  return root;
}

/**
 * Vestibulos das portarias leste-oeste. Medidas da arte (138/140/148 a
 * oeste; 13C/144/14C sao o espelho): telhadinho de uma agua com 7 px de
 * largura, da linha 18D ate 12 px dentro da linha do beiral; dois pilares
 * de 4 px (8 px ao todo) encostados no corpo, da linha da janela ate 8 px
 * dentro da base - o vestibulo fica meio tile atras da fachada. Aberto
 * para o lado de fora: a passagem fica na parede do corpo.
 */
const FLAP_WIDTH_PX = 7;
const POSTS_WIDTH_PX = 8;

function buildVestibules(root: THREE.Group, art: Art, gate: FoundGatehouse, front: number, wallHeight: number): void {
  const baseRowPx = gate.baseRow * PX;
  const postsTop = baseRowPx - PX;
  const postsBottom = baseRowPx + 7;
  const flapTop = baseRowPx - 3 * PX;
  const flapBottom = baseRowPx - PX - 4;
  const vestibuleFront = (postsBottom + 1) / PX;
  const postHeight = (postsBottom + 1 - postsTop) / PX;
  const flapDepth = (flapBottom + 1 - flapTop) / PX;
  const bodyPx = gate.bodyX0 * PX;
  const postColor = art.color(bodyPx + 3, (gate.eaveRow + 1) * PX + 8);
  const edgeColor = art.color(bodyPx + 20, (gate.eaveRow + 1) * PX - 3);
  const darkColor = art.color(bodyPx + 20, (gate.eaveRow + 1) * PX - 1);

  for (const side of ['west', 'east'] as const) {
    if (!gate.vestibules[side]) {
      continue;
    }

    const west = side === 'west';
    const wallX = west ? gate.bodyX0 : gate.bodyX1;
    const pxWall = wallX * PX;
    const out = west ? -1 : 1;
    const postsPx0 = west ? pxWall - POSTS_WIDTH_PX : pxWall;
    const flapPx0 = west ? pxWall - FLAP_WIDTH_PX : pxWall;
    const outer = wallX + out * POSTS_WIDTH_PX / PX;
    const x0 = Math.min(wallX, outer);
    const x1 = Math.max(wallX, outer);

    // Frente: os dois pilares com a arte, rentes ao chao.
    root.add(wall(x0, vestibuleFront, x1, vestibuleFront, 0, postHeight,
      textured(art.texture(postsPx0, postsTop, POSTS_WIDTH_PX, postsBottom + 1 - postsTop))));

    // Volume dos pilares de fora (frente e fundo do vestibulo).
    const postWidth = 0.2;
    const postX = west ? outer : outer - postWidth;
    const postMaterial = plain(postColor, 0.85);
    root.add(box(postX, postX + postWidth, 0, postHeight, vestibuleFront - 0.14, vestibuleFront - 0.004, postMaterial));
    root.add(box(postX, postX + postWidth, 0, postHeight, vestibuleFront - flapDepth, vestibuleFront - flapDepth + 0.14, postMaterial));

    // Passagem escura na parede do corpo, entre os pilares.
    const doorway = wall(
      wallX, west ? vestibuleFront - flapDepth + 0.16 : vestibuleFront - 0.16,
      wallX, west ? vestibuleFront - 0.16 : vestibuleFront - flapDepth + 0.16,
      0, postHeight - 0.08, plain(darkColor, 0.55),
    );
    doorway.position.x += out * 0.006;
    root.add(doorway);

    // Telhadinho de uma agua: mais alto junto da parede, caindo para fora.
    const flapOuter = wallX + out * FLAP_WIDTH_PX / PX;
    const highY = Math.min(wallHeight - 0.12, postHeight + 0.24);
    const lowY = postHeight + 0.02;
    const z0 = vestibuleFront - flapDepth;
    const z1 = vestibuleFront + 0.04;
    const flapArt = art.texture(flapPx0, flapTop, FLAP_WIDTH_PX, flapBottom + 1 - flapTop);
    // u segue a arte (da esquerda para a direita), v de baixo (sul) para cima.
    const left = west ? flapOuter : wallX;
    const right = west ? wallX : flapOuter;
    const yLeft = west ? lowY : highY;
    const yRight = west ? highY : lowY;
    const flap = new THREE.Mesh(
      new THREE.BufferGeometry()
        .setAttribute('position', new THREE.Float32BufferAttribute([
          left, yLeft, z1, right, yRight, z1, right, yRight, z0, left, yLeft, z0,
        ], 3))
        .setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2))
        .setIndex([0, 1, 2, 0, 2, 3]),
      textured(flapArt, 1, true),
    );
    root.add(flap);

    // Espessura da beirada do telhadinho.
    root.add(box(Math.min(left, right), Math.max(left, right), lowY - 0.06, lowY + 0.01, z1 - 0.035, z1, plain(edgeColor, 0.9)));
  }
}

/**
 * Portarias norte-sul: marquise da frente sobre a abertura (as linhas
 * 188-18A/190-192 da arte) e a da entrada de tras (178-17A).
 */
function buildPorches(
  root: THREE.Group,
  entrance: THREE.Group,
  art: Art,
  gate: FoundGatehouse,
  front: number,
  back: number,
  wallHeight: number,
): void {
  if (gate.porch) {
    const px0 = gate.porch[0] * PX;
    const px1 = gate.porch[1] * PX;
    const baseRow = gate.baseRow * PX;
    // Marquise: a faixa clara entre a linha escura de cima e a sombra,
    // na linha de cima da entrada.
    const porchRow = baseRow - PX;
    const [x0, x1] = art.columns(porchRow, porchRow + PX, px0, px1);
    let canopyTop = porchRow;
    let canopyBottom = porchRow;
    const middle = Math.round((x0 + x1) / 2);

    for (let y = porchRow; y < baseRow; y++) {
      if (art.light(middle, y) >= 3 * 160) {
        if (canopyTop === porchRow) canopyTop = y - 1;
        canopyBottom = y;
      } else if (canopyTop !== porchRow && y > canopyBottom + 3) {
        break;
      }
    }

    const canopyDepth = Math.max(0.35, (canopyBottom + 3 - canopyTop) / PX * 0.8);
    const height = (baseRow + PX - canopyBottom - 3) / PX;
    const left = x0 / PX;
    const right = (x1 + 1) / PX;
    const canopyArt = art.texture(x0, canopyTop, x1 + 1 - x0, canopyBottom + 3 - canopyTop);
    const frame = plain(art.color(x0 + 2, baseRow + 4), 0.9);
    const frameSide = plain(art.color(x0 + 2, baseRow + 4), 0.72);

    // Laje da marquise (topo com a arte) e as duas molduras laterais.
    entrance.add(box(left, right, height, height + 0.1, front, front + canopyDepth, [
      frameSide, frameSide, textured(canopyArt), plain(art.color(middle, canopyBottom + 2), 0.6),
      plain(art.color(middle, canopyBottom + 1), 0.8), frameSide,
    ]));

    for (const x of [left, right - 0.16]) {
      entrance.add(box(x, x + 0.16, 0, height, front, front + canopyDepth - 0.02, [frameSide, frameSide, frame, frame, frame, frame]));
    }
  }

  if (gate.back) {
    // Entrada de tras: marquise igual, na parede norte, e a abertura.
    const left = gate.back[0] + 0.1;
    const right = gate.back[1] - 0.1;
    const canopyColor = art.color(Math.round((gate.back[0] + gate.back[1]) / 2 * PX), (gate.topRow - 1) * PX + 14);
    const height = Math.min(wallHeight - 0.4, 1.3);

    root.add(box(left, right, height, height + 0.1, back - 0.55, back, [
      plain(canopyColor, 0.7), plain(canopyColor, 0.7), plain(canopyColor, 1), plain(canopyColor, 0.5),
      plain(canopyColor, 0.75), plain(canopyColor, 0.8),
    ]));
    root.add(wall(right - 0.1, back - 0.005, left + 0.1, back - 0.005, 0, height, plain(art.color(Math.round(gate.back[0] * PX + 4), gate.topRow * PX + 4), 0.25)));
  }
}
