import fs from "node:fs";
import puppeteer from "puppeteer-core";
const L = await import("./apps/api/dist/modules/email/email-layout.js");
const S = await import("./packages/shared/dist/index.js");

const money = (v, c) => S.formatMoney(v, { currency: c });
const rows = [
  L.detailRow("Plan", "Pro"),
  L.detailRow("Cost", `${money("12150.00","BDT")} <span style="color:#71717a;font-weight:400">(${money("100.00","USD")})</span>`),
  L.detailRow("Billed", "Monthly"),
  L.detailRow("Renews on", "2026-08-24"),
].join("");

const html = L.layout({
  preview: "Claude AI renews on 2026-08-24 — there is still time to change it.",
  heading: "Claude AI renews on 2026-08-24",
  body: `
    <div style="font-size:20px;font-weight:600;line-height:1.3;letter-spacing:-.01em">
      Claude AI renews on 2026-08-24
    </div>
    <div style="margin:6px 0 0;color:#71717a;font-size:14px">
      This is a reminder while there is still time to cancel or change it.
    </div>
    ${L.detailPanel(rows)}
    ${L.button("https://claude.ai", "Open Claude AI")}
  `,
});
fs.writeFileSync("C:/Users/USER/AppData/Local/Temp/claude/d--codes-Finance-Management-software/dbb8ac80-9ba7-4725-9a6a-9ccd3dbd12b5/scratchpad/mail.html", html);

const chrome="C:/Program Files/Google/Chrome/Application/chrome.exe";
const browser=await puppeteer.launch({executablePath:fs.existsSync(chrome)?chrome:"C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",headless:"new",args:["--no-sandbox"]});
const page=await browser.newPage();
await page.setViewport({width:760,height:900,deviceScaleFactor:2});
await page.setContent(html,{waitUntil:"networkidle0"});
const box = await page.evaluate(() => {
  const t=document.querySelector('table table');
  const r=t.getBoundingClientRect();
  return {width:Math.round(r.width), height:Math.round(r.height),
    sideways: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    text: document.body.innerText.replace(/\s+/g," ").trim().slice(0,200)};
});
console.log("card width:", box.width, "height:", box.height, "| sideways:", box.sideways);
console.log("reads as:", box.text);
await page.screenshot({path:"C:/Users/USER/AppData/Local/Temp/claude/d--codes-Finance-Management-software/dbb8ac80-9ba7-4725-9a6a-9ccd3dbd12b5/scratchpad/mail.png", fullPage:true});
console.log("screenshot written");
await browser.close();
