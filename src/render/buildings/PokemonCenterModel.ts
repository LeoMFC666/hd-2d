import * as THREE from 'three';

/**
 * Modelo 3D do CENTRO POKEMON (FireRed/LeafGreen).
 *
 * Como o ginasio, o Centro Pokemon do FRLG e sempre a mesma combinacao de
 * metatiles do tileset PRIMARIO, em qualquer cidade: 5 de largura x 5 de
 * altura (medido em Pewter, porta 0x062 na coluna 2).
 *
 *   linha 0  17B 17C 17D 17E 17F   beirada do telhado (calcada em cima)
 *   linha 1  048 049 04A 04B 187   telhado vermelho
 *   linha 2  050 051 052 053 18F   telhado (aba arredondada da frente)
 *   linha 3  058 059 05A 05B 197   fachada (janelas, placa da Poke Bola)
 *   linha 4  060 061 062 186 19F   fachada (placa P.C, porta 062)
 *
 * O modelo: corpo em caixa, fachada em pe com a arte das linhas 3-4,
 * telhado de QUATRO aguas (o do GBA e arredondado dos lados) com a arte
 * das linhas 0-2 projetada de cima - visto pela camera, o desenho fica
 * igual ao do jogo. Entrada saliente com a porta, e a placa da Poke Bola
 * como cobertura presa no teto e inclinada ate a frente (como no ginasio).
 */

export const FRLG_POKEMON_CENTER_TEMPLATE: readonly (readonly number[])[] = [
  [0x17b, 0x17c, 0x17d, 0x17e, 0x17f],
  [0x048, 0x049, 0x04a, 0x04b, 0x187],
  [0x050, 0x051, 0x052, 0x053, 0x18f],
  [0x058, 0x059, 0x05a, 0x05b, 0x197],
  [0x060, 0x061, 0x062, 0x186, 0x19f],
];

export const POKEMON_CENTER_WIDTH = 5;

export const POKEMON_CENTER_HEIGHT = 5;

const PX = 16;

// Parede da fachada onde a arte da fachada termina no GBA: no fim da linha
// da porta, menos as linhas vazias do pe da porta (ver `lift`). Assim a
// base do predio encosta na calcada da frente, como no jogo.
const FACADE_SHIFT = 2;

export interface PokemonCenterArt {
  // Arte do bloco 5x5 (80x80 px), RGBA, linhas de cima para baixo.
  rgba: Uint8Array;
}

const ART_WIDTH = POKEMON_CENTER_WIDTH * PX;

function crop(art: PokemonCenterArt, x: number, y: number, w: number, h: number): THREE.DataTexture {
  const data = new Uint8Array(w * h * 4);

  // DataTexture: linhas de baixo para cima.
  for (let row = 0; row < h; row++) {
    const source = ((y + row) * ART_WIDTH + x) * 4;
    data.set(art.rgba.subarray(source, source + w * 4), (h - 1 - row) * w * 4);
  }

  const texture = new THREE.DataTexture(data, w, h, THREE.RGBAFormat);
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;

  return texture;
}

function pixel(art: PokemonCenterArt, x: number, y: number): THREE.Color {
  const o = (y * ART_WIDTH + x) * 4;

  return new THREE.Color().setRGB(art.rgba[o] / 255, art.rgba[o + 1] / 255, art.rgba[o + 2] / 255, THREE.SRGBColorSpace);
}

function plain(color: THREE.Color, shade: number): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({ color: color.clone().multiplyScalar(shade) });
}

function textured(map: THREE.Texture, shade = 1): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({ map, color: new THREE.Color(shade, shade, shade), transparent: true, alphaTest: 0.5 });
}

/**
 * Monta o Centro Pokemon com o canto noroeste do bloco 5x5 na origem (x
 * para leste, z para o sul, 1 unidade = 1 metatile).
 */
export function buildPokemonCenterModel(art: PokemonCenterArt): THREE.Group {
  const root = new THREE.Group();
  root.name = 'pokemon-center';

  // Medidas na ARTE (linha 3 = inicio da fachada); no mundo, deslocado
  // para o sul (FACADE_SHIFT, ajustado por `lift` mais abaixo).
  const group = new THREE.Group();
  group.position.z = FACADE_SHIFT;
  root.add(group);

  const entrance = new THREE.Group();
  entrance.name = 'entrance';
  group.add(entrance);
  root.userData.entrance = entrance;

  const width = POKEMON_CENTER_WIDTH;
  const wallHeight = 2;
  const front = 3; // fachada na linha 3
  const back = 0.35; // a linha 0 comeca com calcada
  const door = 2;

  // A arte do Centro Pokemon termina alguns pixels ACIMA do fim da linha
  // da porta (o resto e chao, que fica transparente). Sem compensar, a
  // fachada flutua e parece fora do lugar. `lift` = linhas vazias no pe da
  // porta; os recortes da fachada sobem esse tanto para a base da arte
  // encostar no chao.
  let lift = 0;

  for (let y = 5 * PX - 1; y >= 4 * PX; y--) {
    let opaque = false;

    for (let x = door * PX; x < (door + 1) * PX && !opaque; x++) {
      opaque = art.rgba[(y * ART_WIDTH + x) * 4 + 3] !== 0;
    }

    if (opaque) {
      break;
    }

    lift++;
  }

  const facadeTop = 3 * PX - lift;

  group.position.z = FACADE_SHIFT - lift / PX;
  const doorRowTop = 4 * PX - lift;

  // Cores tiradas da arte: parede branca, vermelho do telhado.
  const wall = pixel(art, 5, doorRowTop + 3);
  const roofRed = pixel(art, 2 * PX + 8, 1 * PX + 8);

  // Corpo: laterais e fundo com as faixas da fachada (uma coluna de parede
  // lisa, esticada).
  const depth = front - back;
  const side = crop(art, 4, facadeTop, 1, 2 * PX);

  const body = new THREE.Mesh(
    new THREE.BoxGeometry(width - 0.04, wallHeight, depth),
    [
      textured(side, 0.82), // leste
      textured(side, 0.72), // oeste
      plain(roofRed, 0.8), // topo (escondido pelo telhado)
      plain(wall, 0.5),
      // Frente invisivel: nas quinas chanfradas da fachada a arte e
      // transparente e mostrava o branco do corpo; agora mostra o chao.
      new THREE.MeshBasicMaterial({ visible: false }),
      textured(side, 0.6), // fundo
    ],
  );
  body.position.set(width / 2, wallHeight / 2, back + depth / 2);
  group.add(body);

  // Fachada: linhas 3-4 em pe.
  const facade = new THREE.Mesh(
    new THREE.PlaneGeometry(width, wallHeight),
    textured(crop(art, 0, facadeTop, width * PX, 2 * PX), 0.96),
  );
  facade.position.set(width / 2, wallHeight / 2, front + 0.001);
  group.add(facade);

  // Entrada: moldura branca com a porta (linha 4), saindo da parede.
  const porchX0 = door - 0.42;
  const porchX1 = door + 1.42;
  const porchWidth = porchX1 - porchX0;
  const porchDepth = 0.3;
  const porchSide = textured(crop(art, 4, doorRowTop, 1, PX), 0.75);
  const porch = new THREE.Mesh(
    new THREE.BoxGeometry(porchWidth, 1, porchDepth),
    [porchSide, porchSide, plain(wall, 0.92), plain(wall, 0.5),
      textured(crop(art, Math.round(porchX0 * PX), doorRowTop, Math.round(porchWidth * PX), PX)),
      plain(wall, 0.6)],
  );
  porch.position.set((porchX0 + porchX1) / 2, 0.5, front + porchDepth / 2);
  entrance.add(porch);

  // Placa da Poke Bola (linha 3, acima da porta): cobertura presa na
  // parede na altura do teto e inclinada ate a frente da entrada.
  const canopyDepth = 0.85;
  const canopyThickness = 0.08;
  const canopyOverhang = 0.06;
  const canopyArt = crop(art, Math.round(porchX0 * PX), facadeTop, Math.round(porchWidth * PX), PX);
  const canopyEdge = plain(pixel(art, door * PX + 8, facadeTop + 2), 0.75);
  const canopy = new THREE.Mesh(
    new THREE.BoxGeometry(porchWidth + canopyOverhang * 2, canopyThickness, canopyDepth),
    [canopyEdge, canopyEdge, textured(canopyArt), canopyEdge, canopyEdge, canopyEdge],
  );

  const canopyHingeHeight = wallHeight;
  const canopyFrontHeight = wallHeight - 0.5;
  const canopyAngle = Math.asin(
    THREE.MathUtils.clamp((canopyHingeHeight - canopyFrontHeight) / canopyDepth, -1, 1),
  );

  const canopyHinge = new THREE.Group();
  canopyHinge.position.set((porchX0 + porchX1) / 2, canopyHingeHeight, front);
  canopyHinge.rotation.x = canopyAngle;
  entrance.add(canopyHinge);

  canopy.position.set(0, -canopyThickness / 2, canopyDepth / 2);
  canopyHinge.add(canopy);

  // Parede lisa onde a arte tinha a placa (agora na cobertura).
  const behind = new THREE.Mesh(
    new THREE.PlaneGeometry(porchWidth, 1),
    textured(crop(art, 4, facadeTop, 1, PX), 0.96),
  );
  behind.position.set((porchX0 + porchX1) / 2, 1.5, front + 0.002);
  entrance.add(behind);

  // Telhado de quatro aguas: cumeeira ao longo do x, quatro faces. A arte
  // das linhas 0-2 vai projetada de cima (u pelo x, v pelo z), entao a
  // borda arredondada do desenho fica nas beiradas do telhado.
  const overhang = 0.12;
  const rise = 0.55;
  const inset = 0.9; // recuo das aguas laterais
  const x0 = -overhang;
  const x1 = width + overhang;
  const z0 = back - overhang;
  const z1 = front + overhang;
  const zm = (z0 + z1) / 2;
  const y0 = wallHeight;
  const y1 = wallHeight + rise;
  const rx0 = x0 + inset;
  const rx1 = x1 - inset;

  const roofTexture = crop(art, 0, Math.round(back * PX), width * PX, Math.round((front - back) * PX) - lift);
  const uv = (x: number, z: number): [number, number] => [(x - x0) / (x1 - x0), 1 - (z - z0) / (z1 - z0)];

  const corners = {
    nw: [x0, y0, z0], ne: [x1, y0, z0], se: [x1, y0, z1], sw: [x0, y0, z1],
    rw: [rx0, y1, zm], re: [rx1, y1, zm],
  } as const;

  const faces: Array<Array<keyof typeof corners>> = [
    ['sw', 'se', 're', 'rw'], // frente
    ['ne', 'nw', 'rw', 're'], // fundo
    ['nw', 'sw', 'rw'], // oeste
    ['se', 'ne', 're'], // leste
  ];

  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  for (const face of faces) {
    const start = positions.length / 3;

    for (const name of face) {
      const [x, y, z] = corners[name];
      positions.push(x, y, z);
      uvs.push(...uv(x, z));
    }

    indices.push(start, start + 1, start + 2);

    if (face.length === 4) {
      indices.push(start, start + 2, start + 3);
    }
  }

  const roofGeometry = new THREE.BufferGeometry();
  roofGeometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  roofGeometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  roofGeometry.setIndex(indices);

  const roof = new THREE.Mesh(roofGeometry, textured(roofTexture));
  roof.material.side = THREE.DoubleSide;
  group.add(roof);

  // Porta animada (DoorAnimator), como no ginasio.
  const doorPlane = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({ transparent: true, alphaTest: 0.5 }),
  );
  doorPlane.position.set(door + 0.5, 0.5, front + porchDepth + 0.003);
  doorPlane.visible = false;
  doorPlane.userData.door = true;

  const closed = new Uint8Array(PX * PX * 4);

  for (let row = 0; row < PX; row++) {
    const source = ((doorRowTop + row) * ART_WIDTH + door * PX) * 4;
    closed.set(art.rgba.subarray(source, source + PX * 4), row * PX * 4);
  }

  doorPlane.userData.closedArt = closed;
  entrance.add(doorPlane);

  return root;
}

/**
 * Acha os Centros Pokemon num mapa do FRLG (canto noroeste do bloco 5x5).
 * Confere as linhas 1-4; a linha 0 (beirada) pode variar com a cidade, e
 * na linha da porta as duas quinas tambem: em Saffron o predio fica na
 * calcada e as quinas sao tiles da cidade (0x2DF e 0x307 no lugar de 0x060
 * e 0x19F).
 */
export function findPokemonCenters(
  width: number,
  height: number,
  metatileAt: (x: number, y: number) => number,
): Array<{ x: number; y: number }> {
  const found: Array<{ x: number; y: number }> = [];

  for (let y = 0; y + POKEMON_CENTER_HEIGHT <= height; y++) {
    for (let x = 0; x + POKEMON_CENTER_WIDTH <= width; x++) {
      let match = true;

      for (let row = 1; row < POKEMON_CENTER_HEIGHT && match; row++) {
        for (let col = 0; col < POKEMON_CENTER_WIDTH && match; col++) {
          const corner = row === POKEMON_CENTER_HEIGHT - 1 && (col === 0 || col === POKEMON_CENTER_WIDTH - 1);

          match = corner || metatileAt(x + col, y + row) === FRLG_POKEMON_CENTER_TEMPLATE[row][col];
        }
      }

      if (match) {
        found.push({ x, y });
      }
    }
  }

  return found;
}
