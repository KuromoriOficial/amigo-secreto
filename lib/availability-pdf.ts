import { PDFDocument, PageSizes, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";

const YEAR = 2026;
const MONTHS = [{ index: 10, name: "Novembro" }, { index: 11, name: "Dezembro" }] as const;
const WEEKDAYS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const MARGIN = 46;
const WEEKDAY_HEIGHT = 28;
const CELL_HEIGHT = 41;
const ink = rgb(0.13, 0.18, 0.16);
const softInk = rgb(0.34, 0.38, 0.35);
const rule = rgb(0.82, 0.83, 0.79);
const weekdayBackground = rgb(0.95, 0.95, 0.92);
const unavailableBackground = rgb(0.97, 0.88, 0.85);
const unavailableInk = rgb(0.49, 0.15, 0.13);

function drawCalendar(
  page: PDFPage,
  fonts: { regular: PDFFont; bold: PDFFont },
  month: typeof MONTHS[number],
  top: number,
  unavailable: ReadonlySet<string>,
) {
  const width = page.getWidth() - 2 * MARGIN;
  const columns = WEEKDAYS.length;
  const cellWidth = width / columns;
  const offset = new Date(Date.UTC(YEAR, month.index, 1)).getUTCDay();
  const dayCount = new Date(Date.UTC(YEAR, month.index + 1, 0)).getUTCDate();
  const rowCount = Math.ceil((offset + dayCount) / columns);
  const weekdayBottom = top - WEEKDAY_HEIGHT;
  const bottom = weekdayBottom - rowCount * CELL_HEIGHT;

  page.drawText(`${month.name} ${YEAR}`, { x: MARGIN, y: top + 16, font: fonts.bold, size: 19, color: ink });
  page.drawRectangle({ x: MARGIN, y: weekdayBottom, width, height: WEEKDAY_HEIGHT, color: weekdayBackground });

  WEEKDAYS.forEach((label, column) => {
    const size = 10;
    const center = MARGIN + (column + 0.5) * cellWidth;
    page.drawText(label, {
      x: center - fonts.bold.widthOfTextAtSize(label, size) / 2,
      y: weekdayBottom + 10,
      font: fonts.bold,
      size,
      color: softInk,
    });
  });

  for (let day = 1; day <= dayCount; day += 1) {
    const cell = offset + day - 1;
    const x = MARGIN + (cell % columns) * cellWidth;
    const y = weekdayBottom - (Math.floor(cell / columns) + 1) * CELL_HEIGHT;
    const label = String(day);
    const date = `${YEAR}-${month.index + 1}-${label.padStart(2, "0")}`;
    const marked = unavailable.has(date);
    const font = marked ? fonts.bold : fonts.regular;
    const size = 13;

    if (marked) {
      page.drawRectangle({ x: x + 2, y: y + 2, width: cellWidth - 4, height: CELL_HEIGHT - 4, color: unavailableBackground });
      page.drawCircle({ x: x + cellWidth - 12, y: y + CELL_HEIGHT / 2, size: 2.5, color: unavailableInk });
    }
    page.drawText(label, {
      x: x + (cellWidth - font.widthOfTextAtSize(label, size)) / 2,
      y: y + (CELL_HEIGHT - 9) / 2,
      font,
      size,
      color: marked ? unavailableInk : ink,
    });
  }

  for (let column = 1; column < columns; column += 1) {
    const x = MARGIN + column * cellWidth;
    page.drawLine({ start: { x, y: bottom }, end: { x, y: weekdayBottom }, thickness: 0.6, color: rule });
  }
  for (let row = 0; row < rowCount; row += 1) {
    const y = weekdayBottom - row * CELL_HEIGHT;
    page.drawLine({ start: { x: MARGIN, y }, end: { x: MARGIN + width, y }, thickness: 0.6, color: rule });
  }
  page.drawRectangle({ x: MARGIN, y: bottom, width, height: top - bottom, borderColor: rule, borderWidth: 0.8 });
  return bottom;
}

export async function createAvailabilityPdf(days: readonly string[]): Promise<Uint8Array<ArrayBuffer>> {
  const document = await PDFDocument.create({ updateMetadata: false });
  const page = document.addPage(PageSizes.A4);
  const fonts = {
    regular: await document.embedFont(StandardFonts.Helvetica),
    bold: await document.embedFont(StandardFonts.HelveticaBold),
  };
  const unavailable = new Set(days);
  const height = page.getHeight();

  page.drawText("Calendário de disponibilidade", { x: MARGIN, y: height - 78, size: 29, font: fonts.bold, color: ink });
  page.drawLine({
    start: { x: MARGIN, y: height - 99 },
    end: { x: page.getWidth() - MARGIN, y: height - 99 },
    color: rule,
    thickness: 0.8,
  });

  const novemberBottom = drawCalendar(page, fonts, MONTHS[0], height - 158, unavailable);
  const decemberBottom = drawCalendar(page, fonts, MONTHS[1], novemberBottom - 60, unavailable);
  const legendY = decemberBottom - 40;
  page.drawRectangle({ x: MARGIN, y: legendY, width: 24, height: 17, color: unavailableBackground });
  page.drawCircle({ x: MARGIN + 12, y: legendY + 8.5, size: 2.5, color: unavailableInk });
  page.drawText("Dia indisponível", { x: MARGIN + 33, y: legendY + 4, size: 11, font: fonts.regular, color: ink });

  return new Uint8Array(await document.save());
}
