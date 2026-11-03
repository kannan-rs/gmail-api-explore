import { describe, expect, it } from 'vitest';
import { TokenCipher } from '../../src/services/crypto';

const key = Buffer.alloc(32, 7).toString('base64');

describe('TokenCipher', () => {
  it('round-trips a refresh token', () => {
    const cipher = new TokenCipher(key);
    const plaintext = '1//refresh-token-value';

    const encrypted = cipher.encrypt(plaintext);

    expect(encrypted).not.toContain(plaintext);
    expect(encrypted.startsWith('v1.')).toBe(true);
    expect(cipher.decrypt(encrypted)).toBe(plaintext);
  });

  it('uses a random IV so the same plaintext encrypts differently', () => {
    const cipher = new TokenCipher(key);
    const first = cipher.encrypt('same-secret');
    const second = cipher.encrypt('same-secret');

    expect(first).not.toBe(second);
    expect(cipher.decrypt(first)).toBe('same-secret');
    expect(cipher.decrypt(second)).toBe('same-secret');
  });

  it('rejects a tampered payload', () => {
    const cipher = new TokenCipher(key);
    const encrypted = cipher.encrypt('secret');
    const tampered = `${encrypted.slice(0, -2)}AA`;

    expect(() => cipher.decrypt(tampered)).toThrow(/decrypt/i);
  });

  it('rejects a key that is not 32 bytes', () => {
    expect(() => new TokenCipher(Buffer.alloc(16, 1).toString('base64'))).toThrow(/32 bytes/i);
  });

  it('rejects malformed payloads', () => {
    const cipher = new TokenCipher(key);
    expect(() => cipher.decrypt('not-a-ciphertext')).toThrow(/invalid/i);
  });
});
