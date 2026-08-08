import { defineConfig } from '@playwright/test';

// A distinctive port with --strictPort: vite's default 5173 is shared with other projects
// on this machine, and reuseExistingServer would otherwise run the suite against whatever
// happens to be listening. strictPort makes a clash fail loudly instead of drifting.
const PORT = 5183;

export default defineConfig({
  testDir: './tests',
  testIgnore: 'unit/**',
  use: { baseURL: `http://localhost:${PORT}` },
  webServer: {
    command: `npm run dev -- --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
});
