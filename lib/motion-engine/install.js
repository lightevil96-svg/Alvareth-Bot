import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const MOTION_ENGINE_VERSION = '1.1.0';

const SOURCE_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const RUNTIME_FILES = Object.freeze([
  'style-dna.js',
  'character-engine.js',
  'world-engine.js',
  'motion-engine.js',
  'camera-engine.js',
  'visual-qa.js',
  'index.js'
]);

export async function installMotionEngine(projectRoot) {
  const root = path.resolve(String(projectRoot || ''));
  const rootInfo = await fs.lstat(root);
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) {
    throw new Error('Root proyek untuk memasang Alvareth Motion Engine tidak valid.');
  }

  const sourceDirectory = path.join(root, 'src');
  await fs.mkdir(sourceDirectory, { recursive: true, mode: 0o700 });
  const targetDirectory = path.join(sourceDirectory, 'alvareth-engine');

  try {
    const targetInfo = await fs.lstat(targetDirectory);
    if (!targetInfo.isDirectory() || targetInfo.isSymbolicLink()) {
      throw new Error('Path src/alvareth-engine sudah ada tetapi bukan direktori biasa.');
    }
    const existing = await fs.readdir(targetDirectory);
    if (existing.length) {
      throw new Error('ZIP tidak boleh menyertakan src/alvareth-engine; bot memasang engine resmi secara otomatis.');
    }
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }

  await fs.mkdir(targetDirectory, { recursive: true, mode: 0o700 });
  for (const fileName of RUNTIME_FILES) {
    const content = await fs.readFile(path.join(SOURCE_DIRECTORY, fileName), 'utf8');
    await fs.writeFile(path.join(targetDirectory, fileName), content, {
      encoding: 'utf8',
      mode: 0o600,
      flag: 'wx'
    });
  }

  return {
    version: MOTION_ENGINE_VERSION,
    directory: 'src/alvareth-engine',
    files: [...RUNTIME_FILES]
  };
}
