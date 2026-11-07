
import { Bot, InlineKeyboard, webhookCallback } from "grammy";
import { createServer } from "node:http";
import { randomBytes } from "node:crypto";

import {
  verificationIdFromUrl,
  parseVerification
} from "../src/apps/sheerid/client.js";

const token = process.env.BOT_TOKEN;
const publicUrl = process.env.RENDER_EXTERNAL_URL;
const secret = process.env.WEBHOOK_SECRET;
const adminId = process.env.ADMIN_ID;
const port = Number(process.env.PORT || 10000);

if (!token || !publicUrl || !secret) {
  throw new Error("Missing bot configuration");
}

const bot = new Bot(token);

const waiting = new Set();
const history = new Map();

function menu() {
  return new InlineKeyboard()
    .text("Verify Student", "verify").row()
    .text("Task History", "history")
    .text("Wallet", "wallet").row()
    .text("Referral", "referral")
    .text("Guide", "guide");
}

function getVerificationId(url) {
  return verificationIdFromUrl(url);
}

async function getVerificationStatus(url) {
  const id = getVerificationId(url);

  const response = await fetch(
    `https://my.sheerid.com/rest/v2/verification/${id}`,
    {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(20000)
    }
  );

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  const body = await response.json();
  const result = parseVerification(body, id);

  return {
    id,
    step: result.currentStep,
    errors: result.errorIds,
    rejections: result.rejectionReasons
  };
}

bot.command("start", async ctx => {
  await ctx.reply(
    "Welcome to NPC SheerID Verify!\n\nChoose an option:",
    { reply_markup: menu() }
  );
});

async function askForLink(ctx) {
  waiting.add(ctx.from.id);

  await ctx.reply(
    "Send your own SheerID verification link.\n\n" +
    "I will check its current status."
  );
}

bot.command("verify", askForLink);

bot.callbackQuery("verify", async ctx => {
  await ctx.answerCallbackQuery();
  await askForLink(ctx);
});

bot.on("message:text", async ctx => {
  if (ctx.message.text.startsWith("/")) return;

  const userId = ctx.from.id;
  if (!waiting.has(userId)) return;

  const url = ctx.message.text.trim();

  try {
    getVerificationId(url);
  } catch {
    await ctx.reply("Invalid SheerID verification URL.");
    return;
  }

  waiting.delete(userId);

  await ctx.reply("Checking verification status...");

  try {
    const result = await getVerificationStatus(url);

    const records = history.get(userId) || [];

    records.unshift({
      id: result.id,
      step: result.step,
      date: new Date().toISOString()
    });

    history.set(userId, records.slice(0, 10));

    await ctx.reply(
      `Verification ID: ${result.id}\n` +
      `Current Step: ${result.step}\n` +
      `Errors: ${result.errors.join(", ") || "None"}\n` +
      `Rejection Reasons: ${result.rejections.join(", ") || "None"}`
    );
  } catch (error) {
    console.error("Verification error:", error.message);

    await ctx.reply(
      "Unable to retrieve verification status.\n" +
      "Please check your link and try again."
    );
  }
});

bot.callbackQuery("history", async ctx => {
  await ctx.answerCallbackQuery();

  const records = history.get(ctx.from.id) || [];

  if (!records.length) {
    await ctx.reply("No verification history yet.");
    return;
  }

  await ctx.reply(
    records.map((r, i) =>
      `${i + 1}. ${r.id}\nStatus: ${r.step}\n${r.date}`
    ).join("\n\n")
  );
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
    "Use your own authentic verification link.\n" +
    "This bot checks SheerID status only."
  );
});

bot.command("admin", async ctx => {
  if (String(ctx.from.id) !== String(adminId)) {
    await ctx.reply("Access denied.");
    return;
  }

  await ctx.reply(
    "NPC Admin Panel\n\n" +
    `Active user histories: ${history.size}`
  );
});

bot.catch(error => {
  console.error("Telegram error:", error);
});

const webhook = webhookCallback(bot, "http", {
  secretToken: secret
});

const server = createServer(async (req, res) => {
  if (req.method === "GET" && req.url === "/") {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("NPC SheerID Bot is running");
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

server.listen(port, "0.0.0.0", async () => {
  console.log(`Server listening on port ${port}`);

  try {
    await bot.api.setWebhook(`${publicUrl}/telegram`, {
      secret_token: secret
    });

    console.log("Telegram webhook configured");
  } catch (error) {
    console.error("Webhook setup failed:", error);
  }
});
