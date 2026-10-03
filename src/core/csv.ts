// Minimal RFC 4180 CSV parser. Pure: no I/O.
// Handles quoted fields, escaped quotes, embedded newlines, CRLF/LF/CR and a UTF-8 BOM.
// Blank lines are skipped. Malformed quoting fails the whole parse with a line number.

export interface CsvRecord {
  /** 1-based line on which the record starts (the header is line 1). */
  line: number;
  values: string[];
}

export type CsvParseResult = { ok: true; records: CsvRecord[] } | { ok: false; line: number; message: string };

export function parseCsv(text: string): CsvParseResult {
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const records: CsvRecord[] = [];
  let values: string[] = [];
  let field = "";
  let state: "start" | "unquoted" | "quoted" | "afterQuote" = "start";
  let line = 1;
  let recordLine = 1;

  const endField = () => {
    values.push(field);
    field = "";
    state = "start";
  };
  const endRecord = () => {
    const blank = values.length === 0 && field === "" && state === "start";
    if (!blank) {
      endField();
      records.push({ line: recordLine, values });
    }
    values = [];
    field = "";
    state = "start";
  };

  for (let i = 0; i < src.length; i++) {
    const c = src[i] as string;
    if (state === "quoted") {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          state = "afterQuote";
        }
      } else {
        if (c === "\n" || (c === "\r" && src[i + 1] !== "\n")) line++;
        field += c;
      }
      continue;
    }
    if (c === ",") {
      endField();
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      endRecord();
      line++;
      recordLine = line;
    } else if (state === "afterQuote") {
      return { ok: false, line, message: "Unexpected character after a closing quote" };
    } else if (c === '"') {
      if (state === "unquoted") return { ok: false, line, message: "Quote inside an unquoted field" };
      state = "quoted";
    } else {
      field += c;
      state = "unquoted";
    }
  }
  if (state === "quoted") return { ok: false, line: recordLine, message: "Unterminated quoted field" };
  endRecord();
  return { ok: true, records };
}
