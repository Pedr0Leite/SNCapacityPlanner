var CapacityPlannerSeedData = Class.create();
CapacityPlannerSeedData.prototype = {

    initialize: function () {
        this.SCOPE = 'x_335329_capplan';
        this.T_AREA = 'x_335329_capplan_area';
        this.T_TEAM = 'x_335329_capplan_team';
        this.T_PROJECT = 'x_335329_capplan_project';
        this.T_HEADCOUNT = 'x_335329_capplan_headcount';
        this.T_ALLOCATION = 'x_335329_capplan_allocation';

        // Per-table tally of created/updated/skipped.
        this._stats = {};
        this._errors = [];

        // Natural-key resolution caches (name -> sys_id).
        this._areaByName = {};
        this._teamByName = {};
    },

    // ---------------------------------------------------------------------
    // Helpers
    // ---------------------------------------------------------------------

    _tally: function (table) {
        if (!this._stats[table]) {
            this._stats[table] = { created: 0, updated: 0, skipped: 0 };
        }
        return this._stats[table];
    },

    _err: function (msg) {
        this._errors.push(msg);
        gs.error('[CapacityPlannerSeedData] ' + msg);
    },

    _trim: function (v) {
        return (v === null || v === undefined) ? '' : ('' + v).trim();
    },

    _toFloat: function (v) {
        const f = parseFloat(v);
        return isNaN(f) ? 0 : Math.round(f * 100) / 100;
    },

    _toInt: function (v) {
        const i = parseInt(v, 10);
        return isNaN(i) ? null : i;
    },

    // ---------------------------------------------------------------------
    // Public entry point
    // ---------------------------------------------------------------------

    /**
     * Idempotent seed loader. Consumes the §12.2 JSON shape:
     *   {areas:[], teams:[], headcount:[], projects:[{...,allocations:[{team,month,fte}]}]}
     * Load order: Areas -> Teams -> Projects -> Allocations -> Headcount.
     * Runs as admin with plain GlideRecord (NOT Secure). Aborts the whole
     * run if any hard error occurs before mutation of later tables.
     *
     * @param {Object|string} payload - parsed JSON object or JSON string.
     * @param {number} [year] - planning year for allocations/headcount; defaults to default_year.
     * @returns {Object} {ok, stats, errors}
     */
    load: function (payload, year) {
        const data = (typeof payload === 'string') ? JSON.parse(payload) : payload;
        if (!data || typeof data !== 'object') {
            this._err('Invalid payload: not an object.');
            return this._summary(false);
        }

        const y = this._toInt(year) ||
            this._toInt(gs.getProperty(this.SCOPE + '.default_year', '2026')) || 2026;

        // 1. Areas
        this._loadAreas(data.areas || []);
        if (this._errors.length > 0) {
            return this._summary(false);
        }

        // 2. Teams
        this._loadTeams(data.teams || []);
        if (this._errors.length > 0) {
            return this._summary(false);
        }

        // 3. Projects + 4. Allocations (nested per project)
        this._loadProjects(data.projects || [], y);
        if (this._errors.length > 0) {
            return this._summary(false);
        }

        // 5. Headcount
        this._loadHeadcount(data.headcount || [], y);

        return this._summary(this._errors.length === 0);
    },

    _summary: function (ok) {
        let line = '[CapacityPlannerSeedData] Summary (ok=' + ok + '): ';
        for (const t in this._stats) {
            if (this._stats.hasOwnProperty(t)) {
                const s = this._stats[t];
                line += t + '{c:' + s.created + ',u:' + s.updated + ',s:' + s.skipped + '} ';
            }
        }
        gs.info(line);
        if (this._errors.length > 0) {
            gs.error('[CapacityPlannerSeedData] ABORTED with ' + this._errors.length +
                ' error(s): ' + this._errors.join(' | '));
        }
        return { ok: ok, stats: this._stats, errors: this._errors };
    },

    // ---------------------------------------------------------------------
    // Loaders (natural-key idempotent upserts)
    // ---------------------------------------------------------------------

    /** Upsert areas keyed by name. */
    _loadAreas: function (areas) {
        const tally = this._tally(this.T_AREA);
        for (let i = 0; i < areas.length; i++) {
            const a = areas[i] || {};
            const name = this._trim(a.name);
            if (!name) {
                tally.skipped++;
                continue;
            }
            const gr = new GlideRecord(this.T_AREA);
            gr.addQuery('name', name);
            gr.setLimit(1);
            gr.query();
            if (gr.next()) {
                gr.setValue('color', this._trim(a.color));
                gr.setValue('badge_bg', this._trim(a.badgeBg || a.badge_bg));
                gr.setValue('badge_fg', this._trim(a.badgeFg || a.badge_fg));
                if (a.order !== undefined && a.order !== null) {
                    gr.setValue('order', this._toInt(a.order));
                }
                gr.update();
                tally.updated++;
                this._areaByName[name] = gr.getUniqueValue();
            } else {
                const ins = new GlideRecord(this.T_AREA);
                ins.initialize();
                ins.setValue('name', name);
                ins.setValue('color', this._trim(a.color));
                ins.setValue('badge_bg', this._trim(a.badgeBg || a.badge_bg));
                ins.setValue('badge_fg', this._trim(a.badgeFg || a.badge_fg));
                if (a.order !== undefined && a.order !== null) {
                    ins.setValue('order', this._toInt(a.order));
                }
                ins.setValue('active', true);
                const id = ins.insert();
                if (!id) {
                    this._err('Failed to insert area: ' + name);
                    continue;
                }
                tally.created++;
                this._areaByName[name] = id.toString();
            }
        }
    },

    /** Upsert teams keyed by name. */
    _loadTeams: function (teams) {
        const tally = this._tally(this.T_TEAM);
        for (let i = 0; i < teams.length; i++) {
            const t = teams[i] || {};
            const name = this._trim(t.name);
            if (!name) {
                tally.skipped++;
                continue;
            }
            const gr = new GlideRecord(this.T_TEAM);
            gr.addQuery('name', name);
            gr.setLimit(1);
            gr.query();
            if (gr.next()) {
                if (t.order !== undefined && t.order !== null) {
                    gr.setValue('order', this._toInt(t.order));
                }
                gr.update();
                tally.updated++;
                this._teamByName[name] = gr.getUniqueValue();
            } else {
                const ins = new GlideRecord(this.T_TEAM);
                ins.initialize();
                ins.setValue('name', name);
                if (t.order !== undefined && t.order !== null) {
                    ins.setValue('order', this._toInt(t.order));
                }
                ins.setValue('active', true);
                const id = ins.insert();
                if (!id) {
                    this._err('Failed to insert team: ' + name);
                    continue;
                }
                tally.created++;
                this._teamByName[name] = id.toString();
            }
        }
    },

    /** Resolve an area sys_id by name (cache-first). */
    _resolveArea: function (name) {
        const n = this._trim(name);
        if (!n) {
            return '';
        }
        if (this._areaByName.hasOwnProperty(n)) {
            return this._areaByName[n];
        }
        const gr = new GlideRecord(this.T_AREA);
        gr.addQuery('name', n);
        gr.setLimit(1);
        gr.query();
        const id = gr.next() ? gr.getUniqueValue() : '';
        this._areaByName[n] = id;
        return id;
    },

    /** Resolve a team sys_id by name (cache-first). */
    _resolveTeam: function (name) {
        const n = this._trim(name);
        if (!n) {
            return '';
        }
        if (this._teamByName.hasOwnProperty(n)) {
            return this._teamByName[n];
        }
        const gr = new GlideRecord(this.T_TEAM);
        gr.addQuery('name', n);
        gr.setLimit(1);
        gr.query();
        const id = gr.next() ? gr.getUniqueValue() : '';
        this._teamByName[n] = id;
        return id;
    },

    /** Upsert projects keyed by name + initiatives_group, then their allocations. */
    _loadProjects: function (projects, year) {
        const tally = this._tally(this.T_PROJECT);
        for (let i = 0; i < projects.length; i++) {
            const p = projects[i] || {};
            const name = this._trim(p.name);
            if (!name) {
                tally.skipped++;
                continue;
            }
            const ig = this._trim(p.initiatives_group);
            const areaId = this._resolveArea(p.area);
            if (!areaId) {
                this._err('Project "' + name + '" references unknown area "' +
                    this._trim(p.area) + '".');
                continue;
            }

            // Natural key: name + initiatives_group.
            const gr = new GlideRecord(this.T_PROJECT);
            gr.addQuery('name', name);
            gr.addQuery('initiatives_group', ig);
            gr.setLimit(1);
            gr.query();

            let projId;
            if (gr.next()) {
                this._applyProjectFields(gr, p, areaId, ig);
                gr.update();
                tally.updated++;
                projId = gr.getUniqueValue();
            } else {
                const ins = new GlideRecord(this.T_PROJECT);
                ins.initialize();
                ins.setValue('name', name);
                this._applyProjectFields(ins, p, areaId, ig);
                ins.setValue('active', true);
                const id = ins.insert();
                if (!id) {
                    this._err('Failed to insert project: ' + name);
                    continue;
                }
                tally.created++;
                projId = id.toString();
            }

            // Nested allocations.
            this._loadAllocations(projId, name, p.allocations || [], year);
        }
    },

    /** Apply non-key project fields to a (new or existing) GlideRecord. */
    _applyProjectFields: function (gr, p, areaId, ig) {
        gr.setValue('area', areaId);
        gr.setValue('priority', this._trim(p.priority));
        gr.setValue('t_shirt_size', this._trim(p.t_shirt_size));
        gr.setValue('type', this._trim(p.type));
        gr.setValue('steerco_status', this._trim(p.steerco_status));
        gr.setValue('snow_initiative', this._trim(p.snow_initiative));
        gr.setValue('snow_status', this._trim(p.snow_status));
        gr.setValue('ado_id', this._trim(p.ado_id));
        gr.setValue('ado_status', this._trim(p.ado_status));
        gr.setValue('initiatives_group', ig);
        gr.setValue('comments', this._trim(p.comments));

        const sd = this._trim(p.start_date);
        const ed = this._trim(p.end_date);
        gr.setValue('start_date', sd || '');
        gr.setValue('end_date', ed || '');
    },

    /** Upsert allocations keyed by project + team + year + month. fte<=0 skipped. */
    _loadAllocations: function (projectId, projectName, allocations, year) {
        const tally = this._tally(this.T_ALLOCATION);
        for (let i = 0; i < allocations.length; i++) {
            const al = allocations[i] || {};
            const teamId = this._resolveTeam(al.team);
            if (!teamId) {
                // Stray / non-canonical team -> log and skip (do not create team).
                gs.warn('[CapacityPlannerSeedData] Project "' + projectName +
                    '" allocation skipped: unknown team "' + this._trim(al.team) + '".');
                tally.skipped++;
                continue;
            }
            const month = this._toInt(al.month);
            if (month === null || month < 1 || month > 12) {
                tally.skipped++;
                continue;
            }
            const fte = this._toFloat(al.fte);
            if (fte <= 0) {
                // Zero/negative => no allocation row (mirrors fte==0 delete rule).
                tally.skipped++;
                continue;
            }

            const gr = new GlideRecord(this.T_ALLOCATION);
            gr.addQuery('project', projectId);
            gr.addQuery('team', teamId);
            gr.addQuery('year', year);
            gr.addQuery('month', month);
            gr.setLimit(1);
            gr.query();
            if (gr.next()) {
                gr.setValue('fte', fte);
                gr.update();
                tally.updated++;
            } else {
                const ins = new GlideRecord(this.T_ALLOCATION);
                ins.initialize();
                ins.setValue('project', projectId);
                ins.setValue('team', teamId);
                ins.setValue('year', year);
                ins.setValue('month', month);
                ins.setValue('fte', fte);
                const id = ins.insert();
                if (!id) {
                    this._err('Failed to insert allocation for project "' + projectName +
                        '" team ' + teamId + ' month ' + month);
                    continue;
                }
                tally.created++;
            }
        }
    },

    /**
     * Upsert headcount keyed by team + year + month.
     * Accepts either flat rows [{team, month, fte, year?}] or a nested map
     * {teamName:{month:fte}} (§12.2 HEADCOUNT shape).
     */
    _loadHeadcount: function (headcount, year) {
        const tally = this._tally(this.T_HEADCOUNT);
        const rows = [];

        if (Array.isArray(headcount)) {
            for (let i = 0; i < headcount.length; i++) {
                const h = headcount[i] || {};
                rows.push({
                    team: h.team,
                    month: h.month,
                    fte: h.fte,
                    year: h.year
                });
            }
        } else if (headcount && typeof headcount === 'object') {
            for (const teamNm in headcount) {
                if (!headcount.hasOwnProperty(teamNm)) {
                    continue;
                }
                const monthMap = headcount[teamNm] || {};
                for (const mk in monthMap) {
                    if (!monthMap.hasOwnProperty(mk)) {
                        continue;
                    }
                    rows.push({ team: teamNm, month: mk, fte: monthMap[mk] });
                }
            }
        }

        for (let r = 0; r < rows.length; r++) {
            const row = rows[r];
            const teamId = this._resolveTeam(row.team);
            if (!teamId) {
                gs.warn('[CapacityPlannerSeedData] Headcount skipped: unknown team "' +
                    this._trim(row.team) + '".');
                tally.skipped++;
                continue;
            }
            const month = this._toInt(row.month);
            if (month === null || month < 1 || month > 12) {
                tally.skipped++;
                continue;
            }
            const yr = this._toInt(row.year) || year;
            const fte = this._toFloat(row.fte);

            const gr = new GlideRecord(this.T_HEADCOUNT);
            gr.addQuery('team', teamId);
            gr.addQuery('year', yr);
            gr.addQuery('month', month);
            gr.setLimit(1);
            gr.query();
            if (gr.next()) {
                gr.setValue('fte', fte);
                gr.update();
                tally.updated++;
            } else {
                const ins = new GlideRecord(this.T_HEADCOUNT);
                ins.initialize();
                ins.setValue('team', teamId);
                ins.setValue('year', yr);
                ins.setValue('month', month);
                ins.setValue('fte', fte);
                const id = ins.insert();
                if (!id) {
                    this._err('Failed to insert headcount team ' + teamId +
                        ' month ' + month);
                    continue;
                }
                tally.created++;
            }
        }
    },

    type: 'CapacityPlannerSeedData'
};
