// One row of a CSV import. Invalid rows are kept with their reasons, never discarded.
import { sql } from "drizzle-orm";
import { check, index, integer, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { id, timestamps } from "./common";
import { csvRowStatus } from "./enums";
import { companies } from "./identity";
import { sourceRecords } from "./provenance";

export const csvImportRows = pgTable(
  "csv_import_rows",
  {
    id: id(),
    // The CSV file's source record is the import batch.
    sourceRecordId: uuid("source_record_id")
      .notNull()
      .references(() => sourceRecords.id, { onDelete: "cascade" }),
    // 1-based line in the file (the header is line 1).
    rowNumber: integer("row_number").notNull(),
    rawValues: text("raw_values").array().notNull(),
    status: csvRowStatus("status").notNull(),
    // Company created from this row, or the existing company whose domain it matched.
    companyId: uuid("company_id").references(() => companies.id, { onDelete: "set null" }),
    // Machine-readable issue codes (errors for invalid rows, warnings otherwise).
    issueCodes: text("issue_codes").array().notNull().default(sql`'{}'::text[]`),
    issueDetail: text("issue_detail"),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("csv_import_rows_record_row").on(t.sourceRecordId, t.rowNumber),
    index("csv_import_rows_status").on(t.status),
    check("csv_import_rows_row_number", sql`${t.rowNumber} >= 2`),
    check(
      "csv_import_rows_invalid_has_reason",
      sql`${t.status} not in ('invalid', 'failed') or (cardinality(${t.issueCodes}) > 0 and ${t.issueDetail} is not null)`,
    ),
    check(
      "csv_import_rows_company",
      sql`(${t.status} in ('imported', 'matched_existing')) = (${t.companyId} is not null)`,
    ),
  ],
);
