import * as THREE from 'three';

import { type HouseSpec, type MoldCell, buildHouse, findMold } from './HouseModel';
import { Art, PX, box, plain, textured } from './ModelKit';

/**
 * Casas das cidades de Kanto (tilesets SECUNDARIOS de cada cidade).
 *
 * Todas seguem a mesma estrutura na arte: telhado ate uma linha escura de
 * beiral por volta do px 42 do bloco, 3 px de sombra e uma parede de 18 a
 * 21 px com a porta (Pallet tem dois andares: 37 px). O fim do beiral e
 * medido na arte (HouseModel.eaveBottom); aqui ficam so o molde de
 * metatiles, a porta e a forma do telhado de cada familia, tirada do
 * desenho:
 *
 *   Pallet     5x5  telhado vermelho de 4 aguas (dois andares)
 *   Viridian   5x4  telhado verde listrado, 2 aguas (casa e escola)
 *   Pewter     5x4  telhado de ardosia com a cumeeira clara atras
 *   Cerulean   Nx4  telhado azul de 4 aguas (largura variavel)
 *   Lavender   5x4  laje roxa com mureta clara (tambem as geminadas)
 *   Vermilion  5x4  telhado laranja ondulado, 2 aguas
 *   Fuchsia    5x4  laje cinza quadriculada (geminadas e a do Guarda)
 *   Saffron    4x5  telhado verde de 4 aguas (21 casas; so 4 com porta)
 *   Safari     Nx?  telhado de palha amarelo (escritorio e casas de
 *                   descanso da Zona Safari)
 */

export interface FoundHouse {
  kind: string;
  x: number;
  y: number;
  width: number;
  height: number;
  doors: Array<{ col: number; row: number }>;
  spec: Omit<HouseSpec, 'doors'>;
  // A linha de cima e a de baixo de outro predio (colado atras): pode estar
  // tomada por ele.
  sharedTop?: boolean;
  // Px de cima da linha de cima que sao uma cerca atras do predio (em pe,
  // no chao, como as outras cercas).
  backFence?: number;
  // Predio de tras de dois colados: sobe e vem para a frente esta altura
  // (a da parede do da frente), apoiado num corpo liso escondido atras
  // dele. Pela regra da dobra fica no mesmo lugar na tela, mas acima do
  // telhado do da frente: a fileira de janelas dele aparece, como no
  // original (na camera do jogo, mais baixa que 45 graus, ela sumia).
  lift?: number;
}

type MetatileAt = (x: number, y: number) => number;

interface FixedFamily {
  kind: string;
  mold: readonly (readonly MoldCell[])[];
  // Portas: (coluna, linha) e o id esperado (sem ele: casa sem porta).
  doors: Array<{ col: number; row: number; id: number }>;
  spec: Omit<HouseSpec, 'doors'>;
}

const FIXED: FixedFamily[] = [
  {
    kind: 'house-pallet',
    mold: [
      [0x281, 0x282, 0x282, 0x282, 0x283],
      [0x289, 0x28a, 0x28a, 0x28a, 0x28b],
      [0x291, 0x293, 0x292, 0x292, 0x294],
      [0x298, 0x299, 0x29a, 0x29b, 0x29c],
      [0x2a0, 0x2a3, 0x2a2, 0x2a1, 0x2a4],
    ],
    doors: [{ col: 1, row: 4, id: 0x2a3 }],
    spec: { roof: { kind: 'hip', rise: 0.75, inset: 0.5, overhang: 0.12 } },
  },
  {
    kind: 'house-viridian',
    mold: [
      [0x280, 0x281, 0x282, 0x283, 0x284],
      [0x288, 0x289, 0x28a, 0x28b, 0x28c],
      [0x290, 0x291, 0x292, 0x293, 0x294],
      [null, 0x299, null, null, null],
    ],
    doors: [{ col: 1, row: 3, id: 0x299 }],
    spec: { roof: { kind: 'gable', rise: 0.55, overhang: 0.1 } },
  },
  {
    // A casa de Viridian (nao a escola) tem uma agua-furtada marrom com
    // janela no telhado (px 46-65 x 8-32 da arte, linha de cima 2A8-2AC).
    kind: 'house-viridian',
    mold: [
      [0x2a8, 0x2a9, 0x2aa, 0x2ab, 0x2ac],
      [0x288, 0x289, 0x28a, 0x28b, 0x28c],
      [0x290, 0x291, 0x292, 0x293, 0x294],
      [null, 0x299, null, null, null],
    ],
    doors: [{ col: 1, row: 3, id: 0x299 }],
    spec: {
      roof: { kind: 'gable', rise: 0.55, overhang: 0.1 },
      chimneys: [{ x0: 46, y0: 8, x1: 66, y1: 33, height: 0.85 }],
    },
  },
  {
    kind: 'house-pewter',
    mold: [
      [0x2a7, 0x2b6, 0x2b6, 0x2b6, 0x287],
      [0x2af, 0x2be, 0x2be, 0x2be, 0x28f],
      [0x2b7, 0x2c6, 0x2b0, 0x2b1, 0x297],
      [0x2bf, 0x2ce, 0x2b8, 0x2b9, 0x29f],
    ],
    doors: [{ col: 1, row: 3, id: 0x2ce }],
    spec: { roof: { kind: 'gable', rise: 0.5, ridgeAt: 0.3, overhang: 0.1 } },
  },
  {
    kind: 'house-lavender',
    mold: [
      [0x288, null, null, null, 0x28c],
      [0x290, 0x291, 0x291, 0x291, 0x294],
      [0x298, 0x299, 0x29a, 0x29b, 0x29c],
      [0x2a0, 0x2a1, 0x2a2, 0x2a3, 0x2a4],
    ],
    doors: [{ col: 2, row: 3, id: 0x2a2 }],
    spec: { roof: { kind: 'flat', rise: 0, overhang: 0.06, parapet: 0.12 } },
  },
  {
    kind: 'house-vermilion',
    mold: [
      [null, null, null, null, null],
      [0x2a8, 0x2a9, 0x2a9, 0x2a9, 0x2aa],
      [0x2b0, 0x2a7, null, null, null],
      [0x2b8, 0x29e, null, null, null],
    ],
    doors: [{ col: 1, row: 3, id: 0x29e }],
    spec: { roof: { kind: 'gable', rise: 0.5, overhang: 0.1 } },
  },
  {
    // Casas 2 e 3 de Vermilion: o mesmo desenho com 4 de largura.
    kind: 'house-vermilion',
    mold: [
      [null, null, null, null],
      [0x2a8, 0x2a9, 0x2a9, 0x2aa],
      [0x2b0, 0x2a7, 0x2a3, 0x2a4],
      [0x2b8, 0x29e, null, null],
    ],
    doors: [{ col: 1, row: 3, id: 0x29e }],
    spec: { roof: { kind: 'gable', rise: 0.5, overhang: 0.1 } },
  },
  {
    kind: 'house-fuchsia',
    mold: [
      [null, null, null, null, null],
      [0x2a8, 0x2a9, 0x2a9, 0x2a9, 0x2aa],
      [0x2b0, 0x2b1, 0x2b2, 0x2b3, 0x2ab],
      [0x2b8, 0x2bf, 0x2b9, 0x2ba, 0x2bb],
    ],
    doors: [{ col: 1, row: 3, id: 0x2bf }],
    // A linha de cima e a mureta de tijolo (px 0-7) ou, na casa do irmao do
    // Fishing Guru, a porta dos fundos: a laje comeca na borda cinza (px 8).
    spec: { roofTopPx: 8, roof: { kind: 'flat', rise: 0, overhang: 0.06, parapet: 0.1 } },
  },
  {
    // Os 4 prediozoes amarelos sem porta em volta da Silph (Saffron): laje
    // verde com moldura amarela e um respiro amarelo, 3 andares de janelas
    // e a base roxa. Na arte: laje do px 0 ao 44 (linha escura do beiral),
    // parede do 45 ao 94; respiro: tampa com o circulo (px 2-16) e frente
    // listrada (17-30), nas colunas 48-69.
    kind: 'house-saffron-block',
    mold: [
      [0x281, 0x282, 0x282, 0x285, 0x286],
      [0x288, 0x289, 0x289, 0x28d, 0x28e],
      [0x290, 0x291, 0x292, 0x293, 0x294],
      [0x298, 0x299, 0x29a, 0x29b, 0x29c],
      [0x298, 0x299, 0x29a, 0x29b, 0x29c],
      [0x2a0, 0x2a1, 0x2a2, 0x2a3, 0x2a4],
    ],
    doors: [],
    spec: {
      roofTopPx: 0,
      facadeTopPx: 45,
      bodyPx: [0, 5 * PX],
      sidePx: 4,
      roof: { kind: 'flat', rise: 0, overhang: 0.02, parapet: 0.08 },
      chimneys: [{ x0: 48, y0: 2, x1: 70, y1: 31, frontPx: 17, patchDx: -24 }],
    },
  },
];

/** Casas de largura variavel: canto esquerdo e direito de cada linha. */
interface WideFamily {
  kind: string;
  // Linhas de baixo para cima: [esquerda, direita]; a ultima pode repetir
  // (telhado com 1 ou mais linhas iguais) quando `repeatLast`.
  rows: Array<[number, number]>;
  repeatLast?: boolean;
  door: number;
  spec: Omit<HouseSpec, 'doors'>;
  // Linha de cima (beirada) que entra no bloco, sem conferir os ids.
  topRow: boolean;
}

const WIDE: WideFamily[] = [
  {
    kind: 'house-cerulean',
    rows: [[0x2b8, 0x2ba], [0x2b0, 0x2b2], [0x2a8, 0x2aa]],
    door: 0x298,
    topRow: true,
    spec: { roof: { kind: 'hip', rise: 0.5, inset: 0.5, overhang: 0.1 } },
  },
  {
    kind: 'house-safari',
    rows: [[0x2cc, 0x2ce], [0x2c4, 0x2c6], [0x2bc, 0x2be]],
    repeatLast: true,
    door: 0x2bf,
    topRow: true,
    spec: { roof: { kind: 'hip', rise: 0.5, inset: 0.4, overhang: 0.1 } },
  },
];

function findWide(width: number, height: number, metatileAt: MetatileAt, family: WideFamily): FoundHouse[] {
  const found: FoundHouse[] = [];
  const [bottomLeft, bottomRight] = family.rows[0];

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (metatileAt(x, y) !== bottomLeft) {
        continue;
      }

      let right = x + 1;

      while (right < width && right - x < 12 && metatileAt(right, y) !== bottomRight) {
        right++;
      }

      if (metatileAt(right, y) !== bottomRight) {
        continue;
      }

      // Sobe conferindo os cantos de cada linha.
      let top = y;
      let ok = true;

      for (let i = 1; i < family.rows.length && ok; i++) {
        top--;
        ok = top >= 0 && metatileAt(x, top) === family.rows[i][0] && metatileAt(right, top) === family.rows[i][1];
      }

      if (!ok) {
        continue;
      }

      if (family.repeatLast) {
        const [left, rightId] = family.rows[family.rows.length - 1];

        while (top - 1 >= 0 && metatileAt(x, top - 1) === left && metatileAt(right, top - 1) === rightId) {
          top--;
        }
      }

      if (family.topRow && top - 1 >= 0) {
        top--;
      }

      const doors: Array<{ col: number; row: number }> = [];

      for (let col = x; col <= right; col++) {
        if (metatileAt(col, y) === family.door) {
          doors.push({ col: col - x, row: y - top });
        }
      }

      found.push({
        kind: family.kind,
        x,
        y: top,
        width: right - x + 1,
        height: y - top + 1,
        doors,
        spec: family.spec,
      });
    }
  }

  return found;
}

/**
 * Casas de Saffron: telhado 29D 29E.. 29F (largura variavel; quando a casa
 * encosta noutro predio, a coluna da direita e a do vizinho), beirada de
 * cima 295-297 (ou 2DC-2DE na terrea, que fica uma linha mais baixa), a
 * linha das janelas de cima 2A5.. e a base 2A0../2AE.. (uma linha abaixo
 * na casa de dois andares). Porta 284 na base.
 */
const SAFFRON_EAVE = new Set([0x295, 0x2dc]);
const SAFFRON_BASE = new Set([0x2a0, 0x2ae]);

function findSaffronHouses(width: number, height: number, metatileAt: MetatileAt): FoundHouse[] {
  const found: FoundHouse[] = [];

  for (let y = 1; y + 2 < height; y++) {
    for (let x = 0; x < width; x++) {
      if (metatileAt(x, y) !== 0x29d || !SAFFRON_EAVE.has(metatileAt(x, y - 1)) || metatileAt(x, y + 1) !== 0x2a5) {
        continue;
      }

      // Terrea: a base logo abaixo das janelas; sobrado: uma linha no meio.
      // Sem base (as casas do sul, com as copas das arvores da frente
      // pintadas na parede 2E6..2E7) fica na dobra: o modelo cortaria as copas.
      const baseRow = SAFFRON_BASE.has(metatileAt(x, y + 2)) ? y + 2 : SAFFRON_BASE.has(metatileAt(x, y + 3)) ? y + 3 : -1;

      if (baseRow < 0) {
        continue;
      }

      let right = x + 1;

      while (right < width && metatileAt(right, y) === 0x29e) {
        right++;
      }

      const w = right - x + (metatileAt(right, y) === 0x29f ? 1 : 0);

      if (w < 3) {
        continue;
      }

      const top = y - 1;
      const doors: Array<{ col: number; row: number }> = [];

      for (let col = 0; col < w; col++) {
        if (metatileAt(x + col, baseRow) === 0x284) {
          doors.push({ col, row: baseRow - top });
        }
      }

      found.push({
        kind: 'house-saffron',
        x,
        y: top,
        width: w,
        height: baseRow - top + 1,
        doors,
        // Na arte: telhado do px 8 ao 42 (linha escura do beiral), faixa
        // cinza de sombra (43-47) e a parede amarela ate a base roxa. No
        // sobrado a linha cinza do px 60 separa os andares: medida pela
        // linha escura mais baixa, ela virava o beiral (o andar de cima ia
        // para o telhado e a parede ficava com um andar so).
        // Laterais: a coluna do pilar amarelo da quina (px 4), sem janela.
        spec: { roofTopPx: 8, facadeTopPx: 43, sidePx: 4, roof: { kind: 'hip', rise: 0.55, inset: 0.35, overhang: 0.08 } },
      });
    }
  }

  return found;
}

/**
 * Predios modulares de Celadon (restaurante, casa, hotel e os prediozinhos
 * sem porta): beirada de cima 2ED/2D9, linhas de laje 2E0.., cornija
 * 2E8..2EC, linhas de fachada 2F0.. e a base 2F8..2FC. Largura e altura
 * variam (4x5 ate 7x8); o respiro e a caixa escura das celulas 2E2/2E3 da
 * primeira linha de laje. Na arte, a laje comeca no px 8 e a fachada 11 px
 * abaixo do topo da linha da cornija.
 */
// 2ED/2D9: beirada comum; 336: com a cerca branca atras (ao lado do
// Ginasio); 310: a de um predio colado na frente de outro (a linha mostra o
// pe da fachada do de tras e a beirada do da frente).
const CELADON_TOP = new Set([0x2ed, 0x2d9, 0x336, 0x310]);
const CELADON_FRONT_TOP = 0x310;

function findCeladonBlocks(width: number, height: number, metatileAt: MetatileAt): FoundHouse[] {
  const found: FoundHouse[] = [];

  for (let y = 0; y + 3 < height; y++) {
    for (let x = 0; x + 3 < width; x++) {
      if (!CELADON_TOP.has(metatileAt(x, y)) || metatileAt(x, y + 1) !== 0x2e0) {
        continue;
      }

      let row = y + 1;

      while (row < height && metatileAt(x, row) === 0x2e0) {
        row++;
      }

      if (metatileAt(x, row) !== 0x2e8) {
        continue;
      }

      const cornice = row++;

      // (Com a porta na ponta esquerda, a moldura dela ocupa a coluna:
      // 314 na fachada e 2E5 na base.)
      while (row < height && (metatileAt(x, row) === 0x2f0 || metatileAt(x, row) === 0x314)) {
        row++;
      }

      // Predio de tras de dois colados (Celadon, a direita do Ginasio): em
      // vez da base, a linha de cima do da frente; a fachada dele vai ate o
      // px 8 dela, onde comeca a beirada do outro.
      const behind = metatileAt(x, row) === CELADON_FRONT_TOP;
      let lift: number | undefined;

      if (behind) {
        // Altura da parede do da frente: da cornija (11 px abaixo do topo
        // da linha dela) ate o fim da linha da base.
        let frontCornice = row + 1;

        while (frontCornice < height && metatileAt(x, frontCornice) !== 0x2e8) {
          frontCornice++;
        }

        let frontBase = frontCornice + 1;

        while (frontBase < height && metatileAt(x, frontBase) !== 0x2f8 && metatileAt(x, frontBase) !== 0x2e5) {
          frontBase++;
        }

        if (frontBase < height) {
          lift = ((frontBase - frontCornice) * PX + PX - 11) / PX;
        }
      }

      if (!behind && metatileAt(x, row) !== 0x2f8 && metatileAt(x, row) !== 0x2e5) {
        continue;
      }

      const bottom = row;
      let right = x;

      while (right < width && metatileAt(right, cornice) !== 0x2ec) {
        right++;
      }

      if (right >= width) {
        continue;
      }

      const w = right - x + 1;
      const chimneys: NonNullable<HouseSpec['chimneys']> = [];
      const doors: Array<{ col: number; row: number }> = [];

      for (let col = 0; col < w; col++) {
        if (metatileAt(x + col, y + 1) === 0x2e2) {
          const x0 = col * PX + 1;

          chimneys.push({ x0, y0: 8, x1: x0 + 22, y1: 31, frontPx: 24, patchDx: col >= 2 ? 24 : -24 });
        }

        if (metatileAt(x + col, bottom) === 0x03d) {
          doors.push({ col, row: bottom - y });
        }
      }

      found.push({
        kind: 'house-celadon',
        x,
        y,
        width: w,
        height: bottom - y + 1,
        doors,
        spec: {
          roofTopPx: 8,
          facadeTopPx: (cornice - y) * PX + 11,
          bodyPx: [0, w * PX],
          sidePx: 4,
          roof: { kind: 'flat', rise: 0, overhang: 0.02, parapet: 0.08 },
          chimneys,
          ...(behind ? { frontPx: (bottom - y) * PX + 8, minWall: 0.5 } : {}),
        },
        sharedTop: metatileAt(x, y) === CELADON_FRONT_TOP,
        backFence: metatileAt(x, y) === 0x336 ? 8 : undefined,
        lift,
      });
    }
  }

  return found;
}

/** Todas as casas de cidade do mapa. */
export function findCityHouses(width: number, height: number, metatileAt: MetatileAt): FoundHouse[] {
  const found: FoundHouse[] = [];

  for (const family of FIXED) {
    for (const at of findMold(width, height, metatileAt, family.mold)) {
      found.push({
        kind: family.kind,
        x: at.x,
        y: at.y,
        width: family.mold[0].length,
        height: family.mold.length,
        doors: family.doors
          .filter((door) => metatileAt(at.x + door.col, at.y + door.row) === door.id)
          .map(({ col, row }) => ({ col, row })),
        spec: family.spec,
      });
    }
  }

  for (const family of WIDE) {
    found.push(...findWide(width, height, metatileAt, family));
  }

  found.push(...findSaffronHouses(width, height, metatileAt));
  found.push(...findCeladonBlocks(width, height, metatileAt));

  return found;
}

export function buildCityHouse(art: Art, house: FoundHouse): THREE.Group {
  // Casa sem porta (as de Saffron): a coluna da porta do molde serve so de
  // referencia para medir a fachada; nao ganha plano de porta.
  const reference = house.doors.length ? house.doors : [{ col: 1, row: house.height - 1 }];
  const group = buildHouse(house.kind, art, { ...house.spec, doors: reference });

  if (house.lift) {
    const lift = house.lift;
    const body = new THREE.Box3().setFromObject(group);

    for (const child of group.children) {
      child.position.y += lift;
      child.position.z += lift;
    }

    // Corpo liso por baixo (a parede de baixo, escondida atras do predio da
    // frente), na cor da coluna lisa da fachada.
    const color = art.color(house.spec.sidePx ?? 4, (house.spec.facadeTopPx ?? 0) + 6);
    const sides = plain(color, 0.8);

    group.add(box(0.02, house.width - 0.02, 0, lift, body.min.z + lift, body.max.z + lift - 0.02, [
      sides, sides, plain(color, 1), plain(color, 0.5), plain(color, 0.9), plain(color, 0.7),
    ]));
  }

  if (house.backFence) {
    // Cerca atras do predio: os px de cima da linha de cima, em pe. Fica
    // como a cerca vizinha (as celulas de cerca com arvore viram uma carta
    // de 1 tile em pe na borda sul da linha): a mesma altura e o mesmo
    // lugar, com a cerca no alto da carta. Sem a grama entre as estacas.
    const rows = house.backFence;
    const fence = art.cut(0, 0, art.width, rows);

    for (let p = 0; p < fence.length; p += 4) {
      if (fence[p + 1] > fence[p] + 16 && fence[p + 1] > fence[p + 2]) {
        fence[p + 3] = 0;
      }
    }

    const plane = new THREE.Mesh(
      new THREE.PlaneGeometry(house.width, rows / PX),
      textured(new Art(fence, art.width, rows).texture(0, 0, art.width, rows)),
    );

    plane.name = 'back-fence';
    plane.position.set(house.width / 2, 1 - rows / PX / 2, 1);
    group.add(plane);
  }

  if (!house.doors.length) {
    const doors: THREE.Object3D[] = [];

    group.traverse((object) => {
      if (object.userData?.door) {
        doors.push(object);
      }
    });

    for (const door of doors) {
      door.removeFromParent();
    }
  }

  return group;
}
