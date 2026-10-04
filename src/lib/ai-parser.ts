import { ParsedInboxItem } from "./types";
import { pesosToCents } from "./currency";

/**
 * Deterministic heuristic regex parser for Philippine banking, e-wallet, and utility SMS alerts.
 * Operates offline with zero network latency and 100% predictability.
 */
export function parsePhilippineAlertHeuristic(rawText: string): ParsedInboxItem | null {
  const text = rawText.trim();

  // Pattern 1: BPI InstaPay / Transfer with Fee
  // Example: "InstaPay transfer of PHP 5,000.00 to GCash successful. Fee: PHP 15.00. Ref No: 12345"
  const instapayMatch = text.match(
    /InstaPay transfer of (?:PHP|Php|₱)?\s*([\d,]+(?:\.\d{2})?)\s+to\s+([A-Za-z0-9\s]+?)(?:successful|\.|\s)+.*?Fee:\s*(?:PHP|Php|₱)?\s*([\d,]+(?:\.\d{2})?)/i
  );
  if (instapayMatch) {
    const amount = parseFloat(instapayMatch[1].replace(/,/g, ""));
    const dest = instapayMatch[2].trim();
    const fee = parseFloat(instapayMatch[3].replace(/,/g, ""));
    return {
      merchant: `Transfer to ${dest}`,
      amount_cents: pesosToCents(amount),
      type: "transfer",
      source_account_hint: "BPI Checking",
      destination_account_hint: dest,
      category_hint: "Bank & Transfer Fees",
      fee_cents: pesosToCents(fee),
      confidence: 0.98,
      raw_summary: `InstaPay transfer of ₱${amount.toFixed(2)} to ${dest} (Fee: ₱${fee.toFixed(2)})`,
    };
  }

  // Pattern 2: ATM Withdrawal with Surcharge
  // Example: "ATM withdrawal of PHP 2,000.00 at BDO ATM. Fee: PHP 18.00."
  const atmMatch = text.match(
    /ATM withdrawal of (?:PHP|Php|₱)?\s*([\d,]+(?:\.\d{2})?)(?:\s+at\s+([A-Za-z0-9\s]+?))?(?:\.|\s)+.*?Fee:\s*(?:PHP|Php|₱)?\s*([\d,]+(?:\.\d{2})?)/i
  );
  if (atmMatch) {
    const amount = parseFloat(atmMatch[1].replace(/,/g, ""));
    const atmLocation = atmMatch[2]?.trim() || "ATM";
    const fee = atmMatch[3] ? parseFloat(atmMatch[3].replace(/,/g, "")) : 18;
    return {
      merchant: `ATM Cash (${atmLocation})`,
      amount_cents: pesosToCents(amount),
      type: "expense",
      source_account_hint: "BPI Checking",
      category_hint: "Cash Outflow / Pocket Money",
      fee_cents: pesosToCents(fee),
      confidence: 0.95,
      raw_summary: `ATM Withdrawal of ₱${amount.toFixed(2)} with ₱${fee.toFixed(2)} fee`,
    };
  }

  // Pattern 3: Maya / GCash Send Money
  // Example: "You have sent PHP 500.00 to Juan Dela Cruz on 10/03/2026. Ref: 98765"
  const sendMoneyMatch = text.match(
    /You (?:have )?sent (?:PHP|Php|₱)?\s*([\d,]+(?:\.\d{2})?)\s+(?:of Maya|of GCash)?\s*to\s+([A-Za-z0-9\s]+?)(?:on|\.|Ref)/i
  );
  if (sendMoneyMatch) {
    const amount = parseFloat(sendMoneyMatch[1].replace(/,/g, ""));
    const recipient = sendMoneyMatch[2].trim();
    const isMaya = text.toLowerCase().includes("maya");
    return {
      merchant: recipient,
      amount_cents: pesosToCents(amount),
      type: "expense",
      source_account_hint: isMaya ? "Maya Wallet" : "GCash",
      category_hint: "General Living",
      fee_cents: 0,
      confidence: 0.92,
      raw_summary: `Send money ₱${amount.toFixed(2)} to ${recipient}`,
    };
  }

  // Pattern 4: Merchant Debit Card / Credit Card POS Payment
  // Example: "You paid PHP 185.00 at Artisan Brew on 10/03/2026. Card ending 9281"
  const cardPayMatch = text.match(
    /You paid (?:PHP|Php|₱)?\s*([\d,]+(?:\.\d{2})?)\s+at\s+([A-Za-z0-9\s&'-]+?)(?:\s+on|\.|\s+Card)/i
  );
  if (cardPayMatch) {
    const amount = parseFloat(cardPayMatch[1].replace(/,/g, ""));
    const merchant = cardPayMatch[2].trim();
    return {
      merchant,
      amount_cents: pesosToCents(amount),
      type: "expense",
      source_account_hint: text.toLowerCase().includes("bdo") ? "BDO Card" : "BPI Checking",
      category_hint: "Food & Groceries",
      fee_cents: 0,
      confidence: 0.94,
      raw_summary: `Card payment of ₱${amount.toFixed(2)} at ${merchant}`,
    };
  }

  // Pattern 5: Utility Bill Notice (Meralco / PLDT / Maynilad)
  // Example: "Your Meralco bill for Oct 2026 is PHP 2,850.00 due on 10/06/2026."
  const billMatch = text.match(
    /Your\s+(Meralco|PLDT|Maynilad|Converge)\s+bill.*?is\s+(?:PHP|Php|₱)?\s*([\d,]+(?:\.\d{2})?)(?:.*?due\s+(?:on\s+)?([A-Za-z0-9\/\-]+))?/i
  );
  if (billMatch) {
    const biller = billMatch[1].trim();
    const amount = parseFloat(billMatch[2].replace(/,/g, ""));
    const dueDate = billMatch[3]?.trim();
    return {
      merchant: `${biller} Bill`,
      amount_cents: pesosToCents(amount),
      transacted_at: dueDate,
      type: "expense",
      source_account_hint: "BPI Checking",
      category_hint: "Utilities & Telecom",
      fee_cents: 0,
      confidence: 0.97,
      raw_summary: `${biller} bill of ₱${amount.toFixed(2)}${dueDate ? ` due ${dueDate}` : ""}`,
    };
  }

  return null;
}

/**
 * Parse document or SMS text via OpenRouter LLM with deterministic JSON schema.
 * Falls back to local regex heuristic if offline or API key is unavailable.
 */
export async function parseInboxText(
  rawText: string,
  apiKey?: string
): Promise<ParsedInboxItem> {
  const effectiveKey = apiKey || process.env.OPENROUTER_API_KEY || process.env.AI_API_KEY;

  // If no API key or offline, use heuristic immediately
  if (!effectiveKey) {
    const heuristic = parsePhilippineAlertHeuristic(rawText);
    if (heuristic) return heuristic;

    // Generic fallback for any text containing numbers
    const numMatch = rawText.match(/(?:PHP|Php|₱)?\s*([\d,]+(?:\.\d{2})?)/);
    const amount = numMatch ? parseFloat(numMatch[1].replace(/,/g, "")) : 0;
    return {
      merchant: "Uncategorized Expense",
      amount_cents: pesosToCents(amount),
      type: "expense",
      source_account_hint: "BPI Checking",
      category_hint: "General Living",
      fee_cents: 0,
      confidence: 0.5,
      raw_summary: rawText.slice(0, 80),
    };
  }

  try {
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${effectiveKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://ledgerflow.local",
        "X-Title": "LedgerFlow Finance",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: `You are LedgerFlow AI Ingestion Engine. Extract financial data from SMS, receipts, or bill notifications.
Output strictly JSON matching this structure:
{
  "merchant": string,
  "amount_cents": integer (total amount in Philippine Centavos, e.g. 1500.50 PHP -> 150050),
  "fee_cents": integer (convenience or transfer fee in cents, 0 if none),
  "type": "expense" | "transfer" | "income",
  "source_account_hint": string (e.g. "BPI Checking", "Maya Wallet", "Cash on Hand", "BDO Card"),
  "destination_account_hint": string (for transfers, e.g. "GCash"),
  "category_hint": string (e.g. "Utilities & Telecom", "Food & Groceries", "Bank & Transfer Fees", "Cash Outflow / Pocket Money"),
  "raw_summary": string (concise 1-sentence summary)
}`,
          },
          {
            role: "user",
            content: rawText,
          },
        ],
      }),
    });

    if (!response.ok) {
      throw new Error(`OpenRouter API error: ${response.statusText}`);
    }

    const json = await response.json();
    const content = json.choices?.[0]?.message?.content;
    const parsed = JSON.parse(content);

    return {
      merchant: parsed.merchant || "Extracted Item",
      amount_cents: Math.round(Number(parsed.amount_cents) || 0),
      fee_cents: Math.round(Number(parsed.fee_cents) || 0),
      type: ["expense", "transfer", "income"].includes(parsed.type)
        ? parsed.type
        : "expense",
      source_account_hint: parsed.source_account_hint || "BPI Checking",
      destination_account_hint: parsed.destination_account_hint,
      category_hint: parsed.category_hint || "General Living",
      confidence: 0.95,
      raw_summary: parsed.raw_summary || rawText.slice(0, 80),
    };
  } catch (err) {
    console.warn("AI parser fallback triggered:", err);
    const heuristic = parsePhilippineAlertHeuristic(rawText);
    if (heuristic) return heuristic;

    const numMatch = rawText.match(/(?:PHP|Php|₱)?\s*([\d,]+(?:\.\d{2})?)/);
    const amount = numMatch ? parseFloat(numMatch[1].replace(/,/g, "")) : 0;
    return {
      merchant: "Uncategorized Expense",
      amount_cents: pesosToCents(amount),
      type: "expense",
      source_account_hint: "BPI Checking",
      category_hint: "General Living",
      fee_cents: 0,
      confidence: 0.5,
      raw_summary: rawText.slice(0, 80),
    };
  }
}
