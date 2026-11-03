const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto('http://localhost:5174/editor/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(2000);
  await page.evaluate(async () => {
    const editor = window.editor;
    [...editor.scene.children].forEach(c => editor.removeObject(c));
    editor.history.clear();
    await new Promise(r => { editor.storage.clear(); setTimeout(r, 150); });
    // save clean empty scene
    editor.isLoadingState = false;
    await new Promise(r => { editor.storage.set(editor.toJSON()); setTimeout(r, 200); });
  });
  console.log('cleared to empty scene');
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
