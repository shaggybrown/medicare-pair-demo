function parseCsv(text) {
  const rows = [];
  let row = [];
  let value = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const nextChar = text[i + 1];

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        value += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === "," && !inQuotes) {
      row.push(value);
      value = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && nextChar === "\n") i += 1;
      row.push(value);
      if (row.some((cell) => String(cell).trim() !== "")) rows.push(row);
      row = [];
      value = "";
      continue;
    }

    value += char;
  }

  if (value.length || row.length) {
    row.push(value);
    if (row.some((cell) => String(cell).trim() !== "")) rows.push(row);
  }

  if (rows.length < 2) return { headers: [], records: [] };

  const headers = rows[0].map((header) => String(header || "").trim());
  const records = rows.slice(1).map((line) => {
    const rec = {};
    headers.forEach((header, idx) => {
      rec[header] = String(line[idx] || "").trim();
    });
    return rec;
  });

  return { headers, records };
}

function escapeCsvValue(value) {
  const text = String(value ?? "");
  if (text.includes(",") || text.includes('"') || text.includes("\n")) {
    return `"${text.replaceAll('"', '""')}"`;
  }
  return text;
}

function toCsv(headers, rows) {
  return [headers, ...rows]
    .map((row) => row.map(escapeCsvValue).join(","))
    .join("\n");
}

module.exports = {
  parseCsv,
  toCsv,
};
