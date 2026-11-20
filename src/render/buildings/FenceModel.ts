import * as THREE from 'three';

import type { Gen3MetatileGraphics } from '../../gen3/Gen3StateAdapter';
import { PX } from './ModelKit';

/**
 * Cercas norte-sul.
 *
 * No GBA uma cerca que corre de norte a sul e desenhada de cima: um trilho
 * fino (4 a 7 px) na camada de cima do tile, o mesmo tile repetido coluna
 * abaixo (F0/F1 de madeira e F4/F5 brancas no tileset geral, 320 em
 * Saffron). Dobrada como os outros objetos, cada tile virava um cartao
 * virado para o sul com o trilho em pe: de longe, um poste alto e fino
 * (Pewter, Saffron, Vermilion) ou, solta no mapa, pedacos deitados na
 * grama (Cerulean).
 *
 * Aqui ela vira cerca de verdade, ao longo da coluna: mourao fino em cada
 * tile e duas travessas, nas cores do proprio desenho (pintadas, sem
 * textura, como os cartoes), esticada na vertical como os objetos em pe.
 * Um cartao norte-sul sozinho sumia de frente para a camera (virava uma
 * linha); os mouroes aparecem de qualquer angulo. As pontas (os cantos
 * que ligam com a cerca leste-oeste) continuam cartoes normais; a cerca
 * vai do pe do canto de cima ao pe do canto de baixo.
 */

export interface FenceRun {
  x: number;
  y0: number;
  y1: number;
  metatileId: number;
  // Faixa do trilho no tile (px, x0..x1 inclusive).
  band: [number, number];
  // Ha canto (objeto) logo acima / logo abaixo da fileira?
  capTop: boolean;
  capBottom: boolean;
}

interface Block {
  metatileId: number;
  collision: number;
  elevation: number;
}

const MAX_BAND = 8;
const MIN_ROWS = 12;

// Cercas do tileset geral (todo o FRLG ao ar livre): F0/F1 de madeira e
// F4/F5 brancas. Nos tilesets das cidades a mesma forma (faixa estreita
// repetida) tambem e beira de penhasco, cano de predio...: ali so conta
// trilho claro (branco, cinza, azul) longe de parede.
const PRIMARY_FENCES = new Set([0xf0, 0xf1, 0xf4, 0xf5]);
const PRIMARY_COUNT = 0x280;

/** Faixa estreita e alta do desenho na camada de cima (o trilho). */
function railBand(graphics: Gen3MetatileGraphics | null | undefined): [number, number] | null {
  if (!graphics) {
    return null;
  }

  let x0 = PX;
  let x1 = -1;
  let rows = 0;

  for (let y = 0; y < PX; y++) {
    let any = false;

    for (let x = 0; x < PX; x++) {
      if (graphics.topPixels[(y * PX + x) * 4 + 3] !== 0) {
        any = true;
        x0 = Math.min(x0, x);
        x1 = Math.max(x1, x);
      }
    }

    rows += any ? 1 : 0;
  }

  return x1 >= 0 && x1 - x0 + 1 <= MAX_BAND && rows >= MIN_ROWS ? [x0, x1] : null;
}

export function findNorthSouthFences(
  width: number,
  height: number,
  blocks: readonly (Block | undefined)[],
  graphics: ReadonlyMap<number, Gen3MetatileGraphics | null>,
  taken: ReadonlySet<number>,
): FenceRun[] {
  const runs: FenceRun[] = [];
  const bands = new Map<number, [number, number] | null>();
  const bandOf = (id: number): [number, number] | null => {
    if (!bands.has(id)) {
      const source = graphics.get(id);
      let band = railBand(source);

      if (band && id < PRIMARY_COUNT && !PRIMARY_FENCES.has(id)) {
        band = null;
      }

      if (band && id >= PRIMARY_COUNT && source) {
        const [main] = railColors(source, band);
        const luma = main[0] * 0.3 + main[1] * 0.59 + main[2] * 0.11;
        const blue = main[2] > main[0] + 30 && main[2] >= main[1];

        band = luma >= 150 || blue ? band : null;
      }

      bands.set(id, band);
    }

    return bands.get(id)!;
  };
  // Parede ao lado (bloco solido com desenho grande na camada de cima):
  // cano de predio, nao cerca.
  const wallAt = (x: number, y: number): boolean => {
    const block = x >= 0 && x < width ? blocks[y * width + x] : undefined;
    const top = block && block.collision !== 0 ? graphics.get(block.metatileId)?.topPixels : undefined;

    if (!top) {
      return false;
    }

    let opaque = 0;

    for (let p = 3; p < top.length; p += 4) {
      opaque += top[p] !== 0 ? 1 : 0;
    }

    return opaque > (PX * PX) / 2;
  };
  const solid = (x: number, y: number): boolean => {
    const block = y >= 0 && y < height ? blocks[y * width + x] : undefined;

    return !!block && block.collision !== 0 && block.elevation !== 1;
  };

  for (let x = 0; x < width; x++) {
    let y = 0;

    while (y < height) {
      const block = blocks[y * width + x];
      const band = block && block.collision !== 0 && !taken.has(y * width + x) ? bandOf(block.metatileId) : null;

      if (!block || !band) {
        y++;
        continue;
      }

      const y0 = y;

      while (
        y < height &&
        blocks[y * width + x]?.metatileId === block.metatileId &&
        blocks[y * width + x]!.collision !== 0 &&
        !taken.has(y * width + x)
      ) {
        y++;
      }

      const secondary = block.metatileId >= PRIMARY_COUNT;
      let walls = 0;

      for (let row = y0; secondary && row < y; row++) {
        walls += wallAt(x - 1, row) || wallAt(x + 1, row) ? 1 : 0;
      }

      if (y - y0 >= 2 && walls * 2 < y - y0) {
        runs.push({
          x,
          y0,
          y1: y - 1,
          metatileId: block.metatileId,
          band,
          capTop: solid(x, y0 - 1),
          capBottom: solid(x, y),
        });
      }
    }
  }

  return runs;
}

/** Cores do trilho: a mais comum, a mais escura e a mais clara. */
function railColors(graphics: Gen3MetatileGraphics, band: [number, number]): [number[], number[], number[]] {
  const counts = new Map<string, { rgb: number[]; count: number }>();

  for (let y = 0; y < PX; y++) {
    for (let x = band[0]; x <= band[1]; x++) {
      const p = (y * PX + x) * 4;

      if (graphics.topPixels[p + 3] === 0) {
        continue;
      }

      const rgb = [graphics.topPixels[p], graphics.topPixels[p + 1], graphics.topPixels[p + 2]];
      const key = rgb.join(',');
      const entry = counts.get(key) ?? { rgb, count: 0 };

      entry.count++;
      counts.set(key, entry);
    }
  }

  const entries = [...counts.values()].filter((entry) => entry.count >= 2);
  const all = entries.length ? entries : [...counts.values()];
  const luma = (rgb: number[]): number => rgb[0] * 0.3 + rgb[1] * 0.59 + rgb[2] * 0.11;
  const dark = all.reduce((best, entry) => (luma(entry.rgb) < luma(best.rgb) ? entry : best)).rgb;
  const light = all.reduce((best, entry) => (luma(entry.rgb) > luma(best.rgb) ? entry : best)).rgb;
  // Cor da cerca: a mais comum tirando o contorno (o mais escuro).
  const body = all.filter((entry) => entry.rgb !== dark);
  const main = (body.length ? body : all).reduce((best, entry) => (entry.count > best.count ? entry : best)).rgb;

  return [main, dark, light];
}

// Alturas (px do desenho): cerca de 12 px, como as leste-oeste; travessas
// de 2 px nas linhas 3-5 e 8-10 contadas do topo.
const FENCE_PX = 12;
const POST = 3 / PX;
const RAIL = 1.2 / PX;

/** Caixa com uma cor por face (laterais e fundo mais escuros). */
function coloredBox(
  x0: number, x1: number, y0: number, y1: number, z0: number, z1: number,
  light: THREE.Color, dark: THREE.Color,
): THREE.BufferGeometry {
  const geometry = new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0);

  geometry.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);

  const colors = new Float32Array(24 * 3);
  // +x, -x, +y, -y, +z, -z
  const faces = [dark, dark, light, dark, light, dark];

  for (let face = 0; face < 6; face++) {
    for (let vertex = 0; vertex < 4; vertex++) {
      colors.set([faces[face].r, faces[face].g, faces[face].b], (face * 4 + vertex) * 3);
    }
  }

  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

  return geometry;
}

/** Junta caixas numa geometria so (posicao, cor e indice). */
function merge(geometries: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const positions: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];

  for (const geometry of geometries) {
    const base = positions.length / 3;
    const position = geometry.attributes.position;
    const color = geometry.attributes.color;

    for (let i = 0; i < position.count; i++) {
      positions.push(position.getX(i), position.getY(i), position.getZ(i));
      colors.push(color.getX(i), color.getY(i), color.getZ(i));
    }

    for (const index of geometry.index!.array) {
      indices.push(base + index);
    }

    geometry.dispose();
  }

  const merged = new THREE.BufferGeometry();

  merged.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  merged.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  merged.setIndex(indices);

  return merged;
}

const toColor = (rgb: number[], shade = 1): THREE.Color =>
  new THREE.Color().setRGB((rgb[0] / 255) * shade, (rgb[1] / 255) * shade, (rgb[2] / 255) * shade, THREE.SRGBColorSpace);

export function buildFenceRun(run: FenceRun, graphics: Gen3MetatileGraphics): THREE.Group {
  const root = new THREE.Group();
  root.name = 'fence-ns';

  // Frente e topo na cor mais clara do desenho (o branco da cerca branca,
  // o claro da madeira); laterais na cor do corpo; cabeca e sombra das
  // travessas no contorno.
  const [main, dark, bright] = railColors(graphics, run.band);
  const light = toColor(bright);
  const shadow = toColor(main, 0.9);
  const outline = toColor(dark);
  const z0 = run.y0;
  const z1 = run.capBottom ? run.y1 + 2 : run.y1 + 1;
  const height = FENCE_PX / PX;
  const x = run.x + (run.band[0] + run.band[1] + 1) / 2 / PX;
  const parts: THREE.BufferGeometry[] = [];

  // Mourao no pe de cada tile (onde ficam os da cerca leste-oeste), com a
  // cabeca escura do contorno.
  for (let z = z0 + 1; z <= z1 + 0.001; z++) {
    parts.push(coloredBox(x - POST / 2, x + POST / 2, 0, height, z - POST, z, light, shadow));
    parts.push(coloredBox(x - POST / 2 - 0.004, x + POST / 2 + 0.004, height - 0.02, height + 0.012, z - POST - 0.004, z + 0.004, outline, outline));
  }

  // Duas travessas ao longo da coluna.
  for (const fromTop of [3, 8]) {
    const top = height - fromTop / PX;

    parts.push(coloredBox(x - RAIL / 2, x + RAIL / 2, top - 2 / PX, top, z0 + POST / 2, z1 - POST / 2, light, shadow));
    parts.push(coloredBox(x - RAIL / 2, x + RAIL / 2, top - 2.6 / PX, top - 2 / PX, z0 + POST / 2, z1 - POST / 2, outline, outline));
  }

  const mesh = new THREE.Mesh(merge(parts), new THREE.MeshBasicMaterial({ vertexColors: true }));

  root.add(mesh);

  // Esticada na vertical como os cartoes dos objetos (PlayerRenderer).
  root.userData.upright = [mesh];

  return root;
}
