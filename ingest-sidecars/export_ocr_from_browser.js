/**
 * Browser Console Script to Export OCR Sidecars from IndexedDB
 * 
 * Run this in the browser DevTools console while your PDF Reader app is open.
 * It will download JSON files for each PDF's OCR data.
 * 
 * Usage: Copy and paste this entire script into the browser console.
 */

(async function exportOcrSidecars() {
    const DB_NAME = 'pdf-editor-local';  // Your IndexedDB name
    const STORE_NAME = 'localFiles';      // Store containing OCR data

    // Open the database
    function openDB(name) {
        return new Promise((resolve, reject) => {
            const req = indexedDB.open(name);
            req.onerror = () => reject(req.error);
            req.onsuccess = () => resolve(req.result);
        });
    }

    try {
        console.log('[ExportOCR] Opening database:', DB_NAME);
        const db = await openDB(DB_NAME);

        if (!db.objectStoreNames.contains(STORE_NAME)) {
            console.error('[ExportOCR] Store not found:', STORE_NAME);
            console.log('[ExportOCR] Available stores:', Array.from(db.objectStoreNames));
            return;
        }

        const tx = db.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);

        // Get all records
        const allRecords = await new Promise((resolve, reject) => {
            const arr = [];
            const request = store.openCursor();
            request.onsuccess = (e) => {
                const cursor = e.target.result;
                if (!cursor) {
                    resolve(arr);
                    return;
                }
                // Only include records with OCR data
                if (cursor.value.ocrData && Object.keys(cursor.value.ocrData).length > 0) {
                    arr.push({
                        key: cursor.key,
                        value: cursor.value
                    });
                }
                cursor.continue();
            };
            request.onerror = () => reject(request.error);
        });

        console.log('[ExportOCR] Found', allRecords.length, 'records with OCR data');

        if (allRecords.length === 0) {
            console.log('[ExportOCR] No OCR data found. Make sure you have opened PDFs and OCR has run.');
            return;
        }

        // Download each as a JSON file
        for (const item of allRecords) {
            const data = item.value;
            const fingerprint = data.pdfFingerprint || item.key;
            const displayName = data.displayName || 'unknown';

            // Create export structure
            const exportData = {
                localFileId: item.key,
                pdfFingerprint: fingerprint,
                displayName: displayName,
                ocrData: data.ocrData,
                exportedAt: new Date().toISOString()
            };

            const filename = `sidecar-${fingerprint}.json`;
            const blob = new Blob([JSON.stringify(exportData, null, 2)], {
                type: 'application/json'
            });

            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            a.remove();
            URL.revokeObjectURL(url);

            console.log('[ExportOCR] Exported:', filename,
                '- Pages:', Object.keys(data.ocrData).length,
                '- Display:', displayName);
        }

        console.log('[ExportOCR] ✅ Export complete! Check your downloads folder.');
        console.log('[ExportOCR] Move the sidecar-*.json files to: ingest-sidecars/sidecars/');

    } catch (error) {
        console.error('[ExportOCR] Error:', error);

        // Try to list available databases
        if (indexedDB.databases) {
            const dbs = await indexedDB.databases();
            console.log('[ExportOCR] Available databases:', dbs.map(d => d.name));
        }
    }
})();
