import * as THREE from 'three';

import type { Hd2dSettings } from './Hd2dSettings';

import { PaletteBuilder } from './PaletteBuilder';

import {
  BLUR_FRAGMENT,
  BRIGHT_FRAGMENT,
  COMPOSITE_FRAGMENT,
  FULLSCREEN_VERTEX,
  LIGHT_FRAGMENT,
  SPLAT_FRAGMENT,
} from './shaders';

/**
 * Pipeline HD-2D (referencia visual: Octopath Traveler).
 *
 *   cena (resolucao interna, camera presa ao grid de celulas)
 *     -> luz: sombra do sol pontilhada, tons quente/frio, caverna, neblina
 *     -> bloom (meia resolucao)
 *     -> composicao: profundidade de campo tilt-shift, gradacao, vinheta
 *     -> splat gaussiano duro + paleta pequena (resolucao da tela)
 *
 * Nada nos materiais da cena muda: a luz e calculada depois, a partir da
 * profundidade, e o shadow map vem do proprio three.js (as texturas com
 * alphaTest - sprites, arvores, cartoes - projetam o recorte certo).
 *
 * A camera e deslocada para o grid de celulas antes de renderizar e o
 * resto do deslocamento e aplicado no passo final, em fracao de celula:
 * o pixel art nao "nada" quando a camera anda pixel a pixel com o jogador,
 * e o movimento continua suave.
 */

export type Hd2dEnvironment = 'outdoor' | 'interior' | 'cave';

export interface Hd2dFrame {
  // Ponto que a camera acompanha (pes do jogador), no mundo.
  focus: THREE.Vector3;
  environment: Hd2dEnvironment;

  // Muda quando o mapa muda: a paleta e refeita na hora.
  mapKey: string;
}

const SHADOW_MAP_SIZE = 2048;

// Meia largura da caixa do shadow map e distancia do "sol" ao foco.
const SHADOW_EXTENT = 26;

const SHADOW_DISTANCE = 60;

// A camera ve mais para o norte do jogador do que para o sul.
const SHADOW_CENTER_NORTH = 6;

// Pixel do GBA em unidades do mundo (16 por tile).
const GBA_PIXEL = 1 / 16;

// Celula automatica: 0.65 pixel do GBA no plano do jogador. Assim o chao
// visto a ~42 graus fica com ~1 celula por pixel do GBA na vertical (sem
// serrilhar a arte) e os sprites em pe com folga.
const AUTO_CELL = GBA_PIXEL * 0.65;

const MIN_INTERNAL_HEIGHT = 96;

const MAX_INTERNAL_HEIGHT = 1080;

const PALETTE_INTERVAL_MS = 1500;

// Espera depois de trocar de mapa antes de refazer a paleta (fade).
const PALETTE_MAP_DELAY_MS = 350;

const BLOOM_THRESHOLD = 0.68;

interface EnvironmentLook {
  elevation: number | null;
  shadowScale: number;
  litTint: THREE.Color;
  shadowColor: THREE.Color;
  fogColor: THREE.Color;
  fogScale: number;
  darkness: number;
}

const LOOKS: Record<Hd2dEnvironment, EnvironmentLook> = {
  outdoor: {
    elevation: null,
    shadowScale: 1,
    litTint: new THREE.Color(1.05, 1.0, 0.92),
    shadowColor: new THREE.Color(0.33, 0.38, 0.62),
    fogColor: new THREE.Color(0.58, 0.67, 0.82),
    fogScale: 0.6,
    darkness: 0,
  },
  interior: {
    elevation: 70,
    shadowScale: 0.75,
    litTint: new THREE.Color(1.06, 0.99, 0.88),
    shadowColor: new THREE.Color(0.4, 0.36, 0.56),
    fogColor: new THREE.Color(0, 0, 0),
    fogScale: 0,
    darkness: 0,
  },
  cave: {
    elevation: 80,
    shadowScale: 0.55,
    litTint: new THREE.Color(1.04, 0.98, 0.9),
    shadowColor: new THREE.Color(0.3, 0.3, 0.5),
    fogColor: new THREE.Color(0, 0, 0),
    fogScale: 0,
    darkness: 0.62,
  },
};

function createTarget(
  width: number,
  height: number,
  filter: THREE.MagnificationTextureFilter,
): THREE.WebGLRenderTarget {
  const target = new THREE.WebGLRenderTarget(width, height, {
    depthBuffer: false,
    stencilBuffer: false,
    generateMipmaps: false,
  });

  // sRGB de 8 bits: guarda cor linear com a precisao do sRGB (o
  // WebGL2 converte na escrita e na leitura).
  target.texture.colorSpace = THREE.SRGBColorSpace;
  target.texture.minFilter = filter;
  target.texture.magFilter = filter;

  return target;
}

function pass(fragmentShader: string, uniforms: Record<string, THREE.IUniform>): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: FULLSCREEN_VERTEX,
    fragmentShader,
    uniforms,
    depthTest: false,
    depthWrite: false,
  });
}

export class Hd2dPipeline {
  readonly sun = new THREE.DirectionalLight(0xffffff, 1);

  // Depuracao pelo console: 0 normal, 1 termo de sombra, 2 normais
  // (__gen3.scene.hd2d.debugView = 1).
  debugView = 0;

  private readonly renderer: THREE.WebGLRenderer;

  private readonly scene: THREE.Scene;

  private readonly settings: Hd2dSettings;

  private readonly quadScene = new THREE.Scene();

  private readonly quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  private readonly quad: THREE.Mesh;

  private readonly lightMaterial: THREE.ShaderMaterial;

  private readonly brightMaterial: THREE.ShaderMaterial;

  private readonly blurMaterial: THREE.ShaderMaterial;

  private readonly compositeMaterial: THREE.ShaderMaterial;

  private readonly splatMaterial: THREE.ShaderMaterial;

  private readonly palette = new PaletteBuilder();

  private sceneTarget: THREE.WebGLRenderTarget | null = null;

  private litTarget: THREE.WebGLRenderTarget | null = null;

  private gradedTarget: THREE.WebGLRenderTarget | null = null;

  private bloomA: THREE.WebGLRenderTarget | null = null;

  private bloomB: THREE.WebGLRenderTarget | null = null;

  private width = 0;

  private height = 0;

  private readonly output = new THREE.Vector2();

  private paletteBuffer = new Uint8Array(0);

  private palettePending = false;

  private nextPaletteAt = 0;

  private paletteMapKey = '';

  private paletteK = 0;

  private disposed = false;

  private readonly saved = new THREE.Vector3();

  private readonly right = new THREE.Vector3();

  private readonly up = new THREE.Vector3();

  private readonly sunDirection = new THREE.Vector3();

  private readonly lookMatrix = new THREE.Matrix4();

  private readonly temp = new THREE.Vector3();

  constructor(renderer: THREE.WebGLRenderer, scene: THREE.Scene, settings: Hd2dSettings) {
    this.renderer = renderer;
    this.scene = scene;
    this.settings = settings;

    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(SHADOW_MAP_SIZE, SHADOW_MAP_SIZE);

    const shadowCamera = this.sun.shadow.camera;

    shadowCamera.left = -SHADOW_EXTENT;
    shadowCamera.right = SHADOW_EXTENT;
    shadowCamera.top = SHADOW_EXTENT;
    shadowCamera.bottom = -SHADOW_EXTENT;
    shadowCamera.near = 1;
    shadowCamera.far = SHADOW_DISTANCE * 2.2;
    shadowCamera.updateProjectionMatrix();

    scene.add(this.sun);
    scene.add(this.sun.target);

    // Mapa de profundidade simples (sem comparacao em hardware): o passo de
    // luz le a profundidade e faz o proprio teste no grid do GBA.
    renderer.shadowMap.type = THREE.BasicShadowMap;
    renderer.shadowMap.enabled = false;

    this.lightMaterial = pass(LIGHT_FRAGMENT, {
      tColor: { value: null },
      tDepth: { value: null },
      tShadow: { value: null },
      uTexel: { value: new THREE.Vector2() },
      uProjInv: { value: new THREE.Matrix4() },
      uViewInv: { value: new THREE.Matrix4() },
      uView: { value: new THREE.Matrix4() },
      uCameraPos: { value: new THREE.Vector3() },
      uShadowEnabled: { value: 0 },
      uShadowMatrix: { value: new THREE.Matrix4() },
      uShadowTexel: { value: new THREE.Vector2(1 / SHADOW_MAP_SIZE, 1 / SHADOW_MAP_SIZE) },
      uShadowBias: { value: 0.0006 },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uLitTint: { value: new THREE.Color() },
      uShadowTint: { value: new THREE.Color() },
      uShadowDensity: { value: 0.5 },
      uDarkness: { value: 0 },
      uFocus: { value: new THREE.Vector3() },
      uLightRadius: { value: 4.5 },
      uFogColor: { value: new THREE.Color() },
      uFogAmount: { value: 0 },
      uFogNear: { value: 16 },
      uFogFar: { value: 42 },
      uDebug: { value: 0 },
    });

    this.brightMaterial = pass(BRIGHT_FRAGMENT, {
      tSource: { value: null },
      uTexel: { value: new THREE.Vector2() },
      uThreshold: { value: BLOOM_THRESHOLD },
    });

    this.blurMaterial = pass(BLUR_FRAGMENT, {
      tSource: { value: null },
      uDirection: { value: new THREE.Vector2() },
    });

    this.compositeMaterial = pass(COMPOSITE_FRAGMENT, {
      tLit: { value: null },
      tBloom: { value: null },
      tDepth: { value: null },
      uTexel: { value: new THREE.Vector2() },
      uNear: { value: 0.1 },
      uFar: { value: 3000 },
      uFocusDepth: { value: 15 },
      uFocusRange: { value: 2.5 },
      uDof: { value: 0 },
      uMaxBlur: { value: 6 },
      uBloom: { value: 0 },
      uVignette: { value: 0 },
      uWarmth: { value: 0 },
      uAspect: { value: 1.5 },
    });

    this.splatMaterial = pass(SPLAT_FRAGMENT, {
      tGraded: { value: null },
      tDepth: { value: null },
      tPalette: { value: this.palette.colorTexture },
      tPaletteLab: { value: this.palette.labTexture },
      uPaletteSize: { value: 0 },
      uPaletteDither: { value: 0 },
      uCellSize: { value: new THREE.Vector2(1, 1) },
      uOffset: { value: new THREE.Vector2() },
      uOrigin: { value: new THREE.Vector2() },
      uGrid: { value: new THREE.Vector2(1, 1) },
      uRadius: { value: 0 },
      uJitter: { value: 0 },
      uRelief: { value: 0 },
    });

    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.lightMaterial);
    this.quad.frustumCulled = false;
    this.quadScene.add(this.quad);
  }

  /** Resolucao interna atual (celulas), para depuracao. */
  get internalSize(): { width: number; height: number } {
    return { width: this.width, height: this.height };
  }

  render(camera: THREE.PerspectiveCamera, frame: Hd2dFrame): void {
    const renderer = this.renderer;
    const settings = this.settings;

    if (!settings.enabled) {
      renderer.shadowMap.enabled = false;
      this.sun.castShadow = false;
      renderer.setRenderTarget(null);
      renderer.render(this.scene, camera);

      return;
    }

    const now = performance.now();

    renderer.getDrawingBufferSize(this.output);

    camera.updateMatrixWorld();

    const focusDistance = Math.max(1, camera.position.distanceTo(frame.focus));
    const visibleHeight = 2 * focusDistance * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);

    const cellScale =
      !settings.splat
        ? 1
        : settings.pixelScale > 0
        ? settings.pixelScale
        : Math.max(1, this.output.y / (visibleHeight / AUTO_CELL));

    const height = THREE.MathUtils.clamp(
      Math.round(this.output.y / cellScale / 2) * 2,
      MIN_INTERNAL_HEIGHT,
      Math.min(MAX_INTERNAL_HEIGHT, this.output.y),
    );

    const width = Math.max(1, Math.round((height * this.output.x) / this.output.y));

    this.ensureTargets(width, height);

    const sceneTarget = this.sceneTarget!;
    const look = LOOKS[frame.environment];
    const shadowStrength = settings.shadowStrength * look.shadowScale;
    const shadows = shadowStrength > 0.001;

    this.updateSun(frame.focus, look);

    renderer.shadowMap.enabled = shadows;
    this.sun.castShadow = shadows;

    if (shadows) {
      this.markShadowCasters();
    }

    // Camera no grid de celulas (ver comentario da classe).
    const cell = visibleHeight / height;

    this.saved.copy(camera.position);
    this.right.setFromMatrixColumn(camera.matrixWorld, 0).normalize();
    this.up.setFromMatrixColumn(camera.matrixWorld, 1).normalize();

    const along = camera.position.dot(this.right) / cell;
    const upward = camera.position.dot(this.up) / cell;
    const snappedAlong = Math.round(along);
    const snappedUpward = Math.round(upward);

    camera.position
      .addScaledVector(this.right, (snappedAlong - along) * cell)
      .addScaledVector(this.up, (snappedUpward - upward) * cell);

    camera.updateMatrixWorld();

    renderer.setRenderTarget(sceneTarget);
    renderer.render(this.scene, camera);

    // ---- luz
    const light = this.lightMaterial.uniforms;

    light.tColor.value = sceneTarget.texture;
    light.tDepth.value = sceneTarget.depthTexture;
    light.tShadow.value = shadows ? this.sun.shadow.map?.depthTexture ?? null : null;
    light.uShadowEnabled.value = shadows && light.tShadow.value ? 1 : 0;
    light.uShadowMatrix.value.copy(this.sun.shadow.matrix);
    light.uTexel.value.set(1 / width, 1 / height);
    light.uProjInv.value.copy(camera.projectionMatrixInverse);
    light.uViewInv.value.copy(camera.matrixWorld);
    light.uView.value.copy(camera.matrixWorldInverse);
    light.uCameraPos.value.copy(camera.position);
    light.uSunDir.value.copy(this.sunDirection);
    light.uLitTint.value.copy(look.litTint);
    light.uShadowTint.value.setRGB(1, 1, 1).lerp(look.shadowColor, Math.min(1, shadowStrength));
    light.uShadowDensity.value = settings.shadowDither;
    light.uDarkness.value = look.darkness;
    light.uFocus.value.copy(frame.focus);
    light.uFogColor.value.copy(look.fogColor);
    light.uFogAmount.value = settings.haze * look.fogScale;
    light.uDebug.value = this.debugView;

    // Profundidade linear do foco (para o DOF), com a camera do quadro.
    const focusDepth = -this.temp.copy(frame.focus).applyMatrix4(camera.matrixWorldInverse).z;

    camera.position.copy(this.saved);
    camera.updateMatrixWorld();

    this.runPass(this.lightMaterial, this.litTarget);

    // ---- bloom
    const bloomOn = settings.bloom > 0.001;

    if (bloomOn) {
      const bright = this.brightMaterial.uniforms;

      bright.tSource.value = this.litTarget!.texture;
      bright.uTexel.value.set(1 / width, 1 / height);
      this.runPass(this.brightMaterial, this.bloomA);

      const blur = this.blurMaterial.uniforms;
      const halfWidth = this.bloomA!.width;
      const halfHeight = this.bloomA!.height;

      for (let iteration = 0; iteration < 2; iteration++) {
        blur.tSource.value = this.bloomA!.texture;
        blur.uDirection.value.set(1 / halfWidth, 0);
        this.runPass(this.blurMaterial, this.bloomB);

        blur.tSource.value = this.bloomB!.texture;
        blur.uDirection.value.set(0, 1 / halfHeight);
        this.runPass(this.blurMaterial, this.bloomA);
      }
    }

    // ---- composicao
    const composite = this.compositeMaterial.uniforms;

    composite.tLit.value = this.litTarget!.texture;
    composite.tBloom.value = this.bloomA!.texture;
    composite.tDepth.value = sceneTarget.depthTexture;
    composite.uTexel.value.set(1 / width, 1 / height);
    composite.uNear.value = camera.near;
    composite.uFar.value = camera.far;
    composite.uFocusDepth.value = focusDepth;
    composite.uFocusRange.value = Math.max(1.5, focusDistance * 0.16);
    composite.uDof.value = settings.depthOfField;
    composite.uMaxBlur.value = 6 * (height / 330);
    composite.uBloom.value = bloomOn ? settings.bloom : 0;
    composite.uVignette.value = settings.vignette;
    composite.uWarmth.value = settings.warmth;
    composite.uAspect.value = width / height;

    this.runPass(this.compositeMaterial, this.gradedTarget);

    if (settings.splat) {
      this.updatePalette(frame, now, width, height);
    }

    // ---- splat + paleta, na tela
    const splat = this.splatMaterial.uniforms;

    splat.tGraded.value = this.gradedTarget!.texture;
    splat.tDepth.value = sceneTarget.depthTexture;
    splat.uPaletteSize.value = settings.splat && settings.paletteSize >= 2 ? this.palette.count : 0;
    splat.uPaletteDither.value = settings.paletteDither;
    splat.uCellSize.value.set(this.output.x / width, this.output.y / height);
    splat.uOffset.value.set(along - snappedAlong, upward - snappedUpward);
    splat.uOrigin.value.set(snappedAlong, snappedUpward);
    splat.uGrid.value.set(width, height);
    splat.uRadius.value = settings.splat ? settings.splatRadius : 0;
    splat.uJitter.value = settings.splatJitter;
    splat.uRelief.value = settings.splatRelief;

    this.runPass(this.splatMaterial, null);
  }

  dispose(): void {
    this.disposed = true;

    this.scene.remove(this.sun);
    this.scene.remove(this.sun.target);
    this.sun.dispose();

    this.disposeTargets();

    for (const material of [
      this.lightMaterial,
      this.brightMaterial,
      this.blurMaterial,
      this.compositeMaterial,
      this.splatMaterial,
    ]) {
      material.dispose();
    }

    this.quad.geometry.dispose();
    this.palette.dispose();
    this.renderer.shadowMap.enabled = false;
  }

  private runPass(material: THREE.ShaderMaterial, target: THREE.WebGLRenderTarget | null): void {
    this.quad.material = material;
    this.renderer.setRenderTarget(target);
    this.renderer.render(this.quadScene, this.quadCamera);
  }

  /**
   * Sol acompanhando o foco, com a caixa do shadow map presa ao grid dos
   * texels do proprio shadow map (a sombra nao tremula quando a camera anda).
   */
  private updateSun(focus: THREE.Vector3, look: EnvironmentLook): void {
    const azimuth = THREE.MathUtils.degToRad(this.settings.sunAzimuth);
    const elevation = THREE.MathUtils.degToRad(look.elevation ?? this.settings.sunElevation);

    // Norte = -z, leste = +x.
    this.sunDirection
      .set(Math.sin(azimuth) * Math.cos(elevation), Math.sin(elevation), -Math.cos(azimuth) * Math.cos(elevation))
      .normalize();

    const center = this.temp.set(focus.x, 0, focus.z - SHADOW_CENTER_NORTH);

    this.lookMatrix.lookAt(this.sunDirection, new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 1, 0));

    const lightRight = new THREE.Vector3().setFromMatrixColumn(this.lookMatrix, 0);
    const lightUp = new THREE.Vector3().setFromMatrixColumn(this.lookMatrix, 1);
    const texel = (2 * SHADOW_EXTENT) / SHADOW_MAP_SIZE;
    const alongRight = center.dot(lightRight);
    const alongUp = center.dot(lightUp);

    center
      .addScaledVector(lightRight, Math.round(alongRight / texel) * texel - alongRight)
      .addScaledVector(lightUp, Math.round(alongUp / texel) * texel - alongUp);

    this.sun.target.position.copy(center);
    this.sun.position.copy(center).addScaledVector(this.sunDirection, SHADOW_DISTANCE);
    this.sun.target.updateMatrixWorld();
    this.sun.updateMatrixWorld();
  }

  /**
   * Quem projeta sombra: tudo que escreve profundidade (chao, predios,
   * sprites, arvores). Camadas translucidas por cima do chao e o "fantasma"
   * do raio-x ficam de fora. Os dois lados das faces contam: sprites e
   * cartoes sao planos de um lado so, virados para a camera.
   */
  private markShadowCasters(): void {
    this.scene.traverse(object => {
      const mesh = object as THREE.Mesh;

      if (!mesh.isMesh) {
        return;
      }

      const material = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as
        | THREE.Material
        | undefined;

      if (!material) {
        return;
      }

      const cast =
        mesh.userData.noShadow !== true &&
        material.depthWrite !== false &&
        !(material.transparent && !(material.alphaTest > 0));

      mesh.castShadow = cast;
      mesh.receiveShadow = false;

      if (cast && material.shadowSide !== THREE.DoubleSide) {
        material.shadowSide = THREE.DoubleSide;
      }
    });
  }

  private updatePalette(frame: Hd2dFrame, now: number, width: number, height: number): void {
    const settings = this.settings;

    if (settings.paletteSize < 2) {
      return;
    }

    if (frame.mapKey !== this.paletteMapKey || settings.paletteSize !== this.paletteK) {
      if (settings.paletteSize !== this.paletteK) {
        this.palette.reset();
      }

      this.paletteMapKey = frame.mapKey;
      this.paletteK = settings.paletteSize;
      this.nextPaletteAt = Math.min(this.nextPaletteAt, now + PALETTE_MAP_DELAY_MS);
    }

    this.palette.update(now);

    if (this.palettePending || now < this.nextPaletteAt || !this.gradedTarget) {
      return;
    }

    this.nextPaletteAt = now + PALETTE_INTERVAL_MS;

    const size = width * height * 4;

    if (this.paletteBuffer.length !== size) {
      this.paletteBuffer = new Uint8Array(size);
    }

    const buffer = this.paletteBuffer;
    const target = this.gradedTarget;
    const k = settings.paletteSize;
    const renderer = this.renderer as THREE.WebGLRenderer & {
      readRenderTargetPixelsAsync?: (
        target: THREE.WebGLRenderTarget,
        x: number,
        y: number,
        width: number,
        height: number,
        buffer: Uint8Array,
      ) => Promise<unknown>;
    };

    const fit = (): void => {
      if (!this.disposed && target === this.gradedTarget) {
        this.palette.fit(buffer, width, height, k);
      }
    };

    // Leitura assincrona (sem travar a GPU) quando o three oferece.
    if (typeof renderer.readRenderTargetPixelsAsync === 'function') {
      this.palettePending = true;

      renderer
        .readRenderTargetPixelsAsync(target, 0, 0, width, height, buffer)
        .then(fit)
        .catch(() => undefined)
        .finally(() => {
          this.palettePending = false;
        });

      return;
    }

    renderer.readRenderTargetPixels(target, 0, 0, width, height, buffer);
    fit();
  }

  private ensureTargets(width: number, height: number): void {
    if (this.sceneTarget && this.width === width && this.height === height) {
      return;
    }

    this.disposeTargets();

    this.width = width;
    this.height = height;

    const depthTexture = new THREE.DepthTexture(width, height, THREE.UnsignedInt248Type);

    depthTexture.format = THREE.DepthStencilFormat;
    depthTexture.minFilter = THREE.NearestFilter;
    depthTexture.magFilter = THREE.NearestFilter;

    // Cena: profundidade em textura (luz, DOF, splat) e stencil para o
    // raio-x do jogador atras das estruturas.
    this.sceneTarget = new THREE.WebGLRenderTarget(width, height, {
      depthBuffer: true,
      stencilBuffer: true,
      depthTexture,
      generateMipmaps: false,
    });

    this.sceneTarget.texture.colorSpace = THREE.SRGBColorSpace;
    this.sceneTarget.texture.minFilter = THREE.NearestFilter;
    this.sceneTarget.texture.magFilter = THREE.NearestFilter;

    this.litTarget = createTarget(width, height, THREE.NearestFilter);
    this.gradedTarget = createTarget(width, height, THREE.NearestFilter);

    const halfWidth = Math.max(1, Math.ceil(width / 2));
    const halfHeight = Math.max(1, Math.ceil(height / 2));

    this.bloomA = createTarget(halfWidth, halfHeight, THREE.LinearFilter);
    this.bloomB = createTarget(halfWidth, halfHeight, THREE.LinearFilter);
  }

  private disposeTargets(): void {
    for (const target of [this.sceneTarget, this.litTarget, this.gradedTarget, this.bloomA, this.bloomB]) {
      target?.depthTexture?.dispose();
      target?.dispose();
    }

    this.sceneTarget = null;
    this.litTarget = null;
    this.gradedTarget = null;
    this.bloomA = null;
    this.bloomB = null;
  }
}
