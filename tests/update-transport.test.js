import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, mkdtemp, rm, writeFile, mkdir, rename, unlink } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import path from 'node:path'

const source = await readFile(new URL('../plugins/owner/update.js', import.meta.url), 'utf8')

function extract(startMarker, endMarker) {
  const start = source.indexOf(startMarker)
  const end = source.indexOf(endMarker, start + startMarker.length)
  assert.ok(start >= 0 && end > start, 'Cannot extract updater function: ' + startMarker)
  return source.slice(start, end)
}

const parse = new Function('MAX_COMPARE_FILES',
  extract('function parseGitNameStatusZ(', 'async function compareCommitsViaGit(') +
  '\nreturn parseGitNameStatusZ')(20000)

test('Git --name-status -z handles modifications, additions, deletions and renames', () => {
  assert.deepEqual(parse('M\0src/a.js\0A\0src/new.js\0D\0removed.js\0R100\0old.js\0new.js\0'), [
    { status: 'modified', filename: 'src/a.js' },
    { status: 'added', filename: 'src/new.js' },
    { status: 'removed', filename: 'removed.js' },
    { status: 'renamed', previous_filename: 'old.js', filename: 'new.js' }
  ])
  assert.throws(() => parse('R100\0no-target.js\0'), /rename/)
  assert.throws(() => parse('Z\0unsafe.js\0'), /tidak dikenal/)
})


test('Git diff parser accepts more than 300 changed files and enforces only the higher safety ceiling', () => {
  const rows = Array.from({ length: 301 }, (_, index) => 'M\\0file-' + index + '.js\\0').join('')
  assert.equal(parse(rows).length, 301)
  const tooMany = Array.from({ length: 20001 }, (_, index) => 'M\\0file-' + index + '.js\\0').join('')
  assert.throws(() => parse(tooMany), /20\.000 file berubah/)
})

test('REST compare response at the 300-file cap switches to a complete Git diff', async () => {
  const files = Array.from({ length: 300 }, (_, index) => ({ status: 'modified', filename: 'rest-' + index + '.js' }))
  const complete = Array.from({ length: 347 }, (_, index) => ({ status: 'modified', filename: 'full-' + index + '.js' }))
  let fallbackCalls = 0
  const compareCode = extract('async function compareCommits(', 'async function downloadArchiveAtCommit(')
  const compare = new Function('deps', [
    'const { fetchJson, shouldUseGitFallback, compareCommitsViaGit, log, API_ROOT, REST_COMPARE_FILE_LIMIT, MAX_COMPARE_FILES } = deps',
    compareCode,
    'return compareCommits'
  ].join('\\n'))({
    fetchJson: async () => ({ status: 'ahead', ahead_by: 2, files }),
    shouldUseGitFallback: () => false,
    compareCommitsViaGit: async () => {
      fallbackCalls++
      return { status: 'ahead', ahead_by: 2, files: complete }
    },
    log: () => {},
    API_ROOT: 'https://api.github.com/repos/example/example',
    REST_COMPARE_FILE_LIMIT: 300,
    MAX_COMPARE_FILES: 20000
  })
  const result = await compare('a'.repeat(40), 'b'.repeat(40))
  assert.equal(fallbackCalls, 1)
  assert.equal(result.files.length, 347)
  assert.equal(result.files[0].filename, 'full-0.js')
})

test('HTTP 403 and 429 switch to Git fallback without rewriting local files', async () => {
  const code = extract('async function fetchLatestCommitSha(', 'async function readSavedState(')
  const sha = 'b'.repeat(40)
  const calls = []
  const build = status => new Function('deps', [
    "const { fetchJson, shouldUseGitFallback, fetchLatestCommitViaGit, isSha, log, API_ROOT, BRANCH } = deps",
    code,
    'return fetchLatestCommitSha'
  ].join('\n'))({
    fetchJson: async () => { const e = new Error('HTTP '+status); e.status=status; throw e },
    shouldUseGitFallback: e => [403,429].includes(e.status),
    fetchLatestCommitViaGit: async () => { calls.push(status); return sha },
    isSha: v => /^[a-f0-9]{40}$/.test(v),
    log: () => {},
    API_ROOT: 'https://api.github.com/repos/example/example',
    BRANCH: 'main'
  })
  assert.equal(await build(403)(), sha)
  assert.equal(await build(429)(), sha)
  assert.deepEqual(calls, [403,429])
})

test('isolated Git compare computes actual changed paths without using the existing checkout', async t => {
  try { execFileSync('git', ['--version'], { stdio: 'ignore' }) }
  catch { t.skip('git not installed'); return }
  const repo = await mkdtemp(path.join(tmpdir(), 'alvareth-git-test-'))
  const workspace = path.join(repo, 'upstream')
  const exec = (args, cwd = repo) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore','pipe','pipe'] })
  try {
    await mkdir(workspace)
    exec(['init', '-q', '-b', 'main'], workspace)
    exec(['config', 'user.email', 'test@example.invalid'], workspace)
    exec(['config', 'user.name', 'Updater Regression'], workspace)
    await writeFile(path.join(workspace, 'keep.js'), 'const v = 1\n')
    await writeFile(path.join(workspace, 'rename-me.txt'), 'identical content\n')
    await writeFile(path.join(workspace, 'delete-me.txt'), 'remove me\n')
    exec(['add', '.'], workspace)
    exec(['commit', '-qm', 'base'], workspace)
    const base = exec(['rev-parse', 'HEAD'], workspace).trim()
    await writeFile(path.join(workspace, 'keep.js'), 'const v = 2\n')
    await rename(path.join(workspace, 'rename-me.txt'), path.join(workspace, 'renamed.txt'))
    await unlink(path.join(workspace, 'delete-me.txt'))
    await writeFile(path.join(workspace, 'added.txt'), 'new file\n')
    exec(['add', '-A'], workspace)
    exec(['commit', '-qm', 'head'], workspace)
    const head = exec(['rev-parse', 'HEAD'], workspace).trim()

    const code = extract('async function compareCommitsViaGit(', 'async function fetchLatestCommitSha(')
    const { default: fs } = await import('node:fs/promises')
    const os = await import('node:os')
    const compare = new Function('deps', [
      'const { fs, path, os, runReadOnlyGit, GIT_REMOTE_URL, BRANCH, parseGitNameStatusZ } = deps',
      code,
      'return compareCommitsViaGit'
    ].join('\n'))({
      fs, path, os,
      runReadOnlyGit: async args => exec(args),
      GIT_REMOTE_URL: 'file://' + workspace,
      BRANCH: 'main',
      parseGitNameStatusZ: parse
    })
    const result = await compare(base, head)
    assert.equal(result.status, 'ahead')
    assert.equal(result.ahead_by, 1)
    assert.deepEqual(result.files.map(f => f.status+':'+f.filename).sort(),
      ['added:added.txt', 'modified:keep.js', 'removed:delete-me.txt', 'renamed:renamed.txt'])
    assert.deepEqual(result.files.find(f=>f.status==='renamed').previous_filename, 'rename-me.txt')
  } finally {
    await rm(repo, { recursive: true, force: true })
  }
})

test('public API authorization is optional and no token is hardcoded', () => {
  assert.match(source, /ALVARETH_GITHUB_TOKEN/)
  assert.match(source, /githubToken \? \{ Authorization: 'Bearer ' \+ githubToken \}/)
  assert.match(source, /response\.headers\.get\('x-ratelimit-remaining'\)/)
  assert.match(source, /if \(!shouldUseGitFallback\(error\)\) throw error/)
  assert.match(source, /const tempDir = await fs\.mkdtemp/)
  assert.match(source, /await fs\.rm\(tempDir, \{ recursive: true, force: true \}\)/)
})
