#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const STARTUP_DIR = path.join(__dirname, '..', 'Startup');
const REGISTRY_FILE = path.join(STARTUP_DIR, 'registry.json');

function readProjectJsonFromZip(zipPath) {
  const buffer = fs.readFileSync(zipPath);
  let offset = 0;
  
  while (offset < buffer.length - 30) {
    const signature = buffer.readUInt32LE(offset);
    if (signature !== 0x04034b50) {
      // Not a local file header structure (probably hit the central directory), stop scanning
      break;
    }
    
    const compression = buffer.readUInt16LE(offset + 8);
    const compressedSize = buffer.readUInt32LE(offset + 18);
    const nameLen = buffer.readUInt16LE(offset + 26);
    const extraLen = buffer.readUInt16LE(offset + 28);
    
    const fileName = buffer.toString('utf8', offset + 30, offset + 30 + nameLen);
    const dataOffset = offset + 30 + nameLen + extraLen;
    
    if (fileName === 'project.json') {
      const compressedData = buffer.slice(dataOffset, dataOffset + compressedSize);
      let uncompressed;
      if (compression === 8) {
        uncompressed = zlib.inflateRawSync(compressedData);
      } else if (compression === 0) {
        uncompressed = compressedData;
      } else {
        throw new Error('Unsupported compression method: ' + compression);
      }
      return uncompressed.toString('utf8');
    }
    
    offset = dataOffset + compressedSize;
  }
  throw new Error('project.json not found in ZIP');
}

let files = [];
try {
  files = fs.readdirSync(STARTUP_DIR)
    .filter(name => name.endsWith('.flow'))
    .filter(name => {
      try { return fs.statSync(path.join(STARTUP_DIR, name)).isFile(); }
      catch { return false; }
    })
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
} catch (err) {
  console.error('[build-startup-registry] Cannot read Startup folder:', err.message);
  process.exit(1);
}

const registry = [];

for (const file of files) {
  const filePath = path.join(STARTUP_DIR, file);
  try {
    const jsonStr = readProjectJsonFromZip(filePath);
    const stateObj = JSON.parse(jsonStr);
    const projectName = stateObj.projectName || 'Unnamed Project';
    registry.push({
      fileName: file,
      projectName: projectName
    });
    console.log(`[build-startup-registry] Parsed ${file}: "${projectName}"`);
  } catch (err) {
    console.error(`[build-startup-registry] Failed to read ${file}:`, err.message);
  }
}

try {
  fs.writeFileSync(REGISTRY_FILE, JSON.stringify(registry, null, 2) + '\n');
  console.log(`[build-startup-registry] Wrote registry with ${registry.length} item(s) -> ${path.relative(process.cwd(), REGISTRY_FILE)}`);
} catch (err) {
  console.error('[build-startup-registry] Failed to write registry file:', err.message);
  process.exit(1);
}
