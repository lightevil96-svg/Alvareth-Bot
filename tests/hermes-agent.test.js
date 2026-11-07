import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmod, mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  applyHermesPatch,
  buildHermesEnvironment,
  createHermesId,
  getHermesPaths,
  hashHermesChat,
  parseHermesCommand,
  redactHermesOutput,
  runHermesQuery,
  splitHermesMessage,
  undoHermesPatch,
  validateHermesRepoPath,
  validateHermesUnifiedPatch
} from "../lib/hermes-agent.js";

const samplePatch = [
  "diff --git a/plugins/owner/example.js b/plugins/owner/example.js",
  "index 1111111..2222222 100644",
  "--- a/plugins/owner/example.js",
  "+++ b/plugins/owner/example.js",
  "@@ -1 +1 @@",
  "-const value = 1;",
  "+const value = 2;"
].join("\n") + "\n";

async function makeGitRepo(t) {
  const parent = await mkdtemp(path.join(tmpdir(), "alvareth-hermes-test-"));
  t.after(() => rm(parent, { recursive: true, force: true }));
  const repo = path.join(parent, "repo");
  await mkdir(path.join(repo, "plugins", "owner"), { recursive: true });
  await writeFile(path.join(repo, "plugins", "owner", "example.js"), "const value = 1;\n");
  execFileSync("git", ["init"], { cwd: repo, stdio: "ignore" });
  execFileSync("git", ["config", "user.email", "test@example.invalid"], { cwd: repo });
  execFileSync("git", ["config", "user.name", "Hermes Test"], { cwd: repo });
  execFileSync("git", ["add", "."], { cwd: repo });
  execFileSync("git", ["commit", "-m", "initial fixture"], { cwd: repo, stdio: "ignore" });
  return { parent, repo, file: path.join(repo, "plugins", "owner", "example.js") };
}

test("parses owner commands and creates opaque per-chat keys", () => {
  assert.deepEqual(parseHermesCommand(""), { action: "menu", argument: "" });
  assert.deepEqual(parseHermesCommand("patch plugins/owner/a.js rapikan kode"), {
    action: "patch",
    argument: "plugins/owner/a.js rapikan kode"
  });
  assert.deepEqual(parseHermesCommand("AUDIT keamanan"), {
    action: "audit",
    argument: "keamanan"
  });
  assert.match(createHermesId(), /^[a-f0-9]{8}$/);
  assert.match(hashHermesChat("owner-chat"), /^[a-f0-9]{24}$/);
  assert.notEqual(hashHermesChat("owner-chat"), "owner-chat");
});

test("Hermes subprocess environment does not inherit Alvareth credentials", () => {
  const env = buildHermesEnvironment("/tmp/hermes-workspace", {
    HOME: "/home/bot",
    PATH: "/home/bot/.local/bin:/usr/bin",
    HERMES_HOME: "/home/bot/.hermes",
    OPENAI_API_KEY: "secret-openai",
    ALVARETH_GITHUB_TOKEN: "secret-github",
    BOT_NUMBER: "6280000000000",
    OWNER_NUMBER: "6281111111111"
  });
  assert.equal(env.HOME, "/home/bot");
  assert.equal(env.HERMES_HOME, "/home/bot/.hermes");
  assert.equal(env.HERMES_WRITE_SAFE_ROOT, path.resolve("/tmp/hermes-workspace"));
  assert.equal(env.OPENAI_API_KEY, undefined);
  assert.equal(env.ALVARETH_GITHUB_TOKEN, undefined);
  assert.equal(env.BOT_NUMBER, undefined);
  assert.equal(env.OWNER_NUMBER, undefined);
});

test("Hermes state paths use the dedicated Alvareth data directory", () => {
  const paths = getHermesPaths({
    HOME: "/home/bot",
    ALVARETH_DATA_DIR: "/srv/alvareth-data"
  });
  assert.equal(paths.root, "/srv/alvareth-data/hermes");
  assert.match(paths.sessionsFile, /whatsapp-sessions\.json$/);
});

test("only approved repository paths can be targeted", () => {
  assert.equal(validateHermesRepoPath("plugins/owner/menu.js"), "plugins/owner/menu.js");
  assert.equal(validateHermesRepoPath("tests/hermes-agent.test.js"), "tests/hermes-agent.test.js");
  assert.throws(() => validateHermesRepoPath("../../.env"), /Path tidak valid/);
  assert.throws(() => validateHermesRepoPath(".env.example"), /terlindungi/);
  assert.throws(() => validateHermesRepoPath("node_modules/pkg/index.js"), /terlindungi/);
  assert.throws(() => validateHermesRepoPath("/etc/passwd"), /Path tidak valid/);
  assert.throws(() => validateHermesRepoPath("package.json"), /hanya boleh/);
});

test("patch validator accepts a small text diff and rejects secrets, traversal, and binary changes", () => {
  const valid = validateHermesUnifiedPatch(samplePatch);
  assert.deepEqual(valid.paths, ["plugins/owner/example.js"]);
  assert.equal(valid.patch, samplePatch);
  const secretPatch = samplePatch.replaceAll("plugins/owner/example.js", ".env");
  assert.throws(() => validateHermesUnifiedPatch(secretPatch), /terlindungi/);
  const traversalPatch = samplePatch.replaceAll("plugins/owner/example.js", "plugins/../.env");
  assert.throws(() => validateHermesUnifiedPatch(traversalPatch), /Path tidak valid/);
  assert.throws(() => validateHermesUnifiedPatch(samplePatch + "GIT binary patch\n"), /binary/);
});

test("applies an approved patch after backup and can safely undo it", async t => {
  const { parent, repo, file } = await makeGitRepo(t);
  const backupRoot = path.join(parent, "backups", "deadbeef");
  const result = await applyHermesPatch({
    repoRoot: repo,
    patch: samplePatch,
    id: "deadbeef",
    backupRoot
  });
  assert.deepEqual(result.paths, ["plugins/owner/example.js"]);
  assert.deepEqual(result.syntaxChecked, ["plugins/owner/example.js"]);
  assert.equal(await readFile(file, "utf8"), "const value = 2;\n");
  assert.equal(await readFile(path.join(backupRoot, "plugins", "owner", "example.js"), "utf8"), "const value = 1;\n");
  const undone = await undoHermesPatch({ repoRoot: repo, patch: samplePatch });
  assert.deepEqual(undone, ["plugins/owner/example.js"]);
  assert.equal(await readFile(file, "utf8"), "const value = 1;\n");
});

test("refuses to apply over an existing local edit", async t => {
  const { repo, file } = await makeGitRepo(t);
  await writeFile(file, "const value = 99;\n");
  await assert.rejects(
    applyHermesPatch({
      repoRoot: repo,
      patch: samplePatch,
      id: "badc0ffe",
      backupRoot: path.join(repo, "backup-fixture")
    }),
    /perubahan lokal/
  );
  assert.equal(await readFile(file, "utf8"), "const value = 99;\n");
});

test("Hermes one-shot bridge uses a restricted toolset, query-file, and stream-json session IDs", async t => {
  const parent = await mkdtemp(path.join(tmpdir(), "alvareth-hermes-cli-"));
  t.after(() => rm(parent, { recursive: true, force: true }));
  const workspace = path.join(parent, "workspace");
  const repo = path.join(parent, "repo");
  await mkdir(repo, { recursive: true });
  const fake = path.join(parent, "fake-hermes");
  const fakeScript = [
    "#!/usr/bin/env node",
    "const fs = require('node:fs');",
    "const args = process.argv.slice(2);",
    "const query = args.indexOf('--query-file');",
    "const prompt = query >= 0 ? fs.readFileSync(args[query + 1], 'utf8') : '';",
    "const system = {type:'system',subtype:'init',session_id:'session-test-123'};",
    "const result = {type:'result',session_id:'session-test-123',exit_code:0,text:'Mock response: '+prompt,args};",
    "process.stdout.write(JSON.stringify(system)+'\n'+JSON.stringify(result)+'\n');"
  ].join("\n");
  await writeFile(fake, fakeScript);
  await chmod(fake, 0o755);
  const result = await runHermesQuery({
    prompt: "Inspect the bot structure",
    repoRoot: repo,
    workspacePath: workspace,
    sessionId: "previous-session-123",
    binary: fake,
    env: {
      HOME: parent,
      PATH: process.env.PATH,
      HERMES_HOME: path.join(parent, "hermes-home"),
      OPENAI_API_KEY: "must-not-pass"
    }
  });
  assert.match(result.text, /Mock response: Inspect the bot structure/);
  assert.equal(result.sessionId, "session-test-123");
  assert.ok(result.usage.args.includes("--in"));
  assert.ok(result.usage.args.includes(repo));
  assert.ok(result.usage.args.includes("file,web,search,clarify"));
  assert.ok(result.usage.args.includes("--oneshot"));
  assert.ok(result.usage.args.includes("--query-file"));
  assert.ok(result.usage.args.includes("--format"));
  assert.ok(result.usage.args.includes("stream-json"));
  assert.ok(result.usage.args.includes("--resume"));
  assert.ok(result.usage.args.includes("previous-session-123"));
  assert.ok(result.usage.args.includes("--source"));
  assert.ok(result.usage.args.includes("tool"));
  assert.ok(result.usage.args.includes("--max-turns"));
  assert.ok(!result.usage.args.includes("terminal"));
  assert.ok(!result.usage.args.includes("Inspect the bot structure"));
  assert.deepEqual(await readdir(workspace), []);
});

test("rejects a Hermes response that is not a structured stream-json result", async t => {
  const parent = await mkdtemp(path.join(tmpdir(), "alvareth-hermes-invalid-"));
  t.after(() => rm(parent, { recursive: true, force: true }));
  const workspace = path.join(parent, "workspace");
  const repo = path.join(parent, "repo");
  await mkdir(repo, { recursive: true });
  const fake = path.join(parent, "fake-hermes");
  await writeFile(fake, "#!/usr/bin/env node\nprocess.stdout.write('plain text, not stream-json');\n");
  await chmod(fake, 0o755);
  await assert.rejects(
    runHermesQuery({ prompt: "test prompt", repoRoot: repo, workspacePath: workspace, binary: fake, env: { HOME: parent, PATH: process.env.PATH } }),
    /event akhir stream-json/
  );
});

test("rolls back a patch that introduces invalid JavaScript", async t => {
  const { parent, repo, file } = await makeGitRepo(t);
  const invalidPatch = samplePatch.replace("+const value = 2;", "+const value = ;");
  await assert.rejects(
    applyHermesPatch({
      repoRoot: repo,
      patch: invalidPatch,
      id: "badc0ffe",
      backupRoot: path.join(parent, "backups", "badc0ffe")
    }),
    /Pemeriksaan sintaks gagal/
  );
  assert.equal(await readFile(file, "utf8"), "const value = 1;\n");
});

test("output redaction and WhatsApp chunking keep responses safe and bounded", () => {
  const redacted = redactHermesOutput("OPENAI_API_KEY=sk-secret-value-long-enough-to-match");
  assert.match(redacted, /\[REDACTED\]/);
  assert.doesNotMatch(redacted, /sk-secret/);
  const chunks = splitHermesMessage("x".repeat(7200), 3500);
  assert.equal(chunks.length, 3);
  assert.ok(chunks.every(chunk => chunk.length <= 3500));
});
