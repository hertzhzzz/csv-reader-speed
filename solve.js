// A faster drop-in for csv-reader 1.0.0 (make.fun's own CSV reader).
// Written from scratch to match its exact reading of {text, header}:
//   - a U+FEFF at the very start is dropped;
//   - a record ends at LF or CRLF, and a line left with no characters is no record;
//   - outside quotes a CR not followed by LF is dropped (stray_cr);
//   - a field that opens with a quote runs to the next quote that is not doubled,
//     "" inside it is one quote, each CRLF or lone CR inside it reads as LF;
//     what follows its closing quote, up to the next comma or line break, is
//     appended as it stands (quote_junk, when the field ends); a quote that
//     never closes is a literal character, and the text after it is read again
//     as unquoted (unterminated_quote);
//   - a quote inside an unquoted field is a literal character;
//   - fields stay strings, never trimmed or converted;
//   - columns is the first record when header is true, else null; rows holds
//     the records after it, each padded with "" (short_row, with fields: its
//     count) or cut (long_row, with extra: the cut fields) to the first
//     record's width;
//   - each error is {code, line, row}, in the order met, line the 1-based
//     line its record starts on, row its record's index in rows (null for
//     the header).
//
// Speed: the reference reads one character at a time. This reader instead
// takes a whole clean line at a time (String.split, no quote or CR in it),
// and otherwise jumps from delimiter to delimiter with indexOf, slicing
// fields out instead of building them a character at a time. Only quoted
// fields with doubled quotes or line breaks, stray CRs and quote junk take
// a slower path, and those are rare. Field readers return the field string
// and report how it ended through shared slots, so no result object is
// built per field.

/** How a field ended: 0 at a comma, 1 at a line break, 2 at the end of the text. */
const F_COMMA = 0;
const F_BREAK = 1;
const F_END = 2;

/** csv-reader 1.0.0's answer for one case's input, faster. */
export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const len = text.length;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;

  let pos = 0; // the next character to read
  let line = 1; // the line that character is on
  if (text.charCodeAt(0) === 0xfeff) pos = 1;

  // The record being read: the line it starts on and the index in rows it takes (null: the header).
  let recordLine = 1;
  let recordRow = null;

  // How the last field read ended, and how many characters its last unquoted read kept.
  let fEnded = F_END;
  let fAdded = 0;

  function error(code) {
    errors.push({ code, line: recordLine, row: recordRow });
  }

  // Reads unquoted characters onto `value` up to the next comma or line break: a CR not followed by LF is dropped
  // (stray_cr). Returns the field; fEnded says how it ended, fAdded counts the characters kept.
  // The next comma and the next LF bound the field; a CR inside it is found on the slice, never by a scan
  // that could run past the field.
  function readUnquoted(value) {
    let added = 0;
    let val = value;
    while (true) {
      const cIdx = text.indexOf(',', pos);
      const nIdx = text.indexOf('\n', pos);
      let idx;
      let comma;
      if (cIdx !== -1 && (nIdx === -1 || cIdx < nIdx)) {
        idx = cIdx;
        comma = true;
      } else if (nIdx !== -1) {
        idx = nIdx;
        comma = false;
      } else {
        // No comma or LF left: only a stray CR may remain before the end.
        const r = text.indexOf('\r', pos);
        if (r === -1) {
          val += text.slice(pos);
          added += len - pos;
          pos = len;
          fEnded = F_END;
          fAdded = added;
          return val;
        }
        val += text.slice(pos, r);
        added += r - pos;
        error('stray_cr');
        pos = r + 1;
        continue;
      }
      const seg = text.slice(pos, idx);
      const rIdx = seg.indexOf('\r');
      if (rIdx === -1) {
        val += seg;
        added += idx - pos;
        if (comma) {
          pos = idx + 1;
          fEnded = F_COMMA;
          fAdded = added;
          return val;
        }
        pos = idx + 1;
        line += 1;
        fEnded = F_BREAK;
        fAdded = added;
        return val;
      }
      if (!comma && rIdx === seg.length - 1) {
        // CRLF: the CR right before the LF ends the line, not the field.
        val += text.slice(pos, idx - 1);
        added += seg.length - 1;
        pos = idx + 1;
        line += 1;
        fEnded = F_BREAK;
        fAdded = added;
        return val;
      }
      // A stray CR inside the field: drop it, record it, and read on.
      val += seg.slice(0, rIdx);
      added += rIdx;
      error('stray_cr');
      pos += rIdx + 1;
    }
  }

  // What follows a quoted field's closing quote: a comma, a line break, the end, or junk appended as it stands.
  function finishQuoted(value) {
    if (pos >= len) {
      fEnded = F_END;
      return value;
    }
    const c = text.charCodeAt(pos);
    if (c === 44) {
      pos += 1;
      fEnded = F_COMMA;
      return value;
    }
    if (c === 10) {
      pos += 1;
      line += 1;
      fEnded = F_BREAK;
      return value;
    }
    if (c === 13 && text.charCodeAt(pos + 1) === 10) {
      pos += 2;
      line += 1;
      fEnded = F_BREAK;
      return value;
    }
    // What follows the closing quote is appended as it stands, up to the next comma or line break.
    const junk = readUnquoted(value);
    if (fAdded > 0) error('quote_junk');
    return junk;
  }

  // Reads a quoted field whose opening quote is at pos.
  function readQuoted() {
    const open = pos;
    const openLine = line;
    const start = pos + 1;
    const q = text.indexOf('"', start);
    if (q === -1) {
      // The quote never closes: it is a literal character, and the text after it is read again as unquoted.
      pos = open + 1;
      line = openLine;
      error('unterminated_quote');
      return readUnquoted('"');
    }
    if (text.charCodeAt(q + 1) !== 34) {
      // A plain close: the content is one slice, unless it holds line breaks.
      const seg = text.slice(start, q);
      let value = seg;
      if (seg.indexOf('\n') !== -1 || seg.indexOf('\r') !== -1) {
        // CRLF and a lone CR inside quotes are each one LF.
        const breaks = seg.match(/\r\n|\r|\n/g);
        line += breaks.length;
        value = seg.replace(/\r\n?/g, '\n');
      }
      pos = q + 1;
      return finishQuoted(value);
    }
    // Doubled quotes inside: collect the pieces, one literal quote per pair.
    const parts = [];
    let segStart = start;
    let scan = start;
    let closeIdx = -1;
    while (true) {
      const qq = text.indexOf('"', scan);
      if (qq === -1) {
        pos = open + 1;
        line = openLine;
        error('unterminated_quote');
        return readUnquoted('"');
      }
      if (text.charCodeAt(qq + 1) === 34) {
        parts.push(text.slice(segStart, qq + 1));
        scan = qq + 2;
        segStart = qq + 2;
        continue;
      }
      closeIdx = qq;
      break;
    }
    parts.push(text.slice(segStart, closeIdx));
    let value = parts.join('');
    if (value.indexOf('\n') !== -1 || value.indexOf('\r') !== -1) {
      const breaks = value.match(/\r\n|\r|\n/g);
      line += breaks.length;
      value = value.replace(/\r\n?/g, '\n');
    }
    pos = closeIdx + 1;
    return finishQuoted(value);
  }

  // A record's fields are in hand: the header, or a row at the first record's width.
  function finishRecord(fields) {
    if (width < 0) width = fields.length;
    if (header && columns === null) {
      columns = fields;
      return;
    }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
    }
    rows.push(fields);
  }

  while (true) {
    if (pos >= len) break;
    // The rest of this line: its end, and its content without a trailing CR of a CRLF.
    const nl = text.indexOf('\n', pos);
    const lineEnd = nl === -1 ? len : nl;
    let contentEnd = lineEnd;
    if (nl !== -1 && lineEnd > pos && text.charCodeAt(lineEnd - 1) === 13) contentEnd = lineEnd - 1;
    // Lines with no characters are no records.
    if (contentEnd === pos) {
      pos = nl === -1 ? len : nl + 1;
      line += 1;
      continue;
    }
    recordLine = line;
    recordRow = header && columns === null ? null : rows.length;
    const slice = text.slice(pos, contentEnd);
    if (slice.indexOf('"') === -1 && slice.indexOf('\r') === -1) {
      // Fast path: a clean line, no quote and no stray CR: split it whole.
      const fields = slice.split(',');
      pos = nl === -1 ? len : nl + 1;
      line += 1;
      finishRecord(fields);
      continue;
    }
    // Slow path: this line holds a quote or a stray CR, so read it field by field.
    const fields = [];
    let quoted = false;
    do {
      quoted = text.charCodeAt(pos) === 34;
      fields.push(quoted ? readQuoted() : readUnquoted(''));
    } while (fEnded === F_COMMA);
    // A line that held only stray CRs is left with no characters: no record (its stray_cr errors stay).
    if (fields.length === 1 && fields[0] === '' && !quoted) continue;
    finishRecord(fields);
  }
  return { columns: header ? (columns ?? []) : null, rows, errors };
}
