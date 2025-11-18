#!/usr/bin/env node

/**
 * Convert HTML slide deck to PDF
 * 
 * This script attempts to convert the HTML file to PDF using available tools.
 * 
 * Option 1: If puppeteer is installed, it will use that
 * Option 2: Otherwise, it will provide instructions for manual conversion
 */

import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const htmlFile = join(__dirname, 'slide-deck-print.html');
const pdfFile = join(__dirname, 'slide-deck.pdf');

async function convertWithPuppeteer() {
  try {
    const puppeteer = await import('puppeteer');
    console.log('Using Puppeteer to convert HTML to PDF...');
    
    const browser = await puppeteer.default.launch();
    const page = await browser.newPage();
    
    const htmlContent = readFileSync(htmlFile, 'utf-8');
    await page.setContent(htmlContent, { waitUntil: 'networkidle0' });
    
    await page.pdf({
      path: pdfFile,
      format: 'A4',
      landscape: true,
      printBackground: true,
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
  console.log('Converting HTML to PDF...\n');
  
  // Try puppeteer first
  const success = await convertWithPuppeteer();
  
  if (!success) {
    console.log('\n⚠️  Puppeteer not found. Installing it...');
    console.log('Run: npm install --save-dev puppeteer');
    console.log('Then run this script again.\n');
    console.log('Alternatively, you can:');
    console.log('1. Open slide-deck-print.html in your browser');
    console.log('2. Press Cmd+P (Mac) or Ctrl+P (Windows/Linux)');
    console.log('3. Select "Save as PDF" as the destination');
    console.log('4. Make sure "Background graphics" is enabled');
    console.log('5. Save the file\n');
    process.exit(1);
  }
}

main().catch(console.error);

