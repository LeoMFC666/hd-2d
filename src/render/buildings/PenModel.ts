import * as THREE from 'three';

import { type Art, PX, artBlock, plain } from './ModelKit';

/**
 * Cercados dos Pokemon de Fuchsia: mureta verde-clara em U (fundo e dois
 * lados) em volta do lago ou da areia, com a cerca de pedra e a placa na
 * frente.
 *
 * A mureta e baixa: na arte o fundo tem o topo verde-claro (linhas 8-20
 * contadas do topo da linha do canto) e a face de dentro, escura com a
 * listra salmao, nas linhas 21-30 (10 px de altura pela dobra); os lados
 * tem o topo ate 2 px dentro do tile da ponta e a face da ponta com 11 px.
 * Dobrada pelo mapa, cada lado (coluna fina de blocos solidos) virava uma
 * lamina verde enorme em pe. Aqui ela vira caixas baixas com a arte no
 * topo e na face virada para o sul; a cerca de pedra da frente continua
 * como esta.
 *
 * Metatiles (tileset de Fuchsia): 290/291/292 canto, fundo e canto (linha
 * de cima, andavel; 298/29A cantos com outro fundo), 293/294/295 o resto
 * do fundo, 29B o lado e 29C a ponta do lado.
 */

const CORNER_LEFT = 0x290;
// Canto esquerdo com outro fundo (o cercado de x 31, colado no caminho).
const CORNER_LEFT_ALT = 0x298;
const BACK_TOP = 0x291;
const CORNER_RIGHT = 0x292;
const CORNER_RIGHT_ALT = 0x29a;
const BACK_LEFT = 0x293;
const BACK = 0x294;
const BACK_RIGHT = 0x295;
const SIDE = 0x29b;
const SIDE_END = 0x29c;

export const PEN_WALL_IDS = new Set([CORNER_LEFT, CORNER_LEFT_ALT, BACK_TOP, CORNER_RIGHT, CORNER_RIGHT_ALT, BACK_LEFT, BACK, BACK_RIGHT, SIDE, SIDE_END]);

export interface FoundPen {
  x: number;
  y: number;
  // Coluna do canto direito e linhas das pontas dos lados (no mapa).
  right: number;
  leftEnd: number;
  rightEnd: number;
}

export function findPens(
  width: number,
  height: number,
  metatileAt: (x: number, y: number) => number,
): FoundPen[] {
  const pens: FoundPen[] = [];
  const at = (x: number, y: number): number => (x >= 0 && y >= 0 && x < width && y < height ? metatileAt(x, y) : -1);
  const sideEnd = (x: number, y0: number): number => {
    let y = y0;

    while (at(x, y) === SIDE) {
      y++;
    }

    return at(x, y) === SIDE_END ? y : -1;
  };

  for (let y = 0; y + 3 < height; y++) {
    for (let x = 0; x < width; x++) {
      if ((at(x, y) !== CORNER_LEFT && at(x, y) !== CORNER_LEFT_ALT) || at(x, y + 1) !== BACK_LEFT) {
        continue;
      }

      let right = x + 1;

      while (at(right, y) === BACK_TOP && at(right, y + 1) === BACK) {
        right++;
      }

      if ((at(right, y) !== CORNER_RIGHT && at(right, y) !== CORNER_RIGHT_ALT) || at(right, y + 1) !== BACK_RIGHT) {
        continue;
      }

      const leftEnd = sideEnd(x, y + 2);
      const rightEnd = sideEnd(right, y + 2);

      if (leftEnd > 0 && rightEnd > 0) {
        pens.push({ x, y, right, leftEnd, rightEnd });
      }
    }
  }

  return pens;
}

/** Celulas da mureta (no mapa). */
export function penCells(pen: FoundPen): Array<[number, number]> {
  const cells: Array<[number, number]> = [];

  for (let x = pen.x; x <= pen.right; x++) {
    cells.push([x, pen.y], [x, pen.y + 1]);
  }

  for (let y = pen.y + 2; y <= pen.leftEnd; y++) {
    cells.push([pen.x, y]);
  }

  for (let y = pen.y + 2; y <= pen.rightEnd; y++) {
    cells.push([pen.right, y]);
  }

  return cells;
}

// Alturas pela dobra (px da face / 16).
const BACK_HEIGHT = 10 / PX;
const SIDE_HEIGHT = 11 / PX;

/**
 * Mureta de um cercado. `art`: arte do retangulo do cercado (do canto de
 * cima a esquerda ate a ponta mais baixa), origem do modelo no canto.
 */
export function buildPen(art: Art, pen: FoundPen): THREE.Group {
  const root = new THREE.Group();
  root.name = 'fuchsia-pen';

  const sideColor = plain(art.color(4, 12), 0.75);
  const wide = (pen.right - pen.x + 1) * PX;

  // Fundo: topo nas linhas 8-21, face de dentro 21-31.
  root.add(artBlock(art, {
    x: [0, wide],
    z: [8 / PX + BACK_HEIGHT, 31 / PX],
    y: [0, BACK_HEIGHT],
    lid: [8, 21],
    front: [21, 31],
    sides: sideColor,
  }));

  // Lados: topo ate 2 px dentro do tile da ponta, face da ponta com 11 px.
  for (const [col, end] of [[0, pen.leftEnd], [pen.right - pen.x, pen.rightEnd]] as const) {
    const endRow = (end - pen.y) * PX;

    root.add(artBlock(art, {
      x: [col * PX, (col + 1) * PX],
      z: [8 / PX + SIDE_HEIGHT, (endRow + 13) / PX],
      y: [0, SIDE_HEIGHT],
      lid: [8, endRow + 2],
      front: [endRow + 2, endRow + 13],
      sides: sideColor,
    }));
  }

  return root;
}
