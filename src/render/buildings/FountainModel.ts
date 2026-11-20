import * as THREE from 'three';

import { RECIPE_MERGED } from '../GroundSubstitution';
import { type MoldCell, findMold } from './HouseModel';
import { type Art, PX, textured } from './ModelKit';

/**
 * Fonte de Celadon (3x4 metatiles em (12,18), na praca da frente da Loja
 * de Departamentos).
 *
 * Na arte (px do bloco, 48x64): bacia redonda de pedra com 40 px de
 * largura (x 4-44, centro em x 24); a borda cor de areia vai da linha 13
 * (fundo) a 51 (frente), com o contorno cinza; abaixo dela, na frente, a
 * parede da bacia (cinza com a linha escura, linhas 51-58). Dentro, a agua
 * azul e, no meio, o jato (x 18-30, linhas 17-39) - os 16x32 px do meio
 * sao os tiles animados do jogo (5 quadros: um anel claro descendo pelo
 * jato).
 *
 * Pela regra da dobra (linha da arte = z - y) a bacia e um CIRCULO:
 * frente da parede no chao na linha 58 (z = 3,625), alto da borda de tras
 * na linha 13 -> centro em z = 2,40, raio 1,24, borda a 0,41 do chao. O
 * jato e uma coluna redonda de agua (raio 0,375 = os 12 px dele) que sobe
 * da agua ate 1,5 de altura, com a arte do jato correndo de cima a baixo
 * pela frente dela: o anel do quadro animado desce pela coluna.
 *
 * Tudo usa UMA textura (as 12 celulas do bloco, com a camada de cima): o
 * animador de tiles recompoe essas celulas da VRAM como faz com as do
 * mapa (ver TileAnimator.AnimatedTarget), entao a fonte anima igual ao
 * jogo.
 */

export const CELADON_FOUNTAIN_MOLD: readonly (readonly MoldCell[])[] = [
  [0x2cd, 0x2ce, 0x2cf],
  [0x2d0, 0x2d1, 0x2d2],
  [0x2d3, 0x2d4, 0x2d5],
  [0x2d6, 0x2d7, 0x2d8],
];

export const FOUNTAIN_WIDTH = 3;
export const FOUNTAIN_HEIGHT = 4;

export function findFountains(
  width: number,
  height: number,
  metatileAt: (x: number, y: number) => number,
): Array<{ x: number; y: number }> {
  return findMold(width, height, metatileAt, CELADON_FOUNTAIN_MOLD);
}

// Medidas (tiles, no espaco do bloco).
const CX = 1.5;
const CZ = 2.4;
const OUTER = 1.24;
const INNER = 1.06;
const RIM_TOP = 0.41;
const WATER = 0.3;
const JET_RADIUS = 0.375;
const JET_TOP = 1.5;
const JET_DOME = 0.26;
// Linhas da arte do jato (topo e pe; acima de 18 o contorno da borda).
const JET_ROW_TOP = 18.5;
const JET_ROW_BOTTOM = 39;
const SEGMENTS = 72;

type RowOf = (x: number, y: number, z: number) => number;

/** Torno em volta do centro da fonte, com a textura dada por rowOf. */
function lathe(art: Art, profile: Array<[number, number]>, rowOf: RowOf, material: THREE.Material): THREE.Mesh {
  const geometry = new THREE.LatheGeometry(
    profile.map(([radius, y]) => new THREE.Vector2(radius, y)),
    SEGMENTS,
  );

  geometry.translate(CX, 0, CZ);
  setUv(geometry, art, rowOf);

  return new THREE.Mesh(geometry, material);
}

function setUv(geometry: THREE.BufferGeometry, art: Art, rowOf: RowOf): void {
  const position = geometry.attributes.position;
  const uv = new Float32Array(position.count * 2);

  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i);
    const y = position.getY(i);
    const z = position.getZ(i);

    uv[i * 2] = (x * PX) / art.width;
    uv[i * 2 + 1] = 1 - rowOf(x, y, z) / art.height;
  }

  geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
}

// Dobra direta (o que a arte mostra de cima: borda, agua).
const direct: RowOf = (_x, y, z) => (z - y) * PX;

// Faces em pe: a metade de tras (virada para o norte, que a arte nao
// mostra) repete a da frente.
const mirrored: RowOf = (_x, y, z) => ((z >= CZ ? z : 2 * CZ - z) - y) * PX;

// Jato: a arte dele (linhas 17-39) corre do topo da coluna ate a agua.
const jetRow: RowOf = (_x, y) =>
  JET_ROW_TOP + ((JET_TOP - y) / (JET_TOP - WATER)) * (JET_ROW_BOTTOM - JET_ROW_TOP);

export function buildFountainModel(art: Art, metatileIds: readonly number[]): THREE.Group {
  const root = new THREE.Group();
  root.name = 'celadon-fountain';

  const texture = art.texture(0, 0, art.width, art.height);
  const material = textured(texture, 1, true);

  // Parede de fora da bacia (pedra cinza da frente).
  root.add(lathe(art, [[OUTER, -0.01], [OUTER, RIM_TOP - 0.05]], mirrored, material));

  // Borda: anel cor de areia com as quinas arredondadas.
  root.add(lathe(art, [
    [OUTER, RIM_TOP - 0.05],
    [OUTER - 0.012, RIM_TOP - 0.018],
    [OUTER - 0.04, RIM_TOP - 0.002],
    [OUTER - 0.07, RIM_TOP],
    [INNER + 0.07, RIM_TOP],
    [INNER + 0.04, RIM_TOP - 0.002],
    [INNER + 0.012, RIM_TOP - 0.018],
    [INNER, RIM_TOP - 0.05],
  ], direct, material));

  // Parede de dentro, ate a agua.
  root.add(lathe(art, [[INNER, RIM_TOP - 0.05], [INNER, WATER - 0.02]], direct, material));

  // Espelho d'agua.
  const water = new THREE.CircleGeometry(INNER + 0.005, SEGMENTS);

  water.rotateX(-Math.PI / 2);
  water.translate(CX, WATER, CZ);
  setUv(water, art, direct);
  root.add(new THREE.Mesh(water, material));

  // Jato: coluna redonda, um pouco mais larga no pe (a agua que cai), e o
  // topo em cupula achatada.
  const jet: Array<[number, number]> = [
    [JET_RADIUS + 0.06, WATER - 0.01],
    [JET_RADIUS + 0.03, WATER + 0.05],
    [JET_RADIUS + 0.008, WATER + 0.16],
    [JET_RADIUS, WATER + 0.3],
    [JET_RADIUS, JET_TOP - JET_DOME],
  ];

  for (let step = 1; step <= 8; step++) {
    const angle = (step / 8) * (Math.PI / 2);

    jet.push([Math.max(0.0005, JET_RADIUS * Math.cos(angle)), JET_TOP - JET_DOME + JET_DOME * Math.sin(angle)]);
  }

  root.add(lathe(art, jet, jetRow, material));

  root.userData.animated = {
    texture,
    metatileIds: Int32Array.from(metatileIds),
    recipes: new Uint8Array(metatileIds.length).fill(RECIPE_MERGED),
    columns: FOUNTAIN_WIDTH,
    rows: FOUNTAIN_HEIGHT,
  };

  return root;
}
