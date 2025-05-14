import { execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

const CONFIG_DIR = "/etc/dnscrypt-proxy";
const CONFIG_FILE = path.join(CONFIG_DIR, "dnscrypt-proxy.toml");
const EXAMPLES_DIR = "/usr/share/doc/dnscrypt-proxy/examples";

function run(command: string) {
  console.log(`>> Running: ${command}`);
  execSync(command, { stdio: "inherit" });
}

function installDnscrypt() {
  run("apt update");
  run("apt install -y dnscrypt-proxy");
}

function copyExampleConfig() {
  if (!fs.existsSync(CONFIG_FILE)) {
    run(`cp ${EXAMPLES_DIR}/* ${CONFIG_DIR}`);
    run(`cp ${CONFIG_DIR}/example-dnscrypt-proxy.toml ${CONFIG_FILE}`);
  }
}

function updateConfig() {
  let config = fs.readFileSync(CONFIG_FILE, "utf-8");

  config = config.replace(
    /listen_addresses = \[.*?\]/,
    `listen_addresses = ['127.0.2.1:53']`
  );

  config = config.replace(
    /server_names = \[.*?\]/,
    `server_names = ['cloudflare', 'google']`
  );

  fs.writeFileSync(CONFIG_FILE, config);
}

function checkAndTest() {
  run(`dnscrypt-proxy -check`);
  run(`dnscrypt-proxy -resolve example.com`);
}

function enableService() {
  run("dnscrypt-proxy -service install");
  run("systemctl start dnscrypt-proxy");
  run("systemctl enable dnscrypt-proxy");
}

function updateSystemdDns() {
  const resolvedConf = "/etc/systemd/resolved.conf";
  let content = fs.readFileSync(resolvedConf, "utf-8");

  content = content.replace(/^#?DNS=.*$/m, "DNS=127.0.2.1");

  fs.writeFileSync(resolvedConf, content);
  run("systemctl restart systemd-resolved");
}

async function main() {
  if (os.platform() !== "linux") {
    console.error("This script is intended for Linux systems only.");
    process.exit(1);
  }

  installDnscrypt();
  copyExampleConfig();
  updateConfig();
  checkAndTest();
  enableService();
  updateSystemdDns();

  console.log("✅ dnscrypt-proxy is installed, configured, and running.");
}

main().catch((err) => {
  console.error("❌ Failed:", err);
});
