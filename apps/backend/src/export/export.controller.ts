import { Controller, Get, NotFoundException, Param, ParseIntPipe, Query, Res } from '@nestjs/common';
import { Response } from 'express';
import { Document, HeadingLevel, Packer, Paragraph, TextRun } from 'docx';
import JSZip from 'jszip';
import { PrismaService } from '../prisma/prisma.service';
import { htmlToParagraphs } from '../common/text.utils';

@Controller('export')
export class ExportController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('novels/:id')
  async exportNovel(
    @Param('id', ParseIntPipe) id: number,
    @Query('format') format: string,
    @Res() res: Response,
  ) {
    const novel = await this.prisma.novel.findUnique({
      where: { id },
      include: { chapters: { orderBy: { order: 'asc' } } },
    });
    if (!novel) throw new NotFoundException(`Novel ${id} not found`);

    const fmt = (format ?? 'txt').toLowerCase();
    const filename = encodeURIComponent(sanitizeFilename(novel.title));
    const dispositionFor = (ext: string) =>
      `attachment; filename="novel.${ext}"; filename*=UTF-8''${filename}.${ext}`;
    const chaptersHtml = novel.chapters.map((c) => ({
      heading: `第 ${c.order + 1} 章 ${c.title}`,
      paragraphs: htmlToParagraphs(c.content),
    }));

    if (fmt === 'md') {
      res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
      res.setHeader('Content-Disposition', dispositionFor('md'));
      res.send(toMarkdown(novel.title, novel.synopsis, chaptersHtml));
      return;
    }

    if (fmt === 'docx') {
      const doc = new Document({
        sections: [
          {
            children: [
              new Paragraph({ text: novel.title, heading: HeadingLevel.TITLE }),
              ...(novel.synopsis ? [new Paragraph({ children: [new TextRun({ text: novel.synopsis, italics: true })] })] : []),
              ...chaptersHtml.flatMap((c) => [
                new Paragraph({ text: c.heading, heading: HeadingLevel.HEADING_1 }),
                ...c.paragraphs.map((p) => new Paragraph({ children: [new TextRun(p)] })),
              ]),
            ],
          },
        ],
      });
      const buf = await Packer.toBuffer(doc);
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
      res.setHeader('Content-Disposition', dispositionFor('docx'));
      res.send(buf);
      return;
    }

    if (fmt === 'epub') {
      const zip = new JSZip();
      zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
      zip.folder('META-INF')!.file('container.xml', containerXml());
      const oebps = zip.folder('OEBPS')!;
      oebps.file('content.opf', contentOpf(novel.title, chaptersHtml.length));
      oebps.file('toc.ncx', tocNcx(novel.title, chaptersHtml));
      chaptersHtml.forEach((c, i) => {
        oebps.file(`chapter${i + 1}.xhtml`, chapterXhtml(c.heading, c.paragraphs));
      });
      const buf = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
      res.setHeader('Content-Type', 'application/epub+zip');
      res.setHeader('Content-Disposition', dispositionFor('epub'));
      res.send(buf);
      return;
    }

    // 默认 txt
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', dispositionFor('txt'));
    res.send(toPlainText(novel.title, novel.synopsis, chaptersHtml));
  }
}

function toPlainText(title: string, synopsis: string | null, chapters: { heading: string; paragraphs: string[] }[]) {
  const parts: string[] = [title, ''];
  if (synopsis) parts.push(synopsis, '');
  for (const c of chapters) parts.push(c.heading, '', ...c.paragraphs, '');
  return parts.join('\n');
}

function toMarkdown(title: string, synopsis: string | null, chapters: { heading: string; paragraphs: string[] }[]) {
  const lines: string[] = [`# ${title}`, ''];
  if (synopsis) lines.push(`> ${synopsis}`, '');
  for (const c of chapters) {
    lines.push(`## ${c.heading}`, '');
    for (const p of c.paragraphs) lines.push(p, '');
  }
  return lines.join('\n');
}

function containerXml() {
  return `<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`;
}

function contentOpf(title: string, chapterCount: number) {
  const items = [`<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>`];
  for (let i = 1; i <= chapterCount; i++) items.push(`<item id="ch${i}" href="chapter${i}.xhtml" media-type="application/xhtml+xml"/>`);
  const itemrefs = Array.from({ length: chapterCount }, (_, i) => `<itemref idref="ch${i + 1}"/>`).join('');
  return `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="2.0" unique-identifier="bookid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>${esc(title)}</dc:title>
    <dc:identifier id="bookid">novel-assist-1</dc:identifier>
    <dc:language>zh-CN</dc:language>
  </metadata>
  <manifest>${items.join('')}</manifest>
  <spine toc="ncx">${itemrefs}</spine>
</package>`;
}

function tocNcx(title: string, chapters: { heading: string }[]) {
  const nav = chapters
    .map((c, i) => `<navPoint id="ch${i + 1}" playOrder="${i + 1}"><navLabel><text>${esc(c.heading)}</text></navLabel><content src="chapter${i + 1}.xhtml"/></navPoint>`)
    .join('');
  return `<?xml version="1.0" encoding="utf-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <head><meta name="dtb:uid" content="novel-assist-1"/></head>
  <docTitle><text>${esc(title)}</text></docTitle>
  <navMap>${nav}</navMap>
</ncx>`;
}

function chapterXhtml(heading: string, paragraphs: string[]) {
  const body = `<h1>${esc(heading)}</h1>` + paragraphs.map((p) => `<p>${esc(p)}</p>`).join('');
  return `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html><html xmlns="http://www.w3.org/1999/xhtml"><head><title>${esc(heading)}</title></head><body>${body}</body></html>`;
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function sanitizeFilename(name: string): string {
  return (name || 'novel').replace(/[\\/:*?"<>|]/g, '_').slice(0, 60);
}
