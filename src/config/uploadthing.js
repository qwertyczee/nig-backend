const { createUploadthing } = require("uploadthing/server");
const { UTApi, UTFile } = require("uploadthing/server");

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
    return { serverProcessId: "wireframe-generator" }; // Příklad metadat
};

// Definice FileRouteru
const ourFileRouter = {
    // Trasa specificky pro wireframe screenshoty
    wireframeScreenshots: f({
        image: {
        maxFileSize: "32MB",
        maxFileCount: 1,
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

    // ** New route for product images (public) **
    productImages: f({
        image: { maxFileSize: "108MB", maxFileCount: 10, acl: "public-read" }, // Allow multiple images, public read
    })
        .middleware(authMiddleware) // You might want a different middleware for public uploads or remove it if not needed
        .onUploadComplete(async ({ metadata, file }) => {
            console.log("UploadThing Server: Product image upload complete for:", file.name);
            console.log("UploadThing Server: File URL (public):", file.url); // Use file.url for public files
            // You can add database logic here if needed, but for now, we'll get the URL client-side
        }),

    // Zde můžete přidat další trasy pro jiné typy souborů/účely
    // např. publicProfilePictures: f({ image: { acl: "public-read" } })...

};

// Export typu routeru pro použití jinde (např. v API handleru)
// export type OurFileRouter = typeof ourFileRouter; // Pokud používáte TypeScript
// Add this line to export the type for frontend use
/**
 * @typedef {typeof ourFileRouter} OurFileRouter
 */

// Export instance UTApi, která bude používat konfiguraci z env proměnných
// (UPLOADTHING_SECRET, UPLOADTHING_APP_ID)
const utapi = new UTApi({
    apiKey: process.env.UPLOADTHING_SECRET,
    appId: process.env.UPLOADTHING_APP_ID,
    // regions: process.env.UPLOADTHING_REGION ? [process.env.UPLOADTHING_REGION] : [] // Uncomment and configure if you need specific regions
});

module.exports = {
    ourFileRouter, // Export routeru pro případný API handler
    utapi,         // Export instance UTApi pro použití v nástrojích
    UTFile,        // Export UTFile pro snadnější použití
    /** @type {OurFileRouter} */ // This is for JSDoc type hinting in JS files
    OurFileRouter: ourFileRouter // Export the router itself as OurFileRouter for type inference in TS
};