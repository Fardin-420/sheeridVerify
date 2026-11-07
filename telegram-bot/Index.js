
import { Bot, InlineKeyboard } from "grammy";

const token = process.env.BOT_TOKEN;

if (!token) {
  throw new Error("BOT_TOKEN is missing");
}

const bot = new Bot(token);

function mainMenu() {
  return new InlineKeyboard()
    .text("Verify Student", "verify").row()
    .text("Task History", "history")
    .text("Wallet", "wallet").row()
    .text("Referral", "referral")
    .text("Guide", "guide");
}

bot.command("start", async (ctx) => {
  await ctx.reply(
    "Welcome to Student Verification Bot!\n\nChoose an option:",
    { reply_markup: mainMenu() }
  );
});

bot.command("verify", async (ctx) => {
  await ctx.reply(
    "Student Verification\n\nOnly genuine students using their own information may apply.\n\nVerification requests are not enabled yet."
  );
});

bot.callbackQuery("verify", async (ctx) => {
  await ctx.answerCallbackQuery();
  await ctx.reply("Verification requests are coming soon.");
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
    "Use your own authentic student information and follow the official verification requirements."
  );
});

bot.catch((err) => {
  console.error("Bot error:", err);
});

bot.start();
console.log("Student Verification Bot started.");
