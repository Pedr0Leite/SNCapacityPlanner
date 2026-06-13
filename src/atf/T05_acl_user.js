// T05 ACL — user role. Composition: ATF [Impersonate: capplan_user_test (ONLY
// x_335329_capplan.user)] -> [Run Server Side Script: this body].
// Asserts: read via GlideRecordSecure succeeds; insert via GlideRecordSecure fails.
// PREREQS: the §8.2 ACL matrix must exist (MANUAL_STEPS §3) and a test user
// holding ONLY the .user role.
(function (outputs, steps, params, stepResult, assertEqual) {
    var TBL = 'x_335329_capplan_allocation';
    var msgs = [], ok = true;

    // read should succeed (canRead true for .user)
    var rd = new GlideRecordSecure(TBL);
    rd.setLimit(1);
    rd.query();
    var canRead = rd.canRead();
    if (!canRead) { ok = false; msgs.push('user cannot READ allocation (expected read OK)'); }

    // insert should be denied (create requires .planner)
    function firstId(table) {
        var gr = new GlideRecord(table); gr.setLimit(1); gr.query();
        return gr.next() ? gr.getUniqueValue() : null;
    }
    var pid = firstId('x_335329_capplan_project');
    var tid = firstId('x_335329_capplan_team');
    var ins = new GlideRecordSecure(TBL);
    ins.initialize();
    if (pid) ins.setValue('project', pid);
    if (tid) ins.setValue('team', tid);
    ins.setValue('year', 2098); ins.setValue('month', 1); ins.setValue('fte', 1);
    var id = ins.insert();
    if (id) {
        ok = false; msgs.push('user INSERT succeeded (expected denied), id=' + id);
        var cg = new GlideRecord(TBL); if (cg.get(id)) cg.deleteRecord(); // cleanup if leaked
    }

    if (ok) { stepResult.setSuccess(); stepResult.setOutputMessage('T05 ok: .user read OK, insert denied'); }
    else { stepResult.setFailed(); stepResult.setOutputMessage('T05 FAIL: ' + msgs.join(' | ')); }
})(outputs, steps, params, stepResult, assertEqual);
