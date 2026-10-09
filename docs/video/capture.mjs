import { chromium } from 'playwright'
const W = 1920, H = 1080, OUT = '/tmp/media/shots'
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'] })
const page = await browser.newPage({ viewport: { width: W, height: H } })
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a)
const errors = []
page.on('pageerror', (e) => errors.push(e.message.slice(0, 150)))
const API = 'http://127.0.0.1:8000/api/v1'
const login = async (u) => (await (await fetch(API + '/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: u, password: u + '123' }) })).json()).token
const call = async (t, path, method = 'GET', body) => (await fetch(API + path, { method, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + t }, body: body ? JSON.stringify(body) : undefined })).json()
const dom = (fn, arg) => page.evaluate(fn, arg)
const wait = (ms) => page.waitForTimeout(ms)
const shot = async (name) => { await page.mouse.move(W - 5, H - 5); await wait(400); await page.screenshot({ path: `${OUT}/${name}.png`, timeout: 90000 }).catch((e) => errors.push('shot ' + name)); log('shot', name) }
const dismiss = () => dom(() => document.querySelectorAll('button[aria-label=Dismiss]').forEach((b) => b.click()))
const nav = async (l) => { await dom((l) => [...document.querySelectorAll('header button')].find((b) => b.textContent.trim().startsWith(l))?.click(), l); await wait(2500) }
const more = async (l) => {
  // Radix menus open on pointerdown
  await dom(() => [...document.querySelectorAll('body header:first-of-type button')].find((x) => /^(More|What-if|Settlement|Administration)/.test(x.textContent.trim()))?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerType: 'mouse' })))
  await wait(500); await page.locator('[role=menuitem]', { hasText: l }).first().click({ force: true, timeout: 8000 }); await wait(2500)
}
const clickText = (scope, re) => dom(([s, r]) => { const b = [...document.querySelectorAll(s)].find((x) => new RegExp(r).test(x.textContent)); b?.click(); return !!b }, [scope, re])
const admin = await login('admin'), sic = await login('sic')

// ---- phase A: a DR event from detection to settlement
await page.goto('http://127.0.0.1:5173/#/login', { waitUntil: 'networkidle' })
await wait(1500)
await shot('01-login')
await page.fill('#u', 'admin'); await page.fill('#p', 'admin123')
await page.click('button[type=submit]')
await page.waitForSelector('main', { timeout: 20000 })
await wait(9000)
await dismiss()
await shot('02-overview-calm')
await call(admin, '/admin/simulator/disturbances', 'POST', { kind: 'demand_surge', params: { mw: 750, region: 'BENGALURU' }, duration_min: 45, ramp_min: 3, label: 'Bengaluru evening surge' })
let d
for (let i = 0; i < 40; i++) { d = (await call(admin, '/decisions?limit=5')).items?.[0]; if (d?.state === 'AWAITING_APPROVAL') break; await wait(2000) }
log('decision', d?.id, d?.state)
await wait(6000)
await shot('03-overview-event')
await dismiss()
await clickText('main [role=button]', 'Overload|High loading') || (await dom(() => [...document.querySelectorAll('main [role=button]')].find((b) => b.querySelector('.lucide-map-pin'))?.click()))
await wait(3500)
await shot('04-fly-line')
await clickText('main button', 'Show on map')
await wait(4000)
await shot('05-event-map')
// approve (dual authorisation)
await call(admin, `/decisions/${d.id}/approve`, 'POST'); await call(sic, `/decisions/${d.id}/approve`, 'POST')
await wait(15000)
await dismiss()
await dom(() => document.querySelector('main button[aria-label="Close timeline"]') && null)
await shot('06-dispatch-live')
await nav('DR Events'); await wait(2000); await dismiss()
await shot('07-dr-events')
await nav('Programs'); await clickText('main button', 'Interruptible Load'); await wait(3500); await dismiss()
await shot('08-programs')
await nav('Forecast'); await wait(2000); await dismiss()
await shot('09-forecast')
// let the event run out and settle
for (let i = 0; i < 90; i++) { const x = (await call(admin, `/decisions/${d.id}`)); if (x.state === 'COMPLETED') break; await wait(3000) }
log('settled', (await call(admin, `/decisions/${d.id}`)).state)
await more('Settlement'); await clickText('main button', 'Audit chain'); await wait(1500); await dismiss()
await shot('10-settlement')
await clickText('main button', 'Replay'); await wait(4000)
await dom(() => { const m = [...document.querySelectorAll('main button[title]')].filter((x) => / · /.test(x.title)); m[Math.min(2, m.length - 1)]?.click() })
await wait(3500); await dismiss()
await shot('11-replay')

// ---- phase B: flexibility exhausted → load shedding
for (const r of await call(admin, '/resources')) if (r.type !== 'bess') await call(admin, `/resources/${r.id}`, 'PATCH', { out_of_service: true, reason: 'Drill: flexibility exhausted' })
await call(admin, '/admin/simulator/disturbances', 'POST', { kind: 'demand_surge', params: { mw: 1300, region: 'STATEWIDE' }, duration_min: 240, ramp_min: 2, label: 'Statewide heatwave peak' })
let s
for (let i = 0; i < 60; i++) { s = await call(admin, '/shedding'); if (s.orders?.some((o) => o.state === 'PROPOSED')) break; await wait(3000) }
log('shed order', s.orders?.[0]?.id, s.orders?.[0]?.state)
await nav('Load Shedding'); await wait(2500)
await shot('12-shed-proposed')
await clickText('main button', 'Approve shedding'); await wait(1500)
const o = (await call(admin, '/shedding')).orders.find((x) => x.state === 'PROPOSED')
if (o) await call(sic, `/shedding/orders/${o.id}/approve`, 'POST')
await wait(10000); await dismiss()
await shot('13-shed-active')
const g = (await call(admin, '/shedding')).groups.find((x) => x.state === 'SHED')
if (g) await dom((n) => [...document.querySelectorAll('main button[title]')].find((b) => b.title.startsWith(n))?.click(), g.name)
await wait(4000); await dismiss()
await shot('14-shed-card')
await nav('Grid'); await dom(() => [...document.querySelectorAll('main [role=tab]')].find((t) => /220 kV/.test(t.textContent))?.click()); await wait(3000); await dismiss()
await shot('15-grid-feeders')
await nav('Overview'); await wait(5000); await dismiss()
await shot('16-overview-shed')
await more('Administration'); await wait(1500); await dismiss()
await shot('17-admin')
console.log(JSON.stringify({ errors }))
await browser.close()
