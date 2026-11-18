import { toRef } from "../../domain/shared/refs.ts";

/** The seeded SevUser (src/seed/basic.ts) acts as contact person and creator of all demo documents. */
export const USER_REF = toRef(1, "SevUser");

/** Ids of the reference data created by seedBasic. */
export const UNITY = { piece: 1, flatRate: 2, days: 8, hour: 9, month: 11 } as const;
export const CATEGORY = {
  supplier: 2,
  customer: 3,
  billingAddress: 47,
  partStandard: 1,
  partService: 97430,
} as const;
export const COUNTRY = { germany: 1, austria: 2, switzerland: 3 } as const;
export const COMMUNICATION_WAY_KEY = { work: 2, mobile: 4 } as const;
export const CHECK_ACCOUNT = { clearing: "1", bank: "2", cash: "3" } as const;

/** Tax setup shared by the header of a sales document (Update 2.0: tax rule plus the legacy tax type). */
export interface TaxRegime {
  ruleId: number;
  taxType: string;
  taxRate: number;
  taxText: string;
}

/** Regular taxable sales in Germany (tax rule 1). */
export const DOMESTIC: TaxRegime = {
  ruleId: 1,
  taxType: "default",
  taxRate: 19,
  taxText: "Umsatzsteuer 19%",
};

/**
 * Services for a customer abroad outside the EU (tax rule 17). Synthetic demo data: the
 * wording is an illustration, not tax advice.
 */
export const NOT_TAXABLE_ABROAD: TaxRegime = {
  ruleId: 17,
  taxType: "noteu",
  taxRate: 0,
  taxText: "Nicht im Inland steuerbare Leistung",
};

/** Tax rule of deductible expenses (tax rule 9) for vouchers. */
export const DEDUCTIBLE_EXPENSE_RULE_ID = 9;
