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
  // Atras do toldo: a entrada escura (o vao debaixo dele), ate o chao.
  const facade = art.clone().fill(3, 72, 61, 88, 32, 90);

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
