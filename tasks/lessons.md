# Capacity Planner — Lessons Log

Corrections and lessons learned during the build, appended per phase (spec §16).

## Phase 1
- **Tooling:** The Git Bash (`Bash` tool) CANNOT write/create files under the OneDrive-synced repo path (`C:\Users\PLEITE\OneDrive - Unit4\...`) — `cp`/`touch` fail with "No such file or directory" even though reads succeed. Use the **PowerShell** tool (or Write/Edit tools) for all file creation under this repo. Bash is fine for reads and for /tmp work.
- SheetJS 0.18.5 vendored from npm registry tarball (`registry.npmjs.org/xlsx/-/xlsx-0.18.5.tgz`), not the CDN (cdn.sheetjs.com returned empty). dist/xlsx.full.min.js = 881,727 bytes.

