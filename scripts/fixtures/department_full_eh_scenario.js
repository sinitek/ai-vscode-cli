"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");

const sha256 = value => crypto.createHash("sha256").update(value, "utf8").digest("hex");
const LONG_TOOL_PAYLOAD_BYTES = 6000;
const LONG_TOOL_OUTPUT = "\x01".repeat(LONG_TOOL_PAYLOAD_BYTES);
const LONG_TOOL_OUTPUT_SHA256 = sha256(LONG_TOOL_OUTPUT);
const LONG_TOOL_COMMAND = `node -e 'process.stdout.write(String.fromCharCode(1).repeat(${LONG_TOOL_PAYLOAD_BYTES}))'`;
const LONG_TOOL_ARGS = Object.freeze({ cmd: LONG_TOOL_COMMAND, shell: "/bin/sh", login: false, max_output_tokens: 30000 });
const LONG_TOOL_COMMAND_SHA256 = sha256(`${LONG_TOOL_ARGS.shell} -c ${JSON.stringify(LONG_TOOL_ARGS.cmd)}`);
const LONG_TOOL_CALL = "department-long-output";

function assertLongToolForwarding(forwarded, original) {
  assert.ok(forwarded, "missing actual EH onEvent forwarded command completion evidence");
  assert.ok(original && original.role === "leader" && Object.keys(original).every(key => forwarded[key] === original[key]),
    "forwarded event is not linked to the exact original leader invocation and execution identity");
  assert.equal(forwarded.commandSha256, LONG_TOOL_COMMAND_SHA256, "forwarded command does not match native command shape");
  assert.equal(forwarded.payloadBytes, LONG_TOOL_PAYLOAD_BYTES, "forwarded command output is truncated or extended");
  assert.equal(forwarded.payloadSha256, LONG_TOOL_OUTPUT_SHA256, "forwarded command output digest mismatch");
  assert.ok(Number.isSafeInteger(forwarded.eventBytes) && forwarded.eventBytes > 65536, "actual forwarded item.completed event did not exceed the threshold");
  return { ...original, commandSha256: forwarded.commandSha256, forwardedEventObserved: true,
    forwardedEventBytes: forwarded.eventBytes, payloadBytes: forwarded.payloadBytes, payloadSha256: forwarded.payloadSha256 };
}

// Protocol fixture, not a model or an independent code reviewer. All identities
// come from current production prompts and are checked against persisted tasks.
function latestUserText(body) {
  if (!Array.isArray(body.input)) throw new Error("Responses input must contain native messages");
  const user = body.input.filter((message) => message.role === "user").at(-1);
  if (!user) throw new Error("Responses request has no user message");
  return typeof user.content === "string" ? user.content : (user.content || []).map((part) => part.text || "").join("\n");
}
function createDepartmentFullEhScenario({ prompt, readTasks, inspectCleanup, maxRequests = 32, roles, continuationPrompt, continuationPrompts, holdEmployee = false,
  longToolOutput = false, readLongToolInvocation = () => null, readLongToolEvidence = () => null, longToolEvidenceWaitMs = 3000 }) {
  if (!Number.isSafeInteger(maxRequests) || maxRequests < 1 || maxRequests > 32) throw new Error("invalid scenario request budget");
  const extraContinuationPrompts = continuationPrompts === undefined ? [] : continuationPrompts;
  if (!Array.isArray(extraContinuationPrompts) || extraContinuationPrompts.length > 2 || extraContinuationPrompts.some(value => typeof value !== "string" || !value.trim())) throw new Error("invalid continuation prompt budget");
  if (continuationPrompt !== undefined && (typeof continuationPrompt !== "string" || !continuationPrompt.trim())) throw new Error("invalid continuation prompt");
  const acceptedContinuationPrompts = [...new Set([continuationPrompt, ...extraContinuationPrompts].filter(Boolean))];
  if (acceptedContinuationPrompts.length > 2) throw new Error("invalid continuation prompt budget");
  if (roles) for (const role of ["director", "leader", "employee"]) assert.ok(["codex", "opencode"].includes(roles[role]), "unknown scenario role CLI");
  // One native title per root/leader/employee session, plus the two existing
  // director summary captures. Two modules are the fixed scenario contract.
  const titleRequestBudget = roles
    ? 3 * Number(roles.director === "opencode") + 2 * Number(roles.leader === "opencode") + 2 * Number(roles.employee === "opencode")
    : 6;
  const titleBudget = titleRequestBudget + (roles?.director === "opencode" ? acceptedContinuationPrompts.length : 0);
  const history = [], dispatched = new Set(), employees = new Map(), leaders = new Set(), reviewed = new Set();
  const attemptKey = (leader, subtask, attempt) => JSON.stringify([leader, subtask, attempt]);
  let rootId, moduleCount = 0, capacityReuse, chatSequence = 0, heldEmployee = null, releaseHeldEmployee;
  let longToolInvocation = null, longToolCompletionStarted = false, longToolEvidence = null;
  let resolveHeldEmployee;
  const heldEmployeeReady = new Promise((resolve) => { resolveHeldEmployee = resolve; });
  function task(id, role) {
    const record = readTasks().find((value) => value.id === id);
    assert.ok(record && record.department?.role === role, `runtime ${role} identity is not persisted: ${id}`);
    assert.equal(record.department.rootTaskId, rootId);
    if (roles) { assert.equal(record.cli, roles[role]); assert.equal(record.department.routes[role].cli, roles[role]); }
    return record;
  }
  const module = (index) => ({ id: `protocol-module-${index}`, title: `本机文本协议模块 ${index}`,
    prompt: `${prompt}\n仅完成确定性文本转换验证：将 isolated protocol 转为 ISOLATED PROTOCOL，并在员工最终答复中给出输入、输出与范围。此场景只验证生产派发、原生执行与验收协议，不要求代码文件或真实模型判断。请按真实 Loop+ 协议派发一名员工，验收本轮实际事件，然后向总监报告。` });
  async function respond(body, context) {
    assert.ok(context.index <= maxRequests, "scenario request budget exceeded");
    const text = latestUserText(body);
    context.request.prompt = longToolOutput ? "[redacted]" : text;
    const role = text.startsWith("你是任务摘要器。") || text.includes("使用经典 Loop JSON 决策。") ? "director"
      : text.includes("You are the Loop+ main reviewer.") ? "leader" : text.includes("You are one independent Loop+ execution attempt.") ? "employee" : null;
    if (roles && role) assert.equal(roles[role], context.transport === "chat-completions" ? "opencode" : "codex", "production role used wrong CLI transport");
    let stage, identity, answer;
    if (text.startsWith("你是任务摘要器。")) {
      const data = JSON.parse(text.slice(text.indexOf("\n") + 1));
      assert.deepEqual(Object.keys(data), ["requirement"], "unknown summary input schema");
      assert.ok(typeof data.requirement === "string" && data.requirement.includes(prompt), "summary request is unrelated to this public submission");
      assert.ok(history.filter((entry) => entry.stage === "task-summary").length < 6, "summary stage budget exceeded");
      stage = "task-summary"; identity = { requirement: data.requirement }; answer = "隔离本机文本协议验收";
    } else if (text.includes("使用经典 Loop JSON 决策。")) {
      identity = text.match(/任务 ID：([^；\s]+)；轮次：\d+/)?.[1];
      assert.ok(identity, "director request lacks exact runtime task ID");
      if (!rootId) { assert.ok(text.includes(prompt)); rootId = identity; }
      assert.equal(identity, rootId, "director identity changed"); task(identity, "director");
      const total = Number(text.match(/模块总数：(\d+)/)?.[1]);
      assert.ok(Number.isSafeInteger(total), "missing production coordination context");
      if (total === 0 && moduleCount === 0) {
        stage = "director-dispatch"; moduleCount = 1;
        answer = { status: "continue", progressPercent: 0, estimatedRemainingRounds: 2, subtasks: [module(1)] };
      } else if (total === moduleCount && (text.match(/"organizationStatus": "completed"/g) || []).length === total) {
        const cleanup = await inspectCleanup(rootId);
        assert.equal(cleanup.complete, true, "completed module lacks original Owner receipts or returned capacity");
        if (moduleCount === 1) {
          stage = "director-capacity-reuse"; capacityReuse = cleanup; moduleCount = 2;
          answer = { status: "continue", progressPercent: 50, estimatedRemainingRounds: 1, subtasks: [module(2)] };
        } else {
          stage = "director-report";
          answer = { status: "completed", progressPercent: 100, estimatedRemainingRounds: 0,
            answerConclusion: "两次本机文本协议执行均返回 ISOLATED PROTOCOL，组长已按真实事件汇报。", finalSummary: "本机协议组合验证完成；非真实模型或业务代码验收。" };
        }
      } else {
        assert.ok(total > 0 && total <= moduleCount, "unknown director module state");
        stage = "director-wait"; answer = { status: "blocked", finalSummary: "等待真实组长事件验收和清理汇报" };
      }
    } else if (text.includes("You are the Loop+ main reviewer.")) {
      identity = text.match(/^Parent task: (\S+)/m)?.[1];
      const leader = task(identity, "leader"); leaders.add(identity);
      assert.equal(leader.schedulingMode, "event_driven");
      if (longToolOutput && !longToolInvocation && identity === [...leaders][0]) {
        stage = "leader-long-tool-call";
        const tools = (body.tools || []).filter(tool => tool.type === "function" && tool.name === "exec_command");
        assert.equal(tools.length, 1, "leader request did not declare one native exec_command tool");
        const parameters = tools[0].parameters;
        assert.ok(Object.entries(LONG_TOOL_ARGS).every(([key, value]) => parameters?.properties?.[key]?.type ===
          ({ string: "string", boolean: "boolean", number: "number" })[typeof value] ||
          typeof value === "number" && parameters?.properties?.[key]?.type === "integer")
          && (parameters.required || []).every(key => Object.hasOwn(LONG_TOOL_ARGS, key)),
        "leader exec_command schema does not declare the selected command arguments");
        longToolInvocation = readLongToolInvocation(rootId, identity);
        assert.ok(longToolInvocation?.role === "leader" && longToolInvocation.rootTaskId === rootId && longToolInvocation.leaderTaskId === identity,
          "long-tool call lacks its original persisted leader invocation");
        answer = { type: "function_call", call_id: LONG_TOOL_CALL, name: tools[0].name, arguments: LONG_TOOL_ARGS };
        history.push({ index: context.index, stage, identity, answer: "[native function call]" }); context.request.stage = stage;
        return answer;
      } else if (longToolOutput && longToolInvocation?.leaderTaskId === identity && !longToolEvidence) {
        assert.equal(longToolCompletionStarted, false, "duplicate leader native tool completion request");
        longToolCompletionStarted = true;
        const outputs = body.input.filter(item => item.type === "function_call_output" && item.call_id === LONG_TOOL_CALL);
        assert.equal(outputs.length, 1, "leader native tool completion is missing or duplicated");
        const output = outputs[0].output;
        assert.equal(typeof output, "string", "leader tool completion is not native text output");
        const header = /^Chunk ID: [a-f0-9]+\nWall time: \d+(?:\.\d+)? seconds\nProcess exited with code 0\nOriginal token count: \d+\nOutput:\n/.exec(output);
        assert.ok(header, "leader native tool output does not have the expected success envelope");
        const payload = output.slice(header[0].length);
        const modelPayloadBytes = Buffer.byteLength(payload, "utf8"), modelPayloadSha256 = sha256(payload);
        assert.equal(modelPayloadBytes, LONG_TOOL_PAYLOAD_BYTES, "leader native tool output is truncated or extended");
        assert.equal(modelPayloadSha256, LONG_TOOL_OUTPUT_SHA256, "leader native tool output digest mismatch");
        const serialized = JSON.stringify(outputs[0]);
        const deadline = performance.now() + longToolEvidenceWaitMs;
        let forwarded = readLongToolEvidence();
        while (!forwarded && performance.now() < deadline) {
          await new Promise(resolve => setTimeout(resolve, 25));
          forwarded = readLongToolEvidence();
        }
        longToolEvidence = { ...assertLongToolForwarding(forwarded, longToolInvocation), nativeFunctionCallOutput: true,
          modelInputBytes: Buffer.byteLength(serialized, "utf8"), modelInputSha256: sha256(serialized), modelPayloadBytes, modelPayloadSha256 };
      }
      const event = text.match(/^Current review eventId: (\S+)/m)?.[1];
      const checks = ["dispatched work", "contracts", "tests", "artifacts", "unauthorized changes", "omissions and regressions"]
        .map((name) => ({ name, passed: true, detail: "本机确定性文本协议答复；非代码验收" }));
      if (event && event !== "(none)") {
        assert.equal(Number(text.match(/^Acceptance batch count: (\d+)/m)?.[1]), 1, "scenario expects exactly one real event");
        const observed = text.match(/^- current eventId=(\S+) subtask=(\S+) attempt=(\S+) outcome=(\S+)/m);
        assert.ok(observed && observed[1] === event && observed[4] === "completed", "event is not a completed current runtime attempt");
        const current = leader.loopPlus?.currentReview;
        assert.ok(current && current.eventId === event && current.subtaskId === observed[2]
          && current.attemptId === observed[3] && current.outcome === "completed", "review event attempt is not persisted");
        assert.ok(dispatched.has(identity) && employees.has(attemptKey(identity, current.subtaskId, current.attemptId)), "review has no scenario employee execution");
        assert.equal(reviewed.has(identity), false, "duplicate event acceptance");
        reviewed.add(identity);
        stage = "leader-accept";
        answer = { status: "accept", reviewEventId: event, reviews: [{ reviewEventId: event, acceptance: "passed", reason: "确定性文本答复已到达真实事件" }],
          progressPercent: 90, acceptance: { passed: true, checks } };
      } else if (!dispatched.has(identity)) {
        // An empty INITIAL scheduler also allows completion. That flag proves
        // no blockers, not that this scenario dispatched and reviewed its work.
        assert.equal(text.match(/^Prompt kind: (\S+)/m)?.[1], "initial", "first leader request is not initial");
        assert.equal(Number(text.match(/^Still running count: (\d+)/m)?.[1]), 0);
        assert.equal(Number(text.match(/^Confirmed acceptances: (\d+)/m)?.[1]), 0);
        assert.equal(leader.subTasks.length, 0, "initial leader already has unowned work");
        dispatched.add(identity); stage = "leader-dispatch";
        answer = { status: "dispatch", subtasks: [{ id: "text-protocol", title: "确定性文本答复", taskType: "backend", writeFiles: [],
          prompt: "仅验证本机确定性文本答复协议：将 isolated protocol 转为 ISOLATED PROTOCOL。最终答复给出输入、输出和非真实模型的验证范围。不修改调度或任务记录，不访问外网，不要求编写代码文件；此任务完整自包含，不再拆分。" }] };
      } else if (text.includes("Snapshot says completion is allowed: yes")) {
        assert.ok(reviewed.has(identity), "closeout lacks a real employee event acceptance");
        assert.equal(Number(text.match(/^Confirmed acceptances: (\d+)/m)?.[1]), 1);
        assert.equal(leader.subTasks.length, 1);
        assert.equal(leader.subTasks[0].status, "completed", "employee acceptance is not persisted");
        stage = "leader-report";
        answer = { status: "completed", progressPercent: 100, answerConclusion: "ISOLATED PROTOCOL", finalSummary: "员工确定性文本转换已通过本机事件协议验收。",
          acceptance: { passed: true, checks }, requirementCoverage: [{ name: "确定性文本转换协议", passed: true }] };
      } else if (Number(text.match(/^Still running count: (\d+)/m)?.[1]) > 0) {
        stage = "leader-wait"; answer = { status: "wait" };
      } else throw new Error("unknown leader state; no dispatch, event or closeout authority");
    } else if (text.includes("You are one independent Loop+ execution attempt.")) {
      const reportFile = text.match(/^Attempt report file: (.+)$/m)?.[1];
      assert.ok(reportFile, "employee request has no runtime report path");
      const matches = readTasks().filter((value) => value.department?.role === "leader" && value.department.rootTaskId === rootId)
        .flatMap((value) => value.subTasks.filter((subtask) => subtask.communicationFile === reportFile).map((subtask) => ({ value, subtask })));
      assert.equal(matches.length, 1, "employee report path does not belong to one real leader subtask");
      const { value, subtask } = matches[0];
      const active = value.loopPlus?.running?.filter((attempt) => attempt.subtaskId === subtask.id);
      assert.equal(active?.length, 1, "employee attempt identity is ambiguous");
      identity = { leaderTaskId: value.id, subtaskId: subtask.id, attemptId: active[0].attemptId, reportFile };
      assert.ok(dispatched.has(value.id), "employee request has no scenario leader dispatch");
      const key = attemptKey(value.id, subtask.id, identity.attemptId);
      assert.equal(employees.has(key), false, "duplicate employee request"); employees.set(key, identity);
      stage = "employee-result";
      if (holdEmployee) {
        heldEmployee = structuredClone(identity);
        resolveHeldEmployee(heldEmployee);
        answer = await new Promise((resolve) => { releaseHeldEmployee = () => resolve("Input: isolated protocol\nOutput: ISOLATED PROTOCOL\nDeterministic local protocol fixture; no code changes, external model, or independent review claimed."); });
      } else {
        answer = "Input: isolated protocol\nOutput: ISOLATED PROTOCOL\nDeterministic local protocol fixture; no code changes, external model, or independent review claimed.";
      }
    } else throw new Error("unknown production prompt stage");
    const entry = { index: context.index, stage, identity, answer: typeof answer === "string" ? answer : answer?.type === "function_call" ? "[native function call]" : answer };
    history.push(entry); context.request.stage = stage;
    if (answer?.type === "function_call") return answer;
    return typeof answer === "string" ? answer : JSON.stringify(answer);
  }
  function summarizeRequest(body) {
    if (!longToolOutput) return body;
    return { input: body.input?.map(item => {
      if (item.type === "function_call_output") return { type: item.type, output: { byteLength: Buffer.byteLength(String(item.output ?? ""), "utf8"),
        sha256: sha256(String(item.output ?? "")) } };
      if (item.type === "function_call") return { type: item.type, arguments: "[redacted]" };
      return { content: "[redacted]" };
    }) };
  }
  // Translate only the transport envelope; all production decision/event parsing
  // and persisted task validation remain shared with the Responses scenario.
  async function respondChat(body, context, productionRespond = respond) {
    assert.ok(Array.isArray(body.messages), "Chat Completions messages are missing");
    assert.ok(++chatSequence <= 32, "OpenCode scenario request budget exceeded");
    const raw = latestUserText({ input: body.messages });
    // The installed CLI's one-shot path retains a double-quoted argv envelope;
    // native Owner paths send raw text. Decode only that exact transport form.
    const unwrap = value => value.startsWith('"') && value.endsWith('"') ? value.slice(1, -1).replace(/\\(["\\])/g, "$1") : value;
    const titlePrefix = "Generate a title for this conversation:\n\nuser ";
    const text = unwrap(context.purpose === "title" && raw.startsWith(titlePrefix) ? raw.slice(titlePrefix.length) : raw);
    context.request.prompt = text;
    if (context.purpose === "title") {
      assert.ok(body.messages.some((message) => message.role === "system" && /You are a title generator/.test(JSON.stringify(message.content))), "unknown title protocol");
      // Titles may precede the first decision. Match only the exact production
      // director, leader or attempt prompt against current persisted identities.
      const records = readTasks();
      let summary = false;
      if (text.startsWith("你是任务摘要器。")) {
        const data = JSON.parse(text.slice(text.indexOf("\n") + 1));
        assert.deepEqual(Object.keys(data), ["requirement"]);
        assert.ok([prompt, ...acceptedContinuationPrompts].includes(data.requirement), "summary title is unrelated to public input");
        summary = true;
      }
      const ids = records.filter(value => value.department?.role === "director"
        && text.includes(`任务 ID：${value.id}；`) && text.includes(prompt)
        || value.department?.role === "leader" && value.department.rootTaskId === rootId && text.includes(`Parent task: ${value.id}\n`)).map(value => value.id);
      const reports = records.filter(value => value.department?.role === "leader" && value.department.rootTaskId === rootId)
        .flatMap(value => value.subTasks.filter(subtask => subtask.communicationFile && text.includes(`Attempt report file: ${subtask.communicationFile}\n`))
          .map(subtask => ({ leaderTaskId: value.id, subtaskId: subtask.id, reportFile: subtask.communicationFile })));
      assert.equal(ids.length + reports.length + Number(summary), 1, "title has no unique current runtime role/attempt");
      assert.ok(history.filter((entry) => entry.stage === "opencode-title").length < titleBudget, "title request budget exceeded");
      context.request.stage = "opencode-title";
      history.push({ index: history.length + 1, stage: "opencode-title", identity: ids[0] || reports[0] || { requirement: prompt }, transport: "chat-completions" });
      return "隔离组织文本协议验收";
    }
    assert.ok(text.startsWith("你是任务摘要器。") || text.includes("使用经典 Loop JSON 决策。")
      || text.includes("You are the Loop+ main reviewer.") || text.includes("You are one independent Loop+ execution attempt."), "unknown OpenCode production prompt stage");
    const result = await productionRespond({ input: [{ role: "user", content: text }] }, { ...context, index: history.length + 1, transport: "chat-completions" });
    history.at(-1).transport = "chat-completions";
    return result;
  }
  return { respond, respondChat, summarizeRequest, history, waitForHeldEmployee: () => heldEmployee ? Promise.resolve(heldEmployee) : heldEmployeeReady,
    releaseHeldEmployee: () => releaseHeldEmployee?.(),
    snapshot: () => ({ rootId, moduleCount, leaders: [...leaders], employees: [...employees.values()], heldEmployee: structuredClone(heldEmployee), capacityReuse, longToolEvidence: structuredClone(longToolEvidence), history }) };
}
module.exports = { createDepartmentFullEhScenario, latestUserText, assertLongToolForwarding, LONG_TOOL_OUTPUT, LONG_TOOL_PAYLOAD_BYTES,
  LONG_TOOL_OUTPUT_SHA256, LONG_TOOL_COMMAND, LONG_TOOL_COMMAND_SHA256 };
