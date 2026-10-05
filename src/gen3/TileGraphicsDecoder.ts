import type { MemoryReader } from './MemoryReader';
import type { TileGraphicsState } from './GameState';

const TILE_WIDTH = 8;
const TILE_HEIGHT = 8;
const TILE_BYTES = 32;

const LZ77_HEADER = 0x10;

export class TileGraphicsDecoder {
  private readonly memoryReader: MemoryReader;

  private readonly decompressedTilesCache =
    new Map<string, Uint8Array>();

  constructor(
    memoryReader: MemoryReader,
  ) {
    this.memoryReader =
      memoryReader;
  }

  readTile(
    tilesAddress: number,
    tileId: number,
    isCompressed: boolean,
  ): TileGraphicsState | null {
    if (
      tilesAddress <= 0 ||
      tileId < 0
    ) {
      return null;
    }

    const tiles =
      this.getTilesData(
        tilesAddress,
        isCompressed,
      );

    const tileAddress =
      tileId * TILE_BYTES;

    if (
      tileAddress + TILE_BYTES >
      tiles.length
    ) {
      return null;
    }

    const pixels =
      this.decode4bppTile(
        tiles,
        tileAddress,
      );

    return {
      tileId,
      width: TILE_WIDTH,
      height: TILE_HEIGHT,
      pixels,
    };
  }

  private getTilesData(
    tilesAddress: number,
    isCompressed: boolean,
  ): Uint8Array {
    const cacheKey =
      `${tilesAddress}:${isCompressed}`;

    const cached =
      this.decompressedTilesCache.get(
        cacheKey,
      );

    if (cached) {
      return cached;
    }

    if (!isCompressed) {
      const rawTiles =
        this.readRawTiles(
          tilesAddress,
        );

      this.decompressedTilesCache.set(
        cacheKey,
        rawTiles,
      );

      return rawTiles;
    }

    const decompressed =
      this.decompressLz77(
        tilesAddress,
      );

    this.decompressedTilesCache.set(
      cacheKey,
      decompressed,
    );

    console.log('LZ77 Tileset:', {
      address:
        `0x${tilesAddress.toString(16)}`,
      compressed: true,
      decompressedSize:
        decompressed.length,
    });

    return decompressed;
  }

  private readRawTiles(
    address: number,
  ): Uint8Array {
    const bytes =
      new Uint8Array(
        1024 * TILE_BYTES,
      );

    for (
      let i = 0;
      i < bytes.length;
      i++
    ) {
      bytes[i] =
        this.memoryReader.readU8(
          address + i,
        );
    }

    return bytes;
  }

  private decompressLz77(
    address: number,
  ): Uint8Array {
    const header =
      this.memoryReader.readU8(
        address,
      );

    if (header !== LZ77_HEADER) {
      throw new Error(
        `Invalid LZ77 header at 0x${address.toString(16)}.`,
      );
    }

    const decompressedSize =
      this.memoryReader.readU8(
        address + 1,
      ) |
      (this.memoryReader.readU8(
        address + 2,
      ) << 8) |
      (this.memoryReader.readU8(
        address + 3,
      ) << 16);

    if (
      decompressedSize <= 0 ||
      decompressedSize >
        0x1000000
    ) {
      throw new Error(
        `Invalid LZ77 decompressed size: ${decompressedSize}.`,
      );
    }

    const output =
      new Uint8Array(
        decompressedSize,
      );

    let sourceOffset = 4;
    let destinationOffset = 0;

    while (
      destinationOffset <
      decompressedSize
    ) {
      const flags =
        this.memoryReader.readU8(
          address + sourceOffset,
        );

      sourceOffset++;

      for (
        let bit = 7;
        bit >= 0 &&
        destinationOffset <
          decompressedSize;
        bit--
      ) {
        if (
          (flags &
            (1 << bit)) ===
          0
        ) {
          output[
            destinationOffset
          ] =
            this.memoryReader.readU8(
              address +
                sourceOffset,
            );

          sourceOffset++;
          destinationOffset++;

          continue;
        }

        const first =
          this.memoryReader.readU8(
            address +
              sourceOffset,
          );

        const second =
          this.memoryReader.readU8(
            address +
              sourceOffset +
              1,
          );

        sourceOffset += 2;

        const length =
          (first >> 4) + 3;

        const displacement =
          ((first & 0x0f) << 8) |
          second;

        const copyDistance =
          displacement + 1;

        if (
          copyDistance >
          destinationOffset
        ) {
          throw new Error(
            `Invalid LZ77 back-reference at 0x${(
              address +
              sourceOffset -
              2
            ).toString(16)}.`,
          );
        }

        for (
          let i = 0;
          i < length &&
          destinationOffset <
            decompressedSize;
          i++
        ) {
          const sourceIndex =
            destinationOffset -
            copyDistance;

          output[
            destinationOffset
          ] =
            output[
              sourceIndex
            ];

          destinationOffset++;
        }
      }
    }

    return output;
  }

  private decode4bppTile(
    tiles: Uint8Array,
    address: number,
  ): Uint8Array {
    const pixels =
      new Uint8Array(
        TILE_WIDTH *
        TILE_HEIGHT,
      );

    for (
      let y = 0;
      y < TILE_HEIGHT;
      y++
    ) {
      const rowAddress =
        address +
        y * 4;

      for (
        let byteIndex = 0;
        byteIndex < 4;
        byteIndex++
      ) {
        const value =
          tiles[
            rowAddress +
            byteIndex
          ];

        const x =
          byteIndex * 2;

        pixels[
          y * TILE_WIDTH +
          x
        ] =
          value & 0x0f;

        pixels[
          y * TILE_WIDTH +
          x + 1
        ] =
          (value >> 4) & 0x0f;
      }
    }

    return pixels;
  }
}