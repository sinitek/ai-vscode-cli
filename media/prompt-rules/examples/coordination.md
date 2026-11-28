# 需要跨组拆分或协调示例时

假设同一报表导出功能有两项要求，分别是按所选范围导出记录、按约定精度显示金额。接口已确定，筛选和格式化各有独立实现和证据。单次派发上限允许两项时，总监可在同一轮派单。

```json
{
  "status": "continue",
  "progressPercent": 0,
  "estimatedRemainingRounds": 1,
  "subtasks": [
    {
      "id": "export-rows", "title": "导出行范围", "progressWeightPercent": 50,
      "writeFiles": ["src/export/rows.ts", "tests/export/rows.test.ts"],
      "prompt": "负责报表导出的行范围，沿用已确定的导出接口。只修改行筛选及对应测试。验收时用含命中和未命中记录的样例核对导出行与所选范围完全一致，同时覆盖空结果。向总监汇报筛选条件、实际行号和测试记录位置。"
    },
    {
      "id": "export-amounts", "title": "导出金额精度", "progressWeightPercent": 50,
      "writeFiles": ["src/export/amounts.ts", "tests/export/amounts.test.ts"],
      "prompt": "负责报表导出的金额精度，沿用已确定的导出接口。只修改金额格式化及对应测试。验收时对照约定的小数位和舍入规则，核对零值、小数与舍入边界的实际导出金额。向总监汇报各样例的期望值、实际值和测试记录位置。"
    }
  ]
}
```

两位组长可同时核对各自的样例。若只修一处金额舍入错误，由一组完成修复和验收。若需另一组变更接口，向总监提供目标组长的真实任务 ID 和配合需求，由总监协调投递。
