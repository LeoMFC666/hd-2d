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

// Parede da fachada na borda norte da linha da porta (ver buildGymModel):
// do tile na frente da porta, um passo entra.
const FACADE_SHIFT = 1;

export interface GymArt {
  // Arte do ginasio inteiro (largura x 5 metatiles), RGBA, linhas de cima
  // para baixo.
  rgba: Uint8Array;

  // Largura em metatiles (7 em Pewter; Celadon e outras variam) e coluna
  // da porta (0x15B) dentro do bloco.
  width?: number;
  door?: number;

  // Tile da porta com as duas camadas (a arte acima e so a de cima): para
  // achar a paleta da animacao da porta.
  doorTile?: Uint8ClampedArray | Uint8Array;
}

function crop(art: GymArt, x: number, y: number, w: number, h: number): THREE.DataTexture {
  const fullWidth = (art.width ?? 7) * PX;
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
  const o = (y * (art.width ?? 7) * PX + x) * 4;

  return new THREE.Color().setRGB(art.rgba[o] / 255, art.rgba[o + 1] / 255, art.rgba[o + 2] / 255, THREE.SRGBColorSpace);
}

function plain(color: THREE.Color, shade: number): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({ color: color.clone().multiplyScalar(shade) });
}

function textured(map: THREE.Texture, shade = 1): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({ map, color: new THREE.Color(shade, shade, shade), transparent: true, alphaTest: 0.5 });
}

/**
 * Ultima linha (px) com arte nas colunas [x0, x1) a partir de `from`, que
 * cobre ao menos `share` delas. -1 se nenhuma.
 */
function lastRow(art: GymArt, x0: number, x1: number, from: number, to: number, share: number): number {
  const fullWidth = (art.width ?? 7) * PX;

  for (let y = to; y >= from; y--) {
    let filled = 0;
    let total = 0;

    for (let x = Math.max(0, x0); x < Math.min(fullWidth, x1); x++) {
      total++;

      if (art.rgba[(y * fullWidth + x) * 4 + 3] !== 0) {
        filled++;
      }
    }

    if (total && filled >= total * share) {
      return y;
    }
  }

  return -1;
}

/**
 * Monta o ginasio com o canto noroeste do bloco 7x5 na origem (x para
 * leste, z para o sul, 1 unidade = 1 metatile).
 */
export function buildGymModel(art: GymArt): THREE.Group {
  const root = new THREE.Group();
  root.name = 'gym';

  // As medidas abaixo seguem a ARTE (linha 3 = inicio da fachada). No
  // mundo, a parede fica no inicio da linha da porta (linha 4): o tile da
  // porta fica na frente dela e, do tile seguinte, um passo entra. Dai o
  // deslocamento de 1 tile.
  const group = new THREE.Group();
  group.position.z = FACADE_SHIFT;
  root.add(group);

  // Entrada (porta, cobertura com a Poke Bola, porta animada): grupo
  // proprio, apoiado no chao, que recebe a escala vertical dos sprites.
  const entrance = new THREE.Group();
  entrance.name = 'entrance';
  group.add(entrance);
  root.userData.entrance = entrance;

  const width = art.width ?? 7;
  const door = art.door ?? 3;
  const roofFront = 3; // fachada na linha 3
  const roofBack = 0.3; // a linha 0 comeca com calcada

  // A arte e so o predio (o chao saiu). A parede vai do topo da linha 3 ate
  // o pe dela na arte (a linha de baixo do contorno, fora da entrada), na
  // escala da arte: abaixo dela era a grama do chao.
  const facadeTop = 3 * PX;
  const porchPx0 = Math.round((door - 0.45) * PX);
  const porchPx1 = Math.round((door + 1.45) * PX);
  // (O menor dos dois lados: em Cinnabar a placa GYM esta desenhada na
  // quina de baixo da direita e desce ate o fim do tile.)
  const sides = [
    lastRow(art, 0, porchPx0, facadeTop, 5 * PX - 1, 0.6),
    lastRow(art, porchPx1, width * PX, facadeTop, 5 * PX - 1, 0.6),
  ].filter((row) => row > facadeTop);
  const facadeBottom = sides.length ? Math.min(...sides) : 5 * PX - 1;
  const wallHeight = (facadeBottom + 1 - facadeTop) / PX;
  // Entrada: a arte da porta vai ate o pe dela (sai um pouco abaixo da
  // parede, por estar na frente).
  const doorBottom = Math.max(lastRow(art, door * PX + 2, door * PX + PX - 2, 4 * PX, 5 * PX - 1, 0.5), 4 * PX + 1);

  const wall = pixel(art, 8, facadeTop + 8);
  const roofEdge = pixel(art, 3 * PX, 2 * PX + 14);

  // Laterais e fundo: parede com as mesmas faixas da fachada.
  const depth = roofFront - roofBack;
  // Uma coluna so da fachada (sem janela nem contorno), esticada: as
  // faixas horizontais da frente continuam nas laterais, sem listras.
  const side = crop(art, 6, facadeTop, 1, facadeBottom + 1 - facadeTop);

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

  // Fachada: da linha 3 ao pe da parede, em pe na frente do corpo.
  const facade = new THREE.Mesh(
    new THREE.PlaneGeometry(width, wallHeight),
    textured(crop(art, 0, facadeTop, width * PX, facadeBottom + 1 - facadeTop), 0.95),
  );
  facade.position.set(width / 2, wallHeight / 2, roofFront + 0.001);
  group.add(facade);

  // Entrada: a porta (linha 4) sai da parede numa caixa que sobe ate a
  // ponta da laje. O painel da Poke Bola (linha 3) e a cobertura dela: uma
  // laje DEITADA (horizontal) no topo da fachada, saindo da parede.
  const porchX0 = door - 0.45;
  const porchX1 = door + 1.45;
  const porchWidth = porchX1 - porchX0;
  const porchDepth = 0.3;
  const porchHeight = wallHeight - 0.5;
  const porchSide = textured(crop(art, 6, 4 * PX, 1, doorBottom + 1 - 4 * PX), 0.75);
  const porch = new THREE.Mesh(
    new THREE.BoxGeometry(porchWidth, porchHeight, porchDepth),
    [porchSide, porchSide, plain(wall, 0.9), plain(wall, 0.5),
      textured(crop(art, Math.round(porchX0 * PX), 4 * PX, Math.round(porchWidth * PX), doorBottom + 1 - 4 * PX)),
      plain(wall, 0.6)],
  );
  porch.position.set((porchX0 + porchX1) / 2, porchHeight / 2, roofFront + porchDepth / 2);
  entrance.add(porch);

  const canopyDepth = 0.85;
  const canopyThickness = 0.08;
  const canopyOverhang = 0.06;
  const canopyArt = crop(art, Math.round(porchX0 * PX), 3 * PX, Math.round(porchWidth * PX), PX);
  const canopyEdge = plain(pixel(art, 3 * PX + 8, 3 * PX + 2), 0.75);
  const canopy = new THREE.Mesh(
    new THREE.BoxGeometry(porchWidth + canopyOverhang * 2, canopyThickness, canopyDepth),
    [canopyEdge, canopyEdge, textured(canopyArt), canopyEdge, canopyEdge, canopyEdge],
  );
  // Dobradica na borda de tras da laje, encostada na parede na altura do
  // teto (wallHeight): a laje sai do beiral e desce ate a frente.
  const canopyHingeHeight = wallHeight;

  // Altura da ponta da frente da laje (a que estava antes: 0.5 abaixo do
  // topo da parede). O angulo e calculado para a laje ligar o teto a ela.
  const canopyFrontHeight = wallHeight - 0.5;

  const canopyAngle = Math.asin(
    THREE.MathUtils.clamp((canopyHingeHeight - canopyFrontHeight) / canopyDepth, -1, 1),
  );

  const canopyHinge = new THREE.Group();
  canopyHinge.position.set((porchX0 + porchX1) / 2, canopyHingeHeight, roofFront);
  canopyHinge.rotation.x = canopyAngle; // positivo: a ponta da frente desce
  entrance.add(canopyHinge);

  // A laje sai da dobradica para a frente.
  canopy.position.set(0, -canopyThickness / 2, canopyDepth / 2);
  canopyHinge.add(canopy);

  // Na parede, onde a arte tinha a Poke Bola (agora deitada na laje): parede
  // lisa com as faixas da fachada.
  const behind = new THREE.Mesh(
    new THREE.PlaneGeometry(porchWidth, 1),
    textured(crop(art, 6, 3 * PX, 1, PX), 0.95),
  );
  behind.position.set((porchX0 + porchX1) / 2, wallHeight - 0.5, roofFront + 0.002);
  entrance.add(behind);

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

  // Porta animada: plano na frente da entrada, escondido; o DoorAnimator
  // mostra nele o quadro da animacao de porta lido da VRAM.
  const doorPlane = new THREE.Mesh(
    new THREE.PlaneGeometry(1, porchHeight),
    new THREE.MeshBasicMaterial({ transparent: true, alphaTest: 0.5 }),
  );
  doorPlane.position.set(door + 0.5, porchHeight / 2, roofFront + porchDepth + 0.003);
  doorPlane.visible = false;
  doorPlane.userData.door = true;

  // Porta fechada (arte do tileset), para achar a paleta da animacao.
  const closed = new Uint8Array(PX * PX * 4);
  const artWidth = width * PX;

  if (art.doorTile) {
    closed.set(art.doorTile.subarray(0, PX * PX * 4));
  } else {
    for (let row = 0; row < PX; row++) {
      const source = ((4 * PX + row) * artWidth + door * PX) * 4;
      closed.set(art.rgba.subarray(source, source + PX * 4), row * PX * 4);
    }
  }

  doorPlane.userData.closedArt = closed;
  entrance.add(doorPlane);

  return root;
}

export const GYM_DOOR = 0x15b;

export interface FoundGym {
  // pewter: completo (Pewter, Cerulean, Vermilion, Celadon, Fuchsia,
  // Saffron). viridian: menor, sem o trecho da janela da direita 0x155
  // (Viridian, Cinnabar).
  kind: 'pewter' | 'viridian';

  // Canto noroeste (linha da beirada) e tamanho em metatiles.
  x: number;
  y: number;
  width: number;
  door: number;
}

/**
 * Acha os ginasios TIPO PEWTER (completos) num mapa do FRLG.
 *
 * O telhado e sempre 141 142... 143 / 149 14A... 14B (tileset primario),
 * com largura variavel (Celadon e mais largo). A fachada pode trocar tiles
 * por variantes da cidade (Saffron), entao vale o telhado + a porta 0x15B
 * na ultima linha + o trecho da janela da direita (0x155) na fachada de
 * cima.
 *
 * Tipo Viridian (Viridian, Cinnabar): o mesmo predio sem o trecho 0x155 -
 * 6 de largura, a janela da direita colada na porta, a borda direita podendo
 * ser tile da cidade (Cinnabar troca 15E por 2BF). Usa o mesmo modelo, que
 * sai da arte e da largura do proprio ginasio.
 */
export function findGyms(width: number, height: number, metatileAt: (x: number, y: number) => number): FoundGym[] {
  const found: FoundGym[] = [];

  for (let y = 1; y + 4 <= height; y++) {
    for (let x = 0; x < width; x++) {
      if (metatileAt(x, y) !== 0x141 || metatileAt(x, y + 1) !== 0x149) {
        continue;
      }

      let end = x + 1;

      while (end < width && metatileAt(end, y) === 0x142 && metatileAt(end, y + 1) === 0x14a) {
        end++;
      }

      const gymWidth = end - x + (end < width && metatileAt(end, y) === 0x143 ? 1 : 0);

      if (gymWidth < 5) {
        continue;
      }

      let door = -1;
      let rightWindow = false;

      for (let col = 0; col < gymWidth; col++) {
        if (metatileAt(x + col, y + 3) === GYM_DOOR) {
          door = col;
        }

        if (metatileAt(x + col, y + 2) === 0x155) {
          rightWindow = true;
        }
      }

      if (door < 0) {
        continue;
      }

      found.push({ kind: rightWindow ? 'pewter' : 'viridian', x, y: y - 1, width: gymWidth, door });
    }
  }

  return found;
}