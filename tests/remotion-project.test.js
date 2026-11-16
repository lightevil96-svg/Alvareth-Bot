import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import {
  buildRemotionRenderScript,
  findRemotionProject
} from '../lib/remotion-project.js'

const packageJson = {
  name: 'fixture-remotion',
  dependencies: {
    '@remotion/cli': '4.0.534',
    'remotion': '4.0.534',
    'react': '19.0.0',
    'react-dom': '19.0.0'
  }
}

async function createFixture(t, files) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'alvareth-remotion-project-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  for (const [relative, content] of Object.entries(files)) {
    const target = path.join(root, relative)
    await fs.mkdir(path.dirname(target), { recursive: true })
    await fs.writeFile(target, content)
  }
  return root
}

test('findRemotionProject detects a wrapped project and its static Composition ID', async t => {
  const root = await createFixture(t, {
    'hujan-mendadak/package.json': JSON.stringify(packageJson),
    'hujan-mendadak/src/index.ts': "import {registerRoot} from 'remotion'; registerRoot(Root);",
    'hujan-mendadak/src/Root.tsx': '<Composition id="HujanMendadak" component={Video} />'
  })

  const result = await findRemotionProject(root)
  assert.equal(result.packageName, 'fixture-remotion')
  assert.equal(result.entryPoint, path.join('src', 'index.ts'))
  assert.equal(result.compositionId, 'HujanMendadak')
  assert.ok(result.packageJsonPath.endsWith(path.join('hujan-mendadak', 'package.json')))
})

test('findRemotionProject scans projects with more than 500 files without a count cap', async t => {
  const manyFiles = {
    'package.json': JSON.stringify({
      ...packageJson,
      alvarethRemotion: { entryPoint: 'src/index.ts', compositionId: 'Main' }
    }),
    'src/index.ts': 'registerRoot(Root);',
    'src/Root.tsx': '<Composition id="Main" />',
    ...Object.fromEntries(Array.from({ length: 505 }, (_, index) => [
      'project-data/file-' + index + '.txt',
      'metadata ' + index
    ]))
  }
  const root = await createFixture(t, manyFiles)
  const result = await findRemotionProject(root)
  assert.equal(result.compositionId, 'Main')
  assert.equal(result.packageName, 'fixture-remotion')
})

test('findRemotionProject scans nested project folders deeper than eight levels', async t => {
  const nestedRoot = Array.from({ length: 10 }, (_, index) => 'level-' + index).join('/')
  const root = await createFixture(t, {
    [nestedRoot + '/package.json']: JSON.stringify({
      ...packageJson,
      alvarethRemotion: { entryPoint: 'src/index.ts', compositionId: 'DeepScene' }
    }),
    [nestedRoot + '/src/index.ts']: 'registerRoot(Root);',
    [nestedRoot + '/src/Root.tsx']: '<Composition id="DeepScene" />'
  })
  const result = await findRemotionProject(root)
  assert.equal(result.compositionId, 'DeepScene')
  assert.ok(result.packageJsonPath.includes(path.join('level-0', 'level-1')))
})

test('findRemotionProject detects Three.js projects and defaults to the software WebGL renderer', async t => {
  const threePackage = {
    ...packageJson,
    dependencies: {
      ...packageJson.dependencies,
      '@remotion/three': '4.0.534',
      '@react-three/fiber': '8.17.10',
      'three': '0.170.0'
    },
    alvarethRemotion: {
      entryPoint: 'src/index.ts',
      compositionId: 'ThreeScene'
    }
  }
  const root = await createFixture(t, {
    'package.json': JSON.stringify(threePackage),
    'src/index.ts': "import {registerRoot} from 'remotion'; registerRoot(Root);",
    'src/Root.tsx': '<Composition id="ThreeScene" component={Scene} />'
  })

  const result = await findRemotionProject(root)
  assert.equal(result.usesWebGL, true)
  assert.equal(result.renderGL, 'swangle')
})

test('findRemotionProject accepts an explicit WebGL renderer from the safe allowlist', async t => {
  const configured = {
    ...packageJson,
    dependencies: {
      ...packageJson.dependencies,
      '@remotion/three': '4.0.534',
      '@react-three/fiber': '8.17.10',
      'three': '0.170.0'
    },
    alvarethRemotion: {
      entryPoint: 'src/index.ts',
      compositionId: 'ThreeScene',
      webglRenderer: 'angle-egl'
    }
  }
  const root = await createFixture(t, {
    'package.json': JSON.stringify(configured),
    'src/index.ts': 'registerRoot(Root);',
    'src/Root.tsx': '<Composition id="ThreeScene" component={Scene} />'
  })
  const result = await findRemotionProject(root)
  assert.equal(result.renderGL, 'angle-egl')
})

test('findRemotionProject rejects incomplete Three.js dependencies', async t => {
  const incomplete = {
    ...packageJson,
    dependencies: {
      ...packageJson.dependencies,
      '@remotion/three': '4.0.534'
    }
  }
  const root = await createFixture(t, {
    'package.json': JSON.stringify(incomplete),
    'src/index.ts': 'registerRoot(Root);',
    'src/Root.tsx': '<Composition id="ThreeScene" component={Scene} />'
  })
  await assert.rejects(findRemotionProject(root), /Proyek 3D belum lengkap/)
})

test('findRemotionProject accepts an explicit composition ID when the project has several', async t => {
  const configured = {
    ...packageJson,
    alvarethRemotion: {
      entryPoint: 'src/index.ts',
      compositionId: 'ShortVertical'
    }
  }
  const root = await createFixture(t, {
    'package.json': JSON.stringify(configured),
    'src/index.ts': 'registerRoot(Root);',
    'src/Root.tsx': '<Composition id="Landscape" /><Composition id="ShortVertical" />'
  })

  const result = await findRemotionProject(root)
  assert.equal(result.compositionId, 'ShortVertical')
})

test('findRemotionProject rejects ambiguous composition IDs without explicit configuration', async t => {
  const root = await createFixture(t, {
    'package.json': JSON.stringify(packageJson),
    'src/index.ts': 'registerRoot(Root);',
    'src/Root.tsx': '<Composition id="First" /><Composition id="Second" />'
  })

  await assert.rejects(findRemotionProject(root), /beberapa Composition/)
})

test('findRemotionProject rejects a package without the required Remotion CLI dependency', async t => {
  const incomplete = {
    ...packageJson,
    dependencies: { remotion: '4.0.534', react: '19.0.0', 'react-dom': '19.0.0' }
  }
  const root = await createFixture(t, {
    'package.json': JSON.stringify(incomplete),
    'src/index.ts': 'registerRoot(Root);',
    'src/Root.tsx': '<Composition id="Main" />'
  })

  await assert.rejects(findRemotionProject(root), /@remotion\/cli/)
})

test('findRemotionProject rejects direct dependencies from git, URL, or local sources', async t => {
  const unsafe = {
    ...packageJson,
    dependencies: { ...packageJson.dependencies, 'untrusted-package': 'git+https://example.com/repo.git' }
  }
  const root = await createFixture(t, {
    'package.json': JSON.stringify(unsafe),
    'src/index.ts': 'registerRoot(Root);',
    'src/Root.tsx': '<Composition id="Main" />'
  })

  await assert.rejects(findRemotionProject(root), /sumber non-registry/)
})

test('findRemotionProject rejects included node_modules and private npm configuration', async t => {
  const root = await createFixture(t, {
    'package.json': JSON.stringify(packageJson),
    'src/index.ts': 'registerRoot(Root);',
    'src/Root.tsx': '<Composition id="Main" />',
    'node_modules/should-not-exist/package.json': '{}'
  })

  await assert.rejects(findRemotionProject(root), /Jangan sertakan folder node_modules/)
})

test('findRemotionProject rejects an unsafe configured entry point', async t => {
  const configured = {
    ...packageJson,
    alvarethRemotion: { entryPoint: '../outside.ts', compositionId: 'Main' }
  }
  const root = await createFixture(t, {
    'package.json': JSON.stringify(configured),
    'src/index.ts': 'registerRoot(Root);'
  })

  await assert.rejects(findRemotionProject(root), /Entry point/)
})

test('buildRemotionRenderScript disables npm lifecycle scripts and renders the selected composition', () => {
  const script = buildRemotionRenderScript({
    entryPoint: 'src/entry point.ts',
    compositionId: 'HujanMendadak',
    browserExecutable: '/opt/chrome/chrome stable',
    concurrency: 3
  })

  assert.match(script, /npm install --ignore-scripts/)
  assert.match(script, /--registry=https:\/\/registry\.npmjs\.org\//)
  assert.match(script, /'src\/entry point\.ts'/)
  assert.match(script, /'HujanMendadak'/)
  assert.match(script, /'\/opt\/chrome\/chrome stable'/)
  assert.match(script, /--concurrency=3/)
})

test('buildRemotionRenderScript uses memory-safe browser settings and retries a closed Puppeteer target', () => {
  const script = buildRemotionRenderScript({
    entryPoint: 'src/index.ts',
    compositionId: 'ThreeScene',
    concurrency: 1,
    gl: 'swangle'
  })

  assert.match(script, /--concurrency=1/)
  assert.match(script, /--disable-shared-memory-capture/)
  assert.match(script, /--disallow-parallel-encoding/)
  assert.match(script, /--log=verbose/)
  assert.ok(script.includes('Target\\.closeTarget'))
  assert.match(script, /No target found for targetId/)
  assert.match(script, /--gl=swiftshader/)
  assert.ok(script.includes("rm -f 'out/render-result.mp4'"))

  const syntax = spawnSync('bash', ['-n'], { input: script, encoding: 'utf8' })
  assert.equal(syntax.status, 0, syntax.stderr || 'Generated render script must be valid Bash.')
})

test('buildRemotionRenderScript enables WebGL for a Three.js project', () => {
  const script = buildRemotionRenderScript({
    entryPoint: 'src/index.ts',
    compositionId: 'ThreeScene',
    gl: 'swangle'
  })
  assert.match(script, /--gl=swangle/)
  assert.throws(() => buildRemotionRenderScript({
    entryPoint: 'src/index.ts',
    compositionId: 'ThreeScene',
    gl: 'untrusted-renderer'
  }), /OpenGL renderer tidak didukung/)
})

test('buildRemotionRenderScript rejects path traversal and invalid composition IDs', () => {
  assert.throws(() => buildRemotionRenderScript({
    entryPoint: '../src/index.ts',
    compositionId: 'Main'
  }), /tidak boleh keluar dari folder proyek/)

  assert.throws(() => buildRemotionRenderScript({
    entryPoint: 'src/index.ts',
    compositionId: 'Main;rm -rf /'
  }), /Composition ID tidak valid/)
})
