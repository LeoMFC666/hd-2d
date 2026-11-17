import * as THREE from 'three';

/**
 * Modelo 3D do POKE MART (FireRed/LeafGreen).
 *
 * Bloco fixo de 4x4 metatiles do tileset PRIMARIO (medido em Pewter):
 *
 *   linha 0  028 029 02A 02B   telhado azul (comeca com chao em cima)
 *   linha 1  030 031 032 033   telhado
 *   linha 2  038 039 03A 03B   beiral + placa da Poke Bola pendurada
 *   linha 3  040 041 062 063   fachada (placa MART, porta 062)
 *
 * Diferente do Centro Pokemon, a fachada tem so ~1 tile de altura e a
 * placa da Poke Bola fica pendurada no beiral (linha 2), sobre a fachada.
 *
 * Os erros do Centro Pokemon ja vem tratados:
 *  - chao: a arte chega SEM o chao (BuildingSubstitution.prepare); a
 *    porta 062 esta na camada de baixo e nao vai para o chao;
 *  - altura: as medidas saem da propria arte (onde o telhado acaba, onde a
 *    fachada acaba), nao de linhas inteiras;
 *  - posicao: a parede fica onde a arte da fachada termina no GBA, entao a
 *    base encosta na calcada da frente.
 */

export const FRLG_POKE_MART_TEMPLATE: readonly (readonly number[])[] = [
  [0x028, 0x029, 0x02a, 0x02b],
  [0x030, 0x031, 0x032, 0x033],
  [0x038, 0x039, 0x03a, 0x03b],
  [0x040, 0x041, 0x062, 0x063],
];

export const POKE_MART_WIDTH = 4;

export const POKE_MART_HEIGHT = 4;

const PX = 16;

const ART_WIDTH = POKE_MART_WIDTH * PX;

const ART_HEIGHT = POKE_MART_HEIGHT * PX;

// Coluna da porta e area da placa da Poke Bola na arte (px).
const DOOR = 2;

const SIGN_X0 = 16;

const SIGN_X1 = 48;

// Altura da parede: menor que a do Centro Pokemon (2), bem maior que o
// jogador. A porta fica com 1 tile, como nas outras construcoes.
const WALL_HEIGHT = 1.5;

// Linhas do topo da fachada onde ainda aparece a ponta da placa.
const SIGN_TIP_ROWS = 3;

// Placa no mesmo tamanho de pixel da placa do Centro Pokemon (a do Centro
// tem 16 px de arte em 0.85 de laje): 18 px de arte -> ~0.96.
const SIGN_SCALE = 0.85;

export interface PokeMartArt {
  // Arte do bloco 4x4 (64x64 px) ja sem o chao, RGBA, de cima para baixo.
  rgba: Uint8Array;
}

function crop(art: PokeMartArt, x: number, y: number, w: number, h: number): THREE.DataTexture {
  const data = new Uint8Array(w * h * 4);

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

function pixel(art: PokeMartArt, x: number, y: number): THREE.Color {
  const o = (y * ART_WIDTH + x) * 4;

  return new THREE.Color().setRGB(art.rgba[o] / 255, art.rgba[o + 1] / 255, art.rgba[o + 2] / 255, THREE.SRGBColorSpace);
}

function plain(color: THREE.Color, shade: number): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({ color: color.clone().multiplyScalar(shade) });
}

function textured(map: THREE.Texture, shade = 1): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({ map, color: new THREE.Color(shade, shade, shade), transparent: true, alphaTest: 0.5 });
}

const opaque = (art: PokeMartArt, x: number, y: number): boolean =>
  art.rgba[(y * ART_WIDTH + x) * 4 + 3] !== 0;

/** Primeira e ultima linha com pixel opaco nas colunas [x0, x1). */
function rowsWithArt(art: PokeMartArt, x0: number, x1: number): [number, number] {
  let first = ART_HEIGHT;
  let last = -1;

  for (let y = 0; y < ART_HEIGHT; y++) {
    for (let x = x0; x < x1; x++) {
      if (opaque(art, x, y)) {
        first = Math.min(first, y);
        last = y;
        break;
      }
    }
  }

  return [first, last];
}

/** Cores do telhado (linhas de cima, fora das bordas arredondadas). */
function roofColors(art: PokeMartArt, roofTop: number, signFirstRow: number): Set<number> {
  const colors = new Set<number>();

  for (let y = roofTop; y < signFirstRow; y++) {
    for (let x = SIGN_X0 - 8; x < SIGN_X1 + 8; x++) {
      const o = (y * ART_WIDTH + x) * 4;

      if (art.rgba[o + 3] !== 0) {
        colors.add((art.rgba[o] << 16) | (art.rgba[o + 1] << 8) | art.rgba[o + 2]);
      }
    }
  }

  return colors;
}

/** Preenche a partir da borda tirando os pixels com cor de telhado. */
function clearRoofAroundSign(texture: THREE.DataTexture, colors: Set<number>): void {
  const { data, width, height } = texture.image as { data: Uint8Array; width: number; height: number };
  const seen = new Uint8Array(width * height);
  const stack: number[] = [];

  const push = (x: number, y: number): void => {
    if (x < 0 || y < 0 || x >= width || y >= height) {
      return;
    }

    const index = y * width + x;

    if (seen[index]) {
      return;
    }

    seen[index] = 1;

    const o = index * 4;

    if (data[o + 3] !== 0 && !colors.has((data[o] << 16) | (data[o + 1] << 8) | data[o + 2])) {
      return;
    }

    data[o + 3] = 0;
    stack.push(x, y);
  };

  for (let x = 0; x < width; x++) {
    push(x, 0);
    push(x, height - 1);
  }

  for (let y = 0; y < height; y++) {
    push(0, y);
    push(width - 1, y);
  }

  while (stack.length > 0) {
    const y = stack.pop()!;
    const x = stack.pop()!;

    push(x + 1, y);
    push(x - 1, y);
    push(x, y + 1);
    push(x, y - 1);
  }

  texture.needsUpdate = true;
}

/**
 * Monta o Poke Mart com o canto noroeste do bloco 4x4 na origem (x leste,
 * z sul, 1 unidade = 1 metatile).
 */
export function buildPokeMartModel(art: PokeMartArt): THREE.Group {
  const root = new THREE.Group();
  root.name = 'poke-mart';
  root.userData.art = art.rgba;

  const width = POKE_MART_WIDTH;

  // Medidas tiradas da arte. Coluna 0 (sem a placa): onde o telhado
  // comeca e onde a fachada termina. O fim do telhado na coluna 0 e a
  // linha mais escura da beirada antes do branco da fachada: procura, de
  // baixo para cima, a ultima linha da fachada clara.
  const [roofTop, facadeBottom] = rowsWithArt(art, 0, PX);

  let facadeTop = facadeBottom;

  // Sobe pela coluna 4 (parede lisa) enquanto o pixel for claro (parede).
  for (let y = facadeBottom; y >= 2 * PX; y--) {
    const o = (y * ART_WIDTH + 4) * 4;
    const light = art.rgba[o] + art.rgba[o + 1] + art.rgba[o + 2] > 3 * 150;

    if (!light && y < facadeBottom - 4) {
      break;
    }

    facadeTop = y;
  }

  // Posicao: a parede fica onde a fachada termina na arte do GBA (em
  // tiles do bloco), entao a base encosta na calcada da frente.
  const front = (facadeBottom + 1) / PX;
  // A fachada da arte tem so ~1 tile (porta + placa MART). Regras:
  //  - a PORTA tem a mesma altura das do Centro Pokemon e dos ginasios
  //    (1 tile): a fachada da arte fica em tamanho natural, sem esticar;
  //  - o predio e obrigatoriamente MENOR que o Centro Pokemon (parede 2),
  //    mas o jogador nunca pode parecer ter 70-75% do tamanho dele.
  // Por isso a parede tem WALL_HEIGHT (1.5): a fachada da arte embaixo e
  // uma faixa de parede lisa por cima, ate o beiral.
  const artWall = (facadeBottom + 1 - facadeTop) / PX;
  const wallHeight = Math.max(artWall, WALL_HEIGHT);
  const back = roofTop / PX;
  const depth = Math.max(0.5, facadeTop / PX - back);

  const group = new THREE.Group();
  root.add(group);

  const entrance = new THREE.Group();
  entrance.name = 'entrance';
  group.add(entrance);
  root.userData.entrance = entrance;

  const wall = pixel(art, 4, facadeTop + 2);
  const roofBlue = pixel(art, PX + 8, PX + 8);

  // Corpo: da parede para tras, a profundidade do telhado na arte.
  const side = crop(art, 4, facadeTop, 1, facadeBottom + 1 - facadeTop);

  const body = new THREE.Mesh(
    new THREE.BoxGeometry(width - 0.04, wallHeight, depth),
    [
      textured(side, 0.82),
      textured(side, 0.72),
      plain(roofBlue, 0.8),
      plain(wall, 0.5),
      // Frente do corpo invisivel: nas quinas chanfradas da fachada a arte
      // e transparente e mostrava o branco do corpo; agora mostra o chao.
      new THREE.MeshBasicMaterial({ visible: false }),
      textured(side, 0.6),
    ],
  );
  body.position.set(width / 2, wallHeight / 2, front - depth / 2);
  group.add(body);

  // Fachada: a faixa da arte entre o fim do telhado e o pe, em tamanho
  // natural (porta de 1 tile). A ponta de baixo da placa da Poke Bola entra
  // nas primeiras linhas da fachada; ali vira parede (a placa ja esta
  // inteira no quadro em pe) - senao aparecem duas placas.
  const facadeTexture = crop(art, 0, facadeTop, ART_WIDTH, facadeBottom + 1 - facadeTop);
  const facadeImage = facadeTexture.image as { data: Uint8Array; width: number; height: number };

  for (let row = 0; row < SIGN_TIP_ROWS && row < facadeImage.height; row++) {
    const y = facadeImage.height - 1 - row; // textura de baixo para cima
    const wallSource = (y * facadeImage.width + SIGN_X0 - 4) * 4;

    for (let x = SIGN_X0; x < SIGN_X1; x++) {
      facadeImage.data.set(
        facadeImage.data.subarray(wallSource, wallSource + 4),
        (y * facadeImage.width + x) * 4,
      );
    }
  }

  facadeTexture.needsUpdate = true;

  const facade = new THREE.Mesh(
    new THREE.PlaneGeometry(width, artWall),
    textured(facadeTexture, 0.96),
  );
  facade.position.set(width / 2, artWall / 2, front + 0.001);
  group.add(facade);

  // Acima dela, ate o beiral: parede lisa (uma coluna de parede da
  // fachada, esticada - sem pedaco de placa).
  if (wallHeight > artWall) {
    const band = new THREE.Mesh(
      new THREE.PlaneGeometry(width, wallHeight - artWall),
      textured(crop(art, 4, facadeTop + SIGN_TIP_ROWS, 1, 2), 0.96),
    );
    band.position.set(width / 2, (artWall + wallHeight) / 2, front + 0.001);
    group.add(band);
  }

  // Telhado de quatro aguas com a arte de cima (do comeco do telhado ate o
  // fim do beiral), projetada de cima.
  const overhang = 0.1;
  const rise = 0.45;
  const inset = 0.75;
  const x0 = -overhang;
  const x1 = width + overhang;
  const z0 = front - depth - overhang;
  const z1 = front + overhang;
  const zm = (z0 + z1) / 2;
  const y0 = wallHeight;
  const y1 = wallHeight + rise;
  const rx0 = x0 + inset;
  const rx1 = x1 - inset;

  // Na arte do telhado, a placa da Poke Bola vira cor de telhado (a placa
  // vai num quadro proprio, em pe, na frente do beiral).
  const roofRows = facadeTop - roofTop;
  const roofData = new Uint8Array(ART_WIDTH * roofRows * 4);

  roofData.set(art.rgba.subarray(roofTop * ART_WIDTH * 4, facadeTop * ART_WIDTH * 4));

  const [signTop] = rowsWithArt(art, SIGN_X0 + 8, SIGN_X1 - 8);
  const signFirstRow = Math.max(signTop, 2 * PX - 4);

  // Tapa a placa no telhado copiando o telhado de 1 tile acima (o desenho
  // do telhado se repete a cada 16 px na vertical).
  for (let y = signFirstRow; y < facadeTop; y++) {
    let sourceY = y - PX;

    while (sourceY >= signFirstRow) {
      sourceY -= PX;
    }

    sourceY = Math.max(roofTop, sourceY);

    for (let x = SIGN_X0; x < SIGN_X1; x++) {
      const source = (sourceY * ART_WIDTH + x) * 4;
      const target = ((y - roofTop) * ART_WIDTH + x) * 4;

      roofData.set(art.rgba.subarray(source, source + 4), target);
    }
  }

  const roofFlipped = new Uint8Array(ART_WIDTH * roofRows * 4);

  for (let row = 0; row < roofRows; row++) {
    roofFlipped.set(
      roofData.subarray(row * ART_WIDTH * 4, (row + 1) * ART_WIDTH * 4),
      (roofRows - 1 - row) * ART_WIDTH * 4,
    );
  }

  const roofTexture = new THREE.DataTexture(roofFlipped, ART_WIDTH, roofRows, THREE.RGBAFormat);
  roofTexture.magFilter = THREE.NearestFilter;
  roofTexture.minFilter = THREE.NearestFilter;
  roofTexture.colorSpace = THREE.SRGBColorSpace;
  roofTexture.needsUpdate = true;

  const uv = (x: number, z: number): [number, number] => [(x - x0) / (x1 - x0), 1 - (z - z0) / (z1 - z0)];

  const corners = {
    nw: [x0, y0, z0], ne: [x1, y0, z0], se: [x1, y0, z1], sw: [x0, y0, z1],
    rw: [rx0, y1, zm], re: [rx1, y1, zm],
  } as const;

  const faces: Array<Array<keyof typeof corners>> = [
    ['sw', 'se', 're', 'rw'],
    ['ne', 'nw', 'rw', 're'],
    ['nw', 'sw', 'rw'],
    ['se', 'ne', 're'],
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

  // Placa da Poke Bola: em pe, na frente do beiral, com o pe dela no topo
  // da fachada (como no GBA, onde ela fica pendurada sobre a parede).
  // No recorte da placa sobra telhado em volta: as cores do telhado
  // ligadas a borda do recorte (preenchimento a partir da borda) ficam
  // transparentes; o azul da Poke Bola, cercado pelo branco, fica.
  const signHeight = ((facadeTop - signFirstRow) / PX) * SIGN_SCALE;
  const signTexture = crop(art, SIGN_X0, signFirstRow, SIGN_X1 - SIGN_X0, facadeTop - signFirstRow);

  clearRoofAroundSign(signTexture, roofColors(art, roofTop, signFirstRow));

  const sign = new THREE.Mesh(
    new THREE.PlaneGeometry((SIGN_X1 - SIGN_X0) / PX, signHeight),
    textured(signTexture),
  );
  sign.material.side = THREE.DoubleSide;
  sign.position.set((SIGN_X0 + SIGN_X1) / 2 / PX, wallHeight + signHeight / 2, front + overhang + 0.01);
  entrance.add(sign);

  // Porta: plano da animacao (DoorAnimator) rente a fachada.
  const doorPlane = new THREE.Mesh(
    new THREE.PlaneGeometry(1, artWall),
    new THREE.MeshBasicMaterial({ transparent: true, alphaTest: 0.5 }),
  );
  doorPlane.position.set(DOOR + 0.5, artWall / 2, front + 0.004);
  doorPlane.visible = false;
  doorPlane.userData.door = true;

  const closed = new Uint8Array(PX * PX * 4);
  const doorTop = Math.max(0, facadeBottom + 1 - PX);

  for (let row = 0; row < PX; row++) {
    const source = ((doorTop + row) * ART_WIDTH + DOOR * PX) * 4;
    closed.set(art.rgba.subarray(source, source + PX * 4), row * PX * 4);
  }

  doorPlane.userData.closedArt = closed;
  entrance.add(doorPlane);

  return root;
}

/** Acha os Poke Marts (canto noroeste do bloco 4x4) pelas linhas 1-3. */
export function findPokeMarts(
  width: number,
  height: number,
  metatileAt: (x: number, y: number) => number,
): Array<{ x: number; y: number }> {
  const found: Array<{ x: number; y: number }> = [];

  for (let y = 0; y + POKE_MART_HEIGHT <= height; y++) {
    for (let x = 0; x + POKE_MART_WIDTH <= width; x++) {
      let match = true;

      for (let row = 1; row < POKE_MART_HEIGHT && match; row++) {
        for (let col = 0; col < POKE_MART_WIDTH && match; col++) {
          match = metatileAt(x + col, y + row) === FRLG_POKE_MART_TEMPLATE[row][col];
        }
      }

      if (match) {
        found.push({ x, y });
      }
    }
  }

  return found;
}
