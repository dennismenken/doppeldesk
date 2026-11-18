# Spec-Digest: sevDesk OpenAPI

Wissensbasis für DoppelDesk. Quelle: `spec/sevdesk-openapi.yaml` (OpenAPI 3, `info.version` 2.0.0). Alles hier ist aus der Spec abgeleitet. Aussagen aus der Spec, die dem Live-Verhalten widersprechen können, sind als Inkonsistenz oder Annahme markiert. Fakten, die in den Live-Beobachtungen als verifiziert stehen, haben Vorrang vor dieser Datei.

## 1. Eckdaten der Spec

| Merkmal | Wert |
|---|---|
| Operationen | 154 (auf 119 Pfaden), alle `operationId` eindeutig |
| Schemas | 76 unter `components.schemas`, keine `parameters`/`responses`-Komponenten |
| Tags (22, eine Tag-Gruppe "sevdesk API") | Basics, CheckAccount, CheckAccountTransaction, PrivateTransactionRule, AccountingContact, CommunicationWay, ContactAddress, Contact, ContactField, CreditNote, CreditNotePos, Export, Part, Invoice, InvoicePos, Layout, Order, OrderPos, Voucher, VoucherPos, Report, Tag |
| Server | `https://my.sevdesk.de/api/v1` (Produktion), `http://sevdesk.local/api/v1` (intern) |
| Authentifizierung | `securitySchemes.api_key`: Header `Authorization` mit dem 32-stelligen Hex-Token, pro Operation als `security` gesetzt (kein globaler `security`-Block) |
| Methoden | GET, POST, PUT, DELETE (kein PATCH) |
| Antwort-Statuscodes in der Spec | 200 (132x), 201 (22x), 400 (132x), 401 (154x), 409 (27x: alle DELETE, alle Export-/Report-Endpunkte, `getReferenceCount`), 422 (16x: `enshrine`/`resetToOpen`/`resetToDraft` von Invoice, CreditNote, Voucher, `saveVoucher`, `fileImportAccount`, `clearingAccount`, `PrivateTransactionRule` anlegen, ReceiptGuidance `forAccountNumber`/`forTaxRule`), 500 (153x). 403 und 404 stehen nur in der Prosa der `info.description`, nie an Operationen. `saveInvoice`, `saveCreditNote`, `saveOrder` deklarieren kein 422, obwohl die Prosa 422 bei Validierungsfehlern (Steuerregel/Steuersatz) ankündigt |
| Fehlerbody | nur `validationError` (422) ist modelliert: `{ "error": { "message": string, "exceptionUUID": string } }`. Alle anderen Fehlercodes haben keinen Body in der Spec |

### Allgemeine Konventionen (aus `info.description`)

- Request-Header: `Authorization`, `Accept` (`application/json` oder `xml`), `Content-type` (`application/json` oder `application/x-www-form-urlencoded`), optional `X-Version` (Ressourcen-Versionierung, `default` oder `1.0` bis `1.9`; ungültige Version liefert Fehler mit den verfügbaren Versionen). Response-Header: `Deprecation` (true oder Zeitstempel).
- Von 51 Operationen mit Body sind 50 `application/json` (Ausnahme: `POST /Voucher/Factory/uploadTempFile` als `multipart/form-data` mit Feld `file`). Die Prosa zeigt aber auch Form-Encoding (`x-www-form-urlencoded`) mit verschachtelten Keys.
- Paginierung (Prosa): `limit` (1 bis 1000), `offset`, `countAll=true` liefert zusätzlich `"total": "157"` neben `objects`. In den Operationen deklariert sind `limit`/`offset` nur bei `Invoice/{id}/getPositions`, `Order/{id}/getPositions` und `Order/{id}/getDiscounts` (siehe Tabellen), `total` kommt in keinem Response-Schema vor.
- `embed=<Name>[,<Name>]`: bettet verschachtelte Ressourcen (z. B. `contact` in einer Rechnung) vollständig ein. Als Operationsparameter nur bei `getPositions`/`getDiscounts`/`getRelatedObjects` deklariert, laut Prosa an allen GET-Anfragen nutzbar.
- Weitere Prosa-Parameter ohne Deklaration: `depth` (Contact), `showAll`, Filter je Modell (siehe Abschnitt 2.2).
- Response-Hüllen in der Spec (Zählung über die 154 Operationen): Listen und GET-by-id `{ "objects": [ ... ] }` (by-id liefert ebenfalls ein Array), Factory-POSTs und viele POST/PUT einzelner Ressourcen liefern das Modell "bare" ohne `objects`-Hülle (z. B. `201: Model_ContactResponse`), DELETE liefert `{ "objects": [] }`, Aktionen wie `enshrine`/`resetToOpen`/`resetToDraft` liefern `{ "objects": <beliebig> }`. Die Spec-Form ist uneinheitlich und nicht live verifiziert. Die Live-Beobachtungen nennen für das Live-Verhalten die Hülle `{"objects": ...}` (Einzelobjekte bei GET by id als Array mit einem Element, Fehler 404 als `{"objects": null, "error": {"message": ...}}`), dort selbst als zu prüfende Annahme markiert.
- Response-Typen: In allen `*Response`-Schemas sind IDs und fast alle Zahlen und Beträge als `string` modelliert (z. B. `id: "1"`, `sumNet: "100"`, `status: "100"`, `quantity` bei Order/CreditNote-Positionen ebenfalls string). Ausnahmen: `paidAmount` (number bei Invoice/Voucher), `ContactAddressResponse.id` (integer). In den Request-Schemas sind IDs `integer`, Beträge `number`, Boolean `boolean`. Das ist die zentrale Vorgabe für Type Coercion beim Ausgeben.
- Datumsformate: Request "Timestamp oder dd.mm.yyyy" (Prosa), Response `date-time` (ISO 8601 mit Offset, Beispiel `2024-04-08T00:00:00+02:00`). Teils sind Request-Felder als `integer` (Unix-Timestamp) typisiert (`bookAmount.date` bei Invoice und CreditNote, `startDate`/`endDate`, `deliveryDateUntil`), bei Voucher-`bookAmount` als `date-time` string.
- Verschachtelte Referenzen sind immer `{ "id", "objectName" }`.

## 2. Operationen nach Tag

Legende: `*` = Pflichtparameter, `=a/b` = Enum. "Zweck" ist die englische `summary` der Spec. Response: `{objects: [X]}` Hülle mit Array, `{objects: X}` Hülle mit Objekt, `bare X` ohne Hülle. Pfadparameter (`{...Id}`) sind `integer` (Ausnahmen mit `number`: `contactCustomFieldId` bei GET und PUT, `SevClientId`). Der Statuscode vor dem Doppelpunkt ist der Erfolgscode der Spec.

### 2.1 Alle Operationen

#### Basics (1)

| Methode | Pfad | operationId | Zweck | Query-Parameter | Request-Body | Response |
|---|---|---|---|---|---|---|
| GET | `/Tools/bookkeepingSystemVersion` | `bookkeepingSystemVersion` | Retrieve bookkeeping system version | - | - | 200: {objects: {version}} |

#### CheckAccount (7)

| Methode | Pfad | operationId | Zweck | Query-Parameter | Request-Body | Response |
|---|---|---|---|---|---|---|
| GET | `/CheckAccount` | `getCheckAccounts` | Retrieve check accounts | - | - | 200: {objects: [Model_CheckAccountResponse]} |
| POST | `/CheckAccount/Factory/fileImportAccount` | `createFileImportAccount` | Create a new file import account | - | createFileImportAccount (json) | 201: {objects: createFileImportAccountResponse} |
| POST | `/CheckAccount/Factory/clearingAccount` | `createClearingAccount` | Create a new clearing account | - | createClearingAccount (json) | 201: {objects: createClearingAccountResponse} |
| GET | `/CheckAccount/{checkAccountId}` | `getCheckAccountById` | Find check account by ID | - | - | 200: {objects: [Model_CheckAccountResponse]} |
| PUT | `/CheckAccount/{checkAccountId}` | `updateCheckAccount` | Update an existing check account | - | Model_CheckAccountUpdate (json) | 200: bare Model_CheckAccountResponse |
| DELETE | `/CheckAccount/{checkAccountId}` | `deleteCheckAccount` | Deletes a check account | - | - | 200: {objects: [beliebig]} |
| GET | `/CheckAccount/{checkAccountId}/getBalanceAtDate` | `getBalanceAtDate` | Get the balance at a given date | `date*` | - | 200: {objects: string} |

#### CheckAccountTransaction (6)

| Methode | Pfad | operationId | Zweck | Query-Parameter | Request-Body | Response |
|---|---|---|---|---|---|---|
| GET | `/CheckAccountTransaction` | `getTransactions` | Retrieve transactions | `checkAccount[id]`, `checkAccount[objectName]`, `isBooked`, `paymtPurpose`, `startDate`, `endDate`, `payeePayerName`, `onlyCredit`, `onlyDebit` | - | 200: {objects: [Model_CheckAccountTransactionResponse]} |
| POST | `/CheckAccountTransaction` | `createTransaction` | Create a new transaction | - | Model_CheckAccountTransaction (json) | 201: bare Model_CheckAccountTransactionResponse |
| GET | `/CheckAccountTransaction/{checkAccountTransactionId}` | `getCheckAccountTransactionById` | Find check account transaction by ID | - | - | 200: {objects: [Model_CheckAccountTransactionResponse]} |
| PUT | `/CheckAccountTransaction/{checkAccountTransactionId}` | `updateCheckAccountTransaction` | Update an existing check account transaction | - | Model_CheckAccountTransactionUpdate (json) | 200: bare Model_CheckAccountTransactionResponse |
| DELETE | `/CheckAccountTransaction/{checkAccountTransactionId}` | `deleteCheckAccountTransaction` | Deletes a check account transaction | - | - | 200: {objects: [beliebig]} |
| PUT | `/CheckAccountTransaction/{checkAccountTransactionId}/enshrine` | `checkAccountTransactionEnshrine` | Enshrine | - | - | 200: {objects: beliebig} |

#### PrivateTransactionRule (3)

| Methode | Pfad | operationId | Zweck | Query-Parameter | Request-Body | Response |
|---|---|---|---|---|---|---|
| GET | `/PrivateTransactionRule` | `listPrivateTransactionRules` | List existing rules | - | - | 200: {objects: [Model_PrivateTransactionRuleResponse]} |
| POST | `/PrivateTransactionRule` | `createPrivateTransactionRule` | Create a new rule | - | CreatePrivateTransactionRule (json) | 201: bare Model_PrivateTransactionRuleResponse |
| DELETE | `/PrivateTransactionRule/{id}` | `deletePrivateTransactionRule` | Delete the rule by id | - | - | 200: {objects: [beliebig]} |

#### AccountingContact (5)

| Methode | Pfad | operationId | Zweck | Query-Parameter | Request-Body | Response |
|---|---|---|---|---|---|---|
| GET | `/AccountingContact` | `getAccountingContact` | Retrieve accounting contact | `contact[id]`, `contact[objectName]` | - | 200: {objects: [Model_AccountingContactResponse]} |
| POST | `/AccountingContact` | `createAccountingContact` | Create a new accounting contact | - | Model_AccountingContact (json) | 201: bare Model_AccountingContactResponse |
| GET | `/AccountingContact/{accountingContactId}` | `getAccountingContactById` | Find accounting contact by ID | - | - | 200: {objects: [Model_AccountingContactResponse]} |
| PUT | `/AccountingContact/{accountingContactId}` | `updateAccountingContact` | Update an existing accounting contact | - | Model_AccountingContactUpdate (json) | 200: bare Model_AccountingContactResponse |
| DELETE | `/AccountingContact/{accountingContactId}` | `deleteAccountingContact` | Deletes an accounting contact | - | - | 200: {objects: [beliebig]} |

#### CommunicationWay (6)

| Methode | Pfad | operationId | Zweck | Query-Parameter | Request-Body | Response |
|---|---|---|---|---|---|---|
| GET | `/CommunicationWay` | `getCommunicationWays` | Retrieve communication ways | `contact[id]`, `contact[objectName]`, `type=PHONE/EMAIL/WEB/MOBILE`, `main=0/1` | - | 200: {objects: [Model_CommunicationWayResponse]} |
| POST | `/CommunicationWay` | `createCommunicationWay` | Create a new contact communication way | - | Model_CommunicationWay (json) | 201: bare Model_CommunicationWayResponse |
| GET | `/CommunicationWay/{communicationWayId}` | `getCommunicationWayById` | Find communication way by ID | - | - | 200: {objects: [Model_CommunicationWayResponse]} |
| DELETE | `/CommunicationWay/{communicationWayId}` | `deleteCommunicationWay` | Deletes a communication way | - | - | 200: {objects: [beliebig]} |
| PUT | `/CommunicationWay/{communicationWayId}` | `UpdateCommunicationWay` | Update a existing communication way | - | Model_CommunicationWayUpdate (json) | 200: bare Model_CommunicationWayResponse |
| GET | `/CommunicationWayKey` | `getCommunicationWayKeys` | Retrieve communication way keys | - | - | 200: {objects: [inline-Objekt(6 Felder)]} |

#### ContactAddress (5)

| Methode | Pfad | operationId | Zweck | Query-Parameter | Request-Body | Response |
|---|---|---|---|---|---|---|
| POST | `/ContactAddress` | `createContactAddress` | Create a new contact address | - | Model_ContactAddress (json) | 201: bare Model_ContactAddressResponse |
| GET | `/ContactAddress` | `getContactAddresses` | Retrieve contact addresses | - | - | 200: {objects: [Model_ContactAddressResponse]} |
| GET | `/ContactAddress/{contactAddressId}` | `contactAddressId` | Find contact address by ID | - | - | 200: {objects: [Model_ContactAddressResponse]} |
| PUT | `/ContactAddress/{contactAddressId}` | `updateContactAddress` | update a existing contact address | - | Model_ContactAddressUpdate (json) | 201: bare Model_ContactAddressResponse |
| DELETE | `/ContactAddress/{contactAddressId}` | `deleteContactAddress` | Deletes a contact address | - | - | 200: {objects: [beliebig]} |

#### Contact (9)

| Methode | Pfad | operationId | Zweck | Query-Parameter | Request-Body | Response |
|---|---|---|---|---|---|---|
| GET | `/Contact/Factory/getNextCustomerNumber` | `getNextCustomerNumber` | Get next free customer number | - | - | 200: {objects: string} |
| GET | `/Contact/Factory/findContactsByCustomFieldValue` | `findContactsByCustomFieldValue` | Find contacts by custom field value | `value*`, `customFieldSetting[id]`, `customFieldSetting[objectName]`, `customFieldName*` | - | 200: {objects: [Model_ContactResponse]} |
| GET | `/Contact/Mapper/checkCustomerNumberAvailability` | `contactCustomerNumberAvailabilityCheck` | Check if a customer number is available | `customerNumber` | - | 200: {objects: boolean} |
| GET | `/Contact` | `getContacts` | Retrieve contacts | `depth=0/1`, `customerNumber` | - | 200: {objects: [Model_ContactResponse]} |
| POST | `/Contact` | `createContact` | Create a new contact | - | Model_Contact (json) | 201: bare Model_ContactResponse |
| GET | `/Contact/{contactId}` | `getContactById` | Find contact by ID | - | - | 200: {objects: [Model_ContactResponse]} |
| PUT | `/Contact/{contactId}` | `updateContact` | Update a existing contact | - | Model_ContactUpdate (json) | 200: bare Model_ContactResponse |
| DELETE | `/Contact/{contactId}` | `deleteContact` | Deletes a contact | - | - | 200: {objects: [beliebig]} |
| GET | `/Contact/{contactId}/getTabsItemCount` | `getContactTabsItemCountById` | Get number of all items | - | - | 200: bare inline-Objekt(9 Felder) |

#### ContactField (12)

| Methode | Pfad | operationId | Zweck | Query-Parameter | Request-Body | Response |
|---|---|---|---|---|---|---|
| GET | `/Textparser/fetchDictionaryEntriesByType` | `getPlaceholder` | Retrieve Placeholders | `objectName*=Invoice/CreditNote/Order/Contact/Letter/Email`, `subObjectName=Invoice/CreditNote/Order/Contact/Letter` | - | 200: {objects: [Model_Textparser_fetchDictionaryEntriesByType_response]} |
| GET | `/ContactCustomField` | `getContactFields` | Retrieve contact fields | - | - | 200: {objects: [Model_ContactCustomFieldResponse]} |
| POST | `/ContactCustomField` | `createContactField` | Create contact field | - | Model_ContactCustomField (json) | 200: bare Model_ContactCustomFieldResponse |
| GET | `/ContactCustomField/{contactCustomFieldId}` | `getContactFieldsById` | Retrieve contact fields | - | - | 200: {objects: [Model_ContactCustomFieldResponse]} |
| PUT | `/ContactCustomField/{contactCustomFieldId}` | `updateContactfield` | Update a contact field | - | Model_ContactCustomFieldUpdate (json) | 200: bare Model_ContactCustomFieldResponse |
| DELETE | `/ContactCustomField/{contactCustomFieldId}` | `deleteContactCustomFieldId` | delete a contact field | - | - | 200: {objects: [beliebig]} |
| GET | `/ContactCustomFieldSetting` | `getContactFieldSettings` | Retrieve contact field settings | - | - | 200: {objects: [Model_ContactCustomFieldSettingResponse]} |
| POST | `/ContactCustomFieldSetting` | `createContactFieldSetting` | Create contact field setting | - | Model_ContactCustomFieldSetting (json) | 200: {objects: [Model_ContactCustomFieldSettingResponse]} |
| GET | `/ContactCustomFieldSetting/{contactCustomFieldSettingId}` | `getContactFieldSettingById` | Find contact field setting by ID | - | - | 200: {objects: [Model_ContactCustomFieldSettingResponse]} |
| PUT | `/ContactCustomFieldSetting/{contactCustomFieldSettingId}` | `updateContactFieldSetting` | Update contact field setting | - | Model_ContactCustomFieldSettingUpdate (json) | 200: bare Model_ContactCustomFieldSettingResponse |
| DELETE | `/ContactCustomFieldSetting/{contactCustomFieldSettingId}` | `deleteContactFieldSetting` | Deletes a contact field setting | - | - | 200: {objects: [beliebig]} |
| GET | `/ContactCustomFieldSetting/{contactCustomFieldSettingId}/getReferenceCount` | `getReferenceCount` | Receive count reference | - | - | 200: {objects: integer} |

#### CreditNote (15)

| Methode | Pfad | operationId | Zweck | Query-Parameter | Request-Body | Response |
|---|---|---|---|---|---|---|
| GET | `/CreditNote` | `getCreditNotes` | Retrieve CreditNote | `status=100/200/300/500/750/1000`, `creditNoteNumber`, `startDate`, `endDate`, `contact[id]`, `contact[objectName]` | - | 200: {objects: [Model_creditNoteResponse]} |
| POST | `/CreditNote/Factory/saveCreditNote` | `createcreditNote` | Create a new creditNote | - | saveCreditNote (json) | 201: bare saveCreditNoteResponse |
| POST | `/CreditNote/Factory/createFromInvoice` | `createCreditNoteFromInvoice` | Creates a new creditNote from an invoice | - | {invoice} (json) | 201: {objects: {creditNote, creditNotePos, discount}} |
| POST | `/CreditNote/Factory/createFromVoucher` | `createCreditNoteFromVoucher` | Creates a new creditNote from a voucher | - | {voucher} (json) | 201: {objects: {creditNote, creditNotePos, discount}} |
| GET | `/CreditNote/{creditNoteId}` | `getcreditNoteById` | Find creditNote by ID | - | - | 200: {objects: [Model_creditNoteResponse]} |
| PUT | `/CreditNote/{creditNoteId}` | `updatecreditNote` | Update an existing creditNote | - | Model_creditNoteUpdate (json) | 200: bare Model_creditNoteResponse |
| DELETE | `/CreditNote/{creditNoteId}` | `deletecreditNote` | Deletes an creditNote | - | - | 200: {objects: [beliebig]} |
| GET | `/CreditNote/{creditNoteId}/sendByWithRender` | `sendCreditNoteByPrinting` | Send credit note by printing | `sendType*` | - | 200: bare Model_CreditNote_sendByWithRender |
| PUT | `/CreditNote/{creditNoteId}/sendBy` | `creditNoteSendBy` | Mark credit note as sent | - | {sendType, sendDraft} (json) | 200: bare Model_creditNoteResponse |
| PUT | `/CreditNote/{creditNoteId}/enshrine` | `creditNoteEnshrine` | Enshrine | - | - | 200: {objects: beliebig} |
| GET | `/CreditNote/{creditNoteId}/getPdf` | `creditNoteGetPdf` | Retrieve pdf document of a credit note | `download`, `preventSendBy` | - | 200: bare inline-Objekt(4 Felder) |
| POST | `/CreditNote/{creditNoteId}/sendViaEmail` | `sendCreditNoteViaEMail` | Send credit note via email | - | inline-Objekt(7 Felder) (json) | 201: {objects: [Model_creditNote_mailResponse]} |
| PUT | `/CreditNote/{creditNoteId}/bookAmount` | `bookCreditNote` | Book a credit note | - | inline-Objekt(6 Felder) (json) | 200: bare inline-Objekt(10 Felder) |
| PUT | `/CreditNote/{creditNoteId}/resetToOpen` | `creditNoteResetToOpen` | Reset status to open | - | - | 200: {objects: beliebig} |
| PUT | `/CreditNote/{creditNoteId}/resetToDraft` | `creditNoteResetToDraft` | Reset status to draft | - | - | 200: {objects: beliebig} |

#### CreditNotePos (1)

| Methode | Pfad | operationId | Zweck | Query-Parameter | Request-Body | Response |
|---|---|---|---|---|---|---|
| GET | `/CreditNotePos` | `getcreditNotePositions` | Retrieve creditNote positions | `creditNote[id]`, `creditNote[objectName]` | - | 200: {objects: [Model_creditNotePosResponse]} |

#### Export (14)

| Methode | Pfad | operationId | Zweck | Query-Parameter | Request-Body | Response |
|---|---|---|---|---|---|---|
| PUT | `/SevClient/{SevClientId}/updateExportConfig` | `updateExportConfig` | Update export config | - | {accountantNumber, accountantClientNumber, accountingYearBegin} (json) | 200: {objects: beliebig} |
| GET | `/Export/datevCSV` | `exportDatevDepricated` | Export datev | `Download`, `startDate*`, `endDate*`, `scope*`, `withUnpaidDocuments`, `withEnshrinedDocuments`, `enshrine` | - | 200: bare Objekt |
| GET | `/Export/createDatevCsvZipExportJob` | `exportDatevCSV` | Start DATEV CSV ZIP export | `startDate*`, `endDate*`, `scope*`, `exportByPaydate`, `includeEnshrined`, `enshrineDocuments`, `includeDocumentImages` | - | 200: {objects: string} |
| GET | `/Export/createDatevXmlZipExportJob` | `exportDatevXML` | Start DATEV XML ZIP export | `startDate*`, `endDate*`, `scope*`, `exportByPaydate`, `includeEnshrined`, `includeExportedDocuments`, `includeDocumentXml` | - | 200: {objects: string} |
| GET | `/Progress/generateDownloadHash` | `generateDownloadHash` | Generate download hash | `jobId*` | - | 200: {objects: [Export_Progress_Data]} |
| GET | `/Progress/getProgress` | `getProgress` | Get progress | `hash*` | - | 200: {objects: [Export_Progress_Data]} |
| GET | `/ExportJob/jobDownloadInfo` | `jobDownloadInfo` | Get job download info | `jobId*` | - | 200: {objects: [Export_Job_Download_Info]} |
| GET | `/Export/invoiceCsv` | `exportInvoice` | Export invoice | `download`, `sevQuery*` | - | 200: {objects: inline-Objekt(4 Felder)} |
| GET | `/Export/invoiceZip` | `exportInvoiceZip` | Export Invoice as zip | `download`, `sevQuery*` | - | 200: {objects: inline-Objekt(4 Felder)} |
| GET | `/Export/creditNoteCsv` | `exportCreditNote` | Export creditNote | `download`, `sevQuery*` | - | 200: {objects: inline-Objekt(4 Felder)} |
| GET | `/Export/voucherListCsv` | `exportVoucher` | Export voucher as zip | `download`, `sevQuery*` | - | 200: bare inline-Objekt(4 Felder) |
| GET | `/Export/transactionsCsv` | `exportTransactions` | Export transaction | `download`, `sevQuery*` | - | 200: {objects: inline-Objekt(4 Felder)} |
| GET | `/Export/voucherZip` | `exportVoucherZip` | Export voucher zip | `download`, `sevQuery*` | - | 200: {objects: inline-Objekt(4 Felder)} |
| GET | `/Export/contactListCsv` | `exportContact` | Export contact | `download`, `sevQuery*` | - | 200: {objects: inline-Objekt(4 Felder)} |

#### Part (5)

| Methode | Pfad | operationId | Zweck | Query-Parameter | Request-Body | Response |
|---|---|---|---|---|---|---|
| GET | `/Part` | `getParts` | Retrieve parts | `partNumber`, `name` | - | 200: {objects: [Model_Part]} |
| POST | `/Part` | `createPart` | Create a new part | - | Model_Part (json) | 201: bare Model_Part |
| GET | `/Part/{partId}` | `getPartById` | Find part by ID | - | - | 200: {objects: [Model_Part]} |
| PUT | `/Part/{partId}` | `updatePart` | Update an existing part | - | Model_PartUpdate (json) | 200: bare Model_Part |
| GET | `/Part/{partId}/getStock` | `partGetStock` | Get stock of a part | - | - | 200: {objects: integer} |

#### Invoice (17)

| Methode | Pfad | operationId | Zweck | Query-Parameter | Request-Body | Response |
|---|---|---|---|---|---|---|
| GET | `/Invoice` | `getInvoices` | Retrieve invoices | `status=100/200/1000`, `invoiceNumber`, `startDate`, `endDate`, `contact[id]`, `contact[objectName]` | - | 200: {objects: [Model_InvoiceResponse]} |
| POST | `/Invoice/Factory/saveInvoice` | `createInvoiceByFactory` | Create a new invoice | - | saveInvoice (json) | 201: bare saveInvoiceResponse |
| GET | `/Invoice/{invoiceId}` | `getInvoiceById` | Find invoice by ID | - | - | 200: {objects: [Model_InvoiceResponse]} |
| GET | `/Invoice/{invoiceId}/getPositions` | `getInvoicePositionsById` | Find invoice positions | `limit`, `offset`, `embed` | - | 200: {objects: [Model_InvoicePosResponse]} |
| POST | `/Invoice/Factory/createInvoiceFromOrder` | `createInvoiceFromOrder` | Create invoice from order | - | Model_CreateInvoiceFromOrder (json) | 200: bare Model_InvoiceResponse |
| POST | `/Invoice/Factory/createInvoiceReminder` | `createInvoiceReminder` | Create invoice reminder | `invoice[id]*`, `invoice[objectName]*` | {invoice} (json) | 200: bare Model_InvoiceResponse |
| GET | `/Invoice/{invoiceId}/getIsPartiallyPaid` | `getIsInvoicePartiallyPaid` | Check if an invoice is already partially paid | - | - | 200: {objects: boolean} |
| POST | `/Invoice/{invoiceId}/cancelInvoice` | `cancelInvoice` | Cancel an invoice / Create cancellation invoice | - | - | 201: bare Model_InvoiceResponse |
| POST | `/Invoice/{invoiceId}/render` | `invoiceRender` | Render the pdf document of an invoice | - | {forceReload} (json) | 201: bare {pdf, docId, parameters} |
| POST | `/Invoice/{invoiceId}/sendViaEmail` | `sendInvoiceViaEMail` | Send invoice via email | - | inline-Objekt(8 Felder) (json) | 201: bare Model_Email |
| GET | `/Invoice/{invoiceId}/getPdf` | `invoiceGetPdf` | Retrieve pdf document of an invoice | `download`, `preventSendBy` | - | 200: bare inline-Objekt(4 Felder) |
| GET | `/Invoice/{invoiceId}/getXml` | `invoiceGetXml` | Retrieve XML of an e-invoice | - | - | 200: {objects: string} |
| PUT | `/Invoice/{invoiceId}/sendBy` | `invoiceSendBy` | Mark invoice as sent | - | {sendType, sendDraft} (json) | 200: bare Model_InvoiceResponse |
| PUT | `/Invoice/{invoiceId}/enshrine` | `invoiceEnshrine` | Enshrine | - | - | 200: {objects: beliebig} |
| PUT | `/Invoice/{invoiceId}/bookAmount` | `bookInvoice` | Book an invoice | - | inline-Objekt(6 Felder) (json) | 200: bare inline-Objekt(10 Felder) |
| PUT | `/Invoice/{invoiceId}/resetToOpen` | `invoiceResetToOpen` | Reset status to open | - | - | 200: {objects: beliebig} |
| PUT | `/Invoice/{invoiceId}/resetToDraft` | `invoiceResetToDraft` | Reset status to draft | - | - | 200: {objects: beliebig} |

#### InvoicePos (1)

| Methode | Pfad | operationId | Zweck | Query-Parameter | Request-Body | Response |
|---|---|---|---|---|---|---|
| GET | `/InvoicePos` | `getInvoicePos` | Retrieve InvoicePos | `id`, `invoice[id]`, `invoice[objectName]`, `part[id]`, `part[objectName]` | - | 200: {objects: [Model_InvoicePosResponse]} |

#### Layout (5)

| Methode | Pfad | operationId | Zweck | Query-Parameter | Request-Body | Response |
|---|---|---|---|---|---|---|
| GET | `/DocServer/getLetterpapersWithThumb` | `getLetterpapersWithThumb` | Retrieve letterpapers | - | - | 200: bare {result, letterpapers} |
| GET | `/DocServer/getTemplatesWithThumb` | `getTemplates` | Retrieve templates | `type=Invoice/invoicereminder/Order/Contractnote/Packinglist/Letter/Creditnote` | - | 200: bare {result, templates} |
| PUT | `/Invoice/{invoiceId}/changeParameter` | `updateInvoiceTemplate` | Update an invoice template | - | Model_ChangeLayout (json) | 200: bare Model_ChangeLayoutResponse |
| PUT | `/Order/{orderId}/changeParameter` | `updateOrderTemplate` | Update an order template | - | Model_ChangeLayout (json) | 200: bare Model_ChangeLayoutResponse |
| PUT | `/CreditNote/{creditNoteId}/changeParameter` | `updateCreditNoteTemplate` | Update an of credit note template | - | Model_ChangeLayout (json) | 200: bare Model_ChangeLayoutResponse |

#### Order (13)

| Methode | Pfad | operationId | Zweck | Query-Parameter | Request-Body | Response |
|---|---|---|---|---|---|---|
| GET | `/Order` | `getOrders` | Retrieve orders | `status=100/200/300/500/750/1000`, `orderNumber`, `startDate`, `endDate`, `contact[id]`, `contact[objectName]` | - | 200: {objects: [Model_OrderResponse]} |
| POST | `/Order/Factory/saveOrder` | `createOrder` | Create a new order | - | saveOrder (json) | 201: bare saveOrderResponse |
| GET | `/Order/{orderId}` | `getOrderById` | Find order by ID | - | - | 200: {objects: [Model_OrderResponse]} |
| PUT | `/Order/{orderId}` | `updateOrder` | Update an existing order | - | Model_OrderUpdate (json) | 200: bare Model_OrderResponse |
| DELETE | `/Order/{orderId}` | `deleteOrder` | Deletes an order | - | - | 200: {objects: [beliebig]} |
| GET | `/Order/{orderId}/getPositions` | `getOrderPositionsById` | Find order positions | `limit`, `offset`, `embed` | - | 200: {objects: [Model_OrderPosResponse]} |
| GET | `/Order/{orderId}/getDiscounts` | `getDiscounts` | Find order discounts | `limit`, `offset`, `embed` | - | 200: {objects: [Model_Discount]} |
| GET | `/Order/{orderId}/getRelatedObjects` | `getRelatedObjects` | Find related objects | `includeItself`, `sortByType`, `embed` | - | 200: {objects: [Model_OrderPosResponse]} |
| POST | `/Order/{orderId}/sendViaEmail` | `sendorderViaEMail` | Send order via email | - | inline-Objekt(7 Felder) (json) | 201: {objects: [Model_EmailOrder]} |
| POST | `/Order/Factory/createPackingListFromOrder` | `createPackingListFromOrder` | Create packing list from order | `order[id]*`, `order[objectName]*` | Model_CreatePackingListFromOrder (json) | 200: bare Model_OrderResponse |
| POST | `/Order/Factory/createContractNoteFromOrder` | `createContractNoteFromOrder` | Create contract note from order | `order[id]*`, `order[objectName]*` | Model_CreatePackingListFromOrder (json) | 200: bare Model_OrderResponse |
| GET | `/Order/{orderId}/getPdf` | `orderGetPdf` | Retrieve pdf document of an order | `download`, `preventSendBy` | - | 200: bare inline-Objekt(4 Felder) |
| PUT | `/Order/{orderId}/sendBy` | `orderSendBy` | Mark order as sent | - | {sendType, sendDraft} (json) | 200: bare Model_OrderResponse |

#### OrderPos (4)

| Methode | Pfad | operationId | Zweck | Query-Parameter | Request-Body | Response |
|---|---|---|---|---|---|---|
| GET | `/OrderPos` | `getOrderPositions` | Retrieve order positions | `order[id]`, `order[objectName]` | - | 200: {objects: [Model_OrderPosResponse]} |
| GET | `/OrderPos/{orderPosId}` | `getOrderPositionById` | Find order position by ID | - | - | 200: {objects: [Model_OrderPosResponse]} |
| PUT | `/OrderPos/{orderPosId}` | `updateOrderPosition` | Update an existing order position | - | Model_OrderPosUpdate (json) | 200: bare Model_OrderPosResponse |
| DELETE | `/OrderPos/{orderPosId}` | `deleteOrderPos` | Deletes an order Position | - | - | 200: {objects: [beliebig]} |

#### Voucher (14)

| Methode | Pfad | operationId | Zweck | Query-Parameter | Request-Body | Response |
|---|---|---|---|---|---|---|
| POST | `/Voucher/Factory/saveVoucher` | `voucherFactorySaveVoucher` | Create a new voucher | - | saveVoucher (json) | 201: bare saveVoucherResponse |
| POST | `/Voucher/Factory/uploadTempFile` | `voucherUploadFile` | Upload voucher file | - | {file} (form-data) | 201: {objects: inline-Objekt(6 Felder)} |
| GET | `/Voucher` | `getVouchers` | Retrieve vouchers | `status=50/100/1000`, `creditDebit=C/D`, `descriptionLike`, `startDate`, `endDate`, `contact[id]`, `contact[objectName]` | - | 200: {objects: [Model_VoucherResponse]} |
| GET | `/Voucher/{voucherId}` | `getVoucherById` | Find voucher by ID | - | - | 200: {objects: [Model_VoucherResponse]} |
| PUT | `/Voucher/{voucherId}` | `updateVoucher` | Update an existing voucher | - | Model_VoucherUpdate (json) | 200: bare Model_VoucherResponse |
| PUT | `/Voucher/{voucherId}/enshrine` | `voucherEnshrine` | Enshrine | - | - | 200: {objects: beliebig} |
| PUT | `/Voucher/{voucherId}/bookAmount` | `bookVoucher` | Book a voucher | - | inline-Objekt(6 Felder) (json) | 200: bare inline-Objekt(9 Felder) |
| PUT | `/Voucher/{voucherId}/resetToOpen` | `voucherResetToOpen` | Reset status to open | - | - | 200: {objects: beliebig} |
| PUT | `/Voucher/{voucherId}/resetToDraft` | `voucherResetToDraft` | Reset status to draft | - | - | 200: {objects: beliebig} |
| GET | `/ReceiptGuidance/forAllAccounts` | `forAllAccounts` | Get all account guides | - | - | 200: {objects: [ReceiptGuideDto]} |
| GET | `/ReceiptGuidance/forAccountNumber` | `forAccountNumber` | Get guidance by account number | `accountNumber*` | - | 200: {objects: [ReceiptGuideDto]} |
| GET | `/ReceiptGuidance/forTaxRule` | `forTaxRule` | Get guidance by Tax Rule | `taxRule*` | - | 200: {objects: [ReceiptGuideDto]} |
| GET | `/ReceiptGuidance/forRevenue` | `forRevenue` | Get guidance for revenue accounts | - | - | 200: {objects: [ReceiptGuideDto]} |
| GET | `/ReceiptGuidance/forExpense` | `forExpense` | Get guidance for expense accounts | - | - | 200: {objects: [ReceiptGuideDto]} |

#### VoucherPos (1)

| Methode | Pfad | operationId | Zweck | Query-Parameter | Request-Body | Response |
|---|---|---|---|---|---|---|
| GET | `/VoucherPos` | `getVoucherPositions` | Retrieve voucher positions | `voucher[id]`, `voucher[objectName]` | - | 200: {objects: [Model_VoucherPosResponse]} |

#### Report (4)

| Methode | Pfad | operationId | Zweck | Query-Parameter | Request-Body | Response |
|---|---|---|---|---|---|---|
| GET | `/Report/invoicelist` | `reportInvoice` | Export invoice list | `download`, `view*`, `sevQuery*` | - | 200: {objects: inline-Objekt(4 Felder)} |
| GET | `/Report/orderlist` | `reportOrder` | Export order list | `download`, `view*`, `sevQuery*` | - | 200: {objects: inline-Objekt(4 Felder)} |
| GET | `/Report/contactlist` | `reportContact` | Export contact list | `download`, `sevQuery*` | - | 200: {objects: inline-Objekt(4 Felder)} |
| GET | `/Report/voucherlist` | `reportVoucher` | Export voucher list | `download`, `sevQuery*` | - | 200: {objects: inline-Objekt(4 Felder)} |

#### Tag (6)

| Methode | Pfad | operationId | Zweck | Query-Parameter | Request-Body | Response |
|---|---|---|---|---|---|---|
| GET | `/Tag` | `getTags` | Retrieve tags | `id`, `name` | - | 200: {objects: [Model_TagResponse]} |
| GET | `/Tag/{tagId}` | `getTagById` | Find tag by ID | - | - | 200: {objects: [Model_TagResponse]} |
| PUT | `/Tag/{tagId}` | `updateTag` | Update tag | - | {name} (json) | 200: bare Model_TagResponse |
| DELETE | `/Tag/{tagId}` | `deleteTag` | Deletes a tag | - | - | 200: {objects: [beliebig]} |
| POST | `/Tag/Factory/create` | `createTag` | Create a new tag | - | {name, object} (json) | 200: bare Model_TagCreateResponse |
| GET | `/TagRelation` | `getTagRelations` | Retrieve tag relations | - | - | 200: {objects: [Model_TagCreateResponse]} |

### 2.2 Filter laut Tag-Beschreibung (nicht als Operationsparameter deklariert)

Die Prosa der Tags nennt weit mehr Filter als die Operationen deklarieren ("filters that you can attach to your GET query string for nearly all endpoints"). Für ein generisches Listing relevant:

| Modell | Filter |
|---|---|
| Invoice | `status`, `invoiceNumber`, `invoiceNumberGreater`, `invoiceNumberSmaller`, `invoiceType`, `contact[id]`+`contact[objectName]=Contact`, `startDate`/`endDate` (Rechnungsdatum, Timestamp), `day`, `createBefore`/`createAfter`/`updateBefore`/`updateAfter`, `partiallyPaid`, `delinquent`, `notdelinquent`, `onlyDunned`, `showAll`, `showWkr=all`, `showMa=all`, `tags[x][id]`+`tags[x][objectName]=Tag`, `costCentre[...]`, `origin[id]`+`origin[objectName]`, `paymentMethod[...]`, `headerStartsWith`, `headerOrNumber`, `customerIntenalNote` (Tippfehler in Spec), `sendType`, `fulltextSearch`, `orderByInvoiceNumber`/`orderByDebit`/`orderByDueTime`/`orderByDueDate` |
| CreditNote | `creditNoteNumber`, `creditNoteNumberGreater`, `creditNoteNumberNumberSmaller` (sic), `status`, `onlyEnshrined`, `contact[...]`, `startDate`/`endDate`, `day`, `startAmount`/`endAmount` (Summe netto/brutto), `delinquent`, `notdelinquent`, `partiallyPaid`, `tags[x]`, `costCentre`, `origin`, `paymentMethod`, `headerOrNumber`, `headerStartsWith`, `customerIntenalNote`, `orderByCreditNoteNumber`, `orderByDebit`/`orderByDueDate`/`orderByDueTime` |
| Order | `orderNumber`, `orderNumberGreater`, `orderNumberNumberSmaller` (sic), `status`, `orderType`, `contact[...]`, `startDate`/`endDate`, `createBefore`/`createAfter`/`updateBefore`/`updateAfter`, `startAmount`/`endAmount`, `tags[x]`, `orderByOrderNumber` |
| Voucher | `status`, `creditDebit=C/D`, `descriptionLike`, `supplierName`, `year`, `month`, `startDate`/`endDate` (Belegdatum), `startPayDate`/`endPayDate`, `voucherType`, `contact[...]`, `contactOrObject[...]`, `object[id]`+`object[objectName]`, `accountingType[...]`, `costCentre`, `origin`, `createBefore`/`createAfter`/`updateBefore`/`updateAfter`, `startAmount`/`endAmount` (negativ: umgekehrte Richtung), `hasDocument`, `noRv`, `withoutCatering`, `delinquent`, `commentLike`, `searchCommentOrDescription`, `tags[x]`, `fulltextSearch`, `fulltextSearchObjects`, `orderByVoucherNumber`, `orderByDebit` |
| Contact | `depth=1` (Standard ohne `depth`: nur Organisationen, mit `depth=1` Organisationen und Personen), `customerNumber`, `name` (Treffer auf name, surename oder familyname), `city`, `zip`, `category[id]`+`category[objectName]=Category`, `parent[id]`+`parent[objectName]=Contact`, `country[id]`+`country[objectName]=StaticCountry`, `createBefore`/`createAfter`/`updateBefore`/`updateAfter`, `tags[x]`, `orderByCustomerNumber=ASC/DESC` |
| Tag (Nutzung an Dokumenten) | `Invoice?tags[0][id]={tagId}&tags[0][objectName]=Tag` |

Zeitfilter: `startDate`/`endDate` sind Unix-Timestamps (Spec-Typ `integer`), "equal or higher/lower" laut Parameterbeschreibung, die Tag-Prosa sagt "bigger/smaller than". Das ist uneinheitlich.

Deklarierte Parameter mit Enums (nur diese sind in der OpenAPI formal beschrieben):

| Operation | Parameter |
|---|---|
| `GET /Invoice` | `status` (number) = 100/200/1000 (ohne 50 und 750), `invoiceNumber`, `startDate`, `endDate`, `contact[id]`, `contact[objectName]` |
| `GET /CreditNote` | `status` (string) = 100/200/300/500/750/1000, `creditNoteNumber`, `startDate`, `endDate`, `contact[...]` |
| `GET /Order` | `status` (integer) = 100/200/300/500/750/1000, `orderNumber`, `startDate`, `endDate`, `contact[...]` |
| `GET /Voucher` | `status` (number) = 50/100/1000, `creditDebit` = C/D, `descriptionLike`, `startDate`, `endDate`, `contact[...]` |
| `GET /Contact` | `depth` = 0/1, `customerNumber` |
| `GET /Part` | `partNumber`, `name` |
| `GET /CheckAccountTransaction` | `checkAccount[id]`, `checkAccount[objectName]`, `isBooked`, `paymtPurpose`, `startDate`, `endDate` (hier als string), `payeePayerName`, `onlyCredit`, `onlyDebit` |
| `GET /CommunicationWay` | `contact[id]`, `contact[objectName]`, `type`, `main` |
| `GET /AccountingContact` | `contact[id]`, `contact[objectName]` |
| `GET /InvoicePos` | `id`, `invoice[id]`, `invoice[objectName]`, `part[id]`, `part[objectName]` |
| `GET /OrderPos`, `/CreditNotePos`, `/VoucherPos` | `order[...]`, `creditNote[...]`, `voucher[...]` jeweils id und objectName |
| `GET /Tag` | `id`, `name` |

Export-/Report-Endpunkte nehmen `sevQuery` (Objekt mit `limit`, `modelName`, `objectName`, `filter{...}`) als Query-Parameter. Das sind Dateiexporte (Base64-Inhalt) und für ein Fake-Backend zweitrangig.

## 3. Fachliche Eckdaten aus der Spec

### 3.1 Typen und Status je Modell

#### Invoice

`invoiceType` (Enum `RE, WKR, SR, MA, TR, AR, ER`):

| Wert | Bedeutung |
|---|---|
| RE | Normale Rechnung |
| WKR | Wiederkehrende Rechnung (erzeugt normale Rechnungen im Intervall; braucht `accountIntervall` als ISO-8601-Dauer, `accountNextInvoice`) |
| SR | Stornorechnung (cancellation invoice) |
| MA | Mahnung (reminder invoice), mit `dunningLevel`, `reminderDeadline`, `reminderDebit`, `reminderTotal`, `reminderCharge` |
| TR | Teilrechnung (partial invoice) |
| AR | Abschlagsrechnung (advance invoice) |
| ER | Schlussrechnung (final invoice, fasst AR/TR zusammen) |

`status` (Enum `50, 100, 200, 750, 1000`, in Request als string, in Response als string):

| Code | Bedeutung |
|---|---|
| 50 | Deaktivierte wiederkehrende Rechnung (nur WKR) |
| 100 | Draft: nicht versendet, änderbar |
| 200 | Open/Due: versendet. "open" wenn payDate nicht überschritten, sonst "due" |
| 750 | Partially paid: mit einer Transaktion verknüpft, aber nicht voll bezahlt. Eingeführt mit Release 4.181 (13.06.2024). Davor teilbezahlte Rechnungen haben 200, dafür `GET /Invoice/{id}/getIsPartiallyPaid` nutzen |
| 1000 | Paid: voll bezahlt (mit Transaktion verknüpft) |

Der Status "cancelled" aus der `cancelInvoice`-Beschreibung hat in der Spec keinen Code (siehe Abschnitt 4).

Weitere Enums: `sendType` = `VPR` (gedruckt), `VPDF` (heruntergeladen), `VM` (gemailt), `VP` (Post). `taxType` = `default, eu, noteu, custom` (Prosa nennt zusätzlich `ss`; Enum der Spec ohne `ss`). `taxRule.id` = `1, 2, 3, 4, 5, 11, 17, 18, 19, 20, 21`, `taxRule.objectName` = `TaxRule`.

#### CreditNote

`status`: Beschreibung und Response-Enum `100` Draft, `200` Open/Delivered (versendet), `750` Partially paid, `1000` Paid. Das Request-Schema `Model_creditNote` und der Listenfilter erlauben zusätzlich `300` und `500` (ohne dokumentierte Bedeutung, vermutlich Übernahme der Order-Codes).

`bookingCategory` (Pflicht, Enum): `PROVISION`, `ROYALTY_ASSIGNED`, `ROYALTY_UNASSIGNED`, `UNDERACHIEVEMENT` (Minderleistung; dann `refSrcInvoice` oder `refSrcVoucher` angeben), `ACCOUNTING_TYPE` (laut Update 2.0 nicht unterstützt, erfordert `accountingType`).

Ein `creditNoteType` gibt es in der Spec nicht. `Model_creditNote.required` listet `invoiceType`, aber das Schema definiert kein solches Property (Inkonsistenz).

#### Order

`orderType` (Enum): `AN` Angebot/Proposal, `AB` Auftragsbestätigung, `LI` Lieferschein.

`status` (Enum, im Request integer, in Response string):

| Code | Bedeutung |
|---|---|
| 100 | Draft |
| 200 | Delivered (versendet) |
| 300 | Rejected/Cancelled (vom Kunden abgelehnt) |
| 500 | Accepted (vom Kunden angenommen) |
| 750 | Partially Calculated: Rechnung über einen Teil der Bestellung erzeugt |
| 1000 | Calculated: Rechnung(en) decken die gesamte Bestellung ab |

Order hat `version` (Pflicht, integer, "should start with 0") für mehrere Entwürfe derselben Bestellung, `origin` (z. B. Angebot), `typeOrigin`, `paymentTerms`/`deliveryTerms`, `sendType` ("if you don't plan to send over another endpoint but give status 200 directly, you need to specify a send type"). Order hat keine `enshrine`-, `bookAmount`- oder `resetTo*`-Endpunkte und kein `enshrined`-Feld.

#### Voucher

`voucherType`: `VOU` (normal), `RV` (wiederkehrend, mit `recurringInterval`, `recurringStartDate`, `recurringNextVoucher`, `recurringLastVoucher`, `recurringEndDate`). `creditDebit`: `C` = Ausgabe (gekauft), `D` = Einnahme (verkauft).

`status` laut Prosa: `50` Draft, `100` Unpaid/Due, `150` Transferred (Zahlung angelegt, wartet auf Bank-Transaktionsimport), `750` Partially paid, `1000` Paid. Das Schema-Enum (Request, Response, Update, Filter) enthält nur `50, 100, 1000` (Inkonsistenz).

Update 2.0: `saveVoucher` akzeptiert nur Status 50 oder 100. Ein Voucher kann nicht direkt auf bezahlt gesetzt werden, dafür `bookAmount`. Nur Entwürfe sind aktualisierbar. Status senken über `resetToOpen` (von bezahlt) und `resetToDraft` (von offen). `PUT /Voucher/{id}` ändert nur einfache Werte eines Entwurfs und "can not change the status".

#### Part

`status` (Enum, nullable): `50` Inactive, `100` Active. Pflichtfelder: `taxRate`, `unity`, `stock`, `name`, `partNumber`. Weitere: `stockEnabled`, `price` (netto, "we will change this parameter so that the gross price is calculated automatically, until then the priceGross parameter must be used"), `priceNet`, `priceGross`, `pricePurchase`, `category`, `text`, `internalComment`. Update 2.0: Teile mit Steuersatz außer 0.0, 7.0, 19.0 sind nicht mehr anlegbar. `GET /Part/{id}/getStock` liefert `{objects: integer}`. Kein DELETE-Endpunkt in der Spec.

#### CheckAccount

| Feld | Wert |
|---|---|
| `type` | `online` (Bankkonto, PayPal, CSV/MT940-Importkonto), `offline` (Verrechnungskonto/clearing), `register` (Kasse, verhält sich wie offline) |
| `importType` | `CSV`, `MT940` oder `null` (bei `online` ohne Datenanbieter) |
| `status` | `0` Archived, `100` Active (Default 100) |
| `defaultAccount` | `0`/`1` (Update-Schema: integer-Enum, Response: string) |
| `accountingNumber` | Buchungskonto, z. B. 1800 (SKR04) oder 1200 (SKR03); muss unter allen CheckAccounts eindeutig sein |
| `autoMapTransactions` | Default 1; ordnet importierte Transaktionen automatisch Rechnungen/Belegen zu |
| weitere | `name`, `iban`, `bic`, `currency`, `baseAccount` (1 beim mitgelieferten Basiskonto), `priority`, `balance` (nur PayPal/finAPI), `bankServer`, `autoSyncTransactions`, `lastSync` |

Anlegen per API nur als Importkonto (`POST /CheckAccount/Factory/fileImportAccount`, Body `name`, `importType`, `accountingNumber`, `iban`) oder Verrechnungskonto (`.../clearingAccount`, Body `name`, `accountingNumber`). Bankkonten (finAPI/PayPal) nur über die UI. `getBalanceAtDate?date=` liefert die Summe aller bekannten Transaktionen bis einschließlich Datum (nicht zwingend der echte Kontostand).

#### CheckAccountTransaction

Pflicht beim Anlegen: `valueDate`, `checkAccount`, `amount`, `status`, `payeePayerName`. Request-`status`: `100` Created, `200` Linked, `300` Private, `400` Booked. Das Response-Enum kennt zusätzlich `350` Auto-booked without user confirmation. Weitere Felder: `entryDate`, `paymtPurpose`, `payeePayerAcctNo`, `payeePayerBankCode`, `sourceTransaction`/`targetTransaction` (Umbuchung), Response zusätzlich `gvCode`, `entryText`, `primaNotaNo`, `enshrined`. `POST /CheckAccountTransaction` "should only be used with check account type online, preferably for csv import accounts". `enshrine` nur ab Status 200; verknüpfte Rechnungen/Gutschriften/Belege sind danach nicht mehr änderbar.

#### Contact

Typ wird nicht per Feld, sondern über die Felder bestimmt: Wert in `surename` ODER `familyname` = Person, Wert in `name` = Organisation. Einziges Pflichtfeld im Request: `category` (`{id, objectName: "Category"}`). Kategorie-IDs laut Prosa: 2 Supplier, 3 Customer, 4 Partner, 28 Prospect Customer. `status`: 100 Lead (Default), 500 Pending, 1000 Active. Personen können einer Organisation per `parent` zugeordnet sein, Organisationen nicht Personen. `customerNumber` ist optional, Eindeutigkeit prüfen `GET /Contact/Mapper/checkCustomerNumberAvailability?customerNumber=`, nächste freie Nummer `GET /Contact/Factory/getNextCustomerNumber` (`{objects: string}`). Adressen und Kommunikationswege nur über `ContactAddress` und `CommunicationWay` (Pflicht ContactAddress: `contact`, `country`, `category`; CommunicationWay: `type` = `EMAIL, PHONE, WEB, MOBILE`, `value`, `key`). Feld heißt im Schema `exemptVat` (Prosa: `excemptVat`).

### 3.2 Steuerregeln (`taxRule`)

Quelle: Abschnitt "sevdesk-Update 2.0" der `info.description`. Das Objekt ist `{ "id": "1", "objectName": "TaxRule" }`. `taxType`/`taxSet` gelten als Update 1.0 und werden bei Systemversion 2.0 automatisch gemappt (`custom` entfällt). Dokumente, die unter 2.0 erstellt wurden, haben in der Response `taxRule` statt `taxType`. Ungültige Kombinationen aus Regel und Steuersatz führen zu HTTP 422.

Einnahmen (Regelbesteuerung):

| taxRule | Bedeutung | erlaubte `taxRate` in Positionen | früher |
|---|---|---|---|
| 1 | Umsatzsteuerpflichtige Umsätze | 0.0, 7.0, 19.0 | `taxType: default` |
| 2 | Ausfuhren | 0.0 | - |
| 3 | Innergemeinschaftliche Lieferungen | 0.0, 7.0, 19.0 | `taxType: eu` |
| 4 | Steuerfreie Umsätze §4 UStG | 0.0 | - |
| 5 | Reverse Charge gem. §13b UStG (Feld 60 der Umsatzsteuererklärung) | 0.0 | - |
| 21 | Reverse Charge gem. §18b UStG (Feld 21) | 0.0 | - |
| 17 | Nicht im Inland steuerbare Leistung | 0.0 | `taxType: noteu` |
| 18 | One Stop Shop (Waren) | abhängig vom Land | - |
| 19 | One Stop Shop (elektronische Dienstleistung) | abhängig vom Land | - |
| 20 | One Stop Shop (sonstige Leistung) | abhängig vom Land | - |

Nicht unterstützte Anwendungsfälle: Regel 21: Voucher, AR, TR, ER. Regel 17: AR, TR, ER. Regeln 18 bis 20: Voucher, E-Rechnung, eigenes Erlöskonto (`accountDatev`), AR, TR, ER. Nutzt eine Bestellung eine Regel, die AR/TR/ER nicht erlaubt, ist `createInvoiceFromOrder` nur mit `RE` (normale Rechnung) möglich (Verweis auf Beispiel-Request in der Spec).

Einnahmen (Kleinunternehmer): 11 Steuer nicht erhoben nach §19 UStG, Steuersatz 0.0, früher `taxType: ss`.

Ausgaben (Regelbesteuerung): 8 Innergemeinschaftliche Erwerbe (0/7/19), 9 Vorsteuerabziehbare Aufwendungen (0/7/19, früher `default`), 10 Nicht vorsteuerabziehbare Aufwendungen (0.0), 12 Reverse Charge §13b Abs. 2 mit Vorsteuerabzug 0% (19%) (0.0), 13 Reverse Charge §13b ohne Vorsteuerabzug 0% (19%) (0.0), 14 Reverse Charge §13b Abs. 1 EU Umsätze 0% (19%) (0.0). Ausgaben (Kleinunternehmer): 10 (früher `ss`), 13.

Die Schema-Enums für `taxRule.id` sind kleiner als die Prosa: Invoice, CreditNote, Order erlauben `1, 2, 3, 4, 5, 11, 17, 18, 19, 20, 21`, Voucher nur `1, 2, 3, 4, 5, 11`. Die Ausgaberegeln 8, 9, 10, 12, 13, 14 fehlen im Voucher-Enum (siehe Abschnitt 4). Welche Regeln und Sätze zu welchem Konto passen, liefert `GET /ReceiptGuidance/*` (`ReceiptGuideDto`: `accountDatevId`, `accountNumber`, `accountName`, `description`, `allowedTaxRules[{name (z. B. USTPFL_UMS_EINN), description, id, taxRates[...]}]`).

### 3.3 Request-Bodies der Factory-Endpunkte

Allgemein: In jedem Modell-Objekt sind `objectName` und `mapAll` (Boolean, "Internal param") Pflicht. Die Spec sagt, die Reihenfolge der letzten Felder der Factory-Bodies müsse eingehalten und alle müssten mitgeschickt werden, sonst "won't work properly". Das ist eine Eigenheit des Originals, für DoppelDesk nicht übernehmen (Annahme).

| Endpunkt | `required` im Body-Schema | Weitere Properties im Schema |
|---|---|---|
| `POST /Invoice/Factory/saveInvoice` | `invoice`, `invoicePos` (Property heißt aber `invoicePosSave`, siehe Inkonsistenzen) | `invoice` (`Model_Invoice`), `invoicePosSave` (Array `Model_InvoicePos`), `invoicePosDelete` (`{id, objectName}`, default null), `filename` (zuvor hochgeladene Datei), `discountSave` (Array), `discountDelete` (`{id, objectName: "Discounts"}`) |
| `POST /CreditNote/Factory/saveCreditNote` | `creditNote`, `creditNotePos` (Property: `creditNotePosSave`) | `creditNote`, `creditNotePosSave`, `creditNotePosDelete`, `discountSave`, `discountDelete` (Rabatte bei Gutschriften "deprecated and have no use") |
| `POST /Order/Factory/saveOrder` | `order`, `orderPos` (Property: `orderPosSave`) | `order`, `orderPosSave`, `orderPosDelete` |
| `POST /Voucher/Factory/saveVoucher` | `voucher`, `voucherPos` (Property: `voucherPosSave`) | `voucher`, `voucherPosSave`, `voucherPosDelete`, `filename` |

Response (201): `saveInvoiceResponse` = `{invoice, invoicePos[], filename}`, `saveCreditNoteResponse` = `{creditNote, creditNotePos[]}`, `saveOrderResponse` = `{order, orderPos[]}`, `saveVoucherResponse` = `{voucher, voucherPos[], filename}`. Alle ohne `objects`-Hülle laut Spec.

Update derselben Objekte läuft über die Factory: im Objekt `id`, `objectName` und `mapAll` setzen (Prosa: `{"invoice": {"id": 0, "objectName": "Invoice", "mapAll": true}, "invoicePos": [{"id": 0, ...}]}`), Positionen mit `id` werden aktualisiert, ohne `id` angelegt, `*PosDelete` löscht. Die Beschreibung erwähnt außerdem die Parameter `takeDefaultAddress` (erste Adresse des Kontakts als `address` übernehmen) und bei Gutschriften `forCashRegister`. Beide sind im Schema NICHT enthalten (Inkonsistenz).

`discountSave`-Element: `discount` (boolean, Rabatt oder Aufschlag), `text`, `percentage` (boolean, prozentual oder absolut), `value` (number), `objectName: "Discounts"`, `mapAll`; alle sechs Pflicht. Response-Modell `Model_Discount`/`Model_discountsResponse`: `id, objectName, create, update, object, sevClient, text, percentage, value, isNet (0 brutto, 1 netto)`.

Pflichtfelder der Modelle (Request):

| Modell | Pflichtfelder |
|---|---|
| `Model_Invoice` | `invoiceDate`, `contact`, `discount`, `status`, `addressCountry`, `contactPerson`, `taxRate`, `taxRule`, `taxText`, `taxType`, `invoiceType`, `currency`, `mapAll` (laut Prosa sind viele davon nur "empfohlen", z. B. `contact` nur Pflicht bei Status ungleich 100) |
| `Model_InvoicePos` | `unity`, `taxRate`, `quantity`, `objectName`, `mapAll` |
| `Model_creditNote` | `creditNoteNumber`, `creditNoteDate`, `contact`, `status`, `deliveryDate`, `addressCountry`, `contactPerson`, `taxRate`, `taxRule`, `taxText`, `taxType`, `bookingCategory`, `invoiceType`, `currency`, `header`, `mapAll`, `objectName` |
| `Model_creditNotePos` | `unity`, `taxRate`, `quantity`, `mapAll`, `objectName` |
| `Model_Order` | `orderNumber`, `orderDate`, `contact`, `status`, `addressCountry`, `contactPerson`, `taxRate`, `taxRule`, `taxText`, `taxType`, `currency`, `header`, `version`, `mapAll` |
| `Model_OrderPos` | `unity`, `taxRate`, `quantity` |
| `Model_Voucher` | `creditDebit`, `taxType`, `taxRule`, `status`, `voucherType`, `mapAll`, `objectName` |
| `Model_VoucherPos` | `accountDatev`, `accountingType`, `voucher`, `taxRate`, `sumGross`, `sumNet`, `net`, `mapAll`, `objectName` (`accountDatev` ersetzt `accountingType` in Update 2.0, trotzdem beide Pflicht) |
| `Model_Part` | `taxRate`, `unity`, `stock`, `name`, `partNumber` |
| `Model_Contact` | `category` |
| `Model_CheckAccountTransaction` | `valueDate`, `checkAccount`, `amount`, `status`, `payeePayerName` |

Positionsmodelle: `quantity`, `price`, `priceNet`, `priceGross`, `priceTax`, `name`, `text`, `unity` (`{id, objectName: "Unity"}`), `part`, `positionNumber` (Prosa: "Needs to start with zero and is incremented for every new position"), `discount` (Positionsrabatt), `taxRate`, `sumDiscount`, `sumNetAccounting`/`sumTaxAccounting`/`sumGrossAccounting`, bei Order/CreditNote zusätzlich `optional`. Berechnung laut Prosa: Brutto der Position = Preis x Menge x (1 + Steuersatz/100), also 100 x 2 x 1,19 = 238. `showNet` bestimmt, ob `price` netto (true) oder brutto (false) ist. Der Dokumentkopf (`Model_Invoice` usw.) trägt `sumNet`, `sumTax`, `sumGross`, `sumDiscounts` (+ `*ForeignCurrency`, `*Accounting`).

VoucherPos: `net` bestimmt, ob `sumNet` oder `sumGross` gilt ("If both are not given, 'sum' is regarded"); alle Positionen müssen entweder netto oder brutto sein. Weitere Felder `isAsset`, `comment`, `estimatedAccountingType`. Update 2.0: Anlagenkonto ohne Anlage ist nicht mehr möglich.

Weitere Factory-Endpunkte:

| Endpunkt | Body und Pflicht | Besonderheiten |
|---|---|---|
| `POST /Invoice/Factory/createInvoiceFromOrder` | `Model_CreateInvoiceFromOrder`: `order` (`{id, objectName}`) Pflicht; `type` = `percentage`/`net`/`gross`; `amount`; `partialType` = `RE`/`TR`/`AR` | Response 200 bare `Model_InvoiceResponse`. Beschreibung in Schema: `RE` = "Schlussrechnung", `TR` Teilrechnung, `AR` Abschlagsrechnung. Das widerspricht `invoiceType` (dort ist RE normal, ER Schluss). Update 2.0: Schlussrechnung (`partialType` ER laut Prosa) nicht möglich, wenn bereits AR/TR existieren |
| `POST /Invoice/Factory/createInvoiceReminder` | Body `{invoice: {id, objectName}}` Pflicht, zusätzlich Query `invoice[id]*`, `invoice[objectName]*` (doppelt deklariert) | Response 200 bare `Model_InvoiceResponse`. Update 2.0: Mahnung (MA) mit `reminderCharge` > 0 nicht erlaubt |
| `POST /CreditNote/Factory/createFromInvoice` | `{invoice: {id, objectName}}` Pflicht | 201 `{objects: {creditNote, creditNotePos[], discount[]}}` |
| `POST /CreditNote/Factory/createFromVoucher` | `{voucher: {id, objectName}}` | Nur Systemversion 1.0, unter 2.0 entfernt ("Not supported with sevdesk-Update 2.0") |
| `POST /Order/Factory/createPackingListFromOrder` | Query `order[id]*`, `order[objectName]*`, Body `Model_CreatePackingListFromOrder` `{id, objectName: "Order"}` | 200 bare `Model_OrderResponse` (neuer Lieferschein, vermutlich `orderType` LI, nicht in der Spec belegt) |
| `POST /Order/Factory/createContractNoteFromOrder` | wie oben | 200 bare `Model_OrderResponse` (Auftragsbestätigung, vermutlich AB, nicht belegt) |
| `POST /Voucher/Factory/uploadTempFile` | `multipart/form-data` Feld `file` | 201 `{objects: {pages, mimeType, originMimeType, filename (Hash), contentHash, content[]}}`; `filename` dann in `saveVoucher` übergeben. Auch XML und PDF mit eingebettetem XML (ZUGFeRD) erlaubt, ohne EN16931-Validierung |
| `POST /Tag/Factory/create` | `{name, object: {id, objectName}}` | 200 `Model_TagCreateResponse` (ein `TagRelation`-Objekt mit `tag`, `object`). `object.objectName` = `Invoice`, `Voucher`, `Order`, `CreditNote`. Die TagRelation wird beim Anlegen automatisch erzeugt |

### 3.4 Zahlungen buchen: `bookAmount`

Gilt für `PUT /Invoice/{id}/bookAmount`, `PUT /CreditNote/{id}/bookAmount`, `PUT /Voucher/{id}/bookAmount` (Gutschrift und Voucher: "same process as invoices").

| Feld | Typ | Pflicht | Beschreibung |
|---|---|---|---|
| `amount` | number | ja | Zu buchender Betrag, "can also be a partial amount" |
| `date` | integer (Timestamp), bei Voucher string `date-time` | ja | Buchungsdatum, "most likely the current date" |
| `type` | string | ja | `FULL_PAYMENT` normale Buchung, `N` Teilbuchung (historisch für normale Buchung), `CB` reduzierter Betrag wegen Skonto, `CF` Währungsschwankung (deprecated, unter 2.0 nicht mehr unterstützt), `O` abweichender Betrag aus sonstigen Gründen, `OF` höherer Betrag wegen Mahngebühren, `MTC` reduzierter Betrag wegen Zahlungsverkehrskosten |
| `checkAccount` | `{id: integer, objectName: "CheckAccount"}` | ja | Konto, auf dem gebucht wird |
| `checkAccountTransaction` | `{id, objectName}` (beide Pflicht, wenn angegeben) | nein | Vorhandene Transaktion, die verknüpft wird. Bei `online`-Konten Pflicht (wie Auswahl in der UI). Bei anderen Kontotypen wird die Transaktion automatisch erzeugt, "you should not provide a transaction" |
| `createFeed` | boolean | nein | Ob für die Buchung ein Feed-Eintrag entsteht |

Prosa: Die Buchung auf dem Standardkonto oder der Kasse braucht keine Transaktion (wird automatisch erzeugt und verknüpft). "When booking the invoices it is important that an id and an objectName are passed along, otherwise a logic error will occur."

Response 200 (Protokolleintrag, kein Dokument): Invoice/CreditNote: `{id, objectName: "InvoiceLog", additionalInformation, create, creditNote{id, objectName}, fromStatus, toStatus, ammountPayed, bookingDate, sevClient}` (sic: `ammountPayed`, und beim Invoice-Endpunkt heißt die Referenz `creditNote`, Beschreibung "Invoice"). Voucher: `{id, objectName, create, voucher{id, objectName}, fromStatus, toStatus, amountPayed, bookingDate, sevClient}`. Beispiel: `fromStatus: 200`, `toStatus: 1000`. Der Folgestatus (750 oder 1000) ergibt sich aus gebuchter Summe gegen Gesamtsumme (Annahme, in der Spec nicht ausformuliert). Update 2.0 für Voucher: Buchen nur nach vorheriger Registrierung (Status 100), Voucher mit negativen Positionen dürfen kein Skonto als Differenz nutzen, einige Differenzgründe hängen von den Positionen ab.

### 3.5 Statusübergänge und Aktionen (Update 2.0)

`changeStatus` ist für Invoice und CreditNote entfernt. Status ändert sich ausschließlich über diese Endpunkte:

| Aktion | Wirkung laut Spec |
|---|---|
| Anlegen (`saveInvoice`, `saveCreditNote`) | Nur Status `100` (Draft) möglich, danach nicht manuell änderbar. `enshrined` setzen/ändern nur über `enshrine` |
| `PUT .../sendBy` (Body `sendType` = VPR/VP/VM/VPDF, `sendDraft` boolean, beide Pflicht) | "Marks as sent by a chosen send type": setzt `sendType` und den Status auf 200 (dass auch `sendDate` gesetzt wird, ist Annahme, nicht ausformuliert). `sendDraft: true` erzeugt einen internen Entwurf und "will not alter the status of the invoice or create bookings for reports" |
| `POST .../sendViaEmail` (Pflicht `toEmail`, `subject`, `text`; optional `copy`, `additionalAttachments`, `ccEmail`, `bccEmail`, bei Invoice `sendXml`) | "automatically mark the invoice as sent", ändert Status automatisch; danach darf (produktiv) nicht mehr geändert werden. Response 201 `Model_Email` (Invoice) bzw. `{objects: [Model_creditNote_mailResponse]}` bzw. `{objects: [Model_EmailOrder]}` |
| `GET CreditNote/{id}/sendByWithRender?sendType=` | Nur Rendern (Drucken) |
| `bookAmount` | Status 750 (teilweise) oder 1000 (voll bezahlt), siehe 3.4 |
| `PUT .../resetToDraft` | Status 100. Nur möglich aus Status 200, bei höherem Status zuerst `resetToOpen`. Nicht für WKR (Invoice) |
| `PUT .../resetToOpen` | Status 200. "Linked transactions will be unlinked." Nicht möglich, wenn das Dokument selbst oder eine seiner Transaktionen `enshrined` ist. Kann den Status nicht auf 200 erhöhen (dafür `sendBy`/`sendViaEmail`). Nicht für WKR (Invoice) |
| `PUT .../enshrine` | Setzt `enshrined` auf aktuelle Zeit. Nur ab Status 200 (Invoice, CreditNote) bzw. 100 (Voucher). "Cannot be undone". Enshrined Dokumente sind unveränderbar |
| `POST /Invoice/{id}/cancelInvoice` | "will cancel the specified invoice therefor creating a cancellation invoice. The cancellation invoice will be automatically paid and the source invoices status will change to 'cancelled'." Response 201 bare `Model_InvoiceResponse` (die Stornorechnung, vermutlich `invoiceType` SR, nicht explizit belegt) |
| Voucher `resetToOpen` | Status 100. Verknüpfte Zahlungen werden gelöst, "Created asset depreciation will be reset". Nicht möglich, wenn enshrined. Kann nicht von Draft auf Open erhöhen |
| Voucher `resetToDraft` | Status 50. Zahlungen gelöst, Abschreibung zurückgesetzt, nicht möglich wenn enshrined. Erhöhen über `saveVoucher` |
| `PUT /CheckAccountTransaction/{id}/enshrine` | Nur ab Status 200 (Linked) |
| `getPdf`, `render` | `getPdf` liefert `{filename, mimeType, base64encoded, content}`. Bei Order: "and commit the order". `preventSendBy`, `download` als Query. `render` (POST, `{forceReload}`) erzeugt das PDF, Response 201 `{pdf, docId, parameters[]}` |
| `getXml` (Invoice) | `{objects: string}`, nur E-Rechnung (`propertyIsEInvoice: true`) |
| `getIsPartiallyPaid` | `{objects: boolean}`, vollständig bezahlte Rechnungen zählen als "not partially paid" |

Update-2.0-Validierungen für Rechnungen (jeweils HTTP 422): kein `taxType: custom`; Rechnung über Status 100 hinaus braucht einen Kontakt; AR und TR nur mit `taxRule` 1 (Regelbesteuerer) oder 11 (Kleinunternehmer); Mahnung (MA) mit `reminderCharge` > 0 nicht erlaubt; AR/TR/ER nur in der Standardwährung des Mandanten (`defaultCurrency`); Status manuell nicht änderbar. Zusätzlich: eine reguläre Rechnung darf kein `deliveryDate` nach dem `invoiceDate` haben (dafür AR); für ER muss `invoiceDate` >= `invoiceDate` der zugehörigen AR/TR sein.

Gutschriften (422): `deliveryDateUntil` muss zur Rechnung passen (nicht fehlen, wenn die Rechnung eines hat, nicht gesetzt sein, wenn die Rechnung keines hat, nicht vor dem der Rechnung liegen); keine Gutschrift für AR/TR; keine für Vouchers; `bookingCategory: ACCOUNTING_TYPE` nicht unterstützt; Währungsschwankung (CF) nicht als Zahlungsdifferenz.

### 3.6 Nummern und Datumsfelder

- `invoiceNumber`, `creditNoteNumber`, `orderNumber` sind beim Anlegen optional (Request-Schema nullable bzw. in der Prosa "not an attribute that must be supplied"), aber für Gutschrift und Order als Pflicht im Schema gelistet. Die nächste Nummer kommt von `GET /SevSequence/Factory/getByType?objectType=Invoice&type=RE` (CreditNote: `type=CN`). Dieser Pfad ist in der Spec NICHT enthalten (nur in der Prosa). Format im Beispiel `RE-1000`; `header` besteht "normally of prefix plus number" (Beispiel `Invoice RE-1000`).
- Wann genau die Nummer vergeben wird (beim Anlegen oder beim Versenden), steht nicht in der Spec. Annahme nötig, siehe docs/annahmen.md.
- `payDate`: "date the end-customer has paid" (Timestamp). Dass `bookAmount` es setzt, ist nicht ausdrücklich dokumentiert.
- `sendDate`: "date the invoice was sent"; `sendType` wird durch `sendBy`/`sendViaEmail` gesetzt.
- `enshrined`: Zeitstempel, nur über `enshrine`.
- `timeToPay` in Tagen, `discount` Skonto-Prozent mit `discountTime` in Tagen (Prosa, im Request-Schema fehlt `discountTime`).
- `invoiceDate`: Timestamp oder `dd.mm.yyyy`.
- `address`: kompletter Empfänger mit Zeilenumbrüchen; `addressCountry` kann entfallen. `deliveryAddressCountry` (Prosa) für One-Stop-Shop-Regeln, im Schema nicht vorhanden.
- E-Rechnung: `propertyIsEInvoice: true` benötigt weitere Stammdaten (Mandant: Straße, PLZ, Ort, IBAN, BIC, Kontakt-E-Mail/Telefon, Steuer-/USt-Nummer; Kontakt: `buyerReference`, E-Mail; Rechnung: Zahlungsart, Adresse). PDF enthält dann eingebettetes XML (ZUGFeRD), `getXml` liefert XRechnung.

### 3.7 Löschen und fehlende Operationen

Aus den Operationslisten ergibt sich, was die Spec NICHT bereitstellt (relevant für "jede Operation der Spec wird exponiert", Verhalten des Originals evtl. abweichend):

| Modell | PUT/GET by id | DELETE |
|---|---|---|
| Invoice | nur GET by id, kein `PUT /Invoice/{id}` (Update über `saveInvoice`, plus `changeParameter`) | keiner |
| CreditNote | GET, PUT | ja (409 möglich) |
| Order | GET, PUT | ja |
| OrderPos | GET, PUT | ja |
| Voucher | GET, PUT (nur Entwurf) | keiner |
| Part | GET, PUT | keiner |
| Contact, ContactAddress, CommunicationWay, AccountingContact | GET, PUT (CommunicationWay hat `UpdateCommunicationWay`) | ja |
| InvoicePos, CreditNotePos, VoucherPos | nur Liste (`GET /InvoicePos` usw.), kein by id | keiner |
| Tag | GET, PUT (nur `name`), `POST /Tag/Factory/create` | ja |
| CheckAccount, CheckAccountTransaction | GET, PUT | ja (409 möglich) |

`DELETE` liefert in der Spec 200 `{objects: []}`. 409 steht für nicht löschbar (z. B. verknüpft). Nicht als Pfad in der Spec, aber von Prosa oder Beschreibungen als Endpunkt genannt: `/SevSequence/Factory/getByType`, `/Category?objectType=...`, `/StaticCountry`, `/AccountingType`. Zusätzlich werden Modelle nur als verschachtelte Referenzen genutzt, ohne eigene Endpunkte: `Unity`, `Document`, `CostCentre`, `PaymentMethod`, `SevUser`, `TaxRule`, `AccountDatev`. Positionen und Dokumente referenzieren sie (`unity`, `addressCountry`, `contactPerson`, `category`, `paymentMethod`), daher braucht DoppelDesk dafür Seed-Daten (Annahme).

Layout (`changeParameter` an Invoice/Order/CreditNote): Body `{key: language|template|letterpaper|payPal, value}`, Response `Model_ChangeLayoutResponse`. Sprachen: `de_DE`, `de_AT`, `de_CH`, `en_US`, `es_ES`, `fr_FR`, `id_IT` (sic), `el_GR`. PayPal: `A` Icon, `B` Link, `C` deaktiviert, `D` als String. Dokumente müssen vorher gerendert sein.

Hinweis zu PrivateTransactionRule: Body `objectName: "PrivateTransactionRule"` (Pflicht), `paymentPurpose`, `counterpartName`. Hinweis zu AccountingContact: Update/Löschen kann laut Spec Buchungsfehler im DATEV-Export verursachen. Hinweis zu Bookkeeping-Version: `GET /Tools/bookkeepingSystemVersion` liefert `{objects: {version: "1.0"|"2.0"}}`.

## 4. Inkonsistenzen und Auffälligkeiten der Spec

1. Factory-Bodies: `required` nennt `invoicePos`/`creditNotePos`/`orderPos`/`voucherPos`, die Properties heißen `invoicePosSave`/`creditNotePosSave`/`orderPosSave`/`voucherPosSave`. Welcher Name gilt, muss gegen das Live-Verhalten geprüft werden (Live-Beobachtungen haben Vorrang).
2. `takeDefaultAddress` (Invoice, CreditNote) und `forCashRegister` (CreditNote) stehen in der Beschreibung, fehlen im Schema.
3. Invoice-Status: Enum `50, 100, 200, 750, 1000`, Listenfilter nur `100, 200, 1000`. "cancelled" (cancelInvoice-Beschreibung) hat keinen Code im Enum. Das Verhalten des Originalstatus nach dem Storno ist damit nicht spezifiziert.
4. CreditNote-Status: Beschreibung/Response `100, 200, 750, 1000`, Request-Schema und Filter zusätzlich `300, 500`. `Model_creditNote.required` enthält `invoiceType`, ohne Property. `Model_creditNote` hat kein `enshrined`, `payDate`, `deliveryDateUntil`, `refSrcInvoice`, obwohl Prosa und `enshrine`-Endpunkt sie voraussetzen.
5. Voucher-Status: Prosa `50, 100, 150, 750, 1000`, Schema nur `50, 100, 1000`. Voucher-`taxRule`-Enum fehlt 8, 9, 10, 12, 13, 14 (die Ausgaberegeln), die Voucher-Tag-Prosa listet `1 bis 5, 17` und ordnet Kleinunternehmer `1` zu statt `11`.
6. `Model_InvoicePosResponse.quantity` ist `boolean` (Beispiel `true`), bei Order- und CreditNote-Positionen `string`. Vermutlicher Spec-Fehler, `quantity` ist fachlich eine Zahl.
7. `bookAmount`-Response: `ammountPayed` (Tippfehler), Referenz heißt bei Invoice `creditNote` (Beschreibung "id of the invoice"), `objectName` Beispiel `InvoiceLog`. Voucher-Variante heißt `amountPayed` und `voucher`.
8. `bookAmount.date`: integer bei Invoice/CreditNote, `date-time` string bei Voucher.
9. `createInvoiceReminder` verlangt `invoice[id]`/`invoice[objectName]` zugleich als Query und Body. `createPackingListFromOrder` und `createContractNoteFromOrder` verlangen `order[id]`/`order[objectName]` als Query und Body.
10. `createInvoiceFromOrder.partialType` beschriftet `RE` als Schlussrechnung, im `invoiceType`-Enum ist `ER` die Schlussrechnung.
11. Response-Hülle: GET by id liefert `{objects: [X]}` (Array statt Objekt), POST/PUT liefern teils bare, teils `{objects: X}` (Account-Factories, Tag-Factory). Uneinheitlich, im Original vermutlich einheitlicher als in der Spec.
12. `Model_Invoice.taxType`-Enum ohne `ss`, Prosa nennt `ss`. `taxRate` ist "not used anymore", aber Pflicht im Request.
13. Typfehler: `getCommunicationWayKeys` hat `upadate` statt `update`. Prosa/Filter mit Tippfehlern (`customerIntenalNote`, `creditNoteNumberNumberSmaller`, `orderNumberNumberSmaller`), `id_IT` als Sprachcode, Prosa `excemptVat` gegenüber Schema `exemptVat`, `surename`.
14. `Model_Part` wird zugleich als Request und Response genutzt (`Model_Part` ohne `Response`-Variante), daher in der Response keine String-Coercion modelliert (`number`/`integer`).
15. Pfadparameter-Typen uneinheitlich (`number` bei `contactCustomFieldId` GET/PUT und `SevClientId`, sonst `integer`). `operationId` `contactAddressId` für `GET /ContactAddress/{id}` und `UpdateCommunicationWay` (Großbuchstabe) weichen vom Schema ab.
16. `POST /ContactCustomField` und `POST /Tag/Factory/create` deklarieren 200 statt 201; `createFileImportAccount` und `createClearingAccount` liefern 201 in einer `objects`-Hülle.
17. `createInvoiceFromOrder`, `createInvoiceReminder`, `createPackingListFromOrder`, `createContractNoteFromOrder` deklarieren 200 statt 201, obwohl sie Objekte erzeugen.
18. `Order`-Pflichtfelder in `Model_Order` verlangen `mapAll`, `Model_OrderPos` nicht (sonst überall Pflicht).
19. `info.description` verweist auf Bilder und Videos unter `openAPI/img/...` und enthält ein Beispiel-Token. Beides irrelevant für DoppelDesk.
