#!/usr/bin/env node

import { launch } from 'puppeteer'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
import { exec } from '@actions/exec'
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers'
import { load } from 'cheerio'

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const { source, output } = await yargs(hideBin(process.argv))
  .usage('')
  .option('source', {
    alias: 's',
    describe: 'Source HTML file',
    type: 'string',
    demandOption: true,
    default: 'index.html',
  })
  .option('output', {
    alias: 'o',
    describe: 'Output PDF file',
    type: 'string',
  })
  .help(true)
  .argv

try {
  const browser = await launch({ headless: true })
  const page = await browser.newPage()

  await page.setRequestInterception(true)

  // convert images to WEBP
  page.on('request', async (req) => {
    if (req.resourceType() !== 'image') {
      req.continue()
      return
    }
    try {
      const response = await fetch(req.url(), {
        method: req.method(),
        headers: req.headers(),
      })
      const buffer = await response.arrayBuffer()
      const image = await sharp(buffer)
        .webp({ quality: 100, lossless: true })
        .rotate()
        .toBuffer()
      req.respond({ body: image })
    } catch {
      req.continue()
    }
  })

  const html = readFileSync(source, 'utf-8')
  const $ = load(html)

  // set page HTML content
  await page.setContent(html, { waitUntil: 'networkidle2' })

  // add styles
  await Promise.all($('head link[rel="stylesheet"]')
    .toArray()
    .map((e) => $(e).attr('href'))
    .filter((path) => path && !path.startsWith('http://') && !path.startsWith('https://') && !path.startsWith('//'))
    .map(async (path) => await page.addStyleTag({ path }))
  )

  // add scripts
  await Promise.all($('head script')
    .toArray()
    .map((e) => $(e).attr('src'))
    .filter((path) => path && !path.startsWith('http://') && !path.startsWith('https://') && !path.startsWith('//'))
    .map(async (path) => await page.addScriptTag({ path }))
  )

  // to reflect CSS used for screens instead of print
  await page.emulateMediaType('screen')

  // wait for the fonts to be loaded
  await page.evaluateHandle('document.fonts.ready')

  // get page dimensions
  const elem = await page.$('body')
  const { height, width } = await elem?.boundingBox() ?? { height: 0, width: 0 }

  // get page title
  const fileTitle = output?.replace('.pdf', '') ?? (await page.title()).replace(/\s/g, '-').toLowerCase()
  const tmpFileTitle = fileTitle + '.tmp.pdf'
  const finalFileTitle = fileTitle + '.pdf'

  await page.pdf({
    path: tmpFileTitle,
    width,
    height,
    printBackground: true
  })

  await browser.close()

  // shrink PDF
  await exec(
    `/${resolve(__dirname, '../shrinkpdf.sh')} -r 300 -o ${finalFileTitle} ${tmpFileTitle}`,
    [],
    { silent: true }
  )

  // remove temporary file
  await exec(
    `rm ${tmpFileTitle}`,
    [],
    { silent: true }
  )

  console.log(`PDF generated: ${finalFileTitle}`)

  process.exit(0)
} catch (error) {
  console.error(error)
  process.exit(1)
}
