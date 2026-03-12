import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createLogger, isoTimestamp, type Logger } from '../../../src/cli/loop/logger.js';

describe('logger', () => {
  describe('createLogger', () => {
    it('returns an object with info method', () => {
      const logger = createLogger('test');
      expect(typeof logger.info).toBe('function');
    });

    it('returns an object with warn method', () => {
      const logger = createLogger('test');
      expect(typeof logger.warn).toBe('function');
    });

    it('returns an object with error method', () => {
      const logger = createLogger('test');
      expect(typeof logger.error).toBe('function');
    });

    it('returns an object with child method', () => {
      const logger = createLogger('test');
      expect(typeof logger.child).toBe('function');
    });

    it('info method logs to console.log', () => {
      const logger = createLogger('test');
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      logger.info('test message');
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringMatching(/^\[\d{2}:\d{2}:\d{2}\] \[test\] test message$/));
      consoleSpy.mockRestore();
    });

    it('warn method logs to console.error', () => {
      const logger = createLogger('test');
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      logger.warn('warning message');
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringMatching(/^\[\d{2}:\d{2}:\d{2}\] \[test\] warning message$/));
      consoleSpy.mockRestore();
    });

    it('error method logs to console.error', () => {
      const logger = createLogger('test');
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      logger.error('error message');
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringMatching(/^\[\d{2}:\d{2}:\d{2}\] \[test\] error message$/));
      consoleSpy.mockRestore();
    });

    it('uses default prefix when none provided', () => {
      const logger = createLogger();
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      logger.info('test');
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringMatching(/^\[\d{2}:\d{2}:\d{2}\] \[loop\] test$/));
      consoleSpy.mockRestore();
    });
  });

  describe('child', () => {
    it('returns a logger with combined prefix', () => {
      const parent = createLogger('parent');
      const child = parent.child('child');
      
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      child.info('test');
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringMatching(/^\[\d{2}:\d{2}:\d{2}\] \[parent:child\] test$/));
      consoleSpy.mockRestore();
    });

    it('supports nested child loggers', () => {
      const parent = createLogger('parent');
      const child1 = parent.child('child1');
      const child2 = child1.child('child2');
      
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      child2.info('test');
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringMatching(/^\[\d{2}:\d{2}:\d{2}\] \[parent:child1:child2\] test$/));
      consoleSpy.mockRestore();
    });

    it('child logger has all methods', () => {
      const parent = createLogger('parent');
      const child = parent.child('child');
      
      expect(typeof child.info).toBe('function');
      expect(typeof child.warn).toBe('function');
      expect(typeof child.error).toBe('function');
      expect(typeof child.child).toBe('function');
    });
  });

  describe('isoTimestamp', () => {
    it('returns a valid ISO 8601 string', () => {
      const result = isoTimestamp();
      
      // ISO 8601 format: YYYY-MM-DDTHH:mm:ss.sssZ
      const iso8601Regex = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/;
      expect(result).toMatch(iso8601Regex);
    });

    it('returns a string', () => {
      const result = isoTimestamp();
      expect(typeof result).toBe('string');
    });

    it('returns current time (within reasonable delta)', () => {
      const before = new Date().toISOString();
      const result = isoTimestamp();
      const after = new Date().toISOString();
      
      // The result should be between before and after (allowing for execution time)
      expect(result >= before).toBe(true);
      expect(result <= after).toBe(true);
    });

    it('can be parsed as a valid date', () => {
      const result = isoTimestamp();
      const date = new Date(result);
      
      expect(!isNaN(date.getTime())).toBe(true);
    });
  });
});
