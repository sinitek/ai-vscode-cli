import test = require("node:test");
import assert = require("node:assert/strict");
import * as fs from "fs/promises";
import * as TOML from "@iarna/toml";
import { installVscodeMock } from "../vscodeMock";
import { withCodexIdentityFixture } from "../config/codexRuntimeConfigFixture";
import { createCodexRuntimeConfigHandoffFixture, waitForConfigHandoff as wait } from "./fixtures/codexruntimeconfighandofffixture";

installVscodeMock();

for (const release of ["thread/closed", "exit"] as const) {
  test(`real config → manager → public runner → pool handoff waits for ${release}`, { timeout: 15_000 }, async (context) => {
    await withCodexIdentityFixture(async (f) => {
      // Nonempty config and synthetic authentication: equivalent edits must preserve all meaning.
      await f.writeConfig('model="fixture-sub-model"\napproval_policy="never"\nsandbox_mode="workspace-write"\nfuture={b=2,a=["x","y"]}\n');
      await fs.writeFile(f.authPath, '{"token":"synthetic-before","nested":{"b":2,"a":1}}');
      const h = createCodexRuntimeConfigHandoffFixture(context, f.home, await fs.realpath(f.a));
      const fingerprint = () => f.fingerprint("codex", "fixture-profile", f.a);
      try {
        const initialFingerprint = await fingerprint();
        const initial = h.runner("same-ui-session", null, initialFingerprint);
        assert.match(await h.run(initial, "first actual turn"), /^result:config-thread-/);
        const thread = initial.getThreadId()!;
        const old = h.children[0];
        assert.equal(h.children.length, 1);

        const assertReuse = async (label: string) => {
          const currentFingerprint = await fingerprint();
          assert.equal(currentFingerprint, initialFingerprint, label);
          const current = h.runner("same-ui-session", thread, currentFingerprint);
          assert.equal(current, initial, label);
          assert.match(await h.run(current, label), new RegExp(`^result:${thread}:`));
          assert.equal(h.children.length, 1, label);
          assert.equal(h.wire.filter(({ message }) => message.method === "thread/resume").length, 0);
          assert.equal(h.wire.filter(({ message }) => message.method === "thread/unsubscribe").length, 0);
        };
        // Verify the first public turn persisted trust before calling the helper again.
        const ownTrust = TOML.parse(await fs.readFile(f.configPath, "utf8"));
        const realA = await fs.realpath(f.a);
        assert.equal((ownTrust.projects as Record<string, { trust_level: string }>)[realA].trust_level, "trusted");
        await f.trust(f.a);
        await assertReuse("current-project trust persisted");
        await f.trust(f.b);
        await assertReuse("neighbor-project trust persisted");
        const before = TOML.parse(await fs.readFile(f.configPath, "utf8"));
        const beforeAuth = JSON.parse(await fs.readFile(f.authPath, "utf8"));
        // Keep BOTH project trust sections when reordering and requoting the nonempty TOML.
        const projects = TOML.stringify({ projects: before.projects });
        await f.writeConfig(`# equivalent source\nfuture = { a = ['x', 'y'], b = 2 }\nsandbox_mode = 'workspace-write'\napproval_policy = 'never'\nmodel = 'fixture-sub-model'\n${projects}`);
        assert.deepEqual(TOML.parse(await fs.readFile(f.configPath, "utf8")), before);
        await fs.writeFile(f.authPath, '{\n "nested": {"a":1,"b":2}, "token": "synthetic-before"\n}');
        assert.deepEqual(JSON.parse(await fs.readFile(f.authPath, "utf8")), beforeAuth);
        await assertReuse("equivalent nonempty TOML and JSON");
        assert.deepEqual(await h.compact(initial), { compacted: true, threadId: thread });
        await assertReuse("next turn after public compactThread");
        assert.equal(h.events.filter((event) => event === `compact:${thread}:${old.pid}`).length, 1);

        const other = h.runner("other-ui-session", null, await fingerprint());
        await h.run(other, "other thread shares the old connection");
        const otherThread = other.getThreadId()!;
        assert.notEqual(otherThread, thread);
        assert.equal(h.children.length, 1);
        const peerWaiting = h.run(other, "ask: keep another thread waiting during target migration");
        await wait(() => h.questions.some((question) => question.threadId === otherThread && !!question.answer), "other thread awaits user");
        const peerQuestion = h.questions.find((question) => question.threadId === otherThread)!;

        const oldWaiting = h.run(initial, "ask: target question before replacement");
        await wait(() => h.questions.some((question) => question.threadId === thread && !!question.answer), "target awaits user");
        const replacedQuestion = h.questions.find((question) => question.threadId === thread)!;
        await fs.writeFile(f.authPath, '{"nested":{"a":1,"b":2},"token":"synthetic-after"}');
        const changedFingerprint = await fingerprint();
        assert.notEqual(changedFingerprint, initialFingerprint);
        const migrated = h.runner("same-ui-session", thread, changedFingerprint);
        assert.notEqual(migrated, initial);
        assert.equal(migrated.getThreadId(), thread);
        assert.ok(h.manager.hasCodexRunner("same-ui-session", migrated));
        await assert.rejects(oldWaiting);
        await wait(() => h.replies(replacedQuestion).length === 1, "replacement cancels only its own question");
        assert.deepEqual(h.replies(replacedQuestion), [{ answers: {} }]);
        assert.equal(h.replies(peerQuestion).length, 0, "manager replacement cannot cancel other thread question");
        let migrationSettled = false;
        const migration = h.run(migrated, "ask: successor operation after real identity change");
        void migration.then(() => { migrationSettled = true; }, () => { migrationSettled = true; });
        await wait(() => h.events.filter((event) => event === `unsubscribe-ack:${thread}`).length >= 2,
          "old reader processed ACK and pool queried again despite unanswered other thread");
        assert.equal(h.children.length, 2);
        const next = h.children[1];
        const resumed = () => h.wire.filter(({ child, message }) => child === next && message.method === "thread/resume");
        assert.equal(resumed().length, 0, "ACK plus zero unload delay cannot release writer");
        assert.equal(old.exitCode, null);
        assert.equal(old.terminationRequests, 0, "shared process cannot be killed for handoff");
        assert.equal(h.replies(peerQuestion).length, 0);
        assert.equal(migrationSettled, false);

        if (release === "thread/closed") {
          h.closeThread(old, thread);
        } else {
          // Answer the other thread before deliberately terminating its now-unretained fixture process.
          h.answer(peerQuestion, "peer still valid");
          assert.match(await peerWaiting, new RegExp(`^result:${otherThread}:`));
          other.dispose();
          await wait(() => old.terminationRequests > 0, "last old retainer requests termination");
          const checkpoint = h.pollingSteps();
          await wait(() => h.pollingSteps() > checkpoint + 1, "pool rechecks logical shutdown while process stays live");
          assert.equal(old.exitCode, null);
          assert.equal(resumed().length, 0, "logical close and successful fake kill cannot release writer");
          old.exit();
        }
        await wait(() => h.questions.some((question) => question.child === next && !!question.answer), "same thread resumed and successor asks user");
        assert.equal(resumed().length, 1);
        assert.equal(resumed()[0].message.params?.threadId, thread);
        assert.equal(resumed()[0].message.params?.cwd, realA);
        assert.equal(resumed()[0].message.params?.sandbox, "workspace-write");
        const releaseEvent = release === "thread/closed" ? `closed:${thread}` : `exit:${old.pid}`;
        assert.ok(h.events.indexOf(releaseEvent) < h.events.indexOf(`thread/resume:${thread}:${next.pid}`));
        assert.equal(h.replies(peerQuestion).length, release === "thread/closed" ? 0 : 1);
        const successorQuestion = h.questions.find((question) => question.child === next)!;
        h.answer(replacedQuestion, "late replaced answer");
        await new Promise<void>((resolve) => setImmediate(resolve));
        assert.deepEqual(h.replies(replacedQuestion), [{ answers: {} }]);
        assert.equal(h.replies(successorQuestion).length, 0);
        assert.equal(migrationSettled, false, "late replaced answer cannot finish successor");
        h.answer(successorQuestion, "successor answer");
        assert.match(await migration, new RegExp(`^result:${thread}:`));
        assert.deepEqual(h.replies(successorQuestion), [{ answers: { choice: { answers: ["successor answer"] } } }]);
        if (release === "thread/closed") {
          h.answer(peerQuestion, "peer still valid");
          assert.match(await peerWaiting, new RegExp(`^result:${otherThread}:`));
          await h.run(other, "other thread continues after answering");
          assert.equal(old.terminationRequests, 0);
        }

        // Hot stop as well as manager replacement, under the same real identity chain.
        const stopped = h.run(migrated, "ask: stop this operation");
        await wait(() => h.questions.length === 4 && !!h.questions[3].answer, "stoppable question");
        const stoppedQuestion = h.questions[3];
        migrated.stopAndRebuild();
        await assert.rejects(stopped, /Codex run aborted/);
        await wait(() => h.replies(stoppedQuestion).length === 1, "stop cancels its inbound question");
        assert.deepEqual(h.replies(stoppedQuestion), [{ answers: {} }]);
        const current = h.runner("same-ui-session", thread, await fingerprint());
        assert.equal(current, migrated);
        const restarted = h.run(current, "ask: next operation after stop");
        await wait(() => h.questions.length === 5 && !!h.questions[4].answer, "restarted question");
        const restartedQuestion = h.questions[4];
        h.answer(stoppedQuestion, "late stopped answer");
        await new Promise<void>((resolve) => setImmediate(resolve));
        assert.deepEqual(h.replies(stoppedQuestion), [{ answers: {} }]);
        assert.equal(h.replies(restartedQuestion).length, 0);
        h.answer(restartedQuestion, "current answer");
        assert.match(await restarted, new RegExp(`^result:${thread}:`));
        assert.deepEqual(h.replies(restartedQuestion), [{ answers: { choice: { answers: ["current answer"] } } }]);
        assert.equal(h.children.length, 2);
        assert.equal(h.wire.filter(({ message }) => message.method === "thread/start").length, 2,
          "only target and independent thread were created; migration never changes native thread");
        assert.equal(h.wire.filter(({ message }) => message.method === "thread/resume").length, 1);
        assert.equal(h.wire.filter(({ message }) => message.method === "turn/interrupt").length, 1);
        context.diagnostic(`release=${release}; ${h.events.join(" -> ")}`);
      } finally {
        await h.cleanup();
      }
    });
  });
}
