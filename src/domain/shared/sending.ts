import type { PlainObject } from "../../lib/object.ts";
import { toIso } from "../../lib/time.ts";
import type { Doc } from "../../store/collection.ts";
import type { Tenant } from "../../tenant/tenant.ts";
import { userEmail } from "./contacts.ts";
import { createDocument, patchDocument } from "./documents.ts";
import { isTrue } from "./list.ts";
import { toNumber } from "./money.ts";
import { storedStatus } from "./payments.ts";
import { readRef, toRef } from "./refs.ts";
import { blankFields, invalidParameter, isOneOf, missingParameters, validationError } from "./validation.ts";

/** Send types (spec enum): print, postal, mail, downloaded PDF. */
export const SEND_TYPES = ["VPR", "VP", "VM", "VPDF"] as const;
export type SendType = (typeof SEND_TYPES)[number];

/** How sending works for one document model (invoice, credit note, order). */
export interface SendableModel {
  model: string;
  draftStatus: number;
  /** Status a draft gets when it is sent. */
  sentStatus: number;
  /**
   * Update 2.0: an invoice beyond draft needs a contact (spec, HTTP 422). Assumption: the
   * same holds for credit notes; orders have no such rule.
   */
  requiresContact: boolean;
}

/** Send fields of a document that was never sent (or was reset to draft). */
export const UNSENT_FIELDS: Readonly<PlainObject> = { sendType: null, sendDate: null };

/**
 * Marks a document as sent: a draft gets the sent status, sendType and sendDate are
 * stored (live for invoices: 100 -> 200). Assumption: documents beyond draft keep their
 * status while sendType and sendDate are overwritten.
 */
export function markSent(tenant: Tenant, sendable: SendableModel, document: Doc, sendType: SendType): Doc {
  const isDraft = toNumber(document.status) === sendable.draftStatus;
  if (isDraft && sendable.requiresContact && readRef(document.contact) === undefined) {
    throw validationError("A document without contact can not be processed beyond the status draft");
  }
  return patchDocument(tenant, sendable.model, document.id, {
    ...(isDraft ? { status: storedStatus(document, sendable.sentStatus) } : {}),
    sendType,
    sendDate: toIso(tenant.clock.now()),
  });
}

/**
 * PUT /<Model>/{id}/sendBy: sendType is required (400). With sendDraft=true nothing changes
 * (spec: "will not alter the status"). Assumption: a missing sendDraft counts as false,
 * although the spec lists it as required.
 */
export function sendBy(tenant: Tenant, sendable: SendableModel, id: string, input: PlainObject): Doc {
  const document = tenant.store.collection(sendable.model).require(id);
  if (blankFields(input, ["sendType"]).length > 0) throw missingParameters(["sendType"]);
  if (!isOneOf(SEND_TYPES, input.sendType)) throw invalidParameter("sendType", { allowed: SEND_TYPES });
  if (isTrue(input.sendDraft)) return document;
  return markSent(tenant, sendable, document, input.sendType);
}

/**
 * POST /<Model>/{id}/sendViaEmail: no mail is sent. The document is marked as sent (VM) and
 * an Email document is stored for inspection. Required: toEmail, subject, text (spec).
 * Returns the email with the full document in "object" (spec Model_Email). Assumption:
 * "from" is the email of the document's contact person.
 */
export function sendViaEmail(
  tenant: Tenant,
  sendable: SendableModel,
  id: string,
  input: PlainObject,
): PlainObject {
  const document = tenant.store.collection(sendable.model).require(id);
  const missing = blankFields(input, ["toEmail", "subject", "text"]);
  if (missing.length > 0) throw missingParameters(missing);
  const sent = markSent(tenant, sendable, document, "VM");
  const email = createDocument(tenant, "Email", {
    additionalInformation: null,
    object: toRef(document.id, sendable.model),
    from: userEmail(tenant, document.contactPerson),
    to: input.toEmail,
    subject: input.subject,
    text: input.text,
    cc: input.ccEmail ?? null,
    bcc: input.bccEmail ?? null,
    arrived: null,
  });
  return { ...email, object: sent };
}

/**
 * getPdf: unless preventSendBy=true, fetching the PDF marks a draft as sent with sendType
 * VPDF. Assumption from the spec descriptions ("Defines if u want to send the invoice",
 * "commit the order"); not verified. A draft that can not leave the draft status (no
 * contact) stays a draft, the download itself never fails for that reason.
 */
export function commitOnDownload(
  tenant: Tenant,
  sendable: SendableModel,
  document: Doc,
  query: PlainObject,
): Doc {
  if (isTrue(query.preventSendBy) || toNumber(document.status) !== sendable.draftStatus) return document;
  if (sendable.requiresContact && readRef(document.contact) === undefined) return document;
  return markSent(tenant, sendable, document, "VPDF");
}
