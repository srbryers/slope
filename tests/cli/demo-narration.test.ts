import { describe, it, expect } from 'vitest';
import { NARRATOR_CUE_PAUSES, NARRATOR_SEGMENTS } from '../../src/cli/commands/demo.js';

// --- Segment data (word counts from rewritten conversational script) ---

interface NarratorSegment {
  cue: string;        // matches key in NARRATOR_CUE_PAUSES
  words: number;      // actual word count from NARRATOR_SEGMENTS
  description: string;
}

const SEGMENTS: NarratorSegment[] = [
  { cue: '1a', words: 29, description: 'hook — "Hey everyone, this is Slope..."' },
  { cue: '1b', words: 39, description: 'scan — "All right, so what you see here..."' },
  { cue: '2',  words: 44, description: 'todo — "Now you can see it\'s found some TODOs..."' },
  { cue: '3a', words: 52, description: 'vision — "Now Slope is going to ask you..."' },
  { cue: '3b', words: 29, description: 'priorities — "You can see here it\'s pulled out..."' },
  { cue: '3c', words: 30, description: 'clarify — "Now it\'s going to ask some clarifying..."' },
  { cue: '3d', words: 29, description: 'bottleneck — "You can see here it\'s trying..."' },
  { cue: '3e', words: 31, description: 'gap — "And it\'s also picking up..."' },
  { cue: '4a', words: 28, description: 'structure — "So now it\'s going to try..."' },
  { cue: '4b', words: 28, description: 'checkin — "And this is one of the key things..."' },
  { cue: '4c', words: 32, description: 'pushback — "So here, the audience was..."' },
  { cue: '4d', words: 18, description: 'updated — "You can see it\'s come back..."' },
  { cue: '4e', words: 21, description: 'locked — "All right, so we\'ve agreed..."' },
  { cue: '5a', words: 39, description: 'roadmap — "Now what it\'s going to do..."' },
  { cue: '5b', words: 35, description: 'sprint1 — "You can see it\'s breaking it down..."' },
  { cue: '5c', words: 30, description: 'sprints — "And then you\'ve got the rest..."' },
  { cue: '5d', words: 24, description: 'done — "So that\'s your starting point..."' },
  { cue: '6a', words: 30, description: 'before-after — "And this is kind of the before..."' },
  { cue: '6b', words: 33, description: 'closing — "That\'s it. All from one conversation..."' },
];

// ElevenLabs conversational speaking rate (Mark voice, measured ~2.7 WPS)
const SPEAKING_RATE_WPS = 2.7;
// Silent demo baseline (seconds)
const SILENT_BASELINE_S = 96;

describe('demo narration timing', () => {
  // --- Group 1: Fit and naturalness ---
  describe('segment fit (fill ratio)', () => {
    for (const seg of SEGMENTS) {
      it(`CUE ${seg.cue}: narrator fits within pause window`, () => {
        const pauseMs = NARRATOR_CUE_PAUSES[seg.cue];
        expect(pauseMs, `CUE ${seg.cue} missing from NARRATOR_CUE_PAUSES`).toBeDefined();

        const audioEstMs = (seg.words / SPEAKING_RATE_WPS) * 1000;
        const fillRatio = audioEstMs / pauseMs;

        expect(fillRatio, `CUE ${seg.cue} (${seg.description}): fill ${(fillRatio * 100).toFixed(0)}% (${audioEstMs}ms / ${pauseMs}ms) — narrator overflows pause window`).toBeLessThanOrEqual(1.0);
        expect(fillRatio, `CUE ${seg.cue} (${seg.description}): fill ${(fillRatio * 100).toFixed(0)}% (${audioEstMs}ms / ${pauseMs}ms) — too tight, no breathing room`).toBeLessThanOrEqual(0.95);
      });
    }

    it('no segment has excessive dead air (fill ratio >= 25%)', () => {
      const slack: string[] = [];
      for (const seg of SEGMENTS) {
        const pauseMs = NARRATOR_CUE_PAUSES[seg.cue];
        const audioEstMs = (seg.words / SPEAKING_RATE_WPS) * 1000;
        const fillRatio = audioEstMs / pauseMs;
        if (fillRatio < 0.25) {
          slack.push(`CUE ${seg.cue}: fill ${(fillRatio * 100).toFixed(0)}% — excessive dead air`);
        }
      }
      expect(slack, `Segments with fill < 25%:\n${slack.join('\n')}`).toHaveLength(0);
    });
  });

  // --- Group 2: Code-script alignment ---
  describe('code-script alignment', () => {
    it('every test segment has a matching key in NARRATOR_CUE_PAUSES', () => {
      const missing = SEGMENTS
        .filter(s => !(s.cue in NARRATOR_CUE_PAUSES))
        .map(s => s.cue);
      expect(missing, `Segments missing from NARRATOR_CUE_PAUSES: ${missing.join(', ')}`).toHaveLength(0);
    });

    it('every key in NARRATOR_CUE_PAUSES has a corresponding test segment', () => {
      const segmentCues = new Set(SEGMENTS.map(s => s.cue));
      const extra = Object.keys(NARRATOR_CUE_PAUSES).filter(k => !segmentCues.has(k));
      expect(extra, `Keys in NARRATOR_CUE_PAUSES without test segments: ${extra.join(', ')}`).toHaveLength(0);
    });

    it('segment count matches NARRATOR_CUE_PAUSES key count', () => {
      expect(SEGMENTS.length).toBe(Object.keys(NARRATOR_CUE_PAUSES).length);
    });

    it('all pause values are positive integers in a valid range', () => {
      for (const [cue, ms] of Object.entries(NARRATOR_CUE_PAUSES)) {
        expect(ms, `CUE ${cue}: pause must be positive`).toBeGreaterThan(0);
        expect(ms % 1000, `CUE ${cue}: pause ${ms}ms not a whole-second multiple`).toBe(0);
        expect(ms, `CUE ${cue}: pause ${ms}ms exceeds 25s max`).toBeLessThanOrEqual(25000);
      }
    });
  });

  // --- Group 3: Total runtime ---
  describe('total runtime', () => {
    it('total pause time is reasonable (200-350s)', () => {
      const totalPauseMs = Object.values(NARRATOR_CUE_PAUSES).reduce((a, b) => a + b, 0);
      const totalPauseS = totalPauseMs / 1000;
      expect(totalPauseS, `Total pause time ${totalPauseS}s too short`).toBeGreaterThanOrEqual(200);
      expect(totalPauseS, `Total pause time ${totalPauseS}s too long`).toBeLessThanOrEqual(350);
    });

    it('narrated demo total stays within 5:00-8:00 (300-480s)', () => {
      const totalPauseS = Object.values(NARRATOR_CUE_PAUSES).reduce((a, b) => a + b, 0) / 1000;
      const totalNarratedS = totalPauseS + SILENT_BASELINE_S;
      expect(totalNarratedS, `Narrated total ${totalNarratedS}s < 300s — too rushed`).toBeGreaterThanOrEqual(300);
      expect(totalNarratedS, `Narrated total ${totalNarratedS}s > 480s — too long`).toBeLessThanOrEqual(480);
    });

    it('total word count fits within total pause time', () => {
      const totalWords = SEGMENTS.reduce((a, s) => a + s.words, 0);
      const totalPauseS = Object.values(NARRATOR_CUE_PAUSES).reduce((a, b) => a + b, 0) / 1000;
      const totalSpeakingS = totalWords / SPEAKING_RATE_WPS;
      expect(totalSpeakingS, `Total speaking ${totalSpeakingS.toFixed(1)}s exceeds total pause ${totalPauseS}s`).toBeLessThanOrEqual(totalPauseS);
    });
  });
});
