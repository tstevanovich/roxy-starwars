import mongoose from 'mongoose';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import { createApp } from './app.ts';
import { connectDatabase } from './db.ts';

vi.mock('./app.ts', () => ({ createApp: vi.fn() }));
vi.mock('./db.ts', () => ({ connectDatabase: vi.fn(async () => {}) }));
let signals: Record<string, () => void>;
let errors: (error: Error) => Promise<void>;
let ready: () => void;
let stop, start, close;
let originalExitCode;
beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  originalExitCode = process.exitCode;
  signals = {};
  stop = vi.fn(async () => {});
  start = vi.fn(async () => {});
  close = vi.fn((done) => done());
  vi.spyOn(process, 'on').mockImplementation(((signal, handler) => {
    signals[signal] = handler;
    return process;
  }) as typeof process.on);
  vi.spyOn(process, 'exit').mockImplementation((() => {}) as typeof process.exit);
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(mongoose, 'disconnect').mockResolvedValue(undefined);
  vi.mocked(connectDatabase).mockReset().mockResolvedValue(undefined);
  vi.mocked(createApp).mockReturnValue({
    locals: { assistant: { start, stop } },
    listen: vi.fn((_port, _host, callback) => {
      ready = callback;
      return {
        close,
        on: (_event, callback) => {
          errors = callback;
        }
      };
    })
  } as unknown as ReturnType<typeof createApp>);
  vi.stubEnv('PORT', '5000');
  vi.stubEnv('HOST', '127.0.0.1');
  vi.stubEnv('NODE_ENV', 'test');
});
afterEach(() => {
  process.exitCode = originalExitCode;
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

test('startup uses defaults and registers a graceful shutdown only once', async () => {
  vi.stubEnv('PORT', '');
  vi.stubEnv('HOST', '');
  await import('./server.ts');
  ready();
  expect(start).toHaveBeenCalledOnce();
  signals.SIGINT();
  signals.SIGTERM();
  await vi.runAllTimersAsync();
  expect(stop).toHaveBeenCalledOnce();
  expect(close).toHaveBeenCalledOnce();
  expect(mongoose.disconnect).toHaveBeenCalledOnce();
  expect(process.exit).not.toHaveBeenCalled();
});
test.each(['not-a-port', '0', '65536', '2.5'])(
  'invalid port %s fails before connecting',
  async (port) => {
    vi.stubEnv('PORT', port);
    await import('./server.ts');
    expect(connectDatabase).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  }
);
test('database startup and listening errors are reported and disconnected', async () => {
  vi.mocked(connectDatabase).mockRejectedValueOnce('offline');
  await import('./server.ts');
  expect(process.exitCode).toBe(1);
  expect(mongoose.disconnect).toHaveBeenCalled();
  vi.resetModules();
  vi.stubEnv('NODE_ENV', 'production');
  await import('./server.ts');
  expect(createApp).toHaveBeenLastCalledWith({ serveClient: true });
  await errors(new Error('address in use'));
  expect(process.exitCode).toBe(1);
});
test('worker startup failure is reported without an unhandled rejection', async () => {
  start.mockRejectedValueOnce(new Error('offline'));
  await import('./server.ts');
  ready();
  await Promise.resolve();
  expect(console.error).toHaveBeenCalledWith('Production chat worker could not start.');
});
test('failed close reports failure and the deadline forces an exit', async () => {
  close.mockImplementationOnce((done) => done(new Error('close failed')));
  await import('./server.ts');
  signals.SIGTERM();
  await vi.runAllTimersAsync();
  expect(console.error).toHaveBeenCalledWith('Shutdown failed:', 'close failed');
  expect(process.exitCode).toBe(1);
  expect(process.exit).toHaveBeenCalledWith(1);
});
test('a stalled worker also hits the shutdown deadline', async () => {
  stop.mockReturnValueOnce(new Promise(() => {}));
  await import('./server.ts');
  signals.SIGINT();
  await vi.advanceTimersByTimeAsync(10000);
  expect(process.exit).toHaveBeenCalledWith(1);
});
