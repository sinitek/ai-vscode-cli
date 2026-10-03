import test = require("node:test");
import assert = require("node:assert/strict");
import {
  createPanelMessageRouter,
  mergePanelMessageHandlerRegistries,
} from "../../sessionMessageRouter";

test("dispatches a typed message to its registered command handler", async () => {
  const received: string[] = [];
  const router = createPanelMessageRouter({
    selectCli: (message) => {
      received.push(message.cli);
    },
  });

  const handled = await router.dispatch({ type: "selectCli", cli: "claude" });

  assert.equal(handled, true);
  assert.deepEqual(received, ["claude"]);
});

test("returns false for an unregistered message without invoking a handler", async () => {
  const router = createPanelMessageRouter({
    selectCli: () => {
      throw new Error("unexpected handler call");
    },
  });

  const handled = await router.dispatch({ type: "requestState" });

  assert.equal(handled, false);
});

test("merges domain registries with later handlers taking precedence", async () => {
  const received: string[] = [];
  const router = createPanelMessageRouter(
    mergePanelMessageHandlerRegistries(
      {
        selectCli: () => {
          received.push("session");
        },
      },
      {
        selectCli: () => {
          received.push("override");
        },
      }
    )
  );

  await router.dispatch({ type: "selectCli", cli: "codex" });

  assert.deepEqual(received, ["override"]);
});
