/**
 * sanitize_csv.js
 * 
 * Reads a source CSV, hides sensitive cost columns by replacing values with "ZERO",
 * then writes the sanitized result to one or more destination files.
 * 
 * Usage:  node sanitize_csv.js <source> <dest1> [dest2] [dest3] ...
 */

const fs = require('fs');
const path = require('path');

// --- Config ---
const SENSITIVE_COLUMNS = ['cost', 'total cost', 'wholesale'];

// --- Args ---
const args = process.argv.slice(2);
if (args.length < 2) {
    console.error('Usage: node sanitize_csv.js <source> <dest1> [dest2] ...');
    process.exit(1);
}

const sourceFile = args[0];
const destFiles = args.slice(1);

// --- Validation ---
if (!fs.existsSync(sourceFile)) {
    console.error(`ERROR: Source file not found: ${sourceFile}`);
    process.exit(1);
}

// --- CSV Parser (handles quoted fields) ---
function parseCSVLine(line) {
    const result = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"') {
            inQuotes = !inQuotes;
            current += ch;
        } else if (ch === ',' && !inQuotes) {
            result.push(current);
            current = '';
        } else {
            current += ch;
        }
    }
    result.push(current);
    return result;
}

// --- Main ---
try {
    console.log(`   Reading: ${sourceFile}`);
    const raw = fs.readFileSync(sourceFile, 'utf-8');
    const lines = raw.split('\n');

    if (lines.length === 0) {
        console.error('ERROR: Source CSV is empty.');
        process.exit(1);
    }

    // Identify which column indices to sanitize
    const headerCols = parseCSVLine(lines[0]);
    const sensitiveIndices = [];

    headerCols.forEach((col, idx) => {
        const colName = col.replace(/"/g, '').trim().toLowerCase();
        if (SENSITIVE_COLUMNS.includes(colName)) {
            sensitiveIndices.push(idx);
            console.log(`   Hiding column [${idx}]: "${col.replace(/"/g, '').trim()}"`);
        }
    });

    if (sensitiveIndices.length === 0) {
        console.log('   No sensitive columns found — copying as-is.');
    }

    // Sanitize data rows (leave header intact)
    const sanitized = lines.map((line, lineIdx) => {
        if (!line.trim() || lineIdx === 0) return line;

        const cols = parseCSVLine(line);
        sensitiveIndices.forEach(idx => {
            if (cols[idx] !== undefined) {
                cols[idx] = '"ZERO"';
            }
        });
        return cols.join(',');
    });

    // Normalize line endings to \r\n for Windows compatibility
    const output = sanitized.join('\r\n');

    // Write to all destinations
    for (const dest of destFiles) {
        // Ensure destination directory exists
        const destDir = path.dirname(dest);
        if (!fs.existsSync(destDir)) {
            fs.mkdirSync(destDir, { recursive: true });
        }
        fs.writeFileSync(dest, output, 'utf-8');
        console.log(`   Wrote: ${dest}`);
    }

    console.log('   Sanitization complete.');
    process.exit(0);

} catch (err) {
    console.error('ERROR during sanitization:', err.message);
    process.exit(1);
}
