sap.ui.define([
    "sap/fe/test/JourneyRunner",
	"sourcingproject/test/integration/pages/SPHeaderList.gen",
	"sourcingproject/test/integration/pages/SPHeaderObjectPage.gen"
], function (JourneyRunner, SPHeaderListGenerated, SPHeaderObjectPageGenerated) {
    'use strict';

    var runner = new JourneyRunner({
        launchUrl: sap.ui.require.toUrl('sourcingproject') + '/test/flp.html#app-preview',
        pages: {
			onTheSPHeaderListGenerated: SPHeaderListGenerated,
			onTheSPHeaderObjectPageGenerated: SPHeaderObjectPageGenerated
        },
        async: true
    });

    return runner;
});

