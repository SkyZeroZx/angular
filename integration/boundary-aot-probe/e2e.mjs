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
  await new Promise((resolve) => setTimeout(resolve, 75));
}

async function readProbe() {
  return page.evaluate(() => structuredClone(window.__boundaryProbe));
}

const evidence = {
  url: `http://127.0.0.1:${port}/`,
  browser: null,
  angularVersion: null,
  stages: [],
  assertions: {},
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
  evidence.stages.push({label: 'initial', probe: await readProbe()});

  await clickAndSettle('#trigger-update-error');
  await page.waitForSelector('#update-fallback');
  evidence.stages.push({label: 'after-update-error', probe: await readProbe()});

  for (let i = 1; i <= 3; i++) {
    await clickAndSettle('#retry-leak');
    await page.waitForSelector('#leak-fallback');
    await clickAndSettle('#record-state');
    evidence.stages.push({label: `after-failed-retry-${i}`, probe: await readProbe()});
  }

  await clickAndSettle('#allow-success');
  await clickAndSettle('#retry-leak');
  await page.waitForSelector('#leak-primary');
  await clickAndSettle('#record-state');
  evidence.stages.push({label: 'after-successful-retry', probe: await readProbe()});

  await clickAndSettle('#emit-bus');
  evidence.stages.push({label: 'after-one-bus-event', probe: await readProbe()});

  await clickAndSettle('#tick-effects');
  await new Promise((resolve) => setTimeout(resolve, 100));
  evidence.stages.push({label: 'after-signal-tick', probe: await readProbe()});

  const finalProbe = await readProbe();
  evidence.angularVersion = finalProbe.angularVersion;
  const initial = evidence.stages.find((s) => s.label === 'initial').probe;
  const successful = evidence.stages.find((s) => s.label === 'after-successful-retry').probe;
  const afterBus = evidence.stages.find((s) => s.label === 'after-one-bus-event').probe;

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
      initial.leak.snapshots.at(-1)?.state.created === 1 &&
      initial.leak.snapshots.at(-1)?.state.destroyRefCallbacks === 0 &&
      initial.leak.snapshots.at(-1)?.state.ngOnDestroyCalls === 0,
    retriesAccumulateUndestroyedLiveWidgets:
      successful.leak.snapshots.at(-1)?.state.created === 5 &&
      successful.leak.snapshots.at(-1)?.state.destroyRefCallbacks === 0 &&
      successful.leak.snapshots.at(-1)?.state.ngOnDestroyCalls === 0,
    oneBusEventReachedEveryLeakedSubscriber:
      afterBus.leak.snapshots.at(-1)?.state.busHits === 5,
  };

  evidence.pass = Object.values(evidence.assertions).every(Boolean);
  evidence.dom = await page.evaluate(() => document.body.innerText);
} finally {
  await writeFile(new URL('./evidence.json', import.meta.url), JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify(evidence, null, 2));
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}

if (!evidence.pass) {
  process.exitCode = 2;
}
