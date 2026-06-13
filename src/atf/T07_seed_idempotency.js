// T07 Seed idempotency — ATF "Run Server Side Script" step body.
// Runs the seed loader twice; per-table row counts must be unchanged on run 2.
// Assumes seed already loaded once (so run 1 here is the "second" run and run 2
// the "third") — either way, two consecutive runs must produce identical counts.
(function (outputs, steps, params, stepResult, assertEqual) {
    var tables = ['x_335329_capplan_area', 'x_335329_capplan_team',
        'x_335329_capplan_project', 'x_335329_capplan_allocation', 'x_335329_capplan_headcount'];

    function counts() {
        var c = {};
        for (var i = 0; i < tables.length; i++) {
            var gr = new GlideRecord(tables[i]); gr.query(); c[tables[i]] = gr.getRowCount();
        }
        return c;
    }

    var seed = new x_335329_capplan.CapacityPlannerSeedData();
    var msgs = [], ok = true;

    // Run A
    seed.loadFromAttachment('seed_2026.json', 2026);
    var a = counts();
    // Run B
    seed.loadFromAttachment('seed_2026.json', 2026);
    var b = counts();

    for (var i = 0; i < tables.length; i++) {
        if (a[tables[i]] !== b[tables[i]]) {
            ok = false; msgs.push(tables[i] + ': ' + a[tables[i]] + ' -> ' + b[tables[i]] + ' (duplicated!)');
        }
    }

    if (ok) { stepResult.setSuccess(); stepResult.setOutputMessage('T07 ok: idempotent, counts unchanged ' + JSON.stringify(b)); }
    else { stepResult.setFailed(); stepResult.setOutputMessage('T07 FAIL: ' + msgs.join(' | ')); }
})(outputs, steps, params, stepResult, assertEqual);
