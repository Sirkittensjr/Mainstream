/**
 * Test videos, made the way a browser makes them.
 *
 * There is no ffmpeg in this container, and there does not need to be: the
 * feature under test records video with canvas + MediaRecorder, so the same
 * pair produces fixtures that are exactly the kind of file it will meet —
 * including the awkward one, a live recording whose container never states
 * its duration.
 *
 *   node scripts/e2e/make-video-fixtures.mjs [outputDir]
 *
 * The three-minute fixture is recorded in real time, so the whole run takes a
 * little over three minutes. It is cached: delete the directory to rebuild.
 */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const OUT = process.argv[2] || '/tmp/fay-video-fixtures';
const CHROMIUM = process.env.CHROMIUM_PATH;

/** name, width, height, seconds */
const FIXTURES = [
  ['landscape.webm', 640, 360, 4],
  ['portrait.webm', 360, 640, 3],
  ['square.webm', 480, 480, 3],
  ['tiny.webm', 320, 240, 2],
  // Longer than the three-minute limit, for the check that it is refused.
  ['toolong.webm', 320, 240, 188],
];

async function record(page, width, height, seconds) {
  return page.evaluate(
    async ([w, h, secs]) => {
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const context = canvas.getContext('2d');

      // A tone, so the fixtures have a real audio track to mix and mute.
      const audio = new AudioContext();
      const oscillator = audio.createOscillator();
      oscillator.frequency.value = 220 + w % 200;
      const destination = audio.createMediaStreamDestination();
      oscillator.connect(destination);
      oscillator.start();

      const stream = new MediaStream([
        ...canvas.captureStream(15).getVideoTracks(),
        ...destination.stream.getAudioTracks(),
      ]);
      const type = ['video/webm;codecs=vp8,opus', 'video/webm'].find((t) =>
        MediaRecorder.isTypeSupported(t),
      );
      const recorder = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: 400000 });
      const chunks = [];
      recorder.addEventListener('dataavailable', (e) => e.data.size > 0 && chunks.push(e.data));

      const started = performance.now();
      const draw = () => {
        const elapsed = (performance.now() - started) / 1000;
        // Something that visibly changes, so every frame is distinguishable
        // and a thumbnail taken at 0s differs from one taken later.
        context.fillStyle = `hsl(${(elapsed * 60) % 360} 70% 45%)`;
        context.fillRect(0, 0, w, h);
        context.fillStyle = '#fff';
        context.font = `${Math.round(h / 6)}px sans-serif`;
        context.fillText(elapsed.toFixed(1), 12, h / 2);
        if (elapsed < secs) requestAnimationFrame(draw);
      };

      recorder.start(1000);
      draw();
      await new Promise((resolve) => setTimeout(resolve, secs * 1000));
      await new Promise((resolve) => {
        recorder.addEventListener('stop', resolve, { once: true });
        recorder.stop();
      });
      oscillator.stop();
      await audio.close();

      const blob = new Blob(chunks, { type: recorder.mimeType });
      const buffer = new Uint8Array(await blob.arrayBuffer());
      return Array.from(buffer);
    },
    [width, height, seconds],
  );
}

const browser = await chromium.launch({
  ...(CHROMIUM ? { executablePath: CHROMIUM } : {}),
  args: ['--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage();
await page.goto('about:blank');
mkdirSync(OUT, { recursive: true });

for (const [name, width, height, seconds] of FIXTURES) {
  const file = path.join(OUT, name);
  if (existsSync(file)) {
    console.log(`have    ${name}`);
    continue;
  }
  process.stdout.write(`making  ${name} (${width}x${height}, ${seconds}s)… `);
  const data = await record(page, width, height, seconds);
  writeFileSync(file, Buffer.from(data));
  console.log(`${(data.length / 1024).toFixed(0)}KB`);
}

// Not a video at all, for the check that an invalid file is refused.
writeFileSync(
  path.join(OUT, 'notavideo.mp4'),
  Buffer.from('This is a text file wearing an .mp4 extension. It is not a video.\n'.repeat(40)),
);
console.log('made    notavideo.mp4');

await browser.close();
console.log(`\nFixtures in ${OUT}`);
