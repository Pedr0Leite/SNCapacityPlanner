/**
 * Capacity Planner widget — server script (thin router per spec §9.3).
 *
 * Delegates ALL logic to the scoped Script Include CapacityPlannerService.
 * Runs in app scope (x_335329_capplan) under the user's context, so every
 * data access inside the service uses GlideRecordSecure and ACLs apply.
 *
 * Contract:
 *   - No input (first render)  -> data.bootstrap = svc.getBootstrap(year)
 *   - input.action == bootstrap/saveCell/saveBulk/removeTeam/export
 *   - data.canEdit = gs.hasRole('x_335329_capplan.planner')  (gates edit UI)
 *   - Every MUTATING action re-checks the planner role here as a first gate
 *     AND inside the service (defence in depth) -> data.error = 'insufficient_role'
 *   - ids validated /^[0-9a-f]{32}$/, month 1..12, numbers parseFloat/parseInt + isNaN.
 */
(function () {
    var SCOPE = 'x_335329_capplan';
    var ID_RE = /^[0-9a-f]{32}$/;

    var svc = new CapacityPlannerService();
    var defaultYear = parseInt(gs.getProperty(SCOPE + '.default_year', '2026'), 10);
    if (isNaN(defaultYear)) {
        defaultYear = 2026;
    }

    // Surface edit capability to the client (controls all edit affordances).
    data.canEdit = gs.hasRole(SCOPE + '.planner');
    data.year = defaultYear;

    // First render (spUtil embeds data with no input).
    if (!input) {
        data.bootstrap = svc.getBootstrap(defaultYear);
        return;
    }

    var action = input.action;

    // --- helpers --------------------------------------------------------
    function isId(v) {
        return typeof v === 'string' && ID_RE.test(v);
    }

    function normYear(v) {
        var y = parseInt(v, 10);
        if (isNaN(y) || y < 2000 || y > 2100) {
            return defaultYear;
        }
        return y;
    }

    function requirePlanner() {
        if (!gs.hasRole(SCOPE + '.planner')) {
            data.error = 'insufficient_role';
            return false;
        }
        return true;
    }

    switch (action) {

        case 'bootstrap':
            data.bootstrap = svc.getBootstrap(normYear(input.year));
            break;

        case 'saveCell':
            if (!requirePlanner()) { break; }
            if (!isId(input.projectId) || !isId(input.teamId)) {
                data.result = { ok: false, error: 'invalid_id' };
                break;
            }
            var mc = parseInt(input.month, 10);
            if (isNaN(mc) || mc < 1 || mc > 12) {
                data.result = { ok: false, error: 'invalid_month' };
                break;
            }
            var fc = parseFloat(input.fte);
            if (isNaN(fc) || fc < 0) {
                data.result = { ok: false, error: 'invalid_fte' };
                break;
            }
            data.result = svc.saveAllocation(
                input.projectId, input.teamId, normYear(input.year), mc, fc);
            break;

        case 'saveBulk':
            if (!requirePlanner()) { break; }
            if (!input.ops || !Array.isArray(input.ops)) {
                data.result = { ok: false, error: 'invalid_ops', results: [] };
                break;
            }
            data.result = svc.saveAllocations(input.ops);
            break;

        case 'removeTeam':
            if (!requirePlanner()) { break; }
            if (!isId(input.projectId) || !isId(input.teamId)) {
                data.result = { ok: false, error: 'invalid_id' };
                break;
            }
            data.result = svc.removeTeamFromProject(
                input.projectId, input.teamId, normYear(input.year));
            break;

        case 'export':
            // Read-only aggregation; available to any .user.
            data.result = svc.getExportData(normYear(input.year), input.changes);
            break;

        default:
            data.error = 'Unknown action: ' + action;
    }
})();
