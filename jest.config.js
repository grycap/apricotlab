module.exports = {
  clearMocks: true,
  preset: 'ts-jest',
  testEnvironment: 'jsdom',
  testMatch: ['<rootDir>/tests/frontend/**/*.test.ts'],
  transform: {
    '^.+\\.ts$': [
      'ts-jest',
      {
        diagnostics: true,
        tsconfig: {
          ...require('./tsconfig.json').compilerOptions,
          composite: false,
          declaration: false,
          module: 'commonjs',
          noUnusedLocals: false,
          rootDir: '.'
        }
      }
    ]
  }
};
