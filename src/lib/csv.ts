// Matches the old app's exact CSV format (RFC4180-ish, quoted multi-line cells, UTF-8 BOM,
// CRLF) so a file exported from its admin "Export Archive" button imports here unchanged, and
// vice versa — this is the migration path from the old question bank, not a one-off script.

export function parseCSV(text: string): string[][] {
  const result: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const next = text[i + 1];

    if (inQuotes) {
      if (char === '"' && next === '"') {
        cell += '"';
        i++;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        cell += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      row.push(cell);
      cell = "";
    } else if (char === "\n" || char === "\r") {
      row.push(cell);
      if (row.some((c) => c.trim().length > 0)) result.push(row);
      row = [];
      cell = "";
      if (char === "\r" && next === "\n") i++;
    } else {
      cell += char;
    }
  }
  if (cell !== "" || row.length > 0) {
    row.push(cell);
    if (row.some((c) => c.trim().length > 0)) result.push(row);
  }
  return result;
}

export function toCSV(rows: string[][]): string {
  const body = rows
    .map((row) =>
      row
        .map((cell) => `"${String(cell ?? "").replace(/"/g, '""')}"`)
        .join(","),
    )
    .join("\r\n");
  return "﻿" + body;
}

export function downloadCSV(filename: string, rows: string[][]) {
  const blob = new Blob([toCSV(rows)], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
