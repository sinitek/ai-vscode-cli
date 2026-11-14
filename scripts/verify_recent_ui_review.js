/* Isolated browser evidence from the real builders. Requires a compiled package
 * root containing dist/, media/, and node_modules/; never touches shared dist. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { spawn, spawnSync } = require('node:child_process');
const { execFileSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');
const { setTimeout: delay } = require('node:timers/promises');

const root = path.resolve(process.argv[2] || '');
assert.ok(process.argv[2] && fs.existsSync(path.join(root, 'dist/webview/markdownAssets.js')), 'Pass the isolated package root');
const evidence = path.join(root, 'evidence');
fs.mkdirSync(evidence, { recursive: true });
const result = { packageRoot: root, checks: [], errors: [], screenshots: [], screenshotHtml: [] };
const record = (name, data) => { result.checks.push({ name, ...data }); console.log(name, JSON.stringify(data)); };
const load = name => require(path.join(root, 'dist', name));

async function main() {
  const assets = load('webview/markdownAssets.js');
  const marked = assets.getMarkedScript();
  assert.ok(marked.length > 1000, 'Packaged marked resource is present');
  const parser = vm.createContext({});
  vm.runInContext(marked, parser);
  assert.equal(vm.runInContext('typeof marked.parse', parser), 'function');
  assert.match(vm.runInContext('marked.parse("## Loaded parser")', parser), /<h2>/);
  assert.ok(assets.getJsonFormatterScript().length > 1000);
  record('packaged-resources', { markedBytes: marked.length, jsonFormatterBytes: assets.getJsonFormatterScript().length, parserHeading: true });
  if (!process.argv.includes('--skip-unit')) {
    const args = ['--test', '--test-name-pattern=^mounts ask bubbles through the shared group chat Markdown renderer$', path.join(root, 'dist/test/loop/loopGroupChatPanel.test.js')];
    const unit = spawnSync(process.execPath, args, { encoding: 'utf8', windowsHide: true });
    fs.writeFileSync(path.join(evidence, 'failed-case-rerun.txt'), unit.stdout + unit.stderr);
    record('previously-failing-case', { command: [process.execPath, ...args], exitCode: unit.status, output: unit.stdout + unit.stderr });
    assert.equal(unit.status, 0);
  }

  load('test/vscodeMock.js').installVscodeMock();
  const { buildLoopGroupChatPanelHtml } = load('webview/loopGroupChatPanel.js');
  const { getWebviewHtml } = load('webview/viewContent.js');
  const longChinese = '连续中文排队问题用来核对换行与气泡对应关系'.repeat(5);
  const longEnglish = 'UnbrokenEnglishQuestionToken'.repeat(9);
  const thread = { version: 1, running: true, queued: true, dialogOpen: true, updatedAt: 1,
    messages: [
      { id: 'old', role: 'user', content: '已处理的问题', createdAt: 1 },
      { id: 'answer', role: 'assistant', content: '## 已回答', createdAt: 1 },
      { id: 'q1', role: 'user', content: longChinese, queued: true, createdAt: 2 },
      { id: 'q2', role: 'user', content: longEnglish, queued: true, createdAt: 3 },
    ] };
  const state = { task: { id: 'isolated-ui-fixture', cli: 'codex', status: 'running', rootPrompt: '隔离浏览器验证',
    taskStoreFile: '', mainCommunicationFile: '', currentRound: 1, updatedAt: 1,
    canSupplement: true, canContinue: false, canStop: true }, rounds: [], chatMarkdown: '', mainModelBusy: true };
  const theme = `:root { --vscode-font-family: "Segoe UI", sans-serif; --vscode-font-size: 13px;
    --vscode-editor-background: #1e1e1e; --vscode-editorWidget-background: #252526;
    --vscode-editor-foreground: #d4d4d4; --vscode-foreground: #d4d4d4;
    --vscode-descriptionForeground: #a0a0a0; --vscode-widget-border: #454545;
    --vscode-input-border: #454545; --vscode-input-background: #313131; --vscode-input-foreground: #ccc;
    --vscode-button-secondaryBackground: #3a3d41; --vscode-button-secondaryHoverBackground: #45494e;
    --vscode-button-secondaryForeground: #fff; --vscode-button-background: #0078d4;
    --vscode-button-foreground: #fff; --vscode-icon-foreground: #ccc;
    --vscode-textLink-foreground: #4daafc; --vscode-textLink-activeForeground: #75beff;
    --vscode-focusBorder: #007fd4; --vscode-toolbar-hoverBackground: #45494e;
  }`;
  const fixtures = {};
  for (const [name, html] of [['queue', buildLoopGroupChatPanelHtml({ cspSource: "'self'" }, state, thread)], ['help', getWebviewHtml({ cspSource: "'self'" })]]) {
    // Only supply VS Code's host API and theme; retain the builder's DOM, CSP,
    // complete scripts, and all production CSS unchanged.
    fixtures[name] = path.join(evidence, name + '.html');
    fs.writeFileSync(fixtures[name], html.replace('</head>', `<style>${theme}</style></head>`));
  }
  record('fixtures', { builders: ['buildLoopGroupChatPanelHtml', 'getWebviewHtml'], files: fixtures });

  const browserPath = process.env.UI_REVIEW_BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
  assert.ok(fs.existsSync(browserPath), 'Set UI_REVIEW_BROWSER to a Chromium binary');
  const profile = path.join(root, 'browser-profile-' + require('node:crypto').randomUUID());
  const browserLog = fs.openSync(path.join(evidence, 'browser-stderr.txt'), 'w');
  const child = spawn(browserPath, ['--headless=new', '--edge-skip-compat-layer-relaunch', '--remote-debugging-port=0', `--user-data-dir=${profile}`,
    '--remote-allow-origins=*', '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--disable-background-networking', '--disable-gpu', 'about:blank'],
  { windowsHide: true, stdio: ['ignore', 'ignore', browserLog] });
  result.browserPid = child.pid;
  let cdp;
  try {
    const activePort = path.join(profile, 'DevToolsActivePort');
    for (let n = 0; !fs.existsSync(activePort); n++) { assert.ok(n < 150, 'Browser startup timeout'); await delay(100); }
    const [port] = fs.readFileSync(activePort, 'utf8').trim().split(/\r?\n/);
    const browserHttp = `http://127.0.0.1:${port}`;
    const version = await (await fetch(`${browserHttp}/json/version`)).json();
    cdp = { errors: [], connections: [], close: () => cdp.connections.forEach(ws => ws.close()) };
    record('browser-version', version);
    const pages = {};
    for (const name of ['queue', 'help']) {
      const target = await (await fetch(`${browserHttp}/json/new?about:blank`, { method: 'PUT' })).json();
      const ws = await connect(target.webSocketDebuggerUrl, error => cdp.errors.push({ page: name, ...error }));
      cdp.connections.push(ws);
      const call = (method, params = {}) => ws.call(method, params);
      const evaluate = async expression => {
        const r = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
        assert.ok(!r.exceptionDetails, JSON.stringify(r.exceptionDetails));
        return r.result.value;
      };
      await call('Runtime.enable'); await call('Log.enable'); await call('Network.enable'); await call('Page.enable');
      await call('Page.addScriptToEvaluateOnNewDocument', { source: `window.__hostMessages=[]; window.acquireVsCodeApi=()=>({getState:()=>({}),setState:()=>{},postMessage:m=>window.__hostMessages.push(m)});` });
      await call('Page.navigate', { url: pathToFileURL(fixtures[name]).href });
      for (let n = 0; !(await evaluate('document.readyState === "complete"')); n++) { assert.ok(n < 100); await delay(50); }
      assert.equal(await evaluate('typeof marked.parse'), 'function');
      await evaluate("Object.defineProperty(document,'visibilityState',{configurable:true,value:'visible'});document.dispatchEvent(new Event('visibilitychange'))");
      pages[name] = { call, evaluate, targetId: target.id, fixture: fixtures[name] };
    }
    const screenshot = async (page, name) => {
      const width = page.width || 800;
      const file = path.join(evidence, name + '.png');
      const htmlFile = path.join(evidence, name + '.html');
      // Capture the same live CDP target we measured, including its open dialog,
      // viewport, scroll position, message updates, and emulated media settings.
      await page.call('Page.bringToFront');
      fs.writeFileSync(htmlFile, await page.evaluate('document.documentElement.outerHTML'));
      const shot = await page.call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
      fs.writeFileSync(file, Buffer.from(shot.data, 'base64'));
      assert.ok(fs.statSync(file).size > 1000);
      result.screenshots.push(file); result.screenshotHtml.push(htmlFile);
      record(`screenshot-${name}`, { width, bytes: fs.statSync(file).size, targetId: page.targetId });
    };
    const viewport = async (page, width) => {
      await page.call('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1, mobile: false });
      await delay(100);
    };
    const queue = pages.queue;
    await queue.evaluate('showAskDialog(); renderAskThread();');
    if (!process.argv.includes('--skip-covered-queue')) {
    for (const width of [240, 320, 800]) {
      await viewport(queue, width); queue.width = width;
      const measurement = await queue.evaluate(`(() => {
        const rect = e => { const r=e.getBoundingClientRect(); return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height}; };
        const log=document.getElementById('askChatMessages');
        return { width:innerWidth, documentOverflow:document.documentElement.scrollWidth-innerWidth,
          logOverflow:log.scrollWidth-log.clientWidth,
          dialog:rect(document.querySelector('.ask-chat-dialog')),
          composer:rect(document.querySelector('.ask-chat-composer')),
          log:rect(log), queued:[...document.querySelectorAll('.ask-chat-queued')].map(e=>({
            label:rect(e),bubble:rect(e.previousElementSibling),article:rect(e.parentElement),
            textOverflow:e.lastElementChild.scrollWidth-e.lastElementChild.clientWidth,
            color:getComputedStyle(e).color, gap:e.getBoundingClientRect().top-e.previousElementSibling.getBoundingClientRect().bottom })),
          indicatorsOnlyOnQueuedUsers:[...log.querySelectorAll('article')].map(e=>({role:e.className,queued:!!e.querySelector('.ask-chat-queued')})) };
      })()`);
      record(`queue-layout-${width}`, measurement);
      assert.ok(measurement.documentOverflow <= 1 && measurement.logOverflow <= 1);
      assert.ok(measurement.log.bottom <= measurement.composer.top + 1);
      assert.equal(measurement.queued.length, 2);
      for (const item of measurement.queued) {
        assert.ok(Math.abs(item.bubble.right - item.label.right) < 1);
        assert.equal(item.gap, 6);
        assert.ok(item.textOverflow <= 1);
        assert.equal(item.color, 'rgb(160, 160, 160)');
        assert.ok(item.label.left >= measurement.log.left && item.label.right <= measurement.log.right);
      }
      assert.deepEqual(measurement.indicatorsOnlyOnQueuedUsers.map(x => x.queued), [false, false, true, true]);
      await screenshot(queue, `queue-${width}`);
    }

    const animationSample = () => queue.evaluate(`(() => {const e=document.querySelector('.ask-chat-queued .typing-dots span'); const a=e.getAnimations()[0];return {visibility:document.visibilityState,display:getComputedStyle(document.getElementById('askChatBackdrop')).display,playState:getComputedStyle(e).animationPlayState,animationName:getComputedStyle(e).animationName,time:a&&a.currentTime,opacity:getComputedStyle(e).opacity,transform:getComputedStyle(e).transform};})()`);
    await queue.call('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
    const movingA = await animationSample(); await delay(180); const movingB = await animationSample();
    record('queue-visible-animation', { before: movingA, after: movingB });
    assert.equal(movingA.playState, 'running'); assert.ok(movingB.time > movingA.time + 50);
    await queue.evaluate('closeAskDialog()'); await delay(100);
    const closedA = await animationSample(); await delay(150); const closedB = await animationSample();
    record('queue-closed-animation', { before: closedA, after: closedB });
    assert.equal(closedB.playState, 'paused'); assert.equal(closedB.display, 'none');
    await queue.evaluate('openAskDialog()'); await delay(100);
    await queue.evaluate("Object.defineProperty(document,'visibilityState',{configurable:true,value:'hidden'});document.dispatchEvent(new Event('visibilitychange'))"); await delay(180);
    const hiddenA = await animationSample(); await delay(180); const hiddenB = await animationSample();
    record('queue-hidden-animation', { before: hiddenA, after: hiddenB });
    assert.equal(hiddenB.visibility, 'hidden'); assert.equal(hiddenB.playState, 'paused');
    assert.ok(Math.abs(hiddenB.time-hiddenA.time) < 1);
    await queue.evaluate("Object.defineProperty(document,'visibilityState',{configurable:true,value:'visible'});document.dispatchEvent(new Event('visibilitychange'))"); await delay(100);
    const resumedA = await animationSample(); await delay(150); const resumedB = await animationSample();
    record('queue-resumed-animation', { before: resumedA, after: resumedB });
    assert.equal(resumedB.visibility, 'visible'); assert.ok(resumedB.time > resumedA.time + 50);
    await queue.call('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    const reduced = await animationSample(); record('queue-reduced-motion', reduced); assert.equal(reduced.animationName, 'none');
    } else {
      result.reusedQueueEvidence = path.join(evidence, 'queue-browser-measurements.json');
      assert.ok(fs.existsSync(result.reusedQueueEvidence));
      await viewport(queue, 800); queue.width = 800;
    }
    if (!process.argv.includes('--skip-covered-started')) {
    await queue.evaluate(`window.dispatchEvent(new MessageEvent('message',{data:{type:'loopGroupChatChat:askThread',thread:${JSON.stringify({ ...thread, queued: false, messages: thread.messages.map(m => m.id === 'q1' ? { ...m, queued: false } : m) })}}}));`);
    const started = await queue.evaluate(`({count:document.querySelectorAll('.ask-chat-queued').length,content:document.querySelector('.ask-chat-queued').previousElementSibling.textContent,waiting:!!document.querySelector('.ask-chat-waiting')})`);
    record('queue-processing-started', started); assert.equal(started.count, 1); assert.equal(started.content.trim(), longEnglish); assert.equal(started.waiting, true);
    await screenshot(queue, 'queue-processing-started');
    }

    const help = pages.help;
    await help.evaluate("document.getElementById('helpButton').dispatchEvent(new MouseEvent('click',{bubbles:true}))");
    for (const width of [240, 320, 800]) {
      await viewport(help, width); help.width = width;
      const m = await help.evaluate(`(() => { const section=document.querySelector('.help-section'), table=section.querySelector('table'), modal=document.querySelector('.help-modal');
        const r=table.getBoundingClientRect(), mr=modal.getBoundingClientRect();return {width:innerWidth,documentOverflow:document.documentElement.scrollWidth-innerWidth,
        sectionOverflow:section.scrollWidth-section.clientWidth,table:{left:r.left,right:r.right,width:r.width},modal:{left:mr.left,right:mr.right,width:mr.width},
        firstColumn:table.querySelector('th').getBoundingClientRect().width,padding:getComputedStyle(table.querySelector('td')).padding,
        tableMargin:getComputedStyle(table).marginBottom,columns:table.rows[0].cells.length,rows:[...table.tBodies[0].rows].map(r=>[...r.cells].map(c=>c.textContent)),
        href:section.querySelector('a').href,linkText:section.querySelector('a').textContent,display:getComputedStyle(document.getElementById('helpOverlay')).display};})()`);
      record(`help-layout-${width}`, m);
      await screenshot(help, `help-${width}`);
      assert.ok(m.documentOverflow <= 1 && m.sectionOverflow <= 1);
      assert.equal(m.firstColumn, 100); assert.equal(m.padding, '12px'); assert.equal(m.tableMargin, '16px'); assert.equal(m.columns, 2);
      assert.deepEqual(m.rows, [
        ['Vibe', '直接执行目标 CLI 任务。'],
        ['Loop', '主模型作为项目经理分发任务，调度多个子模型共同完成任务。'],
        ['Loop+（主推）', '主模型除分发任务外，还作为组长进行功能验收；发现缺陷时，会再次发起整改。'],
      ]);
      assert.equal(m.href, 'https://www.yuque.com/hunjfang/ul749m/pkxei0ie9gc8bmim?singleDoc#');
      assert.equal(m.linkText, '《携宁 CLI 助手 - 教程》：点击进入详细教程');
      assert.notEqual(m.display, 'none');
      await help.evaluate(`window.__originalHelpCell=document.querySelector('.help-section tbody tr:last-child td:last-child').textContent; document.querySelector('.help-section tbody tr:last-child td:last-child').textContent=${JSON.stringify(longChinese + longEnglish)};`);
      const wrap = await help.evaluate(`(() => {const s=document.querySelector('.help-section'), c=s.querySelector('tbody tr:last-child td:last-child');return {sectionOverflow:s.scrollWidth-s.clientWidth,cellOverflow:c.scrollWidth-c.clientWidth,cellHeight:c.getBoundingClientRect().height};})()`);
      record(`help-long-text-${width}`, wrap); assert.ok(wrap.sectionOverflow <= 1 && wrap.cellOverflow <= 1);
      await screenshot(help, `help-long-text-${width}`);
      await help.evaluate("document.querySelector('.help-section tbody tr:last-child td:last-child').textContent=window.__originalHelpCell");
    }
    const hover = await help.evaluate(`(() => {const e=document.querySelector('.help-section a'); e.scrollIntoView();const r=e.getClientRects()[0];return {x:r.x+3,y:r.y+3,normal:getComputedStyle(e).color};})()`);
    await help.call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: hover.x, y: hover.y });
    const hovered = await help.evaluate("getComputedStyle(document.querySelector('.help-section a')).color");
    record('help-link-hover', { normal: hover.normal, hovered }); assert.equal(hovered, 'rgb(117, 190, 255)');
    await help.call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
    await help.call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
    await help.evaluate("document.querySelector('.help-section a').focus()");
    const focus = await help.evaluate(`(() => {const e=document.querySelector('.help-section a'),s=getComputedStyle(e);return {active:document.activeElement===e,focusVisible:e.matches(':focus-visible'),outlineStyle:s.outlineStyle,outlineWidth:s.outlineWidth,outlineColor:s.outlineColor};})()`);
    record('help-link-focus', focus); assert.ok(focus.active && focus.focusVisible); assert.equal(focus.outlineWidth, '1px'); assert.equal(focus.outlineStyle, 'solid');
    await screenshot(help, 'help-link-focus');
    result.errors = cdp.errors;
    assert.deepEqual(result.errors, [], 'No browser exceptions, console errors, or failed resources');
    result.status = 'passed';
  } finally {
    if (cdp) { result.errors = cdp.errors; cdp.close(); }
    try { execFileSync('taskkill', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore', windowsHide: true }); } catch {}
    for (let n=0; child.exitCode===null && n<40; n++) await delay(100);
    if (child.exitCode===null) child.kill();
    const profilePart = profile.replace(/'/g, "''");
    const cleanup = spawnSync('powershell.exe', ['-NoProfile', '-Command', `$p='${profilePart}'; Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'msedge.exe' -and $_.CommandLine.Contains($p) } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }; $remaining=@(Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'msedge.exe' -and $_.CommandLine.Contains($p) }); if ($remaining.Count) { exit 1 }`], { windowsHide: true });
    fs.closeSync(browserLog);
    result.browserCleanup = { pid: child.pid, exitCode: child.exitCode, killed: child.killed, profile, processSweepExitCode: cleanup.status };
  }
}

async function connect(url, onError) {
  const ws = new WebSocket(url);
  await new Promise((resolve,reject) => {ws.addEventListener('open',resolve,{once:true});ws.addEventListener('error',reject,{once:true});});
  let id = 0; const pending = new Map(); const errors = [];
  ws.addEventListener('message', event => {
    const msg=JSON.parse(event.data);
    if (msg.id) { const waiter=pending.get(msg.id); if(waiter){pending.delete(msg.id);clearTimeout(waiter.timer);msg.error?waiter.reject(new Error(JSON.stringify(msg.error))):waiter.resolve(msg.result);} }
    else if (msg.method==='Runtime.exceptionThrown' || (msg.method==='Log.entryAdded' && msg.params.entry.level==='error') || (msg.method==='Runtime.consoleAPICalled' && msg.params.type==='error') || msg.method==='Network.loadingFailed' || (msg.method==='Network.responseReceived' && msg.params.response.status>=400)) { errors.push(msg); onError(msg); }
  });
  return { errors, close:()=>ws.close(), call:(method,params={})=>new Promise((resolve,reject)=>{
    const callId=++id; const timer=setTimeout(()=>{pending.delete(callId);reject(new Error('CDP timeout: '+method));},60000);
    pending.set(callId,{resolve,reject,timer});ws.send(JSON.stringify({id:callId,method,params}));
  }) };
}
main().catch(error => {result.status='failed';result.failure=error.stack;console.error(error);process.exitCode=1;}).finally(()=>{
  fs.writeFileSync(path.join(evidence,'results.json'),JSON.stringify(result,null,2));console.log('Evidence:',evidence);
});
