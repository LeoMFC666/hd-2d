import type { MemoryReader } from './MemoryReader';

import {
  GEN3_OBJECT_OFFSETS,
  isPlausibleSaveBlock1,
  makeObjectStateLayout,
  type Gen3GameProfile,
  type Gen3ObjectStateLayout,
} from './GameProfile';

/**
 * Acha na RAM viva as estruturas que o 2.5D le, PELA FORMA delas, para que
 * qualquer jogo da Gen 3 funcione - inclusive os que nao tem endereco
 * catalogado (Ruby/Sapphire, outros idiomas, hacks que moveram a RAM).
 *
 *   gObjectEvents[16]  struct ObjectEvent, 0x24 bytes cada (RS: MapObject,
 *                      mesmo layout). O do jogador tem os bits active (0) e
 *                      isPlayer (16) ligados, o mapa do SaveBlock1 em
 *                      0x09/0x0A e as coordenadas do SaveBlock1 + 7 em 0x10.
 *   gPlayerAvatar      8 bytes iniciais muito restritos: flags, estado de
 *                      corrida (0-2), transicao de tile (0-2), spriteId e
 *                      objectEventId do jogador, preventStep e genero (0/1).
 *   gSaveBlock1        posicao (x, y) + mapa (grupo, numero) do jogador e o
 *                      id do layout em 0x32. No E/FRLG o bloco MUDA de lugar
 *                      (o jogo embaralha os saveblocks); o ponteiro na IWRAM
 *                      e achado procurando quem aponta para ele.
 *
 * Os enderecos do perfil sao testados primeiro; a varredura so roda quando
 * eles nao batem, no maximo uma vez por SCAN_INTERVAL_MS, e o resultado e
 * guardado (as tabelas sao estaticas durante a sessao).
 */

const EWRAM: readonly [number, number] = [0x02000000, 0x02040000];

const IWRAM: readonly [number, number] = [0x03000000, 0x03008000];

const OBJECT_EVENT_COUNT = 16;

const OBJECT_EVENT_SIZE = GEN3_OBJECT_OFFSETS.objectEventSize;

const MAP_OFFSET = 7;

const MAX_SPRITES = 64;

const SCAN_INTERVAL_MS = 1000;

// Conferencia periodica de que a tabela descoberta acompanha o jogador.
const LIVENESS_INTERVAL_MS = 1000;

const LIVENESS_MAX_FAILURES = 3;

// Espera com o SaveBlock1 valido antes da primeira varredura (o save
// acabou de carregar e o avatar ainda nao foi montado).
const SETTLE_MS = 1500;

// Avatar a ate esta distancia da tabela: par confiavel, para de procurar.
const NEAR_AVATAR_DISTANCE = 0x400;

const MAX_REFINE_SCANS = 15;

const REFINE_INTERVAL_MS = 2000;

// Tempo de leituras ruins dos enderecos do perfil (com o SaveBlock1 valido)
// antes de partir para a varredura.
const PROFILE_GIVE_UP_MS = 8000;

// Maior SaveBlock1 da Gen 3 (Emerald, 0x3D88), arredondado.
const SAVEBLOCK1_MAX_SIZE = 0x4000;

// Bits active (0) e isPlayer (16) do bitfield do ObjectEvent.
const ACTIVE_AND_PLAYER = 0x00010001;

export interface RuntimeLocatorReport {
  saveBlock1: string;
  objectEvents: string;
  playerAvatar: string;
  source: 'perfil' | 'descoberto' | 'pendente';
}

const hex = (value: number | null | undefined): string =>
  value ? '0x' + value.toString(16).padStart(8, '0') : '-';

export class Gen3RuntimeLocator {
  private readonly memory: MemoryReader;

  private profile: Gen3GameProfile;

  // Forca a varredura mesmo com enderecos de perfil (depuracao/teste):
  // ?gen3discover=1 na URL.
  private readonly forceDiscovery: boolean;

  private discoveredSaveBlockPointer: number | null = null;

  private discoveredSaveBlockFixed: number | null = null;

  private objectState: Gen3ObjectStateLayout | null = null;

  private objectStateSource: 'perfil' | 'descoberto' | null = null;

  private nextObjectScanAt = 0;

  private nextSaveScanAt = 0;

  private profileFailingSince = 0;

  private nextLivenessCheckAt = 0;

  private savePlausibleSince = 0;

  private refineScans = 0;

  private saveBlockCandidates: Array<{ address: number; x: number; y: number }> = [];

  private livenessFailures = 0;

  constructor(memory: MemoryReader, profile: Gen3GameProfile, forceDiscovery = false) {
    this.memory = memory;
    this.profile = profile;
    this.forceDiscovery = forceDiscovery;
  }

  setProfile(profile: Gen3GameProfile): void {
    this.profile = profile;
  }

  report(): RuntimeLocatorReport {
    return {
      saveBlock1: hex(this.resolveSaveBlock1()),
      objectEvents: hex(this.objectState?.objectEventsAddress),
      playerAvatar: hex(this.objectState?.playerAvatarAddress),
      source: this.objectStateSource ?? 'pendente',
    };
  }

  /**
   * Endereco do SaveBlock1. Ordem: o do perfil (fixo ou por ponteiro), o
   * descoberto, e por fim o do perfil mesmo invalido (o leitor confere).
   */
  resolveSaveBlock1(now = 0): number {
    const memory = this.profile.memory;

    let profileAddress = 0;

    if (memory.saveBlock1AddressMode === 'FIXED') {
      profileAddress = memory.saveBlock1FixedAddress ?? 0;
    } else if (memory.saveBlock1PointerAddress !== undefined) {
      profileAddress = this.memory.readU32(memory.saveBlock1PointerAddress);
    }

    if (!this.forceDiscovery && isPlausibleSaveBlock1(this.memory, profileAddress)) {
      return profileAddress;
    }

    // Ponteiro descoberto: o bloco que ele aponta e o vivo, mesmo quando
    // por um instante nao parece valido (o jogo esta mudando o bloco de
    // lugar num warp).
    if (this.discoveredSaveBlockPointer !== null) {
      return this.memory.readU32(this.discoveredSaveBlockPointer);
    }

    this.confirmLiveSaveBlock();

    if (this.discoveredSaveBlockFixed !== null) {
      return this.discoveredSaveBlockFixed;
    }

    // Sem SaveBlock1 valido mas com os ObjectEvents conhecidos: procurar o
    // bloco pela posicao e mapa do jogador. So quando o perfil nao e de
    // confianca (inferido, ou forcado para teste): num jogo conhecido o
    // bloco fica invalido so durante a carga, e uma copia velha achada ali
    // poria o mapa errado na tela.
    const trustedProfile = !this.profile.inferred && !this.forceDiscovery;

    if (!trustedProfile && this.objectState && now >= this.nextSaveScanAt) {
      this.nextSaveScanAt = now + SCAN_INTERVAL_MS;

      const found = this.scanSaveBlock1(this.objectState);

      if (found !== 0) {
        return found;
      }
    }

    return profileAddress;
  }

  /**
   * Layout dos ObjectEvents e do PlayerAvatar, ou null enquanto nao achou
   * (tela de titulo, batalha antes do primeiro overworld).
   */
  getObjectState(saveBlock1: number, now: number): Gen3ObjectStateLayout | null {
    const profileLayout = this.profile.memory.objectState;

    // 1. Enderecos do perfil, enquanto baterem.
    if (profileLayout && !this.forceDiscovery && this.objectStateSource !== 'descoberto') {
      if (this.isObjectStateUsable(profileLayout)) {
        this.adopt(profileLayout, 'perfil');

        return profileLayout;
      }

      // Quadro sem jogador (warp, batalha) com o perfil ja confirmado.
      if (this.objectStateSource === 'perfil') {
        return this.objectState;
      }

      // Perfil errado (outro idioma, hack): so desiste dele depois de
      // alguns segundos de leituras ruins com o SaveBlock1 ja valido (o
      // save carrega antes do overworld montar os objetos).
      if (!isPlausibleSaveBlock1(this.memory, saveBlock1)) {
        this.profileFailingSince = 0;

        return null;
      }

      this.profileFailingSince ||= now;

      if (now - this.profileFailingSince < PROFILE_GIVE_UP_MS) {
        return null;
      }
    }

    // 2. Tabela descoberta: a tabela nao muda de lugar durante o jogo, mas
    // uma copia parada (gravada no save) pode ter passado na varredura
    // logo depois de carregar. Ela para de acompanhar o jogador assim que
    // ele anda; ai e descartada.
    if (this.objectStateSource === 'descoberto' && this.objectState) {
      this.checkLiveness(this.objectState, saveBlock1, now);
    }

    const current = this.objectState;

    // Avatar longe da tabela: algumas novas varreduras procuram um par
    // melhor (a primeira pode ter rodado com o avatar ainda sendo montado).
    const needsScan =
      !current ||
      (this.refineScans < MAX_REFINE_SCANS && this.avatarDistance(current) > NEAR_AVATAR_DISTANCE);

    if (!needsScan || now < this.nextObjectScanAt) {
      return current;
    }

    if (!isPlausibleSaveBlock1(this.memory, saveBlock1)) {
      this.savePlausibleSince = 0;

      return current;
    }

    // Logo depois de carregar o save a RAM ainda esta sendo montada.
    this.savePlausibleSince ||= now;

    if (now - this.savePlausibleSince < SETTLE_MS) {
      return current;
    }

    this.nextObjectScanAt = now + (current ? REFINE_INTERVAL_MS : SCAN_INTERVAL_MS);

    if (current) {
      this.refineScans++;
    }

    const found = this.scanObjectState(saveBlock1);

    if (found && (!current || this.avatarDistance(found) < this.avatarDistance(current))) {
      this.adopt(found, 'descoberto');
    }

    return this.objectState;
  }

  private avatarDistance(layout: Gen3ObjectStateLayout): number {
    return layout.playerAvatarAddress === 0
      ? Infinity
      : Math.abs(layout.playerAvatarAddress - layout.objectEventsAddress);
  }

  private checkLiveness(layout: Gen3ObjectStateLayout, saveBlock1: number, now: number): void {
    if (now < this.nextLivenessCheckAt || !isPlausibleSaveBlock1(this.memory, saveBlock1)) {
      return;
    }

    this.nextLivenessCheckAt = now + LIVENESS_INTERVAL_MS;

    // Fora do overworld o jogador nao esta na tabela: nao conta.
    if (!this.isObjectStateUsable(layout)) {
      return;
    }

    if (this.tracksSaveBlock(layout, saveBlock1)) {
      this.livenessFailures = 0;

      return;
    }

    if (++this.livenessFailures < LIVENESS_MAX_FAILURES) {
      return;
    }

    console.log('[gen3] tabela de ObjectEvents parada (copia); procurando de novo.');

    this.objectState = null;
    this.objectStateSource = null;
    this.livenessFailures = 0;
    this.refineScans = 0;
  }

  private adopt(layout: Gen3ObjectStateLayout, source: 'perfil' | 'descoberto'): void {
    const changed =
      this.objectState?.objectEventsAddress !== layout.objectEventsAddress ||
      this.objectState?.playerAvatarAddress !== layout.playerAvatarAddress;

    this.objectState = layout;
    this.objectStateSource = source;

    if (changed) {
      console.log(
        `[gen3] ObjectEvents ${hex(layout.objectEventsAddress)} | ` +
          `PlayerAvatar ${hex(layout.playerAvatarAddress)} (${source})`,
      );
    }
  }

  /**
   * O avatar aponta para um ObjectEvent ativo com o bit isPlayer, com o
   * mesmo sprite, e esta num modo valido (a pe, bike, surf, mergulho)?
   */
  private isObjectStateUsable(layout: Gen3ObjectStateLayout, strict = false): boolean {
    const avatar = layout.playerAvatarAddress;

    if (avatar === 0) {
      return this.playerObjectEventAddress(layout) !== 0;
    }
    const objectEventId = this.memory.readU8(avatar + layout.playerAvatarObjectEventIdOffset);

    if (objectEventId >= OBJECT_EVENT_COUNT) {
      return false;
    }

    const entry = layout.objectEventsAddress + objectEventId * layout.objectEventSize;
    const flags = this.memory.readU32(entry);
    const mode = this.memory.readU8(avatar) & 0x1f;

    if ((flags & ACTIVE_AND_PLAYER) !== ACTIVE_AND_PLAYER) {
      return false;
    }

    // Enderecos do perfil: basta o avatar apontar para o jogador (o FRLG
    // deixa as flags do avatar zeradas por alguns segundos depois de
    // carregar o save). Avatar descoberto: assinatura completa.
    return (
      !strict ||
      (this.memory.readU8(avatar + 4) === this.memory.readU8(entry + 4) &&
        mode !== 0 &&
        (mode & (mode - 1)) === 0)
    );
  }

  /**
   * Varredura: ObjectEvent do jogador -> base da tabela -> PlayerAvatar
   * que aponta para ele. Tudo validado contra o SaveBlock1 quando ele e
   * plausivel; sem ele, so pela coerencia das proprias estruturas.
   */
  private scanObjectState(saveBlock1: number): Gen3ObjectStateLayout | null {
    // Sem SaveBlock1 nao ha como distinguir a tabela viva das copias.
    if (!isPlausibleSaveBlock1(this.memory, saveBlock1)) {
      return null;
    }

    const save = {
      x: this.memory.readU16(saveBlock1),
      y: this.memory.readU16(saveBlock1 + 2),
      mapGroup: this.memory.readU8(saveBlock1 + 4),
      mapNum: this.memory.readU8(saveBlock1 + 5),
    };

    // O SaveBlock1 guarda uma COPIA dos ObjectEvents (gravada ao salvar),
    // que bate com o jogador logo depois de carregar o save mas fica
    // parada. Tudo dentro dele fica de fora.
    const insideSaveBlock = (address: number): boolean =>
      address >= saveBlock1 && address < saveBlock1 + SAVEBLOCK1_MAX_SIZE;

    const players: Array<{ address: number; spriteId: number }> = [];

    for (const [start, end] of [EWRAM, IWRAM]) {
      for (let address = start; address + OBJECT_EVENT_SIZE <= end; address += 4) {
        const flags = this.memory.readU32(address);

        if (
          (flags & ACTIVE_AND_PLAYER) !== ACTIVE_AND_PLAYER ||
          insideSaveBlock(address)
        ) {
          continue;
        }

        const spriteId = this.memory.readU8(address + 4);

        if (spriteId >= MAX_SPRITES) {
          continue;
        }

        const x = this.s16(address + 0x10) - MAP_OFFSET;
        const y = this.s16(address + 0x12) - MAP_OFFSET;

        if (
          this.memory.readU8(address + 0x0a) !== save.mapGroup ||
          this.memory.readU8(address + 0x09) !== save.mapNum ||
          Math.abs(x - save.x) > 1 ||
          Math.abs(y - save.y) > 1
        ) {
          continue;
        }

        players.push({ address, spriteId });

        if (players.length > 16) {
          break;
        }
      }
    }

    if (players.length === 0) {
      return null;
    }

    // Candidatos a PlayerAvatar: uma passada so, guardando por
    // (spriteId, objectEventId).
    const avatars = new Map<number, number[]>();

    for (const [start, end] of [EWRAM, IWRAM]) {
      for (let address = start; address + 8 <= end; address += 4) {
        const head = this.memory.readU32(address);
        const tail = this.memory.readU32(address + 4);

        const flags = head & 0xff;
        const runningState = (head >>> 16) & 0xff;
        const tileTransition = head >>> 24;
        const spriteId = tail & 0xff;
        const objectEventId = (tail >>> 8) & 0xff;
        const preventStep = (tail >>> 16) & 0xff;
        const gender = tail >>> 24;

        // Modo do avatar: exatamente um entre a pe, mach bike, acro bike,
        // surfando e mergulhando. Memoria lixo (0xFF) tem todos ligados.
        const mode = flags & 0x1f;

        if (
          insideSaveBlock(address) ||
          mode === 0 ||
          (mode & (mode - 1)) !== 0 ||
          runningState > 2 ||
          tileTransition > 2 ||
          spriteId >= MAX_SPRITES ||
          objectEventId >= OBJECT_EVENT_COUNT ||
          preventStep > 1 ||
          gender > 1
        ) {
          continue;
        }

        const key = spriteId | (objectEventId << 8);
        const list = avatars.get(key) ?? [];

        list.push(address);
        avatars.set(key, list);
      }
    }

    // Para cada ObjectEvent de jogador, as bases possiveis da tabela (o
    // jogador pode estar em qualquer indice). Vence a base com o avatar
    // mais perto: nos motores E e FRLG gPlayerAvatar e declarado logo
    // depois de gObjectEvents (distancia 0x240). Sem avatar perto (copias
    // da tabela, ou um motor que declara os dois longe), a tabela vale
    // sozinha, com o jogador no indice 0 se possivel - e onde o jogo cria
    // o jogador - e o avatar fica de fora: o jogador e achado pelo bit
    // isPlayer.
    let best: { base: number; avatar: number; score: number } | null = null;

    for (const player of players) {
      for (let index = 0; index < OBJECT_EVENT_COUNT; index++) {
        const base = player.address - index * OBJECT_EVENT_SIZE;

        if (!this.isPlausibleObjectEventArray(base, index)) {
          continue;
        }

        // O avatar nunca fica dentro da propria tabela (bytes de um
        // ObjectEvent podem imitar a assinatura).
        const tableEnd = base + OBJECT_EVENT_COUNT * OBJECT_EVENT_SIZE;

        let avatar = 0;
        let distance = Infinity;

        for (const candidate of avatars.get(player.spriteId | (index << 8)) ?? []) {
          if (candidate + 8 > base && candidate < tableEnd) {
            continue;
          }

          const gap = candidate >= tableEnd ? candidate - tableEnd : base - candidate;

          if (gap < distance) {
            distance = gap;
            avatar = candidate;
          }
        }

        // Pontuacao: avatar colado (0) < avatar perto < sem avatar, jogador
        // no indice 0 < outros indices.
        const near = distance <= NEAR_AVATAR_DISTANCE;
        const score = (near ? distance : 0x100000) + index * 0x10;

        if (!best || score < best.score) {
          best = { base, avatar: near ? avatar : 0, score };
        }
      }
    }

    return best ? makeObjectStateLayout(best.base, best.avatar) : null;
  }

  /**
   * Endereco do ObjectEvent do jogador: pelo avatar quando conhecido, senao
   * pelo bit isPlayer. 0 se nao ha jogador na tabela agora.
   */
  playerObjectEventAddress(layout: Gen3ObjectStateLayout): number {
    if (layout.playerAvatarAddress !== 0) {
      const index = this.memory.readU8(
        layout.playerAvatarAddress + layout.playerAvatarObjectEventIdOffset,
      );

      return index < OBJECT_EVENT_COUNT
        ? layout.objectEventsAddress + index * layout.objectEventSize
        : 0;
    }

    for (let index = 0; index < OBJECT_EVENT_COUNT; index++) {
      const address = layout.objectEventsAddress + index * layout.objectEventSize;

      if ((this.memory.readU32(address) & ACTIVE_AND_PLAYER) === ACTIVE_AND_PLAYER) {
        return address;
      }
    }

    return 0;
  }

  /**
   * A tabela adotada ainda acompanha o jogador? Uma copia parada (que
   * passou na varredura logo depois de carregar o save) deixa de bater
   * com o SaveBlock1 assim que o jogador anda.
   */
  private tracksSaveBlock(layout: Gen3ObjectStateLayout, saveBlock1: number): boolean {
    const player = this.playerObjectEventAddress(layout);

    if (player === 0) {
      return false;
    }

    return (
      this.memory.readU8(player + 0x0a) === this.memory.readU8(saveBlock1 + 4) &&
      this.memory.readU8(player + 0x09) === this.memory.readU8(saveBlock1 + 5) &&
      Math.abs(this.s16(player + 0x10) - MAP_OFFSET - this.s16(saveBlock1)) <= 1 &&
      Math.abs(this.s16(player + 0x12) - MAP_OFFSET - this.s16(saveBlock1 + 2)) <= 1
    );
  }

  /**
   * Tabela inteira coerente: entradas ativas com sprite, mapa e
   * coordenadas plausiveis, e so o jogador com o bit isPlayer.
   */
  private isPlausibleObjectEventArray(base: number, playerIndex: number): boolean {
    const [start, end] = base >= IWRAM[0] ? IWRAM : EWRAM;

    if (base < start || base + OBJECT_EVENT_COUNT * OBJECT_EVENT_SIZE > end) {
      return false;
    }

    for (let index = 0; index < OBJECT_EVENT_COUNT; index++) {
      const address = base + index * OBJECT_EVENT_SIZE;
      const flags = this.memory.readU32(address);

      if ((flags & 1) === 0) {
        continue;
      }

      if (index !== playerIndex && (flags & ACTIVE_AND_PLAYER) === ACTIVE_AND_PLAYER) {
        return false;
      }

      const x = this.s16(address + 0x10);
      const y = this.s16(address + 0x12);

      if (
        this.memory.readU8(address + 4) > MAX_SPRITES ||
        this.memory.readU8(address + 0x0a) >= 64 ||
        x < -16 ||
        y < -16 ||
        x > 1100 ||
        y > 1100
      ) {
        return false;
      }
    }

    return true;
  }

  /**
   * SaveBlock1 pela posicao do jogador: x, y (sem o deslocamento de 7) e
   * mapa. Depois, quem aponta para ele na IWRAM (E/FRLG movem o bloco).
   */
  private scanSaveBlock1(layout: Gen3ObjectStateLayout): number {
    const player = this.isObjectStateUsable(layout) ? this.playerObjectEventAddress(layout) : 0;

    if (player === 0) {
      return 0;
    }
    const x = this.s16(player + 0x10) - MAP_OFFSET;
    const y = this.s16(player + 0x12) - MAP_OFFSET;
    const mapNum = this.memory.readU8(player + 0x09);
    const mapGroup = this.memory.readU8(player + 0x0a);

    const blocks: number[] = [];

    for (let address = EWRAM[0]; address + 0x40 <= EWRAM[1]; address += 4) {
      if (
        this.memory.readU8(address + 4) !== mapGroup ||
        this.memory.readU8(address + 5) !== mapNum
      ) {
        continue;
      }

      const sx = this.s16(address);
      const sy = this.s16(address + 2);

      if (Math.abs(sx - x) > 1 || Math.abs(sy - y) > 1) {
        continue;
      }

      if (isPlausibleSaveBlock1(this.memory, address)) {
        blocks.push(address);
      }
    }

    if (blocks.length === 0) {
      return 0;
    }

    // Copias do bloco (buffers de setor do save) tambem casam. O vivo, no
    // E e no FRLG, e o apontado por gSaveBlock1Ptr - que vem seguido de
    // gSaveBlock2Ptr, apontando para um bloco que comeca com o nome do
    // jogador.
    for (let pointer = IWRAM[0]; pointer < IWRAM[1]; pointer += 4) {
      const value = this.memory.readU32(pointer);

      if (!blocks.includes(value)) {
        continue;
      }

      if (this.isPlausibleSaveBlock2(this.memory.readU32(pointer + 4))) {
        this.discoveredSaveBlockPointer = pointer;

        console.log(`[gen3] SaveBlock1 ${hex(value)} via ponteiro ${hex(pointer)}`);

        return value;
      }
    }

    // Sem ponteiro (Ruby/Sapphire): bloco fixo. Se mais de um casar, os
    // candidatos ficam guardados e vence o primeiro que MUDAR quando o
    // jogador andar (as copias ficam paradas) - ver confirmLiveSaveBlock.
    this.saveBlockCandidates = blocks.map(address => ({
      address,
      x: this.s16(address),
      y: this.s16(address + 2),
    }));

    this.discoveredSaveBlockFixed = blocks[0];

    console.log(
      `[gen3] SaveBlock1 fixo em ${hex(blocks[0])}` +
        (blocks.length > 1 ? ` (${blocks.length} candidatos)` : ''),
    );

    return blocks[0];
  }

  /** Entre blocos fixos candidatos, adota o primeiro cuja posicao mudou. */
  private confirmLiveSaveBlock(): void {
    if (this.saveBlockCandidates.length < 2) {
      return;
    }

    for (const candidate of this.saveBlockCandidates) {
      if (
        this.s16(candidate.address) !== candidate.x ||
        this.s16(candidate.address + 2) !== candidate.y
      ) {
        if (this.discoveredSaveBlockFixed !== candidate.address) {
          console.log(`[gen3] SaveBlock1 vivo confirmado em ${hex(candidate.address)}`);
        }

        this.discoveredSaveBlockFixed = candidate.address;
        this.saveBlockCandidates = [];

        // A tabela de objetos foi validada contra o bloco antigo.
        if (this.objectStateSource === 'descoberto') {
          this.livenessFailures = 0;
          this.nextLivenessCheckAt = 0;
        }

        return;
      }
    }
  }

  /**
   * SaveBlock2: nome do jogador (ate 7 caracteres do alfabeto da Gen 3,
   * terminado em 0xFF) e genero 0/1 logo depois.
   */
  private isPlausibleSaveBlock2(address: number): boolean {
    if (address < EWRAM[0] || address + 16 > EWRAM[1]) {
      return false;
    }

    let length = 0;

    while (length < 8 && this.memory.readU8(address + length) !== 0xff) {
      length++;
    }

    return length >= 1 && length <= 7 && this.memory.readU8(address + 8) <= 1;
  }

  private s16(address: number): number {
    const value = this.memory.readU16(address);

    return value >= 0x8000 ? value - 0x10000 : value;
  }
}
