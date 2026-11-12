import PDFDocument from 'pdfkit';

const ACCENT = '#0f766e';
const INK = '#0f172a';
const MUTED = '#475569';
const RULE = '#cbd5e1';

const PAGE_MARGIN = 48;

function amount(value, currency = 'EUR') {
  const number = Number(value || 0);
  return `${currency} ${number.toFixed(2)}`;
}

function shortDate(iso) {
  if (!iso) return '—';
  const date = new Date(`${String(iso).slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return String(iso);
  return date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

function stamp(value) {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return String(value || '');
  return date.toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function contentWidth(doc) {
  return doc.page.width - PAGE_MARGIN * 2;
}

function rule(doc, gap = 8) {
  doc.moveDown(gap / 16);
  doc.moveTo(PAGE_MARGIN, doc.y).lineTo(PAGE_MARGIN + contentWidth(doc), doc.y).strokeColor(RULE).lineWidth(0.7).stroke();
  doc.moveDown(0.7);
}

function header(doc, property, title, subtitle) {
  doc.fillColor(ACCENT).font('Helvetica-Bold').fontSize(20).text(property.property_name || 'PCH Hotel', PAGE_MARGIN, PAGE_MARGIN);
  doc
    .fillColor(MUTED)
    .font('Helvetica')
    .fontSize(9)
    .text(
      [property.property_address, property.property_phone, property.property_email].filter(Boolean).join('  ·  '),
      PAGE_MARGIN,
      doc.y + 2
    );
  doc.moveDown(0.5);
  rule(doc);
  doc.fillColor(INK).font('Helvetica-Bold').fontSize(15).text(title);
  if (subtitle) doc.fillColor(MUTED).font('Helvetica').fontSize(10).text(subtitle);
  doc.moveDown(0.8);
}

function fieldGrid(doc, fields, columns = 2) {
  const width = contentWidth(doc) / columns;
  const rows = Math.ceil(fields.length / columns);
  const startY = doc.y;
  for (let row = 0; row < rows; row += 1) {
    const y = startY + row * 30;
    for (let column = 0; column < columns; column += 1) {
      const field = fields[row * columns + column];
      if (!field) continue;
      const x = PAGE_MARGIN + column * width;
      doc.fillColor(MUTED).font('Helvetica').fontSize(8).text(String(field.label).toUpperCase(), x, y, { width: width - 12 });
      doc.fillColor(INK).font('Helvetica-Bold').fontSize(10).text(String(field.value ?? '—'), x, y + 10, { width: width - 12 });
    }
  }
  doc.y = startY + rows * 30;
  doc.x = PAGE_MARGIN;
}

function table(doc, columns, rows, { emptyText = 'Nothing to show' } = {}) {
  const total = contentWidth(doc);
  const baseWidth = columns.reduce((sum, column) => sum + column.width, 0);
  const widths = columns.map((column) => (column.width / baseWidth) * total);
  const startX = PAGE_MARGIN;

  const drawHead = () => {
    let x = startX;
    doc.font('Helvetica-Bold').fontSize(8).fillColor(MUTED);
    const y = doc.y;
    columns.forEach((column, index) => {
      doc.text(String(column.label).toUpperCase(), x + 2, y, { width: widths[index] - 4, align: column.align || 'left' });
      x += widths[index];
    });
    doc.y = y + 14;
    doc.moveTo(startX, doc.y).lineTo(startX + total, doc.y).strokeColor(RULE).lineWidth(0.7).stroke();
    doc.y += 4;
  };

  drawHead();

  if (!rows.length) {
    doc.font('Helvetica-Oblique').fontSize(9).fillColor(MUTED).text(emptyText, startX, doc.y + 2);
    doc.moveDown(0.8);
    return;
  }

  for (const row of rows) {
    if (doc.y > doc.page.height - 110) {
      doc.addPage();
      doc.y = PAGE_MARGIN;
      drawHead();
    }
    let x = startX;
    const y = doc.y;
    doc.font('Helvetica').fontSize(9).fillColor('#334155');
    columns.forEach((column, index) => {
      doc.text(String(row[column.key] ?? ''), x + 2, y, { width: widths[index] - 4, align: column.align || 'left' });
      x += widths[index];
    });
    doc.y = y + 16;
  }
  rule(doc, 4);
}

function totalsBlock(doc, lines) {
  const width = 210;
  const x = PAGE_MARGIN + contentWidth(doc) - width;
  let y = doc.y + 4;
  for (const line of lines) {
    doc.font(line.strong ? 'Helvetica-Bold' : 'Helvetica').fontSize(line.strong ? 11 : 9).fillColor(line.strong ? INK : MUTED);
    doc.text(line.label, x, y, { width: width - 90, align: 'left' });
    doc.text(String(line.value), x + width - 90, y, { width: 90, align: 'right' });
    y += line.strong ? 18 : 14;
  }
  doc.y = y;
  doc.x = PAGE_MARGIN;
}

function footer(doc, property, note) {
  const bottom = doc.page.height - 54;
  doc
    .font('Helvetica')
    .fontSize(8)
    .fillColor('#64748b')
    .text(`${note || ''}`, PAGE_MARGIN, bottom, { width: contentWidth(doc), align: 'left' });
  doc.text(`Generated ${stamp()} · ${property.property_name || 'PCH Hotel'}`, PAGE_MARGIN, bottom + 12, {
    width: contentWidth(doc),
    align: 'left'
  });
}

export function sendPdf(res, filename, build) {
  const doc = new PDFDocument({ size: 'A4', margin: PAGE_MARGIN, info: { Title: filename, Creator: 'PCH PMS' } });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Cache-Control', 'no-store');
  doc.on('error', () => {
    if (!res.writableEnded) res.end();
  });
  doc.pipe(res);
  build(doc);
  doc.end();
}

export function folioPdf({ property, reservation, charges, payments }) {
  const currency = property.currency || 'EUR';
  return (doc) => {
    header(doc, property, 'Guest folio', `${reservation.code} · ${reservation.guest_name}`);
    fieldGrid(doc, [
      { label: 'Guest', value: reservation.guest_name },
      { label: 'Room', value: reservation.room_number || 'Unassigned' },
      { label: 'Stay', value: `${shortDate(reservation.check_in)} → ${shortDate(reservation.check_out)}` },
      { label: 'Nights', value: reservation.nights },
      { label: 'Channel', value: reservation.channel_name || 'Direct' },
      { label: 'Status', value: String(reservation.status || '').replace('_', ' ') }
    ]);
    rule(doc, 6);

    doc.fillColor(INK).font('Helvetica-Bold').fontSize(11).text('Charges');
    doc.moveDown(0.3);
    table(
      doc,
      [
        { key: 'date', label: 'Date', width: 26 },
        { key: 'description', label: 'Description', width: 50 },
        { key: 'quantity', label: 'Qty', width: 10, align: 'right' },
        { key: 'amount', label: 'Amount', width: 20, align: 'right' }
      ],
      charges.map((charge) => ({
        date: shortDate(charge.created_at),
        description: charge.description,
        quantity: Number(charge.quantity || 1),
        amount: amount(Number(charge.amount || 0) * Number(charge.quantity || 1), currency)
      })),
      { emptyText: 'No charges recorded' }
    );

    doc.fillColor(INK).font('Helvetica-Bold').fontSize(11).text('Payments');
    doc.moveDown(0.3);
    table(
      doc,
      [
        { key: 'date', label: 'Date', width: 26 },
        { key: 'method', label: 'Method', width: 24 },
        { key: 'reference', label: 'Reference', width: 40 },
        { key: 'amount', label: 'Amount', width: 20, align: 'right' }
      ],
      payments.map((payment) => ({
        date: shortDate(payment.created_at),
        method: String(payment.method || '').toUpperCase(),
        reference: payment.reference || '—',
        amount: amount(payment.amount, currency)
      })),
      { emptyText: 'No payments recorded' }
    );

    totalsBlock(doc, [
      { label: 'Total charges', value: amount(reservation.charges_total, currency) },
      { label: 'Total payments', value: amount(reservation.payments_total, currency) },
      { label: 'Balance due', value: amount(reservation.balance, currency), strong: true }
    ]);

    footer(doc, property, 'Thank you for staying with us. Please keep this folio for your records.');
  };
}

export function registrationPdf({ property, reservation, guest }) {
  return (doc) => {
    header(doc, property, 'Registration card', `${reservation.code} · ${reservation.guest_name}`);
    fieldGrid(doc, [
      { label: 'Guest name', value: reservation.guest_name },
      { label: 'Company', value: guest?.company || '—' },
      { label: 'Email', value: guest?.email || reservation.guest_email || '—' },
      { label: 'Phone', value: guest?.phone || reservation.guest_phone || '—' },
      { label: 'Address', value: [guest?.address, guest?.city, guest?.country].filter(Boolean).join(', ') || '—' },
      { label: 'Country', value: guest?.country || reservation.guest_country || '—' },
      { label: 'ID document', value: [guest?.id_type, guest?.id_number].filter(Boolean).join(' · ') || '—' },
      { label: 'Date of birth', value: guest?.birth_date ? shortDate(guest.birth_date) : '—' }
    ]);
    rule(doc, 6);
    fieldGrid(doc, [
      { label: 'Room', value: reservation.room_number || 'To be assigned' },
      { label: 'Room type', value: reservation.room_type_name },
      { label: 'Arrival', value: `${shortDate(reservation.check_in)} · from ${property.check_in_time || '15:00'}` },
      { label: 'Departure', value: `${shortDate(reservation.check_out)} · by ${property.check_out_time || '11:00'}` },
      { label: 'Adults / children', value: `${reservation.adults} / ${reservation.children}` },
      { label: 'Rate per night', value: amount(reservation.rate, property.currency || 'EUR') }
    ]);
    rule(doc, 6);

    doc.fillColor(INK).font('Helvetica-Bold').fontSize(10).text('Notes');
    doc.font('Helvetica').fontSize(9).fillColor('#334155').text(reservation.notes || guest?.preferences || '—');
    doc.moveDown(1.6);

    doc.font('Helvetica').fontSize(9).fillColor(MUTED).text('Guest signature', PAGE_MARGIN, doc.y);
    doc.moveTo(PAGE_MARGIN, doc.y + 26).lineTo(PAGE_MARGIN + 200, doc.y + 26).strokeColor(RULE).stroke();
    doc.text('Reception signature', PAGE_MARGIN + 260, doc.y - 10);
    doc.moveTo(PAGE_MARGIN + 260, doc.y + 26).lineTo(PAGE_MARGIN + 460, doc.y + 26).strokeColor(RULE).stroke();

    footer(doc, property, 'Registration is required by local law. Your data is stored only for this stay.');
  };
}

export function shiftReportPdf({ property, shift, cashier, totals, payments }) {
  const currency = property.currency || 'EUR';
  return (doc) => {
    header(doc, property, 'Shift report', `Shift #${shift.id} · ${shift.status === 'open' ? 'Open' : 'Closed'}`);
    fieldGrid(doc, [
      { label: 'Cashier', value: cashier || '—' },
      { label: 'Opened', value: stamp(shift.opened_at) },
      { label: 'Closed', value: shift.closed_at ? stamp(shift.closed_at) : 'Still open' },
      { label: 'Opening float', value: amount(shift.opening_float, currency) },
      { label: 'Counted cash', value: shift.counted_cash === null || shift.counted_cash === undefined ? '—' : amount(shift.counted_cash, currency) },
      { label: 'Variance', value: shift.variance === null || shift.variance === undefined ? '—' : amount(shift.variance, currency) }
    ]);
    rule(doc, 6);

    doc.fillColor(INK).font('Helvetica-Bold').fontSize(11).text('Takings by method');
    doc.moveDown(0.3);
    table(
      doc,
      [
        { key: 'method', label: 'Method', width: 40 },
        { key: 'count', label: 'Transactions', width: 20, align: 'right' },
        { key: 'total', label: 'Total', width: 25, align: 'right' }
      ],
      totals.by_method.map((row) => ({
        method: String(row.method || '').toUpperCase(),
        count: row.count,
        total: amount(row.total, currency)
      })),
      { emptyText: 'No payments in this shift' }
    );

    totalsBlock(doc, [
      { label: 'Payments taken', value: amount(totals.payments_total, currency) },
      { label: 'Cash taken', value: amount(totals.cash_total, currency) },
      { label: 'Expected cash in drawer', value: amount(totals.expected_cash, currency) },
      { label: 'Counted cash', value: totals.counted_cash === null ? '—' : amount(totals.counted_cash, currency) },
      { label: 'Variance', value: totals.variance === null ? '—' : amount(totals.variance, currency), strong: true }
    ]);

    rule(doc, 6);
    doc.fillColor(INK).font('Helvetica-Bold').fontSize(11).text('Transactions');
    doc.moveDown(0.3);
    table(
      doc,
      [
        { key: 'time', label: 'Time', width: 24 },
        { key: 'guest', label: 'Guest', width: 34 },
        { key: 'method', label: 'Method', width: 18 },
        { key: 'amount', label: 'Amount', width: 20, align: 'right' }
      ],
      payments.map((payment) => ({
        time: stamp(payment.created_at),
        guest: payment.guest_name || payment.reference || '—',
        method: String(payment.method || '').toUpperCase(),
        amount: amount(payment.amount, currency)
      })),
      { emptyText: 'No transactions in this shift' }
    );

    if (shift.closing_notes) {
      doc.fillColor(INK).font('Helvetica-Bold').fontSize(10).text('Handover notes');
      doc.font('Helvetica').fontSize(9).fillColor('#334155').text(shift.closing_notes);
    }

    footer(doc, property, 'Shift reports are retained for audit. Verify the counted cash before closing.');
  };
}
