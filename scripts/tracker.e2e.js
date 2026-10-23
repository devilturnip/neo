// End-to-end tests for the litrpg-tracker hover panel: the right-edge hover
// gesture, the dual-mode #side-pane sharing with Stickies, and that neither
// entry point leaves the pane in the wrong mode. Deliberately doesn't depend
// on the litrpg-tracker repo actually being checked out (ensureTrackerPane()
// degrades to a "not available" message when it isn't, by design) — this
// suite only exercises the DOM/mode mechanics, which must hold either way.
// Run with `npm run test:tracker`.

'use strict';

const { app, BrowserWindow } = require('electron');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

for (const name of fs.readdirSync(os.tmpdir())) {
  const pid = /^neo-tracker-test-(\d+)-/.exec(name);
  if (!pid || +pid[1] === process.pid) continue;
  try { process.kill(+pid[1], 0); continue; } catch (err) { if (err.code === 'EPERM') continue; }
  fs.rmSync(path.join(os.tmpdir(), name), { recursive: true, force: true });
}
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `neo-tracker-test-${process.pid}-`));
app.setPath('userData', path.join(tmp, 'app'));
app.setPath('documents', tmp);
const lib = path.join(tmp, 'NEO Library');
fs.mkdirSync(lib);
fs.writeFileSync(path.join(lib, 'library.json'), JSON.stringify({
  authorName: '', penNames: [], firstRunDone: true, pageTheme: 'night',
  shelves: [{ id: 'shelf-1', name: 'Works in Progress', bookIds: [] }]
}));
const loadFile = BrowserWindow.prototype.loadFile;
BrowserWindow.prototype.loadFile = function (file, opts) {
  return loadFile.call(this, path.resolve(__dirname, '..', file), opts);
};
require('../main.js');

let wc, win;
const js = (code) => wc.executeJavaScript(code, true);
const tick = (ms = 40) => new Promise((resolve) => setTimeout(resolve, ms));
const paneState = () => js(`(() => {
  const p = document.getElementById('side-pane');
  return { open: p.classList.contains('open'), mode: p.dataset.mode, ariaLabel: p.getAttribute('aria-label') };
})()`);
const hover = (id, on) => js(`document.getElementById('${id}').dispatchEvent(new MouseEvent('${on ? 'mouseenter' : 'mouseleave'}', { bubbles: false }))`);

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

test('hovering the right edge opens the pane in tracker mode', async () => {
  await hover('side-hotzone', true);
  await tick(250); // the 0.18s CSS transition, plus a little slack
  const state = await paneState();
  assert.equal(state.open, true);
  assert.equal(state.mode, 'tracker');
  assert.equal(state.ariaLabel, 'litrpg-tracker');
});

test('leaving the edge no longer closes tracker mode (a genuine fix: crossing onto the iframe fires a spurious mouseleave in Chromium, which used to close the pane before a click inside it could land)', async () => {
  await hover('side-hotzone', false);
  await tick(250);
  const state = await paneState();
  assert.equal(state.open, true, 'tracker mode must stay open so clicks inside the iframe can land');
  assert.equal(state.mode, 'tracker');
});

test('clicking outside the open tracker pane still closes it', async () => {
  await js(`document.getElementById('back-to-shelf').dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))`);
  await tick(100);
  const state = await paneState();
  assert.equal(state.open, false);
});

test('the Stickies button switches an open tracker pane to stickies mode, rather than just closing it', async () => {
  await hover('side-hotzone', true);
  await tick(250);
  assert.equal((await paneState()).mode, 'tracker'); // reopened in tracker mode, same as before
  await js(`document.getElementById('side-pane-toggle').click()`);
  await tick(100);
  const state = await paneState();
  const stickyDisplay = await js(`getComputedStyle(document.getElementById('sticky-list')).display`);
  const trackerDisplay = await js(`getComputedStyle(document.getElementById('tracker-pane-body')).display`);
  assert.equal(state.open, true);
  assert.equal(state.mode, 'stickies');
  assert.equal(state.ariaLabel, 'Notes & Comments');
  assert.equal(stickyDisplay, 'block');
  assert.equal(trackerDisplay, 'none');
});

test('clicking Stickies again, now that it is the open mode, closes it as a normal toggle', async () => {
  await js(`document.getElementById('side-pane-toggle').click()`);
  await tick(100);
  assert.equal((await paneState()).open, false);
});

test('hovering again after using Stickies correctly switches back to tracker mode', async () => {
  await hover('side-hotzone', true);
  await tick(250);
  const state = await paneState();
  assert.equal(state.mode, 'tracker');
  assert.equal(await js(`getComputedStyle(document.getElementById('tracker-pane-body')).display`), 'block');
  assert.equal(await js(`getComputedStyle(document.getElementById('sticky-list')).display`), 'none');
});

// The rest covers what tracker-bridge.js builds itself (its markup and the
// observer that keeps the Stickies button honest), so an upstream merge
// that breaks the bridge's footing shows up here, not in use.
test('the Stickies button lights up only while the pane is open on Stickies', async () => {
  const lit = () => js(`document.getElementById('side-pane-toggle').classList.contains('active')`);
  assert.equal(await lit(), false, 'tracker mode is open from the previous test — the button stays unlit');
  await js(`document.getElementById('side-pane-toggle').click()`);
  await tick(100);
  assert.equal(await lit(), true);
  await js(`document.getElementById('side-pane-toggle').click()`);
  await tick(100);
  assert.equal(await lit(), false);
});

test('the full-screen button shows only in tracker mode, and toggles the pane wide', async () => {
  const wideDisplay = () => js(`getComputedStyle(document.getElementById('side-wide')).display`);
  const wide = () => js(`document.getElementById('side-pane').dataset.wide`);
  await hover('side-hotzone', true);
  await tick(250);
  assert.equal(await wideDisplay(), 'block');
  await js(`document.getElementById('side-wide').click()`);
  await tick(50);
  assert.equal(await wide(), '1');
  await js(`document.getElementById('side-wide').click()`);
  await tick(50);
  assert.equal(await wide(), '0');
  await js(`document.getElementById('side-pane-toggle').click()`); // over to Stickies
  await tick(100);
  assert.equal(await wideDisplay(), 'none');
});

test('leaving the Manuscript tab hides the Stickies button and closes the unpinned pane', async () => {
  const hidden = () => js(`document.getElementById('side-pane-toggle').hidden`);
  assert.equal((await paneState()).open, true, 'Stickies is open from the previous test');
  await js(`sidePaneForTab('notes')`);
  await tick(100);
  assert.equal(await hidden(), true);
  assert.equal((await paneState()).open, false);
  await js(`sidePaneForTab('manuscript')`);
  await tick(100);
  assert.equal(await hidden(), false);
});

async function main() {
  await app.whenReady();
  let failed = 0;
  try {
    while (!(win = BrowserWindow.getAllWindows()[0])) await tick(50);
    wc = win.webContents;
    while (!(await js(`typeof library !== 'undefined' && !!library`).catch(() => false))) await tick(50);
    await js(`(async () => {
      document.getElementById('firstrun').hidden = true;
      await addImportedBooks([{ name: 'Tracker Test Book', chapters: [{ title: 'One', paras: [{ text: 'Hello.' }] }] }], library.shelves[0]);
      const ids = library.shelves[0].bookIds;
      await openBook(ids[ids.length - 1]);
    })()`);
    await tick(400);
    win.focus();
    for (const t of tests) {
      try {
        win.focus(); // the window can lose OS focus mid-run, which would correctly auto-close an unpinned pane
        await t.fn();
        console.log('ok   ' + t.name);
      } catch (err) {
        failed++;
        console.log('FAIL ' + t.name + '\n     ' + String(err.message).replace(/\n/g, '\n     '));
      }
    }
    console.log(`\n${tests.length - failed} passed, ${failed} failed`);
  } finally {
    app.quit();
  }
  process.exitCode = failed ? 1 : 0;
}

main();
