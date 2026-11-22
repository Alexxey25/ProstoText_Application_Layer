import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('system font and explicit hover/focus states without a font package', () => {
  const css = readFileSync(new URL('../src/style.css', import.meta.url), 'utf8');
  const main = readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8');
  assert.match(css, /font-family:Arial,Helvetica,sans-serif/);
  assert.match(main, /fontFamily: 'Arial, Helvetica, sans-serif'/);
  assert.doesNotMatch(main, /@fontsource/);
  assert.match(css, /--button-bg:#000;/);
  assert.match(css, /--button-hover:#c6b09f;/);
  assert.match(main, /main: '#000000', dark: '#C6B09F', contrastText: '#FFFFFF'/);
  assert.match(css, /@media \(hover:hover\)/);
  assert.match(css, /send-button:not\(\.Mui-disabled\):hover/);
  assert.match(css, /Mui-focusVisible/);
  assert.match(css, /background:var\(--button-hover\); color:#fff/);
  assert.match(css, /filter:brightness\(0\) invert\(1\)/);
});

test('launcher and package do not depend on concurrently or fontsource', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(pkg.dependencies['@fontsource/inter'], undefined);
  assert.equal(pkg.devDependencies.concurrently, undefined);
  assert.equal(pkg.scripts['dev:demo'], 'node scripts/dev.ts --demo');
});
