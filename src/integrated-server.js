
import { Bot, InlineKeyboard, webhookCallback } from "grammy";
import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import {
  verificationIdFromUrl,
  parseVerification
} from "./apps/sheerid/client.js";
import { WebJobs } from "./web/jobs.js";

const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_ID = process.env.ADMIN_ID;
const PUBLIC_URL = process.env.RENDER_EXTERNAL_URL;
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET;
const PORT = Number(process.env.PORT || 10000);

if (!BOT_TOKEN || !PUBLIC_URL || !WEBHOOK_SECRET) {
  throw new Error("Missing required environment variables");
}

const bot = new Bot(BOT_TOKEN);
const jobs = new WebJobs({
  configFile: "/etc/secrets/sheerid.local.json"
});

let engineReady = false;

try {
  await jobs.initialize();
  engineReady = true;
  console.log("SheerID job engine initialized");
} catch (error) {
  console.warn("Job engine configuration unavailable:", error.message);
}

const userLinks = new Map();
const history = new Map();
const awaitingLink = new Set();

function isAdmin(ctx) {
  return String(ctx.from?.id) === String(ADMIN_ID);
}

function mainMenu() {
  return new InlineKeyboard()
    .text("Verify Student", "verify").row()
    .text("Task History", "history")
    .text("Wallet", "wallet").row()
    .text("Referral", "referral")
    .text("Guide", "guide");
}

function saveHistory(userId, record) {
  const records = history.get(userId) || [];
  records.unshift(record);
  history.set(userId, records.slice(0, 10));
}

async function checkVerification(url) {
  const id = verificationIdFromUrl(url);

  const response = await fetch(
    `https://my.sheerid.com/rest/v2/verification/${id}`,
    {
      method: "GET",
      signal: AbortSignal.timeout(20000),
      headers: { Accept: "application/json" }
    }
  );

  if (!response.ok) {
    throw new Error(`SheerID returned HTTP ${response.status}`);
  }

  const data = await response.json();
  const state = parseVerification(data, id);

  return {
    id,
    step: state.currentStep,
    errors: state.errorIds,
    rejectionReasons: state.rejectionReasons
  };
}

const trackingJobs = new Map();
const CHECK_INTERVAL_MS = 60_000;
const MAX_TRACKING_MS = 24 * 60 * 60 * 1000;

function isFinalVerification(result) {
  return (
    result.step === "success" ||
    result.step === "verified" ||
    result.step === "error" ||
    result.step === "rejected" ||
    (result.rejectionReasons?.length ?? 0) > 0
  );
}

async function trackVerification(userId, url, id) {
  const previous = trackingJobs.get(id);

  if (previous) {
    previous.subscribers.add(userId);
    return;
  }

  const job = {
    subscribers: new Set([userId]),
    startedAt: Date.now(),
    lastStatus: null,
    failures: 0,
    timer: null
  };

  trackingJobs.set(id, job);

  async function check() {
    if (trackingJobs.get(id) !== job) return;

    try {
      const result = await checkVerification(url);
      job.failures = 0;

      const status = JSON.stringify({
        step: result.step,
        errors: result.errors,
        rejectionReasons: result.rejectionReasons
      });

      if (status !== job.lastStatus) {
        job.lastStatus = status;

        let text = `Verification: ${id}\nStatus: ${result.step}`;

        if (result.step === "success" || result.step === "verified") {
          text += "\nVerified by SheerID.";
        } else if (result.rejectionReasons?.length) {
          text += "\nVerification rejected.";
        } else if (result.errors?.length) {
          text += "\nErrors reported by SheerID.";
        }

        for (const subscriber of job.subscribers) {
          try {
            await bot.api.sendMessage(subscriber, text);
          } catch (error) {
            console.error("Telegram notification failed:", error.message);
          }
        }
      }

      if (isFinalVerification(result)) {
        trackingJobs.delete(id);
        return;
      }
    } catch (error) {
      job.failures++;
      console.error("Tracking failed:", id, error.message);

      if (job.failures >= 5) {
        trackingJobs.delete(id);
        return;
      }
    }

    if (Date.now() - job.startedAt >= MAX_TRACKING_MS) {
      trackingJobs.delete(id);
      return;
    }

    job.timer = setTimeout(check, CHECK_INTERVAL_MS);
    job.timer.unref?.();
  }

  void check();
}

bot.command("start", async ctx => {
  await ctx.reply(
    "Welcome to NPC SheerID Verify!\n\nChoose an option:",
    { reply_markup: mainMenu() }
  );
});

bot.command("verify", async ctx => {
  awaitingLink.add(ctx.from.id);
  await ctx.reply(
    "Send your own SheerID verification URL.\n\n" +
    "I will check its current status using the repository engine."
  );
});

bot.callbackQuery("verify", async ctx => {
  await ctx.answerCallbackQuery();
  awaitingLink.add(ctx.from.id);
  await ctx.reply("Send your SheerID verification URL.");
});

bot.on("message:text", async ctx => {
  const userId = ctx.from.id;
  const message = ctx.message.text.trim();

  if (message.startsWith("/")) return;
  if (!awaitingLink.has(userId)) return;

  let id;

  try {
    id = verificationIdFromUrl(message);
  } catch {
    await ctx.reply(
      "Invalid SheerID URL. Please send a supported verification link."
    );
    return;
  }

  awaitingLink.delete(userId);
  userLinks.set(userId, id);

  await ctx.reply("Checking verification status...");


await ctx.reply(
  `🔍 Verification link received.\n` +
  `✅ Verification ID: ${id}\n` +
  `⏳ Preparing verification task...`
);

try {
  const result = await checkVerification(message);
void trackVerification(userId, message, id);
  saveHistory(userId, {
      id: result.id,
      step: result.step,
      checkedAt: new Date().toISOString()
    });

    await ctx.reply(
      `Verification ID: ${result.id}\n` +
      `Current Step: ${result.step}\n` +
      `Errors: ${result.errors.join(", ") || "None"}\n` +
      `Rejection Reasons: ${
        result.rejectionReasons.join(", ") || "None"
      }\n\n` +
      "This is the current SheerID API status, not a guarantee of approval."
    );
  } catch (error) {
    console.error("Verification check failed:", error.message);
    await ctx.reply(
      "Could not retrieve verification status.\n" +
      "The link may be expired, unavailable, or inaccessible."
    );
  }
});

bot.callbackQuery("history", async ctx => {
  await ctx.answerCallbackQuery();

  const records = history.get(ctx.from.id) || [];

  if (!records.length) {
    await ctx.reply("No verification checks yet.");
    return;
  }

  const output = records.map((record, index) =>
    `${index + 1}. ${record.id}\n` +
    `Step: ${record.step}\n` +
    `Checked: ${record.checkedAt}`
  ).join("\n\n");

  await ctx.reply(output);
});

bot.callbackQuery("wallet", async ctx => {
  await ctx.answerCallbackQuery();
  await ctx.reply("Wallet is not configured yet.");
});

bot.callbackQuery("referral", async ctx => {
  await ctx.answerCallbackQuery();
  await ctx.reply("Referral system is not configured yet.");
});

bot.callbackQuery("guide", async ctx => {
  await ctx.answerCallbackQuery();
  await ctx.reply(
    "Send a SheerID link belonging to your own verification request.\n" +
    "The bot reads its current status without submitting documents."
  );
});


      

bot.callbackQuery("admin_engine", async ctx => {
  await ctx.answerCallbackQuery();
  if (!isAdmin(ctx)) return;

  await ctx.reply(
    `Repository Engine: ${engineReady ? "Ready" : "Configuration required"}`
  );
});

bot.callbackQuery("admin_jobs", async ctx => {
  await ctx.answerCallbackQuery();
  if (!isAdmin(ctx)) return;

  const records = engineReady ? jobs.list() : [];
  await ctx.reply(
    `Job engine initialized: ${engineReady}\n` +
    `Job data: ${JSON.stringify(records).slice(0, 2500)}`
  );
});

bot.catch(error => {
  console.error("Telegram bot error:", error);
});

const webhook = webhookCallback(bot, "http", {
  secretToken: WEBHOOK_SECRET
});

const server = createServer(async (req, res) => {
  if (req.method === "GET" && req.url === "/") {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("NPC SheerID Verify is running");
    return;
  }

  if (req.method === "POST" && req.url === "/telegram") {
    try {
      await webhook(req, res);
    } catch (error) {
      console.error("Webhook error:", error);
      if (!res.headersSent) {
        res.writeHead(500);
        res.end("Internal Server Error");
      }
    }
    return;
  }

  res.writeHead(404);
  res.end("Not Found");
});

server.listen(PORT, "0.0.0.0", async () => {
  console.log(`NPC server listening on port ${PORT}`);

  try {
    await bot.api.setWebhook(`${PUBLIC_URL}/telegram`, {
      secret_token: WEBHOOK_SECRET
    });
    console.log("Telegram webhook configured");
  } catch (error) {
    console.error("Webhook setup failed:", error);
  }
});
