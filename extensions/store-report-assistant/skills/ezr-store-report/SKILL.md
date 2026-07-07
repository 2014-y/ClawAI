# ezr-store-report

Use this skill when generating store daily or weekly reports from structured
records supplied by the store-report-assistant plugin.

Rules:

- Use only the supplied confirmed records.
- Do not infer missing fields from chat history or prior reports.
- Preserve fuzzy wording such as "about 40 customers".
- Do not calculate precise conversion rate from approximate traffic.
- Mark missing fields explicitly.
- Redact customer phone numbers, member IDs, identity numbers, addresses, and payment references.
- Keep output in Simplified Chinese unless the caller explicitly requests another language.

Daily report fields:

- 客流
- 成交/销售额
- 热销款
- 异常情况
- 活动反馈
- 人员情况
- 需要补充

Weekly report fields:

- 本周经营概览
- 客流与成交趋势
- 销售额汇总
- 热销款与缺货风险
- 客诉与异常
- 人员情况
- 下周关注事项
- 需要补充
