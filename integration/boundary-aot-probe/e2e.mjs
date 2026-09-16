import {createServer} from 'node:http';
import {readFile, writeFile} from 'node:fs/promises';
import {extname} from 'node:path';
import process from 'node:process';
import puppeteer from 'puppeteer';

const root = new URL('./dist/browser/', import.meta.url);
const server = createServer(async (req, res) => {
  try {
    const pathname = req.url === '/' ? 'index.html' : req.url.slice(1).split('?')[0];
    const file = new URL(pathname, root);
    const data = await readFile(file);
    const type = extname(pathname) === '.js' ? 'text/javascript' : 'text/html';
    res.writeHead(200, {'content-type': type});
    res.end(data);
  } catch (e) {
    res.writeHead(404);
    res.end(String(e));
  }
});

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const {port} = server.address();
const browser = await puppeteer.launch({headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage']});
const page = await browser.newPage();
const consoleLog = [];
const pageErrors = [];
page.on('console', (msg) => consoleLog.push(`${msg.type()}: ${msg.text()}`));
page.on('pageerror', (err) => pageErrors.push(String(err)));

async function clickAndSettle(selector) {
  await page.waitForSelector(selector, {timeout: 10000});
  await page.click(selector);
  await new Promise((resolve) => setTimeout(resolve, 100));
}

async function readProbe() {
  return page.evaluate(() => structuredClone(window.__boundaryProbe));
}

async function stage(label) {
  evidence.stages.push({label, probe: await readProbe()});
}

const evidence = {
  url: `http://127.0.0.1:${port}/`,
  browser: null,
  angularVersion: null,
  stages: [],
  assertions: {},
  recovery: null,
  pageErrors,
  consoleLog,
};

try {
  await page.goto(evidence.url, {waitUntil: 'networkidle0', timeout: 30000});
  await page.waitForFunction(() => window.__boundaryProbe?.ready === true, {timeout: 15000});
  await page.waitForSelector('#create-fallback');
  await page.waitForSelector('#leak-fallback');
  evidence.browser = await browser.version();

  await clickAndSettle('#record-state');
  await stage('initial');

  await clickAndSettle('#trigger-update-error');
  await page.waitForSelector('#update-fallback');
  await stage('after-update-error');

  for (let i = 1; i <= 3; i++) {
    await clickAndSettle('#retry-leak');
    await page.waitForSelector('#leak-fallback');
    await clickAndSettle('#record-state');
    await stage(`after-failed-retry-${i}`);
  }

  // Prove that the abandoned instances are not merely retained bookkeeping: their RxJS
  // subscriptions are still live while only the @error fallback is visible.
  await clickAndSettle('#emit-bus');
  await stage('after-bus-while-fallback');

  // A normal component effect from an abandoned unattached view should not keep participating in
  // view traversal. Recording this distinguishes retained external subscriptions from CD traversal.
  await clickAndSettle('#tick-effects');
  await new Promise((resolve) => setTimeout(resolve, 150));
  await stage('after-signal-tick-while-fallback');

  // Separately check whether changing the failure condition and invoking $reset can recover.
  await clickAndSettle('#allow-success');
  await stage('after-allow-success');
  await clickAndSettle('#retry-leak');
  await new Promise((resolve) => setTimeout(resolve, 500));
  const primaryExists = Boolean(await page.$('#leak-primary'));
  const fallbackExists = Boolean(await page.$('#leak-fallback'));
  evidence.recovery = {primaryExists, fallbackExists};
  if (primaryExists) {
    await clickAndSettle('#record-state');
  }
  await stage('after-recovery-attempt');

  const finalProbe = await readProbe();
  evidence.angularVersion = finalProbe.angularVersion;
  const initial = evidence.stages.find((s) => s.label === 'initial').probe;
  const retry3 = evidence.stages.find((s) => s.label === 'after-failed-retry-3').probe;
  const afterBus = evidence.stages.find((s) => s.label === 'after-bus-while-fallback').probe;
  const afterTick = evidence.stages.find((s) => s.label === 'after-signal-tick-while-fallback').probe;

  const initialState = initial.leak.snapshots.at(-1)?.state;
  const retry3State = retry3.leak.snapshots.at(-1)?.state;
  const busState = afterBus.leak.snapshots.at(-1)?.state;
  const tickState = afterTick.leak.snapshots.at(-1)?.state;

  evidence.assertions = {
    publishedNext7Runtime: finalProbe.angularVersion === '22.2.0-next.7',
    createFallbackRendered: Boolean(await page.$('#create-fallback')),
    updateFallbackRendered: Boolean(await page.$('#update-fallback')),
    createPassReportedHostInsteadOfChild:
      finalProbe.metadata.createPass?.declarationType === 'MetadataCreateHost' &&
      finalProbe.metadata.createPass?.declarationInstanceType === 'MetadataCreateHost' &&
      finalProbe.metadata.createPass?.boundaryType === 'MetadataCreateHost',
    updatePassReportedFailingChild:
      finalProbe.metadata.updatePass?.declarationType === 'UpdateThrowChild' &&
      finalProbe.metadata.updatePass?.declarationInstanceType === 'UpdateThrowChild' &&
      finalProbe.metadata.updatePass?.boundaryType === 'MetadataUpdateHost',
    initialFailedViewNotDestroyed:
      initialState?.created === 1 &&
      initialState?.destroyRefCallbacks === 0 &&
      initialState?.ngOnDestroyCalls === 0,
    threeRetriesAccumulateFourUndestroyedWidgets:
      retry3State?.created === 4 &&
      retry3State?.destroyRefCallbacks === 0 &&
      retry3State?.ngOnDestroyCalls === 0 &&
      retry3State?.brokenAttempts === 4,
    oneBusEventReachedAllFourAbandonedSubscribers:
      busState?.busHits === 4,
    abandonedViewEffectsDoNotReenterNormalViewTraversal:
      tickState?.effectRuns === 0,
    recoveryAfterFailureConditionClears:
      primaryExists && !fallbackExists,
  };

  evidence.pass = Object.values(evidence.assertions).every(Boolean);
  evidence.dom = await page.evaluate(() => document.body.innerText);
} catch (error) {
  evidence.driverError = String(error?.stack ?? error);
} finally {
  await writeFile(new URL('./evidence.json', import.meta.url), JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify(evidence, null, 2));
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}

if (!evidence.pass) {
  process.exitCode = 2;
}
