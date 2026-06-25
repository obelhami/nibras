``# KPI Engine — Worked Examples

These examples use **one made-up board** so you can see exactly what each KPI
endpoint returns and *why*. The numbers below are computed by hand from the
scenario using the same formulas the code uses — the live server returns the
same shape.

> Today's date in the example = **2026-06-22**.

---

## The scenario

**Team "Frontend Squad"** — 3 members: `alice@nibras.com`, `bob@nibras.com`, `carol@nibras.com`.
**Board "Website Revamp"** — default columns: `Todo (0) → Doing (1) → Review (2) → Done (3)`.

6 tasks, with their movement history:

| Task | Assignee | Created | Due | Journey | Current |
|---|---|---|---|---|---|
| T1 Design header | alice | 06-01 | 06-07 | Todo→Doing→Review→**Done** (06-06) | done |
| T2 Build navbar | bob | 06-03 | 06-10 | Todo→Doing→Review→**Doing (sent back)**→Review→**Done** (06-13) | done |
| T3 Hero section | alice | 06-10 | 06-20 | Todo→Doing→Review | review |
| T4 Footer links | bob | 06-11 | — | Todo→Doing *(note: "blocked by API")* | doing |
| T5 Contact form | carol | 06-15 | 06-25 | Todo | todo |
| T6 SEO meta tags | bob→**alice** | 06-18 | 06-19 | Todo→Doing→Review *(reassigned bob→alice on 06-19)* | review |

Key events to notice:
- **T1** flowed cleanly and was delivered **before** its due date.
- **T2** was **sent back** from Review to Doing once (rework), and was delivered **late**.
- **T4** has a **blocker** note.
- **T6** was **reassigned** from bob to alice.
- **T3** and **T6** are sitting in **Review** and are now **overdue**.

---

## 1. Operational KPIs — `GET /kpi/boards/{boardId}`

**Returns:**
```json
{
  "boardId": "website-revamp",
  "kpis": {
    "adtHours": 180,
    "adtDays": 7.5,
    "vrr": 50,
    "err": 7.69,
    "reviewSaturation": 50,
    "totals": {
      "totalTasks": 6,
      "completedTasks": 2,
      "activeTasks": 4,
      "inReview": 2,
      "validatedTasks": 4,
      "backwardMoves": 1,
      "totalMoves": 13
    }
  },
  "generatedAt": "2026-06-22T09:00:00.000Z"
}
```

**Why these numbers:**
- **ADT = 7.5 days.** Only T1 and T2 reached Done. T1 took 5 days (06-01→06-06), T2 took 10 days (06-03→06-13). Average = (5 + 10) / 2 = **7.5 days**.
- **VRR = 50%.** 4 tasks entered Review (T1, T2, T3, T6). Of those, 2 actually reached Done (T1, T2). 2 ÷ 4 = **50%**.
- **ERR = 7.69%.** There were 13 real column moves; 1 of them went backwards (T2: Review→Doing). 1 ÷ 13 = **7.69%**.
- **Review Saturation = 50%.** 4 tasks are active (not done): T3, T4, T5, T6. Of those, 2 are in Review (T3, T6). 2 ÷ 4 = **50%** → review is a bottleneck.

**One-liner:** *"This board ships in ~7.5 days, only half of reviewed work gets released, rework is low (8%), but half the unfinished work is stuck in review."*

---

## 2. Focus Score — `GET /kpi/users/{email}/focus?days=30`

### Example A — alice (`/kpi/users/alice%40nibras.com/focus`)
```json
{
  "windowDays": 30,
  "focus": {
    "email": "alice@nibras.com",
    "score": 79,
    "label": "good",
    "indicators": {
      "contextSwitches": 2,
      "unfinishedTasks": 2,
      "blockers": 0,
      "reassignments": 1,
      "assignedTasks": 3,
      "movesAnalyzed": 9
    },
    "penalties": {
      "contextSwitchPenalty": 6,
      "unfinishedPenalty": 10,
      "blockerPenalty": 0,
      "reassignmentPenalty": 5
    }
  },
  "generatedAt": "2026-06-22T09:00:00.000Z"
}
```

**Why:** alice owns 3 tasks (T1, T3, T6); 2 are still open → −10. Her activity moved between 2 different tasks → 2 switches → −6. No blockers → −0. One of her tasks was reassigned to her (T6) → −5. Score = 100 − 6 − 10 − 0 − 5 = **79 ("good")**.

### Example B — bob (`/kpi/users/bob%40nibras.com/focus`)
```json
{
  "windowDays": 30,
  "focus": {
    "email": "bob@nibras.com",
    "score": 73,
    "label": "good",
    "indicators": {
      "contextSwitches": 4,
      "unfinishedTasks": 1,
      "blockers": 1,
      "reassignments": 1,
      "assignedTasks": 2,
      "movesAnalyzed": 9
    },
    "penalties": {
      "contextSwitchPenalty": 12,
      "unfinishedPenalty": 5,
      "blockerPenalty": 5,
      "reassignmentPenalty": 5
    }
  },
  "generatedAt": "2026-06-22T09:00:00.000Z"
}
```

**Why:** bob jumped back and forth between T2, T4 and T6 → 4 context switches → −12. 1 unfinished task → −5. He hit a blocker → −5. A task was moved off him (T6) → −5. Score = 100 − 12 − 5 − 5 − 5 = **73 ("good")**.

**One-liner:** *"Both are 'good', but bob's score is dragged down mainly by context switching and a blocker — alice's by unfinished work. The breakdown shows the cause, it's not a black box."*

---

## 3. Team Pulse — `GET /kpi/teams/{teamId}/pulse?days=30`

**Returns:**
```json
{
  "teamId": "frontend-squad",
  "windowDays": 30,
  "pulse": {
    "state": "critical",
    "score": 36,
    "inputs": {
      "members": 3,
      "activeTasks": 4,
      "workloadPerMember": 1.33,
      "overdueTasks": 2,
      "overdueRatio": 50,
      "inReview": 2,
      "reviewSaturation": 50,
      "completedTasks": 2,
      "delayedTasks": 1,
      "delayRate": 50,
      "blockers": 1,
      "reassignments": 1
    }
  },
  "generatedAt": "2026-06-22T09:00:00.000Z"
}
```

**Why state = "critical":**
- Workload is fine (1.33 tasks/person), so it is **not** "overloaded."
- **But** 2 of the 4 active tasks are overdue → overdueRatio = **50%**, which is above the 40% danger line → that alone forces **critical**.
- Reinforced by: half the completed work was delivered late (delayRate 50%), review is saturated (50%), and the health score is only **36** (below 40).

**One-liner:** *"This team isn't buried in work — it's missing deadlines and bottlenecked in review. That's why it's flagged 'critical' rather than 'overloaded'. The team needs to unblock and finish, not get fewer tasks."*

---

## 4. Dashboard data — `GET /kpi/teams/{teamId}/dashboard?days=30`

One call → the team's pulse **plus** every member's focus score (great for the dashboard screen).

```json
{
  "teamId": "frontend-squad",
  "windowDays": 30,
  "pulse": { "state": "critical", "score": 36, "inputs": { "...": "see above" } },
  "focusScores": [
    { "email": "alice@nibras.com", "score": 79, "label": "good" },
    { "email": "bob@nibras.com",   "score": 73, "label": "good" },
    { "email": "carol@nibras.com", "score": 95, "label": "excellent" }
  ],
  "generatedAt": "2026-06-22T09:00:00.000Z"
}
```

*(Each `focusScores` entry actually includes the full `indicators` + `penalties` shown in section 2 — trimmed here for readability.)*

carol scores **95** because she has just one task and no switching, blockers, or reassignments.

**One-liner:** *"This is the single call the dashboard page makes: team health on top, each person's focus below — so a manager sees the whole team in one screen."*

---

## 5. Stored snapshots — `GET /kpi/snapshots?scope=board&scopeId={boardId}`

Every time a KPI is computed, it's saved. This endpoint returns that history so the dashboard can draw trend lines.

```json
{
  "snapshots": [
    {
      "id": "snap-2",
      "scope": "board",
      "scope_id": "website-revamp",
      "kpi_type": "operational",
      "payload": { "adtDays": 7.5, "vrr": 50, "err": 7.69, "reviewSaturation": 50 },
      "generated_at": "2026-06-22T09:00:00.000Z"
    },
    {
      "id": "snap-1",
      "scope": "board",
      "scope_id": "website-revamp",
      "kpi_type": "operational",
      "payload": { "adtDays": 9.2, "vrr": 40, "err": 15, "reviewSaturation": 60 },
      "generated_at": "2026-06-15T09:00:00.000Z"
    }
  ]
}
```

**Reading it:** comparing the two saved runs, delivery time dropped 9.2 → 7.5 days, release rate rose 40% → 50%, rework fell 15% → 8%. **The board is improving week over week.**

**One-liner:** *"Because we store every result, we can show trends — not just today's snapshot. This is how the dashboard proves things are getting better or worse."*

---

## Cheat sheet

| Endpoint | Answers | Example headline |
|---|---|---|
| `/kpi/boards/{id}` | How is work flowing? | "Ships in 7.5 days, 50% release rate" |
| `/kpi/users/{email}/focus` | Can this person concentrate? | "alice 79/good, bob 73/good" |
| `/kpi/teams/{id}/pulse` | Is this team healthy? | "critical — missing deadlines" |
| `/kpi/teams/{id}/dashboard` | Whole team at a glance | "pulse + 3 focus scores" |
| `/kpi/snapshots` | Are we improving? | "delivery 9.2 → 7.5 days" |
