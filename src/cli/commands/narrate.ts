// SLOPE — slope narrate: ElevenLabs TTS voiceover pipeline for demo video
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { NARRATOR_CUE_PAUSES, NARRATOR_SEGMENTS } from './demo.js';

// --- ElevenLabs response types ---

interface ElevenLabsVoice {
  voice_id: string;
  name: string;
  category: string;
}

interface ElevenLabsError {
  detail?: { message?: string } | string;
}

// --- Arg parsing ---

interface NarrateArgs {
  subcommand: string;
  apiKey: string;
  voice: string;
  force: boolean;
  clean: boolean;
  output: string;
  clips: string;
  video: string;
  audio: string;
  help: boolean;
}

function parseNarrateArgs(args: string[]): NarrateArgs {
  const result: NarrateArgs = {
    subcommand: '',
    apiKey: '',
    voice: '',
    force: false,
    clean: false,
    output: '',
    clips: '',
    video: '',
    audio: '',
    help: false,
  };

  for (const arg of args) {
    if (arg === '--help' || arg === '-h') result.help = true;
    else if (arg === '--force') result.force = true;
    else if (arg === '--clean') result.clean = true;
    else if (arg.startsWith('--api-key=')) result.apiKey = arg.slice('--api-key='.length);
    else if (arg.startsWith('--voice=')) result.voice = arg.slice('--voice='.length);
    else if (arg.startsWith('--output=')) result.output = arg.slice('--output='.length);
    else if (arg.startsWith('--clips=')) result.clips = arg.slice('--clips='.length);
    else if (arg.startsWith('--video=')) result.video = arg.slice('--video='.length);
    else if (arg.startsWith('--audio=')) result.audio = arg.slice('--audio='.length);
    else if (!result.subcommand) result.subcommand = arg;
  }

  return result;
}

// --- Helpers ---

export function resolveApiKey(flagValue: string): string {
  if (flagValue) return flagValue;
  const env = process.env.ELEVEN_API_KEY;
  if (env) return env;
  throw new Error(
    'ElevenLabs API key required.\n' +
    '  Pass --api-key=<key> or set ELEVEN_API_KEY env var.\n' +
    '  Get a key at https://elevenlabs.io',
  );
}

export function requireFfmpeg(): void {
  try {
    execSync('ffmpeg -version', { stdio: 'ignore' });
  } catch {
    throw new Error('ffmpeg not found. Install: brew install ffmpeg');
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

// Ordered CUE IDs matching NARRATOR_CUE_PAUSES insertion order
const CUE_ORDER = Object.keys(NARRATOR_CUE_PAUSES);

function clipFilename(cue: string): string {
  const seg = NARRATOR_SEGMENTS[cue];
  return `${cue}-${seg.label}.mp3`;
}

// --- Error handling helpers ---

function formatElevenLabsError(body: ElevenLabsError): string {
  if (!body.detail) return 'Unknown error';
  if (typeof body.detail === 'string') return body.detail;
  return body.detail.message ?? 'Unknown error';
}

async function fetchWithRetry(
  url: string,
  init: RequestInit,
  retries: number,
): Promise<Response> {
  let lastError: Error | null = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const res = await fetch(url, init);

    // Non-retryable errors
    if (res.status === 401 || res.status === 403) {
      throw new Error('Invalid API key. Get one at https://elevenlabs.io');
    }
    if (res.status === 422) {
      let detail = '';
      try {
        const body = await res.json() as ElevenLabsError;
        detail = formatElevenLabsError(body);
      } catch { /* ignore parse errors */ }
      throw new Error(`Voice or text rejected: ${detail}`);
    }

    // Retryable errors
    if (res.status === 429 || res.status >= 500) {
      if (attempt < retries) {
        const retryAfter = res.headers.get('retry-after');
        const delaySec = retryAfter ? parseInt(retryAfter, 10) : (2 ** (attempt + 1));
        const delayMs = (isNaN(delaySec) ? (2 ** (attempt + 1)) : delaySec) * 1000;
        await sleep(delayMs);
        lastError = new Error(`HTTP ${res.status}`);
        continue;
      }
      lastError = new Error(`HTTP ${res.status} after ${retries + 1} attempts`);
      throw lastError;
    }

    // Success
    if (res.ok) return res;

    // Other unexpected status
    throw new Error(`Unexpected HTTP ${res.status}`);
  }
  throw lastError ?? new Error('Fetch failed');
}

// --- Subcommands ---

async function voicesSubcommand(apiKey: string): Promise<void> {
  const res = await fetchWithRetry(
    'https://api.elevenlabs.io/v1/voices',
    { headers: { 'xi-api-key': apiKey } },
    2,
  );

  const data = await res.json() as { voices: ElevenLabsVoice[] };
  const voices = data.voices;

  // Table display
  const idW = Math.max(10, ...voices.map(v => v.voice_id.length));
  const nameW = Math.max(4, ...voices.map(v => v.name.length));

  console.log(`${'Voice ID'.padEnd(idW)}  ${'Name'.padEnd(nameW)}  Category`);
  console.log(`${'─'.repeat(idW)}  ${'─'.repeat(nameW)}  ${'─'.repeat(10)}`);
  for (const v of voices) {
    console.log(`${v.voice_id.padEnd(idW)}  ${v.name.padEnd(nameW)}  ${v.category}`);
  }
  console.log(`\n${voices.length} voices available.`);
}

async function generateSubcommand(apiKey: string, voiceId: string, force: boolean, clean: boolean, clipsDir: string): Promise<void> {
  if (!voiceId) {
    throw new Error('--voice=<id> is required. Run "slope narrate voices" to list available voices.');
  }

  const dir = resolve(clipsDir);
  mkdirSync(dir, { recursive: true });

  // Early validation: verify API key + voice ID
  console.log('Validating API key and voice...');
  const voicesRes = await fetchWithRetry(
    'https://api.elevenlabs.io/v1/voices',
    { headers: { 'xi-api-key': apiKey } },
    2,
  );
  const voicesData = await voicesRes.json() as { voices: ElevenLabsVoice[] };
  const voiceExists = voicesData.voices.some(v => v.voice_id === voiceId);
  if (!voiceExists) {
    throw new Error(
      `Voice "${voiceId}" not found. Run "slope narrate voices" to see available voices.`,
    );
  }

  // Clean existing clips if requested
  if (clean) {
    const existing = readdirSync(dir).filter(f => f.endsWith('.mp3'));
    for (const f of existing) rmSync(join(dir, f));
    if (existing.length > 0) console.log(`Cleaned ${existing.length} existing clips.`);
  }

  let succeeded = 0;
  for (let i = 0; i < CUE_ORDER.length; i++) {
    const cue = CUE_ORDER[i];
    const seg = NARRATOR_SEGMENTS[cue];
    const filename = clipFilename(cue);
    const filepath = join(dir, filename);

    // Skip existing unless --force
    if (!force && existsSync(filepath) && statSync(filepath).size > 0) {
      console.log(`[${i + 1}/${CUE_ORDER.length}] ${filename} (exists, skipping)`);
      succeeded++;
      continue;
    }

    console.log(`[${i + 1}/${CUE_ORDER.length}] ${filename}`);

    let res: Response;
    try {
      res = await fetchWithRetry(
        `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
        {
          method: 'POST',
          headers: {
            'xi-api-key': apiKey,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            text: seg.text,
            model_id: 'eleven_multilingual_v2',
            voice_settings: { stability: 0.5, similarity_boost: 0.75, style: 0 },
          }),
        },
        3,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`\nFailed at CUE ${cue}: ${msg}`);
      console.error(`${succeeded}/${CUE_ORDER.length} clips generated before failure.`);
      throw new Error(`CUE ${cue}: ${msg}`);
    }

    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length === 0) {
      console.error(`\nCUE ${cue}: empty response from ElevenLabs.`);
      console.error(`${succeeded}/${CUE_ORDER.length} clips generated before failure.`);
      throw new Error(`CUE ${cue}: empty response`);
    }

    writeFileSync(filepath, buf);
    succeeded++;
  }

  console.log(`\nGenerated ${succeeded}/${CUE_ORDER.length} clips to ${dir}`);
}

async function combineSubcommand(clipsDir: string, outputPath: string): Promise<void> {
  requireFfmpeg();

  const dir = resolve(clipsDir);
  const output = resolve(outputPath);

  // Pre-flight: verify all 19 clips exist and are non-empty
  const missing: string[] = [];
  for (const cue of CUE_ORDER) {
    const filepath = join(dir, clipFilename(cue));
    if (!existsSync(filepath) || statSync(filepath).size === 0) {
      missing.push(clipFilename(cue));
    }
  }
  if (missing.length > 0) {
    throw new Error(
      `Expected ${CUE_ORDER.length} clips, found ${CUE_ORDER.length - missing.length}. ` +
      `Run 'slope narrate generate' first.\nMissing: ${missing.join(', ')}`,
    );
  }

  const paddedFiles: string[] = [];

  try {
    // Process each clip: probe duration, pad to window
    for (let i = 0; i < CUE_ORDER.length; i++) {
      const cue = CUE_ORDER[i];
      const clipPath = join(dir, clipFilename(cue));
      const paddedPath = join(dir, `_padded-${cue}.mp3`);
      const windowSec = NARRATOR_CUE_PAUSES[cue] / 1000;

      // Get clip duration via ffprobe
      let durationSec: number;
      try {
        const raw = execSync(
          `ffprobe -v quiet -show_entries format=duration -of csv=p=0 "${clipPath}"`,
          { encoding: 'utf8' },
        ).trim();
        durationSec = parseFloat(raw);
      } catch (err) {
        throw new Error(`Failed to probe CUE ${cue}: ${err instanceof Error ? err.message : String(err)}`);
      }

      if (durationSec > windowSec) {
        console.warn(`  CUE ${cue}: clip ${durationSec.toFixed(1)}s exceeds ${windowSec}s window — consider bumping pause`);
      }

      // Pad clip to window duration
      try {
        execSync(
          `ffmpeg -y -i "${clipPath}" -af "apad=whole_dur=${windowSec}" -c:a libmp3lame "${paddedPath}"`,
          { stdio: 'ignore' },
        );
      } catch (err) {
        throw new Error(`Failed to pad CUE ${cue}: ${err instanceof Error ? err.message : String(err)}`);
      }

      paddedFiles.push(paddedPath);
      console.log(`[${i + 1}/${CUE_ORDER.length}] Padded ${clipFilename(cue)} → ${windowSec}s`);
    }

    // Build concat file
    const concatPath = join(dir, '_concat.txt');
    const concatContent = paddedFiles.map(f => `file '${f}'`).join('\n');
    writeFileSync(concatPath, concatContent, 'utf8');
    paddedFiles.push(concatPath); // track for cleanup

    // Concatenate
    try {
      execSync(
        `ffmpeg -y -f concat -safe 0 -i "${concatPath}" -c:a libmp3lame "${output}"`,
        { stdio: 'ignore' },
      );
    } catch (err) {
      throw new Error(`Failed to concatenate clips: ${err instanceof Error ? err.message : String(err)}`);
    }

    // Report duration of combined file
    let totalDur = 0;
    try {
      const raw = execSync(
        `ffprobe -v quiet -show_entries format=duration -of csv=p=0 "${output}"`,
        { encoding: 'utf8' },
      ).trim();
      totalDur = parseFloat(raw);
    } catch { /* non-fatal */ }

    console.log(`\nCombined ${CUE_ORDER.length} clips → ${output} (${totalDur.toFixed(1)}s)`);
  } finally {
    // Clean up temp padded files
    for (const f of paddedFiles) {
      try { rmSync(f); } catch { /* ignore cleanup errors */ }
    }
  }
}

async function mergeSubcommand(videoPath: string, audioPath: string, outputPath: string): Promise<void> {
  requireFfmpeg();

  const video = resolve(videoPath);
  const audio = resolve(audioPath);
  const output = resolve(outputPath);

  if (!existsSync(video)) {
    throw new Error(`Video file not found: ${video}`);
  }
  if (!existsSync(audio)) {
    throw new Error(`Audio file not found: ${audio}`);
  }

  try {
    execSync(
      `ffmpeg -y -i "${video}" -i "${audio}" -c:v copy -c:a aac -shortest "${output}"`,
      { stdio: 'ignore' },
    );
  } catch (err) {
    throw new Error(`Failed to merge: ${err instanceof Error ? err.message : String(err)}`);
  }

  console.log(`Merged → ${output}`);
}

// --- Help ---

function showHelp(): void {
  console.log(`
slope narrate — Generate ElevenLabs TTS voiceover for demo

Usage:
  slope narrate voices [--api-key=<key>]
  slope narrate generate --voice=<id> [--api-key=<key>] [--force] [--clean]
  slope narrate combine [--clips=<dir>] [--output=<path>]
  slope narrate merge [--video=<path>] [--audio=<path>] [--output=<path>]

Subcommands:
  voices     List available ElevenLabs voices (validates API key)
  generate   Generate MP3 clips for all 19 narrator segments
  combine    Pad clips to pause windows and concatenate into one track
  merge      Overlay combined audio onto the silent demo video

Options:
  --api-key=<key>   ElevenLabs API key (or set ELEVEN_API_KEY env var)
  --voice=<id>      Voice ID from 'slope narrate voices'
  --force           Re-generate existing clips
  --clean           Remove all existing clips before generating
  --clips=<dir>     Clips directory (default: docs/demo/clips/)
  --output=<path>   Output file path
  --video=<path>    Input video (default: docs/demo/demo-narrated.mp4)
  --audio=<path>    Input audio (default: docs/demo/narrator-combined.mp3)
  --help, -h        Show this help

Examples:
  slope narrate voices --api-key=sk_...
  slope narrate generate --voice=EXAVITQu4vr4xnSDxMaL --api-key=sk_...
  slope narrate combine
  slope narrate merge
`);
}

// --- Main ---

export async function narrateCommand(args: string[]): Promise<void> {
  const opts = parseNarrateArgs(args);

  if (opts.help || !opts.subcommand) {
    showHelp();
    return;
  }

  const clipsDir = opts.clips || 'docs/demo/clips';

  switch (opts.subcommand) {
    case 'voices': {
      const apiKey = resolveApiKey(opts.apiKey);
      await voicesSubcommand(apiKey);
      break;
    }
    case 'generate': {
      const apiKey = resolveApiKey(opts.apiKey);
      await generateSubcommand(apiKey, opts.voice, opts.force, opts.clean, clipsDir);
      break;
    }
    case 'combine': {
      const output = opts.output || 'docs/demo/narrator-combined.mp3';
      await combineSubcommand(clipsDir, output);
      break;
    }
    case 'merge': {
      const video = opts.video || 'docs/demo/demo-narrated.mp4';
      const audio = opts.audio || 'docs/demo/narrator-combined.mp3';
      const output = opts.output || 'docs/demo/demo-final.mp4';
      await mergeSubcommand(video, audio, output);
      break;
    }
    default:
      console.error(`Unknown subcommand: ${opts.subcommand}. Run "slope narrate --help" for usage.`);
      process.exit(1);
  }
}
