import * as THREE from 'three';

import type { MemoryReader } from '../../gen3/MemoryReader';

/**
 * Animacao de abrir/fechar a porta dos modelos 3D.
 *
 * Na Gen 3 a animacao de porta copia cada quadro para os ultimos 8 tiles
 * de BG da VRAM (tiles 0x3F8-0x3FF, 0x06007F00) e desenha a porta com eles
 * (porta 16x32: 2 tiles de largura, 4 de altura; a metade de baixo e o
 * tile da porta). Aqui: enquanto esses tiles mudam, o quadro atual vai
 * para o plano da porta do modelo mais perto do jogador. A paleta e
 * escolhida comparando com a porta fechada do proprio tileset.
 */

const DOOR_TILES = 0x06007f00;

const DOOR_BYTES = 8 * 32;

const BG_PALETTES = 0x05000000;

// A porta continua mostrando o ultimo quadro por este tempo depois da
// ultima mudanca (porta aberta enquanto o jogador entra).
const HOLD_MS = 700;

// Distancia maxima (tiles) entre o jogador e a porta animada.
const MAX_DISTANCE = 2.5;

export class DoorAnimator {
  private readonly memory: MemoryReader;

  private last: Uint8Array | null = null;

  private lastChangeAt = 0;

  private palette = -1;

  private active: THREE.Mesh | null = null;

  private texture: THREE.DataTexture | null = null;

  private readonly rgba = new Uint8Array(16 * 16 * 4);

  constructor(memory: MemoryReader) {
    this.memory = memory;
  }

  /** planes: planos de porta (userData.door) ja no mundo. */
  update(planes: readonly THREE.Mesh[], player: THREE.Vector3, now: number): void {
    const bytes = this.memory.readRange(DOOR_TILES, DOOR_BYTES);
    const changed = !!this.last && bytes.some((value, index) => value !== this.last![index]);

    if (changed) {
      this.lastChangeAt = now;
    }

    this.last = bytes;

    const animating = this.lastChangeAt > 0 && now - this.lastChangeAt < HOLD_MS;

    if (!animating) {
      this.hide();

      return;
    }

    const plane = this.nearest(planes, player);

    if (!plane) {
      this.hide();

      return;
    }

    if (plane !== this.active) {
      this.hide();
      this.active = plane;
      this.palette = -1;
    }

    if (this.palette < 0) {
      this.palette = this.choosePalette(bytes, plane.userData.closedArt as Uint8Array | undefined);
    }

    this.decode(bytes, this.palette);

    if (!this.texture) {
      this.texture = new THREE.DataTexture(this.rgba, 16, 16, THREE.RGBAFormat);
      this.texture.magFilter = THREE.NearestFilter;
      this.texture.minFilter = THREE.NearestFilter;
      this.texture.colorSpace = THREE.SRGBColorSpace;
    }

    this.texture.needsUpdate = true;

    const material = plane.material as THREE.MeshBasicMaterial;

    if (material.map !== this.texture) {
      material.map = this.texture;
      material.needsUpdate = true;
    }

    plane.visible = true;
  }

  dispose(): void {
    this.hide();
    this.texture?.dispose();
    this.texture = null;
  }

  private hide(): void {
    if (this.active) {
      this.active.visible = false;
      this.active = null;
    }
  }

  private nearest(planes: readonly THREE.Mesh[], player: THREE.Vector3): THREE.Mesh | null {
    let best: THREE.Mesh | null = null;
    let bestDistance = MAX_DISTANCE;
    const position = new THREE.Vector3();

    for (const plane of planes) {
      plane.getWorldPosition(position);

      const distance = Math.hypot(position.x - player.x, position.z - player.z);

      if (distance < bestDistance) {
        bestDistance = distance;
        best = plane;
      }
    }

    return best;
  }

  /** Metade de baixo do quadro (tiles 4-7) em RGBA, linhas de baixo p/ cima. */
  private decode(bytes: Uint8Array, palette: number, out = this.rgba): void {
    const colors = this.readPalette(palette);

    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++) {
        const tile = 4 + (y >> 3) * 2 + (x >> 3);
        const byte = bytes[tile * 32 + (y & 7) * 4 + ((x & 7) >> 1)];
        const index = x & 1 ? byte >> 4 : byte & 15;
        const o = ((15 - y) * 16 + x) * 4;

        if (index === 0) {
          out[o + 3] = 0;
          continue;
        }

        const color = colors[index];

        out[o] = ((color & 31) << 3) | ((color & 31) >> 2);
        out[o + 1] = (((color >> 5) & 31) << 3) | (((color >> 5) & 31) >> 2);
        out[o + 2] = (((color >> 10) & 31) << 3) | (((color >> 10) & 31) >> 2);
        out[o + 3] = 255;
      }
    }
  }

  private readPalette(palette: number): Uint16Array {
    const colors = new Uint16Array(16);

    for (let index = 0; index < 16; index++) {
      colors[index] = this.memory.readU16(BG_PALETTES + palette * 32 + index * 2);
    }

    return colors;
  }

  /** Paleta de BG (0-12) que mais aproxima o quadro da porta fechada. */
  private choosePalette(bytes: Uint8Array, closed: Uint8Array | undefined): number {
    if (!closed) {
      return 0;
    }

    const trial = new Uint8Array(16 * 16 * 4);
    let best = 0;
    let bestError = Infinity;

    for (let palette = 0; palette < 13; palette++) {
      this.decode(bytes, palette, trial);

      let error = 0;

      for (let y = 0; y < 16; y++) {
        for (let x = 0; x < 16; x++) {
          const a = ((15 - y) * 16 + x) * 4;
          const b = (y * 16 + x) * 4;

          if (trial[a + 3] === 0) {
            continue;
          }

          error +=
            Math.abs(trial[a] - closed[b]) +
            Math.abs(trial[a + 1] - closed[b + 1]) +
            Math.abs(trial[a + 2] - closed[b + 2]);
        }
      }

      if (error < bestError) {
        bestError = error;
        best = palette;
      }
    }

    return best;
  }
}
