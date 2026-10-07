import fs from 'node:fs';

const BASE = 0x08000000;
const ROM = 'Pokemon - FireRed Version (USA, Europe) (Rev 1).gba';

function hex(n) { return '0x' + n.toString(16).padStart(8, '0'); }

function read(path) {
  return fs.readFileSync(path);
}

function firstDifference(a, b) {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    if (a[i] !== b[i]) return i;
  }
  return a.length === b.length ? -1 : n;
}

function findExact(data, needle) {
  const hits = [];
  if (!needle.length || needle.length > data.length) return hits;
  outer: for (let i = 0; i <= data.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (data[i + j] !== needle[j]) continue outer;
    }
    hits.push(i);
  }
  return hits;
}

function u16(data, offset) {
  return data[offset] | (data[offset + 1] << 8);
}

const rom = read(ROM);

const remoteFiles = [
  ['CinnabarIsland/map.bin', 'https://raw.githubusercontent.com/pret/pokefirered/master/data/layouts/CinnabarIsland/map.bin'],
  ['SixIsland_RuinValley/map.bin', 'https://raw.githubusercontent.com/pret/pokefirered/master/data/layouts/SixIsland_RuinValley/map.bin'],
  ['PalletTown/map.bin', 'https://raw.githubusercontent.com/pret/pokefirered/master/data/layouts/PalletTown/map.bin'],
  ['Route20/map.bin', 'https://raw.githubusercontent.com/pret/pokefirered/master/data/layouts/Route20/map.bin'],
];

const downloaded = {};
for (const [name, url] of remoteFiles) {
  const response = await fetch(url);
  if (!response.ok) throw new Error('Failed to fetch ' + url + ': ' + response.status);
  downloaded[name] = Buffer.from(await response.arrayBuffer());
}

const results = {};

for (const [name, source] of Object.entries(downloaded)) {
  const hits = findExact(rom, source);
  results[name] = {
    sourceBytes: source.length,
    romHits: hits.length,
    offsets: hits.slice(0, 20).map(x => hex(x)),
    gbaAddresses: hits.slice(0, 20).map(x => hex(BASE + x)),
  };
}

const betaOffset = 0x00338378;
const betaBytes = rom.subarray(betaOffset, betaOffset + downloaded['CinnabarIsland/map.bin'].length);

const cinnabarHits = findExact(rom, downloaded['CinnabarIsland/map.bin']);
const ruinHits = findExact(rom, downloaded['SixIsland_RuinValley/map.bin']);

const actualCinnabarOffset = cinnabarHits.find(x => x !== betaOffset) ?? cinnabarHits[0] ?? -1;
const actualRuinOffset = ruinHits.find(x => x !== betaOffset) ?? ruinHits[0] ?? -1;

const result = {
  romBytes: rom.length,
  gameCode: rom.toString('ascii', 0xac, 0xb0),
  revision: rom[0xbc],
  betaMapOffset: hex(betaOffset),
  betaMapAddress: hex(BASE + betaOffset),
  betaPrefixU16: Array.from({ length: 16 }, (_, i) => u16(rom, betaOffset + i * 2)),
  cinnabarSourceExactMatches: results['CinnabarIsland/map.bin'],
  ruinValleySourceExactMatches: results['SixIsland_RuinValley/map.bin'],
  palletSourceExactMatches: results['PalletTown/map.bin'],
  route20SourceExactMatches: results['Route20/map.bin'],
  betaMatchesCinnabarSource: firstDifference(betaBytes, downloaded['CinnabarIsland/map.bin']) === -1,
  betaMatchesRuinSource: firstDifference(betaBytes, downloaded['SixIsland_RuinValley/map.bin']) === -1,
  actualCinnabarOffset: actualCinnabarOffset < 0 ? null : hex(actualCinnabarOffset),
  actualCinnabarAddress: actualCinnabarOffset < 0 ? null : hex(BASE + actualCinnabarOffset),
  actualRuinOffset: actualRuinOffset < 0 ? null : hex(actualRuinOffset),
  actualRuinAddress: actualRuinOffset < 0 ? null : hex(BASE + actualRuinOffset),
};

console.log(JSON.stringify(result, null, 2));
