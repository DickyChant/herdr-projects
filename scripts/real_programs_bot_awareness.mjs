// Browser checks for Home's DSH awareness, against fictional HTTP fixtures only; never a live board or Bot.
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { readFileSync, mkdirSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { pathToFileURL } from 'node:url'
const module = process.env.PLAYWRIGHT_MODULE
if (!module) throw new Error('Set PLAYWRIGHT_MODULE to an installed playwright or playwright-core index.mjs')
const { chromium } = await import(pathToFileURL(module).href)
const assets = resolve(import.meta.dirname, '../crates/web/src/webui/page')
const requests = [], failures = []
let mode = 'online'
const fixture = () => ({ version: 1, machineId: 'local', runtimeId: 'runtime-a', state: mode === 'offline' ? 'offline' : 'online', observedAt: Date.now(), bots: [
  { id: 'chief', name: 'Chief', role: 'Chief of Staff', status: 'attention' },
  { id: 'writer', name: 'Writer', role: 'Documentation', status: 'working' },
  { id: 'other', name: 'Chief', role: '<img src=x onerror=alert(1)>', status: 'waiting' },
] })
const machines = [{ id: 'local', kind: 'local', name: 'Fixture PC', state: 'connected', snapshot: { panes: [{ pane_id: 'w1:p1', workspace_id: 'w1', agent: 'codex', agent_status: 'working' }, { pane_id: 'w1:p9', workspace_id: 'w1', agent: 'dsh-web', agent_status: 'done' }] } }]
const server = createServer((req, res) => {
  const path = new URL(req.url, 'http://fixture').pathname
  requests.push([req.method, path])
  const json = value => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(value)) }
  if (path === '/api/bots') {
    if (mode === 'denied') { res.statusCode = 403; return json({ error: 'fixture refusal' }) }
    if (mode === 'failed') { res.statusCode = 503; return json({ error: 'fixture failure' }) }
    return json(fixture())
  }
  if (path === '/api/machines') return json({ machines })
  if (path === '/herdr-projects/api/boards') return json({ ok: true, boards: [], groups: [] })
  if (path === '/herdr-projects/api/board') return json({ ok: true, list: { groups: [] } })
  if (path.startsWith('/assets/')) {
    const name = path.slice('/assets/'.length)
    if (!/^[a-z-]+\.(js|css)$/.test(name)) { res.statusCode = 404; return res.end() }
    try { res.setHeader('content-type', name.endsWith('js') ? 'text/javascript' : 'text/css'); return res.end(readFileSync(join(assets, name))) } catch { res.statusCode = 404; return res.end() }
  }
  res.setHeader('content-type', 'text/html')
  res.end('<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1"><title>Fictional Bot awareness test</title><link rel="stylesheet" href="/assets/board.css"><link rel="stylesheet" href="/assets/home.css"><body style="background:#171717;color:#eee;font-family:system-ui"><script type="module">import {openHome} from "/assets/home.js"; openHome({onClose:()=>{}});</script>')
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const base = `http://127.0.0.1:${server.address().port}`
const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}) })
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
page.on('pageerror', error => failures.push(error.message))
const card = title => page.locator('.sw-hcard').filter({ has: page.locator('h3', { hasText: title }) })
const node = id => page.locator(`[data-node-id="${id}"]`)
try {
  await page.goto(base)
  await node('b:local:runtime-a:writer').waitFor()
  assert.equal(await page.locator('.sw-tn.is-bot').count(), 3)
  assert.equal(await page.locator('.sw-tn.is-runtime').count(), 1)
  assert.equal(await page.locator('.sw-tn.is-agent').count(), 1, 'service wrapper is not an extra worker')
  assert.equal(await card('Needs you').locator('.sw-hitem').count(), 2)
  assert.equal(await card('DSH Bots').locator('img').count(), 0, 'Bot text must be rendered as text')
  assert.match(await card('DSH Bots').innerText(), /<img src=x/)
  const parsed = await page.evaluate(async () => {
    const { roster, botId, botPath } = await import('/assets/bots.js')
    const now = Date.now(), d = { version: 1, machineId: 'local', runtimeId: 'r:1', state: 'online', observedAt: now, bots: [{ id: 'a&b', name: 'Same', role: '', status: 'attention' }] }
    const one = roster(d, now)
    return { id: botId(one, one.bots[0]), path: botPath(one, one.bots[0]), duplicate: roster({ ...d, bots: [...d.bots, ...d.bots] }, now), stale: roster(d, now + 20000), foreign: roster({ ...d, machineId: 'remote' }, now) }
  })
  assert.equal(parsed.id, 'b:local:r%3A1:a%26b')
  assert.equal(parsed.path, '/dsh?runtime=r%3A1&bot=a%26b')
  assert.equal(parsed.duplicate, null)
  assert.equal(parsed.foreign, null)
  assert.equal(parsed.stale.bots[0].status, 'unknown')
  const before = await node('b:local:runtime-a:writer').getAttribute('transform')
  const machine = await node('m:local').boundingBox()
  await page.mouse.move(machine.x + machine.width / 2, machine.y + machine.height / 2)
  await page.mouse.down(); await page.mouse.move(machine.x + machine.width / 2 + 50, machine.y + machine.height / 2 + 35, { steps: 8 }); await page.mouse.up()
  assert.notEqual(await node('b:local:runtime-a:writer').getAttribute('transform'), before, 'Bot follows machine drag')
  assert.equal(new URL(page.url()).pathname, '/', 'drag must not navigate')
  await page.getByRole('button', { name: 'Reset layout' }).click()
  assert.equal(await node('b:local:runtime-a:writer').getAttribute('transform'), before)
  const evidence = process.env.EVIDENCE_DIR || '/tmp/herdr-bot-awareness-evidence'
  mkdirSync(evidence, { recursive: true })
  await page.screenshot({ path: join(evidence, 'home-desktop.png'), fullPage: true })
  await node('b:local:runtime-a:writer').focus()
  await page.keyboard.press('Enter')
  await page.waitForURL('**/dsh?runtime=runtime-a&bot=writer')
  mode = 'offline'
  await page.goto(base)
  await page.getByText('Offline · last known Bots').waitFor()
  assert.equal(await card('Needs you').locator('.sw-hitem').count(), 0)
  assert.equal(await page.locator('.sw-tn.is-bot.is-live').count(), 0)
  assert.match(await card('DSH Bots').innerText(), /Unknown/)
  mode = 'failed'
  await page.getByText('Unavailable · last known Bots').waitFor({ timeout: 12000 })
  assert.equal(await page.locator('.sw-tn.is-bot').count(), 3)
  const drag = await node('m:local').boundingBox()
  await page.mouse.move(drag.x + drag.width / 2, drag.y + drag.height / 2)
  await page.mouse.down(); await page.mouse.move(drag.x + drag.width / 2 + 15, drag.y + drag.height / 2 + 15)
  mode = 'denied'
  await page.waitForFunction(() => !document.querySelector('.sw-tn.is-bot'), { timeout: 12000 })
  assert.equal(await card('DSH Bots').count(), 0, 'revoked access clears the previous roster, even during a drag')
  await page.mouse.up()
  mode = 'online'
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(base)
  await node('b:local:runtime-a:chief').waitFor()
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
  await page.screenshot({ path: join(evidence, 'home-phone.png'), fullPage: true })
  await card('DSH Bots').scrollIntoViewIfNeeded()
  await page.screenshot({ path: join(evidence, 'home-phone-bots.png'), fullPage: true })
  assert.deepEqual(requests.filter(([method]) => method !== 'GET'), [], 'awareness sends no mutation requests')
  assert.deepEqual(failures, [])
  console.log('PASS: Bot roster, topology, safe text, freshness, duplicate identities, nested drag, native links, access revocation, phone layout, no writes')
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)) }
