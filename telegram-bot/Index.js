
import { Bot, InlineKeyboard, webhookCallback } from "grammy";
import { createServer } from "node:http";
import { randomBytes } from "node:crypto";

const token = process.env.BOT_TOKEN;
const publicUrl = process.env.RENDER_EXTERNAL_URL;
const port = Number(process.env.PORT || 10000);

if (!token) throw new Error("BOT_TOKEN is missing");
if (!publicUrl) throw new Error("RENDER_EXTERNAL_URL is missing");

const bot = new Bot(token);

const menu = () => new InlineKeyboard()
  .text("Verify Student", "verify").row()
  .text("Task History", "history")
  .text("Wallet", "wallet").row()
  .text("Referral", "referral")
  .text("Guide", "guide");

bot.command("start", async (ctx) => {
  await ctx.reply(
    "Welcome to Student Verification Bot!\n\nChoose an option:",
    { reply_markup: menu() }
  );
});

bot.command("verify", async (ctx) => {
  await ctx.reply(
    "Student Verification\n\nOnly genuine students may apply using their own authentic information.\n\nVerification requests are not enabled yet."
  );
});

bot.callbackQuery("verify", async (ctx) => {
  await ctx.answerCallbackQuery();
  await ctx.reply("Verification requests are not enabled yet.");
});

bot.callbackQuery("history", async (ctx) => {
  await ctx.answerCallbackQuery();
  await ctx.reply("No requests yet.");
});

bot.callbackQuery("wallet", async (ctx) => {
  await ctx.answerCallbackQuery();
  await ctx.reply("Wallet is not configured yet.");
});

bot.callbackQuery("referral", async (ctx) => {
  await ctx.answerCallbackQuery();
  await ctx.reply("Referral system is not configured yet.");
});

bot.callbackQuery("guide", async (ctx) => {
  await ctx.answerCallbackQuery();
  await ctx.reply(
    "Use authentic student information and follow the official eligibility requirements."
  );
});

bot.catch((err) => console.error("Bot error:", err));

const secret = process.env.WEBHOOK_SECRET ||
  randomBytes(32).toString("hex");

const handleWebhook = webhookCallback(bot, "http", {
  secretToken: secret
});

const server = createServer(async (req, res) => {
  if (req.method === "GET" && req.url === "/") {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("Student Verification Bot is running");
    return;
  }

  if (req.method === "POST" && req.url === "/telegram") {
    try {
      await handleWebhook(req, res);
    } catch (err) {
      console.error("Webhook error:", err);
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
  } catch (err) {
    console.error("Webhook setup failed:", err);
  }
});
