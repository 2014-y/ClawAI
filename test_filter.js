const fs = require('fs');

const testLines = [
  "o  Doctor Warnings -------------------------------------------------------------+",
  "o  Config Warnings -------------------------------------------------------------+",
  "+-------------------------------------------------------------------------------+",
  "o Config Warnings -------------------------------------------------------------+",
  "\x1b[33mo  Doctor Warnings -------------------------------------------------------------+\x1b[39m",
  "\x1b[33mo  Config Warnings -------------------------------------------------------------+\x1b[39m",
  "\x1b[33m+-------------------------------------------------------------------------------+\x1b[39m"
];

testLines.forEach(line => {
  const cleanLine = line.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '').trim();
  const startsWithO = cleanLine.startsWith('o ');
  const includesWarning = cleanLine.includes('Warning') || cleanLine.includes('Warnings');
  const isDivider = /^[+\s-]+$/.test(cleanLine);
  const shouldFilter = (
    ((cleanLine.toLowerCase().includes('warning') || cleanLine.toLowerCase().includes('warnings')) && cleanLine.includes('--')) ||
    /o\s+(doctor|config)\s+warnings/i.test(cleanLine) ||
    /^[+\s-]+$/.test(cleanLine)
  );
  
  console.log(`Line: ${JSON.stringify(line)}`);
  console.log(`  Clean: ${JSON.stringify(cleanLine)}`);
  console.log(`  startsWithO: ${startsWithO}, includesWarning: ${includesWarning}, isDivider: ${isDivider}`);
  console.log(`  shouldFilter: ${shouldFilter}`);
});
