// backend/src/services/webhookTasks.js
const { supabase } = require('../config/db');
const Resend = require('resend').Resend;
const resend = new Resend(process.env.RESEND_API_KEY);
const jszip = require('jszip');
const axios = require('axios');
const path = require('path');

// Import UploadThing utilit
const { utapi, UTFile } = require('../config/uploadthing'); // Správná cesta k vašemu uploadthing.js

// --- Task 1: updateOrderStatusToPaid --- (beze změny)
async function updateOrderStatusToPaid(orderId, customerEmail) {
    console.log(`[TASK] Aktualizace objednávky ${orderId} na 'paid'.`);
    const updatePayload = {
        status: 'paid',
        user_id: customerEmail,
        order_id: orderId
    };

    const { error, count } = await supabase
        .from('orders')
        .update(updatePayload)
        .eq('id', orderId)
        .eq('status', 'awaiting_payment');

    if (error) {
        console.error(`[TASK_ERROR] Selhala aktualizace objednávky ${orderId} na 'paid':`, error.message);
        throw new Error(`Selhala aktualizace objednávky ${orderId} na 'paid': ${error.message}`);
    }
    if (count === 0) {
        console.warn(`[TASK_WARN] Objednávka ${orderId} nebyla aktualizována na 'paid'. Možná nebyla ve stavu 'awaiting_payment', neexistuje, nebo již byla zpracována.`);
    } else {
        console.log(`[TASK_SUCCESS] Objednávka ${orderId} úspěšně aktualizována na 'paid'. Ovlivněné řádky: ${count}`);
    }
}

// --- Task 2: sendOrderReceivedEmail ---
async function sendOrderReceivedEmail(orderId, customerEmail) {
    console.log(`[TASK] Odesílání emailu 'Objednávka přijata' na ${customerEmail} pro objednávku ${orderId}.`);
    if (!customerEmail) {
        console.warn(`[TASK_WARN] Chybí email zákazníka pro objednávku ${orderId}. Přeskakuji email 'Objednávka přijata'.`);
        return;
    }

    // Fetch order details including items and product details
    const { data: order, error: orderError } = await supabase
        .from('orders')
        .select(`
            id,
            created_at,
            user_id,
            items:order_items (
                quantity,
                product_details:products (
                    name,
                    description,
                    price
                )
            )
        `)
        .eq('id', orderId)
        .single();

    if (orderError || !order) {
        console.error(`[TASK_ERROR] Nepodařilo se načíst objednávku ${orderId} for email 'Objednávka přijata':`, orderError?.message);
        // Do not throw error here, just log and exit to avoid blocking webhook
        return;
    }

    const orderDate = new Date(order.created_at).toLocaleDateString('cs-CZ', { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    const customerEmailActual = order.user_id; // Use the email fetched from the order data

    let productsHtml = '';
    let totalAmount = 0;

    if (order.items && order.items.length > 0) {
        productsHtml = order.items.map(item => {
            const product = item.product_details;
            if (!product) return '';

            // Calculate item total using product price and quantity
            const itemTotalPrice = product.price * item.quantity;
            totalAmount += itemTotalPrice;

            return `
                <div style="padding: 20px; border-bottom: 1px solid #e2e8f0;">
                    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
                        <tr>
                            <td style="width: 80px; vertical-align: top;">
                                <div style="width: 60px; height: 60px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); border-radius: 8px; display: flex; align-items: center; justify-content: center; color: white; font-weight: bold; font-size: 14px;">AI</div>
                            </td>
                            <td style="vertical-align: top; padding-left: 15px;">
                                <h4 style="color: #1f2937; font-size: 16px; font-weight: 600; margin: 0 0 5px 0;">${product.name}</h4>
                                <p style="color: #64748b; font-size: 14px; margin: 0 0 8px 0; word-break: break-word;">${product.description || 'N/A'}</p>
                                <div style="color: #64748b; font-size: 14px;">
                                    <span>Množství: ${item.quantity}x</span> •
                                    <span style="font-weight: 600; color: #1f2937;">${itemTotalPrice.toFixed(2)} Kč</span>
                                </div>
                            </td>
                            <td style="vertical-align: top; text-align: right;">
                                <div style="font-weight: 700; color: #1f2937; font-size: 16px;">${itemTotalPrice.toFixed(2)} Kč</div>
                            </td>
                        </tr>
                    </table>
                </div>
            `;
        }).join('');
    } else {
        productsHtml = `
            <div style="padding: 20px;">
                <p style="color: #64748b; text-align: center;">K této objednávce nebyly nalezeny žádné položky.</p>
            </div>
        `;
    }


    const htmlContent = `
<!DOCTYPE html>
<html lang="cs">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Potvrzení objednávky digitálních produktů</title>
</head>
<body style="margin: 0; padding: 0; font-family: 'Segoe UI', Arial, sans-serif; background-color: #f5f7fa; color: #333333;">

    <!-- Main Container -->
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background-color: #f5f7fa;">
        <tr>
            <td align="center" style="padding: 40px 20px;">

                <!-- Email Content -->
                <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="600" style="max-width: 600px; background-color: #ffffff; border-radius: 16px; box-shadow: 0 10px 30px rgba(0,0,0,0.1); overflow: hidden;">

                    <!-- Header -->
                    <tr>
                        <td style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 40px 30px; text-align: center;">
                            <div style="background-color: rgba(255,255,255,0.2); border-radius: 50%; width: 80px; height: 80px; margin: 0 auto 20px; display: inline-flex; align-items: center; justify-content: center;">
                                <div style="font-size: 36px; color: white;">🎨</div>
                            </div>
                            <h1 style="color: white; font-size: 28px; font-weight: 700; margin: 0 0 10px 0; letter-spacing: -0.5px;">Děkujeme za váš nákup!</h1>
                            <p style="color: rgba(255,255,255,0.9); font-size: 16px; margin: 0; line-height: 1.5;">Vaše objednávka AI generovaných fotek byla úspěšně přijata</p>
                        </td>
                    </tr>

                    <!-- Order Details -->
                    <tr>
                        <td style="padding: 40px 30px;">
                            <div style="background: linear-gradient(135deg, #f8fafc 0%, #e2e8f0 100%); border-radius: 12px; padding: 25px; margin-bottom: 30px; border-left: 4px solid #667eea;">
                                <h2 style="color: #1f2937; font-size: 20px; font-weight: 600; margin: 0 0 20px 0;">Detaily objednávky</h2>

                                <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
                                    <tr>
                                        <td style="padding: 8px 0; font-weight: 600; color: #64748b; font-size: 14px; width: 40%; text-transform: uppercase; letter-spacing: 0.5px;">Číslo objednávky:</td>
                                        <td style="padding: 8px 0; font-weight: 700; color: #1f2937; font-size: 16px;">#${orderId}</td>
                                    </tr>
                                    <tr>
                                        <td style="padding: 8px 0; font-weight: 600; color: #64748b; font-size: 14px; text-transform: uppercase; letter-spacing: 0.5px;">Datum objednávky:</td>
                                        <td style="padding: 8px 0; font-weight: 600; color: #1f2937; font-size: 16px;">${orderDate}</td>
                                    </tr>
                                    <tr>
                                        <td style="padding: 8px 0; font-weight: 600; color: #64748b; font-size: 14px; text-transform: uppercase; letter-spacing: 0.5px;">Email:</td>
                                        <td style="padding: 8px 0; font-weight: 600; color: #1f2937; font-size: 16px;">${customerEmailActual}</td>
                                    </tr>
                                    <!-- Assuming a single product type for simplicity or you can loop through unique types -->
                                    <tr>
                                        <td style="padding: 8px 0; font-weight: 600; color: #64748b; font-size: 14px; text-transform: uppercase; letter-spacing: 0.5px;">Typ produktu:</td>
                                        <td style="padding: 8px 0; font-weight: 600; color: #1f2937; font-size: 16px;">AI Generované fotografie</td>
                                    </tr>
                                    <tr>
                                        <td style="padding: 8px 0; font-weight: 600; color: #64748b; font-size: 14px; text-transform: uppercase; letter-spacing: 0.5px;">Celková částka:</td>
                                        <td style="padding: 8px 0; font-weight: 700; color: #22c55e; font-size: 20px;">${totalAmount.toFixed(2)} Kč</td>
                                    </tr>
                                </table>
                            </div>

                            <!-- Status -->
                            <div style="text-align: center; margin-bottom: 30px;">
                                <div style="background: linear-gradient(135deg, #22c55e 0%, #16a34a 100%); color: white; padding: 12px 24px; border-radius: 25px; display: inline-block; font-weight: 600; font-size: 14px; text-transform: uppercase; letter-spacing: 0.5px;">
                                    ✅ Zaplaceno - Připravuje se ke stažení
                                </div>
                            </div>

                            <!-- Products -->
                            <div style="background-color: #ffffff; border: 2px solid #e2e8f0; border-radius: 12px; overflow: hidden; margin-bottom: 30px;">
                                <div style="background-color: #f8fafc; padding: 20px; border-bottom: 1px solid #e2e8f0;">
                                    <h3 style="color: #1f2937; font-size: 18px; font-weight: 600; margin: 0;">Objednané AI fotografie</h3>
                                </div>

                                <!-- Product Items -->
                                ${productsHtml}

                                <!-- Total -->
                                <div style="padding: 20px; background-color: #f8fafc; border-top: 2px solid #e2e8f0;">
                                    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
                                        <tr>
                                            <td style="text-align: right; padding: 8px 0;">
                                                <span style="color: #1f2937; font-size: 18px; font-weight: 700;">Celkem:</span>
                                            </td>
                                            <td style="text-align: right; padding: 8px 0; width: 120px;">
                                                <span style="color: #22c55e; font-size: 20px; font-weight: 700;">${totalAmount.toFixed(2)} Kč</span>
                                            </td>
                                        </tr>
                                    </table>
                                </div>
                            </div>

                            <!-- Next Steps -->
                            <div style="background: linear-gradient(135deg, #dbeafe 0%, #bfdbfe 100%); border-radius: 12px; padding: 25px; margin-bottom: 30px; border-left: 4px solid #3b82f6;">
                                <h3 style="color: #1e40af; font-size: 18px; font-weight: 600; margin: 0 0 15px 0;">Co bude dál?</h3>
                                <div style="color: #1e40af; line-height: 1.6; font-size: 14px;">
                                    <div style="margin-bottom: 8px;">🎨 Vaše AI fotografie se právě generují</div>
                                    <div style="margin-bottom: 8px;">📧 Stažení obdržíte během 5-10 minut</div>
                                    <div style="margin-bottom: 8px;">🔗 Odkazy budou platné po neomezenou dobu.</div>
                                    <div>💎 Vysoké rozlišení + komerční licence</div>
                                </div>
                            </div>

                            <!-- Support -->
                            <div style="text-align: center; background-color: #f8fafc; border-radius: 12px; padding: 25px;">
                                <h3 style="color: #1f2937; font-size: 18px; font-weight: 600; margin: 0 0 15px 0;">Potřebujete pomoc?</h3>
                                <p style="color: #64748b; margin: 0 0 20px 0; line-height: 1.5;">Náš tým je tu pro vás. Kontaktujte nás emailem pro jakoukoliv podporu.</p>

                                <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 15px 30px; border-radius: 10px; display: inline-block; font-weight: 600; font-size: 16px;">
                                    📧 support@ai-photos.cz
                                </div>
                            </div>
                        </td>
                    </tr>

                    <!-- Footer -->
                    <tr>
                        <td style="background-color: #1f2937; padding: 30px; text-align: center;">
                            <div style="margin-bottom: 20px;">
                                <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; width: 50px; height: 50px; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center; font-weight: bold; font-size: 20px;">AI</div>
                            </div>
                            <h4 style="color: white; font-size: 18px; font-weight: 600; margin: 0 0 10px 0;">AI-Photos.cz</h4>
                            <p style="color: #9ca3af; font-size: 14px; margin: 0 0 20px 0; line-height: 1.5;">Profesionální AI generované fotografie<br>Váš tým AI-Photos.cz</p>

                            <p style="color: #6b7280; font-size: 12px; margin: 0; line-height: 1.4;">
                                Tento email byl odeslán na adresu ${customerEmailActual}<br>
                                AI-Photos.cz • Praha, Česká republika<br>
                                <span style="color: #9ca3af;">© 2025 AI-Photos.cz. Všechna práva vyhrazena.</span>
                            </p>
                        </td>
                    </tr>
                </table>
            </td>
        </tr>
    </table>
</body>
</html>
    `;

    try {
        await resend.emails.send({
            from: 'AI-Photos.cz <noreply@ai-photos.cz>', // Updated sender name and domain
            to: customerEmailActual,
            subject: `Potvrzení objednávky digitálních produktů č. ${orderId}`, // Updated subject
            html: htmlContent,
        });
        console.log(`[TASK_SUCCESS] Email 'Potvrzení objednávky' odeslán na ${customerEmailActual} pro objednávku ${orderId}.`);
    } catch (mailErr) {
        console.error(`[TASK_ERROR] Chyba při odesílání emailu 'Potvrzení objednávky' na ${customerEmailActual} pro objednávku ${orderId}:`, mailErr);
    }
}

// --- Task 3: processOrderItemsAndSendShippedEmail ---
async function processOrderItemsAndSendShippedEmail(orderId, customerEmail) {
    console.log(`[TASK] Zpracování položek objednávky ${orderId} pro odeslání emailu 'odesláno/připraveno' na ${customerEmail}.`);
    if (!customerEmail) {
        console.warn(`[TASK_WARN] Chybí email zákazníka pro objednávku ${orderId}. Přeskakuji email 'odesláno/připraveno'.`);
        return;
    }

    const { data: order, error: orderError } = await supabase
        .from('orders')
        .select(`
            id,
            items:order_items (
                quantity,
                product_details:products (
                    name,
                    image_url,
                    description
                )
            )
        `)
        .eq('id', orderId)
        .single();

    if (orderError || !order) {
        console.error(`[TASK_ERROR] Nepodařilo se načíst objednávku ${orderId} pro email 'odesláno/připraveno':`, orderError?.message);
        // Do not throw error here, just log and exit to avoid blocking webhook
        return; // Changed from throw to return to avoid crashing webhook
    }

    if (!order.items || order.items.length === 0) {
        console.warn(`[TASK_WARN] Objednávka ${orderId} neobsahuje žádné položky. Přeskakuji zpracování obrázků pro email 'odesláno/připraveno'.`);
    }

    const zip = new jszip();
    const imageFetchPromises = [];
    const productNames = [];
    let productsWithOptions = 0;

    for (const item of order.items) {
        const product = item.product_details;
        if (product) {
            if (product.name) {
                productNames.push(product.name);
            }
            if (product.image_url) {
                productsWithOptions++;
                console.log(`[TASK_INFO] Příprava stahování obrázku pro ${product.name} z ${product.image_url}`);
                imageFetchPromises.push(
                    axios.get(product.image_url, { responseType: 'arraybuffer' })
                        .then(response => {
                            const imageData = Buffer.from(response.data);
                            let filename = path.basename(new URL(product.image_url).pathname);
                            filename = `${product.name.replace(/[^a-zA-Z0-9_.-]/g, '_')}_${filename}`;
                            zip.file(filename, imageData);
                            console.log(`[TASK_INFO] Přidán ${filename} do ZIPu pro produkt ${product.name}.`);
                        })
                        .catch(err => {
                            console.error(`[TASK_ERROR] Selhalo stahování obrázku ${product.image_url} pro produkt ${product.name}:`, err.message);
                        })
                );
            } else {
                console.warn(`[TASK_WARN] Produkt ${product.name} v objednávce ${orderId} nemá image_url.`);
            }
        }
    }

    await Promise.all(imageFetchPromises);

    let downloadLink = '';
    const zipFilename = `order_${orderId}_images.zip`;
    let zipSizeEstimate = 'nezjištěna'; // Default text for size

    if (Object.keys(zip.files).length > 0) {
        try {
            const zipBuffer = await zip.generateAsync({ type: 'nodebuffer', compression: "DEFLATE", compressionOptions: { level: 6 } });
            zipSizeEstimate = (zipBuffer.length / (1024 * 1024)).toFixed(2) + ' MB';

            // --- Integrace UploadThing ---
            console.log(`[TASK_INFO] Pokus o nahrání ZIP (${zipFilename}, velikost: ${zipBuffer.length} bajtů) na UploadThing.`);

            // Vytvoření UTFile objektu z bufferu. Název souboru je důležitý.
            // Explicitně nastavíme MIME typ pro jistotu.
            const fileToUpload = await UTFile.fromBlobOrBuffer(zipBuffer, zipFilename, { type: "application/zip" });

            // Nahrání souboru pomocí utapi.uploadFiles
            // Tato metoda očekává pole souborů.
            const uploadResponseArray = await utapi.uploadFiles([fileToUpload]
                // Není potřeba explicitně specifikovat 'router' nebo 'endpoint' zde,
                // protože utapi.uploadFiles() by mělo respektovat ACL z `ourFileRouter`
                // na základě typu souboru, pokud je v `ourFileRouter` definována odpovídající trasa.
                // `onUploadComplete` pro `orderZips` by se měl také spustit.
            );

            // uploadResponseArray je pole výsledků, jeden pro každý nahraný soubor.
            // Formát: [{ data: { key: string, url: string, name: string, size: number }, error: null } | { data: null, error: UploadThingError }]
            if (uploadResponseArray && uploadResponseArray.length > 0) {
                const uploadResult = uploadResponseArray[0];
                if (uploadResult.data) {
                    downloadLink = uploadResult.data.url; // URL by mělo být veřejné díky acl: "public-read"
                    console.log(`[TASK_SUCCESS] ZIP pro objednávku ${orderId} nahrán na UploadThing. URL: ${downloadLink}, Klíč: ${uploadResult.data.key}`);
                } else if (uploadResult.error) {
                    console.error(`[TASK_ERROR] Selhalo nahrání ZIP pro objednávku ${orderId} na UploadThing:`, uploadResult.error.message);
                    console.error("Celý objekt chyby UploadThing:", uploadResult.error);
                } else {
                    console.error(`[TASK_ERROR] Neočekávaná odpověď od UploadThing pro objednávku ${orderId}.`);
                }
            } else {
                console.error(`[TASK_ERROR] Žádná odpověď nebo prázdné pole od UploadThing pro objednávku ${orderId}.`);
            }

        } catch (uploadError) {
            console.error(`[TASK_ERROR] Chyba během procesu nahrávání na UploadThing pro objednávku ${orderId}:`, uploadError.message);
            if (uploadError.cause) console.error("Příčina:", uploadError.cause);
            // Zde by mohla být i chyba v `UTFile.fromBlobOrBuffer` nebo v `zip.generateAsync`
        }
    } else if (productsWithOptions > 0) {
        console.warn(`[TASK_WARN] Žádné obrázky nebyly úspěšně staženy do ZIPu pro objednávku ${orderId}, ačkoliv produkty měly URL obrázků.`);
    }

    // Sestavení a odeslání emailu
    let htmlContent = `
<!DOCTYPE html>
<html lang="cs">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Vaše AI fotografie jsou připravené!</title>
</head>
<body style="margin: 0; padding: 0; font-family: 'Segoe UI', Arial, sans-serif; background-color: #f5f7fa; color: #333333;">

    <!-- Main Container -->
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background-color: #f5f7fa;">
        <tr>
            <td align="center" style="padding: 40px 20px;">

                <!-- Email Content -->
                <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="700" style="max-width: 700px; background-color: #ffffff; border-radius: 16px; box-shadow: 0 10px 30px rgba(0,0,0,0.1); overflow: hidden;">

                    <!-- Header -->
                    <tr>
                        <td style="background: linear-gradient(135deg, #22c55e 0%, #16a34a 100%); padding: 40px 30px; text-align: center;">
                            <div style="background-color: rgba(255,255,255,0.2); border-radius: 50%; width: 80px; height: 80px; margin: 0 auto 20px; display: inline-flex; align-items: center; justify-content: center;">
                                <div style="font-size: 36px; color: white;">🎉</div>
                            </div>
                            <h1 style="color: white; font-size: 32px; font-weight: 700; margin: 0 0 10px 0; letter-spacing: -0.5px;">Vaše fotografie jsou hotové!</h1>
                            <p style="color: rgba(255,255,255,0.9); font-size: 18px; margin: 0; line-height: 1.5;">Objednávka #${orderId}</p>
                        </td>
                    </tr>

                    <!-- Download Section -->
                    <tr>
                        <td style="padding: 40px 30px;">
                             ${downloadLink ? `
                                <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); border-radius: 12px; padding: 25px; margin-bottom: 30px; color: white; text-align: center;">
                                    <h2 style="color: white; font-size: 24px; font-weight: 700; margin: 0 0 10px 0;">Stáhnout Vaše AI fotografie</h2>
                                    <p style="color: rgba(255,255,255,0.9); font-size: 16px; margin: 0; line-height: 1.5;">Vaše fotografie pro objednávku #${orderId} jsou připraveny ke stažení.</p>
                                    <div style="text-align: center; margin-top: 20px;">
                                        <a href="${downloadLink}" style="background: linear-gradient(135deg, #22c55e 0%, #16a34a 100%); color: white; padding: 15px 40px; border-radius: 12px; display: inline-block; font-weight: 700; font-size: 16px; text-decoration: none;">
                                            📥 Stáhnout fotografie (ZIP${zipSizeEstimate !== 'nezjištěna' ? ' • ' + zipSizeEstimate : ''})
                                        </a>
                                    </div>
                                     <p style="color: rgba(255,255,255,0.9); font-size: 14px; margin-top: 15px; line-height: 1.5;">Tento odkaz bude dostupný dle nastavení UploadThing (typicky trvale pro public-read soubory).</p>
                                </div>

                                <div style="background: linear-gradient(135deg, #f0fdf4 0%, #dcfce7 100%); border-radius: 12px; padding: 20px; border-left: 4px solid #22c55e;">
                                    <h4 style="color: #166534; font-size: 16px; font-weight: 600; margin: 0 0 10px 0;">✅ Licence a použití:</h4>
                                    <div style="color: #166534; font-size: 14px; line-height: 1.6;">
                                        <div>• Komerční použití povoleno</div>
                                        <div>• Vhodné pro různé účely (LinkedIn, weby, soc. sítě atd.)</div>
                                        <div>• Vysoké rozolšení</div>
                                        <div>• Formát: JPEG</div>
                                    </div>
                                </div>
                             ` : `
                                <div style="background: linear-gradient(135deg, #fee2e2 0%, #fecaca 100%); border-radius: 12px; padding: 25px; margin-bottom: 30px; color: #991b1b; text-align: center;">
                                    <h2 style="color: #991b1b; font-size: 24px; font-weight: 700; margin: 0 0 10px 0;">Problém při generování odkazu</h2>
                                    <p style="color: #991b1b; font-size: 16px; margin: 0; line-height: 1.5;">Bohužel se vyskytl problém při generování odkazu ke stažení Vašich fotografií pro objednávku #${orderId}.</p>
                                    <p style="color: #991b1b; font-size: 16px; margin: 15px 0 0 0; line-height: 1.5;">Kontaktujte prosím naši podporu s číslem Vaší objednávky (${orderId}).</p>
                                </div>
                             `}
                        </td>
                    </tr>

                    <!-- Important Info -->
                    <tr>
                        <td style="padding: 40px 30px; background-color: #f8fafc;">
                            <div style="background: linear-gradient(135deg, #dbeafe 0%, #bfdbfe 100%); border-radius: 12px; padding: 25px; margin-bottom: 20px; border-left: 4px solid #3b82f6;">
                                <h3 style="color: #1e40af; font-size: 18px; font-weight: 600; margin: 0 0 15px 0;">⚠️ Důležité informace</h3>
                                <div style="color: #1e40af; line-height: 1.6; font-size: 14px;">
                                    <div style="margin-bottom: 8px;">🔗 Stažení bude dostupné po neomezenou dobu.</div>
                                    <div style="margin-bottom: 8px;">💾 Doporučujeme si fotky zálohovat.</div>
                                    <div style="margin-bottom: 8px;">📧 V případě problémů kontaktujte support.</div>
                                    <div>⭐ Budeme rádi za Vaše hodnocení a zpětnou vazbu!</div>
                                </div>
                            </div>

                            <!-- Support -->
                            <div style="text-align: center; background-color: #ffffff; border-radius: 12px; padding: 25px; border: 2px solid #e2e8f0;">
                                <h3 style="color: #1f2937; font-size: 18px; font-weight: 600; margin: 0 0 15px 0;">Potřebujete pomoc?</h3>
                                <p style="color: #64748b; margin: 0 0 20px 0; line-height: 1.5;">Kontaktujte nás pro jakoukoliv podporu nebo dotazy k vašim AI fotografiím.</p>

                                <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 15px 30px; border-radius: 10px; display: inline-block; font-weight: 600; font-size: 16px;">
                                    📧 support@ai-photos.cz
                                </div>
                            </div>
                        </td>
                    </tr>

                    <!-- Footer -->
                    <tr>
                        <td style="background-color: #1f2937; padding: 30px; text-align: center;">
                            <div style="margin-bottom: 20px;">
                                <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; width: 50px; height: 50px; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center; font-weight: bold; font-size: 20px;">AI</div>
                            </div>
                            <h4 style="color: white; font-size: 18px; font-weight: 600; margin: 0 0 10px 0;">AI-Photos.cz</h4>
                            <p style="color: #9ca3af; font-size: 14px; margin: 0 0 20px 0; line-height: 1.5;">Děkujeme za důvěru! Užijte si vaše nové AI fotografie.<br>Váš tým AI-Photos.cz</p>

                            <p style="color: #6b7280; font-size: 12px; margin: 0; line-height: 1.4;">
                                Tento email byl odeslán na adresu ${customerEmail}<br>
                                AI-Photos.cz • Praha, Česká republika<br>
                                <span style="color: #9ca3af;">© 2025 AI-Photos.cz. Všechna práva vyhrazena.</span>
                            </p>
                        </td>
                    </tr>
                </table>
            </td>
        </tr>
    </table>
</body>
</html>
    `;

    try {
        await resend.emails.send({
            from: 'AI-Photos.cz <noreply@ai-photos.cz>', // Updated sender name and domain
            to: customerEmail,
            subject: `Vaše AI fotografie jsou připravené! Objednávka č. ${orderId}`, // Updated subject
            html: htmlContent,
        });
        console.log(`[TASK_SUCCESS] Email 'Fotografie připraveny' odeslán na ${customerEmail} pro objednávku ${orderId}.`);
    } catch (mailErr) {
        console.error(`[TASK_ERROR] Chyba při odesílání emailu 'Fotografie připraveny' na ${customerEmail} pro objednávku ${orderId}:`, mailErr);
    }
}

// --- Task 4: updateOrderStatusToShipped --- (beze změny)
async function updateOrderStatusToShipped(orderId) {
    console.log(`[TASK] Aktualizace objednávky ${orderId} na 'shipped'.`);
    const { error, count } = await supabase
        .from('orders')
        .update({ status: 'shipped' })
        .eq('id', orderId)
        .eq('status', 'paid');

    if (error) {
        console.error(`[TASK_ERROR] Selhala aktualizace objednávky ${orderId} na 'shipped':`, error.message);
        throw new Error(`Selhala aktualizace objednávky ${orderId} na 'shipped': ${error.message}`);
    }
    if (count === 0) {
        console.warn(`[TASK_WARN] Objednávka ${orderId} nebyla aktualizována na 'shipped'. Možná nebyla ve stavu 'paid' nebo neexistuje.`);
    } else {
        console.log(`[TASK_SUCCESS] Objednávka ${orderId} úspěšně aktualizována na 'shipped'. Ovlivněné řádky: ${count}`);
    }
}

module.exports = {
    updateOrderStatusToPaid,
    sendOrderReceivedEmail,
    processOrderItemsAndSendShippedEmail,
    updateOrderStatusToShipped,
};