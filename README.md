# PDFize

CLI tool to convert HTML files to PDF.

## Usage

```bach
npx pdfize -s index.html -o my-file.pdf
```

## About

PDF files are generated using Headless Chrome through [Puppeteer](https://github.com/puppeteer/puppeteer/tree/main), then shrunk using Alfred Klomp's [shrinkpdf](https://github.com/aklomp/shrinkpdf) script.
