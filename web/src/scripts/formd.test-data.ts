// SPDX-License-Identifier: Apache-2.0
// A fictional SEC Form D/A in the EDGAR XML shape (schema X0708), with its own invented issuer, for the Form D parser:
// formd.test.ts, scripts/formd-index.test.ts and the local dev folder (scripts/dev-fixture.ts) use it. Every name,
// number and address is invented; the CIKs sit in an unassigned range.

/** The file name of the fictional Form D fixture. */
export const FORM_D_FIXTURE_NAME = 'FormD_A__2012-09-18__Sample_Copper_Works__0009990007-12-000031.xml';

const address = (street: string) => `
            <street1>${street}</street1>
            <street2>Unit 7</street2>
            <city>Sample City</city>
            <stateOrCountry>NM</stateOrCountry>
            <stateOrCountryDescription>NEW MEXICO</stateOrCountryDescription>
            <zipCode>87000</zipCode>`;

function person(first: string, last: string, roles: string[], note: string, middle = ''): string {
  return `
        <relatedPersonInfo>
            <relatedPersonName>
                <firstName>${first}</firstName>${middle ? `\n                <middleName>${middle}</middleName>` : ''}
                <lastName>${last}</lastName>
            </relatedPersonName>
            <relatedPersonAddress>${address('48 Sample Avenue')}
            </relatedPersonAddress>
            <relatedPersonRelationshipList>${roles.map((role) => `\n                <relationship>${role}</relationship>`).join('')}
            </relatedPersonRelationshipList>
            <relationshipClarification>${note}</relationshipClarification>
        </relatedPersonInfo>`;
}

/** The fictional Form D amendment as EDGAR submission XML. */
export const FORM_D_FIXTURE_XML = `<?xml version="1.0"?>
<edgarSubmission>
    <schemaVersion>X0708</schemaVersion>
    <submissionType>D/A</submissionType>
    <testOrLive>LIVE</testOrLive>
    <primaryIssuer>
        <cik>0009990007</cik>
        <entityName>Sample Copper Works, Inc.</entityName>
        <issuerAddress>${address('48 SAMPLE AVENUE')}
        </issuerAddress>
        <issuerPhoneNumber>555-010-0142</issuerPhoneNumber>
        <jurisdictionOfInc>NEVADA</jurisdictionOfInc>
        <issuerPreviousNameList>
            <value>None</value>
        </issuerPreviousNameList>
        <edgarPreviousNameList>
            <value>None</value>
        </edgarPreviousNameList>
        <entityType>Corporation</entityType>
        <yearOfInc>
            <withinFiveYears>true</withinFiveYears>
            <value>2010</value>
        </yearOfInc>
    </primaryIssuer>
    <relatedPersonsList>${[
      person('N/A', 'Sample Copper Holdings, Inc.', ['Promoter'], 'Parent of the Issuer'),
      person('Morgan', 'Reyes', ['Executive Officer', 'Director'], 'President and Director of the Issuer'),
      person('Alex', 'Quinn', ['Executive Officer'], 'Treasurer of the Issuer', 'B.'),
    ].join('')}
    </relatedPersonsList>
    <offeringData>
        <industryGroup>
            <industryGroupType>Construction</industryGroupType>
        </industryGroup>
        <issuerSize>
            <revenueRange>$1,000,001 - $5,000,000</revenueRange>
        </issuerSize>
        <federalExemptionsExclusions>
            <item>06c</item>
            <item>4a5</item>
        </federalExemptionsExclusions>
        <typeOfFiling>
            <newOrAmendment>
                <isAmendment>true</isAmendment>
                <previousAccessionNumber>0009990007-11-000018</previousAccessionNumber>
            </newOrAmendment>
            <dateOfFirstSale>
                <value>2012-02-27</value>
            </dateOfFirstSale>
        </typeOfFiling>
        <durationOfOffering>
            <moreThanOneYear>false</moreThanOneYear>
        </durationOfOffering>
        <typesOfSecuritiesOffered>
            <isEquityType>true</isEquityType>
            <isOtherType>true</isOtherType>
            <descriptionOfOtherType>Common Stock Warrants</descriptionOfOtherType>
        </typesOfSecuritiesOffered>
        <businessCombinationTransaction>
            <isBusinessCombinationTransaction>false</isBusinessCombinationTransaction>
            <clarificationOfResponse></clarificationOfResponse>
        </businessCombinationTransaction>
        <minimumInvestmentAccepted>12500</minimumInvestmentAccepted>
        <salesCompensationList>
            <recipient>
                <recipientName>Sample Placement Corp.</recipientName>
                <recipientCRDNumber>9990005</recipientCRDNumber>
                <associatedBDName>None</associatedBDName>
                <associatedBDCRDNumber>None</associatedBDCRDNumber>
                <recipientAddress>${address('75 Sample Avenue')}
                </recipientAddress>
                <statesOfSolicitationList>
                    <state>NM</state>
                    <state>UT</state>
                </statesOfSolicitationList>
            </recipient>
        </salesCompensationList>
        <offeringSalesAmounts>
            <totalOfferingAmount>2640000</totalOfferingAmount>
            <totalAmountSold>1185750</totalAmountSold>
            <totalRemaining>1454250</totalRemaining>
            <clarificationOfResponse></clarificationOfResponse>
        </offeringSalesAmounts>
        <investors>
            <hasNonAccreditedInvestors>false</hasNonAccreditedInvestors>
            <totalNumberAlreadyInvested>14</totalNumberAlreadyInvested>
        </investors>
        <salesCommissionsFindersFees>
            <salesCommissions>
                <dollarAmount>4200</dollarAmount>
                <isEstimate>true</isEstimate>
            </salesCommissions>
            <findersFees>
                <dollarAmount>975</dollarAmount>
            </findersFees>
            <clarificationOfResponse></clarificationOfResponse>
        </salesCommissionsFindersFees>
        <useOfProceeds>
            <grossProceedsUsed>
                <dollarAmount>30000</dollarAmount>
                <isEstimate>true</isEstimate>
            </grossProceedsUsed>
            <clarificationOfResponse>Sample Copper Holdings, Inc. &amp; the officers listed in Item 3 may receive salaries paid from the issuer&apos;s proceeds.</clarificationOfResponse>
        </useOfProceeds>
        <signatureBlock>
            <authorizedRepresentative>false</authorizedRepresentative>
            <signature>
                <issuerName>Sample Copper Works, Inc.</issuerName>
                <signatureName>Morgan Reyes</signatureName>
                <nameOfSigner>Morgan Reyes</nameOfSigner>
                <signatureTitle>President of the Issuer</signatureTitle>
                <signatureDate>2012-09-11</signatureDate>
            </signature>
        </signatureBlock>
    </offeringData>
</edgarSubmission>
`;
