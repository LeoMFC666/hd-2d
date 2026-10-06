export type Gen3GameId =
  | 'ruby'
  | 'sapphire'
  | 'emerald'
  | 'firered'
  | 'leafgreen';

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
  saveBlock1AddressMode:
    SaveBlock1AddressMode;

  saveBlock1PointerAddress?: number;
  saveBlock1FixedAddress?: number;

  activeMapHeaderAddress?: number;

  playerPositionOffset: number;

  mapState?: Gen3MapStateLayout;

  objectState?: Gen3ObjectStateLayout;
}

export interface Gen3GameProfile {
  id: Gen3GameId;
  gameCode: string;
  gameCodes: readonly string[];
  revision: number;
  supportedRevisions: readonly number[];
  title: string;
  memory: Gen3MemoryLayout;
}

const GEN3_MAP_STATE:
  Gen3MapStateLayout = {
  locationMapGroupOffset:
    0x04,

  locationMapNumOffset:
    0x05,

  mapLayoutIdOffset:
    0x32,
};

const EMERALD_OBJECT_STATE:
  Gen3ObjectStateLayout = {
  objectEventsAddress:
    0x02037350,

  objectEventSize:
    0x24,

  playerAvatarAddress:
    0x02037590,

  playerAvatarRunningStateOffset:
    0x02,

  playerAvatarObjectEventIdOffset:
    0x05,

  objectEventCurrentCoordsOffset:
    0x10,

  objectEventFacingDirectionOffset:
    0x18,

  objectEventMovementDirectionOffset:
    0x18,

  objectEventMovementActionIdOffset:
    0x1c,
};

const FRLG_OBJECT_STATE:
  Gen3ObjectStateLayout = {
  objectEventsAddress:
    0x02036e38,

  objectEventSize:
    0x24,

  playerAvatarAddress:
    0x02037078,

  playerAvatarRunningStateOffset:
    0x02,

  playerAvatarObjectEventIdOffset:
    0x05,

  objectEventCurrentCoordsOffset:
    0x10,

  objectEventFacingDirectionOffset:
    0x18,

  objectEventMovementDirectionOffset:
    0x18,

  objectEventMovementActionIdOffset:
    0x1c,
};

export const GEN3_PROFILES:
  Record<
    Gen3GameId,
    Gen3GameProfile
  > = {
  ruby: {
    id:
      'ruby',

    gameCode:
      'AXVE',

    gameCodes: [
      'AXVE',
    ],

    revision:
      0,

    supportedRevisions: [
      0,
    ],

    title:
      'Pokémon Ruby',

    memory: {
      saveBlock1AddressMode:
        'FIXED',

      saveBlock1FixedAddress:
        0x02025734,

      playerPositionOffset:
        0x00,

      mapState:
        GEN3_MAP_STATE,
    },
  },

  sapphire: {
    id:
      'sapphire',

    gameCode:
      'AXPE',

    gameCodes: [
      'AXPE',
    ],

    revision:
      0,

    supportedRevisions: [
      0,
    ],

    title:
      'Pokémon Sapphire',

    memory: {
      saveBlock1AddressMode:
        'FIXED',

      saveBlock1FixedAddress:
        0x02025734,

      playerPositionOffset:
        0x00,

      mapState:
        GEN3_MAP_STATE,
    },
  },

  emerald: {
    id:
      'emerald',

    gameCode:
      'BPEE',

    gameCodes: [
      'BPEE',
    ],

    revision:
      0,

    supportedRevisions: [
      0,
    ],

    title:
      'Pokémon Emerald',

    memory: {
      saveBlock1AddressMode:
        'POINTER',

      saveBlock1PointerAddress:
        0x03005d8c,

      activeMapHeaderAddress:
        0x02037318,

      playerPositionOffset:
        0x00,

      mapState:
        GEN3_MAP_STATE,

      objectState:
        EMERALD_OBJECT_STATE,
    },
  },

  firered: {
    id:
      'firered',

    gameCode:
      'BPRE',

    gameCodes: [
      'BPRE',
      'BPRP',
      'BPRJ',
    ],

    revision:
      0,

    supportedRevisions: [
      0,
      1,
    ],

    title:
      'Pokémon FireRed',

    memory: {
      saveBlock1AddressMode:
        'POINTER',

      saveBlock1PointerAddress:
        0x03005008,

      activeMapHeaderAddress:
        0x02036dfc,

      playerPositionOffset:
        0x00,

      mapState:
        GEN3_MAP_STATE,

      objectState:
        FRLG_OBJECT_STATE,
    },
  },

  leafgreen: {
    id:
      'leafgreen',

    gameCode:
      'BPGE',

    gameCodes: [
      'BPGE',
      'BPGP',
      'BPGJ',
    ],

    revision:
      0,

    supportedRevisions: [
      0,
      1,
    ],

    title:
      'Pokémon LeafGreen',

    memory: {
      saveBlock1AddressMode:
        'POINTER',

      saveBlock1PointerAddress:
        0x03005008,

      activeMapHeaderAddress:
        0x02036dfc,

      playerPositionOffset:
        0x00,

      mapState:
        GEN3_MAP_STATE,

      objectState:
        FRLG_OBJECT_STATE,
    },
  },
};

export function detectGen3Game(
  gameCode: string,
  revision: number,
): Gen3GameProfile | null {
  const profile =
    Object.values(
      GEN3_PROFILES,
    ).find(
      (
        candidate,
      ) =>
        candidate.gameCodes.includes(
          gameCode,
        ) &&
        candidate.supportedRevisions.includes(
          revision,
        ),
    );

  return profile ?? null;
}
