import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    globalSetup: ['./test/global-setup.ts'],
    testTimeout: 30000,
    hookTimeout: 60000,
    fileParallelism: false,
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? 'postgresql://postgres@127.0.0.1:5432/rupeemap_test',
      REDIS_URL: process.env.TEST_REDIS_URL ?? 'redis://127.0.0.1:6379/1',
      OTP_PEPPER: 'test-pepper',
      SMS_PROVIDER: 'console',
    },
  },
});
