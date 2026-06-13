// T04 Duplicate guard — ATF "Run Server Side Script" step body.
// Direct GlideRecord insert of a duplicate (project,team,year,month) is aborted by BR-01.
(function (outputs, steps, params, stepResult, assertEqual) {
    var TBL = 'x_335329_capplan_allocation';
    var YEAR = 2099, MONTH = 11;

    function firstId(table) {
        var gr = new GlideRecord(table); gr.setLimit(1); gr.query();
        return gr.next() ? gr.getUniqueValue() : null;
    }
    var pid = firstId('x_335329_capplan_project');
    var tid = firstId('x_335329_capplan_team');
    if (!pid || !tid) { stepResult.setFailed(); stepResult.setOutputMessage('T04 needs seeded project+team'); return; }

    var msgs = [], ok = true;

    var g1 = new GlideRecord(TBL);
    g1.initialize();
    g1.setValue('project', pid); g1.setValue('team', tid);
    g1.setValue('year', YEAR); g1.setValue('month', MONTH); g1.setValue('fte', 1);
    var id1 = g1.insert();
    if (!id1) { ok = false; msgs.push('first insert failed (expected ok)'); }

    var g2 = new GlideRecord(TBL);
    g2.initialize();
    g2.setValue('project', pid); g2.setValue('team', tid);
    g2.setValue('year', YEAR); g2.setValue('month', MONTH); g2.setValue('fte', 2);
    var id2 = g2.insert();
    if (id2) { ok = false; msgs.push('duplicate insert SUCCEEDED (BR-01 dup guard failed), id=' + id2); }

    // cleanup
    var cg = new GlideRecord(TBL);
    cg.addQuery('project', pid); cg.addQuery('team', tid);
    cg.addQuery('year', YEAR); cg.addQuery('month', MONTH);
    cg.deleteMultiple();

    if (ok) { stepResult.setSuccess(); stepResult.setOutputMessage('T04 ok: duplicate aborted by BR-01'); }
    else { stepResult.setFailed(); stepResult.setOutputMessage('T04 FAIL: ' + msgs.join(' | ')); }
})(outputs, steps, params, stepResult, assertEqual);
