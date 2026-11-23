import test = require("node:test");
import assert = require("node:assert/strict");
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawnSync } from "node:child_process";

test("department lifecycle diagnostics use existing rotation and history retention with debug off", (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "department-diagnostic-log-"));
  try {
    const script = `
      const fs = require('node:fs'), path = require('node:path');
      const logger = require(${JSON.stringify(require.resolve("../../logger"))});
      const {readToolSettings, updateToolSettings} = require(${JSON.stringify(require.resolve("../../toolSettings"))});
      const {departmentLifecycleDiagnostic: record, departmentCleanupErrorCode: errorCode, departmentCleanupReason: reason} = require(${JSON.stringify(require.resolve("../../extensionHost/departmentlifecyclediagnostics"))});
      (async () => {
        await logger.initLogger(); logger.setDebugLogging(false);
        const now = new Date(), day = [now.getFullYear(), String(now.getMonth()+1).padStart(2,'0'), String(now.getDate()).padStart(2,'0')].join('-');
        const dir = path.join(process.env.HOME, '.sinitek_cli', 'logs');
        fs.writeFileSync(path.join(dir, 'sinitek-cli.'+day+'.log'), Buffer.alloc(10*1024*1024, 32));
        await logger.logDebug('SYNTHETIC_SENSITIVE_DEBUG');
        const extra = { error: 'SYNTHETIC_SENSITIVE_ERROR', stack: 'SYNTHETIC_SENSITIVE_STACK', path: '/SYNTHETIC_SENSITIVE_PATH',
          session: 'SYNTHETIC_SENSITIVE_SESSION', body: 'SYNTHETIC_SENSITIVE_BODY', command: 'SYNTHETIC_SENSITIVE_COMMAND',
          tool: 'SYNTHETIC_SENSITIVE_TOOL', credential: 'SYNTHETIC_SENSITIVE_CREDENTIAL' };
        if (errorCode(new Error(extra.error)) || errorCode(new Error('department-synthetic-sensitive'))
          || errorCode({code:extra.error}) || errorCode({code:'EACCES'}) !== 'EACCES') throw Error('invalid error code projection');
        record('department-leader-cleanup', {...extra, rootTaskId:'msg_root', leaderTaskId:'msg_leader', generation:3,
          stage:'owner-receipts', result:'unconfirmed', reason:reason(new Error(extra.error)),
          errorCode:errorCode(new Error('department-producer-no-live-generation')), elapsedMs:9});
        record('department-root-stop-settled', {...extra, rootTaskId:'msg_root', stage:'root-stop', result:'unconfirmed',
          reason:'evidence-rejected', confirmed:0, unconfirmed:1, retained:1, elapsedMs:10});
        record('department-leader-capacity', {...extra, rootTaskId:'/SYNTHETIC_SENSITIVE_PATH', leaderTaskId:'x'.repeat(500), generation:Infinity,
          stage:'capacity-release', result:'retained', reason:'evidence-missing', errorCode:extra.path, retained:Infinity});
        record('department-root-recovery', {...extra, rootTaskId:'msg_root', stage:'recovery-verify', result:'unconfirmed',
          reason:'evidence-rejected', errorCode:'unverified-leader-session-or-plan'});
        record('department-leader-session-promotion', {...extra, rootTaskId:'msg_root', leaderTaskId:'msg_leader',
          stage:'binding-readback', result:'confirmed', reason:'none'});
        await logger.logEssential('diagnostic-test-flush');
        const rotatedName = 'sinitek-cli.'+day+'.1.log';
        const names = fs.readdirSync(dir); if (!names.includes(rotatedName)) throw Error('rotation missing');
        const lines = names.map(n=>fs.readFileSync(path.join(dir,n),'utf8')).join('');
        if(lines.includes('SYNTHETIC_SENSITIVE') || lines.includes('x'.repeat(129))) throw Error('sensitive marker escaped');
        const events = lines.split('\\n').filter(l=>l.includes(' | ')).map(l=>JSON.parse(l.split(' | ')[1]));
        if(events.length!==5 || events[0].reason!=='unexpected-failure' || events[0].errorCode!=='department-producer-no-live-generation'
          || events[1].retained!==1 || events[2].rootTaskId!=='invalid-id' || events[2].generation!==0 || events[2].errorCode
          || events[3].errorCode!=='unverified-leader-session-or-plan' || events[4].stage!=='binding-readback')
          throw Error('invalid bounded event');
        const rotated = path.join(dir, rotatedName), previous = path.join(dir, 'sinitek-cli.2000-01-01.log');
        fs.copyFileSync(path.join(dir, 'sinitek-cli.'+day+'.log'), previous);
        const old = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
        fs.utimesSync(rotated, old, old);
        fs.utimesSync(previous, old, old);
        updateToolSettings({historyRetentionDays:3});
        await logger.scheduleLogRetentionCleanup();
        if (!fs.existsSync(rotated) || !fs.existsSync(previous)) throw Error('logs inside retention window removed');
        if (readToolSettings().historyRetentionDays !== 3) throw Error('initial setting was not cached');
        const settingsFile = path.join(dir, '..', 'settings.json');
        const current = path.join(dir, 'sinitek-cli.'+day+'.log');
        const veryOld = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000);
        fs.utimesSync(previous, veryOld, veryOld);
        fs.writeFileSync(settingsFile, 'SYNTHETIC_SENSITIVE_INVALID_SETTINGS');
        await logger.scheduleLogRetentionCleanup();
        const failure = fs.readFileSync(rotated, 'utf8');
        if (!fs.existsSync(previous) || !failure.includes('invalid-settings') || failure.includes('SYNTHETIC_SENSITIVE'))
          throw Error('invalid settings were not handled safely');
        fs.utimesSync(rotated, old, old);
        fs.writeFileSync(settingsFile, JSON.stringify({historyRetentionDays:1}));
        await logger.scheduleLogRetentionCleanup();
        if (fs.existsSync(rotated) || fs.existsSync(previous) || !fs.existsSync(current))
          throw Error('log retention did not follow the new setting');
        console.log(JSON.stringify(events.slice(0,2)));
      })().catch((error)=>{console.error(error);process.exitCode=1});
    `;
    const env: NodeJS.ProcessEnv = { ...process.env, HOME: home, USERPROFILE: home }; delete env.NODE_TEST_CONTEXT;
    const result = spawnSync(process.execPath, ["-e", script], { env, encoding: "utf8", timeout: 15000 });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    t.diagnostic(result.stdout.trim());
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});
