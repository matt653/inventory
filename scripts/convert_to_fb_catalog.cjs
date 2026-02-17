/**
 * convert_to_fb_catalog.cjs
 *
 * Converts the Frazer/DealerCarSearch inventory CSV into a Facebook
 * Marketplace product catalog CSV (catalog_products format).
 *
 * This uses the GENERIC product catalog template — NOT the vehicle_offer
 * format (which requires whitelisted Automotive Inventory Ads access).
 * The generic format works for all dealer sizes and avoids strict
 * enum validation errors from FB's automotive vertical.
 *
 * Usage:
 *   node convert_to_fb_catalog.cjs [inputCSV] [outputCSV]
 *
 * Defaults:
 *   input  = ../public/inventorycsv.csv
 *   output = ../../inventory/inventoryFB.csv
 */

const fs = require('fs');
const path = require('path');

// --- Paths ---
const SCRIPT_DIR = __dirname;
const PROJECT_ROOT = path.resolve(SCRIPT_DIR, '..');
const DEFAULT_INPUT = path.join(PROJECT_ROOT, 'public', 'inventorycsv.csv');
const INVENTORY_REPO = path.resolve(PROJECT_ROOT, '..', 'inventory');
const DEFAULT_OUTPUT = path.join(INVENTORY_REPO, 'inventoryFB.csv');

const inputFile = process.argv[2] || DEFAULT_INPUT;
const outputFile = process.argv[3] || DEFAULT_OUTPUT;

// --- Website base URL ---
const SITE_URL = 'https://highlifeauto.com';

// --- CSV Parser (handles quoted fields with commas inside) ---
function parseCSVLine(line) {
    const result = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"') {
            inQuotes = !inQuotes;
        } else if (ch === ',' && !inQuotes) {
            result.push(current.trim());
            current = '';
        } else {
            current += ch;
        }
    }
    result.push(current.trim());
    return result;
}

// Strip surrounding quotes from a value
function unquote(val) {
    if (!val) return '';
    return val.replace(/^"|"$/g, '').trim();
}

// --- Escape a field for CSV output (RFC 4180) ---
function csvEscape(val) {
    if (val === undefined || val === null) return '';
    const s = String(val);
    if (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r')) {
        return '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
}

// --- Clean price string to a number ---
function cleanPrice(val) {
    if (!val) return 0;
    const num = parseFloat(val.replace(/[^0-9.]/g, ''));
    return isNaN(num) ? 0 : num;
}

// --- Clean up description text ---
function cleanDescription(comments, year, make, model, trim, mileage, extColor, optionList) {
    // Build a base description from vehicle details if no comments
    const vehicleInfo = `${year} ${make} ${model}${trim ? ' ' + trim : ''}`.trim();
    const details = [];
    if (mileage && mileage !== '1000' && parseInt(mileage) > 0) {
        details.push(`${parseInt(mileage).toLocaleString()} miles`);
    }
    if (extColor) details.push(`${extColor} exterior`);

    let desc;
    if (!comments || comments.trim().length < 10) {
        desc = `${vehicleInfo}. ${details.join('. ')}. Contact us for details! High Life Auto - Fort Madison, IA. Call/Text Matt 309-337-1049 or Miriam 309-267-7200.`;
    } else {
        // Clean up the Frazer-style formatting (* bullets, extra whitespace)
        let body = comments
            .replace(/\*\s*/g, ' | ')      // Replace * bullets with pipe separators
            .replace(/\s{2,}/g, ' ')        // Collapse excessive whitespace
            .trim();
        desc = `${vehicleInfo}${details.length ? ' - ' + details.join(', ') : ''}. ${body}`;
    }

    // Append features/options list if available
    if (optionList && optionList.trim()) {
        // Option List comes as semicolon-separated: "Air Conditioning; Power Windows; ..."
        const features = optionList.split(';').map(f => f.trim()).filter(f => f && f !== 'Available');
        if (features.length > 0) {
            desc += ` | Features: ${features.join(', ')}`;
        }
    }

    // Strip any real newlines — FB CSV parsing chokes on embedded newlines
    desc = desc.replace(/[\r\n]+/g, ' ').replace(/\s{2,}/g, ' ').trim();

    // FB max is 9999 chars, stay safe
    if (desc.length > 5000) desc = desc.substring(0, 5000) + '...';
    return desc;
}

// ─────────────────────────────────── MAIN ───────────────────────────────────

console.log('─────────────────────────────────────────────────');
console.log('   Facebook Product Catalog Converter');
console.log('   (catalog_products format)');
console.log('─────────────────────────────────────────────────');
console.log(`Input:  ${inputFile}`);
console.log(`Output: ${outputFile}`);
console.log('');

if (!fs.existsSync(inputFile)) {
    console.error(`ERROR: Input file not found: ${inputFile}`);
    process.exit(1);
}

const raw = fs.readFileSync(inputFile, 'utf-8');
const lines = raw.split(/\r?\n/).filter(l => l.trim());

if (lines.length < 2) {
    console.error('ERROR: CSV has no data rows.');
    process.exit(1);
}

// Parse header
const headerCols = parseCSVLine(lines[0]);
const colIdx = {};
headerCols.forEach((h, i) => {
    colIdx[unquote(h)] = i;
});

const get = (row, colName) => {
    const idx = colIdx[colName];
    if (idx === undefined) return '';
    return unquote(row[idx] || '');
};

// ── Facebook catalog_products header ──
// These match the template from Facebook's Commerce Manager CSV download.
// Required fields: id, title, description, availability, condition, price, link, image_link, brand
// Optional fields we populate: color, video[0].url
const FB_HEADERS = [
    'id',
    'title',
    'description',
    'availability',
    'condition',
    'price',
    'link',
    'image_link',
    'brand',
    'google_product_category',
    'fb_product_category',
    'quantity_to_sell_on_facebook',
    'sale_price',
    'sale_price_effective_date',
    'item_group_id',
    'gender',
    'color',
    'size',
    'age_group',
    'material',
    'pattern',
    'shipping',
    'shipping_weight',
    'video[0].url',
    'video[0].tag[0]',
    'gtin',
    'product_tags[0]',
    'product_tags[1]',
    'style[0]'
];

const outputRows = [];
let skipped = 0;

for (let i = 1; i < lines.length; i++) {
    const cols = parseCSVLine(lines[i]);

    const vin = get(cols, 'Vehicle Vin');
    const make = get(cols, 'Vehicle Make');
    const model = get(cols, 'Vehicle Model');
    const trim = get(cols, 'Vehicle Trim Level');
    const year = get(cols, 'Vehicle Year');
    const type = get(cols, 'Vehicle Type');
    const retail = cleanPrice(get(cols, 'Retail'));
    const imageUrlField = get(cols, 'Image URL');
    const stockNum = get(cols, 'Stock Number');
    const comments = get(cols, 'Comments');
    const youtubeUrl = get(cols, 'YouTube URL');
    const extColor = get(cols, 'Exterior Color');
    const mileage = get(cols, 'Mileage');
    const optionList = get(cols, 'Option List');

    // Skip rows without a valid make/model or VIN
    if (!make || !model || !vin) {
        skipped++;
        continue;
    }

    // Skip vehicles with $0 retail (not priced yet)
    if (retail <= 0) {
        console.log(`   Skip: ${year} ${make} ${model} (Stock #${stockNum}) — No retail price`);
        skipped++;
        continue;
    }

    // Images: take the first image URL from the pipe-delimited list
    const images = imageUrlField ? imageUrlField.split('|').filter(u => u.trim()) : [];
    const mainImage = images[0] || '';

    // Skip if no image
    if (!mainImage) {
        console.log(`   Skip: ${year} ${make} ${model} (Stock #${stockNum}) — No images`);
        skipped++;
        continue;
    }

    // ── Build the FB row ──
    const title = `${year} ${make} ${model}${trim ? ' ' + trim : ''}`.trim();
    const vehicleUrl = `${SITE_URL}/vehicle/${stockNum}`;
    const priceStr = `${retail.toFixed(2)} USD`;
    const description = cleanDescription(comments, year, make, model, trim, mileage, extColor, optionList);

    // Google product category for vehicles
    const googleCategory = 'Vehicles & Parts > Vehicles';
    const fbCategory = 'vehicles';

    const row = {
        'id': stockNum,                          // Stock # as unique ID
        'title': title,                          // "2015 RAM 2500 LONGHORN"
        'description': description,              // Cleaned sales comments
        'availability': 'in stock',              // Always in stock
        'condition': 'used',                     // Always used
        'price': priceStr,                       // "22500.00 USD"
        'link': vehicleUrl,                      // highlifeauto.com/vehicle/4089
        'image_link': mainImage,                 // First Frazer photo URL
        'brand': make,                           // Vehicle Make as brand
        'google_product_category': googleCategory,
        'fb_product_category': fbCategory,
        'quantity_to_sell_on_facebook': '',       // Not selling via checkout
        'sale_price': '',                        // No sale price
        'sale_price_effective_date': '',
        'item_group_id': '',                     // No variants
        'gender': '',                            // N/A for vehicles
        'color': extColor,                       // Exterior color
        'size': '',                              // N/A
        'age_group': '',                         // N/A
        'material': '',                          // N/A
        'pattern': '',                           // N/A
        'shipping': '',                          // Local pickup
        'shipping_weight': '',
        'video[0].url': youtubeUrl || '',        // YouTube test drive video
        'video[0].tag[0]': youtubeUrl ? 'Test Drive' : '',
        'gtin': '',                              // No GTIN for used cars
        'product_tags[0]': type || '',           // Vehicle type (Truck, SUV, etc)
        'product_tags[1]': mileage ? `${parseInt(mileage).toLocaleString()} miles` : '',
        'style[0]': ''
    };

    outputRows.push(row);
}

// --- Write output CSV ---
const headerLine = FB_HEADERS.join(',');
const dataLines = outputRows.map(row => {
    return FB_HEADERS.map(h => csvEscape(row[h])).join(',');
});

const csvContent = [headerLine, ...dataLines].join('\r\n') + '\r\n';

// Ensure output directory exists
const outputDir = path.dirname(outputFile);
if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
}

fs.writeFileSync(outputFile, csvContent, 'utf-8');
console.log(`\n   ✓ Wrote ${outputRows.length} vehicles to: ${outputFile}`);
console.log(`   ✗ Skipped ${skipped} rows (no price, no image, or invalid)`);

// Also copy to public folder for local access
const publicCopy = path.join(PROJECT_ROOT, 'public', 'inventoryFB.csv');
try {
    fs.writeFileSync(publicCopy, csvContent, 'utf-8');
    console.log(`   ✓ Copied to: ${publicCopy}`);
} catch (e) {
    console.log(`   ! Could not copy to public: ${e.message}`);
}

console.log('\n─────────────────────────────────────────────────');
console.log('   Done! Upload inventoryFB.csv to Facebook Commerce Manager');
console.log('   or push to GitHub with UPDATE_INVENTORY');
console.log('─────────────────────────────────────────────────');
