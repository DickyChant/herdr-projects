// Browser checks for the human's Chief handoff controls using fictional data only.
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { readFileSync, mkdirSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { pathToFileURL } from 'node:url'
const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href)
const assets = resolve(import.meta.dirname, '../crates/web/src/webui/page')
const server = createServer((req, res) => {
  const path = new URL(req.url, 'http://fixture').pathname
  if (/^\/assets\/[a-z-]+\.(js|css)$/.test(path)) {
    res.setHeader('content-type', path.endsWith('.js') ? 'text/javascript' : 'text/css')
    return res.end(readFileSync(join(assets, path.slice(8))))
  }
  res.setHeader('content-type', 'text/html')
  res.end(`<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/assets/board.css"><style>body{margin:0;background:#171717;color:#eee;font:15px system-ui}.sw-board{position:static;display:block;width:auto;padding:24px;max-width:640px}.btn{padding:8px}#root{min-width:0}</style><body><main class="sw-board"><div id="root"></div></main><script type="module">import {handoffEl} from '/assets/handoff.js';window.calls=[];window.draw=(record=null,role='drive')=>{document.querySelector('#root').replaceChildren(handoffEl({role,panel:{id:'fixture/1',handoffLocal:true,handoff:record}},(...args)=>calls.push(args)))};draw();</script>`)
})
await new Promise(r => server.listen(0, '127.0.0.1', r))
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH })
const page = await browser.newPage({ viewport: { width: 1000, height: 800 } })
const errors = []; page.on('pageerror', e => errors.push(e.message))
try {
  await page.goto(`http://127.0.0.1:${server.address().port}`)
  await page.getByLabel('Scope', { exact: true }).fill('Review the search design')
  await page.getByRole('button', { name: 'Prepare draft' }).click()
  assert.deepEqual(await page.evaluate(() => calls), [['fixture/1', 'draft', { scope: 'Review the search design', end: 'report_once' }]])
  await page.evaluate(() => draw())
  assert.equal(await page.getByLabel('Scope', { exact: true }).inputValue(), 'Review the search design')
  const draft = { id: 'handoff-fixture-001', state: 'draft', target: 'Chief', origin: 'boss', scope: 'Review the search design', end: 'report_once', path: '/dsh?runtime=fixture&bot=chief' }
  await page.evaluate(r => draw(r), draft)
  assert.match(await page.locator('#root').innerText(), /Boss on your behalf/)
  await page.getByRole('button', { name: 'Send this handoff to Chief' }).click()
  assert.deepEqual(await page.evaluate(() => calls.at(-1)), ['fixture/1', 'send', { handoffId: draft.id }])
  await page.evaluate(r => draw(r, 'watch'), draft)
  assert.equal(await page.getByRole('button', { name: 'Send this handoff to Chief' }).isDisabled(), true)
  await page.evaluate(r => draw({ ...r, state: 'reported', report: { text: '<img src=x onerror=alert(1)>\nA report, never a command.' } }), draft)
  assert.equal(await page.locator('#root img').count(), 0)
  assert.match(await page.locator('#root').innerText(), /Information only/)
  const evidence = '/tmp/chief-ui-evidence'; mkdirSync(evidence, { recursive: true })
  await page.screenshot({ path: join(evidence, 'handoff-report.png'), fullPage: true })
  await page.setViewportSize({ width: 390, height: 844 }); await page.evaluate(() => draw())
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
  await page.screenshot({ path: join(evidence, 'handoff-mobile.png'), fullPage: true })
  assert.deepEqual(errors, [])
  console.log('Chief handoff browser controls passed (fictional fixture).')
} finally { await browser.close(); await new Promise(r => server.close(r)) }
