// SLOPE — slope narrate: ElevenLabs TTS voiceover pipeline for demo video
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { NARRATOR_SEGMENTS } from './demo.js';

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
  output: string;
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
    output: '',
    video: '',
    audio: '',
    help: false,
  };

  for (const arg of args) {
    if (arg === '--help' || arg === '-h') result.help = true;
    else if (arg === '--force') result.force = true;
    else if (arg.startsWith('--api-key=')) result.apiKey = arg.slice('--api-key='.length);
    else if (arg.startsWith('--voice=')) result.voice = arg.slice('--voice='.length);
    else if (arg.startsWith('--output=')) result.output = arg.slice('--output='.length);
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

// Explicit CUE order — Object.keys() sorts numeric keys like '2' before '1a'
const CUE_ORDER = [
  '1a', '1b', '2',
  '3a', '3b', '3c', '3d', '3e',
  '4a', '4b', '4c', '4d', '4e',
  '5a', '5b', '5c', '5d',
  '6a', '6b',
];

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

async function generateSubcommand(apiKey: string, voiceId: string, force: boolean, outputPath: string): Promise<void> {
  if (!voiceId) {
    throw new Error('--voice=<id> is required. Run "slope narrate voices" to list available voices.');
  }

  const output = resolve(outputPath);

  // Skip if exists unless --force
  if (!force && existsSync(output) && statSync(output).size > 0) {
    console.log(`${output} already exists (use --force to regenerate)`);
    return;
  }

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

  // Concatenate all segments into one script with natural pauses
  const fullScript = CUE_ORDER
    .map(cue => NARRATOR_SEGMENTS[cue].text)
    .join('\n\n');

  console.log(`Generating narration (${CUE_ORDER.length} segments, ${fullScript.length} chars)...`);

  const res = await fetchWithRetry(
    `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
    {
      method: 'POST',
      headers: {
        'xi-api-key': apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        text: fullScript,
        model_id: 'eleven_multilingual_v2',
        voice_settings: { stability: 0.5, similarity_boost: 0.75, style: 0 },
      }),
    },
    3,
  );

  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length === 0) {
    throw new Error('Empty response from ElevenLabs');
  }

  // Ensure output directory exists
  mkdirSync(resolve(outputPath, '..'), { recursive: true });
  writeFileSync(output, buf);

  console.log(`Generated → ${output} (${(buf.length / 1024).toFixed(0)} KB)`);
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
  slope narrate generate --voice=<id> [--api-key=<key>] [--force] [--output=<path>]
  slope narrate merge [--video=<path>] [--audio=<path>] [--output=<path>]

Subcommands:
  voices     List available ElevenLabs voices (validates API key)
  generate   Generate single MP3 narration from all 19 segments
  merge      Overlay narration audio onto the silent demo video

Options:
  --api-key=<key>   ElevenLabs API key (or set ELEVEN_API_KEY env var)
  --voice=<id>      Voice ID from 'slope narrate voices'
  --force           Re-generate even if output exists
  --output=<path>   Output file path
  --video=<path>    Input video (default: docs/demo/demo-narrated.mp4)
  --audio=<path>    Input audio (default: docs/demo/narrator-combined.mp3)
  --help, -h        Show this help

Examples:
  slope narrate voices --api-key=sk_...
  slope narrate generate --voice=1SM7GgM6IMuvQlz2BwM3 --api-key=sk_...
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

  switch (opts.subcommand) {
    case 'voices': {
      const apiKey = resolveApiKey(opts.apiKey);
      await voicesSubcommand(apiKey);
      break;
    }
    case 'generate': {
      const apiKey = resolveApiKey(opts.apiKey);
      const output = opts.output || 'docs/demo/narrator-combined.mp3';
      await generateSubcommand(apiKey, opts.voice, opts.force, output);
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
