import * as THREE from 'three';

import { Art, PX, box, doorPlane, invisible, plain, roof, stripe, textured, wall } from './ModelKit';

/**
 * Casa generica do FRLG: um bloco retangular de metatiles com o telhado em
 * cima e a fachada (parede com porta) nas linhas de baixo.
 *
 * Tudo sai da arte do proprio bloco:
 *  - a fachada comeca em `facadeTopPx` (fim do beiral, medido na arte de
 *    cada molde) e vai ate o ultimo pixel opaco da coluna da porta: em
 *    pe, na borda sul, em tamanho natural (porta de 1 tile);
 *  - a parede tem pelo menos `minWall` (1,5, como o Poke Mart): o que
 *    passa da arte e uma faixa da linha de cima da fachada;
 *  - o telhado e a arte de cima, projetada de cima numa forma de quatro
 *    aguas, duas aguas ou laje, com a profundidade igual a altura dele na
 *    arte (a regra da dobra: vista pela camera, cai no lugar do GBA).
 */

export interface HouseSpec {
  // Primeira linha (px, no bloco) da parede, logo abaixo do beiral.
  facadeTopPx: number;
  // Primeira linha do telhado (padrao: a primeira com arte).
  roofTopPx?: number;
  minWall?: number;
  roof: {
    kind: 'hip' | 'gable' | 'flat';
    rise: number;
    // Recuo das aguas laterais do quatro aguas (largura delas na arte).
    inset?: number;
    overhang?: number;
    ridgeAt?: number;
  };
  // Celulas das portas (coluna e linha no bloco).
  doors: Array<{ col: number; row: number }>;
  // Colunas (px) dos pilares das quinas, que saem um pouco da parede.
  posts?: Array<[number, number]>;
  // Largura do corpo (px) quando a arte tem algo para fora (padrao: as
  // colunas com arte na linha da porta).
  bodyPx?: [number, number];
}

export function buildHouse(name: string, art: Art, spec: HouseSpec): THREE.Group {
  const root = new THREE.Group();
  root.name = name;

  const entrance = new THREE.Group();
  entrance.name = 'entrance';
  root.add(entrance);
  root.userData.entrance = entrance;

  const doorRow = spec.doors[0]?.row ?? Math.floor((art.height - 1) / PX);
  const [bodyPx0, bodyPx1] = spec.bodyPx ?? (() => {
    const [first, last] = art.columns(doorRow * PX, doorRow * PX + PX);

    return [first, last + 1] as [number, number];
  })();
  const facadeTop = spec.facadeTopPx;
  const doorCol = spec.doors[0]?.col ?? Math.floor(art.width / PX / 2);
  const [, facadeBottom] = art.rows(doorCol * PX + 2, doorCol * PX + PX - 2, facadeTop);
  const [roofTopMeasured] = art.rows(bodyPx0 + 8, bodyPx1 - 8);
  const roofTop = spec.roofTopPx ?? roofTopMeasured;

  const x0 = bodyPx0 / PX;
  const x1 = bodyPx1 / PX;
  const front = (facadeBottom + 1) / PX;
  const artWall = (facadeBottom + 1 - facadeTop) / PX;
  const wallHeight = Math.max(artWall, spec.minWall ?? 1.5);
  const depth = (facadeTop - roofTop) / PX;
  const back = front - depth;

  // Laterais e fundo: a coluna mais lisa da fachada, esticada.
  // (entre os pilares, para a lateral ter a cor da parede da frente).
  const posts = spec.posts ?? [];
  const searchX0 = posts.length ? Math.max(bodyPx0 + 6, posts[0][1] + 1) : bodyPx0 + 6;
  const searchX1 = posts.length > 1 ? Math.min(bodyPx1 - 6, posts[posts.length - 1][0]) : bodyPx1 - 6;
  const sideColumn = art.plainestColumn(searchX0, Math.max(searchX0 + 1, searchX1), facadeTop, facadeBottom + 1, true);
  const side = stripe(art, sideColumn, facadeTop, facadeBottom + 1);
  const wallColor = art.color(sideColumn, Math.round((facadeTop + facadeBottom) / 2));

  root.add(box(x0 + 0.02, x1 - 0.02, 0, wallHeight, back, front - 0.01, [
    textured(side, 0.82),
    textured(side, 0.72),
    plain(wallColor, 0.7),
    plain(wallColor, 0.4),
    invisible(),
    textured(side, 0.62),
  ]));

  // Fachada em tamanho natural, e a faixa por cima ate o beiral.
  const facadeArt = art.texture(bodyPx0, facadeTop, bodyPx1 - bodyPx0, facadeBottom + 1 - facadeTop);
  root.add(wall(x0, front, x1, front, 0, artWall, textured(facadeArt, 0.97)));

  if (wallHeight > artWall + 0.01) {
    const band = art.texture(bodyPx0, facadeTop, bodyPx1 - bodyPx0, 1);
    root.add(wall(x0, front, x1, front, artWall, wallHeight, textured(band, 0.8)));
  }

  // Pilares das quinas em volume.
  for (const [px0, px1] of spec.posts ?? []) {
    const postX0 = px0 / PX;
    const postX1 = px1 / PX;
    const postColor = art.color(Math.round((px0 + px1) / 2), facadeBottom - 4);
    const postSide = plain(postColor, 0.75);
    const postArt = art.texture(px0, facadeTop, px1 - px0, facadeBottom + 1 - facadeTop);

    root.add(box(postX0, postX1, 0, wallHeight, front - 0.03, front + 0.07, [
      postSide, postSide, plain(postColor, 0.9), postSide, textured(postArt), postSide,
    ]));
  }

  // Telhado com a arte de cima.
  const overhang = spec.roof.overhang ?? 0.1;
  const bounds = { x0: x0 - overhang, x1: x1 + overhang, z0: back - overhang, z1: front + overhang };
  const roofArt = art.texture(bodyPx0, roofTop, bodyPx1 - bodyPx0, facadeTop - roofTop);
  const eaveColor = art.color(Math.round((bodyPx0 + bodyPx1) / 2), facadeTop - 2);

  root.add(roof({
    kind: spec.roof.kind,
    bounds,
    y: wallHeight,
    rise: spec.roof.rise,
    inset: spec.roof.inset,
    ridgeAt: spec.roof.ridgeAt,
    map: roofArt,
    gableMaterial: plain(wallColor, 0.72),
  }));

  // Espessura do beiral, na cor da beirada da arte.
  root.add(box(bounds.x0, bounds.x1, wallHeight - 0.06, wallHeight + 0.005, bounds.z1 - 0.04, bounds.z1, plain(eaveColor, 0.9)));

  // Portas (animadas pelo DoorAnimator).
  for (const door of spec.doors) {
    entrance.add(doorPlane(art, door.col * PX, door.row * PX, door.col + 0.5, front + 0.004));
  }

  root.userData.measures = { front, back, wallHeight, artWall, depth, x0, x1 };

  return root;
}

/** Celula do molde: id exato, um de varios, ou qualquer (null). */
export type MoldCell = number | readonly number[] | null;

/** Acha um molde de metatiles (linhas de cima para baixo) no mapa. */
export function findMold(
  width: number,
  height: number,
  metatileAt: (x: number, y: number) => number,
  rows: readonly (readonly MoldCell[])[],
): Array<{ x: number; y: number }> {
  const found: Array<{ x: number; y: number }> = [];
  const h = rows.length;
  const w = rows[0].length;
  const matches = (cell: MoldCell, id: number): boolean =>
    cell === null || (typeof cell === 'number' ? cell === id : cell.includes(id));

  for (let y = 0; y + h <= height; y++) {
    for (let x = 0; x + w <= width; x++) {
      let ok = true;

      for (let row = 0; row < h && ok; row++) {
        for (let col = 0; col < w && ok; col++) {
          ok = matches(rows[row][col], metatileAt(x + col, y + row));
        }
      }

      if (ok) {
        found.push({ x, y });
      }
    }
  }

  return found;
}

/**
 * Casa de rota do tileset primario (Rotas 2, 12 e 16): 5x3, telhado azul
 * de quatro aguas (02C-02F, 034-037), fachada 03C-03F com porta 03D e
 * janela (042/043 ou 006/007, espelhada na Rota 2).
 *
 * Medidas da arte: telhado da linha 0 ate 11 px dentro da linha 1 (beiral
 * de 3 px), parede de 21 px (sombra do beiral + linha da porta), aguas
 * laterais de 12-13 px, pilares das quinas (branco + creme) de 3 a 14 px.
 */
export const ROUTE_HOUSE_MOLD: readonly (readonly MoldCell[])[] = [
  [null, 0x02d, 0x02d, 0x02d, null],
  [0x034, [0x035, 0x036], 0x036, [0x035, 0x036], 0x037],
  [0x03c, [0x03d, 0x006], [0x042, 0x007], [0x043, 0x03d], 0x03f],
];

export function buildRouteHouse(art: Art, doorCol: number): THREE.Group {
  return buildHouse('route-house', art, {
    facadeTopPx: PX + 11,
    minWall: 1.5,
    roof: { kind: 'hip', rise: 0.55, inset: 0.78, overhang: 0.1 },
    doors: [{ col: doorCol, row: 2 }],
    posts: [[2, 15], [5 * PX - 16, 5 * PX - 2]],
  });
}
