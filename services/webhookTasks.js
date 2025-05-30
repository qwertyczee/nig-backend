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
async function updateOrderStatusToPaid(orderId, lemonSqueezyOrderId, customerEmail) {
    console.log(`[TASK] Aktualizace objednávky ${orderId} na 'paid'. Lemon Squeezy Order ID: ${lemonSqueezyOrderId}`);
    const updatePayload = {
        status: 'paid',
        lemonsqueezy_order_id: lemonSqueezyOrderId,
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

// --- Task 2: sendOrderReceivedEmail --- (beze změny)
async function sendOrderReceivedEmail(orderId, customerEmail) {
    console.log(`[TASK] Odesílání emailu 'Objednávka přijata' na ${customerEmail} pro objednávku ${orderId}.`);
    if (!customerEmail) {
        console.warn(`[TASK_WARN] Chybí email zákazníka pro objednávku ${orderId}. Přeskakuji email 'Objednávka přijata'.`);
        return;
    }

    const htmlContent = `
        <h1>Děkujeme za Vaši objednávku!</h1>
        <p>Vaše objednávka č. <strong>${orderId}</strong> byla úspěšně přijata a momentálně ji zpracováváme.</p>
        <p>O dalším postupu Vás budeme informovat emailem.</p>
        <p>S pozdravem,<br>Tým SlavesOnline</p>
    `;

    try {
        await resend.emails.send({
            from: 'Slavesonline <noreply@slavesonline.store>',
            to: customerEmail,
            subject: `Vaše objednávka č. ${orderId} byla přijata`,
            html: htmlContent,
        });
        console.log(`[TASK_SUCCESS] Email 'Objednávka přijata' odeslán na ${customerEmail} pro objednávku ${orderId}.`);
    } catch (mailErr) {
        console.error(`[TASK_ERROR] Chyba při odesílání emailu 'Objednávka přijata' na ${customerEmail} pro objednávku ${orderId}:`, mailErr);
    }
}

// --- Task 3: processOrderItemsAndSendShippedEmail --- (Změny pro UploadThing)
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
            order_items (
                quantity,
                products (
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
        throw new Error(`Nepodařilo se načíst objednávku ${orderId}: ${orderError?.message || 'Objednávka nenalezena'}`);
    }

    if (!order.order_items || order.order_items.length === 0) {
        console.warn(`[TASK_WARN] Objednávka ${orderId} neobsahuje žádné položky. Přeskakuji zpracování obrázků pro email 'odesláno/připraveno'.`);
    }

    const zip = new jszip();
    const imageFetchPromises = [];
    let emailProductListHtml = '<ul>';
    let productsWithOptions = 0;

    for (const item of order.order_items) {
        const product = item.products;
        if (product) {
        emailProductListHtml += `<li>${item.quantity}x ${product.name}</li>`;
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
    emailProductListHtml += '</ul>';

    await Promise.all(imageFetchPromises);

    let downloadLink = '';
    const zipFilename = `order_${orderId}_images.zip`;

    if (Object.keys(zip.files).length > 0) {
        try {
        const zipBuffer = await zip.generateAsync({ type: 'nodebuffer', compression: "DEFLATE", compressionOptions: { level: 6 } });

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
                console.error(`[TASK_ERROR] Neočekávaná odpověď od UploadThing pro objednávku ${orderId}:`, uploadResponseArray);
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
    } else {
        console.warn(`[TASK_WARN] Pro objednávku ${orderId} nebyly nalezeny žádné produkty s image_url. Přeskakuji generování ZIPu.`);
    }

    // Sestavení a odeslání emailu (logika zůstává stejná)
    let htmlContent = `
        <h1>Vaše objednávka č. ${orderId} je připravena!</h1>
        <p>Děkujeme za Váš nákup. Níže naleznete seznam zakoupených produktů:</p>
        ${emailProductListHtml}
    `;

    if (downloadLink) {
        htmlContent += `
            <p><strong>Stáhněte si obrázky Vašich zakoupených produktů pomocí následujícího odkazu:</strong></p>
            <p><a href="${downloadLink}" style="display: inline-block; padding: 12px 20px; font-size: 16px; font-weight: bold; color: white; background-color: #007bff; text-decoration: none; border-radius: 5px;">Stáhnout obrázky (ZIP)</a></p>
            <p><em>Tento odkaz bude dostupný dle nastavení UploadThing (typicky trvale pro public-read soubory).</em></p>
        `;
    } else if (Object.keys(zip.files).length > 0 || productsWithOptions > 0) {
        htmlContent += `
            <p>Bohužel se vyskytl problém při generování odkazu ke stažení obrázků. Kontaktujte prosím naši podporu s číslem Vaší objednávky (${orderId}).</p>
        `;
    } else {
        htmlContent += `
            <p>K této objednávce nebyly dostupné žádné obrázky ke stažení.</p>
        `;
    }

    htmlContent += `
        <p>S pozdravem,<br>Tým SlavesOnline</p>
    `;

    try {
        await resend.emails.send({
            from: 'Slavesonline <noreply@slavesonline.store>',
            to: customerEmail,
            subject: `Vaše objednávka č. ${orderId} - Produkty ke stažení`,
            html: htmlContent,
        });
        console.log(`[TASK_SUCCESS] Email 'Odesláno/Připraveno' odeslán na ${customerEmail} pro objednávku ${orderId}.`);
    } catch (mailErr) {
        console.error(`[TASK_ERROR] Chyba při odesílání emailu 'Odesláno/Připraveno' na ${customerEmail} pro objednávku ${orderId}:`, mailErr);
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