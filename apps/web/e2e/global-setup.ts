import { request } from '@playwright/test';

// Global setup: warm up every webServer before the first spec so cold vite
// transforms stop flaking the opening test of a run (documented cold-load
// class). Fails the run early if the API never comes up.
async function globalSetup(): Promise<void> {
  const API = process.env.API_BASE ?? 'http://localhost:8787';
  const t0 = Date.now();
  for (let i = 0; i < 120; i++) {
    try {
      const ctx = await request.newContext();
      const r = await ctx.get(`${API}/health`);
      await ctx.dispose();
      if (r.ok()) break;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 500));
    if (i === 119) throw new Error(`API never came up at ${API}`);
  }
  // Warm each portal shell once (first vite transform is the slow one).
  const ports = [5177, 5173, 5174, 5175, 5176];
  await Promise.all(
    ports.map(async (p) => {
      for (let i = 0; i < 60; i++) {
        try {
          const ctx = await request.newContext();
          const r = await ctx.get(`http://localhost:${p}/`);
          await ctx.dispose();
          if (r.ok()) return;
        } catch {
          /* not up yet */
        }
        await new Promise((r) => setTimeout(r, 500));
      }
      throw new Error(`portal :${p} never came up`);
    })
  );
  // eslint-disable-next-line no-console
  console.log(`global-setup: all servers warm in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}

export default globalSetup;
