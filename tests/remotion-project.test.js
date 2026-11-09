import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
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
