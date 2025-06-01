// backend/src/services/webhookTasks.js
const { supabase } = require('../config/db');
const Resend = require('resend').Resend;
const resend = new Resend(process.env.RESEND_API_KEY);

// --- Task 1: updateOrderStatusToPaid ---
// Updates order status to paid and returns the updated order data.
async function updateOrderStatusToPaid(orderId, customerEmail) {
    console.log(`[TASK] Aktualizace objednávky ${orderId} na 'paid'.`);
    const updatePayload = {
        status: 'paid',
        user_id: customerEmail,
    };

    const { data, error, count } = await supabase
        .from('orders')
        .update(updatePayload)
        .eq('id', orderId)
        .eq('status', 'awaiting_payment')
        .select(`
            *,
            items:order_items (
                quantity,
                product_details:products (
                    name,
                    description,
                    price,
                    received_images_zip_url,
                    received_text
                )
            )
        `);

    if (error) {
        console.error(`[TASK_ERROR] Selhala aktualizace objednávky ${orderId} na 'paid':`, error.message);
        throw new Error(`Selhala aktualizace objednávky ${orderId} na 'paid': ${error.message}`);
    }
    if (count === 0 || !data || data.length === 0) {
        console.warn(`[TASK_WARN] Objednávka ${orderId} nebyla aktualizována na 'paid'. Možná nebyla ve stavu 'awaiting_payment', neexistuje, nebo již byla zpracována.`);
        return null;
    } else {
        console.log(`[TASK_SUCCESS] Objednávka ${orderId} úspěšně aktualizována na 'paid'. Ovlivněné řádky: ${count}`);
        return data[0];
    }
}

// --- Task 2: sendOrderReceivedEmail ---
// Sends an order received email using the provided order data.
async function sendOrderReceivedEmail(order) { // Accept order data directly
    console.log(`[TASK] Odesílání emailu 'Objednávka přijata' na ${order.user_id} pro objednávku ${order.id}.`);
    if (!order || !order.user_id) {
        console.warn(`[TASK_WARN] Chybí email zákazníka nebo data objednávky pro objednávku ${order ? order.id : 'N/A'}. Přeskakuji email 'Objednávka přijata'.`);
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
                                <div style="width: 60px; height: 60px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); border-radius: 8px; display: flex; align-items: center; justify-content: center; color: white; font-weight: bold; font-size: 14px;"></div>
                            </td>
                            <td style="vertical-align: top; padding-left: 15px;">
                                <h4 style="color: #1f2937; font-size: 16px; font-weight: 600; margin: 0 0 5px 0;">${product.name}</h4>
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
<div style="margin: 0; padding: 0; font-family: 'Segoe UI', Arial, sans-serif; background-color: #f5f7fa; color: #333333;">

    <!-- Main Container -->
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background-color: #f5f7fa;">
        <tr>
            <td align="center" style="padding: 40px 20px;">

                <!-- Email Content -->
                <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="600" style="max-width: 600px; background-color: #ffffff; border-radius: 16px; box-shadow: 0 10px 30px rgba(0,0,0,0.1); overflow: hidden;">

                    <!-- Header -->
                    <tr>
                        <td style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 40px 30px; text-align: center;">
                            <h1 style="color: white; font-size: 28px; font-weight: 700; margin: 0 0 10px 0; letter-spacing: -0.5px;">Děkujeme za váš nákup!</h1>
                            <p style="color: rgba(255,255,255,0.9); font-size: 16px; margin: 0; line-height: 1.5;">Vaše objednávka fotek byla úspěšně přijata</p>
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
                                        <td style="padding: 8px 0; font-weight: 700; color: #1f2937; font-size: 16px;">#${order.id}</td>
                                    </tr>
                                    <tr>
                                        <td style="padding: 8px 0; font-weight: 600; color: #64748b; font-size: 14px; text-transform: uppercase; letter-spacing: 0.5px;">Datum objednávky:</td>
                                        <td style="padding: 8px 0; font-weight: 600; color: #1f2937; font-size: 16px;">${orderDate}</td>
                                    </tr>
                                    <tr>
                                        <td style="padding: 8px 0; font-weight: 600; color: #64748b; font-size: 14px; text-transform: uppercase; letter-spacing: 0.5px;">Email:</td>
                                        <td style="padding: 8px 0; font-weight: 600; color: #1f2937; font-size: 16px;">${customerEmailActual}</td>
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
                                    <h3 style="color: #1f2937; font-size: 18px; font-weight: 600; margin: 0;">Objednané fotografie</h3>
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
                                    <div style="margin-bottom: 8px;">📧 Stažení obdržíte během 5-10 minut</div>
                                    <div style="margin-bottom: 8px;">🔗 Odkazy budou platné po neomezenou dobu.</div>
                                    <div>💎 Vysoké rozlišení</div>
                                </div>
                            </div>

                            <!-- Support -->
                            <div style="text-align: center; background-color: #f8fafc; border-radius: 12px; padding: 25px;">
                                <h3 style="color: #1f2937; font-size: 18px; font-weight: 600; margin: 0 0 15px 0;">Potřebujete pomoc?</h3>
                                <p style="color: #64748b; margin: 0 0 20px 0; line-height: 1.5;">Náš tým je tu pro vás. Kontaktujte nás emailem pro jakoukoliv podporu.</p>

                                <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 15px 30px; border-radius: 10px; display: inline-block; font-weight: 600; font-size: 16px;">
                                    📧 support@slavesonline.store
                                </div>
                            </div>
                        </td>
                    </tr>

                    <!-- Footer -->
                    <tr>
                        <td style="background-color: #1f2937; padding: 30px; text-align: center;">
                            <h4 style="color: white; font-size: 18px; font-weight: 600; margin: 0 0 10px 0;">SlavesOnline.store</h4>
                            <p style="color: #9ca3af; font-size: 14px; margin: 0 0 20px 0; line-height: 1.5;">Profesionální fotografie<br>Váš tým SlavesOnline.store</p>

                            <p style="color: #6b7280; font-size: 12px; margin: 0; line-height: 1.4;">
                                Tento email byl odeslán na adresu ${customerEmailActual}<br>
                                SlavesOnline.store • Praha, Česká republika<br>
                                <span style="color: #9ca3af;">© 2025 SlavesOnline.store. Všechna práva vyhrazena.</span>
                            </p>
                        </td>
                    </tr>
                </table>
            </td>
        </tr>
    </table>
</div>
    `;

    try {
        await resend.emails.send({
            from: 'SlavesOnline <noreply@slavesonline.store>',
            to: customerEmailActual,
            subject: `Potvrzení objednávky č. ${order.id}`,
            html: htmlContent,
        });
        console.log(`[TASK_SUCCESS] Email 'Potvrzení objednávky' odeslán na ${customerEmailActual} pro objednávku ${order.id}.`);
    } catch (mailErr) {
        console.error(`[TASK_ERROR] Chyba při odesílání emailu 'Potvrzení objednávky' na ${customerEmailActual} pro objednávku ${order.id}:`, mailErr);
    }
}

// --- Task 3: processOrderItemsAndSendShippedEmail ---
// Processes order items and sends shipped email using the provided order data.
async function processOrderItemsAndSendShippedEmail(order) { // Accept order data directly
    console.log(`[TASK] Zpracování položek objednávky ${order.id} pro odeslání emailu 'odesláno/připraveno' na ${order.user_id}.`);
    
    console.log(JSON.stringify(order, null, 2))
    
    if (!order || !order.user_id) {
        console.warn(`[TASK_WARN] Chybí email zákazníka nebo data objednávky pro objednávku ${order ? order.id : 'N/A'}. Přeskakuji email 'odesláno/připraveno'.`);
        return;
    }

    if (!order.items || order.items.length === 0) {
        console.warn(`[TASK_WARN] Objednávka ${order.id} neobsahuje žádné položky. Přeskakuji zpracování obrázků pro email 'odesláno/připraveno'.`);
        // Optionally send an email notifying about no items or handle this case
        return;
    }

    let productDownloadHtml = '';

    for (const item of order.items) {
        const product = item.product_details;
        if (product) {
            if (product.received_images_zip_url) {
                productDownloadHtml += `
                <!-- Product Item -->
                <div style="background-color: #ffffff; border: 2px solid #e2e8f0; border-radius: 16px; padding: 25px; margin-bottom: 20px; transition: all 0.3s ease;">
                    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
                        <tr>
                            <td style="width: 80px; vertical-align: top;">
                                <div style="width: 60px; height: 60px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); border-radius: 8px; display: flex; align-items: center; justify-content: center; color: white; font-weight: bold; font-size: 14px;"></div>
                            </td>
                            <td style="vertical-align: middle; padding: 0 20px;">
                                <h3 style="color: #1f2937; font-size: 18px; font-weight: 600; margin: 0 0 5px 0;">${product.name}</h3>
                                <p style="color: #64748b; font-size: 14px; margin: 0;">${product.received_text || 'Fotografie'}</p>
                            </td>
                            <td style="vertical-align: middle; text-align: right;">
                                <a href="${product.received_images_zip_url}" style="background: linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%); color: white; text-decoration: none; padding: 12px 20px; border-radius: 10px; font-weight: 600; font-size: 14px; display: inline-flex; align-items: center; gap: 8px; transition: all 0.3s ease;">
                                    <span>📥</span>
                                    <span>Stáhnout ZIP</span>
                                </a>
                            </td>
                        </tr>
                    </table>
                </div>
                `;
            } else {
                console.warn(`[TASK_WARN] Produkt ${product.name} v objednávce ${order.id} nemá received_images_zip_url.`);
            }
        }
    }

    // Sestavení a odeslání emailu
    const htmlContent = `
<div style="margin: 0; padding: 0; font-family: 'Segoe UI', Arial, sans-serif; background-color: #f5f7fa; color: #333333;">

    <!-- Main Container -->
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background-color: #f5f7fa;">
        <tr>
            <td align="center" style="padding: 40px 20px;">

                <!-- Email Content -->
                <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="600" style="max-width: 600px; background-color: #ffffff; border-radius: 16px; box-shadow: 0 10px 30px rgba(0,0,0,0.1); overflow: hidden;">

                    <!-- Header -->
                    <tr>
                        <td style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 40px 30px; text-align: center;">
                            <h1 style="color: white; font-size: 28px; font-weight: 700; margin: 0 0 10px 0; letter-spacing: -0.5px;">Fotografie jsou připravené!</h1>
                            <p style="color: rgba(255,255,255,0.9); font-size: 16px; margin: 0; line-height: 1.5;">Stáhněte si vaše fotografie ve vysokém rozlišení</p>
                        </td>
                    </tr>

                    <!-- Status -->
                    <tr>
                        <td style="padding: 30px;">
                            <div style="text-align: center; margin-bottom: 30px;">
                                <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 15px 25px; border-radius: 25px; display: inline-flex; align-items: center; gap: 8px; font-weight: 600; font-size: 16px;">
                                    <span>✨</span>
                                    <span>Objednávka #${order.id} dokončena</span>
                                </div>
                            </div>

                            <!-- Download Notice -->
                            <div style="background: linear-gradient(135deg, #f8fafc 0%, #e2e8f0 100%); border-radius: 12px; padding: 20px; margin-bottom: 30px; border-left: 4px solid #667eea;">
                                <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 10px;">
                                    <div style="font-size: 20px; color: #667eea;">⚡</div>
                                    <h3 style="color: #1f2937; font-size: 16px; font-weight: 600; margin: 0;">Důležité informace</h3>
                                </div>
                                <div style="color: #64748b; font-size: 14px; line-height: 1.5;">
                                    <div style="margin-bottom: 5px;">• Odkazy jsou platné <strong>30 dní</strong> od dnešního data</div> <!-- TODO: Verify link expiration -->
                                    <div style="margin-bottom: 5px;">• Každý soubor obsahuje fotografie v rozlišení <strong>4K</strong></div>
                                    <div>• Všechny fotky mají <strong>komerční licenci</strong> pro vaše použití</div>
                                </div>
                            </div>

                            <!-- Download Links -->
                            <div style="margin-bottom: 30px;">
                                <h2 style="color: #1f2937; font-size: 22px; font-weight: 700; margin: 0 0 20px 0; text-align: center;">Stáhnout fotografie</h2>

                                ${productDownloadHtml}

                                <!-- Download All Button - Optional, depending on whether there's a combined zip -->
                                <!--
                                <div style="text-align: center; margin-top: 25px;">
                                    <a href="https://download.ai-photos.cz/complete-order-ai12345.zip" style="background: linear-gradient(135deg, #6366f1 0%, #4f46e5 100%); color: white; text-decoration: none; padding: 18px 35px; border-radius: 12px; font-weight: 700; font-size: 16px; display: inline-flex; align-items: center; gap: 10px; box-shadow: 0 4px 15px rgba(99, 102, 241, 0.3);">
                                        <span style="font-size: 20px;">⚡</span>
                                        <span>Stáhnout vše najednou</span>
                                    </a>
                                </div>
                                -->
                            </div>

                            <!-- Usage Tips -->
                            <div style="background: linear-gradient(135deg, #f8fafc 0%, #e2e8f0 100%); border-radius: 12px; padding: 25px; margin-bottom: 30px; border-left: 4px solid #667eea;">
                                <h3 style="color: #1f2937; font-size: 18px; font-weight: 600; margin: 0 0 15px 0;">Tipy pro použití</h3>
                                <div style="color: #64748b; line-height: 1.6; font-size: 14px;">
                                    <div style="margin-bottom: 8px;">💼 Business fotky jsou ideální pro LinkedIn a firemní prezentace</div> <!-- TODO: Make dynamic based on product type/category -->
                                    <div style="margin-bottom: 8px;">📱 Lifestyle fotky skvěle fungují na sociálních sítích</div> <!-- TODO: Make dynamic based on product type/category -->
                                    <div style="margin-bottom: 8px;">🖼️ Všechny fotky můžete komerčně využívat bez omezení</div>
                                    <div>✨ Pro nejlepší kvalitu tisknete ve formátu A4 nebo menším</div>
                                </div>
                            </div>

                            <!-- Support -->
                            <div style="text-align: center; background-color: #f8fafc; border-radius: 12px; padding: 25px;">
                                <h3 style="color: #1f2937; font-size: 18px; font-weight: 600; margin: 0 0 15px 0;">Problémy se stahováním?</h3>
                                <p style="color: #64748b; margin: 0 0 20px 0; line-height: 1.5;">Náš tým rychle vyřeší jakékoliv technické potíže s stažením.</p>

                                <div style="display: flex; justify-content: center; gap: 15px; flex-wrap: wrap;">
                                    <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 15px 30px; border-radius: 10px; display: inline-block; font-weight: 600; font-size: 16px;">
                                        📧 support@slavesonline.store
                                    </div>
                                    <!--
                                    <a href="https://ai-photos.cz/faq" style="background: transparent; color: #667eea; text-decoration: none; padding: 12px 20px; border: 2px solid #667eea; border-radius: 10px; font-weight: 600; font-size: 14px; display: inline-flex; align-items: center; gap: 8px;">
                                        <span>❓</span>
                                        <span>FAQ</span>
                                    </a>
                                    -->
                                </div>
                            </div>
                        </td>
                    </tr>

                    <!-- Footer -->
                    <tr>
                        <td style="background-color: #1f2937; padding: 30px; text-align: center;">
                            <h4 style="color: white; font-size: 18px; font-weight: 600; margin: 0 0 10px 0;">SlavesOnline.store</h4> <!-- TODO: Update this if domain changes -->
                            <p style="color: #9ca3af; font-size: 14px; margin: 0 0 20px 0; line-height: 1.5;">Profesionální fotografie<br>Děkujeme za důvěru!</p>

                            <p style="color: #6b7280; font-size: 12px; margin: 0; line-height: 1.4;">
                                Tento email byl odeslán na adresu ${order.user_id}<br>
                                SlavesOnline.store • Praha, Česká republika<br> <!-- TODO: Update address -->
                                <span style="color: #9ca3af;">© 2025 SlavesOnline.store. Všechna práva vyhrazena.</span> <!-- TODO: Update year and domain -->
                            </p>
                        </td>
                    </tr>
                </table>
            </td>
        </tr>
    </table>
</div>
    `;

    try {
        await resend.emails.send({
            from: 'SlavesOnline <noreply@slavesonline.store>',
            to: order.user_id,
            subject: `Vaše fotografie jsou připravené - Objednávka č. ${order.id}`,
            html: htmlContent,
        });
        console.log(`[TASK_SUCCESS] Email 'Fotografie připraveny ke stažení' odeslán na ${order.user_id} pro objednávku ${order.id}.`);
    } catch (mailErr) {
        console.error(`[TASK_ERROR] Chyba při odesílání emailu 'Fotografie připraveny ke stažení' na ${order.user_id} pro objednávku ${order.id}:`, mailErr);
    }
}

// --- Task 4: updateOrderStatusToShipped ---
// Updates order status to shipped.
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