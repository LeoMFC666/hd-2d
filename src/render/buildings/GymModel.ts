import * as THREE from 'three';

/**
 * Modelo 3D do GINASIO (FireRed/LeafGreen).
 *
 * O ginasio do FRLG e sempre a mesma combinacao de metatiles do tileset
 * PRIMARIO (0x139-0x15E), em qualquer cidade: 7 de largura x 5 de altura.
 *
 *   linha 0  139 13A 13A 13A 13A 13A 13B   beirada do telhado
 *   linha 1  141 142 142 142 142 142 143   telhado
 *   linha 2  149 14A 14A 14A 14A 14A 14B   telhado (aba de baixo)
 *   linha 3  150 151 152 153 154 155 156   fachada (janelas, emblema)
 *   linha 4  158 159 15A 15B 15C 15D 15E   fachada (placa GYM, porta 15B)
 *
 * O modelo: corpo em caixa ocupando as linhas do telhado, fachada em pe
 * com a arte das linhas 3-4, telhado com caimento leve e a arte das linhas
 * 0-2, entrada saliente na frente da porta. Laterais e fundo em cor lisa
 * tirada da propria arte. Os tiles do ginasio no chao sao trocados por
 * grama e o modelo e posto no lugar.
 */

export const FRLG_GYM_TEMPLATE: readonly (readonly number[])[] = [
  [0x139, 0x13a, 0x13a, 0x13a, 0x13a, 0x13a, 0x13b],
  [0x141, 0x142, 0x142, 0x142, 0x142, 0x142, 0x143],
  [0x149, 0x14a, 0x14a, 0x14a, 0x14a, 0x14a, 0x14b],
  [0x150, 0x151, 0x152, 0x153, 0x154, 0x155, 0x156],
  [0x158, 0x159, 0x15a, 0x15b, 0x15c, 0x15d, 0x15e],
];

const PX = 16;

export interface GymArt {
  // Arte do ginasio inteiro (7x5 metatiles = 112x80 px), RGBA, linhas de
  // cima para baixo.
  rgba: Uint8Array;
}

function crop(art: GymArt, x: number, y: number, w: number, h: number): THREE.DataTexture {
  const fullWidth = 7 * PX;
  const data = new Uint8Array(w * h * 4);

  // DataTexture: linhas de baixo para cima.
  for (let row = 0; row < h; row++) {
    const source = ((y + row) * fullWidth + x) * 4;
    data.set(art.rgba.subarray(source, source + w * 4), (h - 1 - row) * w * 4);
  }

  const texture = new THREE.DataTexture(data, w, h, THREE.RGBAFormat);
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;

  return texture;
}

function pixel(art: GymArt, x: number, y: number): THREE.Color {
  const o = (y * 7 * PX + x) * 4;

  return new THREE.Color().setRGB(art.rgba[o] / 255, art.rgba[o + 1] / 255, art.rgba[o + 2] / 255, THREE.SRGBColorSpace);
}

function plain(color: THREE.Color, shade: number): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({ color: color.clone().multiplyScalar(shade) });
}

function textured(map: THREE.Texture, shade = 1): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({ map, color: new THREE.Color(shade, shade, shade), transparent: true, alphaTest: 0.5 });
}

/**
 * Monta o ginasio com o canto noroeste do bloco 7x5 na origem (x para
 * leste, z para o sul, 1 unidade = 1 metatile).
 */
export function buildGymModel(art: GymArt): THREE.Group {
  const group = new THREE.Group();
  group.name = 'gym';

  const width = 7;
  const wallHeight = 2;
  const roofFront = 3; // fachada na linha 3
  const roofBack = 0.3; // a linha 0 comeca com calcada

  const wall = pixel(art, 4, 4 * PX + 4);
  const roofEdge = pixel(art, 3 * PX, 2 * PX + 14);

  // Laterais e fundo: parede com as mesmas faixas da fachada.
  const depth = roofFront - roofBack;
  // Uma coluna so da fachada (sem janela nem contorno), esticada: as
  // faixas horizontais da frente continuam nas laterais, sem listras.
  const side = crop(art, 6, 3 * PX, 1, 2 * PX);

  const body = new THREE.Mesh(
    new THREE.BoxGeometry(width - 0.04, wallHeight, depth),
    [
      textured(side, 0.82), // leste
      textured(side, 0.72), // oeste
      plain(roofEdge, 1), // topo (escondido pelo telhado)
      plain(wall, 0.5),
      plain(wall, 0.88), // frente (coberta pela fachada)
      textured(side, 0.6), // fundo
    ],
  );
  body.position.set(width / 2, wallHeight / 2, roofBack + depth / 2);
  group.add(body);

  // Fachada: linhas 3-4 em pe na frente do corpo.
  const facade = new THREE.Mesh(
    new THREE.PlaneGeometry(width, wallHeight),
    textured(crop(art, 0, 3 * PX, width * PX, 2 * PX), 0.95),
  );
  facade.position.set(width / 2, wallHeight / 2, roofFront + 0.001);
  group.add(facade);

  // Entrada: a porta (linha 4) sai da parede numa caixa de 1 tile de
  // altura; a Poke Bola (linha 3) e a COBERTURA dela - um telhado deitado,
  // inclinado da parede ate a frente da entrada, cobrindo esse trecho da
  // fachada.
  const porchX0 = 2.55;
  const porchX1 = 4.45;
  const porchWidth = porchX1 - porchX0;
  const porchDepth = 0.7;
  const porchSide = textured(crop(art, 6, 4 * PX, 1, PX), 0.75);
  const porch = new THREE.Mesh(
    new THREE.BoxGeometry(porchWidth, 1, porchDepth),
    [porchSide, porchSide, plain(wall, 0.9), plain(wall, 0.5),
      textured(crop(art, Math.round(porchX0 * PX), 4 * PX, Math.round(porchWidth * PX), PX)),
      plain(wall, 0.6)],
  );
  porch.position.set((porchX0 + porchX1) / 2, 0.5, roofFront + porchDepth / 2);
  group.add(porch);

  const canopyOverhang = 0.08;
  const cx0 = porchX0 - canopyOverhang;
  const cx1 = porchX1 + canopyOverhang;
  const cz0 = roofFront;
  const cz1 = roofFront + porchDepth + canopyOverhang;
  const cyBack = wallHeight - 0.05;
  const cyFront = 1;
  const canopyGeometry = new THREE.BufferGeometry();

  canopyGeometry.setAttribute('position', new THREE.Float32BufferAttribute([
    cx0, cyFront, cz1, cx1, cyFront, cz1, cx1, cyBack, cz0, cx0, cyBack, cz0,
  ], 3));
  canopyGeometry.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
  canopyGeometry.setIndex([0, 1, 2, 0, 2, 3]);

  const canopy = new THREE.Mesh(
    canopyGeometry,
    textured(crop(art, Math.round(porchX0 * PX), 3 * PX, Math.round(porchWidth * PX), PX)),
  );
  canopy.material.side = THREE.DoubleSide;
  group.add(canopy);

  // Laterais triangulares da cobertura.
  const canopySides = new THREE.BufferGeometry();
  canopySides.setAttribute('position', new THREE.Float32BufferAttribute([
    cx0, cyFront, cz1, cx0, cyBack, cz0, cx0, cyFront, cz0,
    cx1, cyFront, cz0, cx1, cyBack, cz0, cx1, cyFront, cz1,
  ], 3));
  group.add(new THREE.Mesh(canopySides, new THREE.MeshBasicMaterial({ color: pixel(art, 3 * PX + 8, 3 * PX + 2).multiplyScalar(0.6), side: THREE.DoubleSide })));

  // Telhado: duas aguas rasas com a arte das linhas 0-2 (beirada a beirada),
  // um pouco maior que o corpo (beiral).
  const overhang = 0.12;
  const rise = 0.35;
  const roofTexture = crop(art, 0, Math.round(roofBack * PX), width * PX, Math.round((roofFront - roofBack) * PX));
  const roofGeometry = new THREE.BufferGeometry();
  const x0 = -overhang;
  const x1 = width + overhang;
  const z0 = roofBack - overhang;
  const z1 = roofFront + overhang;
  const zm = (z0 + z1) / 2;
  const y0 = wallHeight;
  const y1 = wallHeight + rise;

  roofGeometry.setAttribute('position', new THREE.Float32BufferAttribute([
    x0, y0, z1, x1, y0, z1, x1, y1, zm, x0, y1, zm, // agua da frente
    x0, y1, zm, x1, y1, zm, x1, y0, z0, x0, y0, z0, // agua de tras
  ], 3));
  roofGeometry.setAttribute('uv', new THREE.Float32BufferAttribute([
    0, 0, 1, 0, 1, 0.5, 0, 0.5,
    0, 0.5, 1, 0.5, 1, 1, 0, 1,
  ], 2));
  roofGeometry.setIndex([0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7]);

  const roof = new THREE.Mesh(roofGeometry, textured(roofTexture));
  roof.material.side = THREE.DoubleSide;
  group.add(roof);

  // Oitoes (triangulos laterais do telhado).
  const gable = new THREE.BufferGeometry();
  gable.setAttribute('position', new THREE.Float32BufferAttribute([
    x0, y0, z1, x0, y1, zm, x0, y0, z0,
    x1, y0, z0, x1, y1, zm, x1, y0, z1,
  ], 3));
  group.add(new THREE.Mesh(gable, new THREE.MeshBasicMaterial({ color: roofEdge.clone().multiplyScalar(0.75), side: THREE.DoubleSide })));

  return group;
}

/** Acha o ginasio num mapa (posicoes do canto noroeste dos blocos 7x5). */
export function findGyms(width: number, height: number, metatileAt: (x: number, y: number) => number): Array<{ x: number; y: number }> {
  const found: Array<{ x: number; y: number }> = [];

  for (let y = 0; y + 5 <= height; y++) {
    for (let x = 0; x + 7 <= width; x++) {
      // A beirada (linha 0) pode estar coberta; confere da linha 1 em diante.
      let match = true;

      for (let row = 1; row < 5 && match; row++) {
        for (let col = 0; col < 7 && match; col++) {
          match = metatileAt(x + col, y + row) === FRLG_GYM_TEMPLATE[row][col];
        }
      }

      if (match) {
        found.push({ x, y });
      }
    }
  }

  return found;
}
