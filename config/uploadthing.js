const { createUploadthing, UTApi, UTFile } = require("uploadthing/server");
require('dotenv').config();

const UPLOADTHING_SECRET = process.env.UPLOADTHING_SECRET;
const UPLOADTHING_APP_ID = process.env.UPLOADTHING_APP_ID;

if (!UPLOADTHING_SECRET || !UPLOADTHING_APP_ID) {
    console.error("CHYBA: UPLOADTHING_SECRET nebo UPLOADTHING_APP_ID není definován. Zkontrolujte .env soubor.");
}

// 1) Helper instance (still needed for file generation/metadata)
const f = createUploadthing();

// 2) Definice FileRouteru
const ourRouter = {
    imageUploader: f({
        image: {
            maxFileSize: "64MB",
            maxFileCount: 10,
        },
    })
        .middleware(async ({ req }) => {
            return { userId: "anonymous" };
        })
        .onUploadComplete(async ({ metadata, file }) => {
            console.log("Upload dokončen:", metadata, file);
        }),
};

async function handlePrepareUpload(req, res) {
    try {
        const { fileName, fileSize, fileType, slug } = req.body;

        if (!fileName || !fileSize || !fileType || !slug) {
            return res.status(400).json({ 
                error: "Missing required parameters: fileName, fileSize, fileType, slug" 
            });
        }

        const prepareUploadResponse = await fetch("https://api.uploadthing.com/v7/prepareUpload", {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-uploadthing-api-key': UPLOADTHING_SECRET,
            },
            body: JSON.stringify({
                fileName,
                slug,
                fileSize,
                fileType
            })
        });

        if (!prepareUploadResponse.ok) {
            const errorText = await prepareUploadResponse.text();
            console.error('UploadThing prepareUpload failed:', prepareUploadResponse.status, errorText);
            return res.status(prepareUploadResponse.status).json({ 
                error: `UploadThing prepareUpload failed: ${errorText}` 
            });
        }

        const data = await prepareUploadResponse.json();
        console.log('PrepareUpload response:', data);
        
        // Return the complete response from UploadThing
        res.status(200).json(data);

    } catch (error) {
        console.error('Error handling prepareUpload request:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
}

const utapi = new UTApi({});

module.exports = {
    ourRouter,
    // uploadthingHandler,
    utapi,
    UTFile,
    handlePrepareUpload
}; 