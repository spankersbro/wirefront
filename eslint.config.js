// ESLint (WF-34). The game modules run in the browser with three.js and Firebase as CDN globals; tests, the
// proxy and the config files run in Node. Playwright test code also runs callbacks in the page.
const js = require('@eslint/js');
const globals = require('globals');

module.exports = [
  { ignores: ['node_modules/**', 'proxy/node_modules/**', 'test-results/**', 'playwright-report/**'] },
  js.configs.recommended,
  {
    files: ['js/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.browser, THREE: 'readonly', firebase: 'readonly' },
    },
  },
  {
    files: ['tests/**/*.js', 'proxy/**/*.js', '*.config.js'],
    languageOptions: { ecmaVersion: 2022, sourceType: 'commonjs', globals: { ...globals.node } },
  },
  {
    // Code inside page.evaluate and init scripts runs in the browser.
    files: ['tests/**/*.js'],
    languageOptions: { globals: { ...globals.browser, firebase: 'readonly' } },
  },
];
