// T01 Service bootstrap — ATF "Run Server Side Script" step body.
// Asserts: teams.length==10, projects.length>0, headcount has 12 keyed months
// for a known team. Requires the seed to have been run first.
(function (outputs, steps, params, stepResult, assertEqual) {
    var svc = new x_335329_capplan.CapacityPlannerService();
    var b = svc.getBootstrap(2026);

    if (!b) { stepResult.setFailed(); stepResult.setOutputMessage('bootstrap null'); return; }

    var msgs = [];
    var ok = true;

    if (b.teams.length !== 10) { ok = false; msgs.push('teams.length=' + b.teams.length + ' expected 10'); }
    if (!(b.projects.length > 0)) { ok = false; msgs.push('projects.length=' + b.projects.length + ' expected >0'); }
    if (b.months.length !== 12) { ok = false; msgs.push('months.length=' + b.months.length); }

    // choices present and SS_ORDER sane
    if (!b.choices || !b.choices.snowStatus || b.choices.snowStatus.length !== 8) {
        ok = false; msgs.push('snowStatus choices missing/!=8');
    }

    // headcount: a known team must have 12 keyed months
    var hcOk = false;
    for (var i = 0; i < b.teams.length; i++) {
        var tid = b.teams[i].id;
        if (b.headcount[tid]) {
            var keys = 0;
            for (var m = 1; m <= 12; m++) { if (b.headcount[tid].hasOwnProperty(m)) keys++; }
            if (keys === 12) { hcOk = true; break; }
        }
    }
    if (!hcOk) { ok = false; msgs.push('no team has 12 keyed headcount months'); }

    if (ok) { stepResult.setSuccess(); stepResult.setOutputMessage('T01 ok: 10 teams, ' + b.projects.length + ' projects, headcount 12mo'); }
    else { stepResult.setFailed(); stepResult.setOutputMessage('T01 FAIL: ' + msgs.join(' | ')); }
})(outputs, steps, params, stepResult, assertEqual);
