// T06 ACL — planner. Composition: ATF [Impersonate: capplan_planner_test (ONLY
// x_335329_capplan.planner, which contains .user)] -> [Run Server Side Script: this body].
// Asserts: allocation CRUD via GlideRecordSecure succeeds; team insert fails.
// PREREQS: §8.2 ACL matrix exists; a test user holding ONLY the .planner role.
(function (outputs, steps, params, stepResult, assertEqual) {
    var ALLOC = 'x_335329_capplan_allocation';
    var TEAM = 'x_335329_capplan_team';
    var msgs = [], ok = true;

    function firstId(table) {
        var gr = new GlideRecord(table); gr.setLimit(1); gr.query();
        return gr.next() ? gr.getUniqueValue() : null;
    }
    var pid = firstId('x_335329_capplan_project');
    var tid = firstId(TEAM);
    if (!pid || !tid) { stepResult.setFailed(); stepResult.setOutputMessage('T06 needs seeded project+team'); return; }

    // allocation create (planner allowed) on isolated cell
    var ins = new GlideRecordSecure(ALLOC);
    ins.initialize();
    ins.setValue('project', pid); ins.setValue('team', tid);
    ins.setValue('year', 2097); ins.setValue('month', 1); ins.setValue('fte', 1);
    var id = ins.insert();
    if (!id) { ok = false; msgs.push('planner INSERT allocation denied (expected OK)'); }

    if (id) {
        // update
        var up = new GlideRecordSecure(ALLOC);
        if (up.get(id)) { up.setValue('fte', 2); if (!up.update()) { ok = false; msgs.push('planner UPDATE denied'); } }
        // delete
        var del = new GlideRecordSecure(ALLOC);
        if (del.get(id)) { if (!del.deleteRecord()) { ok = false; msgs.push('planner DELETE denied'); } }
    }

    // team insert must be denied (team create requires .admin)
    var t = new GlideRecordSecure(TEAM);
    t.initialize();
    t.setValue('name', '__T06_should_not_exist__'); t.setValue('order', 9999);
    var tId = t.insert();
    if (tId) {
        ok = false; msgs.push('planner TEAM insert succeeded (expected denied)');
        var cg = new GlideRecord(TEAM); if (cg.get(tId)) cg.deleteRecord();
    }

    if (ok) { stepResult.setSuccess(); stepResult.setOutputMessage('T06 ok: planner allocation CRUD OK, team insert denied'); }
    else { stepResult.setFailed(); stepResult.setOutputMessage('T06 FAIL: ' + msgs.join(' | ')); }
})(outputs, steps, params, stepResult, assertEqual);
