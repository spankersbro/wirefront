const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: 'tests',
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: 'http://127.0.0.1:8123',
    browserName: 'chromium',
  },
  webServer: {
    command: 'python3 -m http.server 8123 --bind 127.0.0.1',
    url: 'http://127.0.0.1:8123/index.html',
    reuseExistingServer: !process.env.CI,
  },
});
