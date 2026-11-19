// Laboratorio de modelos: monta um trecho de mapa com o pipeline do app
// (substituicao de construcoes por modelos 3D) e mostra varias vistas ao
// lado da arte original do GBA, para conferir tamanho e proporcao.
//
// Parametros (URL):
//   map=3.0          grupo.numero do mapa externo
//   box=x0,y0,x1,y1  trecho em tiles (inclusive); a camera mira o centro
//   player=x,y       jogador de teste (cartao 1x2 esticado como os sprites)
//   margin=2         tiles de chao em volta do trecho
//   rom=rom.gba      ROM servida junto com a pagina
import * as THREE from 'three';

import { Gen3StateAdapter } from '../../src/gen3/Gen3StateAdapter';
import { MapCatalog } from '../../src/gen3/world/MapCatalog';
import { substituteBuildings } from '../../src/render/buildings/BuildingSubstitution';

const BASE = 0x08000000;
const PX = 16;
// Escala vertical dos sprites em pe na camera do app (altura 10, recuo 11).
const UPRIGHT = Math.hypot(10, 11) / 11;

const query = new URLSearchParams(location.search);
const info = document.getElementById('info') as HTMLPreElement;

function log(line: string): void {
  info.textContent += line + '\n';
}

async function main(): Promise<void> {
  const rom = new Uint8Array(await (await fetch(query.get('rom') ?? 'rom.gba')).arrayBuffer());
  const u8 = (a: number): number => (a >= BASE && a - BASE < rom.length ? rom[a - BASE] : 0);
  const u32 = (o: number): number => (rom[o] | (rom[o + 1] << 8) | (rom[o + 2] << 16) | (rom[o + 3] << 24)) >>> 0;
  const reader = {
    readU8: u8,
    readU16: (a: number) => u8(a) | (u8(a + 1) << 8),
    readU32: (a: number) => (u8(a) | (u8(a + 1) << 8) | (u8(a + 2) << 16) | (u8(a + 3) << 24)) >>> 0,
    readRange: (a: number, n: number) => {
      const out = new Uint8Array(n);
      for (let i = 0; i < n; i++) out[i] = u8(a + i);
      return out;
    },
  };

  const quiet = console.log;
  console.log = () => {};
  const adapter = new Gen3StateAdapter(reader as never, rom);
  const catalog = new MapCatalog() as unknown as {
    findMapGroupsByStructure(rom: Uint8Array): number;
    readBorder(rom: Uint8Array, layout: number, dims: boolean): { borderAddress: number; borderWidth: number; borderHeight: number };
  };
  const groups = catalog.findMapGroupsByStructure(rom);
  const [group, num] = (query.get('map') ?? '3.0').split('.').map(Number);
  const header = u32(u32(groups - BASE + group * 4) - BASE + num * 4);
  const layout = u32(header - BASE) - BASE;
  const W = u32(layout);
  const H = u32(layout + 4);
  const border = catalog.readBorder(rom, layout, true);
  const borderIds: number[] = [];
  for (let i = 0; i < border.borderWidth * border.borderHeight; i++) {
    borderIds.push(reader.readU16(border.borderAddress + i * 2) & 0x3ff);
  }
  const data = adapter.getMapRenderData(u32(layout + 12), W, H, u32(layout + 16), u32(layout + 20), borderIds);
  const substituted = substituteBuildings('FRLG', W, H, data.blocks, data.graphics);
  console.log = quiet;

  const box = (query.get('box') ?? `0,0,${W - 1},${H - 1}`).split(',').map(Number);
  const margin = Number(query.get('margin') ?? 2);
  const x0 = Math.max(0, box[0] - margin);
  const y0 = Math.max(0, box[1] - margin);
  const x1 = Math.min(W - 1, box[2] + margin);
  const y1 = Math.min(H - 1, box[3] + margin);
  const tw = x1 - x0 + 1;
  const th = y1 - y0 + 1;

  // Arte de um conjunto de blocos no trecho (de cima para baixo).
  const paint = (blocks: typeof data.blocks, graphics: typeof data.graphics): Uint8ClampedArray => {
    const out = new Uint8ClampedArray(tw * PX * th * PX * 4);
    for (let ty = 0; ty < th; ty++) {
      for (let tx = 0; tx < tw; tx++) {
        const block = blocks[(y0 + ty) * W + x0 + tx];
        const pixels = block ? graphics.get(block.metatileId)?.pixels : undefined;
        if (!pixels) continue;
        for (let sy = 0; sy < PX; sy++) {
          out.set(pixels.subarray(sy * PX * 4, (sy + 1) * PX * 4), ((ty * PX + sy) * tw * PX + tx * PX) * 4);
        }
      }
    }
    return out;
  };

  // Painel 2D: arte original do GBA.
  const scale = Number(query.get('zoom') ?? 3);
  const gba = document.getElementById('gba') as HTMLCanvasElement;
  gba.width = tw * PX * scale;
  gba.height = th * PX * scale;
  {
    const source = document.createElement('canvas');
    source.width = tw * PX;
    source.height = th * PX;
    source.getContext('2d')!.putImageData(new ImageData(paint(data.blocks, data.graphics), tw * PX, th * PX), 0, 0);
    const context = gba.getContext('2d')!;
    context.imageSmoothingEnabled = false;
    context.drawImage(source, 0, 0, gba.width, gba.height);
    // Grade de tiles e o trecho pedido.
    context.strokeStyle = 'rgba(255,255,255,0.18)';
    for (let x = 0; x <= tw; x++) { context.beginPath(); context.moveTo(x * PX * scale, 0); context.lineTo(x * PX * scale, gba.height); context.stroke(); }
    for (let y = 0; y <= th; y++) { context.beginPath(); context.moveTo(0, y * PX * scale); context.lineTo(gba.width, y * PX * scale); context.stroke(); }
    context.strokeStyle = '#ff3b3b';
    context.lineWidth = 2;
    context.strokeRect((box[0] - x0) * PX * scale, (box[1] - y0) * PX * scale, (box[2] - box[0] + 1) * PX * scale, (box[3] - box[1] + 1) * PX * scale);
  }

  // Cena 3D: chao (blocos ja trocados pela substituicao) + modelos.
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0b1220);
  const groundData = paint(substituted.blocks, substituted.graphics);
  const flipped = new Uint8Array(groundData.length);
  for (let row = 0; row < th * PX; row++) {
    flipped.set(groundData.subarray(row * tw * PX * 4, (row + 1) * tw * PX * 4), (th * PX - 1 - row) * tw * PX * 4);
  }
  const groundTexture = new THREE.DataTexture(flipped, tw * PX, th * PX, THREE.RGBAFormat);
  groundTexture.magFilter = THREE.NearestFilter;
  groundTexture.minFilter = THREE.NearestFilter;
  groundTexture.colorSpace = THREE.SRGBColorSpace;
  groundTexture.needsUpdate = true;
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(tw, th), new THREE.MeshBasicMaterial({ map: groundTexture }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(x0 + tw / 2, 0, y0 + th / 2);
  scene.add(ground);

  for (const building of substituted.buildings) {
    // So entra o modelo cujo centro (no chao) cai dentro do trecho.
    const bounds = new THREE.Box3().setFromObject(building.model);
    const centerX = (bounds.min.x + bounds.max.x) / 2;
    const centerZ = (bounds.min.z + bounds.max.z) / 2;
    const inside = centerX >= x0 && centerX <= x1 + 1 && centerZ >= y0 && centerZ <= y1 + 1;
    const size = `${(bounds.max.x - bounds.min.x).toFixed(2)} x ${(bounds.max.y - bounds.min.y).toFixed(2)} x ${(bounds.max.z - bounds.min.z).toFixed(2)}`;
    log(`modelo ${building.kind} em (${building.x},${building.y}) tamanho ${size}${inside ? '' : ' (fora do trecho)'}`);
    if (inside) scene.add(building.model);
  }

  const playerAt = query.get('player')?.split(',').map(Number);
  if (playerAt) {
    const card = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 2 * UPRIGHT),
      new THREE.MeshBasicMaterial({ color: 0xe04848, side: THREE.DoubleSide }),
    );
    card.position.set(playerAt[0] + 0.5, UPRIGHT, playerAt[1] + 0.5);
    scene.add(card);
  }

  // Vistas: camera do jogo, frente baixa, sudeste e noroeste (fundos).
  const canvas = document.getElementById('views') as HTMLCanvasElement;
  const viewW = Number(query.get('vw') ?? 600);
  const viewH = Math.round(viewW / 1.5);
  canvas.width = viewW * 2;
  canvas.height = viewH * 2;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, preserveDrawingBuffer: true });
  renderer.setScissorTest(true);
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const cx = (box[0] + box[2] + 1) / 2;
  const cz = (box[1] + box[3] + 1) / 2;
  const size = Math.max(box[2] - box[0] + 1, box[3] - box[1] + 1);
  const far = Math.max(1, size / 6);
  const views: Array<{ name: string; eye: [number, number, number]; target: [number, number, number] }> = [
    { name: 'camera do jogo', eye: [cx, 10, cz + 11], target: [cx, 0, cz] },
    { name: 'frente, baixa', eye: [cx, 2.2 * far, cz + 9 * far], target: [cx, 1.2, cz] },
    { name: 'sudeste', eye: [cx + 7 * far, 6 * far, cz + 7 * far], target: [cx, 0.8, cz] },
    { name: 'noroeste (fundos)', eye: [cx - 7 * far, 6 * far, cz - 7 * far], target: [cx, 0.8, cz] },
  ];

  views.forEach((view, index) => {
    const camera = new THREE.PerspectiveCamera(index === 0 ? 48 : 40, viewW / viewH, 0.1, 500);
    camera.position.set(...view.eye);
    camera.lookAt(...view.target);
    const vx = (index % 2) * viewW;
    const vy = (1 - Math.floor(index / 2)) * viewH;
    renderer.setViewport(vx, vy, viewW, viewH);
    renderer.setScissor(vx, vy, viewW, viewH);
    renderer.render(scene, camera);
  });

  (window as unknown as { __labDone: boolean }).__labDone = true;
}

main().catch((error) => {
  log('ERRO: ' + (error as Error).stack);
  (window as unknown as { __labDone: boolean }).__labDone = true;
});
