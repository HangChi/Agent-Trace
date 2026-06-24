import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import sharp from "sharp";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const desktopRoot = resolve(scriptDir, "..");
const input = resolve(desktopRoot, "assets/icon.svg");
const output = resolve(desktopRoot, "assets/icon.ico");
const sizes = [16, 24, 32, 48, 64, 128, 256];

const svg = readFileSync(input);
const images = await Promise.all(
  sizes.map((size) =>
    sharp(svg, { density: 384 })
      .resize(size, size)
      .png()
      .toBuffer()
  )
);

const headerSize = 6;
const directoryEntrySize = 16;
const header = Buffer.alloc(headerSize);
const directory = Buffer.alloc(directoryEntrySize * images.length);
let offset = headerSize + directory.length;

header.writeUInt16LE(0, 0);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(images.length, 4);

for (let index = 0; index < images.length; index += 1) {
  const size = sizes[index];
  const image = images[index];
  const entryOffset = index * directoryEntrySize;

  directory.writeUInt8(size === 256 ? 0 : size, entryOffset);
  directory.writeUInt8(size === 256 ? 0 : size, entryOffset + 1);
  directory.writeUInt8(0, entryOffset + 2);
  directory.writeUInt8(0, entryOffset + 3);
  directory.writeUInt16LE(1, entryOffset + 4);
  directory.writeUInt16LE(32, entryOffset + 6);
  directory.writeUInt32LE(image.length, entryOffset + 8);
  directory.writeUInt32LE(offset, entryOffset + 12);
  offset += image.length;
}

mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, Buffer.concat([header, directory, ...images]));
