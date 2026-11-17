import type { MemoryReader } from './MemoryReader';

/**
 * Perfis de memoria da Gen 3.
 *
 * Os jogos da Gen 3 sao tres MOTORES (familias) com cinco titulos:
 *   RS   - Ruby, Sapphire
 *   E    - Emerald
 *   FRLG - FireRed, LeafGreen
 * Hackroms herdam o motor do jogo base. O que muda entre motores e o que
 * importa para ler o jogo: SaveBlock1 fixo (RS) ou por ponteiro (E/FRLG),
 * tamanho do tileset primario (512/640), formato dos atributos de metatile
 * (u16 em RS/E, u32 em FRLG) e o layout com bloco de borda (FRLG).
 *
 * A deteccao aceita o codigo exato (AXVE, BPRE...), qualquer idioma e
 * revisao do mesmo titulo (prefixo de 3 letras) e, para hacks com o header
 * trocado, a familia deduzida da propria RAM (detectGen3FamilyFromMemory).
 * Os enderecos daqui sao o PRIMEIRO palpite: o Gen3RuntimeLocator confere
 * e, se nao baterem (outro idioma, hack que moveu a RAM, Ruby/Sapphire sem
 * endereco catalogado), acha as estruturas pela forma delas na memoria.
 */

export type Gen3GameId =
  | 'ruby'
  | 'sapphire'
  | 'emerald'
  | 'firered'
  | 'leafgreen';

export type Gen3Family =
  | 'RS'
  | 'E'
  | 'FRLG';

export type SaveBlock1AddressMode =
  | 'POINTER'
  | 'FIXED';

export interface Gen3ObjectStateLayout {
  objectEventsAddress: number;
  objectEventSize: number;

  playerAvatarAddress: number;

  playerAvatarRunningStateOffset: number;
  playerAvatarObjectEventIdOffset: number;

  objectEventCurrentCoordsOffset: number;
  objectEventFacingDirectionOffset: number;
  objectEventMovementDirectionOffset: number;
  objectEventMovementActionIdOffset: number;
}

export interface Gen3MapStateLayout {
  locationMapGroupOffset: number;
  locationMapNumOffset: number;
  mapLayoutIdOffset: number;
}

export interface Gen3MemoryLayout {
  saveBlock1AddressMode: SaveBlock1AddressMode;

  saveBlock1PointerAddress?: number;
  saveBlock1FixedAddress?: number;

  activeMapHeaderAddress?: number;

  playerPositionOffset: number;

  mapState?: Gen3MapStateLayout;

  // Ausente = descobrir em tempo de execucao (Gen3RuntimeLocator).
  objectState?: Gen3ObjectStateLayout;
}

export interface Gen3GameProfile {
  id: Gen3GameId;
  family: Gen3Family;
  gameCode: string;
  gameCodes: readonly string[];
  revision: number;
  supportedRevisions: readonly number[];
  title: string;
  memory: Gen3MemoryLayout;

  // true quando o codigo do ROM nao e o do perfil (outro idioma, hack com
  // header trocado): os enderecos sao so palpite e o localizador manda.
  inferred?: boolean;
}

const GEN3_MAP_STATE: Gen3MapStateLayout = {
  locationMapGroupOffset: 0x04,
  locationMapNumOffset: 0x05,
  mapLayoutIdOffset: 0x32,
};

/** Offsets de ObjectEvent/PlayerAvatar: iguais nos tres motores. */
export const GEN3_OBJECT_OFFSETS = {
  objectEventSize: 0x24,
  playerAvatarRunningStateOffset: 0x02,
  playerAvatarObjectEventIdOffset: 0x05,
  objectEventCurrentCoordsOffset: 0x10,
  objectEventFacingDirectionOffset: 0x18,
  objectEventMovementDirectionOffset: 0x18,
  objectEventMovementActionIdOffset: 0x1c,
} as const;

export function makeObjectStateLayout(
  objectEventsAddress: number,
  playerAvatarAddress: number,
): Gen3ObjectStateLayout {
  return {
    objectEventsAddress,
    playerAvatarAddress,
    ...GEN3_OBJECT_OFFSETS,
  };
}

const EMERALD_OBJECT_STATE = makeObjectStateLayout(0x02037350, 0x02037590);

const FRLG_OBJECT_STATE = makeObjectStateLayout(0x02036e38, 0x02037078);

// Ruby/Sapphire (EUA): gMapObjects e gPlayerAvatar ficam na IWRAM. Sem
// endereco confiavel catalogado aqui: o localizador acha pela estrutura
// (o struct MapObject do pokeruby tem o mesmo layout de 0x24 bytes).

const ALL_REVISIONS = [0, 1, 2] as const;

// Codigos de idioma: E (EUA/Europa), J, P (Europa), D, F, I, S.
const withLanguages = (prefix: string): string[] =>
  ['E', 'J', 'P', 'D', 'F', 'I', 'S'].map(language => prefix + language);

export const GEN3_PROFILES: Record<Gen3GameId, Gen3GameProfile> = {
  ruby: {
    id: 'ruby',
    family: 'RS',
    gameCode: 'AXVE',
    gameCodes: withLanguages('AXV'),
    revision: 0,
    supportedRevisions: ALL_REVISIONS,
    title: 'Pokémon Ruby',
    memory: {
      saveBlock1AddressMode: 'FIXED',
      saveBlock1FixedAddress: 0x02025734,
      playerPositionOffset: 0x00,
      mapState: GEN3_MAP_STATE,
    },
  },

  sapphire: {
    id: 'sapphire',
    family: 'RS',
    gameCode: 'AXPE',
    gameCodes: withLanguages('AXP'),
    revision: 0,
    supportedRevisions: ALL_REVISIONS,
    title: 'Pokémon Sapphire',
    memory: {
      saveBlock1AddressMode: 'FIXED',
      saveBlock1FixedAddress: 0x02025734,
      playerPositionOffset: 0x00,
      mapState: GEN3_MAP_STATE,
    },
  },

  emerald: {
    id: 'emerald',
    family: 'E',
    gameCode: 'BPEE',
    gameCodes: withLanguages('BPE'),
    revision: 0,
    supportedRevisions: ALL_REVISIONS,
    title: 'Pokémon Emerald',
    memory: {
      saveBlock1AddressMode: 'POINTER',
      saveBlock1PointerAddress: 0x03005d8c,
      activeMapHeaderAddress: 0x02037318,
      playerPositionOffset: 0x00,
      mapState: GEN3_MAP_STATE,
      objectState: EMERALD_OBJECT_STATE,
    },
  },

  firered: {
    id: 'firered',
    family: 'FRLG',
    gameCode: 'BPRE',
    gameCodes: withLanguages('BPR'),
    revision: 0,
    supportedRevisions: ALL_REVISIONS,
    title: 'Pokémon FireRed',
    memory: {
      saveBlock1AddressMode: 'POINTER',
      saveBlock1PointerAddress: 0x03005008,
      activeMapHeaderAddress: 0x02036dfc,
      playerPositionOffset: 0x00,
      mapState: GEN3_MAP_STATE,
      objectState: FRLG_OBJECT_STATE,
    },
  },

  leafgreen: {
    id: 'leafgreen',
    family: 'FRLG',
    gameCode: 'BPGE',
    gameCodes: withLanguages('BPG'),
    revision: 0,
    supportedRevisions: ALL_REVISIONS,
    title: 'Pokémon LeafGreen',
    memory: {
      saveBlock1AddressMode: 'POINTER',
      saveBlock1PointerAddress: 0x03005008,
      activeMapHeaderAddress: 0x02036dfc,
      playerPositionOffset: 0x00,
      mapState: GEN3_MAP_STATE,
      objectState: FRLG_OBJECT_STATE,
    },
  },
};

// Perfil canonico de cada motor, para hacks com codigo desconhecido.
const FAMILY_BASE: Record<Gen3Family, Gen3GameId> = {
  RS: 'ruby',
  E: 'emerald',
  FRLG: 'firered',
};

/** O codigo de 4 letras e o da versao americana original (sem inferencia)? */
function isPrimaryCode(profile: Gen3GameProfile, gameCode: string): boolean {
  return gameCode === profile.gameCode;
}

function cloneProfile(
  profile: Gen3GameProfile,
  gameCode: string,
  revision: number,
  inferred: boolean,
  title?: string,
): Gen3GameProfile {
  return {
    ...profile,
    gameCode,
    revision,
    inferred,
    title: title ?? profile.title,
    memory: { ...profile.memory },
  };
}

/**
 * Perfil pelo header do ROM: codigo exato de qualquer idioma/revisao.
 * Outros idiomas que nao o americano ficam marcados como inferidos (a RAM
 * pode ter outro layout; o localizador confere).
 */
export function detectGen3Game(
  gameCode: string,
  revision: number,
): Gen3GameProfile | null {
  for (const profile of Object.values(GEN3_PROFILES)) {
    if (profile.gameCodes.includes(gameCode)) {
      return cloneProfile(
        profile,
        gameCode,
        revision,
        !isPrimaryCode(profile, gameCode) || !profile.supportedRevisions.includes(revision),
      );
    }
  }

  return null;
}

/** Familia pelo prefixo do codigo, ou null se o header nao e de Gen 3. */
export function familyFromGameCode(gameCode: string): Gen3Family | null {
  const prefix = gameCode.slice(0, 3);

  if (prefix === 'AXV' || prefix === 'AXP') {
    return 'RS';
  }

  if (prefix === 'BPE') {
    return 'E';
  }

  if (prefix === 'BPR' || prefix === 'BPG') {
    return 'FRLG';
  }

  return null;
}

export function profileForFamily(
  family: Gen3Family,
  gameCode: string,
  revision: number,
): Gen3GameProfile {
  return cloneProfile(
    GEN3_PROFILES[FAMILY_BASE[family]],
    gameCode,
    revision,
    true,
    `Gen 3 (${gameCode || 'hack'}, motor ${family})`,
  );
}

const EWRAM_START = 0x02000000;
const EWRAM_END = 0x02040000;

/**
 * SaveBlock1 plausivel: posicao dentro de um mapa, grupo de mapas pequeno
 * e id de layout valido. Na tela de titulo tudo e zero e nao passa.
 */
export function isPlausibleSaveBlock1(memory: MemoryReader, address: number): boolean {
  if (address < EWRAM_START || address + 0x40 > EWRAM_END || (address & 3) !== 0) {
    return false;
  }

  const x = memory.readU16(address);
  const y = memory.readU16(address + 2);
  const mapGroup = memory.readU8(address + 4);
  const layoutId = memory.readU16(address + GEN3_MAP_STATE.mapLayoutIdOffset);

  return x < 1024 && y < 1024 && mapGroup < 64 && layoutId > 0 && layoutId < 0x800;
}

/**
 * Motor de um ROM com header desconhecido, pela RAM viva: o ponteiro do
 * SaveBlock1 do FRLG (0x03005008) ou do Emerald (0x03005D8C), ou o bloco
 * fixo do Ruby/Sapphire. So responde depois que o jogo chegou ao
 * overworld (antes disso a RAM e zero e nada passa).
 */
export function detectGen3FamilyFromMemory(memory: MemoryReader): Gen3Family | null {
  const frlg = memory.readU32(0x03005008);

  if (isPlausibleSaveBlock1(memory, frlg)) {
    return 'FRLG';
  }

  const emerald = memory.readU32(0x03005d8c);

  if (isPlausibleSaveBlock1(memory, emerald)) {
    return 'E';
  }

  if (isPlausibleSaveBlock1(memory, 0x02025734)) {
    return 'RS';
  }

  return null;
}

/** Numero de tiles/metatiles no tileset primario de cada motor. */
export function primaryTilesetSize(family: Gen3Family | undefined): number {
  return family === 'FRLG' ? 640 : 512;
}
