// ESLint for the game modules (WF-34). three.js and Firebase are CDN globals loaded by index.html.
const js = require('@eslint/js');
const globals = require('globals');

module.exports = [
  js.configs.recommended,
  {
    files: ['js/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.browser, THREE: 'readonly', firebase: 'readonly' },
    },
  },
];
