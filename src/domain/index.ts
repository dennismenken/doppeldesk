import type { DomainModule } from "../routes/types.ts";
import { accountingModule } from "./accounting/index.ts";
import { contactModule } from "./contact/index.ts";
import { creditNoteModule } from "./creditNote/index.ts";
import { invoiceModule } from "./invoice/index.ts";
import { masterDataModule } from "./masterData/index.ts";
import { orderModule } from "./order/index.ts";

/** All domain modules. Their routes override generic spec routes with the same key. */
export const domainModules: readonly DomainModule[] = [
  invoiceModule,
  creditNoteModule,
  orderModule,
  contactModule,
  masterDataModule,
  accountingModule,
];
