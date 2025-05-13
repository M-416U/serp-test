import path from "path";
import ProxyManager from "./proxyManager.ts";
import { RankTrackerWorker } from "./rankTracker";
import * as fs from "fs";
import { parse } from "csv-parse/sync";
import * as nodemailer from "nodemailer";

const proxyManager = new ProxyManager();
const proxyAuth = {
  username: process.env.PROXY_AUTH_USERNAME || "",
  password: process.env.PROXY_AUTH_PASSWORD || "",
};
const proxies = [
  {
    host: "isp.oxylabs.io",
    port: 8001,
    ip: "45.196.46.34",
    location: "us",
  },
  {
    host: "isp.oxylabs.io",
    port: 8002,
    ip: "45.196.59.123",
    location: "us",
  },
  {
    host: "isp.oxylabs.io",
    port: 8003,
    ip: "45.196.59.14",
    location: "us",
  },
  {
    host: "isp.oxylabs.io",
    port: 8004,
    ip: "45.196.59.170",
    location: "us",
  },
  {
    host: "isp.oxylabs.io",
    port: 8005,
    ip: "45.196.59.90",
    location: "us",
  },
  {
    host: "isp.oxylabs.io",
    port: 8006,
    ip: "69.46.65.248",
    location: "us",
  },
  {
    host: "isp.oxylabs.io",
    port: 8007,
    ip: "198.145.51.11",
    location: "us",
  },
  {
    host: "isp.oxylabs.io",
    port: 8008,
    ip: "50.117.28.85",
    location: "us",
  },
  {
    host: "isp.oxylabs.io",
    port: 8009,
    ip: "50.117.28.91",
    location: "us",
  },
  {
    host: "isp.oxylabs.io",
    port: 8010,
    ip: "45.196.44.42",
    location: "us",
  },
];

proxies.forEach((proxy, index) => {
  proxyManager.addProxy({
    id: `proxy_${index + 1}`,
    host: proxy.host,
    port: proxy.port,
    username: proxyAuth.username,
    password: proxyAuth.password,
    location: proxy.location,
    isActive: true,
  });
});

const rankTrackerWorker = new RankTrackerWorker(proxyManager);

// Email configuration
const emailTransporter = nodemailer.createTransport({
  service: "Gmail",
  host: "smtp.gmail.com",
  port: 465,
  secure: true,
  auth: {
    user: process.env.MAILER_USER || "",
    pass: process.env.MAILER_PASS || "",
  },
});

// Function to send email notification
async function sendEmailNotification(subject: string, content: string) {
  try {
    await emailTransporter.sendMail({
      from: process.env.MAILER_USER || "",
      to: process.env.MAILER_TO,
      subject: subject,
      html: content,
    });
    console.log(`Email sent: ${subject}`);
  } catch (error) {
    console.error("Error sending email:", error);
  }
}

function readKeywordsFromCSV() {
  const csvContent = fs.readFileSync("./keywords.csv", "utf-8");
  const records = parse(csvContent, {
    columns: true,
    skip_empty_lines: true,
  });

  return records.map((record: any) => ({
    keyword: record["Top queries"],
    target: "http://www.shub.coffee/",
  }));
}

async function processKeywords() {
  const keywords = readKeywordsFromCSV();
  const allResults = [];
  const batchSize = 5; // 5 keywords per minute
  const batchDelay = 60000; // 1 minute in milliseconds

  const batches = [];
  for (let i = 0; i < keywords.length; i += batchSize) {
    batches.push(keywords.slice(i, i + batchSize));
  }

  const startTime = new Date().toISOString();
  const startEmailContent = `
    <h2>Keyword Tracking Process Started</h2>
    <p><strong>Start Time:</strong> ${startTime}</p>
    <p><strong>Total Keywords:</strong> ${keywords.length}</p>
    <p><strong>Number of Batches:</strong> ${batches.length}</p>
    <p><strong>Target Website:</strong> http://www.shub.coffee/</p>
    <p><strong>Batch Size:</strong> ${batchSize} keywords per minute</p>
  `;
  await sendEmailNotification(
    "Keyword Tracking Process Started",
    startEmailContent
  );

  console.log(
    `Processing ${keywords.length} keywords in ${batches.length} batches (5 keywords per minute)...`
  );

  for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
    const batch = batches[batchIndex];
    console.log(
      `Starting batch ${batchIndex + 1}/${batches.length} with ${
        batch.length
      } keywords`
    );

    const batchTasks = batch.map((item: any) => {
      return rankTrackerWorker.processJob({
        data: {
          keyword: item.keyword,
          domain: new URL(item.target).hostname,
          location: "us",
        },
      });
    });

    try {
      const batchResults = await Promise.all(batchTasks);
      allResults.push(...batchResults);
      console.log(`Completed batch ${batchIndex + 1}/${batches.length}`);

      if (batchIndex < batches.length - 1) {
        console.log(`Waiting 60 seconds before starting next batch...`);
        await new Promise((resolve) => setTimeout(resolve, batchDelay));
      }
    } catch (error) {
      console.error(`Error processing batch ${batchIndex + 1}:`, error);
    }
  }

  const endTime = new Date().toISOString();
  const completionEmailContent = `
    <h2>Keyword Tracking Process Completed</h2>
    <p><strong>Start Time:</strong> ${startTime}</p>
    <p><strong>End Time:</strong> ${endTime}</p>
    <p><strong>Total Keywords Processed:</strong> ${keywords.length}</p>
    <p><strong>Results Count:</strong> ${allResults.length}</p>
    <p><strong>Target Website:</strong> http://www.shub.coffee/</p>
  `;
  await sendEmailNotification(
    "Keyword Tracking Process Completed",
    completionEmailContent
  );

  console.log("All keywords have been processed");
  return allResults;
}

process.on("exit", () => {
  try {
    const profilesDir = path.join(process.cwd(), "browser_profiles");
    if (fs.existsSync(profilesDir)) {
      try {
        fs.rmSync(profilesDir, { recursive: true, force: true });
      } catch (err: any) {
        console.warn(`Could not remove profiles directory: ${err.message}`);
      }
    }
  } catch (error: any) {
    console.error(`Error during cleanup: ${error.message}`);
  }
});

// Add handlers for other termination signals
["SIGINT", "SIGTERM", "SIGHUP"].forEach((signal) => {
  process.on(signal, () => {
    console.log(`Received ${signal}, cleaning up...`);
    try {
      // Clean up browser profiles
      const profilesDir = path.join(process.cwd(), "browser_profiles");
      if (fs.existsSync(profilesDir)) {
        fs.rmSync(profilesDir, { recursive: true, force: true });
      }

      // Exit process
      process.exit(0);
    } catch (error: any) {
      console.error(`Error during ${signal} cleanup: ${error.message}`);
      process.exit(1);
    }
  });
});

processKeywords().catch(console.error);
