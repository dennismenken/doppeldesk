import { createDocument } from "../../domain/shared/documents.ts";
import { toRef } from "../../domain/shared/refs.ts";
import type { Doc } from "../../store/collection.ts";
import type { Tenant } from "../../tenant/tenant.ts";
import { CHECK_ACCOUNT } from "./reference.ts";
import { dayStartIso } from "./timeline.ts";

/** A movement on the demo bank account as an import would deliver it. */
export interface BankMovement {
  /** Days before the reference day. */
  day: number;
  /** Signed amount: positive for incoming money. */
  amount: number;
  payeePayerName: string;
  purpose: string;
}

/**
 * Inserts an imported, not yet linked transaction (status 100) on the online bank account.
 * Linking it to a document happens through the document's bookAmount.
 */
export function insertBankTransaction(tenant: Tenant, movement: BankMovement): Doc {
  const date = dayStartIso(movement.day);
  return createDocument(tenant, "CheckAccountTransaction", {
    valueDate: date,
    entryDate: date,
    paymtPurpose: movement.purpose,
    amount: movement.amount,
    payeePayerName: movement.payeePayerName,
    payeePayerAcctNo: null,
    payeePayerBankCode: null,
    checkAccount: toRef(CHECK_ACCOUNT.bank, "CheckAccount"),
    status: 100,
    sourceTransaction: null,
    targetTransaction: null,
    enshrined: null,
  });
}
