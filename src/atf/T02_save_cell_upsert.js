// T02 Save cell upsert — ATF "Run Server Side Script" step body.
// saveAllocation create -> update (same sys_id) -> delete (fte 0); count returns to baseline.
// Uses an isolated month (year 2099, month 12) on a real project+team so it never
// collides with seeded data. Runs as admin (satisfies planner role check).
(function (outputs, steps, params, stepResult, assertEqual) {
    var TBL = 'x_335329_capplan_allocation';
    var YEAR = 2099, MONTH = 12;

    function firstId(table) {
        var gr = new GlideRecord(table); gr.setLimit(1); gr.query();
        return gr.next() ? gr.getUniqueValue() : null;
    }
    function cellCount(p, t) {
        var gr = new GlideRecord(TBL);
        gr.addQuery('project', p); gr.addQuery('team', t);
        gr.addQuery('year', YEAR); gr.addQuery('month', MONTH);
        gr.query(); return gr.getRowCount();
    }

    var pid = firstId('x_335329_capplan_project');
    var tid = firstId('x_335329_capplan_team');
    if (!pid || !tid) { stepResult.setFailed(); stepResult.setOutputMessage('T02 needs seeded project+team'); return; }

    var svc = new x_335329_capplan.CapacityPlannerService();
    var msgs = [], ok = true;
    var baseline = cellCount(pid, tid);

    var r1 = svc.saveAllocation(pid, tid, YEAR, MONTH, 0.5);
    if (!r1.ok || !r1.sysId) { ok = false; msgs.push('create failed: ' + JSON.stringify(r1)); }
    var id1 = r1.sysId;

    var r2 = svc.saveAllocation(pid, tid, YEAR, MONTH, 0.7);
    if (!r2.ok || r2.sysId !== id1) { ok = false; msgs.push('update did not reuse sys_id: ' + JSON.stringify(r2)); }

    var r3 = svc.saveAllocation(pid, tid, YEAR, MONTH, 0);
    if (!r3.ok || !r3.deleted) { ok = false; msgs.push('delete failed: ' + JSON.stringify(r3)); }

    var after = cellCount(pid, tid);
    if (after !== baseline) { ok = false; msgs.push('count not restored: baseline=' + baseline + ' after=' + after); }

    // safety cleanup
    var cg = new GlideRecord(TBL);
    cg.addQuery('project', pid); cg.addQuery('team', tid);
    cg.addQuery('year', YEAR); cg.addQuery('month', MONTH);
    cg.deleteMultiple();

    if (ok) { stepResult.setSuccess(); stepResult.setOutputMessage('T02 ok: create/update(same id)/delete, count restored'); }
    else { stepResult.setFailed(); stepResult.setOutputMessage('T02 FAIL: ' + msgs.join(' | ')); }
})(outputs, steps, params, stepResult, assertEqual);
