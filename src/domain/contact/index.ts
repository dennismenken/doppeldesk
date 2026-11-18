import type { DomainModule } from "../../routes/types.ts";
import { accountingContactRoutes, addressRoutes, communicationWayRoutes } from "./contactParts.ts";
import { contactRoutes } from "./contacts.ts";
import { customFieldRoutes } from "./customFields.ts";
import { tagRoutes } from "./tags.ts";

export { COMMUNICATION_WAY_KEYS, seedCommunicationWayKeys } from "./communicationWayKeys.ts";
export { createContactDocument, deleteContactCascade } from "./contacts.ts";
export { issueCustomerNumber, peekFreeCustomerNumber } from "./customerNumber.ts";

/** Contacts and everything attached to them: addresses, communication ways, custom fields, accounting contacts, tags, customer numbers. */
export const contactModule: DomainModule = {
  name: "contact",
  models: [
    "Contact",
    "ContactAddress",
    "CommunicationWay",
    "CommunicationWayKey",
    "ContactCustomField",
    "ContactCustomFieldSetting",
    "AccountingContact",
    "Tag",
    "TagRelation",
  ],
  routes: [
    ...contactRoutes,
    ...addressRoutes,
    ...communicationWayRoutes,
    ...accountingContactRoutes,
    ...customFieldRoutes,
    ...tagRoutes,
  ],
};
