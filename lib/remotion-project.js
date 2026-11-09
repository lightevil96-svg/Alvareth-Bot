import fs from 'node:fs/promises'
import path from 'node:path'

const SKIP_DIRECTORIES = new Set([
  '.cache', '.next', '.remotion', 'build', 'coverage', 'dist', 'node_modules',
  'out', '.git'
])
const SOURCE_EXTENSIONS = new Set(['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs'])
const REQUIRED_PACKAGES = ['remotion', '@remotion/cli', 'react', 'react-dom']

function isInside(parent, candidate) {
  const relative = path.relative(parent, candidate)
  return relative === '' ||
    (relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative))
}

function safeRelativePath(value, label = 'Path') {
  const raw = String(value ?? '').trim()
  const normalized = raw.replace(/^\.\//, '')
  if (!normalized || normalized.includes('\0') || normalized.includes('\\') ||
      path.posix.isAbsolute(normalized) || /^[a-zA-Z]:/.test(normalized)) {
    throw new Error(label + ' harus berupa path relatif yang aman.')
  }

  const segments = normalized.split('/')
  if (segments.some(segment => !segment || segment === '.' || segment === '..')) {
    throw new Error(label + ' tidak boleh keluar dari folder proyek.')
  }
  return segments.join(path.sep)
}

function isUnsafeDependencySpec(value) {
  const spec = String(value ?? '').trim()
  return !spec ||
    /^(?:git\+|git:|https?:|file:|link:|workspace:|github:|npm:)/i.test(spec) ||
    /(?:^|[\s])(?:git\+|https?:\/\/|file:)/i.test(spec)
}

function validatePackageDependencies(packageJson) {
  const dependencies = {
    ...(packageJson.dependencies && typeof packageJson.dependencies === 'object' ? packageJson.dependencies : {}),
    ...(packageJson.devDependencies && typeof packageJson.devDependencies === 'object' ? packageJson.devDependencies : {}),
    ...(packageJson.optionalDependencies && typeof packageJson.optionalDependencies === 'object' ? packageJson.optionalDependencies : {})
  }

  if (Object.keys(dependencies).length > 250) {
    throw new Error('package.json memiliki terlalu banyak dependency (maksimal 250).')
  }

  for (const [name, version] of Object.entries(dependencies)) {
    if (!/^(@[a-z0-9._-]+\/)?[a-z0-9._-]+$/i.test(name)) {
      throw new Error('Nama dependency tidak valid: ' + name)
    }
    if (isUnsafeDependencySpec(version)) {
      throw new Error('Dependency "' + name + '" memakai sumber non-registry yang ditolak. Gunakan versi dari npm registry.')
    }
  }

  const missing = REQUIRED_PACKAGES.filter(name => !dependencies[name])
  if (missing.length) {
    throw new Error('Dependency Remotion belum lengkap. package.json harus mencantumkan: ' + missing.join(', ') + '.')
  }

  if (packageJson.workspaces) {
    throw new Error('Paket Remotion monorepo/workspaces belum didukung. Kirim satu proyek Remotion mandiri.')
  }

  return dependencies
}

async function assertRegularFile(root, relativePath, label) {
  const safePath = safeRelativePath(relativePath, label)
  const absolutePath = path.resolve(root, safePath)
  if (!isInside(root, absolutePath)) {
    throw new Error(label + ' berada di luar folder proyek.')
  }

  let info
  try {
    info = await fs.lstat(absolutePath)
  } catch {
    throw new Error(label + ' tidak ditemukan: ' + safePath)
  }
  if (!info.isFile() || info.isSymbolicLink()) {
    throw new Error(label + ' harus berupa file biasa, bukan symbolic link.')
  }
  return { absolutePath, relativePath: safePath }
}

function extractCompositionIds(source) {
  const ids = new Set()
  const tagPattern = /<\s*Composition\b([^>]*)>/g
  for (const match of source.matchAll(tagPattern)) {
    const idMatch = match[1].match(/\bid\s*=\s*(["'])([^"']+)\1/)
    if (idMatch) ids.add(idMatch[2].trim())
  }
  return [...ids].filter(Boolean)
}

function validateCompositionId(value) {
  const id = String(value ?? '').trim()
  if (!/^[A-Za-z0-9_-]+$/.test(id)) {
    throw new Error('Composition ID tidak valid. Gunakan huruf, angka, tanda hubung, atau underscore.')
  }
  return id
}

export async function findRemotionProject(rootDirectory, options = {}) {
  if (!rootDirectory) throw new TypeError('Folder hasil ekstraksi ZIP wajib diberikan.')
  const root = path.resolve(String(rootDirectory))
  const rootInfo = await fs.lstat(root)
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) {
    throw new Error('Folder proyek Remotion harus berupa direktori biasa.')
  }

  const maxDepth = Number.isSafeInteger(options.maxDepth) && options.maxDepth >= 0 ? options.maxDepth : 8
  const maxFiles = Number.isSafeInteger(options.maxFiles) && options.maxFiles > 0 ? options.maxFiles : 500
  const packageCandidates = []
  const sourceFiles = []
  let scannedFiles = 0

  async function walk(directory, depth) {
    if (depth > maxDepth) return
    const entries = await fs.readdir(directory, { withFileTypes: true })

    for (const entry of entries) {
      const target = path.join(directory, entry.name)
      if (entry.isSymbolicLink()) {
        throw new Error('Proyek ZIP berisi symbolic link: ' + path.relative(root, target))
      }

      if (entry.isDirectory()) {
        const lowerName = entry.name.toLowerCase()
        if (lowerName === 'node_modules' || lowerName === '.git') {
          throw new Error('Jangan sertakan folder ' + entry.name + ' di ZIP. Bot akan memasang dependency sendiri.')
        }
        if (SKIP_DIRECTORIES.has(lowerName)) continue
        await walk(target, depth + 1)
        continue
      }

      if (!entry.isFile()) continue
      scannedFiles++
      if (scannedFiles > maxFiles) {
        throw new Error('Proyek ZIP memiliki terlalu banyak file untuk diperiksa (maksimal ' + maxFiles + ').')
      }

      const lowerName = entry.name.toLowerCase()
      if (lowerName === '.npmrc' || lowerName === 'npm-shrinkwrap.json' ||
          lowerName === '.env' || (/^\.env\./.test(lowerName) && lowerName !== '.env.example')) {
        throw new Error('ZIP berisi file konfigurasi privat yang tidak boleh diproses: ' + path.relative(root, target))
      }

      const extension = path.extname(entry.name).toLowerCase()
      if (SOURCE_EXTENSIONS.has(extension)) sourceFiles.push(target)

      if (lowerName !== 'package.json') continue
      const info = await fs.lstat(target)
      if (!info.isFile() || info.isSymbolicLink() || info.size > 256 * 1024) {
        throw new Error('package.json tidak aman atau terlalu besar.')
      }

      let packageJson
      try {
        packageJson = JSON.parse(await fs.readFile(target, 'utf8'))
      } catch (error) {
        throw new Error('package.json tidak valid: ' + String(error?.message || error).slice(0, 180))
      }

      const dependencies = {
        ...(packageJson.dependencies && typeof packageJson.dependencies === 'object' ? packageJson.dependencies : {}),
        ...(packageJson.devDependencies && typeof packageJson.devDependencies === 'object' ? packageJson.devDependencies : {}),
        ...(packageJson.optionalDependencies && typeof packageJson.optionalDependencies === 'object' ? packageJson.optionalDependencies : {})
      }
      if (dependencies.remotion || dependencies['@remotion/cli']) {
        packageCandidates.push({ packageJson, packageJsonPath: target })
      }
    }
  }

  await walk(root, 0)

  if (!packageCandidates.length) {
    throw new Error('ZIP tidak berisi package.json proyek Remotion. Pastikan dependency remotion dan @remotion/cli tersedia.')
  }
  if (packageCandidates.length > 1) {
    throw new Error('ZIP berisi lebih dari satu proyek Remotion. Kirim satu proyek mandiri agar entry point tidak ambigu.')
  }

  const candidate = packageCandidates[0]
  const packageRoot = path.dirname(candidate.packageJsonPath)
  const dependencies = validatePackageDependencies(candidate.packageJson)
  const config = candidate.packageJson.alvarethRemotion &&
    typeof candidate.packageJson.alvarethRemotion === 'object'
    ? candidate.packageJson.alvarethRemotion
    : {}

  const configuredEntryPoint = config.entryPoint
  let entryPoint
  if (configuredEntryPoint) {
    entryPoint = safeRelativePath(configuredEntryPoint, 'Entry point')
    await assertRegularFile(packageRoot, entryPoint, 'Entry point')
  } else {
    const defaults = [
      'src/index.ts', 'src/index.tsx', 'src/index.js', 'src/index.jsx',
      'index.ts', 'index.tsx', 'index.js', 'index.jsx'
    ]
    for (const value of defaults) {
      try {
        await assertRegularFile(packageRoot, value, 'Entry point')
        entryPoint = value
        break
      } catch {}
    }
    if (!entryPoint) {
      throw new Error('Entry point Remotion tidak ditemukan. Gunakan src/index.ts atau atur alvarethRemotion.entryPoint di package.json.')
    }
  }

  let compositionId
  if (config.compositionId) {
    compositionId = validateCompositionId(config.compositionId)
  } else {
    const ids = new Set()
    for (const filePath of sourceFiles) {
      if (!isInside(packageRoot, filePath)) continue
      const source = await fs.readFile(filePath, 'utf8')
      for (const id of extractCompositionIds(source)) ids.add(id)
    }

    if (ids.size === 0) {
      throw new Error('Composition ID tidak ditemukan. Tambahkan id statis pada <Composition> atau atur alvarethRemotion.compositionId di package.json.')
    }
    if (ids.size > 1) {
      throw new Error('Proyek memiliki beberapa Composition (' + [...ids].join(', ') + '). Tentukan satu melalui alvarethRemotion.compositionId di package.json.')
    }
    compositionId = validateCompositionId([...ids][0])
  }

  const packageJsonPath = path.join(packageRoot, 'package.json')
  return {
    projectRoot: packageRoot,
    packageJsonPath,
    packageName: String(candidate.packageJson.name || 'remotion-project').slice(0, 100),
    entryPoint,
    compositionId,
    dependencyCount: Object.keys(dependencies).length
  }
}

function shellQuote(value) {
  return "'" + String(value).replace(/'/g, "'\\''") + "'"
}

export function buildRemotionRenderScript({
  entryPoint,
  compositionId,
  outputPath = 'out/render-result.mp4',
  browserExecutable = '',
  concurrency = 2
} = {}) {
  const entry = safeRelativePath(entryPoint, 'Entry point')
  const output = safeRelativePath(outputPath, 'Output path')
  const id = validateCompositionId(compositionId)
  const threadCount = Number.isSafeInteger(Number(concurrency))
    ? Math.max(1, Math.min(8, Number(concurrency)))
    : 2

  let browserFlag = ''
  if (browserExecutable) {
    const browser = String(browserExecutable).trim()
    if (!path.isAbsolute(browser) || browser.includes('\0')) {
      throw new Error('Browser executable harus berupa path absolut yang valid.')
    }
    browserFlag = ' --browser-executable ' + shellQuote(browser)
  }

  return [
    'set -euo pipefail',
    'npm install --ignore-scripts --no-audit --no-fund --no-progress --package-lock=false --fetch-retries=1 --fetch-timeout=120000 --registry=https://registry.npmjs.org/',
    'mkdir -p ' + shellQuote(path.posix.dirname(output)),
    './node_modules/.bin/remotion render ' + shellQuote(entry) + ' ' + shellQuote(id) + ' ' + shellQuote(output) +
      ' --codec=h264 --log=error --concurrency=' + threadCount + browserFlag,
    ''
  ].join('\n')
}
