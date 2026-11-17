import { exactKeys, identifier, isDepartmentExecutionIdentity, record } from "./departmentexecutionidentity";
import { boundedCodexMessage } from "./departmentcodexpreparationcontract";

export type DepartmentLeaderInvocation = Readonly<{ invocationId: string; prompt: string }>;

/** Loop+ owns the prompt. The department adapter must neither truncate it nor
 * impose a second prompt budget before handing it to the existing CLI. */
export function isDepartmentLeaderInvocation(value: unknown): value is DepartmentLeaderInvocation {
  return record(value) && exactKeys(value, ["invocationId", "prompt"]) && identifier(value.invocationId)
    && typeof value.prompt === "string" && !!value.prompt.trim();
}

/** Only the exact invocation data envelope is exempt from the control-frame
 * size limit. Both peers still verify the original token, identity, sequence,
 * phase and grant. Public Owner sockets and callback frames remain bounded. */
export function isDepartmentLeaderPrivateCommand(value: unknown): boolean {
  if (!record(value) || value.operation !== "invoke") return boundedCodexMessage(value);
  return exactKeys(value, ["version", "token", "identity", "sequence", "operation", "invocation"])
    && value.version === 1 && typeof value.token === "string" && /^[a-f0-9]{64}$/.test(value.token)
    && isDepartmentExecutionIdentity(value.identity) && Number.isSafeInteger(value.sequence) && Number(value.sequence) > 0
    && isDepartmentLeaderInvocation(value.invocation);
}
