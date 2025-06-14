#!/usr/bin/node

import puppeteer from 'puppeteer'
import fs from 'node:fs'
import sharp from 'sharp'
import exec from '@actions/exec'
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers'
import { load } from 'cheerio'

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
  const browser = await puppeteer.launch({ headless: true })
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

  // set page content (HTML and CSS)
  const html = fs.readFileSync(source, 'utf-8')

  const $ = load(html)

  await Promise.all($('head script')
    .toArray()
    .map((e) => $(e).attr('src'))
    .filter((src) => src && !src.startsWith('http://') && !src.startsWith('https://') && !src.startsWith('//'))
    .map(async (src) => await page.addScriptTag({ path: src }))
  )

  await page.setContent(html, { waitUntil: 'networkidle0' })

  await Promise.all($('head link[rel="stylesheet"]')
    .toArray()
    .map((e) => $(e).attr('href'))
    .filter((href) => href && !href.startsWith('http://') && !href.startsWith('https://') && !href.startsWith('//'))
    .map(async (href) => await page.addStyleTag({ path: href }))
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
  await exec.exec(`./shrinkpdf.sh -r 300 -o ${finalFileTitle} ${tmpFileTitle}`)

  // remove temporary file
  await exec.exec(`rm ${tmpFileTitle}`)

  console.log(`PDF generated: ${finalFileTitle}`)

  process.exit(0)
} catch (error) {
  console.error(error)
  process.exit(1)
}
