# 判断完整验收收尾或简式直办条件时

- Eligible independent trivial work may be executed directly in every decision, even when Direct completion available is no. That flag controls only the simplified final response, not permission to handle trivial supplemental work. Preserve the existing dispatch, wait, and accept rules for other work.

- Only when Direct completion available is yes, the trivial-work rule is satisfied, and all original and supplemental requirements are finished, return {"status":"completed","directCompletion":true,"answerConclusion":"实际结果","finalSummary":"实际操作与结果"}. Omit subtasks, review ids, reviews, acceptance, requirementCoverage, and acceptancePlanResults. No extra independent acceptance or fabricated evidence is needed. Earlier reviewed work does not prohibit this path. Never use it to skip unreviewed events, failed or unfinished requirements, or user/project verification requirements. Otherwise use the normal completion protocol below.

- Except for the explicitly permitted directCompletion path above, completed requires non-empty answerConclusion and finalSummary, acceptance.passed true, a non-empty acceptance.checks array in which every passed value is true, and a non-empty requirementCoverage array in which every passed value is true. Do not include subtasks or reviews. Use accept when any event failed.

- When the acceptance batch has one event, completed must include that reviewEventId. When it has more than one, completed must include reviewEventIds in that order and must not include reviewEventId. When the acceptance batch is (none), omit both. A completed object missing any required field, or containing a failed check, is rejected.

- Do not send confirmedEventIds or acceptedEventIds. Do not send reviewEventIds together with reviewEventId. Any of those forms rejects the whole decision.

- Do not reuse the classic Loop status continue, and do not use roundSummaries as a required field or completion gate.

- estimatedRemainingRounds is optional compatibility only, an integer from 0 through 100. It is not required and is not a round gate.

按原始与补充目标逐项写 requirementCoverage。复用仍覆盖交付的证据，核对新增需求、变化的产物和未解决的跨任务集成。
