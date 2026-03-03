import { describe, it, expect } from 'vitest';
import { NARRATOR_CUE_PAUSES } from '../../src/cli/commands/demo.js';

// --- Segment data (word counts verified against docs/demo/narrator-script.md) ---

interface NarratorSegment {
  cue: string;        // matches key in NARRATOR_CUE_PAUSES
  words: number;      // actual word count from narrator script
  description: string;
}

const SEGMENTS: NarratorSegment[] = [
  { cue: '1a', words: 17, description: 'hook — "This is SLOPE..."' },
  { cue: '1b', words: 19, description: 'scan — "It scans the codebase..."' },
  { cue: '2',  words: 17, description: 'todo — "One TODO here..."' },
  { cue: '3a', words: 20, description: 'vision question — "It asks you to describe..."' },
  { cue: '3b', words: 18, description: 'priorities — "It pulls out the priorities..."' },
  { cue: '3c', words: 19, description: 'clarify — "Follow-up questions..."' },
  { cue: '3d', words: 16, description: 'clarification answer 1 — "Delivery is the bottleneck..."' },
  { cue: '3e', words: 20, description: 'clarification answer 2 — "No tests, no CI..."' },
  { cue: '4a', words: 16, description: 'vision doc — "It structures everything..."' },
  { cue: '4b', words:  9, description: 'check-in — "And it checks in..."' },
  { cue: '4c', words: 18, description: 'pushback — "Audience was too narrow..."' },
  { cue: '4d', words:  6, description: 'updated — "Updated instantly..."' },
  { cue: '4e', words:  6, description: 'locked — "Vision locked..."' },
  { cue: '5a', words: 17, description: 'roadmap — "It takes the vision..."' },
  { cue: '5b', words: 19, description: 'sprint 1 — "Sprint 1 focuses on speed..."' },
  { cue: '5c', words: 14, description: 'sprints mid — "Testing, reliability..."' },
  { cue: '5d', words:  9, description: 'sprints done — "Five sprints..."' },
  { cue: '6a', words: 13, description: 'before/after — "Before: no priorities..."' },
  { cue: '6b', words:  8, description: 'closing — "One conversation..."' },
];

// ElevenLabs short-sentence speaking rate
const SPEAKING_RATE_WPS = 4.0;
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
        expect(fillRatio, `CUE ${seg.cue} (${seg.description}): fill ${(fillRatio * 100).toFixed(0)}% (${audioEstMs}ms / ${pauseMs}ms) — too tight, no breathing room`).toBeLessThanOrEqual(0.90);
      });
    }

    it('no segment has excessive dead air (fill ratio >= 30%)', () => {
      const slack: string[] = [];
      for (const seg of SEGMENTS) {
        const pauseMs = NARRATOR_CUE_PAUSES[seg.cue];
        const audioEstMs = (seg.words / SPEAKING_RATE_WPS) * 1000;
        const fillRatio = audioEstMs / pauseMs;
        if (fillRatio < 0.30) {
          slack.push(`CUE ${seg.cue}: fill ${(fillRatio * 100).toFixed(0)}% — excessive dead air`);
        }
      }
      expect(slack, `Segments with fill < 30%:\n${slack.join('\n')}`).toHaveLength(0);
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
        expect(ms, `CUE ${cue}: pause ${ms}ms exceeds 12s max`).toBeLessThanOrEqual(12000);
      }
    });
  });

  // --- Group 3: Total runtime ---
  describe('total runtime', () => {
    it('total pause time is reasonable (60-180s)', () => {
      const totalPauseMs = Object.values(NARRATOR_CUE_PAUSES).reduce((a, b) => a + b, 0);
      const totalPauseS = totalPauseMs / 1000;
      expect(totalPauseS, `Total pause time ${totalPauseS}s too short`).toBeGreaterThanOrEqual(60);
      expect(totalPauseS, `Total pause time ${totalPauseS}s too long`).toBeLessThanOrEqual(180);
    });

    it('narrated demo total stays within 2:50-5:00 (170-300s)', () => {
      const totalPauseS = Object.values(NARRATOR_CUE_PAUSES).reduce((a, b) => a + b, 0) / 1000;
      const totalNarratedS = totalPauseS + SILENT_BASELINE_S;
      expect(totalNarratedS, `Narrated total ${totalNarratedS}s < 170s — too rushed`).toBeGreaterThanOrEqual(170);
      expect(totalNarratedS, `Narrated total ${totalNarratedS}s > 300s — too long`).toBeLessThanOrEqual(300);
    });

    it('total word count fits within total pause time', () => {
      const totalWords = SEGMENTS.reduce((a, s) => a + s.words, 0);
      const totalPauseS = Object.values(NARRATOR_CUE_PAUSES).reduce((a, b) => a + b, 0) / 1000;
      const totalSpeakingS = totalWords / SPEAKING_RATE_WPS;
      expect(totalSpeakingS, `Total speaking ${totalSpeakingS.toFixed(1)}s exceeds total pause ${totalPauseS}s`).toBeLessThanOrEqual(totalPauseS);
    });
  });
});
