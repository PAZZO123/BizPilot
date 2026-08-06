#!/usr/bin/env node
/**
 * Renders the project's markdown documentation as Word documents.
 *
 * Not a general markdown converter — it handles exactly the constructs these
 * documents use, and it is a build step rather than a one-off so the .docx
 * files can be regenerated after the .md files change instead of drifting from
 * them. The markdown stays the source of truth.
 *
 *   npm run docs:docx
 *
 * Output goes to docs/word/.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  AlignmentType,
  BorderStyle,
  Document,
  ExternalHyperlink,
  HeadingLevel,
  Packer,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from 'docx';

const ROOT = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const OUT_DIR = path.join(ROOT, 'docs', 'word');

const SOURCES = [
  { file: 'README.md', title: 'BizPilot — Overview' },
  { file: 'docs/ARCHITECTURE.md', title: 'BizPilot — How it works' },
  { file: 'docs/SECURITY.md', title: 'BizPilot — Security' },
  { file: 'docs/ROADMAP.md', title: 'BizPilot — What is missing' },
];

const ACCENT = '0F766E';
const INK = '111827';
const MUTED = '6B7280';
const CODE_BG = 'F3F4F6';

// --- Inline formatting -------------------------------------------------------

/**
 * Splits a line into runs, handling `code`, **bold**, *italic* and [links](url).
 *
 * Code is matched first and its contents are not re-scanned, so a backtick span
 * containing asterisks or underscores stays literal instead of being read as
 * emphasis — glob patterns and SQL identifiers survive intact.
 */
function inlineRuns(text, base = {}) {
  const runs = [];
  const pattern = /`([^`]+)`|\*\*([^*]+)\*\*|\*([^*]+)\*|\[([^\]]+)\]\(([^)]+)\)/g;
  let lastIndex = 0;
  let match;

  const plain = (value) => {
    if (value) runs.push(new TextRun({ text: value, ...base }));
  };

  while ((match = pattern.exec(text)) !== null) {
    plain(text.slice(lastIndex, match.index));

    if (match[1] !== undefined) {
      runs.push(
        new TextRun({ text: match[1], font: 'Consolas', color: ACCENT, ...base, size: 19 }),
      );
    } else if (match[2] !== undefined) {
      runs.push(new TextRun({ text: match[2], bold: true, ...base }));
    } else if (match[3] !== undefined) {
      runs.push(new TextRun({ text: match[3], italics: true, ...base }));
    } else {
      // Internal .md links mean nothing in Word; keep the text, drop the target.
      const [, , , , label, href] = match;
      if (/^https?:/i.test(href)) {
        runs.push(
          new ExternalHyperlink({
            link: href,
            children: [new TextRun({ text: label, style: 'Hyperlink', ...base })],
          }),
        );
      } else {
        runs.push(new TextRun({ text: label, italics: true, ...base }));
      }
    }
    lastIndex = pattern.lastIndex;
  }

  plain(text.slice(lastIndex));
  return runs.length ? runs : [new TextRun({ text: '', ...base })];
}

// --- Block elements ----------------------------------------------------------

function heading(text, level) {
  const levels = [
    HeadingLevel.HEADING_1,
    HeadingLevel.HEADING_2,
    HeadingLevel.HEADING_3,
    HeadingLevel.HEADING_4,
  ];
  return new Paragraph({
    heading: levels[Math.min(level, 4) - 1],
    spacing: { before: level === 1 ? 240 : 300, after: 120 },
    children: inlineRuns(text, { color: level <= 2 ? ACCENT : INK, bold: true }),
  });
}

function bodyParagraph(text) {
  return new Paragraph({
    spacing: { after: 140, line: 276 },
    children: inlineRuns(text, { color: INK, size: 21 }),
  });
}

function bullet(text, level = 0) {
  return new Paragraph({
    bullet: { level },
    spacing: { after: 60, line: 264 },
    children: inlineRuns(text, { color: INK, size: 21 }),
  });
}

function numbered(text, level = 0) {
  return new Paragraph({
    numbering: { reference: 'ordered', level },
    spacing: { after: 60, line: 264 },
    children: inlineRuns(text, { color: INK, size: 21 }),
  });
}

function quote(text) {
  return new Paragraph({
    spacing: { after: 140, line: 276 },
    indent: { left: 360 },
    border: { left: { style: BorderStyle.SINGLE, size: 12, space: 12, color: ACCENT } },
    children: inlineRuns(text, { color: MUTED, italics: true, size: 21 }),
  });
}

/** A fenced block. Each source line is its own shaded paragraph so it wraps as
 *  little as possible and keeps its indentation. */
function codeBlock(lines) {
  return lines.map(
    (line, index) =>
      new Paragraph({
        spacing: { before: index === 0 ? 120 : 0, after: index === lines.length - 1 ? 160 : 0 },
        shading: { type: ShadingType.CLEAR, fill: CODE_BG },
        indent: { left: 200, right: 200 },
        children: [new TextRun({ text: line || ' ', font: 'Consolas', size: 18, color: INK })],
      }),
  );
}

function horizontalRule() {
  return new Paragraph({
    spacing: { before: 200, after: 200 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 6, space: 1, color: 'D1D5DB' } },
    children: [new TextRun('')],
  });
}

function splitRow(line) {
  return line
    .replace(/^\||\|$/g, '')
    .split('|')
    .map((cell) => cell.trim());
}

function table(rows) {
  const [headerLine, , ...bodyLines] = rows;
  const headers = splitRow(headerLine);
  const body = bodyLines.map(splitRow);
  const columnCount = headers.length;

  const cell = (text, isHeader) =>
    new TableCell({
      shading: isHeader ? { type: ShadingType.CLEAR, fill: CODE_BG } : undefined,
      margins: { top: 80, bottom: 80, left: 120, right: 120 },
      children: [
        new Paragraph({
          spacing: { after: 0, line: 252 },
          children: inlineRuns(text || '—', {
            bold: isHeader,
            color: INK,
            size: isHeader ? 19 : 20,
          }),
        }),
      ],
    });

  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      new TableRow({ tableHeader: true, children: headers.map((text) => cell(text, true)) }),
      ...body.map(
        (cells) =>
          new TableRow({
            // Pad short rows: Word rejects a table whose rows differ in length.
            children: Array.from({ length: columnCount }, (_, index) =>
              cell(cells[index] ?? '', false),
            ),
          }),
      ),
    ],
  });
}

// --- Document assembly -------------------------------------------------------

function convert(markdown) {
  const lines = markdown.split(/\r?\n/);
  const children = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    const trimmed = line.trim();

    if (!trimmed) {
      index += 1;
      continue;
    }

    // Fenced code
    if (trimmed.startsWith('```')) {
      const block = [];
      index += 1;
      while (index < lines.length && !lines[index].trim().startsWith('```')) {
        block.push(lines[index]);
        index += 1;
      }
      index += 1;
      children.push(...codeBlock(block));
      continue;
    }

    // Table: a pipe row followed by a separator row
    if (trimmed.startsWith('|') && lines[index + 1]?.trim().match(/^\|[\s:|-]+\|$/)) {
      const block = [];
      while (index < lines.length && lines[index].trim().startsWith('|')) {
        block.push(lines[index].trim());
        index += 1;
      }
      children.push(table(block));
      // Word butts the next paragraph straight against the table otherwise.
      children.push(new Paragraph({ spacing: { after: 160 }, children: [new TextRun('')] }));
      continue;
    }

    if (/^-{3,}$/.test(trimmed) || /^\*{3,}$/.test(trimmed)) {
      children.push(horizontalRule());
      index += 1;
      continue;
    }

    const headingMatch = trimmed.match(/^(#{1,4})\s+(.*)$/);
    if (headingMatch) {
      children.push(heading(headingMatch[2], headingMatch[1].length));
      index += 1;
      continue;
    }

    if (trimmed.startsWith('> ')) {
      children.push(quote(trimmed.slice(2)));
      index += 1;
      continue;
    }

    const bulletMatch = line.match(/^(\s*)[-*]\s+(.*)$/);
    if (bulletMatch) {
      children.push(bullet(bulletMatch[2], Math.min(Math.floor(bulletMatch[1].length / 2), 2)));
      index += 1;
      continue;
    }

    const numberedMatch = line.match(/^(\s*)\d+\.\s+(.*)$/);
    if (numberedMatch) {
      children.push(
        numbered(numberedMatch[2], Math.min(Math.floor(numberedMatch[1].length / 3), 2)),
      );
      index += 1;
      continue;
    }

    // Plain paragraph — join the soft-wrapped lines the markdown is written in.
    const paragraph = [trimmed];
    index += 1;
    while (index < lines.length) {
      const next = lines[index];
      const nextTrimmed = next.trim();
      if (
        !nextTrimmed ||
        nextTrimmed.startsWith('#') ||
        nextTrimmed.startsWith('|') ||
        nextTrimmed.startsWith('```') ||
        nextTrimmed.startsWith('> ') ||
        /^(\s*)[-*]\s+/.test(next) ||
        /^(\s*)\d+\.\s+/.test(next) ||
        /^-{3,}$/.test(nextTrimmed)
      ) {
        break;
      }
      paragraph.push(nextTrimmed);
      index += 1;
    }
    children.push(bodyParagraph(paragraph.join(' ')));
  }

  return children;
}

function buildDocument(title, children) {
  return new Document({
    creator: 'BizPilot',
    title,
    description: 'Generated from the markdown source in the BizPilot repository.',
    numbering: {
      config: [
        {
          reference: 'ordered',
          levels: [0, 1, 2].map((level) => ({
            level,
            format: 'decimal',
            text: `%${level + 1}.`,
            alignment: AlignmentType.START,
            style: { paragraph: { indent: { left: 360 * (level + 1), hanging: 260 } } },
          })),
        },
      ],
    },
    styles: {
      default: {
        document: { run: { font: 'Calibri', size: 21, color: INK } },
      },
    },
    sections: [
      {
        properties: { page: { margin: { top: 1000, bottom: 1000, left: 1000, right: 1000 } } },
        children: [
          new Paragraph({
            spacing: { after: 60 },
            children: [new TextRun({ text: title, bold: true, size: 40, color: ACCENT })],
          }),
          new Paragraph({
            spacing: { after: 240 },
            children: [
              new TextRun({
                text: `Generated from the repository on ${new Date().toISOString().slice(0, 10)}. The markdown source is authoritative.`,
                italics: true,
                color: MUTED,
                size: 18,
              }),
            ],
          }),
          horizontalRule(),
          ...children,
        ],
      },
    ],
  });
}

// --- Entry point -------------------------------------------------------------

await mkdir(OUT_DIR, { recursive: true });

for (const source of SOURCES) {
  const markdown = await readFile(path.join(ROOT, source.file), 'utf8');
  const document = buildDocument(source.title, convert(markdown));
  const buffer = await Packer.toBuffer(document);

  const name = `${path.basename(source.file, '.md')}.docx`;
  await writeFile(path.join(OUT_DIR, name), buffer);
  console.log(`  ${source.file}  ->  docs/word/${name}  (${(buffer.length / 1024).toFixed(1)} kB)`);
}

console.log(`\n${SOURCES.length} documents written to docs/word/`);
