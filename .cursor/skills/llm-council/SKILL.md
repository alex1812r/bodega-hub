---
name: llm-council
description: Run a multi-perspective council review for ERP architecture, Supabase/RLS decisions, API contracts, UI module planning, risky refactors, and implementation trade-offs. Use when the user asks for llm-council, council review, multi-perspective review, architecture review, or wants several expert viewpoints before deciding.
---

# LLM Council

Use this skill to review important decisions through multiple expert perspectives before recommending a final path.

This skill is inspired by `karpathy/llm-council`, but it runs as an in-agent review workflow. It does not call external models, OpenRouter, or the original app.

## When To Use

Use this workflow when the user asks for:

- `llm-council`
- council review
- multi-perspective review
- architecture review
- review of a risky change
- comparison of multiple implementation options
- a decision before implementing a major ERP feature

## Council Roles

Use the roles that fit the request. For this ERP, prefer:

1. **Product/ERP Reviewer**: checks business fit for sales, purchases, inventory, contacts, payments, reports, and ref/VES flows.
2. **Frontend Architecture Reviewer**: checks Next.js App Router, screaming architecture, page-scoped folders, component reuse, SOLID, Storybook, and UI consistency.
3. **Supabase/Postgres/RLS Reviewer**: checks schema, RPC boundaries, transactional integrity, role permissions, RLS, and data access risks.
4. **API/Data Reviewer**: checks route contracts, DTO shape, loading/error states, TanStack Query integration, and consistency with OpenAPI/docs.
5. **QA/Testing Reviewer**: checks Storybook coverage, Jest/RTL tests, missing states, and regression risk.
6. **Chairman**: synthesizes the strongest points, resolves disagreements, and gives the final recommendation.

## Workflow

1. Restate the question or decision in one short paragraph.
2. List assumptions and constraints from the codebase or docs.
3. Have each relevant role give an independent review:
   - recommendation
   - main risk
   - concrete action
4. Identify disagreements between roles.
5. Chairman gives:
   - final recommendation
   - why this option wins
   - what to do next
   - what to avoid

## Output Format

Use this format:

```markdown
## Council Review

### Decision
<Restate the decision or question.>

### Assumptions
- <Assumption 1>
- <Assumption 2>

### Perspectives

**Product/ERP Reviewer**
- Recommendation:
- Risk:
- Action:

**Frontend Architecture Reviewer**
- Recommendation:
- Risk:
- Action:

**Supabase/Postgres/RLS Reviewer**
- Recommendation:
- Risk:
- Action:

**API/Data Reviewer**
- Recommendation:
- Risk:
- Action:

**QA/Testing Reviewer**
- Recommendation:
- Risk:
- Action:

### Disagreements
- <Disagreement or trade-off>

### Chairman Recommendation
<Final decision and rationale.>

### Next Steps
1. <Step 1>
2. <Step 2>
3. <Step 3>
```

## Rules

- Keep reviews practical and tied to this codebase.
- Prefer existing project conventions over new abstractions.
- Do not invent external integration with `karpathy/llm-council`; mention it only as inspiration unless the user explicitly asks to integrate it.
- For implementation decisions, cite concrete files when possible.
- If more than three options exist, narrow them to the top two before the Chairman recommendation.
- If the user asks to implement after the review, produce a concise plan first unless the change is small and obvious.
