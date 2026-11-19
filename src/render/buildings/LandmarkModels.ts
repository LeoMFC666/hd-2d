import * as THREE from 'three';

import { type MoldCell, buildHouse, findMold } from './HouseModel';
import { type Art, PX, artBlock, artRoof, doorPlane, plain, polygons, stripe, textured, wall } from './ModelKit';

/**
 * Construcoes unicas de Kanto (laboratorio do Oak, museu, torre, Silph...).
 *
 * Cada uma tem o molde exato dos metatiles do bloco (os ids do tileset da
 * cidade so aparecem nela) e o modelo feito sob medida a partir da arte:
 * as medidas em px sao do bloco (origem no canto noroeste do molde) e
 * foram tiradas do desenho do GBA, linha a linha.
 */

export interface Landmark {
  kind: string;
  mold: readonly (readonly MoldCell[])[];
  // Celulas do molde que nao sao da construcao (ficam no mapa).
  outside?: (col: number, row: number) => boolean;
  // Metatiles desenhados ACIMA do molde, no mapa vizinho do norte (do
  // mesmo tileset): a parte alta de uma construcao que passa da borda do
  // mapa (o topo da Torre Pokemon esta na Rota 10). A arte entregue ao
  // build comeca neles e o modelo e posto essas linhas mais acima.
  extension?: readonly (readonly number[])[];
  // Retangulos (px do molde) que voltam com a arte original depois de
  // tirar o chao: a grama que aparece por dentro de uma floreira e planta.
  keep?: ReadonlyArray<readonly [number, number, number, number]>;
  // null: so tira as celulas do mapa (a parte de cima de uma construcao
  // cujo modelo e feito pelo mapa vizinho).
  build: (art: Art) => THREE.Group | null;
}

const LANDMARKS: Landmark[] = [
  {
    // Laboratorio do Prof. Oak (Pallet): laje cinza quadriculada com mureta
    // clara, o respiro vinho em cima a direita e a fachada de tijolo creme
    // com as escotilhas (2 tiles de parede). Porta verde em (16,13).
    kind: 'oaks-lab',
    mold: [
      [0x2a8, 0x2a9, 0x2a9, 0x2a9, 0x2a9, 0x2bd, 0x2b5],
      [0x2b0, 0x2b1, 0x2b1, 0x2b1, 0x2b1, 0x2b3, 0x2b4],
      [0x2b8, 0x2b9, 0x2b9, 0x2b9, 0x2b9, 0x2bb, 0x2bc],
      [0x2c0, 0x2c1, 0x2d0, 0x2c2, 0x2c3, 0x2c4, 0x2c5],
      [0x2c8, 0x2c9, 0x2d8, 0x2ac, 0x2cb, 0x2cc, 0x2cd],
    ],
    build: (art) =>
      buildHouse('oaks-lab', art, {
        roofTopPx: 8,
        facadeTopPx: 48,
        bodyPx: [0, 112],
        roof: { kind: 'flat', rise: 0, overhang: 0.02, parapet: 0.08 },
        // Respiro: tampa (px 10-25, a moldura rosa com o buraco escuro) e
        // frente vinho (px 25-37); a laje tem quadros de 16 px.
        chimneys: [{ x0: 80, y0: 10, x1: 102, y1: 37, frontPx: 25, patchDx: 32 }],
        doors: [{ col: 3, row: 4 }],
      }),
  },
  {
    kind: 'pewter-museum',
    mold: [
      [0x280, 0x281, 0x282, 0x281, 0x282, 0x281, 0x282, 0x281, 0x282, 0x281, 0x286, null, null, null, null, null],
      [0x288, 0x289, 0x289, 0x289, 0x289, 0x289, 0x289, 0x289, 0x289, 0x289, 0x28e, 0x28c, 0x28b, 0x28c, 0x28b, 0x285],
      [0x290, 0x291, 0x291, 0x291, 0x291, 0x291, 0x291, 0x291, 0x291, 0x291, 0x296, 0x291, 0x291, 0x291, 0x291, 0x28d],
      [0x298, 0x299, 0x299, 0x299, 0x299, 0x299, 0x299, 0x299, 0x299, 0x299, 0x29e, 0x294, 0x294, 0x293, 0x294, 0x295],
      [0x2a0, 0x2a1, 0x2a1, 0x2a1, 0x2a2, 0x2a3, 0x2a4, 0x2a5, 0x2a5, 0x2a5, 0x2a6, 0x29c, 0x29b, 0x2ce, 0x29c, 0x29d],
      [0x2a8, 0x2a9, 0x2a9, 0x2a9, 0x2aa, 0x2ab, 0x2ac, 0x2ad, 0x2ad, 0x2ad, 0x2ae, null, null, null, null, null],
      [null, null, null, null, 0x2b2, 0x2b3, 0x2b4, null, null, null, null, null, null, null, null, null],
      [null, null, null, null, 0x2ba, 0x2bb, 0x2bc, null, null, null, null, null, null, null, null, null],
    ],
    outside: (col, row) => (col >= 11 && (row === 0 || row >= 5)) || (row >= 6 && (col < 4 || col > 6)),
    build: buildPewterMuseum,
  },
  {
    kind: 'bike-shop',
    mold: [
      [0x28a, 0x28b, 0x287, 0x28c],
      [0x292, 0x293, 0x293, 0x294],
      [0x292, 0x293, 0x293, 0x294],
      [0x29a, 0x29b, 0x29b, 0x29c],
      [0x28d, 0x28e, 0x28e, 0x28f],
      [0x295, 0x296, 0x296, 0x297],
    ],
    build: buildBikeShop,
  },
  {
    // Fa-clube Pokemon (Vermilion, 5x4 em (11,14)): telhado verde listrado
    // (px 0-38, franja laranja na beirada), parede de tabuas (39-64) com a
    // porta (12,17), a placa rosa da Poke Bola em cima dela e a janela.
    kind: 'pokemon-fan-club',
    mold: [
      [0x2c8, 0x2c9, 0x2c9, 0x2c9, 0x2ca],
      [0x2d0, 0x2d1, 0x2d1, 0x2d1, 0x2d2],
      [0x2d8, 0x2d9, 0x2da, 0x2db, 0x2cb],
      [0x2e0, 0x29e, 0x2e2, 0x2e3, 0x2d3],
    ],
    keep: [[40, 46, 72, 64]],
    build: (art) => {
      const house = buildHouse('pokemon-fan-club', art, {
        roofTopPx: 0,
        facadeTopPx: 39,
        bodyPx: [0, 80],
        sidePx: 5,
        roof: { kind: 'gable', rise: 0.5, ridgeAt: 0.3, overhang: 0.1 },
        doors: [{ col: 1, row: 3 }],
      });
      const { front, wallHeight } = house.userData.measures as { front: number; wallHeight: number };

      // A placa sobe acima do beiral: a parte de cima dela (linhas 34-39)
      // fica em pe na frente do telhado.
      house.add(artBlock(art, {
        x: [19, 29], z: [front + 0.1, front + 0.12], y: [wallHeight - 0.02, wallHeight + 5 / PX], front: [34, 39],
        sides: plain(art.color(23, 40), 0.8),
      }));

      return house;
    },
  },
  {
    // Loja de departamentos de Celadon (9x10 em (9,5)).
    kind: 'celadon-dept-store',
    mold: [
      [0x281, 0x282, 0x285, 0x286, 0x286, 0x286, 0x287, 0x282, 0x283],
      [0x289, 0x28a, 0x28d, 0x28e, 0x28e, 0x28e, 0x28f, 0x28a, 0x28b],
      [0x289, 0x28a, 0x295, 0x296, 0x296, 0x296, 0x297, 0x28a, 0x28b],
      [0x291, 0x292, 0x29d, 0x29e, 0x29e, 0x29e, 0x29f, 0x292, 0x293],
      [0x299, 0x29a, 0x290, 0x29b, 0x288, 0x29a, 0x290, 0x29b, 0x29c],
      [0x2a1, 0x2a2, 0x298, 0x2a3, 0x284, 0x2a2, 0x298, 0x2a3, 0x2a4],
      [0x2a1, 0x2a2, 0x298, 0x2a3, 0x284, 0x2a2, 0x298, 0x2a3, 0x2a4],
      [0x2a1, 0x2a2, 0x2a0, 0x2a3, 0x284, 0x2a2, 0x2a0, 0x2a3, 0x2a4],
      [0x2a1, 0x2a2, 0x28c, 0x2a3, 0x284, 0x2a2, 0x28c, 0x2a3, 0x2a4],
      [0x2a9, 0x2aa, 0x294, 0x2ab, 0x284, 0x2aa, 0x294, 0x2ab, 0x2ac],
    ],
    build: buildDeptStore,
  },
  {
    // Condominios de Celadon (7x8 em (27,4)); na linha de cima, as pontas
    // sao as arvores do lado (ficam no mapa).
    kind: 'celadon-condominiums',
    mold: [
      [0x318, 0x319, 0x31a, 0x31b, 0x31c, 0x31d, 0x31e],
      [0x2e0, 0x2e1, 0x2e1, 0x2e1, 0x2e1, 0x2e2, 0x2e3],
      [0x2e0, 0x2e1, 0x2e1, 0x2e1, 0x2e1, 0x2e1, 0x2e4],
      [0x2e8, 0x300, 0x301, 0x2ea, 0x302, 0x303, 0x2ec],
      [0x2f0, 0x308, 0x309, 0x2f2, 0x30a, 0x30b, 0x2f4],
      [0x2f0, 0x308, 0x309, 0x2f2, 0x30a, 0x30b, 0x2f4],
      [0x2f0, 0x308, 0x304, 0x2ff, 0x305, 0x30b, 0x2f4],
      [0x2f8, 0x2fd, 0x30c, 0x03d, 0x30d, 0x2fe, 0x2fc],
    ],
    outside: (col, row) => row === 0 && (col < 2 || col > 4),
    build: buildCondominiums,
  },
  {
    // Cassino (Game Corner) de Celadon: 7x5 em (31,17), mais a ponta das
    // colunas da entrada na linha de baixo (cols 2 e 4).
    kind: 'celadon-game-corner',
    mold: [
      [0x2b0, 0x2b1, 0x2b1, 0x2b1, 0x2b1, 0x2b1, 0x2b2],
      [0x2b8, 0x2b3, 0x2b3, 0x2b9, 0x2bb, 0x2bb, 0x2ba],
      [0x2c0, 0x2b3, 0x2b4, 0x2c1, 0x2bc, 0x2bb, 0x2c2],
      [0x2c8, 0x2b7, 0x2b5, 0x2c9, 0x2b6, 0x2b7, 0x2ca],
      [0x2c3, 0x2bf, 0x2bd, 0x15b, 0x2be, 0x2bf, 0x2c4],
      [null, null, 0x2c5, null, 0x2c6, null, null],
    ],
    outside: (col, row) => row === 5 && col !== 2 && col !== 4,
    build: buildGameCorner,
  },
  {
    // Sala de premios do cassino: 3x4 em (38,17), o mesmo estilo.
    kind: 'celadon-prize-room',
    mold: [
      [0x2b0, 0x2b1, 0x2b2],
      [0x2c0, 0x2b9, 0x2c2],
      [0x2c8, 0x2c7, 0x2ca],
      [0x2c3, 0x15b, 0x2c4],
    ],
    build: (art) => {
      const house = buildHouse('celadon-prize-room', art, {
        roofTopPx: 8,
        facadeTopPx: 40,
        bodyPx: [0, 48],
        roof: { kind: 'flat', rise: 0, overhang: 0.02 },
        doors: [{ col: 1, row: 3 }],
      });

      house.add(crenellations(art, house, 48));

      return house;
    },
  },
  {
    // Entrada da Zona Safari (Fuchsia, 6x6 em (22,0); a palha passa da
    // borda de cima do mapa), mais o pe dos postes da porta (cols 1 e 3).
    kind: 'safari-zone-entrance',
    mold: [
      [0x2bc, 0x2bd, 0x2bd, 0x2bd, 0x2bd, 0x2be],
      [0x2bc, 0x2bd, 0x2bd, 0x2bd, 0x2bd, 0x2be],
      [0x2bc, 0x2bd, 0x2bd, 0x2bd, 0x2bd, 0x2be],
      [0x2c0, 0x2c1, 0x2c1, 0x2c1, 0x2c1, 0x2c2],
      [0x2c8, 0x2c9, 0x2ca, 0x2cb, 0x2d6, 0x2cf],
      [0x2d0, 0x2d1, 0x2d2, 0x2d3, 0x2d7, 0x2c3],
      [null, 0x2d4, null, 0x2d5, null, null],
    ],
    outside: (col, row) => row === 6 && col !== 1 && col !== 3,
    build: (art) => buildSafariHouse('safari-zone-entrance', art, 0),
  },
  {
    // Silph Co. (Saffron, 9x15 em (29,16)).
    kind: 'silph-co',
    mold: [
      [0x2a8, 0x2a9, 0x2a9, 0x2c5, 0x2c6, 0x2c7, 0x2a9, 0x2a9, 0x2aa],
      [0x2b0, 0x2b1, 0x2b1, 0x2cd, 0x2ce, 0x2cf, 0x2b1, 0x2b1, 0x2b2],
      [0x2b0, 0x2b1, 0x2b1, 0x2cd, 0x2ce, 0x2cf, 0x2b1, 0x2b1, 0x2b2],
      [0x2b0, 0x2b1, 0x2b1, 0x2cd, 0x2ce, 0x2cf, 0x2b1, 0x2b1, 0x2b2],
      [0x2b8, 0x2b9, 0x2b9, 0x2d5, 0x2d6, 0x2d7, 0x2b9, 0x2b9, 0x2ba],
      [0x2c0, 0x2c1, 0x2c2, 0x2c2, 0x2c2, 0x2c2, 0x2c2, 0x2c3, 0x2c4],
      [0x2c8, 0x2c9, 0x2ca, 0x2ca, 0x2ca, 0x2ca, 0x2ca, 0x2cb, 0x2cc],
      [0x2c8, 0x2c9, 0x2ca, 0x2ca, 0x2ca, 0x2ca, 0x2ca, 0x2cb, 0x2cc],
      [0x2c8, 0x2c9, 0x2ca, 0x2ca, 0x2ca, 0x2ca, 0x2ca, 0x2cb, 0x2cc],
      [0x2c8, 0x2c9, 0x2ca, 0x2ca, 0x2ca, 0x2ca, 0x2ca, 0x2cb, 0x2cc],
      [0x2c8, 0x2c9, 0x2ca, 0x2ca, 0x2ca, 0x2ca, 0x2ca, 0x2cb, 0x2cc],
      [0x2c8, 0x2c9, 0x2ca, 0x2ca, 0x2ca, 0x2ca, 0x2ca, 0x2cb, 0x2cc],
      [0x2c8, 0x2c9, 0x2ca, 0x2ab, 0x2ac, 0x2ad, 0x2ca, 0x2cb, 0x2cc],
      [0x2d0, 0x2d1, 0x2ca, 0x2b3, 0x2b4, 0x2b5, 0x2ca, 0x2d2, 0x2d3],
      [0x2d8, 0x2d9, 0x2d4, 0x2bb, 0x2bc, 0x2bd, 0x2d4, 0x2da, 0x2db],
    ],
    build: buildSilphCo,
  },
  {
    // Dojo de Saffron (6x5 em (37,8)); a linha de cima tem o pe das arvores
    // de tras (fica no mapa) e o alto da cumeeira.
    kind: 'saffron-dojo',
    mold: [
      [0x330, 0x331, 0x31f, 0x331, 0x31f, 0x332],
      [0x338, 0x339, 0x339, 0x339, 0x339, 0x33a],
      [0x340, 0x341, 0x341, 0x341, 0x341, 0x342],
      [0x335, 0x336, 0x337, 0x32b, 0x32c, 0x33b],
      [0x33d, 0x33e, 0x33f, 0x333, 0x334, 0x343],
    ],
    outside: (_col, row) => row === 0,
    build: (art) => {
      // Telhado de telhas (cumeeira e agua da frente, 16-52), parede baixa
      // com as janelas (52-72) e o alpendre do meio (40-72): o painel da
      // Poke Bola em cima (46-62), os postes brancos e o vao escuro da
      // entrada (40,12) ate a linha 78.
      const house = buildHouse('saffron-dojo', art, {
        roofTopPx: 16,
        facadeTopPx: 52,
        frontPx: 72,
        bodyPx: [0, 96],
        sidePx: 4,
        roof: { kind: 'gable', rise: 0.6, ridgeAt: 0.15, overhang: 0.12 },
        doors: [],
      });
      const { front } = house.userData.measures as { front: number };

      house.add(artBlock(art, {
        x: [40, 72], z: [front - 0.02, front + 0.375], y: [0, 32 / PX], lid: [42, 46], front: [46, 78],
        sides: plain(art.color(44, 70), 0.85),
      }));

      return house;
    },
  },
  {
    // Mansao Pokemon (Cinnabar, 7x4 em (5,0) + o pe da escada); o alto do
    // telhado esta nas 2 ultimas linhas da Rota 21 Sul (mesmo tileset).
    kind: 'pokemon-mansion',
    mold: [
      [0x290, 0x28f, 0x291, 0x28f, 0x291, 0x28f, 0x292],
      [0x298, 0x297, 0x299, 0x297, 0x299, 0x297, 0x29a],
      [0x29b, 0x29c, 0x29d, 0x28b, 0x28c, 0x28d, 0x28e],
      [0x2a3, 0x2a4, 0x2a5, 0x293, 0x294, 0x295, 0x296],
      [null, null, 0x29e, 0x29f, 0x2a6, null, null],
    ],
    outside: (col, row) => row === 4 && (col < 2 || col > 4),
    extension: [
      [0x285, 0x286, 0x286, 0x286, 0x286, 0x286, 0x286],
      [0x288, 0x289, 0x289, 0x289, 0x289, 0x289, 0x28a],
    ],
    build: (art) => {
      // Arte com as 2 linhas da Rota 21: terraco rosa no alto (18-32),
      // agua marrom com as tres aguas-furtadas (32-56), cornija (56-63),
      // fachada de dois andares (63-96) e, no meio (40-72), o alpendre com
      // a sacada xadrez, as colunas, o vao escuro (8,3) e a escada (ate 104).
      const house = buildHouse('pokemon-mansion', art, {
        roofTopPx: 18,
        facadeTopPx: 63,
        frontPx: 96,
        bodyPx: [0, 112],
        sidePx: 5,
        roof: { kind: 'gable', rise: 0.7, ridgeAt: 0.31, overhang: 0.06 },
        chimneys: [
          { x0: 16, y0: 33, x1: 32, y1: 56, frontPx: 44, patchDx: -16 },
          { x0: 48, y0: 33, x1: 64, y1: 56, frontPx: 44, patchDx: 16 },
          { x0: 80, y0: 33, x1: 96, y1: 56, frontPx: 44, patchDx: 16 },
        ],
        doors: [],
      });
      const { front } = house.userData.measures as { front: number };

      house.add(artBlock(art, {
        x: [40, 72], z: [front - 0.02, front + 0.5], y: [0, (104 - 66) / PX], lid: [62, 66], front: [66, 104],
        sides: plain(art.color(42, 92), 0.8),
      }));

      return house;
    },
  },
  {
    // O alto do telhado da Mansao na Rota 21 Sul: sai do mapa.
    kind: 'pokemon-mansion-top',
    mold: [
      [0x285, 0x286, 0x286, 0x286, 0x286, 0x286, 0x286],
      [0x288, 0x289, 0x289, 0x289, 0x289, 0x289, 0x28a],
    ],
    build: () => null,
  },
  {
    // Laboratorio Pokemon de Cinnabar (7x4 em (5,6)).
    kind: 'cinnabar-lab',
    mold: [
      [0x2a0, 0x2bd, 0x2be, 0x2ab, 0x2a1, 0x2a2, 0x2ac],
      [0x2a8, 0x2a9, 0x2aa, 0x2b3, 0x2a9, 0x2aa, 0x2b4],
      [0x2b0, 0x2b1, 0x2b2, 0x2bb, 0x2b1, 0x2b2, 0x2bc],
      [0x2b8, 0x2b9, 0x2ba, 0x2ad, 0x2ae, 0x2af, 0x2b5],
    ],
    build: buildCinnabarLab,
  },
  {
    // Plato Indigo (11x7 em (6,0); o telhado passa da borda de cima).
    kind: 'indigo-plateau',
    mold: [
      [0x2f8, 0x2f9, 0x2f9, 0x2f9, 0x2f9, 0x2f9, 0x2f9, 0x2f9, 0x2f9, 0x2f9, 0x2fa],
      [0x2f8, 0x2f9, 0x2f9, 0x2f9, 0x2f9, 0x2f9, 0x2f9, 0x2f9, 0x2f9, 0x2f9, 0x2fa],
      [0x2f8, 0x2f9, 0x2f9, 0x2f9, 0x2f9, 0x2f9, 0x2f9, 0x2f9, 0x2f9, 0x2f9, 0x2fa],
      [0x300, 0x301, 0x301, 0x301, 0x301, 0x301, 0x301, 0x301, 0x301, 0x301, 0x302],
      [0x308, 0x2f3, 0x309, 0x2f4, 0x30b, 0x30c, 0x30d, 0x2f4, 0x309, 0x2f5, 0x30a],
      [0x310, 0x2fb, 0x311, 0x2fc, 0x313, 0x314, 0x315, 0x2fc, 0x311, 0x2fd, 0x312],
      [0x318, 0x303, 0x307, 0x304, 0x31b, 0x15b, 0x31d, 0x304, 0x307, 0x305, 0x31a],
    ],
    build: buildIndigoPlateau,
  },
  {
    // Portaria da Liga (Rota 22, 9x7 em (4,0)): a frente, com a porta. O
    // telhado continua nas 6 ultimas linhas da Rota 23 (outro tileset): a
    // parte de tras e outro modelo, feito pela Rota 23 (league-gate-back).
    kind: 'league-gate',
    mold: [
      [0x2c0, 0x2c1, 0x2c1, 0x2c1, 0x2c1, 0x2c1, 0x2c1, 0x2c1, 0x2c2],
      [0x2c0, 0x2c1, 0x2c1, 0x2c1, 0x2c1, 0x2c1, 0x2c1, 0x2c1, 0x2c2],
      [0x2c0, 0x2c1, 0x2c1, 0x2c1, 0x2c1, 0x2c1, 0x2c1, 0x2c1, 0x2c2],
      [0x2c8, 0x2c3, 0x2c3, 0x2d4, 0x2d5, 0x2d6, 0x2c3, 0x2c3, 0x2ca],
      [0x2d0, 0x2cb, 0x2cb, 0x2bd, 0x2be, 0x2bf, 0x2cb, 0x2cb, 0x2d2],
      [0x2d8, 0x2d3, 0x2d3, 0x2c5, 0x15b, 0x2c7, 0x2d3, 0x2d3, 0x2da],
      [null, 0x2db, 0x2c4, 0x2cd, 0x2ce, 0x2cf, 0x2c4, 0x2db, null],
    ],
    outside: (col, row) => row === 6 && (col === 0 || col === 8),
    build: buildLeagueGate,
  },
  {
    // O fundo da portaria da Liga, nas 6 ultimas linhas da Rota 23 (9x6 em
    // (4,154)): o resto do telhado e a porta dos fundos.
    kind: 'league-gate-back',
    mold: [
      [0x2f0, 0x2f1, 0x2f1, 0x30f, 0x30f, 0x30f, 0x2f1, 0x2f1, 0x2f2],
      [0x2f8, 0x2f9, 0x2f9, 0x2f9, 0x2f9, 0x2f9, 0x2f9, 0x2f9, 0x2fa],
      [0x2f8, 0x2f9, 0x2f9, 0x2f9, 0x2f9, 0x2f9, 0x2f9, 0x2f9, 0x2fa],
      [0x2f8, 0x2f9, 0x2f9, 0x2f9, 0x2f9, 0x2f9, 0x2f9, 0x2f9, 0x2fa],
      [0x2f8, 0x2f9, 0x2f9, 0x2f9, 0x2f9, 0x2f9, 0x2f9, 0x2f9, 0x2fa],
      [0x2f8, 0x2f9, 0x2f9, 0x2f9, 0x2f9, 0x2f9, 0x2f9, 0x2f9, 0x2fa],
    ],
    build: buildLeagueGateBack,
  },
  {
    // Creche da Rota 5 (5x5 em (21,21)).
    kind: 'day-care',
    mold: [
      [0x2f0, 0x2f1, 0x2f2, 0x2f1, 0x2f3],
      [0x2f8, 0x2f9, 0x2f9, 0x2f9, 0x2fb],
      [0x300, 0x301, 0x301, 0x301, 0x303],
      [0x2f4, 0x2f5, 0x2fe, 0x2f6, 0x2f7],
      [0x2fc, 0x2fd, 0x298, 0x304, 0x2ff],
    ],
    // Telhado laranja (8-44, a agua da esquerda clara e a da direita
    // escura), fachada creme (46-78) com as janelas, a placa e a porta.
    build: (art) =>
      buildHouse('day-care', art, {
        roofTopPx: 8,
        facadeTopPx: 46,
        bodyPx: [0, 80],
        roof: { kind: 'hip', rise: 0.6, inset: 0.35, overhang: 0.1 },
        doors: [{ col: 2, row: 4 }],
      }),
  },
  {
    // Chale do Bill na Rota 25 (5x4 em (49,1)): telhado verde com a
    // chamine cinza (56-72: tampa 0-13, frente 13-30), fachada baixa (46-62).
    kind: 'sea-cottage',
    mold: [
      [0x2c8, 0x2c9, 0x2ca, 0x2cb, 0x2cc],
      [0x2d0, 0x2d1, 0x2d2, 0x2d3, 0x2d4],
      [0x2d8, 0x2d9, 0x2da, 0x2db, 0x2dc],
      [0x2e0, 0x2e1, 0x298, 0x2e3, 0x2e4],
    ],
    build: (art) =>
      buildHouse('sea-cottage', art, {
        roofTopPx: 0,
        facadeTopPx: 46,
        bodyPx: [0, 80],
        sidePx: 20,
        roof: { kind: 'hip', rise: 0.55, inset: 0.45, overhang: 0.1 },
        chimneys: [{ x0: 56, y0: 0, x1: 72, y1: 30, height: 1.3 }],
        doors: [{ col: 2, row: 3 }],
      }),
  },
  {
    // Casa secreta da Zona Safari (Oeste, 6x7 em (10,2)): o mesmo predio da
    // entrada da Safari, com uma linha de palha a menos.
    kind: 'safari-secret-house',
    mold: [
      [0x328, 0x329, 0x32a, 0x32b, 0x32c, 0x32d],
      [0x2bc, 0x2bd, 0x2bd, 0x2bd, 0x2bd, 0x2be],
      [0x2bc, 0x2bd, 0x2bd, 0x2bd, 0x2bd, 0x2be],
      [0x2c0, 0x2c1, 0x2c1, 0x2c1, 0x2c1, 0x2c2],
      [0x2c8, 0x2c9, 0x2ca, 0x2cb, 0x2d6, 0x2cf],
      [0x2d0, 0x2d1, 0x2d2, 0x2d3, 0x2d7, 0x2c3],
      [null, 0x32e, null, 0x32f, null, null],
    ],
    outside: (col, row) => row === 6 && col !== 1 && col !== 3,
    build: (art) => buildSafariHouse('safari-secret-house', art, 8),
  },
  {
    // Usina eletrica (Rota 10, 9x8 em (3,34)); na linha de cima so o alto
    // das quatro chamines (o resto e o penhasco).
    kind: 'power-plant',
    mold: [
      [null, 0x31d, null, 0x31d, null, 0x31d, null, 0x31d, null],
      [0x285, 0x325, 0x286, 0x325, 0x286, 0x325, 0x286, 0x325, 0x287],
      [0x32c, 0x32d, 0x324, 0x32d, 0x324, 0x32d, 0x324, 0x32d, 0x32e],
      [0x295, 0x296, 0x293, 0x296, 0x293, 0x296, 0x293, 0x296, 0x297],
      [0x2d4, 0x2fe, 0x318, 0x319, 0x319, 0x319, 0x31b, 0x2fe, 0x2d5],
      [0x2dc, 0x306, 0x320, 0x321, 0x321, 0x321, 0x323, 0x306, 0x2dd],
      [0x2e4, 0x30e, 0x328, 0x329, 0x31a, 0x32a, 0x32b, 0x30e, 0x2e5],
      [null, null, 0x330, 0x331, 0x322, 0x332, 0x333, null, null],
    ],
    outside: (col, row) => row === 0 || (row === 7 && (col < 2 || col > 6)),
    build: buildPowerPlant,
  },
  {
    // Torre Pokemon (Lavender, 7x7 em (15,0)), com a parte alta desenhada
    // nas 8 ultimas linhas da Rota 10 (mesmo tileset).
    kind: 'pokemon-tower',
    mold: [
      [0x2d1, 0x2d2, 0x2d3, 0x2d3, 0x2d3, 0x2d6, 0x2d7],
      [0x2d9, 0x2d2, 0x2d3, 0x2d3, 0x2d3, 0x2d6, 0x2df],
      [0x2d9, 0x2d2, 0x2d3, 0x2d3, 0x2d3, 0x2d6, 0x2df],
      [0x2e1, 0x2e2, 0x2e3, 0x2e3, 0x2e3, 0x2e6, 0x2e7],
      [0x2e9, 0x2ea, 0x2eb, 0x2eb, 0x2eb, 0x2ee, 0x2ef],
      [0x327, 0x2ff, 0x338, 0x339, 0x33a, 0x2ff, 0x334],
      [0x32f, 0x307, 0x340, 0x30f, 0x342, 0x307, 0x335],
    ],
    extension: [
      [0x010, 0x011, 0x2a5, 0x2a6, 0x2a7, 0x010, 0x011],
      [0x2a9, 0x2aa, 0x2ab, 0x2ac, 0x2ad, 0x2ae, 0x2af],
      [0x2b1, 0x2b2, 0x2b3, 0x2b4, 0x2b5, 0x2b6, 0x2b7],
      [0x2b9, 0x2ba, 0x2bb, 0x2bc, 0x2bd, 0x2be, 0x2bf],
      [0x2c1, 0x2c2, 0x2c3, 0x2c4, 0x2c5, 0x2c6, 0x2c7],
      [0x2c9, 0x2ca, 0x2cb, 0x2cc, 0x2cd, 0x2ce, 0x2cf],
      [0x2b0, 0x2d2, 0x2d3, 0x2d3, 0x2d3, 0x2d6, 0x2b8],
      [0x2c0, 0x2d2, 0x2d3, 0x2d3, 0x2d3, 0x2d6, 0x2c8],
    ],
    build: buildPokemonTower,
  },
  {
    // A cupula e o alto da torre na Rota 10: sai do mapa (o modelo e o da
    // Torre, posto por Lavender).
    kind: 'pokemon-tower-top',
    mold: [
      [null, null, 0x2a5, 0x2a6, 0x2a7, null, null],
      [0x2a9, 0x2aa, 0x2ab, 0x2ac, 0x2ad, 0x2ae, 0x2af],
      [0x2b1, 0x2b2, 0x2b3, 0x2b4, 0x2b5, 0x2b6, 0x2b7],
      [0x2b9, 0x2ba, 0x2bb, 0x2bc, 0x2bd, 0x2be, 0x2bf],
      [0x2c1, 0x2c2, 0x2c3, 0x2c4, 0x2c5, 0x2c6, 0x2c7],
      [0x2c9, 0x2ca, 0x2cb, 0x2cc, 0x2cd, 0x2ce, 0x2cf],
      [0x2b0, 0x2d2, 0x2d3, 0x2d3, 0x2d3, 0x2d6, 0x2b8],
      [0x2c0, 0x2d2, 0x2d3, 0x2d3, 0x2d3, 0x2d6, 0x2c8],
    ],
    outside: (col, row) => row === 0 && (col < 2 || col > 4),
    build: () => null,
  },
];

/** Constroi uma parte com buildHouse num recorte da arte, no lugar dela no bloco. */
function housePart(name: string, art: Art, rect: [number, number, number, number], spec: Parameters<typeof buildHouse>[2]): THREE.Group {
  const [x0, y0, x1, y1] = rect;
  const sub = new (art.constructor as typeof Art)(art.cut(x0, y0, x1 - x0, y1 - y0), x1 - x0, y1 - y0);
  const part = buildHouse(name, sub, spec);

  part.position.set(x0 / PX, 0, y0 / PX);

  return part;
}

/**
 * Museu de Pewter (16x8, origem em (12,0)). Na arte:
 *  - salao (px 0-176): telhado rosa de cima (px 8-50, cumeeira clara no
 *    terco de tras), faixa de janelinhas do clerestorio (50-55), agua de
 *    baixo (55-70) e a fachada de colunas (70-96); pilares brancos nas
 *    pontas: os de fora (0-8, 168-176) descem ate o chao, os de dentro
 *    (8-16, 160-168) so no andar de cima;
 *  - portico da entrada (px 64-112): laje azulada (72-93), frontao com o
 *    emblema e os tres arcos (93-120) e a escada (120-128);
 *  - anexo (px 176-256): telhado rosa (17-62), parede com a porta vermelha
 *    (62-80) e o pilar branco na ponta direita.
 * A regra da dobra amarra tudo: a fachada do salao vai de 0 a 1,625 em
 * z = 6; a agua de baixo sobe 0,15 ate o clerestorio em z = 5,06; o
 * telhado de cima cobre z 2,44-5,06.
 */
function buildPewterMuseum(art: Art): THREE.Group {
  const root = new THREE.Group();
  root.name = 'pewter-museum';

  // Parede do salao atras do portico: continua o padrao das colunas.
  const hall = art.clone().patch(64, 70, 112, 96, 48);
  const wallTop = 26 / PX; // fachada: linhas 70-96
  const lean = 0.15;
  const front = 6;
  const upperFront = 5.0625; // 55 + 26 (px) / 16
  const upperBack = upperFront - 42 / PX; // telhado de cima: linhas 8-50
  const bandTop = wallTop + lean + 5 / PX; // faixa do clerestorio: linhas 50-55
  const rise = 0.5;
  const roofSide = plain(hall.color(40, 60), 0.75);

  // Corpo do salao (sem tampa) e a agua de baixo, de uma agua so.
  root.add(artBlock(hall, { x: [1, 175], z: [upperBack, front], y: [0, wallTop], front: [70, 96] }));
  root.add(artRoof(hall, {
    px: [8, 168], rows: [55, 70], kind: 'gable', ridgeAt: 0, rise: lean, y: wallTop,
    bounds: { x0: 8 / PX, x1: 168 / PX, z0: upperFront, z1: front + 0.06 }, gableMaterial: roofSide,
  }));

  // Clerestorio e o telhado de cima.
  root.add(artBlock(hall, { x: [16, 160], z: [upperBack, upperFront], y: [wallTop + lean, bandTop], front: [50, 55] }));
  root.add(artRoof(hall, {
    px: [16, 160], rows: [8, 50], kind: 'gable', ridgeAt: 0.38, rise, y: bandTop,
    bounds: { x0: 16 / PX, x1: 160 / PX, z0: upperBack - 0.04, z1: upperFront + 0.06 }, gableMaterial: roofSide,
  }));

  // Pilares brancos de dentro (oitoes do andar de cima) e os de fora (do chao).
  const innerTop = bandTop + rise + 0.04;

  for (const x of [[8, 16], [160, 168]] as Array<[number, number]>) {
    root.add(artBlock(hall, { x, z: [upperBack - 0.04, upperFront + 0.02], y: [wallTop + lean, innerTop], lid: [9, 48], front: [48, 55] }));
  }

  const outerTop = bandTop + 0.12;
  const outerFrontRow = Math.round(96 - outerTop * PX);

  for (const x of [[0, 8], [168, 176]] as Array<[number, number]>) {
    root.add(artBlock(hall, { x, z: [upperBack - 0.04, front + 0.06], y: [0, outerTop], lid: [9, outerFrontRow], front: [outerFrontRow, 96] }));
  }

  // Portico: laje, frontao e arcos; a escada na frente.
  root.add(artBlock(art, { x: [64, 112], z: [front, 7.5], y: [0, 27 / PX], lid: [72, 93], front: [93, 120] }));
  root.add(artBlock(art, { x: [64, 112], z: [7.5, 8], y: [0, 0.08], lid: [120, 128], sides: plain(art.color(66, 124), 0.8) }));

  // Anexo com a porta vermelha (25,4) e o pilar da ponta.
  const annex = housePart('pewter-museum-annex', art, [176, 16, 256, 80], {
    roofTopPx: 1,
    facadeTopPx: 46,
    roof: { kind: 'gable', rise: 0.45, ridgeAt: 0.33, overhang: 0.06 },
    doors: [{ col: 2, row: 3 }],
  });
  const measures = annex.userData.measures as { front: number; back: number; wallHeight: number };

  root.add(annex);
  root.add(artBlock(art, {
    x: [249, 256], z: [1 + measures.back - 0.06, 1 + measures.front + 0.04], y: [0, measures.wallHeight + 0.5],
    lid: [17, 61], front: [61, 80],
  }));

  return root;
}

/**
 * Loja de bicicletas de Cerulean (4x6, origem em (12,23)): laje com a
 * claraboia azul quadriculada e a moldura cinza clara (px 8-56), parede
 * cinza com tres janelas (56-72) e o toldo listrado (tampa 72-81, frente
 * 81-87) sobre a entrada escura, apoiado em dois postes azuis (87-96).
 * A entrada e aberta (sem porta animada): o jogador passa debaixo do
 * toldo. Pela dobra, a parede fica em z = 5,5 com 2 de altura e o toldo
 * vai dela ate os postes, na borda do bloco (z = 6), a 0,6-1,0 do chao.
 */
function buildBikeShop(art: Art): THREE.Group {
  const root = new THREE.Group();
  root.name = 'bike-shop';

  const wallFront = 5.5;
  const wallTop = wallFront - 56 / PX;
  // Atras do toldo: a entrada escura (o vao debaixo dele), ate o chao. Na
  // arte, o escuro do vao esta na camada de baixo das portas, que sai com o
  // chao (as portas sao andaveis): pinta com o escuro da moldura das
  // janelas (px 20, 70), senao a frente ficava vazada e a loja parecia uma
  // mesa sobre os postes.
  const facade = art.clone().fill(3, 72, 61, 88, 20, 70);

  root.add(artBlock(facade, { x: [0, 64], z: [wallFront - 48 / PX, wallFront], y: [0, wallTop], front: [56, 88] }));
  root.add(artRoof(art, {
    px: [0, 64], rows: [8, 56], kind: 'flat', rise: 0, y: wallTop + 0.002,
    bounds: { x0: 0, x1: 4, z0: wallFront - 48 / PX, z1: wallFront },
  }));

  // Moldura da claraboia: uma borda baixa em volta.
  const rim = plain(art.color(2, 30), 0.95);
  const z0 = wallFront - 48 / PX;
  const t = 0.12;

  for (const [x0, x1, za, zb] of [[0, 4, z0, z0 + t], [0, 4, wallFront - t, wallFront], [0, t, z0, wallFront], [4 - t, 4, z0, wallFront]]) {
    root.add(new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, 0.06, zb - za), rim).translateX((x0 + x1) / 2).translateY(wallTop + 0.03).translateZ((za + zb) / 2));
  }

  // Toldo: tampa listrada clara e a frente escura; os postes azuis.
  const postTop = 6 - 86 / PX;
  const awningSide = plain(art.color(30, 83), 0.8);

  root.add(artBlock(art, { x: [3, 61], z: [wallFront, 6.02], y: [postTop, postTop + 6 / PX], lid: [72, 81], front: [81, 87], sides: awningSide }));

  const post = plain(art.color(6, 90), 1);

  for (const x of [5, 56]) {
    root.add(artBlock(art, { x: [x, x + 3], z: [5.86, 5.98], y: [0, postTop], sides: post }));
  }

  return root;
}

/** Metatiles que a arte das extensoes usa (pedidos junto com os do mapa). */
export function landmarkExtraMetatiles(): number[] {
  const ids = new Set<number>();

  for (const landmark of LANDMARKS) {
    for (const row of landmark.extension ?? []) {
      for (const id of row) {
        ids.add(id);
      }
    }
  }

  return [...ids];
}

/**
 * Torre Pokemon. Arte de 7x15 tiles: as 8 linhas de cima vem da Rota 10
 * (cupula), as 7 de baixo de Lavender (fuste e base). Em tiles, z = 0 e a
 * linha de cima da arte; pela regra da dobra (linha da arte = z - y):
 *  - base (px 0-112): frente em z = 15 com 1,875 de altura (linhas
 *    210-240, com a entrada escura), laje cinza-azulada de z 9,875 a 15;
 *  - fuste octogonal (px 8-104; face da frente 26-86, chanfros de 18 px):
 *    frente em z = 14,25, de 1,875 a 8,875 (linhas 86-198, as colunas
 *    de janelas), fundo em z = 9,875;
 *  - cupula: meia elipsoide de raio 2,19 (35 px) e 2,44 de altura no
 *    centro do topo (x 3,5; z 12,06), com o mastro ate a linha 0.
 * As faces de pe usam a arte como fachada (linha = z da frente - y) e a
 * cupula e o topo usam a dobra direta (linha = z - y), espelhando a
 * metade de tras na da frente.
 */
function buildPokemonTower(art: Art): THREE.Group {
  const root = new THREE.Group();
  root.name = 'pokemon-tower';

  const W = art.width;
  const H = art.height;
  const texture = art.texture(0, 0, W, H);
  const uvOf = (xPx: number, rowPx: number): [number, number] => [xPx / W, 1 - rowPx / H];
  const material = textured(texture, 1, true);
  const shaded = textured(texture, 0.8, true);

  // Base: caixa com a frente e a laje da arte.
  const baseTop = 30 / PX;
  const baseFront = 15;
  const baseBack = 9.875;
  const baseSide = textured(stripe(art, 3, 210, 240), 0.75);

  root.add(artBlock(art, { x: [0, 112], z: [baseBack, baseFront], y: [0, baseTop], front: [210, 240], lid: [128, 210], sides: baseSide }));

  // Fuste octogonal: pontos (px, z) da planta, da frente para tras.
  const shaftBottom = baseTop;
  const shaftTop = 8.875;
  const front = 14.25;
  const back = baseBack;
  const chamfer = 18 / PX;
  const backChamfer = 8 / PX;
  const facade = (x0: number, z0: number, x1: number, z1: number, shade: THREE.Material): THREE.Mesh =>
    polygons([{
      points: [[x0 / PX, shaftBottom, z0], [x1 / PX, shaftBottom, z1], [x1 / PX, shaftTop, z1], [x0 / PX, shaftTop, z0]],
      // Fachada: a linha da arte vem da altura, com o z da face da frente.
      uv: [uvOf(x0, (front - shaftBottom) * PX), uvOf(x1, (front - shaftBottom) * PX), uvOf(x1, (front - shaftTop) * PX), uvOf(x0, (front - shaftTop) * PX)],
    }], shade);

  root.add(facade(26, front, 86, front, material));
  root.add(facade(8, front - chamfer, 26, front, shaded));
  root.add(facade(86, front, 104, front - chamfer, shaded));

  const sideColor = plain(art.color(9, 150), 0.7);
  const backColor = plain(art.color(56, 120), 0.55);
  const plainWall = (x0: number, z0: number, x1: number, z1: number, m: THREE.Material): THREE.Mesh =>
    polygons([{ points: [[x0 / PX, shaftBottom, z0], [x1 / PX, shaftBottom, z1], [x1 / PX, shaftTop, z1], [x0 / PX, shaftTop, z0]], uv: [[0, 0], [1, 0], [1, 1], [0, 1]] }], m);

  root.add(plainWall(8, back + backChamfer, 8, front - chamfer, sideColor));
  root.add(plainWall(104, front - chamfer, 104, back + backChamfer, sideColor));
  root.add(plainWall(16, back, 8, back + backChamfer, backColor));
  root.add(plainWall(96, back, 16, back, backColor));
  root.add(plainWall(104, back + backChamfer, 96, back, backColor));

  // Topo do fuste (o anel em volta da cupula), pela dobra.
  const top: Array<[number, number]> = [
    [26, front], [86, front], [104, front - chamfer], [104, back + backChamfer], [96, back], [16, back], [8, back + backChamfer], [8, front - chamfer],
  ];

  root.add(polygons([{
    points: top.map(([x, z]) => [x / PX, shaftTop, z] as [number, number, number]),
    uv: top.map(([x, z]) => uvOf(x, (z - shaftTop) * PX)),
  }], material));

  // Cupula: meia elipsoide com a dobra direta (a metade de tras espelha a
  // da frente) e o mastro.
  const cx = 56 / PX;
  const cz = (front + back) / 2;
  const radius = 35 / PX;
  const domeHeight = 2.44;
  const profile: THREE.Vector2[] = [];

  for (let i = 0; i <= 16; i++) {
    const t = (i / 16) * (Math.PI / 2);

    profile.push(new THREE.Vector2(Math.max(0.001, radius * Math.cos(t)), domeHeight * Math.sin(t)));
  }

  const dome = new THREE.LatheGeometry(profile, 40);

  dome.translate(cx, shaftTop, cz);

  const position = dome.attributes.position;
  const uv = dome.attributes.uv;

  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i);
    const y = position.getY(i);
    const z = position.getZ(i);
    const zz = z >= cz ? z : 2 * cz - z;
    const [u, v] = uvOf(x * PX, (zz - y) * PX);

    uv.setXY(i, u, v);
  }

  uv.needsUpdate = true;
  root.add(new THREE.Mesh(dome, material));

  const mastTop = cz; // linha 0 da arte: z - y = 0
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, mastTop - (shaftTop + domeHeight) + 0.1, 8), plain(art.color(56, 10), 1));

  mast.position.set(cx, (shaftTop + domeHeight - 0.1 + mastTop) / 2, cz);
  root.add(mast);

  return root;
}

/**
 * Loja de departamentos de Celadon (9x10). Na arte (px do bloco):
 *  - telhado cinza (0-62) com as grelhas dos lados, a borda clara e, no
 *    meio (32-112), o terraco: tampa com o deque bege e a grade (0-44) e a
 *    frente com as janelas azuis (44-54);
 *  - fachada (62-160): cornija clara e lilas, tres torres de vidro com as
 *    lajes amarelas (11-29, 51-93, 115-133), as colunas das placas e as
 *    duas portas de correr (cols 2 e 6) com toldo listrado (136-148).
 * Dobra: fachada de 6,125 em z = 10, telhado de z 6,125 a 10; o terraco
 * fica de z 6,75 a 9,5, com 0,625 de altura.
 */
function buildDeptStore(art: Art): THREE.Group {
  const root = new THREE.Group();
  root.name = 'celadon-dept-store';

  const front = 10;
  const wallTop = 98 / PX; // fachada: linhas 62-160
  const back = front - 62 / PX;
  const entrance = new THREE.Group();

  entrance.name = 'entrance';
  root.add(entrance);
  root.userData.entrance = entrance;

  root.add(artBlock(art, { x: [1, 143], z: [back, front], y: [0, wallTop], front: [62, 160] }));
  root.add(artRoof(art, {
    px: [1, 143], rows: [0, 62], kind: 'flat', rise: 0, y: wallTop + 0.002,
    bounds: { x0: 1 / PX, x1: 143 / PX, z0: back, z1: front },
  }));

  // Borda clara do telhado.
  const rim = plain(art.color(3, 30), 0.95);
  const t = 0.1;

  const edges: Array<[number, number, number, number]> = [
    [1, 143, back, back + t],
    [1, 143, front - t, front],
    [1, 1 + t * PX, back, front],
    [143 - t * PX, 143, back, front],
  ];

  for (const [x0, x1, z0, z1] of edges) {
    root.add(artBlock(art, { x: [x0, x1], z: [z0, z1], y: [wallTop, wallTop + 0.08], sides: rim }));
  }

  // Terraco no meio do telhado: tampa (linhas 0-44) a 0,625 do telhado.
  const deckTop = wallTop + 10 / PX;

  root.add(artBlock(art, { x: [32, 112], z: [deckTop, deckTop + 44 / PX], y: [wallTop, deckTop], lid: [0, 44], front: [44, 54] }));

  // Torres de vidro: saem 0,375 da fachada, com a laje amarela de tampa.
  const bayHeight = (160 - 78) / PX;

  for (const [x0, x1] of [[11, 29], [51, 93], [115, 133]] as Array<[number, number]>) {
    root.add(artBlock(art, {
      x: [x0, x1], z: [front - 0.02, front + 0.375], y: [0, bayHeight], lid: [72, 78], front: [78, 160],
      sides: textured(stripe(art, x1 - 2, 78, 160), 0.7),
    }));
  }

  // Portas de correr com o toldo listrado em cima.
  for (const col of [2, 6]) {
    const x0 = col * PX;

    root.add(artBlock(art, {
      x: [x0, x0 + PX], z: [front, front + 0.375], y: [1.1, 1.475], lid: [136, 142], front: [142, 148],
      sides: plain(art.color(x0 + 4, 140), 0.8),
    }));
    entrance.add(doorPlane(art, x0, 144, col + 0.5, front + 0.004));
  }

  return root;
}

/**
 * Condominios de Celadon (7x8). Na arte: atras do telhado, a marquise e a
 * luz da porta dos fundos (px 34-78, linhas 0-8); laje verde-oliva
 * quadriculada (8-58) com a caixa escura do respiro (81-103: tampa 8-24,
 * frente 24-31); fachada verde de 4 andares (59-128) com a porta (30,11).
 */
function buildCondominiums(art: Art): THREE.Group {
  const house = buildHouse('celadon-condominiums', art, {
    roofTopPx: 8,
    facadeTopPx: 59,
    bodyPx: [0, 112],
    sidePx: 4,
    roof: { kind: 'flat', rise: 0, overhang: 0.02, parapet: 0.1 },
    chimneys: [{ x0: 81, y0: 8, x1: 103, y1: 31, frontPx: 24, patchDx: 40 }],
    doors: [{ col: 3, row: 7 }],
  });
  const { back } = house.userData.measures as { back: number };

  // Porta dos fundos: marquise clara e a abertura iluminada, viradas para o norte.
  house.add(artBlock(art, {
    x: [34, 78], z: [back - 0.45, back], y: [1.05, 1.17], lid: [4, 8], sides: plain(art.color(36, 2), 0.85),
  }));
  house.add(wall(72 / PX, back - 0.004, 40 / PX, back - 0.004, 0, 1.05, plain(art.color(56, 2), 1)));

  return house;
}

/**
 * Mureta ameiada atras da laje (linhas 2-8 da arte, em pe no fundo): as
 * frestas sao a grama, que sai com o chao e vira buraco.
 */
function crenellations(art: Art, house: THREE.Group, widthPx: number): THREE.Mesh {
  const { back, wallHeight } = house.userData.measures as { back: number; wallHeight: number };

  return artBlock(art, {
    x: [0, widthPx], z: [back, back + 0.08], y: [wallHeight, wallHeight + 6 / PX], front: [2, 8],
    sides: plain(art.color(Math.min(widthPx - 1, 100), 7), 0.8),
  });
}

/** Coordenadas de textura pela regra da dobra: linha da arte = rowOf(x, y, z) (px). */
function artUv(geometry: THREE.BufferGeometry, art: Art, rowOf: (x: number, y: number, z: number) => number): void {
  const position = geometry.attributes.position;
  const uv = new Float32Array(position.count * 2);

  for (let i = 0; i < position.count; i++) {
    uv[i * 2] = (position.getX(i) * PX) / art.width;
    uv[i * 2 + 1] = 1 - rowOf(position.getX(i), position.getY(i), position.getZ(i)) / art.height;
  }

  geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
}

/**
 * Cassino de Celadon (7x5, + a ponta das colunas). Na arte: mureta ameiada
 * (2-8), laje creme com as claraboias e o chanfro da frente (8-56),
 * fachada de tijolo laranja com os losangos (56-80, 1,5 de altura em
 * z = 5); a entrada e uma abobada roxa com estrelas e o leque amarelo
 * (x 39-73) sobre duas colunas brancas (40-48 e 64-72, linhas 68-86):
 * pela dobra, colunas de 1,125 com a frente em z = 5,375 e a abobada de
 * raio 1,0625 com o eixo na altura delas, de z 5 a 5,375.
 */
function buildGameCorner(art: Art): THREE.Group {
  // Atras da abobada: a laje e a parede continuam o padrao do lado.
  const body = art.clone().patch(38, 40, 74, 56, 38).patch(38, 56, 48, 80, 16).patch(64, 56, 74, 80, -16);
  const house = buildHouse('celadon-game-corner', body, {
    roofTopPx: 8,
    facadeTopPx: 56,
    bodyPx: [0, 112],
    roof: { kind: 'flat', rise: 0, overhang: 0.02 },
    doors: [{ col: 3, row: 4 }],
  });
  const { front } = house.userData.measures as { front: number };

  house.add(crenellations(art, house, 112));

  const vaultFront = 86 / PX;
  const spring = (86 - 68) / PX;
  const radius = 17 / PX;
  const cx = 56 / PX;
  const material = textured(art.texture(0, 0, art.width, art.height), 1, true);

  // Frente da abobada: meio disco (o leque e as estrelas).
  const shape = new THREE.Shape();

  shape.moveTo(cx + radius, spring);
  shape.absarc(cx, spring, radius, 0, Math.PI, false);
  shape.lineTo(cx + radius, spring);

  const face = new THREE.ShapeGeometry(shape, 16);

  face.translate(0, 0, vaultFront);
  artUv(face, art, (_x, y) => (vaultFront - y) * PX);
  house.add(new THREE.Mesh(face, material));

  // Casca curva, de z = frente da casa ate a frente da abobada.
  const shell = new THREE.CylinderGeometry(radius, radius, vaultFront - front, 16, 1, true, -Math.PI / 2, Math.PI);

  shell.rotateX(Math.PI / 2);
  shell.translate(cx, spring, (front + vaultFront) / 2);
  artUv(shell, art, (_x, y, z) => (z - y) * PX);
  house.add(new THREE.Mesh(shell, material));

  // Colunas brancas.
  const columnSide = plain(art.color(44, 76), 0.85);

  for (const x0 of [40, 64]) {
    house.add(artBlock(art, { x: [x0, x0 + 8], z: [vaultFront - 0.3, vaultFront], y: [0, spring], front: [68, 86], sides: columnSide }));
  }

  return house;
}

/**
 * Silph Co. (9x15). Na arte (px do bloco):
 *  - telhado (8-82): as duas metades lilases com nervuras e borda clara e,
 *    no meio (48-96), a abobada de vidro: tampa de tras (2-8), corpo
 *    (8-66) e a frente (66-80, o arco branco e a boca escura);
 *  - fachada (82-232): nove andares de vidro com as lajes, as colunas
 *    brancas dos cantos e as luminarias amarelas embaixo;
 *  - entrada (48-96): bloco saliente com o painel das luzes, a verga
 *    escura e as portas de vidro (193-238), porta (33,30).
 * Dobra: fachada de 9,375 em z = 14,5; telhado de z 9,875 a 14,5; a
 * abobada (corda de 3, flecha de 0,875) vai de z 10,375 a 14,375.
 */
function buildSilphCo(art: Art): THREE.Group {
  const root = new THREE.Group();
  root.name = 'silph-co';

  const front = 232 / PX;
  const wallTop = (232 - 82) / PX;
  const back = front - (82 - 8) / PX;
  const entrance = new THREE.Group();

  entrance.name = 'entrance';
  root.add(entrance);

  root.add(artBlock(art, { x: [0, 144], z: [back, front], y: [0, wallTop], front: [82, 232] }));
  root.add(artRoof(art, {
    px: [0, 144], rows: [8, 82], kind: 'flat', rise: 0, y: wallTop + 0.002,
    bounds: { x0: 0, x1: 9, z0: back, z1: front },
  }));

  // Borda clara em volta das metades lilases.
  const rim = plain(art.color(2, 20), 0.95);
  const t = 0.1;
  const edges: Array<[number, number, number, number]> = [
    [0, 144, back, back + t],
    [0, 144, front - t, front],
    [0, t * PX, back, front],
    [144 - t * PX, 144, back, front],
  ];

  for (const [x0, x1, z0, z1] of edges) {
    root.add(artBlock(art, { x: [x0, x1], z: [z0, z1], y: [wallTop, wallTop + 0.08], sides: rim }));
  }

  // Abobada de vidro: segmento de cilindro ao longo de z.
  const chord = 48 / PX;
  const rise = 14 / PX;
  const radius = (chord * chord / 4 + rise * rise) / (2 * rise);
  const half = Math.asin(chord / 2 / radius);
  const axisY = wallTop + rise - radius;
  const cx = 72 / PX;
  const vaultFront = 80 / PX + wallTop;
  const vaultBack = 2 / PX + wallTop + rise;
  const glass = textured(art.texture(0, 0, art.width, art.height), 1, true);
  const shell = new THREE.CylinderGeometry(radius, radius, vaultFront - vaultBack, 18, 1, true, -half, 2 * half);

  shell.rotateX(Math.PI / 2);
  shell.translate(cx, axisY, (vaultFront + vaultBack) / 2);
  artUv(shell, art, (_x, y, z) => (z - y) * PX);
  root.add(new THREE.Mesh(shell, glass));

  const cap = new THREE.Shape();

  cap.moveTo(cx - chord / 2, wallTop);
  cap.lineTo(cx + chord / 2, wallTop);
  cap.absarc(cx, axisY, radius, Math.PI / 2 - half, Math.PI / 2 + half, false);
  cap.lineTo(cx - chord / 2, wallTop);

  const face = new THREE.ShapeGeometry(cap, 12);

  face.translate(0, 0, vaultFront);
  artUv(face, art, (_x, y) => (vaultFront - y) * PX);
  root.add(new THREE.Mesh(face, glass));

  // Entrada saliente, com as portas de vidro (porta de correr na col 4).
  const vestibule = front + 0.375;

  root.add(artBlock(art, {
    x: [48, 96], z: [front - 0.02, vestibule], y: [0, (238 - 193) / PX], lid: [189, 193], front: [193, 238],
    sides: plain(art.color(50, 212), 0.85),
  }));
  entrance.add(doorPlane(art, 64, 224, 4.5, vestibule + 0.004));

  return root;
}

/**
 * Laboratorio de Cinnabar (7x4): um pavilhao em forma de capsula deitada
 * (meio cilindro ao longo de x com as pontas arredondadas, os "C" brancos
 * da arte), com as nervuras creme e, no meio (48-64), a faixa laranja e a
 * porta de vidro (8,9). Na arte o corpo vai da linha 2 a 62: pela dobra,
 * um cilindro de raio R aparece com 2,414 R de altura, entao R = 1,55, com
 * o eixo no chao em z = 2,32. A superficie e mapeada pela dobra (linha =
 * z - y), espelhando a metade de tras.
 */
function buildCinnabarLab(art: Art): THREE.Group {
  const root = new THREE.Group();
  root.name = 'cinnabar-lab';

  const front = 62 / PX;
  const radius = (60 / PX) / (1 + Math.SQRT2);
  const cz = front - radius;
  const length = art.width / PX;
  const skin = art.clone().bleed();
  const material = textured(skin.texture(0, 0, skin.width, skin.height), 1, true);
  const capsule = new THREE.CapsuleGeometry(radius, length - 2 * radius, 10, 32);

  capsule.rotateZ(Math.PI / 2);
  capsule.translate(length / 2, 0, cz);

  // So a metade de cima: a de baixo fica achatada logo abaixo do chao.
  const position = capsule.attributes.position;

  for (let i = 0; i < position.count; i++) {
    position.setY(i, Math.max(-0.02, position.getY(i)));
  }
  artUv(capsule, skin, (_x, y, z) => ((z >= cz ? z : 2 * cz - z) - Math.max(0, y)) * PX);
  root.add(new THREE.Mesh(capsule, material));

  // Entrada: o vao da porta de vidro na base da capsula.
  const entrance = new THREE.Group();

  entrance.name = 'entrance';
  root.add(entrance);
  root.add(artBlock(art, {
    x: [48, 64], z: [front - 0.5, front + 0.02], y: [0, 1], lid: [40, 46], front: [46, 62],
    sides: plain(art.color(50, 44), 0.8),
  }));
  entrance.add(doorPlane(art, 48, 46, 3.5, front + 0.024));

  return root;
}

/**
 * Plato Indigo (11x7). Na arte: telhado verde-claro de nervuras (0-64,
 * corta na borda do mapa), fachada laranja de ripas com as janelas (65-104),
 * quatro ciprestes na frente dela (cols 1, 3, 7 e 9, linhas 76-110) e, no
 * meio (64-112), o pavilhao branco da entrada: frontao (66-96), paredes e a
 * porta dupla (96-112, porta (11,6)).
 */
function buildIndigoPlateau(art: Art): THREE.Group {
  // A parede atras do pavilhao fica lisa e atras dos ciprestes continua o
  // padrao da coluna do lado.
  const body = art.clone().fill(64, 66, 112, 104, 40, 70);

  for (const [col, from] of [[1, 2], [3, 2], [7, 8], [9, 8]]) {
    body.patch(col * PX, 66, col * PX + PX, 104, (col - from) * PX);
  }

  const house = buildHouse('indigo-plateau', body, {
    roofTopPx: 0,
    facadeTopPx: 65,
    frontPx: 104,
    bodyPx: [0, 176],
    sidePx: 40,
    roof: { kind: 'gable', rise: 0.8, ridgeAt: 0.25, overhang: 0.08 },
    doors: [],
  });
  const { front } = house.userData.measures as { front: number };

  // Pavilhao: a frente e um frontao pontudo (o pentagono da arte, de pe:
  // paredes ate a linha 96 e a ponta na 66, a 2,875 do chao) e, atras
  // dele, as duas aguas brancas ate a fachada.
  const pavilionFront = 112 / PX;
  const pavilionBack = front - 0.4;
  const eave = (112 - 96) / PX;
  const apex = (112 - 66) / PX;
  const white = plain(art.color(80, 72), 0.9);
  const slope = plain(art.color(80, 72), 0.72);

  house.add(artBlock(art, { x: [64, 112], z: [pavilionBack, pavilionFront - 0.01], y: [0, eave], sides: white }));

  const gable = new THREE.Shape();

  gable.moveTo(64 / PX, 0);
  gable.lineTo(112 / PX, 0);
  gable.lineTo(112 / PX, eave);
  gable.lineTo(88 / PX, apex);
  gable.lineTo(64 / PX, eave);
  gable.lineTo(64 / PX, 0);

  const face = new THREE.ShapeGeometry(gable);

  face.translate(0, 0, pavilionFront);
  artUv(face, art, (_x, y) => (pavilionFront - y) * PX);
  house.add(new THREE.Mesh(face, textured(art.texture(0, 0, art.width, art.height), 1)));

  for (const [xa, xb] of [[64, 88], [112, 88]]) {
    house.add(polygons([{
      points: [[xa / PX, eave, pavilionFront], [xb / PX, apex, pavilionFront], [xb / PX, apex, pavilionBack], [xa / PX, eave, pavilionBack]],
      uv: [[0, 0], [1, 0], [1, 1], [0, 1]],
    }], xa < xb ? slope : white));
  }

  const entrance = new THREE.Group();

  entrance.name = 'entrance';
  house.add(entrance);
  entrance.add(doorPlane(art, 80, 96, 5.5, pavilionFront + 0.004));

  // Ciprestes: recortes em pe na frente da fachada.
  const trees = art.clone();

  trees.keepOnly(0, 0, trees.width, trees.height, new Set([0x84d663, 0xbdff8c, 0x395a10, 0x399431, 0x736363, 0x423931]));

  for (const col of [1, 3, 7, 9]) {
    const x0 = col * PX;
    const z = front + 0.375;

    house.add(wall(x0 / PX, z, (x0 + PX) / PX, z, 0, 34 / PX, textured(trees.texture(x0, 76, PX, 34), 1, true)));
  }

  return house;
}

/**
 * Portaria da Liga. O telhado de nervuras tem 153 px de arte (96 na Rota 23
 * e 57 na Rota 22) e a fachada 39 (2,4375 de altura em z = 6 da Rota 22):
 * pela dobra o predio vai de z -3,5625 a 6 da Rota 22, com uma agua so
 * subindo 0,6 para tras. Cada mapa faz a sua parte, que se encontram em
 * z = 2,4375 da Rota 22 (a 0,22 de altura a mais que o beiral).
 */
const LEAGUE_WALL = 39 / PX;
const LEAGUE_DEPTH = 153 / PX;
const LEAGUE_RISE = 0.6;
const leagueRoofAt = (zFromFront: number): number => LEAGUE_WALL + (LEAGUE_RISE * zFromFront) / LEAGUE_DEPTH;
const LEAGUE_ORANGE = new THREE.Color().setRGB(0xb5 / 255, 0x63 / 255, 0, THREE.SRGBColorSpace);

/**
 * Frente da portaria da Liga (Rota 22). Na arte: telhado (0-57), fachada de
 * ripas laranja com as janelas (57-96), quatro ciprestes na frente (cols 1,
 * 2, 6 e 7, linhas 70-102), a marquise amarela em meia-lua (54-90, linhas
 * 58-78) sobre os postes (ate a linha 104), a porta (8,5) e o piso claro do
 * alpendre (96-110). Pela dobra, a marquise desce da parede (z = 6, a
 * 2,375) ate os postes (z = 6,5, a 1,625).
 */
function buildLeagueGate(art: Art): THREE.Group {
  const root = new THREE.Group();
  root.name = 'league-gate';

  const front = 6;
  const back = front - 57 / PX;
  const facade = art.clone().fill(16, 70, 48, 96, 4, 70).fill(96, 70, 128, 96, 4, 70);
  const sides = textured(stripe(facade, 4, 57, 96), 0.75);

  root.add(artBlock(facade, { x: [0, 144], z: [back, front], y: [0, LEAGUE_WALL], front: [57, 96], sides }));
  root.add(artRoof(art, {
    px: [0, 144], rows: [0, 57], kind: 'gable', ridgeAt: 0, rise: leagueRoofAt(front - back) - LEAGUE_WALL, y: LEAGUE_WALL,
    bounds: { x0: -0.04, x1: 9.04, z0: back, z1: front + 0.08 }, gableMaterial: plain(LEAGUE_ORANGE, 0.7),
  }));

  // Marquise em meia-lua: leque da parede ate a borda da frente, mapeado
  // pela dobra (linha = z - y).
  const cx = 72 / PX;
  const radius = 18 / PX;
  const topY = front - 58 / PX;
  const edgeY = 6.5 - 78 / PX;
  const segments = 16;
  const positions: number[] = [];
  const indices: number[] = [];

  positions.push(cx, topY, front);

  for (let i = 0; i <= segments; i++) {
    const t = (i / segments) * Math.PI;

    positions.push(cx + radius * Math.cos(t), edgeY, front + 0.5 * Math.sin(t));
    positions.push(cx + radius * Math.cos(t), topY, front);
  }

  for (let i = 0; i < segments; i++) {
    const a = 1 + i * 2;
    const b = a + 2;

    indices.push(0, b, a);
    indices.push(a, b, b + 1, a, b + 1, a + 1);
  }

  const canopy = new THREE.BufferGeometry();

  canopy.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  canopy.setIndex(indices);
  artUv(canopy, art, (_x, y, z) => (z - y) * PX);
  root.add(new THREE.Mesh(canopy, textured(art.texture(0, 0, art.width, art.height), 1, true)));

  const post = plain(art.color(56, 90), 0.9);

  for (const x0 of [54, 85]) {
    root.add(artBlock(art, { x: [x0, x0 + 4], z: [6.4, 6.5], y: [0, edgeY], sides: post }));
  }

  // Piso do alpendre e a porta.
  root.add(artBlock(art, { x: [48, 96], z: [front, 110 / PX], y: [0, 0.06], lid: [96, 110], sides: plain(art.color(72, 104), 0.8) }));

  const entrance = new THREE.Group();

  entrance.name = 'entrance';
  root.add(entrance);
  entrance.add(doorPlane(art, 64, 80, 4.5, front + 0.004));

  // Ciprestes.
  const trees = art.clone();

  trees.keepOnly(0, 0, trees.width, trees.height, new Set([0x84d663, 0xbdff8c, 0x395a10, 0x399431, 0x736363, 0x423931]));

  for (const col of [1, 2, 6, 7]) {
    root.add(wall(col, 102 / PX, col + 1, 102 / PX, 0, 2, textured(trees.texture(col * PX, 70, PX, 32), 1, true)));
  }

  return root;
}

/**
 * Fundo da portaria da Liga (Rota 23): o resto do telhado (linhas 0-96 do
 * bloco) e o corpo, de z 2,4375 a 8,4375 do bloco (passa da borda de baixo
 * da Rota 23 e encontra a frente feita pela Rota 22); a porta dos fundos
 * (8,153) e uma abertura escura com a marquise na parede de tras.
 */
function buildLeagueGateBack(art: Art): THREE.Group {
  const root = new THREE.Group();
  root.name = 'league-gate-back';

  const front = 96 / PX + LEAGUE_WALL;
  const back = LEAGUE_WALL;
  const frontY = leagueRoofAt(57 / PX);
  const orange = plain(LEAGUE_ORANGE, 0.72);

  root.add(artBlock(art, { x: [0, 144], z: [back, front], y: [0, frontY], sides: orange }));
  root.add(artRoof(art, {
    px: [0, 144], rows: [0, 96], kind: 'gable', ridgeAt: 0, rise: leagueRoofAt(LEAGUE_DEPTH) - frontY, y: frontY,
    bounds: { x0: -0.04, x1: 9.04, z0: back - 0.06, z1: front }, gableMaterial: orange,
  }));

  // Porta dos fundos, virada para o norte.
  root.add(wall(88 / PX, back - 0.004, 56 / PX, back - 0.004, 0, 1, plain(new THREE.Color(0x404858), 1)));
  root.add(artBlock(art, { x: [52, 92], z: [back - 0.4, back], y: [1, 1.1], sides: plain(art.color(4, 3), 0.95) }));

  return root;
}

/**
 * Predio de palha da Safari (a entrada em Fuchsia e a casa secreta): palha
 * (roofTopPx-65) com a beirada escura; parede de ripas (65-96) com as
 * janelas e a cerca viva embaixo; porta de correr (col 2, linha 5) num
 * portal branco: postes 24-28 e 51-55 ate a linha 98, viga 72-80.
 */
function buildSafariHouse(name: string, art: Art, roofTopPx: number): THREE.Group {
  const house = buildHouse(name, art, {
    roofTopPx,
    facadeTopPx: 65,
    bodyPx: [0, 96],
    sidePx: 3,
    roof: { kind: 'hip', rise: 0.75, inset: 0.8, overhang: 0.1 },
    doors: [{ col: 2, row: 5 }],
  });
  const { front } = house.userData.measures as { front: number };
  const portal = plain(art.color(26, 76), 0.85);
  const postTop = (98 - 79) / PX;

  for (const x0 of [24, 51]) {
    house.add(artBlock(art, { x: [x0, x0 + 4], z: [front - 0.02, front + 0.14], y: [0, postTop], front: [79, 98], sides: portal }));
  }

  house.add(artBlock(art, { x: [24, 55], z: [front - 0.02, front + 0.16], y: [postTop, postTop + 4 / PX], lid: [72, 76], front: [76, 80], sides: portal }));

  return house;
}

/**
 * Usina eletrica (9x8). Na arte: penhasco atras, laje rosa com a borda
 * amarela (20-72) e as quatro chamines brancas de faixas vermelhas (x 17-31,
 * 49-63, 81-95, 113-127; tampa na linha 12-16, base na 58); fachada das
 * alas de paineis azul-claros (72-110, 2,375 de altura em z = 6,875) e o
 * corpo do meio (40-104) meio tile a frente, com o vidro e o vao da
 * entrada (7,40) ate a linha 118.
 */
function buildPowerPlant(art: Art): THREE.Group {
  const root = new THREE.Group();
  root.name = 'power-plant';

  const front = 110 / PX;
  const wallTop = 38 / PX;
  const back = front - (72 - 20) / PX;

  root.add(artBlock(art, { x: [0, 144], z: [back, front], y: [0, wallTop], front: [72, 110] }));
  root.add(artRoof(art, {
    px: [0, 144], rows: [20, 72], kind: 'flat', rise: 0, y: wallTop + 0.002,
    bounds: { x0: 0, x1: 9, z0: back, z1: front },
  }));

  const centerFront = 118 / PX;

  root.add(artBlock(art, { x: [40, 104], z: [front - 0.02, centerFront], y: [0, 36 / PX], lid: [72, 82], front: [82, 118] }));

  // Chamines: cilindros com a arte de fachada (linha = frente - y).
  const radius = 7 / PX;
  const stackBottom = wallTop;
  const stackTop = wallTop + (58 - 14) / PX;
  const zFront = 58 / PX + wallTop;
  const skin = art.clone().bleed();
  const material = textured(skin.texture(0, 0, skin.width, skin.height), 1);
  const cap = plain(art.color(24, 14), 1);

  for (const x of [24, 56, 88, 120]) {
    const stack = new THREE.CylinderGeometry(radius, radius * 1.15, stackTop - stackBottom, 16, 1, true);

    stack.translate(x / PX, (stackTop + stackBottom) / 2, zFront - radius);
    artUv(stack, skin, (_x, y) => (zFront - y) * PX);
    root.add(new THREE.Mesh(stack, material));

    const lid = new THREE.Mesh(new THREE.CircleGeometry(radius, 16), cap);

    lid.rotateX(-Math.PI / 2);
    lid.position.set(x / PX, stackTop, zFront - radius);
    root.add(lid);
  }

  return root;
}

export interface FoundLandmark {
  landmark: Landmark;
  x: number;
  y: number;
  width: number;
  height: number;
}

export function findLandmarks(
  width: number,
  height: number,
  metatileAt: (x: number, y: number) => number,
): FoundLandmark[] {
  const found: FoundLandmark[] = [];

  for (const landmark of LANDMARKS) {
    for (const at of findMold(width, height, metatileAt, landmark.mold)) {
      found.push({ landmark, x: at.x, y: at.y, width: landmark.mold[0].length, height: landmark.mold.length });
    }
  }

  return found;
}
