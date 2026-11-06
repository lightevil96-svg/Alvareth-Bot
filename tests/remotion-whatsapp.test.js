import test from "node:test";
import assert from "node:assert/strict";
import {
  parseRemotionCommand,
  remotionStageLabel,
  formatRemotionJob,
  getRemotionProviderReadiness
} from "../video-studio/whatsapp.js";

test("opens the menu when no Remotion action is supplied", () => {
  assert.deepEqual(parseRemotionCommand(""), { action: "menu" });
});

test("accepts generate aliases and keeps the full natural-language prompt", () => {
  assert.deepEqual(parseRemotionCommand("generate Buat video cinematic tentang laut"), {
    action: "generate",
    prompt: "Buat video cinematic tentang laut"
  });
  assert.deepEqual(parseRemotionCommand("buat seekor kucing menjelajahi kota"), {
    action: "generate",
    prompt: "seekor kucing menjelajahi kota"
  });
});

test("treats an unrecognized first word as the beginning of a prompt", () => {
  assert.deepEqual(parseRemotionCommand("Film pendek tentang seorang penjelajah"), {
    action: "generate",
    prompt: "Film pendek tentang seorang penjelajah"
  });
});

test("routes status, history, guide, services, cancel and resend actions", () => {
  assert.equal(parseRemotionCommand("status").action, "status");
  assert.equal(parseRemotionCommand("riwayat").action, "history");
  assert.equal(parseRemotionCommand("panduan").action, "guide");
  assert.equal(parseRemotionCommand("services").action, "services");
  assert.equal(parseRemotionCommand("services-menu").action, "servicesMenu");
  assert.equal(parseRemotionCommand("install-menu").action, "installMenu");
  assert.deepEqual(parseRemotionCommand("services start voice"), { action: "services", argument: "start voice" });
  assert.deepEqual(parseRemotionCommand("services start planner"), { action: "services", argument: "start planner" });
  assert.deepEqual(parseRemotionCommand("install"), { action: "install", argument: "" });
  assert.deepEqual(parseRemotionCommand("install cpu"), { action: "install", argument: "cpu" });
  assert.deepEqual(parseRemotionCommand("install status"), { action: "install", argument: "status" });
  assert.equal(parseRemotionCommand("batal").action, "cancel");
  assert.deepEqual(parseRemotionCommand("send job-123"), { action: "send", jobId: "job-123" });
});

test("maps pipeline stages to readable Indonesian labels", () => {
  assert.equal(remotionStageLabel("generating-ai-video"), "Membuat footage AI");
  assert.equal(remotionStageLabel("rendering"), "Merender komposisi MP4");
});

test("formats job details without exposing file paths", () => {
  const formatted = formatRemotionJob({
    id: "job-123",
    title: "Video Demo",
    status: "rendering",
    stage: "rendering",
    progress: 40,
    durationSeconds: 30,
    ratio: "9:16",
    sceneCount: 6,
    outputPath: "/private/server/path/video.mp4"
  });
  assert.match(formatted, /Video Demo/);
  assert.match(formatted, /40%/);
  assert.doesNotMatch(formatted, /private\/server\/path/);
});

test("reports optional media providers as unconfigured without secrets", () => {
  const status = getRemotionProviderReadiness({}, () => false, {
    remotionInstalled: true,
    ffmpegInstalled: true
  });
  assert.equal(status.find(item => item.name === "Remotion + FFmpeg").configured, true);
  assert.equal(status.find(item => item.name === "AI prompt planner").configured, true);
  assert.match(status.find(item => item.name === "AI prompt planner").detail, /qwen2.5:7b/);
  assert.equal(status.find(item => item.name === "Voice-over + subtitle sinkron").configured, true);
  assert.match(status.find(item => item.name === "Voice-over + subtitle sinkron").detail, /127.0.0.1:7861/);
  assert.equal(status.find(item => item.name === "AI video footage").configured, false);
  assert.equal(status.find(item => item.name === "Character reference image").configured, false);
});

test("does not mark ComfyUI workflows ready until their exact bytes pass review", () => {
  const status = getRemotionProviderReadiness({
    VIDEO_STUDIO_COMFYUI_VIDEO_WORKFLOW_FILE: "/srv/workflows/video.json",
    VIDEO_STUDIO_COMFYUI_IMAGE_WORKFLOW_FILE: "/srv/workflows/image.json",
    VIDEO_STUDIO_COMFYUI_MUSIC_WORKFLOW_FILE: "/srv/workflows/music.json"
  }, () => true, {
    remotionInstalled: true,
    ffmpegInstalled: true,
    workflowCheck: () => ({ configured: false, detail: "SHA-256 belum disetujui." })
  });
  for (const name of ["AI video footage", "Character reference image", "AI background music"]) {
    assert.equal(status.find(item => item.name === name).configured, false);
    assert.match(status.find(item => item.name === name).detail, /SHA-256 belum disetujui/);
  }
});

test("character reference requires a video workflow and a compatible reference placeholder", () => {
  const missingVideo = getRemotionProviderReadiness({
    VIDEO_STUDIO_COMFYUI_IMAGE_WORKFLOW_FILE: "/srv/workflows/image.json"
  }, () => true, {});
  assert.equal(missingVideo.find(item => item.name === "Character reference image").configured, false);
  assert.match(missingVideo.find(item => item.name === "Character reference image").detail, /workflow video/i);

  const incompatible = getRemotionProviderReadiness({
    VIDEO_STUDIO_COMFYUI_VIDEO_WORKFLOW_FILE: "/srv/workflows/video.json",
    VIDEO_STUDIO_COMFYUI_IMAGE_WORKFLOW_FILE: "/srv/workflows/image.json"
  }, () => true, {
    workflowCheck: () => ({ configured: true, detail: "SHA-256 disetujui." }),
    referenceWorkflowCheck: () => ({ configured: false, detail: "Workflow video belum memakai placeholder {{REFERENCE_IMAGE}}." })
  });
  assert.equal(incompatible.find(item => item.name === "Character reference image").configured, false);
  assert.match(incompatible.find(item => item.name === "Character reference image").detail, /placeholder/);
});

test("recognizes configured voice and ComfyUI workflow files", () => {
  const status = getRemotionProviderReadiness({
    VIDEO_STUDIO_VOXCPM_URL: "http://127.0.0.1:7861",
    VIDEO_STUDIO_COMFYUI_VIDEO_WORKFLOW_FILE: "/srv/workflows/video.json",
    VIDEO_STUDIO_COMFYUI_IMAGE_WORKFLOW_FILE: "/srv/workflows/image.json",
    VIDEO_STUDIO_COMFYUI_MUSIC_WORKFLOW_FILE: "/srv/workflows/music.json"
  }, path => ["/srv/workflows/video.json", "/srv/workflows/image.json", "/srv/workflows/music.json"].includes(path), {
    remotionInstalled: true,
    ffmpegInstalled: true
  });
  assert.equal(status.find(item => item.name === "Voice-over + subtitle sinkron").configured, true);
  assert.equal(status.find(item => item.name === "AI video footage").configured, true);
  assert.equal(status.find(item => item.name === "Character reference image").configured, true);
  assert.equal(status.find(item => item.name === "AI background music").configured, true);
});

// Actual plugin invocation with a fake transport: not a live WhatsApp test.
test("plugin rejects every non-owner action and binds prompt sessions to their initiator", async t => {
  const { mkdtemp, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const dir = await mkdtemp(tmpdir() + '/remotion-wa-');
  const old = process.env.ALVARETH_DATA_DIR;
  process.env.ALVARETH_DATA_DIR = dir;
  t.after(async () => { await rm(dir, {recursive:true,force:true}); old === undefined ? delete process.env.ALVARETH_DATA_DIR : process.env.ALVARETH_DATA_DIR = old; });
  const {default: handler} = await import('../plugins/owner/remotion.js');
  const replies=[], sent=[];
  const m={chat:'test-chat',sender:'owner-a',reply:async text=>replies.push(text)};
  const conn={sendMessage:async (...args)=>sent.push(args)};
  for (const text of ['', 'generate', 'status', 'history', 'send id', 'services', 'services start voice', 'install', 'install status', 'guide', 'cancel', 'buatkan video kopi']) {
    await handler(m,{conn,text,isROwner:false});
    assert.match(replies.at(-1),/hanya untuk owner/);
  }
  assert.equal(sent.length,0);
  await handler(m,{conn,text:'',isROwner:true,usedPrefix:'!'});
  const mainSections = sent[0][1].nativeFlow[0].sections;
  assert.deepEqual(mainSections.map(section => section.rows.length), [6, 2]);
  const mainIds = mainSections.flatMap(section => section.rows.map(row => row.id));
  assert.deepEqual(mainIds, [
    "!remotion generate",
    "!remotion status",
    "!remotion history",
    "!remotion send",
    "!remotion guide",
    "!remotion cancel",
    "!remotion services-menu",
    "!remotion install-menu"
  ]);
  await handler(m,{conn,text:"services-menu",isROwner:true,usedPrefix:"!"});
  const serviceIds = sent.at(-1)[1].nativeFlow[0].sections.flatMap(section=>section.rows.map(row=>row.id));
  assert.deepEqual(serviceIds, [
    "!remotion services",
    "!remotion services start voice",
    "!remotion services start planner",
    "!remotion"
  ]);
  await handler(m,{conn,text:"install-menu",isROwner:true,usedPrefix:"!"});
  const installIds = sent.at(-1)[1].nativeFlow[0].sections.flatMap(section=>section.rows.map(row=>row.id));
  assert.deepEqual(installIds, [
    "!remotion install",
    "!remotion install cpu",
    "!remotion install status",
    "!remotion"
  ]);
  await handler(m,{conn,text:'generate',isROwner:true});
  assert.equal(global.__alvarethRemotionSessions.get(m.chat).sender,'owner-a');
  assert.equal(await global.__alvarethRemotionPromptHandler({...m,sender:'intruder',text:'Buatkan video kopi'},{conn,isROwner:false}),false);
  assert.equal(await global.__alvarethRemotionPromptHandler({...m,sender:'owner-b',text:'Buatkan video kopi'},{conn,isROwner:true}),false);
  await handler({...m,sender:'owner-b'},{conn,text:'cancel',isROwner:true});
  assert.equal(global.__alvarethRemotionSessions.has(m.chat),true);
  await handler(m,{conn,text:'cancel',isROwner:true});
  assert.equal(global.__alvarethRemotionSessions.has(m.chat),false);
  for (const text of ['status','history','send','guide','install status']) await handler(m,{conn,text,isROwner:true});
  assert.ok(replies.some(text=>/Belum ada proses instalasi/.test(text)));
  assert.ok(replies.some(text=>/Riwayat video masih kosong/.test(text)));
});