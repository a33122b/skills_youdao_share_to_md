declare module 'node:fs/promises';
declare module 'node:os';
declare module 'node:path';
declare module 'node:crypto';
declare module 'node:url';
declare module 'node:assert/strict';

declare const process: {
  argv: string[];
  env: Record<string, string | undefined>;
  stdout: { write(chunk: string): void };
  stderr: { write(chunk: string): void };
  exit(code?: number): never;
};

declare const Buffer: {
  from(value: ArrayBuffer): Uint8Array;
};
