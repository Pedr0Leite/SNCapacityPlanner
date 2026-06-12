# Capacity Planner — Lessons Log

Corrections and lessons learned during the build, appended per phase (spec §16).

## Phase 1
- **Tooling:** The Git Bash (`Bash` tool) CANNOT write/create files under the OneDrive-synced repo path (`C:\Users\PLEITE\OneDrive - Unit4\...`) — `cp`/`touch` fail with "No such file or directory" even though reads succeed. Use the **PowerShell** tool (or Write/Edit tools) for all file creation under this repo. Bash is fine for reads and for /tmp work.
- SheetJS 0.18.5 vendored from npm registry tarball (`registry.npmjs.org/xlsx/-/xlsx-0.18.5.tgz`), not the CDN (cdn.sheetjs.com returned empty). dist/xlsx.full.min.js = 881,727 bytes.

## Phase 3
- **Tables via REST work cleanly:** inserting a `sys_db_object` row over the Table API auto-creates the physical Collection + the 6 system fields; columns then added as `sys_dictionary` rows. No Studio/UI needed for table+column DDL.
- **`create_business_rule` MCP tool leaves action flags OFF.** It creates the sys_script with `action_insert=action_update=false`, so the BR never fires. Always PATCH `sys_script` to set `action_insert`/`action_update`/`action_delete` after creating a BR with this tool.
- **Scoped before-BR `setAbortAction(true)` returns HTTP 403** through the REST Table API (abort is surfaced as access-denied, not a 400/validation error). To distinguish a BR abort from a real ACL block, also run a valid insert on the same table — if that succeeds, the 403 was the BR.
- **Auditing cannot be toggled via Table API:** `sys_db_object.attributes` PATCH is silently ignored (mod_count unchanged), and the Collection `sys_dictionary` row is 403-protected. Must be done in the UI (or via script, which is unavailable here).
- **DB indexes cannot be created via Table API:** `sys_index` is 403 on both read and write. Index creation needs the index-manager server script (sys_trigger jobs not claimed on this PDI) or the Table > Database Indexes UI. Application-layer duplicate guards (BRs) cover functional uniqueness in the interim.
- **MCP `delete_record` reports `Expecting value: line 1 column 1` on success** — that error is the client mis-parsing an empty 204 No Content body; the delete actually succeeded (verify with a follow-up query). Same for `sys_db_object.attributes` no-op PATCH returning success.
- **Socket-closed errors on `create_record` mean the write did NOT land** — re-query by natural key before retrying to avoid duplicates (happened twice: team.name, project insert).

## Phase 4
- **`sys_security_acl` is 403 on REST write** (same cross-scope system-table protection as sys_dictionary/sys_index). All ACL creation must go to the operator UI checklist (MANUAL_STEPS.md §3). Did not spin — stopped after the first 4 failed creates, recorded, moved on.
- **"Create access controls" generated NO default ACLs** for these scoped tables — verified 0 capplan rows in `sys_security_acl` before building. So Phase 4 is a clean create of 21 ACLs, not an edit-the-defaults exercise; there is no leftover empty-role ACL granting broad access to worry about.
- **ACL operation sys_ids are literal strings** (`read`/`create`/`write`/`delete`) — `sys_security_operation.sys_id == name` for the four CRUD ops (unlike `report_view` which is hashed). Handy for scripted ACL creation.
- **ACL `name` field stores the table name** (e.g. `x_335329_capplan_project`), or `<table>.<field>` for field ACLs; `type=record`, `operation` is a reference. Query existing ACLs with `nameLIKE<scope>`.

