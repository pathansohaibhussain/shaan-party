// Sanity checks for the Render deployment files (we cannot run Docker in the tests, so check the wiring).
// Run with:  node --test tests/deploy-files.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');

test('Dockerfile copies files that exist and are not excluded by .dockerignore', () => {
  const docker = read('Dockerfile');
  const ignore = read('.dockerignore').split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  const sources = [...docker.matchAll(/^COPY\s+(?!--from)(\S+)\s+\S+/gm)].map(m => m[1]);
  assert.ok(sources.includes('server-spring/pom.xml') && sources.includes('server-spring/src'));
  sources.forEach(s => {
    assert.ok(fs.existsSync(path.join(root, s)), 'missing: ' + s);
    assert.ok(!ignore.some(i => s === i || s.startsWith(i + '/')), '.dockerignore would hide ' + s);
  });
});

test('the jar the Dockerfile runs is what Maven builds, and the server listens on $PORT', () => {
  const pom = read('server-spring/pom.xml');
  assert.match(pom, /<artifactId>party-server<\/artifactId>/);
  assert.match(read('Dockerfile'), /target\/\*\.jar/);
  assert.match(read('server-spring/src/main/resources/application.properties'), /server\.port=\$\{PORT:8080\}/);
});

test('render.yaml points at the Dockerfile, a page that exists, and keeps the YouTube key out of git', () => {
  const y = read('render.yaml');
  assert.match(y, /dockerfilePath:\s*\.\/Dockerfile/);
  assert.match(y, /plan:\s*free/);
  const hc = y.match(/healthCheckPath:\s*(\S+)/)[1];
  assert.ok(fs.existsSync(path.join(root, 'server-spring/src/main/resources/static', hc.replace(/^\//, ''))), 'health check page missing: ' + hc);
  assert.match(y, /key:\s*YOUTUBE_API_KEY\s*\n\s*sync:\s*false/);
  assert.ok(!/AIza/.test(y));
});

test('secrets and local settings are git-ignored', () => {
  const g = read('.gitignore');
  ['party.config.json', 'server-spring/target/', 'node_modules/', '.env'].forEach(x => assert.ok(g.includes(x), x));
});
