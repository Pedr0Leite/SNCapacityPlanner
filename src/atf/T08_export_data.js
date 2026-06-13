// T08 Export data — ATF "Run Server Side Script" step body.
// getExportData(2026, []) returns 3 datasets; Sheet-1 header matches §11 exactly.
(function (outputs, steps, params, stepResult, assertEqual) {
    var svc = new x_335329_capplan.CapacityPlannerService();
    var ex = svc.getExportData(2026, []);

    var msgs = [], ok = true;

    if (!ex || !ex.ok) { stepResult.setFailed(); stepResult.setOutputMessage('export not ok'); return; }
    if (!ex.sheet1 || !ex.sheet2 || !ex.sheet3) { ok = false; msgs.push('missing a sheet'); }

    if (ex.sheet1.name !== 'Soft & Hard Planning (2)') { ok = false; msgs.push('sheet1 name=' + ex.sheet1.name); }
    if (ex.sheet2.name !== 'Capacity vs Headcount') { ok = false; msgs.push('sheet2 name=' + ex.sheet2.name); }
    if (ex.sheet3.name !== 'Change Log') { ok = false; msgs.push('sheet3 name=' + ex.sheet3.name); }

    var expected = ['Areas', 'Priority', 'Tech Team', 'Type of work', 'ADO', 'SNOW',
        'ADO Status', 'SNOW status', 'SteerCo Status', 'Projects Name', 'Initiatives Group',
        'Dependency', 'T-Shirt Sizing', 'Start date', 'End date',
        'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
        'Comments'];
    var hdr = ex.sheet1.rows[0];
    if (hdr.length !== expected.length) { ok = false; msgs.push('sheet1 header len=' + hdr.length + ' expected ' + expected.length); }
    else {
        for (var i = 0; i < expected.length; i++) {
            if (hdr[i] !== expected[i]) { ok = false; msgs.push('hdr[' + i + ']="' + hdr[i] + '" expected "' + expected[i] + '"'); break; }
        }
    }

    // Sheet-3 header check
    var s3 = ex.sheet3.rows[0].join(',');
    if (s3 !== 'Project,Tech Team,Month,Original FTE,Updated FTE,Delta') { ok = false; msgs.push('sheet3 header=' + s3); }

    if (ok) { stepResult.setSuccess(); stepResult.setOutputMessage('T08 ok: 3 sheets, headers exact'); }
    else { stepResult.setFailed(); stepResult.setOutputMessage('T08 FAIL: ' + msgs.join(' | ')); }
})(outputs, steps, params, stepResult, assertEqual);
