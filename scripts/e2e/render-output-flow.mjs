/**
 * The finished video, measured frame by frame: quality settings, the cut
 * between clips, trims, per-clip volume and length.
 *
 * Found on an iPhone: a "little cut" where Clip 1 meets Clip 2. Measured with
 * clips that carry their own frame number as a barcode and their own tone, the
 * render was opening each clip's recording window when `play()` resolved — but
 * the playhead then sat still for 180-380ms with no decoded picture. So every
 * clip that started at 0:00 (every camera clip) began with a black frame that
 * long and a gap in the sound, and the window, being a fixed length, shut that
 * long before the clip's out-point: Clip 1 lost its last 6-12 frames, then
 * black, then Clip 2.
 *
 * This renders real projects through the real `renderClips` (bundled here
 * straight from src/lib/video/render.ts, so no server is needed), then plays
 * the result back and reads every frame's barcode and every 10ms of sound:
 *
 *   - the recorder is asked for 10 Mb/s video and 128 kb/s audio, at 1080x1920;
 *   - no black frame anywhere;
 *   - each clip shows from its in-point to (within a few frames) its out-point,
 *     in order, for its kept length;
 *   - nothing freezes at a join, and the sound changes with the picture;
 *   - each clip's sound is at its own level, a muted one silent;
 *   - the picture runs to the end with the sound — the encoder used to be
 *     shut with the last ~0.35s still inside it, so videos ended frozen;
 *   - the video is as long as the project.
 *
 *   CHROMIUM_PATH=/opt/pw-browsers/chromium node scripts/e2e/render-output-flow.mjs
 *
 * Frame counts carry a tolerance of a few frames at a clip's end: the render
 * records in real time, and on a loaded machine a clip can play back slightly
 * slower than its window. The defect this guards against was 6-12 frames and a
 * black frame every time.
 *
 * Three limits are wider than a phone needs — a clip's length (±0.25s), sound
 * against picture at a join (±200ms) and a gap in the sound (120ms) — because
 * this container encodes 1080x1920 in software, in real time, while decoding
 * grainy 1080x1920, and on one run in three it falls behind: picture frames are
 * stamped late while the sound runs on its own thread, and the skew reached
 * 170ms. None of those three is what told the old render apart; the in- and
 * out-points, the black frames and the frozen ending are, and they stay tight.
 */
import { chromium } from 'playwright';
import { build } from 'esbuild';
import path from 'node:path';

const CHROMIUM = process.env.CHROMIUM_PATH;
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');

let failures = 0;
function check(label, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  — ${detail}` : ''}`);
  if (!ok) failures += 1;
}
const section = (name) => console.log(`\n######## ${name} ########`);

const TONES = { 1: 440, 2: 880, 3: 1320 };

/* ------------------------------------------------------------ in the page */

/**
 * Films a source clip: its number and frame number as a barcode, its own tone.
 *
 * Full 1080x1920 and full of grain, like a phone's camera, and that matters: a
 * flat picture decodes so quickly that the stall this test exists for never
 * happens, and the old render passed every timing check against one. Camera
 * footage is detail and noise in every pixel, slow to decode, and slow to start.
 */
async function makeSource(clipNo, seconds, tone) {
  const W = 1080;
  const H = 1920;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const g = canvas.getContext('2d');
  // Grain: fixed noise, shifted every frame so no frame can reuse the last.
  const grain = document.createElement('canvas');
  grain.width = W + 64;
  grain.height = H + 64;
  const noise = grain.getContext('2d').createImageData(grain.width, grain.height);
  for (let i = 0; i < noise.data.length; i += 4) {
    const v = 60 + Math.random() * 120;
    noise.data[i] = v * (clipNo === 1 ? 1.2 : 0.8);
    noise.data[i + 1] = v;
    noise.data[i + 2] = v * (clipNo === 3 ? 1.2 : 0.8);
    noise.data[i + 3] = 255;
  }
  grain.getContext('2d').putImageData(noise, 0, 0);
  const audio = new AudioContext();
  const osc = audio.createOscillator();
  osc.frequency.value = tone;
  const gain = audio.createGain();
  gain.gain.value = 0.5;
  const dest = audio.createMediaStreamDestination();
  osc.connect(gain).connect(dest);
  osc.start();
  const track = canvas.captureStream(0).getVideoTracks()[0];
  const stream = new MediaStream([track, ...dest.stream.getAudioTracks()]);
  const recorder = new MediaRecorder(stream, {
    mimeType: 'video/webm;codecs=vp8,opus',
    videoBitsPerSecond: 8_000_000,
  });
  const chunks = [];
  recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  const draw = (k) => {
    g.drawImage(grain, -((k * 7) % 64), -((k * 13) % 64));
    g.fillStyle = '#fff';
    g.fillRect((k * 18) % (W - 120), 1200, 120, 360);
    const code = (clipNo << 16) | k;
    for (let bit = 0; bit < 18; bit += 1) {
      g.fillStyle = (code >> (17 - bit)) & 1 ? '#ebebeb' : '#101010';
      g.fillRect(bit * 60 + 6, 30, 48, 150);
    }
  };
  draw(0);
  recorder.start(250);
  track.requestFrame();
  const t0 = performance.now();
  const total = Math.round(seconds * 30);
  await new Promise((resolve) => {
    let last = 0;
    const tick = () => {
      const k = Math.floor((performance.now() - t0) / (1000 / 30));
      if (k >= total) return resolve();
      if (k !== last) {
        last = k;
        draw(k);
        track.requestFrame();
      }
      setTimeout(tick, 4);
    };
    tick();
  });
  recorder.stop();
  await new Promise((r) => (recorder.onstop = r));
  osc.stop();
  await audio.close();
  return URL.createObjectURL(new Blob(chunks, { type: 'video/webm' }));
}

/** The barcode of the frame a source shows at `time`, after a seek. */
async function frameAt(src, time) {
  const v = document.createElement('video');
  v.muted = true;
  v.preload = 'auto';
  v.src = src;
  await new Promise((r) => v.addEventListener('loadedmetadata', r, { once: true }));
  v.currentTime = time;
  await new Promise((r) => v.addEventListener('seeked', r, { once: true }));
  const c = document.createElement('canvas');
  c.width = 1080;
  c.height = 200;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(v, 0, 0, 1080, 200, 0, 0, 1080, 200);
  const row = g.getImageData(0, 105, 1080, 1).data;
  let code = 0;
  for (let bit = 0; bit < 18; bit += 1) code = (code << 1) | (row[(bit * 60 + 30) * 4 + 1] > 125 ? 1 : 0);
  v.removeAttribute('src');
  v.load();
  return code & 0xffff;
}

/** A real duration out of a MediaRecorder file, which does not state one. */
async function probe(src) {
  const v = document.createElement('video');
  v.muted = true;
  v.src = src;
  await new Promise((r) => v.addEventListener('loadedmetadata', r, { once: true }));
  if (!Number.isFinite(v.duration)) {
    await new Promise((r) => {
      v.addEventListener('durationchange', function on() {
        if (Number.isFinite(v.duration)) {
          v.removeEventListener('durationchange', on);
          r();
        }
      });
      v.currentTime = 1e101;
    });
  }
  const out = { duration: v.duration, width: v.videoWidth, height: v.videoHeight };
  v.removeAttribute('src');
  v.load();
  return out;
}

/** Renders a project and reads the result back: every frame, every 10ms of sound. */
async function renderAndRead(project) {
  const clips = [];
  const expected = [];
  for (const [i, part] of project.entries()) {
    const src = window.__sources[part.n];
    const facts = await probe(src);
    // What the source itself shows at the in- and out-points: the frames this
    // clip must begin and end on.
    expected.push({
      first: await window.__frameAt(src, part.from),
      last: await window.__frameAt(src, part.to - 1 / 30),
    });
    clips.push({
      id: `c${i}`,
      src,
      label: `Recording ${i + 1}`,
      sourceDuration: facts.duration,
      sourceWidth: facts.width,
      sourceHeight: facts.height,
      trimStart: part.from,
      trimEnd: part.to,
      crop: { x: 0, y: 0, width: 1, height: 1 },
      rotation: 0,
      volume: part.volume,
      fromCamera: true,
    });
  }
  window.__recorderOptions = [];
  const rendered = await window.Render.renderClips(clips);
  const url = URL.createObjectURL(rendered.blob);
  const facts = await probe(url);

  // Every presented frame, at half speed so none is skipped by the reader.
  const v = document.createElement('video');
  v.muted = true;
  v.playsInline = true;
  v.style.cssText = 'position:fixed;left:0;top:0;width:108px;height:192px';
  document.body.append(v);
  v.src = url;
  await new Promise((r) => v.addEventListener('loadeddata', r, { once: true }));
  const c = document.createElement('canvas');
  c.width = 1080;
  c.height = 200;
  const g = c.getContext('2d', { willReadFrequently: true });
  const frames = [];
  const read = (mediaTime) => {
    g.drawImage(v, 0, 0, v.videoWidth, 200 * (v.videoHeight / 1920), 0, 0, 1080, 200);
    const row = g.getImageData(0, 105, 1080, 1).data;
    let code = 0;
    for (let bit = 0; bit < 18; bit += 1) {
      const x = bit * 60 + 30;
      code = (code << 1) | (row[x * 4 + 1] > 125 ? 1 : 0);
    }
    // Below the barcode: the clip's grain, never black.
    const centre = g.getImageData(540, 192, 1, 1).data;
    frames.push({
      t: mediaTime,
      clip: code >> 16,
      idx: code & 0xffff,
      dark: centre[0] + centre[1] + centre[2] < 30,
    });
  };
  await new Promise((resolve) => {
    const onFrame = (_now, meta) => {
      read(meta.mediaTime);
      if (!v.ended) v.requestVideoFrameCallback(onFrame);
    };
    v.requestVideoFrameCallback(onFrame);
    v.addEventListener('ended', () => setTimeout(resolve, 200), { once: true });
    v.playbackRate = 0.5;
    void v.play();
  });

  // The sound, as levels of each clip's tone every 10ms.
  const ctx = new AudioContext();
  const decoded = await ctx.decodeAudioData(await rendered.blob.arrayBuffer());
  const pcm = decoded.getChannelData(0);
  const rate = decoded.sampleRate;
  const win = Math.round(rate / 100);
  const windows = [];
  for (let start = 0; start + win <= pcm.length; start += win) {
    let sum = 0;
    for (let i = start; i < start + win; i += 1) sum += pcm[i] * pcm[i];
    const rms = Math.sqrt(sum / win);
    let tone = 0;
    if (rms > 0.01) {
      let best = 0;
      for (const [n, freq] of Object.entries({ 1: 440, 2: 880, 3: 1320 })) {
        // Goertzel at each clip's tone.
        const w = (2 * Math.PI * freq) / rate;
        const k = 2 * Math.cos(w);
        let s1 = 0;
        let s2 = 0;
        for (let i = start; i < start + win; i += 1) {
          const s0 = pcm[i] + k * s1 - s2;
          s2 = s1;
          s1 = s0;
        }
        const power = s1 * s1 + s2 * s2 - k * s1 * s2;
        if (power > best) {
          best = power;
          tone = Number(n);
        }
      }
    }
    windows.push({ t: start / rate, rms, tone });
  }
  const audioDuration = decoded.duration;
  await ctx.close();
  v.remove();
  return {
    audioDuration,
    width: facts.width,
    height: facts.height,
    duration: facts.duration,
    bytes: rendered.blob.size,
    mimeType: rendered.mimeType,
    options: window.__recorderOptions,
    expected,
    frames,
    windows,
  };
}

/* ------------------------------------------------------------ the checks */

function judge(name, project, out) {
  const total = project.reduce((sum, part) => sum + (part.to - part.from), 0);
  const options = out.options[0] ?? {};
  check(
    `${name}: the recorder is asked for 10 Mb/s video and 128 kb/s audio`,
    out.options.length === 1 &&
      options.videoBitsPerSecond === 10_000_000 &&
      options.audioBitsPerSecond === 128_000,
    JSON.stringify(out.options),
  );
  // The measured bitrate is reported, not judged: an encoder spends what the
  // picture needs up to its target, and these flat test frames need little.
  const kbps = Math.round((out.bytes * 8) / out.duration / 1000);
  check(
    `${name}: 1080x1920`,
    out.width === 1080 && out.height === 1920,
    `${out.width}x${out.height}, ${out.mimeType}, ${kbps} kb/s for this content`,
  );

  // Durations of each read frame: until the next one.
  const frames = out.frames.map((f, i, all) => ({
    ...f,
    shown: (all[i + 1]?.t ?? out.duration) - f.t,
  }));
  const black = frames.filter((f) => f.dark || !(f.clip in TONES));
  check(
    `${name}: no black frame anywhere`,
    black.length === 0,
    black.map((f) => `${f.t.toFixed(2)}s ${Math.round(f.shown * 1000)}ms`).join(', '),
  );

  const runs = [];
  for (const f of frames.filter((x) => x.clip in TONES)) {
    if (runs.length && runs[runs.length - 1].clip === f.clip) runs[runs.length - 1].frames.push(f);
    else runs.push({ clip: f.clip, frames: [f] });
  }
  const order = runs.map((r) => r.clip).join(' -> ');
  check(
    `${name}: the clips play in order, once each`,
    order === project.map((p) => p.n).join(' -> '),
    order,
  );
  if (runs.length !== project.length) return;

  for (const [i, part] of project.entries()) {
    const run = runs[i].frames;
    const firstExpected = out.expected[i].first;
    const lastExpected = out.expected[i].last;
    const first = run[0].idx;
    const last = Math.max(...run.map((f) => f.idx));
    const shown = run.reduce((sum, f) => sum + f.shown, 0);
    const kept = part.to - part.from;
    check(
      `${name}: Clip ${i + 1} starts at its in-point`,
      first >= firstExpected - 1 && first <= firstExpected + 3,
      `frame ${first}, in-point ${firstExpected}`,
    );
    check(
      `${name}: Clip ${i + 1} plays to its out-point`,
      last >= lastExpected - 5 && last <= lastExpected + 1,
      `last frame ${last}, out-point ${lastExpected}`,
    );
    check(
      `${name}: Clip ${i + 1} lasts its kept length`,
      Math.abs(shown - kept) <= 0.25,
      `${shown.toFixed(2)}s of ${kept.toFixed(2)}s`,
    );
  }

  for (let i = 1; i < runs.length; i += 1) {
    const before = runs[i - 1].frames.at(-1);
    const after = runs[i].frames[0];
    check(
      `${name}: no freeze at the join into Clip ${i + 1}`,
      before.shown <= 0.25 && after.shown <= 0.25,
      `last of Clip ${i} held ${Math.round(before.shown * 1000)}ms, first of Clip ${i + 1} ${Math.round(after.shown * 1000)}ms`,
    );
    // The sound changes with the picture: the first window of the next clip's
    // tone, or of its silence when it is muted.
    const next = project[i];
    const cut = after.t;
    const switched = out.windows.find(
      (w) => w.t > cut - 0.3 && (next.volume === 0 ? w.rms < 0.01 : w.tone === next.n),
    );
    const offset = switched ? Math.round((switched.t - cut) * 1000) : null;
    check(
      `${name}: the sound changes with the picture at the join into Clip ${i + 1}`,
      offset !== null && Math.abs(offset) <= 200,
      offset === null ? 'never changed' : `${offset}ms from the cut`,
    );
  }

  // Silence where there should be sound: the start, or a join.
  const audible = (t) => {
    let at = 0;
    for (const [i, part] of project.entries()) {
      at += part.to - part.from;
      if (t < at) return project[i].volume > 0;
    }
    return false;
  };
  let gap = 0;
  let worst = 0;
  let worstAt = 0;
  for (const w of out.windows) {
    if (w.t > total - 0.05) break;
    if (audible(w.t) && w.rms < 0.01) {
      gap += 10;
      if (gap > worst) {
        worst = gap;
        worstAt = w.t;
      }
    } else gap = 0;
  }
  check(
    `${name}: no gap in the sound where a clip should be heard`,
    worst < 120,
    worst ? `${worst}ms of silence at ${worstAt.toFixed(2)}s` : '',
  );

  const level = (n) => {
    const own = out.windows.filter((w) => w.tone === n).map((w) => w.rms).sort((a, b) => a - b);
    return own.length ? own[Math.floor(own.length / 2)] : 0;
  };
  const loud = project.find((p) => p.volume === 1);
  for (const part of project) {
    if (part === loud) continue;
    const ratio = level(part.n) / level(loud.n);
    check(
      `${name}: Clip ${project.indexOf(part) + 1} is at its own level (${part.volume})`,
      part.volume === 0 ? level(part.n) === 0 : Math.abs(ratio - part.volume) <= 0.1,
      part.volume === 0 ? `level ${level(part.n).toFixed(3)}` : `${ratio.toFixed(2)} of full`,
    );
  }

  // The picture must not stop before the sound. The encoder used to be shut
  // with its last frames still inside it, so the last ~0.35s was one frozen
  // picture over the sound playing on.
  const lastPicture = out.frames.at(-1).t + 1 / 30;
  check(
    `${name}: the picture runs to the end, with the sound`,
    out.audioDuration - lastPicture <= 0.12,
    `last frame at ${lastPicture.toFixed(2)}s, sound to ${out.audioDuration.toFixed(2)}s`,
  );

  check(
    `${name}: the video is as long as the project`,
    Math.abs(out.duration - total) <= total * 0.08,
    `${out.duration.toFixed(2)}s for ${total.toFixed(2)}s of kept clips`,
  );
}

async function run() {
  const bundled = await build({
    entryPoints: [path.join(ROOT, 'src/lib/video/render.ts')],
    bundle: true,
    format: 'iife',
    globalName: 'Render',
    target: 'es2020',
    write: false,
    absWorkingDir: ROOT,
    logLevel: 'error',
  });
  const script = bundled.outputFiles[0].text;

  const browser = await chromium.launch({
    ...(CHROMIUM ? { executablePath: CHROMIUM } : {}),
    args: ['--autoplay-policy=no-user-gesture-required'],
  });
  const page = await browser.newPage();
  await page.addInitScript(() => {
    // What the render asks the encoder for.
    const Original = window.MediaRecorder;
    window.__recorderOptions = [];
    window.MediaRecorder = class extends Original {
      constructor(stream, options) {
        super(stream, options);
        if (stream.getVideoTracks()[0]?.requestFrame && window.__recordingRender !== false) {
          window.__recorderOptions.push({ ...(options ?? {}) });
        }
      }
    };
  });
  await page.route('http://render.test/**', (route) =>
    route.request().url().endsWith('/render.js')
      ? route.fulfill({ contentType: 'text/javascript', body: script })
      : route.fulfill({ contentType: 'text/html', body: '<!doctype html><body></body>' }),
  );
  await page.goto('http://render.test/');
  await page.addScriptTag({ url: '/render.js' });
  await page.evaluate(`window.__makeSource = ${makeSource.toString()}`);
  await page.evaluate(`window.__probe = ${probe.toString()}`);
  await page.evaluate(`window.__frameAt = ${frameAt.toString()}`);
  await page.evaluate(`window.__renderAndRead = ${renderAndRead.toString().replace(/\bprobe\(/g, 'window.__probe(')}`);

  section('SOURCES — three filmed clips, numbered frames, their own tones');
  // Filming 1080x1920 grain in real time is hard work for a software encoder,
  // and a busy machine drops frames: a source whose barcode stalls at frame 6
  // makes every later check about the SOURCE, not the render. So each one is
  // checked — its frame number must keep up with its own clock — and filmed
  // again if it did not.
  const filmed = await page.evaluate(async (tones) => {
    window.__recordingRender = false;
    window.__sources = {};
    const report = {};
    for (const n of [1, 2, 3]) {
      for (let attempt = 1; attempt <= 3; attempt += 1) {
        const url = await window.__makeSource(n, 4, tones[n]);
        const drift = [];
        for (const t of [0.5, 1, 1.5, 2, 2.5, 3, 3.5]) {
          drift.push((await window.__frameAt(url, t)) - Math.round(t * 30));
        }
        const worst = Math.max(...drift.map(Math.abs));
        report[n] = { attempt, worst };
        if (worst <= 3 || attempt === 3) {
          window.__sources[n] = url;
          break;
        }
        URL.revokeObjectURL(url);
      }
    }
    window.__recordingRender = true;
    return report;
  }, TONES);
  check(
    'three 4s sources filmed, each keeping up with its own clock',
    Object.values(filmed).every((r) => r.worst <= 3),
    Object.entries(filmed)
      .map(([n, r]) => `#${n}: ${r.worst} frames off after ${r.attempt} attempt(s)`)
      .join(', '),
  );

  const projects = [
    ['TWO CLIPS', [
      { n: 1, from: 0, to: 3, volume: 1 },
      { n: 2, from: 0, to: 3, volume: 1 },
    ]],
    ['THREE CLIPS, TRIMMED, OWN LEVELS', [
      { n: 1, from: 0.5, to: 2.5, volume: 1 },
      { n: 2, from: 1, to: 3.2, volume: 0.5 },
      { n: 3, from: 0, to: 2, volume: 0 },
    ]],
  ];
  for (const [name, project] of projects) {
    section(name);
    const out = await page.evaluate((p) => window.__renderAndRead(p), project);
    judge(name.toLowerCase(), project, out);
  }

  await browser.close();
  console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
