// T03 Validation — ATF "Run Server Side Script" step body.
// fte=-1 and fte>cap rejected; month=13 rejected; bad sys_id rejected.
(function (outputs, steps, params, stepResult, assertEqual) {
    function firstId(table) {
        var gr = new GlideRecord(table); gr.setLimit(1); gr.query();
        return gr.next() ? gr.getUniqueValue() : null;
    }
    var pid = firstId('x_335329_capplan_project');
    var tid = firstId('x_335329_capplan_team');
    if (!pid || !tid) { stepResult.setFailed(); stepResult.setOutputMessage('T03 needs seeded project+team'); return; }

    var svc = new x_335329_capplan.CapacityPlannerService();
    var msgs = [], ok = true;

    var neg = svc.saveAllocation(pid, tid, 2099, 6, -1);
    if (neg.ok) { ok = false; msgs.push('fte=-1 not rejected'); }

    var over = svc.saveAllocation(pid, tid, 2099, 6, 31);
    if (over.ok) { ok = false; msgs.push('fte=31 not rejected (cap 30)'); }

    var badMonth = svc.saveAllocation(pid, tid, 2099, 13, 1);
    if (badMonth.ok || badMonth.error !== 'invalid_month') { ok = false; msgs.push('month=13 not rejected: ' + JSON.stringify(badMonth)); }

    var badId = svc.saveAllocation('not-a-sysid', tid, 2099, 6, 1);
    if (badId.ok || badId.error !== 'invalid_project_id') { ok = false; msgs.push('bad sys_id not rejected: ' + JSON.stringify(badId)); }

    if (ok) { stepResult.setSuccess(); stepResult.setOutputMessage('T03 ok: -1, >cap, month 13, bad id all rejected'); }
    else { stepResult.setFailed(); stepResult.setOutputMessage('T03 FAIL: ' + msgs.join(' | ')); }
})(outputs, steps, params, stepResult, assertEqual);
