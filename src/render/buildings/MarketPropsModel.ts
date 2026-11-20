import * as THREE from 'three';

import type { Gen3MetatileGraphics } from '../../gen3/Gen3StateAdapter';
import { Art, PX, artBlock, plain, textured } from './ModelKit';

/**
 * Objetos da feira de Two Island (a banca com o toldo amarelo): caixotes,
 * a pilha de dois caixotes, as duas maquinas (azul e vermelha), os vasos
 * de barro e as cestas de flores. Dobrados como os outros objetos eram
 * cartoes em pe, chapados; aqui viram volumes, com a arte do tile no topo
 * e na frente pela regra da dobra (linha = z - y).
 *
 * Os objetos estao na camada de cima dos tiles e sao reconhecidos pelo
 * desenho dela (hash), nao pelo id: o id do tileset das ilhas 1-3 quer
 * dizer outra coisa nos outros tilesets.
 *
 * Medidas (px do tile):
 *  - caixote: tampa nas linhas 0-8, frente 8-16 (meio tile de altura e de
 *    fundo);
 *  - pilha: tampa nas linhas 8-16 do tile de cima, frente no tile de baixo
 *    inteiro (dois caixotes, 1 de altura);
 *  - maquinas: tela no topo (linhas 1-10), frente 10-15 (5 px de altura);
 *  - vaso: boca escura nas linhas 1-6, corpo ate a linha 12 (x 2-13);
 *  - cesta: flores nas linhas 0-8, cesto 8-14 (x 1-15).
 */

export type MarketProp = 'crate' | 'stack' | 'machine' | 'pot' | 'basket';

const PROPS = new Map<string, MarketProp>([
  ['e83fcda1', 'crate'],
  ['ce8df289', 'stack'],
  ['2bf432cd', 'machine'],
  ['a8283ddf', 'machine'],
  ['833f01cd', 'pot'],
  ['5f69d3b2', 'basket'],
]);

// Tile de baixo da pilha (a frente dos dois caixotes).
const STACK_BOTTOM = 'ae0ea5f5';

function hash(pixels: Uint8ClampedArray): string {
  let h = 2166136261;

  for (let i = 0; i < pixels.length; i++) {
    h ^= pixels[i];
    h = Math.imul(h, 16777619) >>> 0;
  }

  return h.toString(16);
}

export interface FoundProp {
  x: number;
  y: number;
  kind: MarketProp;
  // Celulas que saem do mapa (a pilha ocupa duas).
  cells: Array<[number, number]>;
}

export function findMarketProps(
  width: number,
  height: number,
  metatileAt: (x: number, y: number) => number,
  graphics: ReadonlyMap<number, Gen3MetatileGraphics | null>,
): FoundProp[] {
  const cache = new Map<number, string>();
  const hashAt = (x: number, y: number): string => {
    const id = metatileAt(x, y);

    if (!cache.has(id)) {
      const top = graphics.get(id)?.topPixels;

      cache.set(id, top ? hash(top) : '');
    }

    return cache.get(id)!;
  };
  const found: FoundProp[] = [];

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const kind = PROPS.get(hashAt(x, y));

      if (!kind) {
        continue;
      }

      if (kind === 'stack') {
        if (y + 1 < height && hashAt(x, y + 1) === STACK_BOTTOM) {
          found.push({ x, y, kind, cells: [[x, y], [x, y + 1]] });
        }

        continue;
      }

      found.push({ x, y, kind, cells: [[x, y]] });
    }
  }

  return found;
}

const SEGMENTS = 40;

/** Torno com a arte da frente correndo de cima (rowTop) a baixo (rowBottom). */
function turned(
  art: Art,
  profile: Array<[number, number]>,
  cx: number,
  cz: number,
  rows: [number, number],
  heights: [number, number],
  material: THREE.Material,
): THREE.Mesh {
  const geometry = new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(r, y)), SEGMENTS);

  geometry.translate(cx, 0, cz);

  const position = geometry.attributes.position;
  const uv = new Float32Array(position.count * 2);

  for (let i = 0; i < position.count; i++) {
    const y = position.getY(i);
    const t = (heights[1] - y) / (heights[1] - heights[0]);

    uv[i * 2] = (position.getX(i) * PX) / art.width;
    uv[i * 2 + 1] = 1 - (rows[0] + Math.min(1, Math.max(0, t)) * (rows[1] - rows[0])) / art.height;
  }

  geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));

  return new THREE.Mesh(geometry, material);
}

/** Modelo de um objeto; `art` e o desenho das celulas dele (16 de largura). */
export function buildMarketProp(prop: FoundProp, art: Art): THREE.Group {
  const root = new THREE.Group();
  root.name = `market-${prop.kind}`;

  const edge = plain(art.color(0, 10), 0.8);

  switch (prop.kind) {
    case 'crate':
      root.add(artBlock(art, { x: [0, 16], z: [0.5, 1], y: [0, 0.5], lid: [0, 8], front: [8, 16], sides: edge }));
      break;

    case 'stack':
      // Dois caixotes: frente no tile de baixo inteiro, tampa no de cima.
      root.add(artBlock(art, { x: [0, 16], z: [1.5, 2], y: [0, 1], lid: [8, 16], front: [16, 32], sides: edge }));
      break;

    case 'machine':
      root.add(artBlock(art, { x: [0, 15], z: [6 / PX, 15 / PX], y: [0, 5 / PX], lid: [1, 10], front: [10, 15], sides: plain(art.color(1, 12), 0.75) }));
      break;

    case 'pot': {
      const material = textured(art.texture(0, 0, art.width, art.height), 1, true);
      const cz = 0.42;

      root.add(turned(art, [
        [0.22, 0],
        [0.3, 0.12],
        [0.34, 0.3],
        [0.3, 0.48],
        [0.23, 0.6],
        [0.27, 0.66],
        [0.24, 0.68],
      ], 7.5 / PX, cz, [1, 12], [0, 0.68], material));

      // Boca: disco escuro dentro da borda.
      const mouth = new THREE.Mesh(new THREE.CircleGeometry(0.2, SEGMENTS), plain(art.color(7, 3), 1));

      mouth.rotateX(-Math.PI / 2);
      mouth.position.set(7.5 / PX, 0.665, cz);
      root.add(mouth);
      break;
    }

    case 'basket': {
      const material = textured(art.texture(0, 0, art.width, art.height), 1, true);
      const cz = 0.5;

      // Cesto e, por cima, a copa de flores em cupula.
      root.add(turned(art, [[0.38, 0], [0.44, 0.08], [0.46, 0.36]], 8 / PX, cz, [8, 15], [0, 0.36], material));

      const dome: Array<[number, number]> = [[0.46, 0.36]];

      for (let step = 1; step <= 6; step++) {
        const angle = (step / 6) * (Math.PI / 2);

        dome.push([Math.max(0.0005, 0.46 * Math.cos(angle)), 0.36 + 0.3 * Math.sin(angle)]);
      }

      root.add(turned(art, dome, 8 / PX, cz, [0, 8], [0.36, 0.66], material));
      break;
    }
  }

  return root;
}
