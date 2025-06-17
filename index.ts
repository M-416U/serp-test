import path from "path";
import ProxyManager from "./proxyManager.ts";
import { SeleniumRankTracker } from "./seleniumRankTracker.ts";
import * as fs from "fs";
import { parse } from "csv-parse/sync";
import * as nodemailer from "nodemailer";

const proxyManager = new ProxyManager({
  requestsPerMinute: Number(process.env.PROXY_REQUEST_PER_MIN) || 3,
  cooldownPeriod: 180000,
});
const proxyAuth = {
  username: process.env.PROXY_AUTH_USERNAME || "",
  password: process.env.PROXY_AUTH_PASSWORD || "",
};
const proxies = [
  {
    host: "isp.oxylabs.io",
    port: 8001,
    ip: "45.196.45.157",
    location: "us",
  },
  {
    host: "isp.oxylabs.io",
    port: 8002,
    ip: "45.196.46.140",
    location: "us",
  },
  {
    host: "isp.oxylabs.io",
    port: 8003,
    ip: "45.196.46.34",
    location: "us",
  },
  {
    host: "isp.oxylabs.io",
    port: 8004,
    ip: "45.196.47.201",
    location: "us",
  },
  {
    host: "isp.oxylabs.io",
    port: 8005,
    ip: "45.196.59.123",
    location: "us",
  },
  {
    host: "isp.oxylabs.io",
    port: 8006,
    ip: "45.196.59.14",
    location: "us",
  },
  {
    host: "isp.oxylabs.io",
    port: 8007,
    ip: "45.196.59.170",
    location: "us",
  },
  {
    host: "isp.oxylabs.io",
    port: 8008,
    ip: "45.196.59.46",
    location: "us",
  },
  {
    host: "isp.oxylabs.io",
    port: 8009,
    ip: "45.196.59.90",
    location: "us",
  },
  {
    host: "isp.oxylabs.io",
    port: 8010,
    ip: "50.117.73.1",
    location: "us",
  },
  {
    host: "isp.oxylabs.io",
    port: 8011,
    ip: "69.46.65.248",
    location: "us",
  },
  {
    host: "isp.oxylabs.io",
    port: 8012,
    ip: "198.145.48.192",
    location: "us",
  },
  {
    host: "isp.oxylabs.io",
    port: 8013,
    ip: "198.145.51.11",
    location: "us",
  },
  {
    host: "isp.oxylabs.io",
    port: 8014,
    ip: "66.180.131.65",
    location: "us",
  },
  {
    host: "isp.oxylabs.io",
    port: 8015,
    ip: "50.117.28.85",
    location: "us",
  },
  {
    host: "isp.oxylabs.io",
    port: 8016,
    ip: "50.117.28.91",
    location: "us",
  },
  {
    host: "isp.oxylabs.io",
    port: 8017,
    ip: "45.196.44.124",
    location: "us",
  },
  {
    host: "isp.oxylabs.io",
    port: 8018,
    ip: "45.196.44.18",
    location: "us",
  },
  {
    host: "isp.oxylabs.io",
    port: 8019,
    ip: "45.196.44.40",
    location: "us",
  },
  {
    host: "isp.oxylabs.io",
    port: 8020,
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

const rankTrackerWorker = new SeleniumRankTracker(proxyManager);

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

  return records
    .map((record: any) => ({
      keyword: record["Top queries"],
      target: "http://www.shub.coffee/",
    }))
    .splice(0, 100);
}

async function processKeywords() {
  const keywords = readKeywordsFromCSV();
  const maxConcurrentSlots = Number(process.env.MAX_SLOTS) || 1;
  const taskDelay = 10000;
  const memoryUsage = process.memoryUsage();
  if (memoryUsage.heapUsed / memoryUsage.heapTotal > 0.8) {
    console.warn(
      "High memory usage detected, consider reducing concurrent slots"
    );
  }
  const startTime = new Date().toISOString();
  const startEmailContent = `
    <h2>Keyword Tracking Process Started</h2>
    <p><strong>Start Time:</strong> ${startTime}</p>
    <p><strong>Total Keywords:</strong> ${keywords.length}</p>
    <p><strong>Concurrent Slots:</strong> ${maxConcurrentSlots}</p>
    <p><strong>Target Website:</strong> http://www.shub.coffee/</p>
    <p><strong>Task Delay:</strong> ${taskDelay / 1000} seconds</p>
  `;
  await sendEmailNotification(
    "Keyword Tracking Process Started",
    startEmailContent
  );

  console.log(
    `Processing ${keywords.length} keywords using ${maxConcurrentSlots} concurrent slots...`
  );

  const keywordQueue = [...keywords];
  const activeSlots = new Set();
  const results: any[] = [];

  async function processKeywordInSlot(slotId: number) {
    while (keywordQueue.length > 0) {
      const item = keywordQueue.shift();
      if (!item) break;

      console.log(`[Slot ${slotId}] Processing keyword: "${item.keyword}"`);

      try {
        const result = await rankTrackerWorker.processJob({
          data: {
            keyword: item.keyword,
            domain: new URL(item.target).hostname,
            location: "us",
          },
        });

        results.push(result);
        console.log(
          `[Slot ${slotId}] Completed keyword: "${item.keyword}", remains: ${keywordQueue.length}`
        );

        if (keywordQueue.length > 0) {
          await new Promise((resolve) => setTimeout(resolve, taskDelay));
        }
      } catch (error) {
        console.error(
          `[Slot ${slotId}] Error processing keyword "${item.keyword}":`,
          error
        );
      }
    }

    activeSlots.delete(slotId);
    console.log(`[Slot ${slotId}] Finished all assigned keywords`);

    if (activeSlots.size === 0) {
      const endTime = new Date().toISOString();
      const completionEmailContent = `
        <h2>Keyword Tracking Process Completed</h2>
        <p><strong>Start Time:</strong> ${startTime}</p>
        <p><strong>End Time:</strong> ${endTime}</p>
        <p><strong>Total Keywords Processed:</strong> ${keywords.length}</p>
        <p><strong>Results Count:</strong> ${results.length}</p>
        <p><strong>Target Website:</strong> http://www.shub.coffee/</p>
      `;
      await sendEmailNotification(
        "Keyword Tracking Process Completed",
        completionEmailContent
      );

      console.log("All keywords have been processed");
    }
  }

  const slotPromises = [];
  for (let i = 0; i < Math.min(maxConcurrentSlots, keywords.length); i++) {
    const slotId = i + 1;
    activeSlots.add(slotId);

    await new Promise((resolve) => setTimeout(resolve, i * 1000));

    slotPromises.push(processKeywordInSlot(slotId));
  }

  await Promise.all(slotPromises);

  return results;
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

["SIGINT", "SIGTERM", "SIGHUP"].forEach((signal) => {
  process.on(signal, () => {
    console.log(`Received ${signal}, cleaning up...`);
    try {
      const profilesDir = path.join(process.cwd(), "browser_profiles");
      if (fs.existsSync(profilesDir)) {
        fs.rmSync(profilesDir, { recursive: true, force: true });
      }

      process.exit(0);
    } catch (error: any) {
      console.error(`Error during ${signal} cleanup: ${error.message}`);
      process.exit(1);
    }
  });
});

processKeywords().catch(console.error);
