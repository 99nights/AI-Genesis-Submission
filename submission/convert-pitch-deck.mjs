#!/usr/bin/env node

/**
 * Convert Pitch Deck HTML to PDF
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const htmlFile = join(__dirname, 'pitch-deck-print.html');
const pdfFile = join(__dirname, 'pitch-deck.pdf');

async function convertWithPuppeteer() {
  try {
    const puppeteer = await import('puppeteer');
    console.log('Converting Pitch Deck HTML to PDF...');
    
    const browser = await puppeteer.default.launch();
    const page = await browser.newPage();
    
    const htmlContent = readFileSync(htmlFile, 'utf-8');
    await page.setContent(htmlContent, { waitUntil: 'networkidle0' });
    
    await page.pdf({
      path: pdfFile,
      format: 'A4',
      landscape: true,
      printBackground: true,
      preferCSSPageSize: false,
      margin: {
        top: '2cm',
        right: '2cm',
        bottom: '2cm',
        left: '2cm'
      }
    });
    
    await browser.close();
    console.log(`✅ PDF created successfully: ${pdfFile}`);
    return true;
  } catch (error) {
    if (error.code === 'MODULE_NOT_FOUND') {
      return false;
    }
    throw error;
  }
}

async function main() {
  const success = await convertWithPuppeteer();
  
  if (!success) {
    console.log('\n⚠️  Puppeteer not found. Run: npm install --save-dev puppeteer');
    process.exit(1);
  }
}

main().catch(console.error);

