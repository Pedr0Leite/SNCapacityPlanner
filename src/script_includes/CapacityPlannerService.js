var CapacityPlannerService = Class.create();
CapacityPlannerService.prototype = {

    initialize: function () {
        this.SCOPE = 'x_335329_capplan';
        this.T_AREA = 'x_335329_capplan_area';
        this.T_TEAM = 'x_335329_capplan_team';
        this.T_PROJECT = 'x_335329_capplan_project';
        this.T_HEADCOUNT = 'x_335329_capplan_headcount';
        this.T_ALLOCATION = 'x_335329_capplan_allocation';

        this.ID_RE = /^[0-9a-f]{32}$/;

        // Month integer -> label (client maps too, but we expose labels for export).
        this.MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
            'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

        // Pipeline column / snow_status order (SS_ORDER from prototype).
        // Empty value ('') => "No status" rendered last.
        this.SS_ORDER = ['approved', 'screening', 'qualified', 'pending',
            'new', 'completed', 'canceled', ''];

        this.SS_LABELS = {
            'approved': 'Approved',
            'screening': 'Screening',
            'qualified': 'Qualified',
            'pending': 'Pending',
            'new': 'New',
            'completed': 'Completed',
            'canceled': 'Canceled',
            '': 'No status'
        };

        this.PRIORITY_ORDER = ['0', '1', '2', '3', '4'];
        this.PRIORITY_LABELS = {
            '0': 'P0 BAU',
            '1': 'P1 High',
            '2': 'P2 Medium',
            '3': 'P3 Low',
            '4': 'P4'
        };

        this.ADO_ORDER = ['new', 'in_progress', 'done', 'on_hold'];
        this.ADO_LABELS = {
            'new': 'New',
            'in_progress': 'In Progress',
            'done': 'Done',
            'on_hold': 'On Hold'
        };

        this.TYPE_LABELS = {
            'project': 'Project',
            'bau': 'BAU',
            '': ''
        };
    },

    // ---------------------------------------------------------------------
    // Internal helpers
    // ---------------------------------------------------------------------

    /**
     * Validate a 32-char lowercase-hex sys_id.
     * @param {string} id
     * @returns {boolean}
     */
    _isValidId: function (id) {
        return typeof id === 'string' && this.ID_RE.test(id);
    },

    /**
     * Coerce and validate a planning year (4-digit int).
     * @param {*} year
     * @returns {number} normalized year, or the default_year property value.
     */
    _normYear: function (year) {
        let y = parseInt(year, 10);
        if (isNaN(y) || y < 2000 || y > 2100) {
            y = parseInt(gs.getProperty(this.SCOPE + '.default_year', '2026'), 10);
        }
        return y;
    },

    /**
     * Validate a month integer in 1..12.
     * @param {*} month
     * @returns {number} month 1..12, or NaN if invalid.
     */
    _normMonth: function (month) {
        const m = parseInt(month, 10);
        if (isNaN(m) || m < 1 || m > 12) {
            return NaN;
        }
        return m;
    },

    /**
     * Round an FTE value to 2 decimal places.
     * @param {number} v
     * @returns {number}
     */
    _round2: function (v) {
        return Math.round(v * 100) / 100;
    },

    /**
     * Read the per-cell FTE sanity cap from app property.
     * @returns {number}
     */
    _maxFte: function () {
        let cap = parseInt(gs.getProperty(this.SCOPE + '.max_fte_per_cell', '30'), 10);
        if (isNaN(cap) || cap <= 0) {
            cap = 30;
        }
        return cap;
    },

    /**
     * Re-check the planner role server-side. Never trust client state.
     * @returns {boolean}
     */
    _canEdit: function () {
        return gs.hasRole(this.SCOPE + '.planner');
    },

    /**
     * Build a label list from an ordered value array + label map.
     * @param {string[]} order
     * @param {Object} labels
     * @returns {Array<{value:string,label:string}>}
     */
    _choiceList: function (order, labels) {
        const out = [];
        for (let i = 0; i < order.length; i++) {
            const v = order[i];
            out.push({ value: v, label: labels.hasOwnProperty(v) ? labels[v] : v });
        }
        return out;
    },

    // ---------------------------------------------------------------------
    // Public API (§9.1)
    // ---------------------------------------------------------------------

    /**
     * Full bootstrap for one planning year. Returns a JSON-safe payload per
     * the §9.2 contract. Uses exactly THREE GlideRecord(Secure) bulk queries
     * (projects, allocations, headcount) plus small lookup queries for the
     * static reference tables (teams, areas). No N+1.
     *
     * GlideRecordSecure is used for project and allocation reads so ACLs are
     * enforced under user context; if reads are denied the arrays come back
     * empty rather than throwing.
     *
     * @param {number|string} year - planning year; defaults to default_year.
     * @returns {Object} {year, months[12], teams[], areas[], choices{}, headcount{}, projects[]}
     */
    getBootstrap: function (year) {
        const y = this._normYear(year);

        const payload = {
            year: y,
            months: this.MONTH_LABELS.slice(),
            teams: [],
            areas: [],
            choices: {
                priority: this._choiceList(this.PRIORITY_ORDER, this.PRIORITY_LABELS),
                snowStatus: this._choiceList(this.SS_ORDER, this.SS_LABELS),
                adoStatus: this._choiceList(this.ADO_ORDER, this.ADO_LABELS)
            },
            headcount: {},
            projects: []
        };

        // --- Teams (static reference; small) -----------------------------
        const teamGr = new GlideRecord(this.T_TEAM);
        teamGr.orderBy('order');
        teamGr.orderBy('name');
        teamGr.query();
        while (teamGr.next()) {
            payload.teams.push({
                id: teamGr.getUniqueValue(),
                name: teamGr.getValue('name'),
                order: parseInt(teamGr.getValue('order'), 10) || 0
            });
        }

        // --- Areas (static reference; small) -----------------------------
        const areaGr = new GlideRecord(this.T_AREA);
        areaGr.orderBy('order');
        areaGr.orderBy('name');
        areaGr.query();
        while (areaGr.next()) {
            payload.areas.push({
                id: areaGr.getUniqueValue(),
                name: areaGr.getValue('name'),
                color: areaGr.getValue('color') || '',
                badgeBg: areaGr.getValue('badge_bg') || '',
                badgeFg: areaGr.getValue('badge_fg') || ''
            });
        }

        // --- QUERY 1: projects (ordered by name) -------------------------
        // GlideRecordSecure: denied reads simply yield no rows.
        const projIndex = {}; // sys_id -> project object reference
        const projGr = new GlideRecordSecure(this.T_PROJECT);
        projGr.orderBy('name');
        projGr.query();
        while (projGr.next()) {
            const pid = projGr.getUniqueValue();
            const p = {
                id: pid,
                n: projGr.getValue('name') || '',
                a: projGr.getValue('area') || '',
                p: projGr.getValue('priority') || '',
                s: projGr.getValue('t_shirt_size') || '',
                ty: projGr.getValue('type') || '',
                sc: projGr.getValue('steerco_status') || '',
                snow: projGr.getValue('snow_initiative') || '',
                ado: projGr.getValue('ado_id') || '',
                ss: projGr.getValue('snow_status') || '',
                as: projGr.getValue('ado_status') || '',
                ig: projGr.getValue('initiatives_group') || '',
                comments: projGr.getValue('comments') || '',
                st: projGr.getValue('start_date') || '',
                en: projGr.getValue('end_date') || '',
                ta: {}
            };
            payload.projects.push(p);
            projIndex[pid] = p;
        }

        // --- QUERY 2: allocations for the year (ordered by project) ------
        // Single pass populates projects[].ta — O(rows), no per-project query.
        const allocGr = new GlideRecordSecure(this.T_ALLOCATION);
        allocGr.addQuery('year', y);
        allocGr.orderBy('project');
        allocGr.query();
        while (allocGr.next()) {
            const aProj = allocGr.getValue('project');
            const aTeam = allocGr.getValue('team');
            const aMonth = this._normMonth(allocGr.getValue('month'));
            if (isNaN(aMonth) || !projIndex.hasOwnProperty(aProj) || !aTeam) {
                continue;
            }
            const pObj = projIndex[aProj];
            if (!pObj.ta[aTeam]) {
                pObj.ta[aTeam] = {};
            }
            let fteVal = parseFloat(allocGr.getValue('fte'));
            if (isNaN(fteVal)) {
                fteVal = 0;
            }
            pObj.ta[aTeam][aMonth] = this._round2(fteVal);
        }

        // --- QUERY 3: headcount for the year (ordered by team) -----------
        // Headcount is reference data; plain GlideRecord read.
        const hcGr = new GlideRecord(this.T_HEADCOUNT);
        hcGr.addQuery('year', y);
        hcGr.orderBy('team');
        hcGr.query();
        while (hcGr.next()) {
            const hTeam = hcGr.getValue('team');
            const hMonth = this._normMonth(hcGr.getValue('month'));
            if (isNaN(hMonth) || !hTeam) {
                continue;
            }
            if (!payload.headcount[hTeam]) {
                payload.headcount[hTeam] = {};
            }
            let hFte = parseFloat(hcGr.getValue('fte'));
            if (isNaN(hFte)) {
                hFte = 0;
            }
            payload.headcount[hTeam][hMonth] = this._round2(hFte);
        }

        return payload;
    },

    /**
     * Upsert a single allocation cell. fte == 0 deletes the existing row.
     * Re-checks planner role. GlideRecordSecure so ACLs are enforced.
     *
     * @param {string} projectId - 32-char sys_id.
     * @param {string} teamId - 32-char sys_id.
     * @param {number|string} year
     * @param {number|string} month - 1..12.
     * @param {number|string} fte - >= 0; 0 deletes.
     * @returns {Object} {ok:boolean, sysId?:string, deleted?:boolean, error?:string}
     */
    saveAllocation: function (projectId, teamId, year, month, fte) {
        if (!this._canEdit()) {
            return { ok: false, error: 'insufficient_role' };
        }
        if (!this._isValidId(projectId)) {
            return { ok: false, error: 'invalid_project_id' };
        }
        if (!this._isValidId(teamId)) {
            return { ok: false, error: 'invalid_team_id' };
        }

        const y = parseInt(year, 10);
        if (isNaN(y) || y < 2000 || y > 2100) {
            return { ok: false, error: 'invalid_year' };
        }

        const m = this._normMonth(month);
        if (isNaN(m)) {
            return { ok: false, error: 'invalid_month' };
        }

        let f = parseFloat(fte);
        if (isNaN(f) || f < 0) {
            return { ok: false, error: 'invalid_fte' };
        }
        f = this._round2(f);

        const cap = this._maxFte();
        if (f > cap) {
            return { ok: false, error: 'fte_exceeds_cap' };
        }

        // Locate existing cell (unique by project,team,year,month).
        const gr = new GlideRecordSecure(this.T_ALLOCATION);
        gr.addQuery('project', projectId);
        gr.addQuery('team', teamId);
        gr.addQuery('year', y);
        gr.addQuery('month', m);
        gr.setLimit(1);
        gr.query();
        const found = gr.next();

        // fte == 0 => delete existing (or no-op if none).
        if (f === 0) {
            if (found) {
                const delOk = gr.deleteRecord();
                if (!delOk) {
                    return { ok: false, error: 'delete_denied' };
                }
            }
            return { ok: true, deleted: true };
        }

        if (found) {
            gr.setValue('fte', f);
            const upId = gr.update();
            if (!upId) {
                return { ok: false, error: 'update_denied' };
            }
            return { ok: true, sysId: upId.toString() };
        }

        const ins = new GlideRecordSecure(this.T_ALLOCATION);
        ins.initialize();
        ins.setValue('project', projectId);
        ins.setValue('team', teamId);
        ins.setValue('year', y);
        ins.setValue('month', m);
        ins.setValue('fte', f);
        const newId = ins.insert();
        if (!newId) {
            return { ok: false, error: 'insert_denied' };
        }
        return { ok: true, sysId: newId.toString() };
    },

    /**
     * Apply an array of cell ops. Returns one result object per op, in order.
     * Each op: {projectId, teamId, year, month, fte}.
     *
     * @param {Array<Object>} ops
     * @returns {Object} {ok:boolean, results:Array, error?:string}
     */
    saveAllocations: function (ops) {
        if (!this._canEdit()) {
            return { ok: false, error: 'insufficient_role', results: [] };
        }
        if (!ops || !Array.isArray(ops)) {
            return { ok: false, error: 'invalid_ops', results: [] };
        }

        const results = [];
        let allOk = true;
        for (let i = 0; i < ops.length; i++) {
            const op = ops[i] || {};
            const r = this.saveAllocation(op.projectId, op.teamId, op.year, op.month, op.fte);
            if (!r.ok) {
                allOk = false;
            }
            results.push(r);
        }
        return { ok: allOk, results: results };
    },

    /**
     * Validate that a project and team exist (grid rows are derived, no row
     * record is created). Returns team meta so the client can render the row.
     * Read-only — no role mutation check required.
     *
     * @param {string} projectId - 32-char sys_id.
     * @param {string} teamId - 32-char sys_id.
     * @returns {Object} {ok:boolean, team?:{id,name,order}, error?:string}
     */
    validateTeamForProject: function (projectId, teamId) {
        if (!this._isValidId(projectId)) {
            return { ok: false, error: 'invalid_project_id' };
        }
        if (!this._isValidId(teamId)) {
            return { ok: false, error: 'invalid_team_id' };
        }

        const projGr = new GlideRecordSecure(this.T_PROJECT);
        projGr.addQuery('sys_id', projectId);
        projGr.setLimit(1);
        projGr.query();
        if (!projGr.next()) {
            return { ok: false, error: 'project_not_found' };
        }

        const teamGr = new GlideRecord(this.T_TEAM);
        teamGr.addQuery('sys_id', teamId);
        teamGr.setLimit(1);
        teamGr.query();
        if (!teamGr.next()) {
            return { ok: false, error: 'team_not_found' };
        }

        return {
            ok: true,
            team: {
                id: teamGr.getUniqueValue(),
                name: teamGr.getValue('name'),
                order: parseInt(teamGr.getValue('order'), 10) || 0
            }
        };
    },

    /**
     * Delete all allocations for a project + team (optionally scoped to a
     * single year). Re-checks planner role. GlideRecordSecure.
     *
     * @param {string} projectId - 32-char sys_id.
     * @param {string} teamId - 32-char sys_id.
     * @param {number|string} [year] - optional; if valid, limits the delete.
     * @returns {Object} {ok:boolean, deleted?:number, error?:string}
     */
    removeTeamFromProject: function (projectId, teamId, year) {
        if (!this._canEdit()) {
            return { ok: false, error: 'insufficient_role' };
        }
        if (!this._isValidId(projectId)) {
            return { ok: false, error: 'invalid_project_id' };
        }
        if (!this._isValidId(teamId)) {
            return { ok: false, error: 'invalid_team_id' };
        }

        const gr = new GlideRecordSecure(this.T_ALLOCATION);
        gr.addQuery('project', projectId);
        gr.addQuery('team', teamId);

        const y = parseInt(year, 10);
        if (!isNaN(y) && y >= 2000 && y <= 2100) {
            gr.addQuery('year', y);
        }
        gr.query();

        let count = 0;
        while (gr.next()) {
            if (gr.deleteRecord()) {
                count++;
            }
        }
        return { ok: true, deleted: count };
    },

    /**
     * Build the three export datasets server-side as arrays of row-arrays
     * (header row first), per §11. Values rendered as LABELS, not codes.
     *
     * Sheet 1 "Soft & Hard Planning (2)": one row per project x team.
     * Sheet 2 "Capacity vs Headcount": per-team allocated/headcount/gap rows.
     * Sheet 3 "Change Log": session deltas supplied by the client.
     *
     * @param {number|string} year
     * @param {Array<Object>} changes - session change rows:
     *        {project, team, month, original, updated}. Optional.
     * @returns {Object} {ok, sheet1:{name,rows}, sheet2:{name,rows}, sheet3:{name,rows}}
     */
    getExportData: function (year, changes) {
        const y = this._normYear(year);

        // Reuse bootstrap: single source of truth for live data (still 3 bulk queries).
        const boot = this.getBootstrap(y);

        // Lookup maps for label rendering.
        const areaName = {};
        for (let ai = 0; ai < boot.areas.length; ai++) {
            areaName[boot.areas[ai].id] = boot.areas[ai].name;
        }
        const teamName = {};
        const teamsOrdered = boot.teams.slice();
        for (let ti = 0; ti < teamsOrdered.length; ti++) {
            teamName[teamsOrdered[ti].id] = teamsOrdered[ti].name;
        }
        const priLabel = this.PRIORITY_LABELS;
        const ssLabel = this.SS_LABELS;
        const adoLabel = this.ADO_LABELS;
        const typeLabel = this.TYPE_LABELS;
        const months = boot.months; // Jan..Dec

        // ---- Sheet 1: Soft & Hard Planning (2) --------------------------
        const s1Header = ['Areas', 'Priority', 'Tech Team', 'Type of work', 'ADO',
            'SNOW', 'ADO Status', 'SNOW status', 'SteerCo Status', 'Projects Name',
            'Initiatives Group', 'Dependency', 'T-Shirt Sizing', 'Start date', 'End date'];
        for (let sm = 0; sm < months.length; sm++) {
            s1Header.push(months[sm]);
        }
        s1Header.push('Comments');

        const s1Rows = [s1Header];
        for (let pi = 0; pi < boot.projects.length; pi++) {
            const pr = boot.projects[pi];
            const teamIdsForProject = [];
            for (const k in pr.ta) {
                if (pr.ta.hasOwnProperty(k)) {
                    teamIdsForProject.push(k);
                }
            }
            // One row per project x team that has allocations. If a project
            // has no allocations, emit a single row with blank team/months.
            if (teamIdsForProject.length === 0) {
                s1Rows.push(this._buildS1Row(pr, '', areaName, teamName, priLabel,
                    ssLabel, adoLabel, typeLabel));
            } else {
                // Render in team display order.
                for (let to = 0; to < teamsOrdered.length; to++) {
                    const tid = teamsOrdered[to].id;
                    if (pr.ta.hasOwnProperty(tid)) {
                        s1Rows.push(this._buildS1Row(pr, tid, areaName, teamName,
                            priLabel, ssLabel, adoLabel, typeLabel));
                    }
                }
            }
        }

        // ---- Sheet 2: Capacity vs Headcount -----------------------------
        // Per team: 3 logical rows (Allocated, Headcount, Gap), 12 months + total.
        const s2Header = ['Tech Team', 'Metric'];
        for (let s2m = 0; s2m < months.length; s2m++) {
            s2Header.push(months[s2m]);
        }
        s2Header.push('Total');
        const s2Rows = [s2Header];

        // Sum allocated per team per month across all projects.
        const allocByTeam = {}; // teamId -> {1..12: fte}
        for (let ap = 0; ap < boot.projects.length; ap++) {
            const ta = boot.projects[ap].ta;
            for (const atId in ta) {
                if (!ta.hasOwnProperty(atId)) {
                    continue;
                }
                if (!allocByTeam[atId]) {
                    allocByTeam[atId] = {};
                }
                for (const mk in ta[atId]) {
                    if (!ta[atId].hasOwnProperty(mk)) {
                        continue;
                    }
                    const cur = allocByTeam[atId][mk] || 0;
                    allocByTeam[atId][mk] = this._round2(cur + ta[atId][mk]);
                }
            }
        }

        for (let t2 = 0; t2 < teamsOrdered.length; t2++) {
            const tId = teamsOrdered[t2].id;
            const tNm = teamsOrdered[t2].name;

            const allocRow = [tNm, 'Allocated'];
            const hcRow = [tNm, 'Headcount'];
            const gapRow = [tNm, 'Gap'];
            let allocTot = 0, hcTot = 0, gapTot = 0;

            for (let mm = 1; mm <= 12; mm++) {
                let aVal = (allocByTeam[tId] && allocByTeam[tId][mm]) ? allocByTeam[tId][mm] : 0;
                let hVal = (boot.headcount[tId] && boot.headcount[tId][mm]) ? boot.headcount[tId][mm] : 0;
                aVal = this._round2(aVal);
                hVal = this._round2(hVal);
                const gVal = this._round2(hVal - aVal);

                allocRow.push(aVal);
                hcRow.push(hVal);
                gapRow.push(gVal);
                allocTot += aVal;
                hcTot += hVal;
                gapTot += gVal;
            }
            allocRow.push(this._round2(allocTot));
            hcRow.push(this._round2(hcTot));
            gapRow.push(this._round2(gapTot));

            s2Rows.push(allocRow);
            s2Rows.push(hcRow);
            s2Rows.push(gapRow);
        }

        // ---- Sheet 3: Change Log ----------------------------------------
        const s3Header = ['Project', 'Tech Team', 'Month', 'Original FTE', 'Updated FTE', 'Delta'];
        const s3Rows = [s3Header];
        if (changes && Array.isArray(changes)) {
            for (let ci = 0; ci < changes.length; ci++) {
                const ch = changes[ci] || {};
                let orig = parseFloat(ch.original);
                if (isNaN(orig)) {
                    orig = 0;
                }
                let upd = parseFloat(ch.updated);
                if (isNaN(upd)) {
                    upd = 0;
                }
                const cm = this._normMonth(ch.month);
                const monthLabel = isNaN(cm) ? '' : months[cm - 1];

                // Resolve project/team to display names if ids were passed.
                const projDisplay = ch.projectName || ch.project || '';
                const teamDisplay = ch.teamName ||
                    (teamName[ch.team] ? teamName[ch.team] : (ch.team || ''));

                s3Rows.push([
                    projDisplay,
                    teamDisplay,
                    monthLabel,
                    this._round2(orig),
                    this._round2(upd),
                    this._round2(upd - orig)
                ]);
            }
        }

        return {
            ok: true,
            sheet1: { name: 'Soft & Hard Planning (2)', rows: s1Rows },
            sheet2: { name: 'Capacity vs Headcount', rows: s2Rows },
            sheet3: { name: 'Change Log', rows: s3Rows }
        };
    },

    /**
     * Build a single Sheet-1 row (labels not codes) for a project x team.
     * @returns {Array}
     */
    _buildS1Row: function (pr, teamId, areaName, teamName, priLabel, ssLabel, adoLabel, typeLabel) {
        const row = [];
        row.push(areaName.hasOwnProperty(pr.a) ? areaName[pr.a] : '');               // Areas
        row.push(priLabel.hasOwnProperty(pr.p) ? priLabel[pr.p] : '');               // Priority
        row.push(teamId && teamName.hasOwnProperty(teamId) ? teamName[teamId] : '');  // Tech Team
        row.push(typeLabel.hasOwnProperty(pr.ty) ? typeLabel[pr.ty] : (pr.ty || '')); // Type of work
        row.push(pr.ado || '');                                                       // ADO
        row.push(pr.snow || '');                                                      // SNOW
        row.push(adoLabel.hasOwnProperty(pr.as) ? adoLabel[pr.as] : (pr.as || ''));   // ADO Status
        row.push(ssLabel.hasOwnProperty(pr.ss) ? ssLabel[pr.ss] : (pr.ss || ''));     // SNOW status
        row.push(pr.sc || '');                                                        // SteerCo Status
        row.push(pr.n || '');                                                         // Projects Name
        row.push(pr.ig || '');                                                        // Initiatives Group
        row.push('');                                                                 // Dependency (not in model)
        row.push(pr.s || '');                                                         // T-Shirt Sizing
        row.push(pr.st || '');                                                        // Start date
        row.push(pr.en || '');                                                        // End date

        // Jan..Dec values for this team (blank if none).
        const cell = teamId && pr.ta && pr.ta[teamId] ? pr.ta[teamId] : {};
        for (let m = 1; m <= 12; m++) {
            row.push(cell.hasOwnProperty(m) ? cell[m] : '');
        }

        row.push(pr.comments || '');                                                  // Comments
        return row;
    },

    type: 'CapacityPlannerService'
};
