# Capacity Planner — Operator Manual Steps (UI only)

These items cannot be done via the MCP REST Table API on this instance — the
integration user gets **HTTP 403** writing to `sys_dictionary`, `sys_index`,
and the `sys_db_object` collection attributes (cross-scope system-table
protection). Per build spec §16, the operator performs these in Studio/UI.
None of them block Phases 4–7; functional uniqueness is already enforced by
the duplicate-guard Business Rules (BR-01, BR-03).

## 1. Table auditing (spec §6 — required)
In **System Definition → Tables** (or Studio), open each table and tick
**Controls → Audit = true**:
- [ ] `x_335329_capplan_project`
- [ ] `x_335329_capplan_allocation`

## 2. Database indexes (spec §6.4 / §6.5 — "mandatory before seeding")
Table → **Database Indexes → New** on each table:
- [ ] `x_335329_capplan_headcount` — **UNIQUE** on (team, year, month)
- [ ] `x_335329_capplan_allocation` — **UNIQUE** on (project, team, year, month)
- [ ] `x_335329_capplan_allocation` — non-unique on (team, year)
- [ ] `x_335329_capplan_allocation` — non-unique on (year)

> ponytail: indexes are a perf/integrity belt-and-braces; BR-01/BR-03 already
> abort duplicates with a clean message. Add the indexes before the dataset
> grows past a few thousand allocation rows. Seeding ~1,500 rows works without
> them but the unique indexes are the durable safety net.
