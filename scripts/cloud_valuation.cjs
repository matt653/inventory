const fs = require('fs');
const path = require('path');
const { GoogleGenerativeAI } = require("@google/generative-ai");

// --- CONFIG ---
const INPUT_FILE = process.argv[2] || 'inventorycsv.csv';
const OUTPUT_FILE = process.argv[3] || 'inventoryeditedvalues.csv';
const API_KEY = process.env.GEMINI_API_KEY;

if (!API_KEY) {
    console.error("ERROR: GEMINI_API_KEY not found in environment.");
    process.exit(1);
}

const genAI = new GoogleGenerativeAI(API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

// Simple CSV parser
function parseCSV(text) {
    const lines = text.split(/\r?\n/).filter(l => l.trim());
    if (lines.length === 0) return { headers: [], rows: [] };

    // Header
    const headers = lines[0].split(',').map(h => h.replace(/"/g, '').trim());

    // Rows (naive split, but works for our standard Frazer exports)
    const rows = lines.slice(1).map(line => {
        const parts = line.split(',');
        const obj = {};
        headers.forEach((h, i) => {
            obj[h] = parts[i] ? parts[i].replace(/"/g, '').trim() : '';
        });
        return obj;
    });

    return { headers, rows };
}

async function valuateCar(car) {
    const year = car["Vehicle Year"] || "";
    const make = car["Vehicle Make"] || "";
    const modelName = car["Vehicle Model"] || "";
    const trim = car["Vehicle Trim Level"] || "";
    const miles = car["Mileage"] || car["Miles"] || "0";
    const state = "Iowa";

    if (!make || !modelName) return null;

    const carDesc = `${year} ${make} ${modelName} ${trim} with ${miles} miles in ${state}`;
    const prompt = `Valuate this car: ${carDesc}. 
Rules:
1. "Wholesale" value = Trade-in value.
2. "Market" value = Private Party or Dealer Retail value.
3. Return ONLY a JSON object with this format:
{
  "wholesale_low": "12345",
  "wholesale_high": "14567",
  "market_low": "16000",
  "market_high": "18000"
}
If uncertain, estimate. No markdown.`;

    try {
        const result = await model.generateContent(prompt);
        const response = await result.response;
        const text = response.text();
        // Clean markdown
        const cleanJson = text.replace(/```json/g, '').replace(/```/g, '').trim();
        return JSON.parse(cleanJson);
    } catch (e) {
        console.error(`Error valuating ${make} ${modelName}:`, e.message);
        return null;
    }
}

async function run() {
    console.log(`Starting Cloud Valuation: ${INPUT_FILE}`);
    if (!fs.existsSync(INPUT_FILE)) {
        console.error("Input file not found.");
        process.exit(1);
    }

    const { headers, rows } = parseCSV(fs.readFileSync(INPUT_FILE, 'utf-8'));
    console.log(`Loaded ${rows.length} vehicles.`);

    // Check if output columns exist in headers, if not add them
    const valHeaders = ["Market1 Low", "Market1 High", "Wholesale1 Low", "Wholesale1 High"];
    const allHeaders = [...headers];
    valHeaders.forEach(vh => {
        if (!allHeaders.includes(vh)) allHeaders.push(vh);
    });

    const results = [];
    for (let i = 0; i < rows.length; i++) {
        const car = rows[i];
        console.log(`[${i + 1}/${rows.length}] Processing ${car["Vehicle Make"]} ${car["Vehicle Model"]}...`);

        const vals = await valuateCar(car);
        if (vals) {
            car["Market1 Low"] = vals.market_low;
            car["Market1 High"] = vals.market_high;
            car["Wholesale1 Low"] = vals.wholesale_low;
            car["Wholesale1 High"] = vals.wholesale_high;
        }
        results.push(car);

        // Anti-rate limit pause
        await new Promise(r => setTimeout(r, 1000));
    }

    // Write CSV
    const csvContent = [
        allHeaders.join(','),
        ...results.map(row => allHeaders.map(h => `"${row[h] || ''}"`).join(','))
    ].join('\n');

    fs.writeFileSync(OUTPUT_FILE, csvContent);
    console.log(`Saved to ${OUTPUT_FILE}`);
}

run();
