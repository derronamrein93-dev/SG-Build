/** Poll until the app answers, so e2e:full does not race the server start. */
const BASE = process.env.E2E_BASE ?? 'http://127.0.0.1:3000';
for (let i = 0; i < 40; i++) {
  try { if ((await fetch(BASE)).ok) { console.log('server up'); process.exit(0); } } catch {}
  await new Promise((r) => setTimeout(r, 1000));
}
console.error(`server did not answer at ${BASE}`); process.exit(1);
