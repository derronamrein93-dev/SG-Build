# 07 · AI Agent Roadmap

The long-term "Stride Guide" assistant. Written to a hard constraint: **no model
provider may ever be the source of the company's proprietary value.**

---

## 1. Where the value actually lives

Frontier models are a commodity input that gets better and cheaper every quarter.
Anything a competitor can reproduce by calling the same API is not a moat.

What cannot be copied by an API call:

| Asset | Accrues from | Compounding? |
| --- | --- | --- |
| Stride Guide fitting rules | Founder + retail expertise, tuned by override data | Yes |
| Fit outcomes (recommended → bought → returned → satisfied) | Every fitting, from day one | **Strongly** |
| Shoe fit characteristics, hands-verified | Curation + associate corrections | Yes |
| Store feedback and pilot outcomes | Pilot program | Yes |
| Sales playbooks and talking points that actually convert | Observed outcomes | Yes |
| Pressure/load data | Hardware, once shipped | **Uniquely** |
| Internal company knowledge base | Accumulated operating knowledge | Yes |

**The model is rented. The layers around it are owned.** Architecture follows
from that sentence.

## 2. Five-layer architecture

```
┌───────────────────────────────────────────────────────────────────┐
│ 5 · INTERFACE          Associate copilot · founder console ·      │
│                        customer-facing copy · outreach drafts     │
├───────────────────────────────────────────────────────────────────┤
│ 4 · TOOLS / ACTIONS    run_rules · query_shoes · fetch_fit_history│
│                        draft_followup · score_opportunity · search │
├───────────────────────────────────────────────────────────────────┤
│ 3 · KNOWLEDGE          Rules · fit outcomes · shoe DB · playbooks │
│    (PROPRIETARY)       · pilot feedback · policy & guardrails      │
├───────────────────────────────────────────────────────────────────┤
│ 2 · ORCHESTRATION      Prompt templates · retrieval · evals ·     │
│                        guardrail filter · provider abstraction     │
├───────────────────────────────────────────────────────────────────┤
│ 1 · BASE MODEL         Swappable. Interface, not dependency.      │
└───────────────────────────────────────────────────────────────────┘
                                  ▲
┌───────────────────────────────────────────────────────────────────┐
│ FEEDBACK LOOP  overrides · outcomes · "wrong recommendation" ·    │
│                follow-up responses → back into layer 3            │
└───────────────────────────────────────────────────────────────────┘
```

### Layer 1 — Base model (rented, swappable)

One internal interface: `complete(task, context, schema) → structured result`.
Every call goes through it; no vendor SDK types leak into application code.

| Task class | Tier | Default |
| --- | --- | --- |
| Classification, extraction, routing, tagging | Small/fast | `claude-haiku-4-5` |
| Customer-facing prose, talking points, report language | Capable | `claude-opus-5` |
| Analysis over pilot data, playbook synthesis, long-context work | Capable | `claude-opus-5` |

Provider independence is a **seam, not a fetish**: pick the best model available,
keep prompts, retrieval, evals and guardrails on your side of the line so
switching is a config change and a re-run of the eval set — not a rebuild.

**Portability rules:** prompts stored as versioned files in the repo, never in a
vendor console. Structured output enforced by your schema. An eval set you own,
run against any candidate model. No vendor-specific fine-tune holding logic that
exists nowhere else.

### Layer 2 — Orchestration (owned)

Prompt templates · retrieval over layer 3 · the **guardrail filter** (the banned
lexicon from [03 §4](03-recommendation-engine.md#4-language-guardrails), applied
to every generated string, in and out) · eval harness · logging of every
prompt/response for review.

**Nothing generated ever reaches a customer without passing the guardrail
filter.** This is a code path, not a prompt instruction — prompt instructions are
guidance; filters are guarantees.

### Layer 3 — Knowledge (the company)

Rules, outcomes, shoe characteristics, playbooks, pilot feedback, policy. Stored
in Postgres and the repo, not in a vendor's memory feature.

### Layer 4 — Tools

The agent acts only through typed tools, each with an explicit permission scope:

| Tool | Scope |
| --- | --- |
| `run_rules(inputs)` | Deterministic engine — the agent may **read** a recommendation, never invent one |
| `query_shoes(profile, store)` | Catalog match |
| `fetch_fit_history(customer_id)` | Store-scoped, consent-gated |
| `draft_followup(fitting_id)` | Produces a draft; a human sends it |
| `score_opportunity(lead)` | Internal sales use |
| `search_knowledge(query)` | Internal knowledge base |
| `summarize_feedback(range)` | Pilot analysis |

### Layer 5 — Interface

Associate copilot inside FitOS · founder console for pilot analysis and outreach
· customer-facing report language · investor/customer material drafting.

### Feedback loop

Overrides, outcomes, "wrong recommendation" reports, and follow-up responses flow
back into layer 3 weekly. **This is the only layer that makes the system smarter
over time, and it is entirely yours.**

---

## 3. Phasing

### Phase 0 — Now (MVP): no AI in the fitting path

Deterministic rules only. Deliberate: zero latency, zero cost, zero
non-determinism, and complete explainability while you are earning trust with the
first retailers. **Ship the data collection, not the intelligence.**

**The wall is absolute and worth restating.** Three separate systems, never
merged:

| System | Status | Permitted to |
| --- | --- | --- |
| **Recommendation Engine v1** | Built now | Decide. Fully deterministic. |
| **AI Explanation Layer** | Later, optional | *Render* structured results in natural language. Never alter, add to, reorder or re-rank them. |
| **ML Recommendation Engine** | Much later | Re-rank on top of the rules, once outcome data exists. Never replace the rule floor. |

A language model that "just tweaks" a recommendation has silently become the
recommender, and the reproducibility guarantee dies with it. Every generated
string is tied to a `rule_set_version` and a frozen feature snapshot, so the
prose can be regenerated and compared against what a customer was actually
shown.

### Phase 1 — Language layer (weeks 4–8)

The LLM writes; the rules decide.

- Talking points and report rationale rendered from the rule outputs as
  constraints, so wording improves without the recommendation changing.
- Intake notes → structured tags.
- Generated at fitting-completion time, cached on the record, guardrail-filtered.
  Never on the critical path of the 3-minute flow.

### Phase 2 — Associate copilot (months 2–4)

"Why this shoe?" · "What do I say to someone who says it's too expensive?" ·
"What did we fit this customer in last time?" — grounded in layers 3 and 4,
answering from store data and playbooks rather than general knowledge.

### Phase 3 — Founder/business agent (months 3–6)

Internal, and honestly the highest near-term ROI: pilot feedback synthesis,
opportunity scoring for prospect stores, outreach preparation, knowledge-base
search, and drafting investor and customer material from real pilot data.

### Phase 4 — Customer education (months 4–8)

Customer-facing explanations of their fit report. Highest legal exposure in the
roadmap — strict guardrails, escalation to a human for anything health-adjacent,
and it ships last for that reason.

### Phase 5 — Hardware-informed (post-hardware)

Scan interpretation in plain language, visit-over-visit change narration,
anomaly flagging for re-scan. This is where the rented model finally has access
to data no competitor can obtain.

### Phase 6 — Learned recommendations (2,000+ outcomes)

Outcome-weighted ranking layered **on top of** the rules, never replacing them.
The rules stay as the explainable floor and the safety envelope.

## 4. Support and troubleshooting agent

Hardware troubleshooting (phase 5) runs off the same architecture: device
telemetry + a troubleshooting knowledge base + typed tools. Build the knowledge
base from real pilot support tickets starting now, in plain markdown — that
corpus is what makes the agent useful later, and it costs nothing to accumulate
today.

## 5. Rules the AI work must obey

1. **The engine decides; the model phrases.** No LLM output alters a
   recommendation attribute — ever.
2. **Every generated customer-facing string passes the guardrail filter.**
3. **Every agent action is logged with its inputs**, reproducible after the fact,
   stamped with the same five versions a recommendation carries
   ([03 §1](03-recommendation-engine.md#mandatory-version-stamping)).
4. **Drafts, not sends.** Outbound customer communication is human-approved
   until there is evidence it can be trusted, and transactional messages stay
   separate from marketing ones.
5. **No customer PII in prompts.** Fit profiles are anonymous by construction —
   send the profile, not the person. Same allowlist discipline as analytics
   ([06 §4](06-tech-and-data-strategy.md#4-analytics-and-error-reporting--privacy-rules)).
6. **An eval set gates every prompt or model change.** Same discipline as the
   rules' golden test set.

---

**Next:** [08 · Design Language](08-design-language.md)
