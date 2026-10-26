export default {
  testEnvironment: 'node',
  testMatch: ['<rootDir>/test/financial/**/*.test.mjs'],
  transform: {},
  testTimeout: 180000,
  coverageProvider: 'v8',
  coverageReporters: ['text', 'lcov', 'json-summary'],
  collectCoverageFrom: [
    'dist/helpers/**/*.js',
    'dist/core/providers/prisma/**/*.js',
    'dist/core/providers/fx/**/*.js',
    'dist/core/routes/capacity/layers/**/*.service.js',
    'dist/core/routes/treasury/layers/**/*.service.js',
  ],
};
