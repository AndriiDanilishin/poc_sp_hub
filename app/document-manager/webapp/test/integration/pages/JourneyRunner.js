sap.ui.define([
    "sap/fe/test/JourneyRunner",
	"poc/sp/hub/documentmanager/test/integration/pages/DocumentsList.gen",
	"poc/sp/hub/documentmanager/test/integration/pages/DocumentsObjectPage.gen"
], function (JourneyRunner, DocumentsListGenerated, DocumentsObjectPageGenerated) {
    'use strict';

    var runner = new JourneyRunner({
        launchUrl: sap.ui.require.toUrl('poc/sp/hub/documentmanager') + '/test/flp.html#app-preview',
        pages: {
			onTheDocumentsListGenerated: DocumentsListGenerated,
			onTheDocumentsObjectPageGenerated: DocumentsObjectPageGenerated
        },
        async: true
    });

    return runner;
});

