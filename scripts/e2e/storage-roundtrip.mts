/**
 * The production upload path, against a Supabase Storage stand-in.
 *
 * A deployment with Supabase does not send uploads through the app at all:
 * the server signs a URL, the browser PUTs the file straight to Storage, and
 * the server then reads it back to check it. None of that runs on the local
 * driver, so without this the one path production actually uses would be the
 * one path never exercised.
 *
 * The app's own module is used — the real @supabase/storage-js client, the
 * real signed URL, the real ranged reads and the real move.
 *
 *   STORAGE_PORT=54500 node scripts/e2e/storage-stub.mjs &
 *   npx tsx --conditions=react-server scripts/e2e/storage-roundtrip.mts
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

const PORT = process.env.STORAGE_PORT || '54500';
process.env.SUPABASE_URL = `http://127.0.0.1:${PORT}`;
process.env.SUPABASE_SERVICE_ROLE_KEY = 'stub-service-key';
delete process.env.NEXT_PUBLIC_SUPABASE_URL;

const FIXTURES = process.env.FIXTURES || '/tmp/fay-video-fixtures';

const {
  createPendingUpload,
  directUploadsAvailable,
  discardPending,
  inspectPending,
  ownsPendingPath,
  probePending,
  publishPending,
} = await import('../../src/lib/media/storage');
const { checkDuration, checkSize } = await import('../../src/lib/video/uploads');
const { isOwnMediaUrl } = await import('../../src/lib/media');

let failures = 0;
function check(label: string, ok: boolean, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  — ${detail}` : ''}`);
  if (!ok) failures += 1;
}
const section = (name: string) => console.log(`\n######## ${name} ########`);

const USER = '11111111-2222-3333-4444-555555555555';
const OTHER = '99999999-8888-7777-6666-555555555555';

/** What the browser does with the signed URL it is handed. */
async function put(uploadUrl: string, body: Buffer, contentType: string) {
  const response = await fetch(uploadUrl, {
    method: 'PUT',
    headers: { 'content-type': contentType, 'cache-control': 'max-age=31536000', 'x-upsert': 'true' },
    body: new Uint8Array(body),
  });
  return response.status;
}

section('SIGNING — where the browser is told to send the file');
check('direct uploads are available when Storage is configured', directUploadsAvailable());

const ticket = await createPendingUpload(USER, 'abc123.webm');
check('the signed path is namespaced to the uploader', ticket.path === `pending/${USER}/abc123.webm`, ticket.path);
check('an upload path belongs to the person it names', ownsPendingPath(ticket.path, USER));
check("and to nobody else", !ownsPendingPath(ticket.path, OTHER));
check('a path climbing out of the folder is not theirs', !ownsPendingPath(`pending/${USER}/../../media/x.mp4`, USER));
check('a published path cannot be committed as if pending', !ownsPendingPath('media/anyone/x.mp4', USER));

section('UPLOADING — a video that is within the limits');
const good = readFileSync(path.join(FIXTURES, 'landscape.webm'));
check('the browser can PUT to the signed URL', (await put(ticket.uploadUrl, good, 'video/webm')) === 200);

const landed = await inspectPending(ticket.path);
check('the server can see what landed', landed !== null && landed.size === good.length, `${landed?.size} bytes`);

const probe = probePending(landed!);
check('and can read its length out of it', probe.seconds !== null && probe.seconds > 2, `${probe.seconds?.toFixed(2)}s`);
check('and its picture size', probe.width === 640 && probe.height === 360, `${probe.width}x${probe.height}`);
check('the size check passes', checkSize('video/webm', landed!.size).ok);
check('the length check passes', checkDuration(probe).ok);

const publicUrl = await publishPending(ticket.path);
check('publishing moves it out of pending', publicUrl.includes('/media/') && !publicUrl.includes('/pending/'), publicUrl.split('/public/')[1]);
check('and the published URL is one a post may use', isOwnMediaUrl(publicUrl));
check('while the pending URL never was', !isOwnMediaUrl(publicUrl.replace('/media/', '/pending/')));

const gone = await inspectPending(ticket.path);
check('nothing is left behind under pending', gone === null);

const served = await fetch(publicUrl);
check('the published file is readable where the post points', served.status === 200, `${served.status}`);
check('and is the same file that was uploaded', Number(served.headers.get('content-length')) === good.length);

section('REFUSING — a video past two minutes');
const overTicket = await createPendingUpload(USER, 'toolong.webm');
const tooLong = readFileSync(path.join(FIXTURES, 'toolong.webm'));
await put(overTicket.uploadUrl, tooLong, 'video/webm');

const overLanded = await inspectPending(overTicket.path);
check('a 6MB upload is read from both ends, not just the head', overLanded !== null && overLanded.tail !== null, `${overLanded?.size} bytes`);

const overProbe = probePending(overLanded!);
check('its real length is found', overProbe.seconds !== null && overProbe.seconds > 180, `${overProbe.seconds?.toFixed(1)}s`);

const verdict = checkDuration(overProbe);
check('the length check refuses it', !verdict.ok, verdict.ok ? '' : verdict.error.slice(0, 70));

await discardPending(overTicket.path);
check('and the rejected upload is deleted rather than left lying around', (await inspectPending(overTicket.path)) === null);

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
