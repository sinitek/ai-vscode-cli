# CLI Process Runtime

`src/cli/cliProcessRuntime.ts` contains the Node process execution core shared by the existing Extension Host facade and future trusted in-process callers. It does not import VS Code or `cli/config`. The facade remains responsible for reading the current CLI command and macOS task-shell setting, building CLI-specific arguments, and creating OpenCode runtime overlays.

The trusted launch input carries a resolved executable name, its complete argument vector, working directory, optional complete base environment, task environment overrides, optional process label and macOS shell snapshot, and an optional owned overlay cleanup capability. When `baseEnvironment` is supplied, it is the entire inherited environment: host keys omitted from it stay omitted. When it is absent, the runtime defaults to `process.env`. Merge order is base environment, task `envOverrides`, generated OpenCode overlay environment, then `cwd` setting `PWD`. The runtime creates a new environment object and does not mutate caller inputs. The Extension Host facade maps its existing `options.environment` to `baseEnvironment`.

```ts
const handle = runCliProcess({
  command: executable,
  args: finalArgs,
  cwd: executionDirectory,
  baseEnvironment: environmentSnapshot,
  envOverrides: taskOverrides,
  processLabel: "trusted-owner-run",
  macTaskShell: shellSnapshot,
}, handlers);
```

This is an internal trusted-code contract. It is not a public IPC surface and must not be wired to a caller that can supply arbitrary executable paths, arguments, prompts, environment data, or filesystem paths. Configuration bodies and credentials must not be persisted or logged.

The runtime retains command resolution, macOS login-shell fallback, argv0 and NVM handling, environment precedence, process-group termination on POSIX, and `taskkill` tree termination on Windows. A stream run closes stdin immediately. Lifecycle evidence is observed as soon as the child is created and only settles after the child's actual `close` and owned stdio close events; exit callbacks, errors, kill requests, and timeouts are not close evidence. Owned overlays are removed only after that observation confirms drained streams, and cleanup failures remain failures.

The production Owner launcher, first binding, complete resource cleanup, and organization recovery are not connected yet. This contract repair restores the existing full-environment and override ordering for current consumers; it changes no intended user-visible behavior or ontology/domain semantics. The Extension Host facade remains responsible for its current configuration and CLI argument preparation.
