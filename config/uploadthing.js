const { createUploadthing } = require("uploadthing/server");
const { UTApi, UTFile } = require("uploadthing/server");
require('dotenv').config();

const UPLOADTHING_SECRET = process.env.UPLOADTHING_SECRET;
const UPLOADTHING_APP_ID = process.env.UPLOADTHING_APP_ID;

if (!UPLOADTHING_SECRET || !UPLOADTHING_APP_ID) {
    console.error("CHYBA: UPLOADTHING_SECRET nebo UPLOADTHING_APP_ID není definován. Zkontrolujte .env soubor.");
}

// Inicializace UploadThing helperu
const f = createUploadthing({
    /**
     * Log level. Standardně "info". Může být "error", "warn", "info", "debug", "trace".
     * @see https://docs.uploadthing.com/getting-started/server-config#loglevel
     */
    // logLevel: "debug",
});

// Základní middleware - pro server-side upload přes UTApi nemusí být komplexní,
// ale je potřeba ho definovat pro strukturu routeru.
// Můžete zde přidat logiku, pokud byste chtěli např. přidat metadata.
const authMiddleware = async ({ req }) => {
    // Pro server-side upload nepotřebujeme nutně req, můžeme vrátit statické ID
    // nebo načíst nějakou konfiguraci.
    console.log("UploadThing Middleware (server-side context)");
    return { serverProcessId: "slavesonline-backend", triggeredBy: "order-webhook" };
};

// Definice FileRouteru
const ourFileRouter = {
    photos: f({
        image: {
            maxFileSize: "1024MB",
            maxFileCount: 99,
            acl: "private",
        },
    })
    .middleware(authMiddleware) // Aplikujeme middleware
    .onUploadComplete(async ({ metadata, file }) => {
        // Tento kód běží na serveru PO nahrání souboru
        console.log("UploadThing Server: Upload complete for process:", metadata.serverProcessId);
        console.log("UploadThing Server: File URL (private):", file.ufsUrl); // URL bude privátní
        // Můžete zde přidat další logiku, např. uložení URL do databáze
    }),

    // Nová trasa pro ZIP soubory objednávek
    orderZips: f({
        // Definujeme povolené typy souborů. Použijeme "blob" pro obecné soubory
        // nebo můžeme specifikovat "application/zip".
        // "blob" je flexibilnější, pokud byste chtěli nahrávat i jiné typy.
        // Specifikace "application/zip" je přesnější.
        "application/zip": {
            maxFileSize: "256MB", // Upravte podle očekávané velikosti ZIPu
            maxFileCount: 1,
            acl: "public-read",   // ZIPy budou veřejně čitelné přes URL
            contentDisposition: "attachment" // Navrhne prohlížeči soubor stáhnout
        },
    })
    .middleware(authMiddleware) // Můžeme použít stejný nebo jiný middleware
    .onUploadComplete(async ({ metadata, file }) => {
        console.log("UploadThing Server (orderZips): Upload dokončen. Kontext:", metadata.triggeredBy);
        console.log("UploadThing Server (orderZips): URL souboru (public):", file.url);
        console.log("UploadThing Server (orderZips): Klíč souboru:", file.key);
    }),
};

const utapi = new UTApi({});

module.exports = {
    ourFileRouter, // Export routeru pro případný API handler
    utapi,         // Export instance UTApi pro použití v nástrojích
    UTFile         // Export UTFile pro snadnější použití
}; 